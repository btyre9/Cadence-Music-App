using Microsoft.Web.WebView2.Core;

namespace Cadence.Windows;

// Port of Sources/SelfTest.swift. Developer check, off unless CADENCE_SELFTEST is set: browses a fixed
// set of pages (read-only, no playback or account changes), logs timings with CADENCE_DEBUG, and saves
// window snapshots to CADENCE_SELFTEST_DIR. CADENCE_LEGACY=1 forces the old website-scraping path.
sealed partial class MainForm
{
    void StartSelfTestIfRequested()
    {
        if (Environment.GetEnvironmentVariable("CADENCE_LEGACY") != null) browseScript = "";
        if (Environment.GetEnvironmentVariable("CADENCE_SELFTEST") == null || shell == null) return;
        var dir = Environment.GetEnvironmentVariable("CADENCE_SELFTEST_DIR") ?? Path.GetTempPath();
        Directory.CreateDirectory(dir);
        (string name, string script)[] steps =
        [
            ("home", ""),
            ("search", "search('radiohead')"),
            ("album", "openItem(catalogData.sections.flatMap(s=>s.items).find(i=>i.kind==='album'))"),
            ("playlist", "catalogLabel='Large playlist';browse('https://music.youtube.com/playlist?list=PLwNv9Hhd8gZjNoQdpd2kBa3fwXNeJjzDX')"),
            ("library", "navigate('library')"),
            ("explore", "navigate('youtube')"),
            ("back-to-search", "search('radiohead')"),
            ("discover", "navigate('discover')"),
            ("connections", "navigate('settings')"),
        ];
        async Task Run()
        {
            await Task.Delay(1000);
            for (var index = 0; index < steps.Length; index++)
            {
                var (name, script) = steps[index];
                if (script.Length > 0) { Debug($"selftest step {name}"); await shell.ExecuteScriptAsync(script); }
                await Task.Delay(name == "playlist" ? 9000 : 6000);
                var rendered = await shell.ExecuteScriptAsync("JSON.stringify({state:document.getElementById('catalog-state').textContent,title:document.getElementById('catalog-title').textContent,rows:document.querySelectorAll('.song-row').length,cards:document.querySelectorAll('.catalog-card').length})");
                Debug($"selftest {name} rendered {rendered}");
                using var file = File.Create(Path.Combine(dir, $"{index}-{name}.png"));
                await shell.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, file);
            }
            Debug("selftest done");
            Close();
        }
        _ = Run();
    }
}
