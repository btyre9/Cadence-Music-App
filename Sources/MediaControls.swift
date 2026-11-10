import Cocoa
import MediaPlayer
import WebKit

// Keyboard media keys, AirPods, and Control Center.
// Commands are handed to the interface, which owns the queue, so they behave exactly like the footer buttons.
final class MediaControls {
    static let artworkHosts = ["googleusercontent.com", "ytimg.com", "sndcdn.com"]
    var onCommand: ((String, Double?) -> Void)?
    private var info: [String: Any] = [:]
    private var artworkURL = ""
    private var artwork: MPMediaItemArtwork?
    private var artworkTask: Task<Void, Never>?

    func start() {
        let center = MPRemoteCommandCenter.shared()
        let commands: [(MPRemoteCommand, String)] = [
            (center.playCommand, "play"), (center.pauseCommand, "pause"), (center.togglePlayPauseCommand, "toggle"),
            (center.nextTrackCommand, "next"), (center.previousTrackCommand, "previous")
        ]
        for (command, name) in commands {
            command.isEnabled = true
            command.addTarget { [weak self] _ in
                guard let self, self.onCommand != nil else { return .noActionableNowPlayingItem }
                DispatchQueue.main.async { self.onCommand?(name, nil) }
                return .success
            }
        }
        center.changePlaybackPositionCommand.isEnabled = false
        center.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let self, let event = event as? MPChangePlaybackPositionCommandEvent, event.positionTime.isFinite, event.positionTime >= 0 else { return .commandFailed }
            let seconds = event.positionTime
            DispatchQueue.main.async { self.onCommand?("seek", seconds) }
            return .success
        }
        // Only show controls Cadence actually supports.
        for command in [center.stopCommand, center.skipForwardCommand, center.skipBackwardCommand, center.seekForwardCommand, center.seekBackwardCommand,
                        center.changePlaybackRateCommand, center.changeRepeatModeCommand, center.changeShuffleModeCommand,
                        center.likeCommand, center.dislikeCommand, center.bookmarkCommand, center.ratingCommand] {
            command.isEnabled = false
        }
    }

    // Called by the interface when the song, play state, or position changes (it skips unchanged updates).
    func update(title: String, artist: String, album: String, duration: Double, position: Double, playing: Bool, art: String, canSeek: Bool) {
        var next: [String: Any] = [
            MPMediaItemPropertyTitle: title,
            MPMediaItemPropertyArtist: artist,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: duration > 0 ? min(position, duration) : position,
            MPNowPlayingInfoPropertyPlaybackRate: playing ? 1.0 : 0.0,
            MPNowPlayingInfoPropertyDefaultPlaybackRate: 1.0,
            MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.audio.rawValue
        ]
        if !album.isEmpty { next[MPMediaItemPropertyAlbumTitle] = album }
        if duration > 0 { next[MPMediaItemPropertyPlaybackDuration] = duration }
        if art == artworkURL, let artwork { next[MPMediaItemPropertyArtwork] = artwork }
        info = next
        let center = MPNowPlayingInfoCenter.default()
        center.nowPlayingInfo = next
        center.playbackState = playing ? .playing : .paused
        MPRemoteCommandCenter.shared().changePlaybackPositionCommand.isEnabled = canSeek && duration > 0
        if art != artworkURL { loadArtwork(art) }
    }

    private func loadArtwork(_ raw: String) {
        artworkURL = raw; artwork = nil; artworkTask?.cancel(); artworkTask = nil
        guard let url = URL(string: raw), url.scheme == "https", let host = url.host,
              Self.artworkHosts.contains(where: { host == $0 || host.hasSuffix("." + $0) }) else { return }
        artworkTask = Task { @MainActor [weak self] in
            guard let result = try? await URLSession.shared.data(from: url) else { return }
            let (data, response) = result
            guard (response as? HTTPURLResponse)?.statusCode == 200, data.count < 5_000_000, let image = NSImage(data: data),
                  let self, !Task.isCancelled, self.artworkURL == raw else { return }
            let artwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
            self.artwork = artwork
            self.info[MPMediaItemPropertyArtwork] = artwork
            MPNowPlayingInfoCenter.default().nowPlayingInfo = self.info
        }
    }
}

// If WebKit hands a media key to the YouTube page itself, media-session-bridge.js sends it here
// so it still goes through Cadence's queue instead of YouTube's.
final class MediaSessionBridge: NSObject, WKScriptMessageHandler {
    let onCommand: (String, Double?) -> Void
    init(onCommand: @escaping (String, Double?) -> Void) { self.onCommand = onCommand }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        let origin = message.frameInfo.securityOrigin
        guard message.frameInfo.isMainFrame, origin.protocol == "https", origin.host == "music.youtube.com",
              let body = message.body as? [String: Any], let command = body["command"] as? String,
              ["play", "pause", "next", "previous", "seek"].contains(command) else { return }
        let position = body["position"] as? Double
        if command == "seek" { guard let position, position.isFinite, position >= 0 else { return } }
        onCommand(command, command == "seek" ? position : nil)
    }
}
