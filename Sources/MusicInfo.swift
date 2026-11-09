import Foundation

@MainActor final class MusicInfo {
    private var cache: [String: [[String: String]]] = [:]
    private var nextRequest = Date.distantPast
    static func normalized(_ value: String) -> String {
        value.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "en_US_POSIX")).unicodeScalars.filter { CharacterSet.alphanumerics.contains($0) }.map(String.init).joined()
    }
    static func matches(_ rows: [[String: Any]], title: String, artist: String, kind: String) -> [[String: String]] {
        var result: [[String: String]] = []; var seen = Set<String>()
        for row in rows {
            guard let name = row["title"] as? String, normalized(name) == normalized(title),
                  let credits = row["artist-credit"] as? [[String: Any]],
                  let date = row["first-release-date"] as? String, !date.isEmpty,
                  date.range(of: "^[0-9]{4}(-[0-9]{2})?(-[0-9]{2})?$", options: .regularExpression) != nil,
                  let id = row["id"] as? String, UUID(uuidString: id) != nil else { continue }
            let names = credits.compactMap { $0["name"] as? String ?? ($0["artist"] as? [String: Any])?["name"] as? String }
            let joined = credits.map { (($0["name"] as? String) ?? (($0["artist"] as? [String: Any])?["name"] as? String) ?? "") + ($0["joinphrase"] as? String ?? "") }.joined()
            guard normalized(joined) == normalized(artist) || names.contains(where: { normalized($0) == normalized(artist) }) else { continue }
            let note = row["disambiguation"] as? String ?? ""
            let key = date + "|" + note
            guard seen.insert(key).inserted else { continue }
            result.append(["title": name, "artist": joined, "date": date, "note": note, "url": "https://musicbrainz.org/\(kind == "album" ? "release-group" : "recording")/\(id)"])
        }
        return Array(result.prefix(5))
    }
    func lookup(title: String, artist: String, kind: String) async throws -> [[String: String]] {
        let key = kind + "|" + title + "|" + artist
        if let value = cache[key] { return value }
        let delay = nextRequest.timeIntervalSinceNow
        nextRequest = max(Date(), nextRequest).addingTimeInterval(1.1)
        if delay > 0 { try await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000)) }
        try Task.checkCancellation()
        let entity = kind == "album" ? "release-group" : "recording"
        // Quote query values so punctuation cannot turn a title into query operators.
        func quoted(_ s: String) -> String { "\"" + s.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"") + "\"" }
        var components = URLComponents(string: "https://musicbrainz.org/ws/2/\(entity)/")!
        components.queryItems = [URLQueryItem(name: "query", value: "\(kind == "album" ? "releasegroup" : "recording"):\(quoted(title)) AND artist:\(quoted(artist))"), URLQueryItem(name: "fmt", value: "json"), URLQueryItem(name: "limit", value: "15")]
        var request = URLRequest(url: components.url!); request.timeoutInterval = 18
        request.setValue("CadenceMac/0.5 (personal macOS music metadata client)", forHTTPHeaderField: "User-Agent")
        let (data, response) = try await URLSession.shared.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
        let root = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
        let value = Self.matches(root[kind == "album" ? "release-groups" : "recordings"] as? [[String: Any]] ?? [], title: title, artist: artist, kind: kind)
        if cache.count >= 100 { cache.removeAll() }; cache[key] = value
        return value
    }
}
