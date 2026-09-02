using System.Text.Json;
using System.Text.Json.Nodes;

namespace DeepOrca.Core.Types;

/// <summary>
/// AnyJson — JsonNode 封装（对拍 apple AnyCodable / TS any-JSON 字段）。
/// C# 的 "Any" 值类型就是 <see cref="JsonNode"/>；本类只提供解析、序列化与
/// 深比较的静态入口，域模型里 any 字段直接持有 <see cref="JsonNode"/>。
/// </summary>
public static class AnyJson
{
    /// <summary>Parse JSON text; returns null on malformed input (never throws).</summary>
    public static JsonNode? Parse(string text)
    {
        try
        {
            return JsonNode.Parse(text);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <summary>Serialize to compact JSON (storage/JSONL shape).</summary>
    public static string Write(JsonNode? node) => node?.ToJsonString() ?? "null";

    /// <summary>Deep structural equality (order-insensitive for objects).</summary>
    public static bool DeepEquals(JsonNode? a, JsonNode? b)
    {
        if (a is null && b is null) return true;
        if (a is null || b is null) return false;
        return JsonNode.DeepEquals(a, b);
    }

    /// <summary>Build {"key": value, ...} from a dictionary.</summary>
    public static JsonObject ObjectFrom(IReadOnlyDictionary<string, JsonNode?> pairs)
    {
        var obj = new JsonObject();
        foreach (var (key, value) in pairs) obj[key] = value?.DeepClone();
        return obj;
    }

    /// <summary>Build a JSON array of strings.</summary>
    public static JsonArray ArrayFrom(IEnumerable<string> values)
    {
        var arr = new JsonArray();
        foreach (var v in values) arr.Add(v);
        return arr;
    }

    public static string? GetString(JsonNode? node) => node is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;

    public static bool? GetBool(JsonNode? node) => node is JsonValue v && v.TryGetValue<bool>(out var b) ? b : null;

    public static int? GetInt(JsonNode? node) => node is JsonValue v && v.TryGetValue<int>(out var i) ? i : null;

    public static JsonObject? AsObject(JsonNode? node) => node as JsonObject;

    public static JsonArray? AsArray(JsonNode? node) => node as JsonArray;
}
