using System.Text.Json.Serialization;
using System.Text.Json.Serialization.Metadata;

namespace DeepOrca.Core.Types;

/// <summary>
/// 全 Core 共享的 STJ source-gen 上下文。存储格式（sessions-index / messages.jsonl /
/// settings）为 camelCase，与 TS / apple 版字节兼容（design §五 Codable 行）。
/// 线上协议（OpenAI wire）字段为 snake_case，由 Llm 层手工拼 JsonNode，不走本上下文。
/// </summary>
[JsonSourceGenerationOptions(
    PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase,
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    WriteIndented = false)]
[JsonSerializable(typeof(SessionMessage))]
[JsonSerializable(typeof(SessionEntry))]
[JsonSerializable(typeof(SessionsIndex))]
[JsonSerializable(typeof(ModelUsage))]
[JsonSerializable(typeof(ToolCall))]
[JsonSerializable(typeof(ToolDefinition))]
[JsonSerializable(typeof(DeepOrcaSettings))]
[JsonSerializable(typeof(EndpointConfig))]
[JsonSerializable(typeof(PermissionSettings))]
[JsonSerializable(typeof(McpServerConfig))]
[JsonSerializable(typeof(Dictionary<string, McpServerConfig>))]
[JsonSerializable(typeof(List<string>))]
internal sealed partial class CoreJsonContext : JsonSerializerContext
{
}

/// <summary>Shared serializer entry points (thin wrapper over the source-gen context).</summary>
public static class CoreJson
{
    public static string Serialize<T>(T value) where T : class
    {
        var info = CoreJsonContext.Default.GetTypeInfo(typeof(T))
            ?? throw new InvalidOperationException($"No JsonTypeInfo for {typeof(T).Name}");
        return System.Text.Json.JsonSerializer.Serialize(value, info);
    }

    public static T? Deserialize<T>(string json) where T : class
    {
        var info = CoreJsonContext.Default.GetTypeInfo(typeof(T))
            ?? throw new InvalidOperationException($"No JsonTypeInfo for {typeof(T).Name}");
        return (T?)System.Text.Json.JsonSerializer.Deserialize(json, info);
    }
}
