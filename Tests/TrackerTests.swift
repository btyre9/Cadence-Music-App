import Foundation
@main struct Tests {
    static func main() throws {
        func sample(_ position: Double, duration: Double = 100, playing: Bool = true, eligible: Bool = true, id: String = "one", artist: String = "Artist", source: String = "youtube") -> PlaybackSample {
            PlaybackSample(source: source, id: id, title: "Track", artist: artist, album: "Album", url: "https://music.youtube.com/watch?v=one", duration: duration, position: position, playing: playing, eligible: eligible)
        }
        var tracker = ListeningTracker(); var listens: [Listen] = []
        for i in 0...99 { if let l = tracker.observe(sample(Double(i)), user: "test", now: 1_800_000_000 + Double(i)) { listens.append(l) } }
        assert(listens.count == 1, "One completed play must submit once")
        assert(listens[0].startedAt == 1_800_000_000)
        // Restart keeps the submitted marker and avoids duplicating the current play.
        tracker = try JSONDecoder().decode(ListeningTracker.self, from: JSONEncoder().encode(tracker))
        assert(tracker.observe(sample(99.5), user: "test", now: 1_800_000_099.5) == nil)
        // A complete replay is a new listen, with a new timestamp.
        var replay: Listen?
        for i in 0...60 { if let l = tracker.observe(sample(Double(i)), user: "test", now: 1_800_000_100 + Double(i)) { replay = l } }
        assert(replay != nil && replay!.startedAt == 1_800_000_100)
        var seek = ListeningTracker()
        _ = seek.observe(sample(0), user: "test", now: 1000)
        assert(seek.observe(sample(90), user: "test", now: 1001) == nil)
        assert(seek.sessions["youtube"]!.listened == 0, "Seeking must not count as listening")
        _ = seek.observe(sample(90, playing: false), user: "test", now: 1002)
        _ = seek.observe(sample(90, playing: false), user: "test", now: 1100)
        assert(seek.sessions["youtube"]!.listened == 0, "Paused time must not count")
        _ = seek.observe(sample(90), user: "test", now: 1101)
        _ = seek.observe(sample(91), user: "test", now: 1500)
        assert(seek.sessions["youtube"]!.listened == 0, "Sleep must not count")
        var invalid = ListeningTracker()
        for i in 0...99 { assert(invalid.observe(sample(Double(i), eligible: false), user: "test", now: Double(i)) == nil) }
        assert(invalid.observe(sample(0, duration: 29), user: "test", now: 1) == nil)
        assert(invalid.observe(sample(0, artist: ""), user: "test", now: 1) == nil)
        assert(invalid.observe(sample(.nan), user: "test", now: 1) == nil)
        assert(invalid.sessions.isEmpty)
        var long = ListeningTracker(); var longListens = 0
        for i in 0...300 { if long.observe(sample(Double(i), duration: 1000, source: "soundcloud"), user: "test", now: Double(i)) != nil { assert(i == 240); longListens += 1 } }
        assert(longListens == 1, "Long tracks count at four minutes")
        _ = long.observe(sample(0, duration: 30, eligible: false, source: "soundcloud"), user: "test", now: 301)
        assert(long.sessions["soundcloud"]!.submitted, "Ads must not erase the already-submitted marker")
        let payload = listens[0].payload
        assert(payload["listened_at"] as? Int == 1_800_000_000)
        let metadata = payload["track_metadata"] as! [String: Any]
        assert(metadata["artist_name"] as? String == "Artist")
        assert((metadata["additional_info"] as! [String: Any])["duration_ms"] as? Int == 100000)
        print("PASS: thresholds, repeat plays, duplicate protection, restart persistence, seeks, pause, sleep, ads, missing metadata, short tracks, and ListenBrainz payload")
    }
}
