import Cocoa

// A small floating player. It opens when the main window is closed (music keeps playing)
// and from Window ▸ Mini Player. Its buttons work like the footer buttons and media keys.
final class MiniPlayer: NSObject, NSWindowDelegate {
    var onCommand: ((String) -> Void)?
    var onOpenMain: (() -> Void)?
    private var panel: NSPanel?
    private let artwork = NSImageView()
    private let titleLabel = NSTextField(labelWithString: "")
    private let artistLabel = NSTextField(labelWithString: "")
    private let progress = NSProgressIndicator()
    private var playButton: NSButton?
    private var state = NowPlayingState()
    private var timer: Timer?

    var isVisible: Bool { panel?.isVisible == true }

    func show() {
        if panel == nil { build() }
        render()
        panel?.orderFrontRegardless()
        startTimer()
    }
    func close() { panel?.close() }
    func toggle() { if isVisible { close() } else { show() } }

    func update(_ newState: NowPlayingState) {
        state = newState
        if isVisible { render() }
    }

    func windowWillClose(_ notification: Notification) { timer?.invalidate(); timer = nil }

    private func symbol(_ name: String, _ label: String) -> NSImage {
        NSImage(systemSymbolName: name, accessibilityDescription: label) ?? NSImage()
    }

    private func makeButton(_ name: String, _ label: String, _ action: Selector, frame: NSRect) -> NSButton {
        let button = NSButton(image: symbol(name, label), target: self, action: action)
        button.frame = frame; button.isBordered = false; button.toolTip = label
        button.imageScaling = .scaleProportionallyDown; button.setAccessibilityLabel(label)
        return button
    }

    private func build() {
        let panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 340, height: 96),
                            styleMask: [.titled, .closable, .utilityWindow, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.title = "Cadence"
        panel.isFloatingPanel = true; panel.level = .floating; panel.hidesOnDeactivate = false; panel.isReleasedWhenClosed = false
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.delegate = self
        if !panel.setFrameUsingName("CadenceMiniPlayer"), let screen = NSScreen.main?.visibleFrame {
            panel.setFrameTopLeftPoint(NSPoint(x: screen.maxX - panel.frame.width - 20, y: screen.maxY - 20))
        }
        panel.setFrameAutosaveName("CadenceMiniPlayer")
        guard let view = panel.contentView else { return }

        artwork.frame = NSRect(x: 14, y: 16, width: 64, height: 64)
        artwork.imageScaling = .scaleProportionallyUpOrDown
        artwork.wantsLayer = true; artwork.layer?.cornerRadius = 6; artwork.layer?.masksToBounds = true
        artwork.setAccessibilityLabel("Artwork")

        titleLabel.frame = NSRect(x: 90, y: 62, width: 236, height: 18)
        titleLabel.font = .systemFont(ofSize: 13, weight: .semibold); titleLabel.lineBreakMode = .byTruncatingTail
        artistLabel.frame = NSRect(x: 90, y: 45, width: 236, height: 16)
        artistLabel.font = .systemFont(ofSize: 11); artistLabel.textColor = .secondaryLabelColor; artistLabel.lineBreakMode = .byTruncatingTail

        progress.frame = NSRect(x: 90, y: 36, width: 236, height: 6)
        progress.style = .bar; progress.isIndeterminate = false; progress.controlSize = .small
        progress.minValue = 0; progress.maxValue = 1
        progress.setAccessibilityLabel("Song progress")

        let previous = makeButton("backward.fill", "Previous track", #selector(previousTrack), frame: NSRect(x: 88, y: 6, width: 34, height: 26))
        let play = makeButton("play.fill", "Play", #selector(togglePlayback), frame: NSRect(x: 124, y: 6, width: 38, height: 26))
        let next = makeButton("forward.fill", "Next track", #selector(nextTrack), frame: NSRect(x: 164, y: 6, width: 34, height: 26))
        let open = makeButton("macwindow", "Open the Cadence window", #selector(openMain), frame: NSRect(x: 294, y: 6, width: 32, height: 26))
        playButton = play

        for subview in [artwork, titleLabel, artistLabel, progress, previous, play, next, open] as [NSView] { view.addSubview(subview) }
        self.panel = panel
    }

    private func render() {
        let empty = state.title.isEmpty
        titleLabel.stringValue = empty ? "Nothing playing" : state.title
        artistLabel.stringValue = empty ? "Choose a song in Cadence" : state.artist
        artwork.image = state.image ?? symbol("music.note", "No artwork")
        let label = state.playing ? "Pause" : "Play"
        playButton?.image = symbol(state.playing ? "pause.fill" : "play.fill", label)
        playButton?.toolTip = label; playButton?.setAccessibilityLabel(label)
        panel?.title = empty ? "Cadence" : "\(state.title) · Cadence"
        renderProgress()
    }

    private func renderProgress() {
        guard state.duration > 0 else { progress.doubleValue = 0; return }
        let elapsed = state.position + (state.playing ? Date().timeIntervalSince(state.updatedAt) : 0)
        progress.doubleValue = min(1, max(0, elapsed / state.duration))
    }

    private func startTimer() {
        guard timer == nil else { return }
        timer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in Task { @MainActor in self?.renderProgress() } }
    }

    @objc private func previousTrack() { onCommand?("previous") }
    @objc private func togglePlayback() { onCommand?("toggle") }
    @objc private func nextTrack() { onCommand?("next") }
    @objc private func openMain() { onOpenMain?() }
}
