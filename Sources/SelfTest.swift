import Cocoa
import WebKit

// Developer check, off unless CADENCE_SELFTEST is set: browses a fixed set of pages (read-only,
// no playback or account changes), logs timings with CADENCE_DEBUG, and saves window snapshots
// to CADENCE_SELFTEST_DIR. CADENCE_LEGACY=1 forces the old website-scraping path for comparison.
extension App {
    func startSelfTestIfRequested() {
        let env = ProcessInfo.processInfo.environment
        if env["CADENCE_LEGACY"] != nil { browseScript = "" }
        // CADENCE_APPEARANCE=light|dark previews one palette regardless of the system setting.
        if let look = env["CADENCE_APPEARANCE"] { window.appearance = NSAppearance(named: look == "dark" ? .darkAqua : .aqua) }
        guard env["CADENCE_SELFTEST"] != nil else { return }
        let dir = URL(fileURLWithPath: env["CADENCE_SELFTEST_DIR"] ?? NSTemporaryDirectory())
        let steps: [(String, String)] = [
            ("home", ""),
            ("search", "search('radiohead')"),
            ("album", "openItem(catalogData.sections.flatMap(s=>s.items).find(i=>i.kind==='album'))"),
            ("playlist", "catalogLabel='Large playlist';browse('https://music.youtube.com/playlist?list=PLwNv9Hhd8gZjNoQdpd2kBa3fwXNeJjzDX')"),
            ("library", "navigate('library')"),
            ("explore", "navigate('youtube')"),
            ("back-to-search", "search('radiohead')"),
            ("discover", "navigate('discover')"),
            ("connections", "navigate('settings')"),
        ]
        func run(_ index: Int) {
            guard index < steps.count else { debug("selftest done"); NSApp.terminate(nil); return }
            let (name, script) = steps[index]
            if !script.isEmpty { debug("selftest step \(name)"); shell.evaluateJavaScript(script, completionHandler: nil) }
            DispatchQueue.main.asyncAfter(deadline: .now() + (name == "playlist" ? 9 : 6)) { [weak self] in
                guard let self else { return }
                self.shell.evaluateJavaScript("JSON.stringify({state:document.getElementById('catalog-state').textContent,title:document.getElementById('catalog-title').textContent,rows:document.querySelectorAll('.song-row').length,cards:document.querySelectorAll('.catalog-card').length})") { value, _ in
                    self.debug("selftest \(name) rendered \(value as? String ?? "?")")
                }
                self.shell.takeSnapshot(with: nil) { image, _ in
                    if let tiff = image?.tiffRepresentation, let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) {
                        try? png.write(to: dir.appendingPathComponent("\(index)-\(name).png"))
                    }
                    run(index + 1)
                }
            }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) { run(0) }
    }
}
