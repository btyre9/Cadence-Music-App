using System.Net;
using System.Text.Json.Nodes;
using Cadence.Core;

static void Check(bool condition, string what) { if (!condition) throw new Exception("FAIL: " + what); }

// ---- Tracker (Tests/TrackerTests.swift) ----
{
    static PlaybackSample Sample(double position, double duration = 100, bool playing = true, bool eligible = true, string id = "one", string artist = "Artist", string source = "youtube") =>
        new(source, id, "Track", artist, "Album", "https://music.youtube.com/watch?v=one", duration, position, playing, eligible);

    var tracker = new ListeningTracker(); var listens = new List<Listen>();
    for (var i = 0; i <= 99; i++) if (tracker.Observe(Sample(i), "test", 1_800_000_000 + i) is { } l) listens.Add(l);
    Check(listens.Count == 1, "One completed play must submit once");
    Check(listens[0].StartedAt == 1_800_000_000, "start timestamp");
    // Restart keeps the submitted marker and avoids duplicating the current play.
    tracker = System.Text.Json.JsonSerializer.Deserialize<ListeningTracker>(System.Text.Json.JsonSerializer.Serialize(tracker, Settings.Json), Settings.Json)!;
    Check(tracker.Observe(Sample(99.5), "test", 1_800_000_099.5) == null, "restart must not duplicate");
    // A complete replay is a new listen, with a new timestamp.
    Listen? replay = null;
    for (var i = 0; i <= 60; i++) if (tracker.Observe(Sample(i), "test", 1_800_000_100 + i) is { } l) replay = l;
    Check(replay != null && replay.StartedAt == 1_800_000_100, "replay counts again");
    var seek = new ListeningTracker();
    seek.Observe(Sample(0), "test", 1000);
    Check(seek.Observe(Sample(90), "test", 1001) == null, "seek no listen");
    Check(seek.Sessions["youtube"].Listened == 0, "Seeking must not count as listening");
    seek.Observe(Sample(90, playing: false), "test", 1002);
    seek.Observe(Sample(90, playing: false), "test", 1100);
    Check(seek.Sessions["youtube"].Listened == 0, "Paused time must not count");
    seek.Observe(Sample(90), "test", 1101);
    seek.Observe(Sample(91), "test", 1500);
    Check(seek.Sessions["youtube"].Listened == 0, "Sleep must not count");
    var invalid = new ListeningTracker();
    for (var i = 0; i <= 99; i++) Check(invalid.Observe(Sample(i, eligible: false), "test", i) == null, "ineligible");
    Check(invalid.Observe(Sample(0, duration: 29), "test", 1) == null, "short track");
    Check(invalid.Observe(Sample(0, artist: ""), "test", 1) == null, "missing artist");
    Check(invalid.Observe(Sample(double.NaN), "test", 1) == null, "NaN position");
    Check(invalid.Sessions.Count == 0, "invalid samples leave no session");
    var longTracker = new ListeningTracker(); var longListens = 0;
    for (var i = 0; i <= 300; i++) if (longTracker.Observe(Sample(i, duration: 1000, source: "soundcloud"), "test", i) != null) { Check(i == 240, "four minute rule"); longListens++; }
    Check(longListens == 1, "Long tracks count at four minutes");
    longTracker.Observe(Sample(0, duration: 30, eligible: false, source: "soundcloud"), "test", 301);
    Check(longTracker.Sessions["soundcloud"].Submitted, "Ads must not erase the already-submitted marker");
    var payload = listens[0].Payload();
    Check(payload.Num("listened_at") == 1_800_000_000, "payload listened_at");
    Check(payload.Obj("track_metadata").Str("artist_name") == "Artist", "payload artist");
    Check(payload.Obj("track_metadata").Obj("additional_info").Num("duration_ms") == 100000, "payload duration");
    Console.WriteLine("PASS: thresholds, repeat plays, duplicate protection, restart persistence, seeks, pause, sleep, ads, missing metadata, short tracks, and ListenBrainz payload");
}

// ---- Uploads (Tests/UploadTests.swift); every request is answered locally ----
{
    var stub = new StubHandler();
    using var http = new HttpClient(stub);
    var defaults = new Settings(null);
    var listen = new Listen { Id = Guid.NewGuid(), User = "test", StartedAt = 1_800_000_000, Source = "youtube", Title = "Test track", Artist = "Test artist", Album = "", Url = "https://music.youtube.com/watch?v=test", Duration = 100 };
    void Seed() { defaults.Set("history.user", "test"); defaults.Set("history.enabled", true); defaults.Set("history.pending", new List<Listen> { listen }); }
    HistoryService Make() => new(defaults, http, () => "test-token", () => true, _ => true);
    static int Pending(HistoryService h) => (int)h.State().Num("pending")!;

    Seed();
    var accepted = Make();
    accepted.Tick(); await Task.Delay(150);
    Check(Pending(accepted) == 0, "accepted listen leaves the queue");
    Check(stub.Requests.Last().RequestUri!.ToString() == "https://api.listenbrainz.org/1/submit-listens", "submit url");
    Check(stub.Requests.Last().Method == HttpMethod.Post, "submit is POST");
    Check(stub.Requests.Last().Headers.GetValues("Authorization").Single() == "Token test-token", "auth header");
    Seed(); stub.Status = 429;
    var limited = Make();
    limited.Tick(); await Task.Delay(150);
    Check(Pending(limited) == 1, "rate limited listen stays queued");
    var count = stub.Requests.Count; limited.Tick(); await Task.Delay(50); Check(stub.Requests.Count == count, "backoff holds the retry");
    limited.SetEnabled(false); limited.Tick(); Check(Pending(limited) == 1, "pause keeps the queue");
    limited.Disconnect(); Check(Pending(limited) == 0 && limited.State().Bool("enabled") == false, "disconnect clears");
    Seed(); stub.Status = 401;
    var rejected = Make();
    rejected.Tick(); await Task.Delay(150);
    Check(rejected.State().Bool("enabled") == false && Pending(rejected) == 1, "rejected token pauses and keeps the queue");
    Console.WriteLine("PASS: authenticated submission, accepted queue removal, rate-limit backoff, pause, disconnect, rejected credentials. All HTTP requests intercepted locally; no listens uploaded.");
}

// ---- Release matching (Tests/MusicInfoTests.swift) ----
{
    static JsonObject Row(string title, string artist, string date, string note = "") => new()
    {
        ["id"] = "03cbd558-2cff-4b94-8238-e40528b91980", ["title"] = title,
        ["artist-credit"] = new JsonArray(new JsonObject { ["name"] = artist }), ["first-release-date"] = date, ["disambiguation"] = note,
    };
    var rows = new JsonArray(Row("Hover", "Nick DePirro", "2024-02-16"), Row("Hover", "Wrong Artist", "1994"), Row("Hover (Live)", "Nick DePirro", "2020"),
        Row("Hover", "Nick DePirro", "2024-02", "different version"), Row("Hover", "Nick DePirro", "2024-02-16"), Row("Hover", "Nick DePirro", "not a date"));
    var matches = MusicInfo.Matches(rows, "Hover", "Nick DePirro", "album");
    Check(matches.Count == 2, "two versions");
    Check(matches[0]["date"] == "2024-02-16" && matches[1]["date"] == "2024-02", "dates");
    Check(matches[0]["url"].Contains("/release-group/"), "album link");
    Check(MusicInfo.Matches(rows, "Hover", "Other", "song").Count == 0, "artist must match");
    Check(MusicInfo.Normalized("Beyoncé!") == MusicInfo.Normalized("BEYONCE"), "accents and case fold");
    Console.WriteLine("PASS: exact artist/title matching, partial release dates, version ambiguity, duplicate suppression, invalid-date rejection, and source links");
}

sealed class StubHandler : HttpMessageHandler
{
    public int Status = 200;
    public readonly List<HttpRequestMessage> Requests = new();
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        Requests.Add(request);
        var response = new HttpResponseMessage((HttpStatusCode)Status) { Content = new StringContent("{\"status\":\"ok\"}") };
        response.Headers.TryAddWithoutValidation("Retry-After", "120");
        return Task.FromResult(response);
    }
}
