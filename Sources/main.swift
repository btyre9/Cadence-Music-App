import Cocoa
import WebKit

// Service views render below the opaque app UI and are excluded from VoiceOver.
final class InternalServiceView: WKWebView {
    override var acceptsFirstResponder: Bool { false }
    override func accessibilityChildren() -> [Any]? { [] }
    override func isAccessibilityElement() -> Bool { false }
}

final class App: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {
    let serviceUserAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15"
    var window: NSWindow!
    var shell: WKWebView!
    var youtube: WKWebView!
    var catalog: WKWebView!
    var accountWindow: NSWindow?
    var catalogScript = ""
    var catalogPending = false
    var catalogPolling = false
    var catalogStarted = Date.distantPast
    var catalogVersion = 0
    var catalogExpectedURL = ""
    var catalogReported = false
    var timer: Timer?
    var loadedYouTube = false
    var requestTask: Task<Void, Never>?
    let history = HistoryService()
    var sampleScript = ""
    var sampling = false
    var desiredVolume = UserDefaults.standard.object(forKey: "player.volume") as? Double ?? 0.35
    var libraryScript = ""
    var radioSnapshotScript = ""
    let musicInfo = MusicInfo()
    var infoTask: Task<Void, Never>?
    var footerInfoTask: Task<Void, Never>?
    var libraryBusy = false
    var catalogTimer: Timer?
    var catalogLastSnapshot = ""
    var catalogStableCount = 0
    var playbackGeneration = 0
    var playbackScript = ""
    var repeatOne = false
    var volumeDirty = true
    var lastHistorySample = Date.distantPast
    var historyTimer: Timer?
    // Catalog pages are read from YouTube Music's data service inside one booted service page.
    var browseScript = ""
    var catalogBooted = false
    var catalogQueued: URL?
    var catalogReadyTimer: Timer?
    // Media keys, AirPods, and Control Center (see MediaControls.swift).
    let media = MediaControls()
    var mediaSessionScript = ""
    let debugTiming = ProcessInfo.processInfo.environment["CADENCE_DEBUG"] != nil
    func applicationDidFinishLaunching(_ notification: Notification) {
        history.onChange = { [weak self] state in self?.send("history", state) }
        radioSnapshotScript = (try? String(contentsOf: Bundle.main.url(forResource: "radio-snapshot", withExtension: "js")!, encoding: .utf8)) ?? ""
        playbackScript = (try? String(contentsOf: Bundle.main.url(forResource: "playback-navigation", withExtension: "js")!, encoding: .utf8)) ?? ""
        libraryScript = (try? String(contentsOf: Bundle.main.url(forResource: "youtube-library", withExtension: "js")!, encoding: .utf8)) ?? ""
        catalogScript = (try? String(contentsOf: Bundle.main.url(forResource: "youtube-catalog", withExtension: "js")!, encoding: .utf8)) ?? ""
        sampleScript = (try? String(contentsOf: Bundle.main.url(forResource: "youtube-sample", withExtension: "js")!, encoding: .utf8)) ?? ""
        browseScript = (try? String(contentsOf: Bundle.main.url(forResource: "youtube-browse", withExtension: "js")!, encoding: .utf8)) ?? ""
        mediaSessionScript = (try? String(contentsOf: Bundle.main.url(forResource: "media-session-bridge", withExtension: "js")!, encoding: .utf8)) ?? ""
        media.onCommand = { [weak self] command, position in self?.remote(command, position) }
        media.start()
        let menu = NSMenu(); let item = NSMenuItem(); menu.addItem(item)
        let appMenu = NSMenu(); appMenu.addItem(withTitle: "About Cadence", action: #selector(about), keyEquivalent: "")
        appMenu.addItem(.separator()); appMenu.addItem(withTitle: "Quit Cadence", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"); item.submenu = appMenu
        let editItem = NSMenuItem(); menu.addItem(editItem); let edit = NSMenu(title: "Edit"); editItem.submenu = edit
        for (title, action, key) in [("Undo", "undo:", "z"), ("Cut", "cut:", "x"), ("Copy", "copy:", "c"), ("Paste", "paste:", "v"), ("Select All", "selectAll:", "a")] { edit.addItem(withTitle: title, action: Selector(action), keyEquivalent: key) }
        NSApp.mainMenu = menu
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 820), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "Cadence"; window.minSize = NSSize(width: 1040, height: 680); window.center() // Follows the system Light/Dark setting; style.css supplies both palettes.
        let configuration = WKWebViewConfiguration(); configuration.userContentController.add(self, name: "cadence")
        shell = WKWebView(frame: window.contentView!.bounds, configuration: configuration)
        shell.autoresizingMask = [.width, .height]; shell.navigationDelegate = self; shell.uiDelegate = self
        window.contentView!.addSubview(shell)
        let url = Bundle.main.url(forResource: "index", withExtension: "html")!
        shell.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
        // Start both music engines right away so the first page and first song don't wait for them.
        bootCatalog()
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in self?.prewarmPlayer() }
        startSelfTestIfRequested()
        historyTimer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in Task { @MainActor in self?.history.tick() } }
        timer = Timer.scheduledTimer(withTimeInterval: 0.35, repeats: true) { [weak self] _ in Task { @MainActor in self?.updateTrack() } }
    }
    @objc func about() { NSApp.orderFrontStandardAboutPanel(options: [.applicationName: "Cadence", .applicationVersion: "0.7", .credits: NSAttributedString(string: "A personal music workspace. Interface inspired by Alexis Kiredjian’s YouTube Music Desktop App concept.")]) }
    func applicationWillTerminate(_ notification: Notification) { history.checkpoint() }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func send(_ event: String, _ payload: Any) {
        guard let data = try? JSONSerialization.data(withJSONObject: ["event": event, "payload": payload]), let json = String(data: data, encoding: .utf8) else { return }
        shell.evaluateJavaScript("window.receive(\(json))", completionHandler: nil)
    }
    // Media key / Control Center commands go to the interface, which runs them like the footer buttons.
    func remote(_ command: String, _ position: Double?) {
        var payload: [String: Any] = ["command": command]
        if let position { payload["position"] = position }
        send("remote", payload)
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, message.frameInfo.request.url?.isFileURL == true,
              let body = message.body as? [String: Any], let action = body["action"] as? String else { return }
        switch action {
        case "music-info":
            guard let title = body["title"] as? String, let artist = body["artist"] as? String,
                  let requestID = body["requestID"] as? String, title.count < 500, artist.count < 500 else { return }
            let isFooter = requestID.hasPrefix("now-")
            if isFooter { footerInfoTask?.cancel() } else { infoTask?.cancel() }
            let lookupTask = Task { @MainActor in
                do {
                    let matches = try await musicInfo.lookup(title: title, artist: artist, kind: body["kind"] as? String ?? "song")
                    guard !Task.isCancelled else { return }; send("music-info", ["requestID": requestID, "matches": matches])
                } catch { if !Task.isCancelled { send("music-info", ["requestID": requestID, "matches": [], "error": "Release information is temporarily unavailable. Try again later."]) } }
            }
            if isFooter { footerInfoTask = lookupTask } else { infoTask = lookupTask }
        case "history-state": history.notify()
        case "history-connect": history.connect(window: window)
        case "history-enabled": history.setEnabled(body["enabled"] as? Bool ?? false)
        case "history-disconnect": history.disconnect()
        case "history-sample":
            if let sample = body["sample"] as? [String: Any], sample["source"] as? String == "soundcloud" { observe(sample) }
        case "radio-snapshot":
            guard let requestID = body["requestID"] as? String else { return }
            guard loadedYouTube, !radioSnapshotScript.isEmpty else { send("radio-snapshot", ["requestID": requestID, "tracks": []]); return }
            youtube?.evaluateJavaScript(radioSnapshotScript) { [weak self] value, _ in
                var output = value as? [String: Any] ?? ["tracks": []]; output["requestID"] = requestID
                self?.send("radio-snapshot", output)
            }
        case "library-request":
            if let request = body["request"] as? [String: Any] { libraryRequest(request) }
        case "like":
            if let id = body["id"] as? String, id.range(of: "^[A-Za-z0-9_-]{6,40}$", options: .regularExpression) != nil, let liked = body["liked"] as? Bool { likeSong(id: id, liked: liked) }
        case "catalog":
            if let raw = body["url"] as? String, let url = validatedMusicURL(raw) { loadCatalog(url) }
        case "youtube":
            var u = URLComponents(string: "https://music.youtube.com/search")!
            if let query = body["query"] as? String, !query.isEmpty { u.queryItems = [URLQueryItem(name: "q", value: query)]; loadCatalog(u.url!) }
            else { loadCatalog(URL(string: "https://music.youtube.com/")!) }
        case "play-track":
            if let id = body["id"] as? String, id.range(of: "^[A-Za-z0-9_-]{6,40}$", options: .regularExpression) != nil {
                var u = URLComponents(string: "https://music.youtube.com/watch")!; u.queryItems = [URLQueryItem(name: "v", value: id)]
                playVideo(id: id, url: u.url!); send("engine", ["loading": true])
            }
        case "repeat-one": repeatOne = body["enabled"] as? Bool ?? false; updateTrack()
        case "start-radio":
            if let id = body["id"] as? String, id.range(of: "^[A-Za-z0-9_-]{6,40}$", options: .regularExpression) != nil {
                var u = URLComponents(string: "https://music.youtube.com/watch")!
                u.queryItems = [URLQueryItem(name: "v", value: id), URLQueryItem(name: "list", value: "RDAMVM" + id)]
                repeatOne = false; playVideo(id: id, url: u.url!, radio: true)
            }
        case "account": openAccount()
        case "seek":
            if let seconds = body["seconds"] as? Double, seconds.isFinite, seconds >= 0 { youtube?.evaluateJavaScript("(()=>{const v=document.querySelector('video');if(v&&Number.isFinite(v.duration)){v.currentTime=Math.min(v.duration,\(seconds))}})()", completionHandler: nil) }
        case "volume":
            if let volume = body["volume"] as? Double, volume.isFinite { desiredVolume = min(1,max(0,volume)); UserDefaults.standard.set(desiredVolume, forKey: "player.volume"); volumeDirty = true; youtube?.evaluateJavaScript("(()=>{const v=document.querySelector('video');if(v){const p=document.querySelector('#movie_player');if(p?.setVolume)p.setVolume(\(min(1,max(0,volume))*100));else v.volume=\(min(1,max(0,volume)));}})()", completionHandler: nil) }
        case "pause": youtube?.evaluateJavaScript("document.querySelector('video')?.pause()", completionHandler: nil)
        case "play": youtube?.evaluateJavaScript("(()=>{document.querySelector('video')?.play()})()", completionHandler: nil)
        case "now-playing":
            guard let title = body["title"] as? String, let artist = body["artist"] as? String, !title.isEmpty else { return }
            let number = { (key: String) -> Double in let n = body[key] as? Double ?? 0; return n.isFinite && n >= 0 ? n : 0 }
            media.update(title: String(title.prefix(500)), artist: String(artist.prefix(500)), album: String((body["album"] as? String ?? "").prefix(500)),
                         duration: number("duration"), position: number("position"), playing: body["playing"] as? Bool ?? false,
                         art: String((body["art"] as? String ?? "").prefix(2000)), canSeek: body["canSeek"] as? Bool ?? false)
        case "toggle": youtube?.evaluateJavaScript("(()=>{const v=document.querySelector('video');if(v){v.paused?v.play():v.pause()}})()", completionHandler: nil)
        case "next": youtube?.evaluateJavaScript("document.querySelector('ytmusic-player-bar .next-button')?.click()", completionHandler: nil)
        case "previous": youtube?.evaluateJavaScript("document.querySelector('ytmusic-player-bar .previous-button')?.click()", completionHandler: nil)
        case "reload": if let url = URL(string: catalogExpectedURL), validatedMusicURL(catalogExpectedURL) != nil { loadCatalog(url) }
        case "back": youtube?.goBack()
        case "external":
            if let raw = body["url"] as? String, let u = URL(string: raw), u.scheme == "https", let host = u.host, ["music.youtube.com", "listenbrainz.org", "soundcloud.com", "musicbrainz.org"].contains(host) { NSWorkspace.shared.open(u) }
        case "recommend":
            guard let name = body["username"] as? String, !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, name.count <= 100 else { send("error", "Enter your ListenBrainz username."); return }
            requestTask?.cancel()
            requestTask = Task { @MainActor in
                do {
                    let tracks = try await recommendations(name)
                    guard !Task.isCancelled else { return }
                    send("recommendations", tracks)
                } catch { if !Task.isCancelled { send("error", error.localizedDescription) } }
            }
        default: break
        }
    }
    func get(_ components: URLComponents) async throws -> Any {
        var request = URLRequest(url: components.url!); request.timeoutInterval = 25; request.setValue("CadenceMac/0.3 (personal macOS music workspace)", forHTTPHeaderField: "User-Agent")
        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if status == 204 { throw failure("ListenBrainz hasn’t generated recommendations yet. Add listening history and try again later.") }
        if status == 404 { throw failure("That ListenBrainz user wasn’t found. Check your username.") }
        if status == 429 { throw failure("ListenBrainz is busy. Please wait a little before refreshing.") }
        guard status == 200 else { throw failure("ListenBrainz couldn’t complete the request (\(status)). Please try again later.") }
        return try JSONSerialization.jsonObject(with: data)
    }
    func failure(_ message: String) -> NSError { NSError(domain: "Cadence", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }
    func recommendations(_ name: String) async throws -> [[String: Any]] {
        var url = URLComponents(string: "https://api.listenbrainz.org")!; url.path = "/1/cf/recommendation/user/\(name)/recording"; url.queryItems = [URLQueryItem(name: "count", value: "24")]
        let data = try await get(url) as? [String: Any]
        let ids = ((data?["payload"] as? [String: Any])?["mbids"] as? [[String: Any]] ?? []).compactMap { $0["recording_mbid"] as? String }
        if ids.isEmpty { throw failure("No recommendations yet. ListenBrainz needs more listening history first.") }
        try Task.checkCancellation()
        var meta = URLComponents(string: "https://api.listenbrainz.org/1/metadata/recording/")!
        meta.queryItems = [URLQueryItem(name: "recording_mbids", value: ids.joined(separator: ",")), URLQueryItem(name: "inc", value: "artist release")]
        let lookup = try await get(meta) as? [String: [String: Any]] ?? [:]
        let result: [[String: Any]] = ids.compactMap { id in
            guard let row = lookup[id], let rec = row["recording"] as? [String: Any], let title = rec["name"] as? String else { return nil }
            let artist = (row["artist"] as? [String: Any])?["name"] as? String ?? "Unknown artist"
            let release = row["release"] as? [String: Any] ?? [:]
            let caa = release["caa_release_mbid"] as? String
            return ["id": id, "title": title, "artist": artist, "album": release["name"] as? String ?? "", "art": caa.map { "https://coverartarchive.org/release/\($0)/front-250" } ?? ""]
        }
        guard !result.isEmpty else { throw failure("Recommendations arrived, but track details are temporarily unavailable.") }
        return result
    }
    func libraryRequest(_ request: [String: Any]) {
        guard let op = request["op"] as? String, ["inspect", "list-playlists", "create", "create-radio-playlist", "rename", "add-track", "remove-track", "move-track", "remove-library", "delete"].contains(op), !libraryScript.isEmpty else { return }
        guard !libraryBusy else { send("library-result", ["ok": false, "op": op, "message": "Another library request is still running."]); return }
        guard catalog?.url?.host == "music.youtube.com", !catalog.isLoading else { send("library-result", ["ok": false, "op": op, "message": "Wait for your music page to finish loading, then try again."]); return }
        if op != "create" && op != "create-radio-playlist" && op != "list-playlists" { guard let raw = request["url"] as? String, validatedMusicURL(raw) != nil else { return } }
        let run = { [weak self] in
            guard let self else { return }; self.libraryBusy = true
            self.catalog.callAsyncJavaScript(self.libraryScript, arguments: ["request": request], in: nil, in: .page) { result in
                self.libraryBusy = false
                switch result {
                case .success(let value): if let value = value as? [String: Any] { self.send("library-result", value) }
                case .failure: self.send("library-result", ["ok": false, "op": op, "message": "Couldn’t confirm the result. Refresh your library before retrying."])
                }
            }
        }
        if op == "delete" {
            let alert = NSAlert(); alert.messageText = "Delete playlist permanently?"
            alert.informativeText = "Delete \(request["title"] as? String ?? "this playlist") from your YouTube account? This deletes the playlist for everyone it was shared with. This cannot be undone in Cadence."
            alert.alertStyle = .warning; alert.addButton(withTitle: "Cancel"); alert.addButton(withTitle: "Delete playlist")
            alert.beginSheetModal(for: window) { response in if response == .alertSecondButtonReturn { run() } else { self.send("library-result", ["ok": false, "op": op, "message": "Deletion cancelled."]) } }
        } else { run() }
    }
    // Hearts on YouTube songs also like/unlike them in the signed-in YouTube Music account.
    func likeSong(id: String, liked: Bool) {
        guard !libraryScript.isEmpty, let catalog, catalog.url?.host == "music.youtube.com" else {
            send("like-result", ["ok": false, "id": id, "liked": liked, "message": "YouTube Music is still loading. Try the heart again shortly."]); return
        }
        catalog.callAsyncJavaScript(libraryScript, arguments: ["request": ["op": liked ? "like-song" : "unlike-song", "videoId": id]], in: nil, in: .page) { [weak self] result in
            var output: [String: Any] = ["ok": false, "message": "Couldn’t confirm the change with YouTube Music."]
            if case .success(let value) = result, let value = value as? [String: Any] { output = value }
            output["id"] = id; output["liked"] = liked
            self?.send("like-result", output)
        }
    }
    func validatedMusicURL(_ raw: String) -> URL? {
        guard let u = URL(string: raw), u.scheme == "https", u.host == "music.youtube.com",
              ["/", "/search", "/explore", "/library", "/playlist", "/new_releases"].contains(u.path) || (u.path.hasPrefix("/browse/") || u.path.hasPrefix("/channel/")) else { return nil }
        return u
    }
    func ensurePlayer() {
        guard youtube == nil else { return }
        let config = WKWebViewConfiguration(); config.websiteDataStore = .default(); config.mediaTypesRequiringUserActionForPlayback = []
        if !mediaSessionScript.isEmpty { config.userContentController.addUserScript(WKUserScript(source: mediaSessionScript, injectionTime: .atDocumentStart, forMainFrameOnly: true)) }
        config.userContentController.add(MediaSessionBridge { [weak self] command, position in self?.remote(command, position) }, name: "cadenceMedia")
        youtube = InternalServiceView(frame: NSRect(x: 0, y: 0, width: 1200, height: 800), configuration: config)
        youtube.customUserAgent = serviceUserAgent; youtube.navigationDelegate = self; youtube.uiDelegate = self
        window.contentView!.addSubview(youtube, positioned: .below, relativeTo: shell)
    }
    func ensureCatalog() {
        guard catalog == nil else { return }
        let config = WKWebViewConfiguration(); config.websiteDataStore = .default()
        catalog = InternalServiceView(frame: NSRect(x: 0, y: 0, width: 1400, height: 950), configuration: config)
        catalog.customUserAgent = serviceUserAgent; catalog.navigationDelegate = self; catalog.uiDelegate = self
        window.contentView!.addSubview(catalog, positioned: .below, relativeTo: shell)
    }
    func playVideo(id: String, url: URL, radio: Bool = false) {
        ensurePlayer()
        volumeDirty = true; playbackGeneration += 1; let generation = playbackGeneration
        if !loadedYouTube || youtube.isLoading || playbackScript.isEmpty {
            youtube.load(URLRequest(url: url)); loadedYouTube = true; return
        }
        let encoded = String(data: try! JSONSerialization.data(withJSONObject: [id]), encoding: .utf8)!
        let script = playbackScript.replacingOccurrences(of: "VIDEO_ID", with: String(encoded.dropFirst().dropLast())).replacingOccurrences(of: "FORCE_RADIO", with: radio ? "true" : "false")
        youtube?.evaluateJavaScript(script) { [weak self] result, _ in
            guard let self, self.playbackGeneration == generation else { return }
            if result as? Bool != true { self.youtube.load(URLRequest(url: url)); return }
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { [weak self] in
                guard let self, self.playbackGeneration == generation else { return }
                self.youtube?.evaluateJavaScript("new URL(location.href).searchParams.get('v') || document.querySelector('#movie_player')?.getVideoData?.().video_id") { value, _ in
                    guard self.playbackGeneration == generation else { return }
                    if value as? String != id { self.youtube.load(URLRequest(url: url)) }
                }
            }
        }
    }
    func bootCatalog() {
        ensureCatalog()
        if catalog.url == nil && !catalog.isLoading { catalog.load(URLRequest(url: URL(string: "https://music.youtube.com/")!)) }
    }
    // The data service is usable as soon as YouTube Music's config exists, long before the page finishes loading.
    func watchCatalogReady() {
        guard catalogReadyTimer == nil else { return }
        catalogReadyTimer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                guard self.catalogQueued != nil else { self.catalogReadyTimer?.invalidate(); self.catalogReadyTimer = nil; return }
                self.catalog.evaluateJavaScript("location.host==='music.youtube.com'&&!!window.ytcfg?.get?.('INNERTUBE_CONTEXT')?.client") { value, _ in
                    guard value as? Bool == true, let queued = self.catalogQueued else { return }
                    self.catalogReadyTimer?.invalidate(); self.catalogReadyTimer = nil
                    self.catalogQueued = nil; self.catalogBooted = true
                    self.debug("catalog engine usable \(Int(Date().timeIntervalSince(self.catalogStarted) * 1000))ms after request (still loading: \(self.catalog.isLoading))")
                    self.browseAPI(queued, version: self.catalogVersion)
                }
            }
        }
    }
    func prewarmPlayer() {
        guard youtube == nil else { return }
        ensurePlayer(); youtube.load(URLRequest(url: URL(string: "https://music.youtube.com/")!)); loadedYouTube = true
    }
    func debug(_ message: String) { if debugTiming { FileHandle.standardError.write(Data("[cadence] \(message)\n".utf8)) } }
    func loadCatalog(_ url: URL) {
        ensureCatalog()
        catalogTimer?.invalidate(); catalogPending = false; catalogQueued = nil
        catalogVersion += 1; catalogExpectedURL = url.absoluteString; catalogReported = false; catalogStarted = Date()
        send("catalog-loading", ["url": url.absoluteString])
        if browseScript.isEmpty { loadCatalogPage(url) }
        else if catalogBooted && !catalog.isLoading { browseAPI(url, version: catalogVersion) }
        else if catalog.isLoading || catalog.url == nil { catalogQueued = url; bootCatalog(); watchCatalogReady() }
        else { loadCatalogPage(url) } // The engine ended up somewhere else (e.g. a consent page): use the website.
    }
    // Reads a page through the data service; falls back to loading and scraping the website.
    func browseAPI(_ url: URL, version: Int, more token: String? = nil) {
        let started = Date()
        let request: [String: Any] = token.map { ["op": "more", "token": $0] } ?? ["op": "load", "url": url.absoluteString]
        catalog.callAsyncJavaScript(browseScript, arguments: ["request": request], in: nil, in: .page) { [weak self] result in
            guard let self, self.catalogVersion == version else { return }
            let ms = Int(Date().timeIntervalSince(started) * 1000)
            guard case .success(let value) = result, let output = value as? [String: Any] else {
                self.debug("api error \(url.absoluteString) \(ms)ms; falling back"); if token == nil { self.loadCatalogPage(url) }; return
            }
            guard output["ok"] as? Bool == true, var data = output["data"] as? [String: Any] else {
                let message = output["message"] as? String ?? ""
                self.debug("api failed \(url.absoluteString) \(ms)ms: \(message)")
                if token != nil { return }
                if output["empty"] as? Bool == true { self.send("catalog-error", message) } else { self.loadCatalogPage(url) }
                return
            }
            let sections = data["sections"] as? [[String: Any]] ?? []
            self.debug("api \(token == nil ? "page" : "more") \(url.absoluteString) \(ms)ms total=\(Int(Date().timeIntervalSince(self.catalogStarted) * 1000))ms sections=\(sections.count) items=\(sections.reduce(0) { $0 + (($1["items"] as? [Any])?.count ?? 0) })")
            data["requestURL"] = url.absoluteString; self.catalogReported = true
            self.send("catalog-result", data)
            if output["more"] as? Bool == true, let next = output["token"] as? String { self.browseAPI(url, version: version, more: next) }
        }
    }
    func loadCatalogPage(_ url: URL) {
        catalogTimer?.invalidate(); catalogLastSnapshot = ""; catalogStableCount = 0
        catalogPending = true; catalogReported = false; catalogStarted = Date(); catalogExpectedURL = url.absoluteString
        catalog.load(URLRequest(url: url))
        catalogTimer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in Task { @MainActor in self?.pollCatalog() } }
    }
    func pollCatalog() {
        guard catalogPending, !catalogPolling, !catalog.isLoading, !catalogScript.isEmpty else { return }
        catalogPolling = true; let version = catalogVersion
        catalog.evaluateJavaScript(catalogScript) { [weak self] result, error in
            guard let self else { return }; self.catalogPolling = false
            guard self.catalogVersion == version else { return }
            if let data = result as? [String: Any], let groups = data["sections"] as? [[String: Any]], (!groups.isEmpty || !(data["title"] as? String ?? "").isEmpty) {
                let fingerprint = (try? JSONSerialization.data(withJSONObject: data, options: [.sortedKeys])).flatMap { String(data: $0, encoding: .utf8) } ?? ""
                if !self.catalogReported { self.debug("website page \(self.catalogExpectedURL) total=\(Int(Date().timeIntervalSince(self.catalogStarted) * 1000))ms sections=\(groups.count)") }
                if fingerprint == self.catalogLastSnapshot { self.catalogStableCount += 1 } else { self.catalogStableCount = 0 }; if fingerprint != self.catalogLastSnapshot { self.catalogLastSnapshot = fingerprint; var output = data; output["requestURL"] = self.catalogExpectedURL; self.send("catalog-result", output) }
                self.catalogReported = true
                // A second pass captures deferred sections/artwork, without blocking initial results.
                if self.catalogStableCount >= 2 || Date().timeIntervalSince(self.catalogStarted) > 3 { self.catalogPending = false; self.catalogTimer?.invalidate() }
            } else if Date().timeIntervalSince(self.catalogStarted) > 22 {
                self.catalogPending = false; self.catalogTimer?.invalidate()
                if !self.catalogReported { self.send("catalog-error", "No music loaded for this page. Your library may need sign-in, or YouTube may have changed this page. Use Account to sign in, then refresh.") }
            }
        }
    }
    func openAccount() {
        if accountWindow == nil {
            let config = WKWebViewConfiguration(); config.websiteDataStore = .default()
            let view = WKWebView(frame: NSRect(x: 0, y: 0, width: 900, height: 700), configuration: config)
            view.customUserAgent = serviceUserAgent; view.navigationDelegate = self; view.uiDelegate = self
            let account = NSWindow(contentRect: view.frame, styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
            account.isReleasedWhenClosed = false; account.title = "YouTube Music account • close this window when signed in"; account.contentView = view; account.center()
            accountWindow = account
            view.load(URLRequest(url: URL(string: "https://music.youtube.com/")!))
        }
        accountWindow?.makeKeyAndOrderFront(nil)
    }
    func observe(_ value: [String: Any]) {
        guard let source = value["source"] as? String, let id = value["id"] as? String,
              let title = value["title"] as? String, let artist = value["artist"] as? String,
              let duration = value["duration"] as? Double, let position = value["position"] as? Double,
              let url = value["url"] as? String, let parsed = URL(string: url), parsed.scheme == "https",
              (source == "youtube" && parsed.host == "music.youtube.com") || (source == "soundcloud" && parsed.host == "soundcloud.com") else { return }
        history.observe(PlaybackSample(source: source, id: String(id.prefix(300)), title: String(title.prefix(500)), artist: String(artist.prefix(500)), album: String((value["album"] as? String ?? "").prefix(500)), url: String(url.prefix(1000)), duration: duration, position: position, playing: value["playing"] as? Bool ?? false, eligible: value["eligible"] as? Bool ?? false))
    }
    func updateTrack() {
        guard loadedYouTube, !sampling, !sampleScript.isEmpty else { return }
        sampling = true; let volumeSent = desiredVolume
        youtube?.evaluateJavaScript("(()=>{const v=document.querySelector('video');if(v){if(\(volumeDirty ? "true" : "false")){const p=document.querySelector('#movie_player');if(p?.setVolume)p.setVolume(\(desiredVolume*100));else v.volume=\(desiredVolume);}v.loop=\(repeatOne ? "true" : "false")&&!document.querySelector('.ad-showing, .ad-interrupting');}})();" + sampleScript) { [weak self] result, _ in
            guard let self else { return }; self.sampling = false
            if let track = result as? [String: Any] { if track["hasMedia"] as? Bool == true && self.desiredVolume == volumeSent { self.volumeDirty = false }; self.send("track", track)
                if Date().timeIntervalSince(self.lastHistorySample) >= 1.4 { self.lastHistorySample = Date(); self.observe(track); self.history.tick() } }
        }
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if webView === catalog {
            catalogBooted = webView.url?.host == "music.youtube.com"
            if let queued = catalogQueued {
                catalogQueued = nil
                debug("catalog engine ready \(Int(Date().timeIntervalSince(catalogStarted) * 1000))ms after request")
                if catalogBooted { browseAPI(queued, version: catalogVersion) } else { loadCatalogPage(queued) }
            }
            pollCatalog()
        }
        if webView === youtube { volumeDirty = true; updateTrack() }
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if webView === catalog, (error as NSError).code != NSURLErrorCancelled { send("catalog-error", "Couldn’t load music. Check your connection and try again."); catalogPending = false; catalogQueued = nil }
        if webView === youtube, (error as NSError).code != NSURLErrorCancelled { send("notice", "YouTube Music couldn’t load. Check your connection, or use Account to sign in.") }
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let u = navigationAction.request.url else { decisionHandler(.cancel); return }
        if webView === shell {
            if navigationAction.targetFrame?.isMainFrame == true && !u.isFileURL { decisionHandler(.cancel); return }
            decisionHandler(.allow); return
        }
        let host = u.host ?? ""
        if u.scheme == "https" && (host == "youtube.com" || host.hasSuffix(".youtube.com") || host == "accounts.google.com" || host == "consent.google.com" || host == "consent.youtube.com") { decisionHandler(.allow) }
        else if u.absoluteString == "about:blank" { decisionHandler(.allow) }
        else { decisionHandler(.cancel) }
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url, url.scheme == "https" { NSWorkspace.shared.open(url) }; return nil
    }
}
let app = NSApplication.shared
let delegate = App()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
