import Cocoa
import Security

// Credentials never enter the web view, localStorage, logs, or history files.
enum TokenStore {
    static var query: [String: Any] { [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "local.cadence.listenbrainz", kSecAttrAccount as String: "user-token"] }
    static func read() -> String? {
        var q = query; q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
    static func save(_ token: String) -> Bool {
        let data = Data(token.utf8)
        let result = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if result == errSecSuccess { return true }
        guard result == errSecItemNotFound else { return false }
        var q = query; q[kSecValueData as String] = data; q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        return SecItemAdd(q as CFDictionary, nil) == errSecSuccess
    }
    static func delete() -> Bool { let code = SecItemDelete(query as CFDictionary); return code == errSecSuccess || code == errSecItemNotFound }
}
@MainActor final class HistoryService {
    private let defaults: UserDefaults
    private let session: URLSession
    private let removeToken: () -> Bool
    private var tracker = ListeningTracker()
    private var pending: [Listen] = []
    private var token: String?
    private var sending: Task<Void, Never>?
    private var connection: Task<Void, Never>?
    private var nextAttempt = Date.distantPast
    private var failures = 0
    private var lastCheckpoint = Date.distantPast
    private var generation = UUID()
    var onChange: (([String: Any]) -> Void)?
    private(set) var enabled: Bool
    private(set) var user: String
    private var message = "Connect ListenBrainz to start automatic tracking."
    init(defaults: UserDefaults = .standard, session: URLSession = .shared, tokenProvider: () -> String? = TokenStore.read, tokenRemover: @escaping () -> Bool = TokenStore.delete) {
        self.defaults = defaults; self.session = session; self.removeToken = tokenRemover
        user = defaults.string(forKey: "history.user") ?? ""
        enabled = defaults.bool(forKey: "history.enabled")
        if let d = defaults.data(forKey: "history.pending"), let list = try? JSONDecoder().decode([Listen].self, from: d) { pending = list }
        if let d = defaults.data(forKey: "history.tracker"), let t = try? JSONDecoder().decode(ListeningTracker.self, from: d) { tracker = t }
        token = tokenProvider()
        if token == nil || user.isEmpty { enabled = false }
        if !user.isEmpty { message = enabled ? "Tracking is on. Waiting for a qualifying listen." : "Tracking paused. No listens are being uploaded." }
    }
    func state() -> [String: Any] { ["enabled": enabled, "connected": token != nil && !user.isEmpty, "user": user, "pending": pending.count, "message": message] }
    func notify() { onChange?(state()) }
    private func persist() {
        defaults.set(user, forKey: "history.user"); defaults.set(enabled, forKey: "history.enabled")
        defaults.set(try? JSONEncoder().encode(pending), forKey: "history.pending")
        defaults.set(try? JSONEncoder().encode(tracker), forKey: "history.tracker")
    }
    func connect(window: NSWindow) {
        guard connection == nil else { return }
        let alert = NSAlert(); alert.messageText = "Connect ListenBrainz & enable tracking"
        alert.informativeText = "Paste your user token from listenbrainz.org/settings. Cadence will save it in macOS Keychain and automatically send qualifying listens from YouTube Music and SoundCloud to this token’s account. Track, artist, album when available, service link, duration, and listening timestamp are shared. Your ListenBrainz listening history is public."
        let field = NSSecureTextField(frame: NSRect(x: 0, y: 0, width: 420, height: 26)); field.placeholderString = "ListenBrainz user token"; alert.accessoryView = field
        alert.addButton(withTitle: "Connect & enable"); alert.addButton(withTitle: "Cancel")
        alert.beginSheetModal(for: window) { [weak self] response in
            guard response == .alertFirstButtonReturn, let self else { return }
            let candidate = field.stringValue.trimmingCharacters(in: .whitespacesAndNewlines); field.stringValue = ""
            guard UUID(uuidString: candidate) != nil else { self.message = "That token has an unexpected format. Copy your user token from ListenBrainz settings."; self.notify(); return }
            self.message = "Checking your token with ListenBrainz…"; self.notify()
            self.connection = Task { @MainActor in
                defer { self.connection = nil }
                do {
                    let (data, response) = try await self.request(path: "validate-token", token: candidate)
                    guard !Task.isCancelled else { return }
                    let body = try JSONSerialization.jsonObject(with: data) as? [String: Any]
                    guard response.statusCode == 200, body?["valid"] as? Bool == true, let name = body?["user_name"] as? String else { self.message = "ListenBrainz rejected that token. Your existing connection is unchanged."; self.notify(); return }
                    guard TokenStore.save(candidate) else { self.message = "Couldn’t save the token in Keychain. Tracking was not enabled."; self.notify(); return }
                    self.generation = UUID(); self.sending?.cancel()
                    if self.user != name { self.pending = []; self.tracker = ListeningTracker() }
                    self.user = name; self.token = candidate; self.enabled = true; self.nextAttempt = .distantPast
                    self.message = "Tracking enabled for \(name). New listens will be sent automatically."
                    self.persist(); self.notify(); self.flush()
                } catch { if !Task.isCancelled { self.message = "Couldn’t reach ListenBrainz to validate the token. Please try again."; self.notify() } }
            }
        }
    }
    func setEnabled(_ value: Bool) {
        guard token != nil && !user.isEmpty else { notify(); return }
        enabled = value; generation = UUID(); sending?.cancel(); tracker = ListeningTracker(); nextAttempt = .distantPast
        message = value ? "Tracking is on. Waiting for a qualifying listen." : "Tracking paused. Queued listens are kept locally until you resume."
        persist(); notify(); if value { flush() }
    }
    func disconnect() {
        guard removeToken() else { message = "Couldn’t remove the Keychain token. Please try again."; notify(); return }
        generation = UUID(); connection?.cancel(); sending?.cancel(); token = nil; enabled = false; user = ""; pending = []; tracker = ListeningTracker()
        message = "Disconnected. The token and queued listens were removed from this Mac. Previously uploaded listens remain on ListenBrainz."
        persist(); notify()
    }
    func observe(_ sample: PlaybackSample) {
        guard enabled, !user.isEmpty else { return }
        let completed = tracker.observe(sample, user: user, now: Date().timeIntervalSince1970)
        if let listen = completed {
            if pending.count < 1000 { pending.append(listen); message = "Queued \(listen.title) for ListenBrainz." }
            else { message = "The local queue is full. Reconnect to the internet to resume uploads." }
            notify()
        }
        if Date().timeIntervalSince(lastCheckpoint) >= 10 || completed != nil { persist(); lastCheckpoint = Date() }
        flush()
    }
    func checkpoint() { persist() }
    func tick() { flush() }
    private func request(path: String, token: String, payload: [String: Any]? = nil) async throws -> (Data, HTTPURLResponse) {
        var r = URLRequest(url: URL(string: "https://api.listenbrainz.org/1/\(path)")!); r.timeoutInterval = 20
        r.setValue("Token \(token)", forHTTPHeaderField: "Authorization")
        r.setValue("CadenceMac/0.2 (personal macOS listening history client)", forHTTPHeaderField: "User-Agent")
        if let payload { r.httpMethod = "POST"; r.setValue("application/json", forHTTPHeaderField: "Content-Type"); r.httpBody = try JSONSerialization.data(withJSONObject: payload) }
        let (d, response) = try await session.data(for: r)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        return (d, http)
    }
    private func flush() {
        guard sending == nil, enabled, let token, let first = pending.first, first.user == user, Date() >= nextAttempt else { return }
        let currentGeneration = generation
        sending = Task { @MainActor in
            defer { self.sending = nil }
            do {
                // A stable listened_at is reused after failures, allowing server deduplication.
                let (_, response) = try await request(path: "submit-listens", token: token, payload: ["listen_type": "single", "payload": [first.payload]])
                guard !Task.isCancelled, generation == currentGeneration else { return }
                switch response.statusCode {
                case 200:
                    pending.removeAll { $0.id == first.id }; failures = 0; nextAttempt = Date().addingTimeInterval(2)
                    message = "Uploaded \(first.title) to \(user)."; persist(); notify()
                case 401, 403:
                    enabled = false; message = "ListenBrainz rejected the connection. Reconnect to resume; queued listens are kept locally."; persist(); notify()
                case 400:
                    // A malformed item must not prevent later listens from uploading.
                    pending.removeAll { $0.id == first.id }; message = "ListenBrainz rejected one listen. It was skipped; later listens can still upload."; persist(); notify()
                default:
                    let retry = Double(response.value(forHTTPHeaderField: "Retry-After") ?? "")
                    retryLater(delay: retry)
                }
            } catch { if !Task.isCancelled && generation == currentGeneration { retryLater(delay: nil) } }
        }
    }
    private func retryLater(delay: Double?) {
        failures = min(failures + 1, 8)
        nextAttempt = Date().addingTimeInterval(max(delay ?? 0, min(900, 5 * pow(2, Double(failures)))))
        message = "Upload delayed. \(pending.count) listen(s) saved on this Mac; Cadence will retry automatically."; notify()
    }
}
