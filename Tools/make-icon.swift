// Draws Cadence's app icon and writes Assets/AppIcon.icns (plus a 1024px preview PNG).
// Run from the project folder: swift Tools/make-icon.swift
// Design: the app's ◉ mark opened into a "C" ring, with rhythm bars leaving the opening.
import AppKit

func color(_ hex: UInt32, _ alpha: CGFloat = 1) -> CGColor {
    CGColor(srgbRed: CGFloat((hex >> 16) & 0xff) / 255, green: CGFloat((hex >> 8) & 0xff) / 255, blue: CGFloat(hex & 0xff) / 255, alpha: alpha)
}
let space = CGColorSpace(name: CGColorSpace.sRGB)!
func gradient(_ colors: [CGColor], _ stops: [CGFloat]) -> CGGradient { CGGradient(colorsSpace: space, colors: colors as CFArray, locations: stops)! }

// Fills the current path's outline with a gradient running from `from` to `to`.
func strokeGradient(_ c: CGContext, _ path: CGPath, width: CGFloat, _ g: CGGradient, from: CGPoint, to: CGPoint) {
    c.saveGState(); c.addPath(path); c.setLineWidth(width); c.setLineCap(.round)
    c.replacePathWithStrokedPath(); c.clip(); c.drawLinearGradient(g, start: from, end: to, options: [.drawsBeforeStartLocation, .drawsAfterEndLocation]); c.restoreGState()
}

func render(_ size: Int) -> Data {
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState(); NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    let c = NSGraphicsContext.current!.cgContext
    c.scaleBy(x: CGFloat(size) / 1024, y: CGFloat(size) / 1024)
    c.setShouldAntialias(true); c.interpolationQuality = .high

    // macOS icon grid: 824pt rounded square centred on a 1024 canvas, with a soft drop shadow.
    let tile = CGPath(roundedRect: CGRect(x: 100, y: 100, width: 824, height: 824), cornerWidth: 186, cornerHeight: 186, transform: nil)
    c.saveGState(); c.setShadow(offset: CGSize(width: 0, height: -14), blur: 30, color: color(0x000000, 0.38))
    c.addPath(tile); c.setFillColor(color(0x1b0d2b)); c.fillPath(); c.restoreGState()

    c.saveGState(); c.addPath(tile); c.clip()
    // Deep plum background with a warm glow behind the ring.
    c.drawLinearGradient(gradient([color(0x35144a), color(0x1c0b2c), color(0x0e0618)], [0, 0.55, 1]), start: CGPoint(x: 180, y: 924), end: CGPoint(x: 844, y: 100), options: [])
    c.drawRadialGradient(gradient([color(0xdb447e, 0.55), color(0xdb447e, 0)], [0, 1]), startCenter: CGPoint(x: 470, y: 540), startRadius: 0, endCenter: CGPoint(x: 470, y: 540), endRadius: 430, options: [])

    let center = CGPoint(x: 470, y: 512)
    let warm = gradient([color(0xff5f9e), color(0xdb447e), color(0xff9152)], [0, 0.5, 1])
    // Faint full groove, like a record, behind the main ring.
    let groove = CGMutablePath(); groove.addArc(center: center, radius: 300, startAngle: 0, endAngle: .pi * 2, clockwise: false)
    c.saveGState(); c.addPath(groove); c.setLineWidth(6); c.setStrokeColor(color(0xffffff, 0.08)); c.strokePath(); c.restoreGState()
    // The "C": a thick ring opened toward the right.
    let ring = CGMutablePath(); ring.addArc(center: center, radius: 236, startAngle: .pi * 0.23, endAngle: -.pi * 0.23, clockwise: false)
    c.saveGState(); c.setShadow(offset: .zero, blur: 40, color: color(0xff4f8f, 0.6))
    strokeGradient(c, ring, width: 78, warm, from: CGPoint(x: 260, y: 760), to: CGPoint(x: 700, y: 260)); c.restoreGState()
    // Inner ring, thinner and quieter.
    let inner = CGMutablePath(); inner.addArc(center: center, radius: 132, startAngle: .pi * 0.32, endAngle: -.pi * 0.32, clockwise: false)
    strokeGradient(c, inner, width: 26, gradient([color(0xffffff, 0.75), color(0xffc2d9, 0.35)], [0, 1]), from: CGPoint(x: 360, y: 640), to: CGPoint(x: 560, y: 380))
    // Centre dot from the ◉ mark.
    c.saveGState(); c.setShadow(offset: .zero, blur: 24, color: color(0xff7aa8, 0.8))
    c.addEllipse(in: CGRect(x: center.x - 52, y: center.y - 52, width: 104, height: 104)); c.clip()
    c.drawRadialGradient(gradient([color(0xffffff), color(0xffd0e1), color(0xff6f9f)], [0, 0.45, 1]), startCenter: CGPoint(x: center.x - 18, y: center.y + 20), startRadius: 0, endCenter: center, endRadius: 56, options: [.drawsAfterEndLocation])
    c.restoreGState()
    // Rhythm bars leaving the opening.
    for (x, h) in [(716.0, 136.0), (774.0, 238.0), (832.0, 104.0)] as [(CGFloat, CGFloat)] {
        let bar = CGMutablePath(); bar.move(to: CGPoint(x: x, y: 512 - h / 2)); bar.addLine(to: CGPoint(x: x, y: 512 + h / 2))
        strokeGradient(c, bar, width: 34, warm, from: CGPoint(x: x, y: 512 + 130), to: CGPoint(x: x, y: 512 - 130))
    }
    // Soft top sheen.
    c.drawLinearGradient(gradient([color(0xffffff, 0.10), color(0xffffff, 0)], [0, 1]), start: CGPoint(x: 512, y: 924), end: CGPoint(x: 512, y: 600), options: [])
    c.restoreGState()
    // Hairline edge so the tile reads on dark Docks.
    c.addPath(tile); c.setLineWidth(2); c.setStrokeColor(color(0xffffff, 0.12)); c.strokePath()

    NSGraphicsContext.restoreGraphicsState()
    return rep.representation(using: .png, properties: [:])!
}

let fm = FileManager.default
let iconset = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("Cadence-\(getpid()).iconset")
try? fm.removeItem(at: iconset); try fm.createDirectory(at: iconset, withIntermediateDirectories: true)
for base in [16, 32, 128, 256, 512] {
    try render(base).write(to: iconset.appendingPathComponent("icon_\(base)x\(base).png"))
    try render(base * 2).write(to: iconset.appendingPathComponent("icon_\(base)x\(base)@2x.png"))
}
try fm.createDirectory(atPath: "Assets", withIntermediateDirectories: true)
try render(1024).write(to: URL(fileURLWithPath: "Assets/AppIcon-preview.png"))
let task = Process(); task.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
task.arguments = ["-c", "icns", iconset.path, "-o", "Assets/AppIcon.icns"]
try task.run(); task.waitUntilExit()
try? fm.removeItem(at: iconset)
print(task.terminationStatus == 0 ? "Wrote Assets/AppIcon.icns and Assets/AppIcon-preview.png" : "iconutil failed")
