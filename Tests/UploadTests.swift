import Cocoa
final class Stub: URLProtocol {
    static var status = 200
    static var requests: [URLRequest] = []
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Stub.requests.append(request)
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: Stub.status, httpVersion: nil, headerFields: ["Retry-After":"120"])!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data("{\"status\":\"ok\"}".utf8)); client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
@main struct Tests {
    @MainActor static func main() async throws {
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [Stub.self]
        let session = URLSession(configuration: config)
        let suite = "local.cadence.tests.\(UUID().uuidString)"; let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite); session.invalidateAndCancel() }
        let listen = Listen(id: UUID(), user: "test", startedAt: 1_800_000_000, source: "youtube", title: "Test track", artist: "Test artist", album: "", url: "https://music.youtube.com/watch?v=test", duration: 100)
        func seed() throws {
            defaults.set("test", forKey: "history.user");defaults.set(true, forKey: "history.enabled")
            defaults.set(try JSONEncoder().encode([listen]), forKey: "history.pending")
        }
        try seed()
        let accepted = HistoryService(defaults: defaults, session: session, tokenProvider: {"test-token"}, tokenRemover: {true})
        accepted.tick();try await Task.sleep(nanoseconds: 150_000_000)
        assert(accepted.state()["pending"] as? Int == 0)
        assert(Stub.requests.last?.url?.absoluteString == "https://api.listenbrainz.org/1/submit-listens")
        assert(Stub.requests.last?.httpMethod == "POST")
        assert(Stub.requests.last?.value(forHTTPHeaderField: "Authorization") == "Token test-token")
        try seed();Stub.status=429
        let limited=HistoryService(defaults:defaults,session:session,tokenProvider:{"test-token"}, tokenRemover:{true})
        limited.tick();try await Task.sleep(nanoseconds:150_000_000)
        assert(limited.state()["pending"] as? Int == 1)
        let count=Stub.requests.count;limited.tick();try await Task.sleep(nanoseconds:50_000_000);assert(Stub.requests.count==count)
        limited.setEnabled(false);limited.tick();assert(limited.state()["pending"] as? Int == 1)
        limited.disconnect();assert(limited.state()["pending"] as? Int == 0 && limited.state()["enabled"] as? Bool == false)
        try seed();Stub.status=401
        let rejected=HistoryService(defaults:defaults,session:session,tokenProvider:{"test-token"},tokenRemover:{true})
        rejected.tick();try await Task.sleep(nanoseconds:150_000_000)
        assert(rejected.state()["enabled"] as? Bool == false && rejected.state()["pending"] as? Int == 1)
        print("PASS: authenticated submission, accepted queue removal, rate-limit backoff, pause, disconnect, rejected credentials. All HTTP requests intercepted locally; no listens uploaded.")
    }
}
