using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace Cadence.Core;

// Port of Sources/Listening.swift. Keep the two in step: the rules must match on both platforms.
public sealed record PlaybackSample(string Source, string Id, string Title, string Artist, string Album, string Url,
    double Duration, double Position, bool Playing, bool Eligible);

public sealed class Listen
{
    public Guid Id { get; set; }
    public string User { get; set; } = "";
    public long StartedAt { get; set; }
    public string Source { get; set; } = "";
    public string Title { get; set; } = "";
    public string Artist { get; set; } = "";
    public string Album { get; set; } = "";
    public string Url { get; set; } = "";
    public double Duration { get; set; }

    public JsonObject Payload()
    {
        var metadata = new JsonObject
        {
            ["track_name"] = Title,
            ["artist_name"] = Artist,
            ["additional_info"] = new JsonObject
            {
                ["submission_client"] = "Cadence",
                ["submission_client_version"] = "0.2",
                ["music_service"] = Source == "youtube" ? "youtube.com" : "soundcloud.com",
                ["origin_url"] = Url,
                ["duration_ms"] = (long)(Duration * 1000),
            },
        };
        if (Album.Length > 0) metadata["release_name"] = Album;
        return new JsonObject { ["listened_at"] = StartedAt, ["track_metadata"] = metadata };
    }
}

public sealed class ListeningTracker
{
    public sealed class Session
    {
        public string Identity { get; set; } = "";
        public double Position { get; set; }
        public double Wall { get; set; }
        public bool Playing { get; set; }
        public double Listened { get; set; }
        public long StartedAt { get; set; }
        public bool Submitted { get; set; }
    }

    public Dictionary<string, Session> Sessions { get; set; } = new();

    public Listen? Observe(PlaybackSample sample, string user, double now)
    {
        if (!(sample.Source is "youtube" or "soundcloud") || !sample.Eligible
            || sample.Id.Length == 0 || sample.Title.Length == 0 || sample.Artist.Length == 0
            || !double.IsFinite(sample.Duration) || sample.Duration < 30
            || !double.IsFinite(sample.Position) || sample.Position < 0 || sample.Position > sample.Duration + 2)
        {
            // Ads, missing metadata and unsupported media must break continuity.
            if (Sessions.TryGetValue(sample.Source, out var broken)) { broken.Playing = false; broken.Wall = now; }
            return null;
        }
        Sessions.TryGetValue(sample.Source, out var session);
        if (session == null && !sample.Playing) return null;
        var identity = sample.Id + "|" + sample.Title + "|" + sample.Artist;
        // A completed play wrapping from the end to the start is a genuine repeat.
        if (session is { Submitted: true } previous && previous.Position > sample.Duration - 6 && sample.Position < 5 && now - previous.Wall < 6)
            session = null;
        if (session?.Identity != identity)
            session = new Session { Identity = identity, Position = sample.Position, Wall = now, Playing = sample.Playing, Listened = 0, StartedAt = (long)now, Submitted = false };
        var current = session!;
        var elapsed = now - current.Wall;
        var progress = sample.Position - current.Position;
        // Never count seeks, buffering, paused time, sleep, or long sampling gaps.
        if (current.Playing && sample.Playing && elapsed > 0 && elapsed <= 5 && progress > 0 && progress <= elapsed + 0.75)
            current.Listened += Math.Min(elapsed, progress);
        current.Wall = now; current.Position = sample.Position; current.Playing = sample.Playing;
        var qualifies = !current.Submitted && current.Listened >= Math.Min(sample.Duration / 2, 240);
        if (qualifies) current.Submitted = true;
        Sessions[sample.Source] = current;
        if (!qualifies) return null;
        return new Listen
        {
            Id = Guid.NewGuid(), User = user, StartedAt = current.StartedAt, Source = sample.Source, Title = sample.Title,
            Artist = sample.Artist, Album = sample.Album, Url = sample.Url, Duration = sample.Duration,
        };
    }
}
