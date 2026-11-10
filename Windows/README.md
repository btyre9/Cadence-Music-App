# Cadence for Windows

A Windows version of Cadence, built in C# on Microsoft's Edge engine (WebView2). It uses the same
interface and YouTube Music code as the Mac app: everything in `Resources/` is shared, unchanged.
Only the wrapper around it is new.

Requires 64-bit Windows 10 or 11. The Edge WebView2 Runtime it needs ships with both.

## Build and run

1. Install the [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0).
2. In PowerShell, from this folder: `.\build.ps1`
3. Run `build\Cadence-Windows\Cadence.exe`. The folder is self-contained, so you can move it anywhere.

On an ARM laptop, use `.\build.ps1 -Runtime win-arm64`. `.\test.ps1` runs the tests (Node is needed for
the interface tests). Pushing to GitHub also builds it: the "Windows build" action keeps the finished
folder as a download named Cadence-Windows.

## How the Mac pieces map

| Mac (Swift) | Windows (C#) |
|---|---|
| `Sources/main.swift`: window, hidden player and catalog views, message bridge | `Cadence/MainForm.cs` |
| `Sources/History.swift`: ListenBrainz uploads | `Cadence.Core/HistoryService.cs` |
| Keychain token | Windows Credential Manager (`Cadence/TokenStore.cs`) |
| Token sheet | `Cadence/TokenDialog.cs` |
| `Sources/Listening.swift` | `Cadence.Core/Listening.cs` |
| `Sources/MusicInfo.swift` | `Cadence.Core/MusicInfo.cs` |
| `Sources/SelfTest.swift` | `Cadence/SelfTest.cs` |
| UserDefaults | `%LOCALAPPDATA%\Cadence\settings.json` |
| WebKit sign-in and storage | `%LOCALAPPDATA%\Cadence\WebView2` |

The interface still calls `window.webkit.messageHandlers.cadence.postMessage(...)`. A small script injected
by the Windows app routes that to WebView2, and swaps the few on-screen sentences that mention Mac storage.
Scripts that the Mac runs with `evaluateJavaScript` and `callAsyncJavaScript` run through the DevTools
protocol's `Runtime.evaluate`, which can wait for a promise the way `callAsyncJavaScript` does.

When you change the listening rules, uploads or release matching in Swift, change the C# copy too:
`Cadence.Tests` holds the same tests as `Tests/*.swift`.

## Differences from the Mac app

- About Cadence is in the window menu (click the icon at the top left, or press Alt+Space).
- The title bar follows Windows' light or dark setting, like the interface.
- Debug lines (`CADENCE_DEBUG=1`) also go to `%LOCALAPPDATA%\Cadence\debug.log`, since a Windows app has no console.
- The self-test works the same way: set `CADENCE_DEBUG=1`, `CADENCE_SELFTEST=1` and `CADENCE_SELFTEST_DIR`.

## Not checked yet

This was written and compile-checked without a Windows PC, and without access to YouTube. Things to try first:

- Google sign-in in the Account window. Google sometimes refuses sign-in inside apps.
- A song plays and keeps playing while you browse, with the hidden player behind the interface.
- Search, albums, playlists and Library load (they use the same data-service scripts as the Mac).
- ListenBrainz connect, and the playlist delete confirmation.
