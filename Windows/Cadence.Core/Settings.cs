using System.Text.Json;
using System.Text.Json.Nodes;

namespace Cadence.Core;

// Stands in for macOS UserDefaults: a small JSON file in %LOCALAPPDATA%\Cadence.
// A null path keeps everything in memory (used by the tests).
public sealed class Settings
{
    public static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
    private readonly string? path;
    private readonly JsonObject values;

    public Settings(string? path)
    {
        this.path = path;
        JsonObject? loaded = null;
        try { if (path != null && File.Exists(path)) loaded = JsonNode.Parse(File.ReadAllText(path)) as JsonObject; } catch { }
        values = loaded ?? new JsonObject();
    }

    public T? Get<T>(string key)
    {
        try { return values[key] is { } node ? node.Deserialize<T>(Json) : default; } catch { return default; }
    }

    public void Set<T>(string key, T value) => values[key] = JsonSerializer.SerializeToNode(value, Json);
    public void Remove(string key) => values.Remove(key);

    public void Save()
    {
        if (path == null) return;
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            var temp = path + ".tmp";
            File.WriteAllText(temp, values.ToJsonString());
            File.Move(temp, path, overwrite: true);
        }
        catch { }
    }
}
