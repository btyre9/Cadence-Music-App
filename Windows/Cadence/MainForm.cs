using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Cadence.Core;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using static Cadence.Windows.WebViewScripts;

namespace Cadence.Windows;

// Port of the App class in Sources/main.swift. The visible window shows the shared Cadence interface
// (Resources/index.html); two hidden Edge views do the YouTube Music work, as on the Mac:
// one plays audio, the other reads catalog pages, so browsing never interrupts the song.
sealed partial class MainForm : Form
{
    const string ShellHost = "cadence.example";
    const string ShellOrigin = "https://cadence.example/";
    static readonly string DataFolder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Cadence");
    static readonly string ResourcesFolder = Path.Combine(AppContext.BaseDirectory, "Resources");
    static readonly HttpClient Http = new();
    static readonly Regex VideoId = new("^[A-Za-z0-9_-]{6,40}$", RegexOptions.CultureInvariant);

    readonly WebView2 shellControl = new() { Dock = DockStyle.Fill };
    // Service views sit behind the opaque interface, as on the Mac, and never take focus.
    readonly WebView2 youtubeControl = new() { Location = Point.Empty, Size = new Size(1200, 800), TabStop = false };
    readonly WebView2 catalogControl = new() { Location = Point.Empty, Size = new Size(1400, 950), TabStop = false };
    CoreWebView2? shell, youtube, catalog;
    CoreWebView2Environment? environment;
    Form? accountWindow;
    bool youtubeLoading, catalogLoading;

    readonly Settings settings = new(Path.Combine(DataFolder, "settings.json"));
    readonly HistoryService history;
    readonly MusicInfo musicInfo = new(Http);
    readonly bool debugTiming = Environment.GetEnvironmentVariable("CADENCE_DEBUG") != null;

    string catalogScript = "", sampleScript = "", libraryScript = "", radioSnapshotScript = "", playbackScript = "", browseScript = "";
    bool catalogPending, catalogPolling, catalogReported, catalogBooted, catalogReadyChecking;
    DateTime catalogStarted = DateTime.MinValue;
    int catalogVersion;
    string catalogExpectedURL = "";
    Uri? catalogQueued;
    string catalogLastSnapshot = "";
    int catalogStableCount;
    bool loadedYouTube, sampling, libraryBusy, repeatOne, volumeDirty = true;
    double desiredVolume;
    int playbackGeneration;
    DateTime lastHistorySample = DateTime.MinValue;
    CancellationTokenSource? requestTask, infoTask, footerInfoTask;
    readonly System.Windows.Forms.Timer trackTimer = new() { Interval = 350 };
    readonly System.Windows.Forms.Timer historyTimer = new() { Interval = 2000 };
    readonly System.Windows.Forms.Timer catalogTimer = new() { Interval = 250 };
    readonly System.Windows.Forms.Timer catalogReadyTimer = new() { Interval = 100 };

    public MainForm()
    {
        Text = "Cadence";
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(1280, 820);
        MinimumSize = SizeFromClientSize(new Size(1040, 680));
        Controls.Add(youtubeControl); Controls.Add(catalogControl); Controls.Add(shellControl);
        shellControl.BringToFront();
        desiredVolume = settings.Get<double?>("player.volume") ?? 0.35;
        history = new HistoryService(settings, Http, TokenStore.Read, TokenStore.Delete, TokenStore.Save);
        history.OnChange = state => Send("history", state);
        trackTimer.Tick += (_, _) => UpdateTrack();
        historyTimer.Tick += (_, _) => history.Tick();
        catalogTimer.Tick += (_, _) => PollCatalog();
        catalogReadyTimer.Tick += (_, _) => CheckCatalogReady();
    }

    protected override async void OnLoad(EventArgs e)
    {
        base.OnLoad(e);
        string Script(string name) { try { return File.ReadAllText(Path.Combine(ResourcesFolder, name)); } catch { return ""; } }
        radioSnapshotScript = Script("radio-snapshot.js"); playbackScript = Script("playback-navigation.js"); libraryScript = Script("youtube-library.js");
        catalogScript = Script("youtube-catalog.js"); sampleScript = Script("youtube-sample.js"); browseScript = Script("youtube-browse.js");
        try
        {
            // Let the hidden players keep running at full speed while covered by the interface.
            var options = new CoreWebView2EnvironmentOptions("--autoplay-policy=no-user-gesture-required --disable-features=CalculateNativeWinOcclusion --disable-background-timer-throttling --disable-renderer-backgrounding");
            environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(DataFolder, "WebView2"), options);
            await Task.WhenAll(shellControl.EnsureCoreWebView2Async(environment), youtubeControl.EnsureCoreWebView2Async(environment), catalogControl.EnsureCoreWebView2Async(environment));
        }
        catch (WebView2RuntimeNotFoundException)
        {
            MessageBox.Show(this, "Cadence needs the Microsoft Edge WebView2 Runtime, which comes with Windows 10 and 11. Install it from Microsoft’s WebView2 page, then open Cadence again.", "Cadence", MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close(); return;
        }
        shell = shellControl.CoreWebView2; youtube = youtubeControl.CoreWebView2; catalog = catalogControl.CoreWebView2;
        ConfigureShell(shell);
        ConfigureService(youtube, isPlayer: true);
        ConfigureService(catalog, isPlayer: false);
        await shell.AddScriptToExecuteOnDocumentCreatedAsync(ShellBootstrap);
        ApplyAppearanceOverride();
        shell.Navigate(ShellOrigin + "index.html");
        // Start both music engines right away so the first page and first song don't wait for them.
        BootCatalog();
        _ = PrewarmLater();
        async Task PrewarmLater() { await Task.Delay(1500); PrewarmPlayer(); }
        StartSelfTestIfRequested();
        historyTimer.Start(); trackTimer.Start();
    }

    protected override void OnFormClosing(FormClosingEventArgs e) { history.Checkpoint(); base.OnFormClosing(e); }

    void ConfigureShell(CoreWebView2 view)
    {
        view.Settings.AreDevToolsEnabled = debugTiming;
        view.Settings.AreBrowserAcceleratorKeysEnabled = false; // no F5/Ctrl+R reloading the interface mid-song
        view.Settings.IsZoomControlEnabled = false;
        view.Settings.IsStatusBarEnabled = false;
        view.SetVirtualHostNameToFolderMapping(ShellHost, ResourcesFolder, CoreWebView2HostResourceAccessKind.DenyCors);
        view.WebMessageReceived += (_, e) => { if (e.Source.StartsWith(ShellOrigin, StringComparison.Ordinal)) HandleMessage(e.WebMessageAsJson); };
        view.NavigationStarting += (_, e) => { if (!e.Uri.StartsWith(ShellOrigin, StringComparison.Ordinal)) e.Cancel = true; };
        view.NewWindowRequested += OpenNewWindowExternally;
    }

    void ConfigureService(CoreWebView2 view, bool isPlayer)
    {
        view.Settings.AreDevToolsEnabled = debugTiming;
        view.Settings.IsStatusBarEnabled = false;
        view.Settings.AreDefaultContextMenusEnabled = false;
        view.NavigationStarting += (_, e) =>
        {
            if (!AllowedServiceURL(e.Uri)) { e.Cancel = true; return; }
            if (isPlayer) youtubeLoading = true; else catalogLoading = true;
        };
        view.FrameNavigationStarting += (_, e) => { if (!AllowedServiceURL(e.Uri)) e.Cancel = true; };
        view.NewWindowRequested += OpenNewWindowExternally;
        view.NavigationCompleted += (_, e) =>
        {
            if (isPlayer) youtubeLoading = false; else catalogLoading = false;
            var cancelled = e.WebErrorStatus is CoreWebView2WebErrorStatus.OperationCanceled or CoreWebView2WebErrorStatus.ConnectionAborted;
            if (isPlayer)
            {
                if (e.IsSuccess) { volumeDirty = true; UpdateTrack(); }
                else if (!cancelled) Send("notice", "YouTube Music couldn’t load. Check your connection, or use Account to sign in.");
                return;
            }
            if (!e.IsSuccess)
            {
                if (!cancelled) { Send("catalog-error", "Couldn’t load music. Check your connection and try again."); catalogPending = false; catalogQueued = null; }
                return;
            }
            catalogBooted = Host(catalog?.Source) == "music.youtube.com";
            if (catalogQueued is { } queued)
            {
                catalogQueued = null;
                Debug($"catalog engine ready {Ms(catalogStarted)}ms after request");
                if (catalogBooted) BrowseAPI(queued, catalogVersion); else LoadCatalogPage(queued);
            }
            PollCatalog();
        };
    }

    static bool AllowedServiceURL(string raw)
    {
        if (raw == "about:blank") return true;
        if (!Uri.TryCreate(raw, UriKind.Absolute, out var u) || u.Scheme != "https") return false;
        var host = u.Host;
        return host == "youtube.com" || host.EndsWith(".youtube.com", StringComparison.Ordinal) || host is "accounts.google.com" or "consent.google.com" or "consent.youtube.com";
    }

    static void OpenNewWindowExternally(object? sender, CoreWebView2NewWindowRequestedEventArgs e)
    {
        e.Handled = true;
        if (Uri.TryCreate(e.Uri, UriKind.Absolute, out var u) && u.Scheme == "https") OpenExternally(u);
    }

    static void OpenExternally(Uri u) { try { Process.Start(new ProcessStartInfo(u.AbsoluteUri) { UseShellExecute = true }); } catch { } }
    static string? Host(string? raw) => Uri.TryCreate(raw, UriKind.Absolute, out var u) ? u.Host : null;
    static string Js(double value) => value.ToString("R", CultureInfo.InvariantCulture);
    static int Ms(DateTime since) => (int)(DateTime.UtcNow - since).TotalMilliseconds;
    bool CatalogBlank => catalog?.Source is null or "" or "about:blank";

    void Debug(string message)
    {
        if (!debugTiming) return;
        var line = $"[cadence] {message}";
        try { Console.Error.WriteLine(line); Directory.CreateDirectory(DataFolder); File.AppendAllText(Path.Combine(DataFolder, "debug.log"), line + Environment.NewLine); } catch { }
    }

    void Send(string @event, JsonNode? payload)
    {
        if (shell == null) return;
        var message = new JsonObject { ["event"] = @event, ["payload"] = payload?.Parent == null ? payload : payload.DeepClone() };
        _ = shell.ExecuteScriptAsync($"window.receive({message.ToJsonString()})");
    }

    void Send(string @event, string text) => Send(@event, JsonValue.Create(text));

    async void HandleMessage(string json)
    {
        if ((JsonNode.Parse(json) is not JsonObject body) || body.Str("action") is not { } action) return;
        switch (action)
        {
            case "music-info":
            {
                if (body.Str("title") is not { Length: < 500 } title || body.Str("artist") is not { Length: < 500 } artist || body.Str("requestID") is not { } requestID) return;
                var isFooter = requestID.StartsWith("now-", StringComparison.Ordinal);
                var cancel = new CancellationTokenSource();
                if (isFooter) { footerInfoTask?.Cancel(); footerInfoTask = cancel; } else { infoTask?.Cancel(); infoTask = cancel; }
                try
                {
                    var matches = await musicInfo.Lookup(title, artist, body.Str("kind") ?? "song", cancel.Token);
                    if (!cancel.IsCancellationRequested) Send("music-info", new JsonObject { ["requestID"] = requestID, ["matches"] = JsonSerializer.SerializeToNode(matches) });
                }
                catch
                {
                    if (!cancel.IsCancellationRequested) Send("music-info", new JsonObject { ["requestID"] = requestID, ["matches"] = new JsonArray(), ["error"] = "Release information is temporarily unavailable. Try again later." });
                }
                break;
            }
            case "history-state": history.Notify(); break;
            case "history-connect":
                if (!history.IsConnecting && TokenDialog.Ask(this) is { } token) history.Connect(token);
                break;
            case "history-enabled": history.SetEnabled(body.Bool("enabled") ?? false); break;
            case "history-disconnect": history.Disconnect(); break;
            case "history-sample":
                if (body.Obj("sample") is { } sample && sample.Str("source") == "soundcloud") Observe(sample);
                break;
            case "radio-snapshot":
            {
                if (body.Str("requestID") is not { } requestID) return;
                if (!loadedYouTube || radioSnapshotScript.Length == 0) { Send("radio-snapshot", new JsonObject { ["requestID"] = requestID, ["tracks"] = new JsonArray() }); return; }
                var (_, value) = await Evaluate(youtube, radioSnapshotScript);
                var output = value as JsonObject ?? new JsonObject { ["tracks"] = new JsonArray() };
                output["requestID"] = requestID;
                Send("radio-snapshot", output);
                break;
            }
            case "library-request":
                if (body.Obj("request") is { } request) LibraryRequest(request);
                break;
            case "catalog":
                if (body.Str("url") is { } raw && ValidatedMusicURL(raw) is { } url) LoadCatalog(url);
                break;
            case "youtube":
                if (body.Str("query") is { Length: > 0 } query) LoadCatalog(new Uri("https://music.youtube.com/search?q=" + Uri.EscapeDataString(query)));
                else LoadCatalog(new Uri("https://music.youtube.com/"));
                break;
            case "play-track":
                if (body.Str("id") is { } id && VideoId.IsMatch(id))
                {
                    PlayVideo(id, new Uri("https://music.youtube.com/watch?v=" + Uri.EscapeDataString(id)));
                    Send("engine", new JsonObject { ["loading"] = true });
                }
                break;
            case "repeat-one": repeatOne = body.Bool("enabled") ?? false; UpdateTrack(); break;
            case "start-radio":
                if (body.Str("id") is { } seed && VideoId.IsMatch(seed))
                {
                    repeatOne = false;
                    PlayVideo(seed, new Uri($"https://music.youtube.com/watch?v={Uri.EscapeDataString(seed)}&list={Uri.EscapeDataString("RDAMVM" + seed)}"), radio: true);
                }
                break;
            case "account": OpenAccount(); break;
            case "seek":
                if (body.Num("seconds") is { } seconds && double.IsFinite(seconds) && seconds >= 0)
                    _ = Evaluate(youtube, $"(()=>{{const v=document.querySelector('video');if(v&&Number.isFinite(v.duration)){{v.currentTime=Math.min(v.duration,{Js(seconds)})}}}})()");
                break;
            case "volume":
                if (body.Num("volume") is { } volume && double.IsFinite(volume))
                {
                    desiredVolume = Math.Clamp(volume, 0, 1); settings.Set("player.volume", desiredVolume); settings.Save(); volumeDirty = true;
                    _ = Evaluate(youtube, $"(()=>{{const v=document.querySelector('video');if(v){{const p=document.querySelector('#movie_player');if(p?.setVolume)p.setVolume({Js(desiredVolume * 100)});else v.volume={Js(desiredVolume)};}}}})()");
                }
                break;
            case "pause": _ = Evaluate(youtube, "document.querySelector('video')?.pause()"); break;
            case "toggle": _ = Evaluate(youtube, "(()=>{const v=document.querySelector('video');if(v){v.paused?v.play():v.pause()}})()"); break;
            case "next": _ = Evaluate(youtube, "document.querySelector('ytmusic-player-bar .next-button')?.click()"); break;
            case "previous": _ = Evaluate(youtube, "document.querySelector('ytmusic-player-bar .previous-button')?.click()"); break;
            case "reload": if (ValidatedMusicURL(catalogExpectedURL) is { } again) LoadCatalog(again); break;
            case "back": youtube?.GoBack(); break;
            case "external":
                if (body.Str("url") is { } link && Uri.TryCreate(link, UriKind.Absolute, out var u) && u.Scheme == "https"
                    && u.Host is "music.youtube.com" or "listenbrainz.org" or "soundcloud.com" or "musicbrainz.org") OpenExternally(u);
                break;
            case "recommend":
            {
                if (body.Str("username") is not { } name || name.Trim().Length == 0 || name.Length > 100) { Send("error", "Enter your ListenBrainz username."); return; }
                requestTask?.Cancel();
                var cancel = requestTask = new CancellationTokenSource();
                try
                {
                    var tracks = await Recommendations.Fetch(Http, name, cancel.Token);
                    if (!cancel.IsCancellationRequested) Send("recommendations", tracks);
                }
                catch (CadenceException error) { if (!cancel.IsCancellationRequested) Send("error", error.Message); }
                catch { if (!cancel.IsCancellationRequested) Send("error", "Couldn’t reach ListenBrainz. Check your connection and try again."); }
                break;
            }
        }
    }

    static readonly HashSet<string> LibraryOps = new() { "inspect", "list-playlists", "create", "create-radio-playlist", "rename", "add-track", "remove-track", "move-track", "remove-library", "delete" };

    void LibraryRequest(JsonObject request)
    {
        if (request.Str("op") is not { } op || !LibraryOps.Contains(op) || libraryScript.Length == 0) return;
        if (libraryBusy) { Send("library-result", new JsonObject { ["ok"] = false, ["op"] = op, ["message"] = "Another library request is still running." }); return; }
        if (Host(catalog?.Source) != "music.youtube.com" || catalogLoading) { Send("library-result", new JsonObject { ["ok"] = false, ["op"] = op, ["message"] = "Wait for your music page to finish loading, then try again." }); return; }
        if (op is not ("create" or "create-radio-playlist" or "list-playlists") && (request.Str("url") is not { } raw || ValidatedMusicURL(raw) == null)) return;
        async void Run()
        {
            libraryBusy = true;
            var (ok, value) = await CallAsync(catalog, libraryScript, request);
            libraryBusy = false;
            if (!ok) Send("library-result", new JsonObject { ["ok"] = false, ["op"] = op, ["message"] = "Couldn’t confirm the result. Refresh your library before retrying." });
            else if (value is JsonObject result) Send("library-result", result);
        }
        if (op == "delete")
        {
            var deleteButton = new TaskDialogButton("Delete playlist");
            var page = new TaskDialogPage
            {
                Caption = "Cadence", Heading = "Delete playlist permanently?", Icon = TaskDialogIcon.Warning,
                Text = $"Delete {request.Str("title") ?? "this playlist"} from your YouTube account? This deletes the playlist for everyone it was shared with. This cannot be undone in Cadence.",
                Buttons = { TaskDialogButton.Cancel, deleteButton }, DefaultButton = TaskDialogButton.Cancel,
            };
            if (TaskDialog.ShowDialog(this, page) == deleteButton) Run();
            else Send("library-result", new JsonObject { ["ok"] = false, ["op"] = op, ["message"] = "Deletion cancelled." });
        }
        else Run();
    }

    static readonly HashSet<string> MusicPaths = new() { "/", "/search", "/explore", "/library", "/playlist", "/new_releases" };

    static Uri? ValidatedMusicURL(string raw)
    {
        if (!Uri.TryCreate(raw, UriKind.Absolute, out var u) || u.Scheme != "https" || u.Host != "music.youtube.com") return null;
        var path = u.AbsolutePath;
        return MusicPaths.Contains(path) || path.StartsWith("/browse/", StringComparison.Ordinal) || path.StartsWith("/channel/", StringComparison.Ordinal) ? u : null;
    }

    async void PlayVideo(string id, Uri url, bool radio = false)
    {
        volumeDirty = true; var generation = ++playbackGeneration;
        if (youtube == null) return;
        if (!loadedYouTube || youtubeLoading || playbackScript.Length == 0) { youtube.Navigate(url.AbsoluteUri); loadedYouTube = true; return; }
        var script = playbackScript.Replace("VIDEO_ID", Literal(id)).Replace("FORCE_RADIO", radio ? "true" : "false");
        var (_, result) = await Evaluate(youtube, script);
        if (playbackGeneration != generation) return;
        if (result?.GetValueKind() != JsonValueKind.True) { youtube.Navigate(url.AbsoluteUri); return; }
        await Task.Delay(1200);
        if (playbackGeneration != generation) return;
        var (_, current) = await Evaluate(youtube, "new URL(location.href).searchParams.get('v') || document.querySelector('#movie_player')?.getVideoData?.().video_id");
        if (playbackGeneration != generation) return;
        if (current.Str() != id) youtube.Navigate(url.AbsoluteUri);
    }

    void BootCatalog()
    {
        if (catalog != null && CatalogBlank && !catalogLoading) catalog.Navigate("https://music.youtube.com/");
    }

    // The data service is usable as soon as YouTube Music's config exists, long before the page finishes loading.
    void WatchCatalogReady() { if (!catalogReadyTimer.Enabled) catalogReadyTimer.Start(); }

    async void CheckCatalogReady()
    {
        if (catalogQueued == null) { catalogReadyTimer.Stop(); return; }
        if (catalogReadyChecking) return;
        catalogReadyChecking = true;
        var (_, value) = await Evaluate(catalog, "location.host==='music.youtube.com'&&!!window.ytcfg?.get?.('INNERTUBE_CONTEXT')?.client");
        catalogReadyChecking = false;
        if (value?.GetValueKind() != JsonValueKind.True || catalogQueued is not { } queued) return;
        catalogReadyTimer.Stop();
        catalogQueued = null; catalogBooted = true;
        Debug($"catalog engine usable {Ms(catalogStarted)}ms after request (still loading: {catalogLoading})");
        BrowseAPI(queued, catalogVersion);
    }

    void PrewarmPlayer()
    {
        if (loadedYouTube || youtube == null) return;
        youtube.Navigate("https://music.youtube.com/"); loadedYouTube = true;
    }

    void LoadCatalog(Uri url)
    {
        catalogTimer.Stop(); catalogPending = false; catalogQueued = null;
        catalogVersion++; catalogExpectedURL = url.AbsoluteUri; catalogReported = false; catalogStarted = DateTime.UtcNow;
        Send("catalog-loading", new JsonObject { ["url"] = url.AbsoluteUri });
        if (browseScript.Length == 0) LoadCatalogPage(url);
        else if (catalogBooted && !catalogLoading) BrowseAPI(url, catalogVersion);
        else if (catalogLoading || CatalogBlank) { catalogQueued = url; BootCatalog(); WatchCatalogReady(); }
        else LoadCatalogPage(url); // The engine ended up somewhere else (e.g. a consent page): use the website.
    }

    // Reads a page through the data service; falls back to loading and scraping the website.
    async void BrowseAPI(Uri url, int version, string? token = null)
    {
        var started = DateTime.UtcNow;
        var request = token != null ? new JsonObject { ["op"] = "more", ["token"] = token } : new JsonObject { ["op"] = "load", ["url"] = url.AbsoluteUri };
        var (ok, value) = await CallAsync(catalog, browseScript, request);
        if (catalogVersion != version) return;
        if (!ok || value is not JsonObject output)
        {
            Debug($"api error {url.AbsoluteUri} {Ms(started)}ms; falling back"); if (token == null) LoadCatalogPage(url); return;
        }
        if (output.Bool("ok") != true || output.Obj("data") is not { } data)
        {
            var message = output.Str("message") ?? "";
            Debug($"api failed {url.AbsoluteUri} {Ms(started)}ms: {message}");
            if (token != null) return;
            if (output.Bool("empty") == true) Send("catalog-error", message); else LoadCatalogPage(url);
            return;
        }
        output.Remove("data");
        var sections = data.Arr("sections") ?? new JsonArray();
        Debug($"api {(token == null ? "page" : "more")} {url.AbsoluteUri} {Ms(started)}ms total={Ms(catalogStarted)}ms sections={sections.Count} items={sections.Sum(s => s.Arr("items")?.Count ?? 0)}");
        data["requestURL"] = url.AbsoluteUri; catalogReported = true;
        Send("catalog-result", data);
        if (output.Bool("more") == true && output.Str("token") is { } next) BrowseAPI(url, version, next);
    }

    void LoadCatalogPage(Uri url)
    {
        catalogTimer.Stop(); catalogLastSnapshot = ""; catalogStableCount = 0;
        catalogPending = true; catalogReported = false; catalogStarted = DateTime.UtcNow; catalogExpectedURL = url.AbsoluteUri;
        catalog?.Navigate(url.AbsoluteUri);
        catalogTimer.Start();
    }

    async void PollCatalog()
    {
        if (!catalogPending || catalogPolling || catalogLoading || catalogScript.Length == 0) return;
        catalogPolling = true; var version = catalogVersion;
        var (_, result) = await Evaluate(catalog, catalogScript);
        catalogPolling = false;
        if (catalogVersion != version) return;
        if (result is JsonObject data && data.Arr("sections") is { } groups && (groups.Count > 0 || (data.Str("title") ?? "").Length > 0))
        {
            var fingerprint = data.ToJsonString();
            if (!catalogReported) Debug($"website page {catalogExpectedURL} total={Ms(catalogStarted)}ms sections={groups.Count}");
            if (fingerprint == catalogLastSnapshot) catalogStableCount++; else catalogStableCount = 0;
            if (fingerprint != catalogLastSnapshot) { catalogLastSnapshot = fingerprint; data["requestURL"] = catalogExpectedURL; Send("catalog-result", data); }
            catalogReported = true;
            // A second pass captures deferred sections/artwork, without blocking initial results.
            if (catalogStableCount >= 2 || DateTime.UtcNow - catalogStarted > TimeSpan.FromSeconds(3)) { catalogPending = false; catalogTimer.Stop(); }
        }
        else if (DateTime.UtcNow - catalogStarted > TimeSpan.FromSeconds(22))
        {
            catalogPending = false; catalogTimer.Stop();
            if (!catalogReported) Send("catalog-error", "No music loaded for this page. Your library may need sign-in, or YouTube may have changed this page. Use Account to sign in, then refresh.");
        }
    }

    async void OpenAccount()
    {
        if (accountWindow == null)
        {
            var view = new WebView2 { Dock = DockStyle.Fill };
            var window = new Form { Text = "YouTube Music account • close this window when signed in", ClientSize = new Size(900, 700), StartPosition = FormStartPosition.CenterScreen, Icon = Icon };
            window.Controls.Add(view);
            // Closing hides the window and keeps its page, like the Mac version.
            window.FormClosing += (_, e) => { if (e.CloseReason == CloseReason.UserClosing) { e.Cancel = true; window.Hide(); } };
            accountWindow = window;
            window.Show(this);
            await view.EnsureCoreWebView2Async(environment);
            view.CoreWebView2.Settings.IsStatusBarEnabled = false;
            view.CoreWebView2.NavigationStarting += (_, e) => { if (!AllowedServiceURL(e.Uri)) e.Cancel = true; };
            view.CoreWebView2.FrameNavigationStarting += (_, e) => { if (!AllowedServiceURL(e.Uri)) e.Cancel = true; };
            view.CoreWebView2.NewWindowRequested += OpenNewWindowExternally;
            view.CoreWebView2.Navigate("https://music.youtube.com/");
        }
        accountWindow.Show(); accountWindow.Activate();
    }

    void Observe(JsonObject value)
    {
        if (value.Str("source") is not { } source || value.Str("id") is not { } id || value.Str("title") is not { } title || value.Str("artist") is not { } artist
            || value.Num("duration") is not { } duration || value.Num("position") is not { } position || value.Str("url") is not { } url
            || !Uri.TryCreate(url, UriKind.Absolute, out var parsed) || parsed.Scheme != "https"
            || !((source == "youtube" && parsed.Host == "music.youtube.com") || (source == "soundcloud" && parsed.Host == "soundcloud.com"))) return;
        static string Prefix(string s, int n) => s.Length <= n ? s : s[..n];
        history.Observe(new PlaybackSample(source, Prefix(id, 300), Prefix(title, 500), Prefix(artist, 500), Prefix(value.Str("album") ?? "", 500), Prefix(url, 1000),
            duration, position, value.Bool("playing") ?? false, value.Bool("eligible") ?? false));
    }

    async void UpdateTrack()
    {
        if (!loadedYouTube || sampling || sampleScript.Length == 0 || youtube == null) return;
        sampling = true; var volumeSent = desiredVolume;
        var prefix = $"(()=>{{const v=document.querySelector('video');if(v){{if({(volumeDirty ? "true" : "false")}){{const p=document.querySelector('#movie_player');if(p?.setVolume)p.setVolume({Js(desiredVolume * 100)});else v.volume={Js(desiredVolume)};}}v.loop={(repeatOne ? "true" : "false")}&&!document.querySelector('.ad-showing, .ad-interrupting');}}}})();";
        var (_, result) = await Evaluate(youtube, prefix + sampleScript);
        sampling = false;
        if (result is not JsonObject track) return;
        if (track.Bool("hasMedia") == true && desiredVolume == volumeSent) volumeDirty = false;
        Send("track", track);
        if (DateTime.UtcNow - lastHistorySample >= TimeSpan.FromSeconds(1.4)) { lastHistorySample = DateTime.UtcNow; Observe(track); history.Tick(); }
    }

    // ---- Window chrome: dark title bar to match the interface, and About in the window menu ----

    [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);
    [DllImport("user32.dll")] static extern IntPtr GetSystemMenu(IntPtr hwnd, bool revert);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool AppendMenu(IntPtr menu, int flags, int id, string? text);
    const int AboutCommand = 0x10, WmSysCommand = 0x112, WmSettingChange = 0x1A;

    static bool SystemUsesDarkMode()
    {
        var forced = Environment.GetEnvironmentVariable("CADENCE_APPEARANCE");
        if (forced != null) return forced == "dark";
        try { return Microsoft.Win32.Registry.GetValue(@"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize", "AppsUseLightTheme", 1) is 0; } catch { return false; }
    }

    void ApplyTitleBarTheme(Form form)
    {
        var dark = SystemUsesDarkMode() ? 1 : 0;
        try { DwmSetWindowAttribute(form.Handle, 20, ref dark, sizeof(int)); } catch { }
    }

    // CADENCE_APPEARANCE=light|dark previews one palette regardless of the system setting (style.css supplies both).
    void ApplyAppearanceOverride()
    {
        var look = Environment.GetEnvironmentVariable("CADENCE_APPEARANCE");
        if (look != null && shell != null) shell.Profile.PreferredColorScheme = look == "dark" ? CoreWebView2PreferredColorScheme.Dark : CoreWebView2PreferredColorScheme.Light;
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        ApplyTitleBarTheme(this);
        var menu = GetSystemMenu(Handle, false);
        AppendMenu(menu, 0x800, 0, null); // separator
        AppendMenu(menu, 0, AboutCommand, "About Cadence");
    }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == WmSysCommand && (m.WParam.ToInt64() & 0xFFF0) == AboutCommand) { ShowAbout(); return; }
        if (m.Msg == WmSettingChange) ApplyTitleBarTheme(this);
        base.WndProc(ref m);
    }

    void ShowAbout() => TaskDialog.ShowDialog(this, new TaskDialogPage
    {
        Caption = "About Cadence", Heading = "Cadence 0.7 for Windows",
        Text = "A personal music workspace. Interface inspired by Alexis Kiredjian’s YouTube Music Desktop App concept.\n\nPersonal prototype. Not affiliated with YouTube, SoundCloud, or ListenBrainz.",
        Buttons = { TaskDialogButton.OK },
    });
}
