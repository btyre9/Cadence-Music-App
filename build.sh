#!/bin/zsh
set -eu
if [[ -z "${DEVELOPER_DIR:-}" && -x /Library/Developer/CommandLineTools/usr/bin/swiftc ]]; then
  export DEVELOPER_DIR=/Library/Developer/CommandLineTools
fi
cd "$(dirname "$0")"
DEST="${1:-build/Cadence.app}"
mkdir -p "$DEST/Contents/MacOS" "$DEST/Contents/Resources" build/module-cache
swiftc -swift-version 5 -O -module-cache-path build/module-cache Sources/*.swift -o "$DEST/Contents/MacOS/Cadence" -framework Cocoa -framework WebKit -framework Security
cp Resources/* "$DEST/Contents/Resources/"
cat > "$DEST/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleExecutable</key><string>Cadence</string><key>CFBundleIdentifier</key><string>local.cadence.music</string><key>CFBundleName</key><string>Cadence</string><key>CFBundleDisplayName</key><string>Cadence</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleShortVersionString</key><string>0.7</string><key>CFBundleVersion</key><string>7</string><key>LSMinimumSystemVersion</key><string>13.0</string><key>NSHighResolutionCapable</key><true/><key>NSHumanReadableCopyright</key><string>Personal prototype. Not affiliated with YouTube, SoundCloud, or ListenBrainz.</string></dict></plist>
PLIST
codesign --force --deep --sign - "$DEST"
