#!/bin/zsh
set -eu
if [[ -z "${DEVELOPER_DIR:-}" && -x /Library/Developer/CommandLineTools/usr/bin/swiftc ]]; then
  export DEVELOPER_DIR=/Library/Developer/CommandLineTools
fi
cd "$(dirname "$0")"
mkdir -p build/module-cache
swiftc -swift-version 5 -module-cache-path build/module-cache Sources/Listening.swift Tests/TrackerTests.swift -o build/tracker-tests
build/tracker-tests
swiftc -swift-version 5 -module-cache-path build/module-cache Sources/Listening.swift Sources/History.swift Tests/UploadTests.swift -o build/upload-tests -framework Cocoa -framework Security
build/upload-tests
node --check Resources/app.js
node Tests/adapters.cjs

node Tests/custom-client.cjs
node --check Resources/library-ui.js
node Tests/library.cjs
swiftc -swift-version 5 -module-cache-path build/module-cache Sources/MusicInfo.swift Tests/MusicInfoTests.swift -o build/music-info-tests
build/music-info-tests
node --check Resources/music-info.js
node Tests/now-release.cjs
node Tests/radio-navigation.cjs
node Tests/radio-save.cjs
node Tests/browse.cjs
