using System.Globalization;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Cadence.Core;

// Port of Sources/MusicInfo.swift: earliest release dates from MusicBrainz, paced to one request per 1.1 s.
public sealed class MusicInfo
{
    private readonly HttpClient http;
    private readonly Dictionary<string, List<Dictionary<string, string>>> cache = new();
    private DateTime nextRequest = DateTime.MinValue;
    private static readonly Regex DatePattern = new("^[0-9]{4}(-[0-9]{2})?(-[0-9]{2})?$", RegexOptions.CultureInvariant);

    public MusicInfo(HttpClient http) { this.http = http; }

    public static string Normalized(string value)
    {
        var decomposed = value.Normalize(NormalizationForm.FormD);
        var output = new StringBuilder(decomposed.Length);
        foreach (var rune in decomposed.EnumerateRunes())
        {
            var category = Rune.GetUnicodeCategory(rune);
            if (category is UnicodeCategory.NonSpacingMark or UnicodeCategory.SpacingCombiningMark or UnicodeCategory.EnclosingMark) continue;
            if (Rune.IsLetterOrDigit(rune)) output.Append(Rune.ToLowerInvariant(rune).ToString());
        }
        return output.ToString();
    }

    private static string? CreditName(JsonNode? credit) => credit.Str("name") ?? credit.Obj("artist").Str("name");

    public static List<Dictionary<string, string>> Matches(JsonArray rows, string title, string artist, string kind)
    {
        var result = new List<Dictionary<string, string>>(); var seen = new HashSet<string>();
        foreach (var row in rows)
        {
            if (row.Str("title") is not { } name || Normalized(name) != Normalized(title)) continue;
            if (row.Arr("artist-credit") is not { } credits) continue;
            if (row.Str("first-release-date") is not { Length: > 0 } date || !DatePattern.IsMatch(date)) continue;
            if (row.Str("id") is not { } id || !Guid.TryParseExact(id, "D", out _)) continue;
            var names = credits.Select(CreditName).OfType<string>().ToList();
            var joined = string.Concat(credits.Select(c => (CreditName(c) ?? "") + (c.Str("joinphrase") ?? "")));
            if (Normalized(joined) != Normalized(artist) && !names.Any(n => Normalized(n) == Normalized(artist))) continue;
            var note = row.Str("disambiguation") ?? "";
            if (!seen.Add(date + "|" + note)) continue;
            result.Add(new()
            {
                ["title"] = name, ["artist"] = joined, ["date"] = date, ["note"] = note,
                ["url"] = $"https://musicbrainz.org/{(kind == "album" ? "release-group" : "recording")}/{id}",
            });
        }
        return result.Take(5).ToList();
    }

    public async Task<List<Dictionary<string, string>>> Lookup(string title, string artist, string kind, CancellationToken cancel)
    {
        var key = kind + "|" + title + "|" + artist;
        if (cache.TryGetValue(key, out var cached)) return cached;
        var delay = nextRequest - DateTime.UtcNow;
        nextRequest = (nextRequest > DateTime.UtcNow ? nextRequest : DateTime.UtcNow).AddSeconds(1.1);
        if (delay > TimeSpan.Zero) await Task.Delay(delay, cancel);
        cancel.ThrowIfCancellationRequested();
        var entity = kind == "album" ? "release-group" : "recording";
        // Quote query values so punctuation cannot turn a title into query operators.
        static string Quoted(string s) => "\"" + s.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";
        var query = $"{(kind == "album" ? "releasegroup" : "recording")}:{Quoted(title)} AND artist:{Quoted(artist)}";
        var url = $"https://musicbrainz.org/ws/2/{entity}/?query={Uri.EscapeDataString(query)}&fmt=json&limit=15";
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancel);
        timeout.CancelAfter(TimeSpan.FromSeconds(18));
        var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.TryAddWithoutValidation("User-Agent", "CadenceWindows/0.5 (personal Windows music metadata client)");
        using var response = await http.SendAsync(request, timeout.Token);
        if ((int)response.StatusCode != 200) throw new HttpRequestException("MusicBrainz returned " + (int)response.StatusCode);
        var root = JsonNode.Parse(await response.Content.ReadAsStringAsync(timeout.Token));
        var value = Matches(root.Arr(kind == "album" ? "release-groups" : "recordings") ?? new JsonArray(), title, artist, kind);
        if (cache.Count >= 100) cache.Clear();
        cache[key] = value;
        return value;
    }
}
