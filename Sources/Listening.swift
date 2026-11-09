import Foundation

struct PlaybackSample {
    let source: String
    let id: String
    let title: String
    let artist: String
    let album: String
    let url: String
    let duration: Double
    let position: Double
    let playing: Bool
    let eligible: Bool
}
struct Listen: Codable {
    let id: UUID
    let user: String
    let startedAt: Int
    let source: String
    let title: String
    let artist: String
    let album: String
    let url: String
    let duration: Double
    var payload: [String: Any] {
        var metadata: [String: Any] = ["track_name": title, "artist_name": artist,
            "additional_info": ["submission_client": "Cadence", "submission_client_version": "0.2", "music_service": source == "youtube" ? "youtube.com" : "soundcloud.com", "origin_url": url, "duration_ms": Int(duration * 1000)]]
        if !album.isEmpty { metadata["release_name"] = album }
        return ["listened_at": startedAt, "track_metadata": metadata]
    }
}
struct ListeningTracker: Codable {
    struct Session: Codable {
        var identity: String
        var position: Double
        var wall: Double
        var playing: Bool
        var listened: Double
        var startedAt: Int
        var submitted: Bool
    }
    var sessions: [String: Session] = [:]
    mutating func observe(_ sample: PlaybackSample, user: String, now: Double) -> Listen? {
        guard ["youtube", "soundcloud"].contains(sample.source), sample.eligible,
              !sample.id.isEmpty, !sample.title.isEmpty, !sample.artist.isEmpty,
              sample.duration.isFinite, sample.duration >= 30,
              sample.position.isFinite, sample.position >= 0, sample.position <= sample.duration + 2 else {
            // Ads, missing metadata and unsupported media must break continuity.
            if var current = sessions[sample.source] { current.playing = false; current.wall = now; sessions[sample.source] = current }
            return nil
        }
        if sessions[sample.source] == nil && !sample.playing { return nil }
        let identity = sample.id + "|" + sample.title + "|" + sample.artist
        var session = sessions[sample.source]
        // A completed play wrapping from the end to the start is a genuine repeat.
        if let previous = session, previous.submitted,
           previous.position > sample.duration - 6, sample.position < 5,
           now - previous.wall < 6 { session = nil }
        if session?.identity != identity {
            session = Session(identity: identity, position: sample.position, wall: now, playing: sample.playing, listened: 0, startedAt: Int(now), submitted: false)
        }
        var current = session!
        let elapsed = now - current.wall
        let progress = sample.position - current.position
        // Never count seeks, buffering, paused time, sleep, or long sampling gaps.
        if current.playing && sample.playing && elapsed > 0 && elapsed <= 5 && progress > 0 && progress <= elapsed + 0.75 {
            current.listened += min(elapsed, progress)
        }
        current.wall = now; current.position = sample.position; current.playing = sample.playing
        let qualifies = !current.submitted && current.listened >= min(sample.duration / 2, 240)
        if qualifies { current.submitted = true }
        sessions[sample.source] = current
        guard qualifies else { return nil }
        return Listen(id: UUID(), user: user, startedAt: current.startedAt, source: sample.source, title: sample.title, artist: sample.artist, album: sample.album, url: sample.url, duration: sample.duration)
    }
}
