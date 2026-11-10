using System.Text.Json;
using System.Text.Json.Nodes;

namespace Cadence.Core;

// Typed reads that return null instead of throwing, like Swift's `as? String`.
public static class JsonExtensions
{
    public static string? Str(this JsonNode? node, string key) =>
        node is JsonObject o && o[key] is JsonValue v && v.GetValueKind() == JsonValueKind.String ? v.GetValue<string>() : null;

    public static double? Num(this JsonNode? node, string key)
    {
        if (node is not JsonObject o || o[key] is not JsonValue v || v.GetValueKind() != JsonValueKind.Number) return null;
        if (v.TryGetValue<double>(out var d)) return d;
        if (v.TryGetValue<long>(out var l)) return l;
        if (v.TryGetValue<int>(out var i)) return i;
        return null;
    }

    public static bool? Bool(this JsonNode? node, string key) =>
        node is JsonObject o && o[key] is JsonValue v ? v.GetValueKind() switch { JsonValueKind.True => true, JsonValueKind.False => false, _ => null } : null;

    public static string? Str(this JsonNode? node) =>
        node is JsonValue v && v.GetValueKind() == JsonValueKind.String ? v.GetValue<string>() : null;

    public static JsonObject? Obj(this JsonNode? node, string key) => node is JsonObject o ? o[key] as JsonObject : null;
    public static JsonArray? Arr(this JsonNode? node, string key) => node is JsonObject o ? o[key] as JsonArray : null;
}
