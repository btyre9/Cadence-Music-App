using System.Text;
using System.Text.Json.Nodes;

namespace Cadence.Core;

// Port of HistoryService in Sources/History.swift. The token prompt lives in the app
// (it needs a window); this class validates, stores and uploads.
// Credentials never enter the web view, localStorage, logs, or history files.
public sealed class HistoryService
{
    private readonly Settings defaults;
    private readonly HttpClient http;
    private readonly Func<bool> removeToken;
    private readonly Func<string, bool> saveToken;
    private ListeningTracker tracker = new();
    private List<Listen> pending = new();
    private string? token;
    private bool sending;
    private CancellationTokenSource? sendingCancel;
    private CancellationTokenSource? connection;
    private DateTime nextAttempt = DateTime.MinValue;
    private int failures;
    private DateTime lastCheckpoint = DateTime.MinValue;
    private Guid generation = Guid.NewGuid();
    private string message = "Connect ListenBrainz to start automatic tracking.";

    public Action<JsonObject>? OnChange { get; set; }
    public bool Enabled { get; private set; }
    public string User { get; private set; }
    public bool IsConnecting => connection != null;

    public HistoryService(Settings defaults, HttpClient http, Func<string?> tokenProvider, Func<bool> tokenRemover, Func<string, bool> tokenSaver)
    {
        this.defaults = defaults; this.http = http; removeToken = tokenRemover; saveToken = tokenSaver;
        User = defaults.Get<string>("history.user") ?? "";
        Enabled = defaults.Get<bool>("history.enabled");
        pending = defaults.Get<List<Listen>>("history.pending") ?? new();
        tracker = defaults.Get<ListeningTracker>("history.tracker") ?? new();
        token = tokenProvider();
        if (token == null || User.Length == 0) Enabled = false;
        if (User.Length > 0) message = Enabled ? "Tracking is on. Waiting for a qualifying listen." : "Tracking paused. No listens are being uploaded.";
    }

    public JsonObject State() => new()
    {
        ["enabled"] = Enabled, ["connected"] = token != null && User.Length > 0, ["user"] = User,
        ["pending"] = pending.Count, ["message"] = message,
    };

    public void Notify() => OnChange?.Invoke(State());

    private void Persist()
    {
        defaults.Set("history.user", User); defaults.Set("history.enabled", Enabled);
        defaults.Set("history.pending", pending); defaults.Set("history.tracker", tracker);
        defaults.Save();
    }

    public static bool LooksLikeToken(string candidate) => Guid.TryParseExact(candidate, "D", out _);

    // Called with the token the person pasted into the app's prompt.
    public async void Connect(string raw)
    {
        if (connection != null) return;
        var candidate = raw.Trim();
        if (!LooksLikeToken(candidate)) { message = "That token has an unexpected format. Copy your user token from ListenBrainz settings."; Notify(); return; }
        message = "Checking your token with ListenBrainz…"; Notify();
        var cancel = connection = new CancellationTokenSource();
        try
        {
            var (body, status, _) = await Request("validate-token", candidate, null, cancel.Token);
            if (cancel.IsCancellationRequested) return;
            var json = JsonNode.Parse(body) as JsonObject;
            if (status != 200 || json?["valid"]?.GetValueKind() != System.Text.Json.JsonValueKind.True || json.Str("user_name") is not { } name)
            { message = "ListenBrainz rejected that token. Your existing connection is unchanged."; Notify(); return; }
            if (!saveToken(candidate)) { message = "Couldn’t save the token in Windows Credential Manager. Tracking was not enabled."; Notify(); return; }
            generation = Guid.NewGuid(); sendingCancel?.Cancel();
            if (User != name) { pending = new(); tracker = new(); }
            User = name; token = candidate; Enabled = true; nextAttempt = DateTime.MinValue;
            message = $"Tracking enabled for {name}. New listens will be sent automatically.";
            Persist(); Notify(); Flush();
        }
        catch { if (!cancel.IsCancellationRequested) { message = "Couldn’t reach ListenBrainz to validate the token. Please try again."; Notify(); } }
        finally { if (connection == cancel) connection = null; }
    }

    public void SetEnabled(bool value)
    {
        if (token == null || User.Length == 0) { Notify(); return; }
        Enabled = value; generation = Guid.NewGuid(); sendingCancel?.Cancel(); tracker = new(); nextAttempt = DateTime.MinValue;
        message = value ? "Tracking is on. Waiting for a qualifying listen." : "Tracking paused. Queued listens are kept locally until you resume.";
        Persist(); Notify(); if (value) Flush();
    }

    public void Disconnect()
    {
        if (!removeToken()) { message = "Couldn’t remove the saved token. Please try again."; Notify(); return; }
        generation = Guid.NewGuid(); connection?.Cancel(); connection = null; sendingCancel?.Cancel();
        token = null; Enabled = false; User = ""; pending = new(); tracker = new();
        message = "Disconnected. The token and queued listens were removed from this PC. Previously uploaded listens remain on ListenBrainz.";
        Persist(); Notify();
    }

    public void Observe(PlaybackSample sample)
    {
        if (!Enabled || User.Length == 0) return;
        var completed = tracker.Observe(sample, User, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() / 1000.0);
        if (completed != null)
        {
            if (pending.Count < 1000) { pending.Add(completed); message = $"Queued {completed.Title} for ListenBrainz."; }
            else message = "The local queue is full. Reconnect to the internet to resume uploads.";
            Notify();
        }
        if (DateTime.UtcNow - lastCheckpoint >= TimeSpan.FromSeconds(10) || completed != null) { Persist(); lastCheckpoint = DateTime.UtcNow; }
        Flush();
    }

    public void Checkpoint() => Persist();
    public void Tick() => Flush();

    private async Task<(string body, int status, HttpResponseMessage response)> Request(string path, string token, JsonObject? payload, CancellationToken cancel)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancel);
        timeout.CancelAfter(TimeSpan.FromSeconds(20));
        var request = new HttpRequestMessage(payload == null ? HttpMethod.Get : HttpMethod.Post, $"https://api.listenbrainz.org/1/{path}");
        request.Headers.TryAddWithoutValidation("Authorization", $"Token {token}");
        request.Headers.TryAddWithoutValidation("User-Agent", "CadenceWindows/0.2 (personal Windows listening history client)");
        if (payload != null) request.Content = new StringContent(payload.ToJsonString(), Encoding.UTF8, "application/json");
        var response = await http.SendAsync(request, timeout.Token);
        var body = await response.Content.ReadAsStringAsync(timeout.Token);
        return (body, (int)response.StatusCode, response);
    }

    private async void Flush()
    {
        if (sending || !Enabled || token is not { } currentToken || pending.Count == 0 || pending[0].User != User || DateTime.UtcNow < nextAttempt) return;
        var first = pending[0];
        var currentGeneration = generation;
        var cancel = sendingCancel = new CancellationTokenSource();
        sending = true;
        try
        {
            // A stable listened_at is reused after failures, allowing server deduplication.
            var payload = new JsonObject { ["listen_type"] = "single", ["payload"] = new JsonArray(first.Payload()) };
            var (_, status, response) = await Request("submit-listens", currentToken, payload, cancel.Token);
            if (cancel.IsCancellationRequested || generation != currentGeneration) return;
            switch (status)
            {
                case 200:
                    pending.RemoveAll(l => l.Id == first.Id); failures = 0; nextAttempt = DateTime.UtcNow.AddSeconds(2);
                    message = $"Uploaded {first.Title} to {User}."; Persist(); Notify();
                    break;
                case 401 or 403:
                    Enabled = false; message = "ListenBrainz rejected the connection. Reconnect to resume; queued listens are kept locally."; Persist(); Notify();
                    break;
                case 400:
                    // A malformed item must not prevent later listens from uploading.
                    pending.RemoveAll(l => l.Id == first.Id); message = "ListenBrainz rejected one listen. It was skipped; later listens can still upload."; Persist(); Notify();
                    break;
                default:
                    double? retry = response.Headers.TryGetValues("Retry-After", out var values) && double.TryParse(values.FirstOrDefault(), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var seconds) ? seconds : null;
                    RetryLater(retry);
                    break;
            }
        }
        catch { if (!cancel.IsCancellationRequested && generation == currentGeneration) RetryLater(null); }
        finally { if (sendingCancel == cancel) { sending = false; sendingCancel = null; } }
    }

    private void RetryLater(double? delay)
    {
        failures = Math.Min(failures + 1, 8);
        nextAttempt = DateTime.UtcNow.AddSeconds(Math.Max(delay ?? 0, Math.Min(900, 5 * Math.Pow(2, failures))));
        message = $"Upload delayed. {pending.Count} listen(s) saved on this PC; Cadence will retry automatically."; Notify();
    }
}
