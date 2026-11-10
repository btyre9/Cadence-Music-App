using System.Text.Json.Nodes;

namespace Cadence.Core;

public sealed class CadenceException(string message) : Exception(message);

// Port of recommendations() in Sources/main.swift.
public static class Recommendations
{
    private static async Task<JsonNode?> Get(HttpClient http, string url, CancellationToken cancel)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancel);
        timeout.CancelAfter(TimeSpan.FromSeconds(25));
        var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.TryAddWithoutValidation("User-Agent", "CadenceWindows/0.3 (personal Windows music workspace)");
        using var response = await http.SendAsync(request, timeout.Token);
        var status = (int)response.StatusCode;
        if (status == 204) throw new CadenceException("ListenBrainz hasn’t generated recommendations yet. Add listening history and try again later.");
        if (status == 404) throw new CadenceException("That ListenBrainz user wasn’t found. Check your username.");
        if (status == 429) throw new CadenceException("ListenBrainz is busy. Please wait a little before refreshing.");
        if (status != 200) throw new CadenceException($"ListenBrainz couldn’t complete the request ({status}). Please try again later.");
        return JsonNode.Parse(await response.Content.ReadAsStringAsync(timeout.Token));
    }

    public static async Task<JsonArray> Fetch(HttpClient http, string name, CancellationToken cancel)
    {
        var data = await Get(http, $"https://api.listenbrainz.org/1/cf/recommendation/user/{Uri.EscapeDataString(name)}/recording?count=24", cancel);
        var ids = (data.Obj("payload").Arr("mbids") ?? new JsonArray()).Select(row => row.Str("recording_mbid")).OfType<string>().ToList();
        if (ids.Count == 0) throw new CadenceException("No recommendations yet. ListenBrainz needs more listening history first.");
        cancel.ThrowIfCancellationRequested();
        var lookup = await Get(http, $"https://api.listenbrainz.org/1/metadata/recording/?recording_mbids={Uri.EscapeDataString(string.Join(",", ids))}&inc={Uri.EscapeDataString("artist release")}", cancel) as JsonObject ?? new JsonObject();
        var result = new JsonArray();
        foreach (var id in ids)
        {
            var row = lookup[id] as JsonObject;
            if (row.Obj("recording").Str("name") is not { } title) continue;
            var release = row.Obj("release");
            var caa = release.Str("caa_release_mbid");
            result.Add(new JsonObject
            {
                ["id"] = id, ["title"] = title, ["artist"] = row.Obj("artist").Str("name") ?? "Unknown artist",
                ["album"] = release.Str("name") ?? "", ["art"] = caa != null ? $"https://coverartarchive.org/release/{caa}/front-250" : "",
            });
        }
        if (result.Count == 0) throw new CadenceException("Recommendations arrived, but track details are temporarily unavailable.");
        return result;
    }
}
