using System.Text.Json.Nodes;

namespace DeepOrca.Core.Types;

// SettingsTypes — 配置模型（对拍 apple SettingsTypes.swift / 上游 settings.ts）
// 关键兼容点：TS settings.json 的 endpoints[] 数组形态（首条为主端点）。

public sealed record EndpointConfig
{
    public required string Id { get; init; }
    public required string BaseUrl { get; init; }
    public string? ApiKey { get; init; }
    public List<string>? Models { get; init; }
}

public sealed record RoutingSettings
{
    public bool Enabled { get; init; } = true;
    public string? EmbeddingModel { get; init; }
    public int? SkillShortlistSize { get; init; }
    public int? ToolShortlistSize { get; init; }
    /// <summary>G3 分片注入：大 SKILL.md 切片后仅注入召回分片；minChars 阈值、topK 召回数。</summary>
    public bool? SkillSharding { get; init; }
    public int? ShardMinChars { get; init; }
    public int? ShardTopK { get; init; }
}

public enum WorkspaceTrust
{
    Trusted,
    Quarantine,
}

public sealed record McpServerConfig
{
    public required string Name { get; init; }
    public required string Command { get; init; }
    public List<string> Args { get; init; } = [];
    public Dictionary<string, string>? Env { get; init; }
    public string? Cwd { get; init; }
    public bool Enabled { get; init; } = true;
}

public sealed record PathGrant
{
    public List<string>? Read { get; init; }
    public List<string>? Write { get; init; }
    public List<string>? Delete { get; init; }
}

public sealed record DebugOptions
{
    public bool Enabled { get; init; }
    public string Location { get; init; } = "";
    public string? BaseUrl { get; init; }
    public JsonObject? Params { get; init; }
}

public sealed record DeepOrcaSettings
{
    public string Model { get; init; } = "deepseek-chat";
    public string? ApiKey { get; init; }
    public string? BaseUrl { get; init; } = "https://api.deepseek.com/v1";
    public List<EndpointConfig>? Endpoints { get; init; }
    public string? PrimaryEndpointId { get; init; }
    public PermissionSettings Permissions { get; init; } = new();
    public Dictionary<string, McpServerConfig> McpServers { get; init; } = [];
    public WorkspaceTrust WorkspaceTrust { get; init; } = WorkspaceTrust.Trusted;
    public RoutingSettings? Routing { get; init; }
    public string? WebSearchTool { get; init; }
    public string? VisionModel { get; init; }
    public string? VisionApiKey { get; init; }
    public int CompactTokenThreshold { get; init; } = 64000;
    public int StreamIdleTimeoutMs { get; init; } = 120000;
    public Dictionary<string, bool> EnabledSkills { get; init; } = [];

    /// <summary>
    /// 解析 TS 形态 settings.json（对拍 apple fromTSJSON）：
    /// model/baseURL/apiKey + endpoints[]（首条胜出：baseURL/apiKey/models[0].id）+
    /// primaryEndpointId + permissions（defaultMode/allow/ask/deny）+ mcpServers（原形透传）。
    /// 未识别键忽略（前向兼容）。
    /// </summary>
    public static DeepOrcaSettings FromTsJson(JsonObject json)
    {
        var settings = new DeepOrcaSettings
        {
            Model = AnyJson.GetString(json["model"]) ?? "deepseek-chat",
            BaseUrl = AnyJson.GetString(json["baseURL"]) ?? "https://api.deepseek.com/v1",
            ApiKey = AnyJson.GetString(json["apiKey"]),
        };

        // endpoints[]：TS 形态，第一条是主端点
        if (AnyJson.AsArray(json["endpoints"]) is { } endpoints && endpoints.Count > 0 && endpoints[0] is JsonObject first)
        {
            settings = settings with
            {
                BaseUrl = AnyJson.GetString(first["baseURL"]) ?? settings.BaseUrl,
                ApiKey = AnyJson.GetString(first["apiKey"]) ?? settings.ApiKey,
                Endpoints = [.. endpoints.OfType<JsonObject>().Select(EndpointFromTsJson)],
            };
            if (AnyJson.AsArray(first["models"]) is { } models && models.Count > 0
                && models[0] is JsonObject firstModel
                && AnyJson.GetString(firstModel["id"]) is { } modelId)
            {
                settings = settings with { Model = modelId };
            }
            if (AnyJson.GetString(json["primaryEndpointId"]) is { } primaryId)
            {
                settings = settings with { PrimaryEndpointId = primaryId };
            }
        }

        if (AnyJson.AsObject(json["permissions"]) is { } perms)
        {
            settings = settings with { Permissions = PermissionSettingsFromTsJson(perms) };
        }

        if (AnyJson.AsObject(json["mcpServers"]) is { } mcp)
        {
            var configs = new Dictionary<string, McpServerConfig>();
            foreach (var (name, raw) in mcp)
            {
                if (raw is not JsonObject cfg) continue;
                configs[name] = new McpServerConfig
                {
                    Name = name,
                    Command = AnyJson.GetString(cfg["command"]) ?? "",
                    Args = AnyJson.AsArray(cfg["args"])?.OfType<JsonValue>()
                               .Select(v => v.GetValue<string>()).ToList() ?? [],
                    Env = AnyJson.AsObject(cfg["env"]) is { } env
                        ? env.Where(kv => kv.Value is not null)
                             .ToDictionary(kv => kv.Key, kv => kv.Value!.GetValue<string>())
                        : null,
                    Cwd = AnyJson.GetString(cfg["cwd"]),
                    Enabled = AnyJson.GetBool(cfg["enabled"]) ?? true,
                };
            }
            settings = settings with { McpServers = configs };
        }

        return settings;
    }

    private static EndpointConfig EndpointFromTsJson(JsonObject ep) => new()
    {
        Id = AnyJson.GetString(ep["id"]) ?? Guid.NewGuid().ToString(),
        BaseUrl = AnyJson.GetString(ep["baseURL"]) ?? "",
        ApiKey = AnyJson.GetString(ep["apiKey"]),
        Models = AnyJson.AsArray(ep["models"]) is { } models
            ? models.OfType<JsonObject>()
                    .Select(m => AnyJson.GetString(m["id"]))
                    .Where(id => id is not null)
                    .Cast<string>()
                    .ToList()
            : null,
    };

    /// <summary>TS permissions 块：defaultMode + allow/ask/deny scope 列表。</summary>
    public static PermissionSettings PermissionSettingsFromTsJson(JsonObject json)
    {
        var mode = PermissionMode.Balanced;
        var allowAll = false;
        switch (AnyJson.GetString(json["defaultMode"])?.ToLowerInvariant())
        {
            case "allowall":
                mode = PermissionMode.Permissive;
                allowAll = true;
                break;
            case "askall":
            case "strict":
                mode = PermissionMode.Strict;
                break;
            case "permissive":
                mode = PermissionMode.Permissive;
                break;
            case "normal":
                mode = PermissionMode.Normal;
                break;
        }

        return new PermissionSettings
        {
            Mode = mode,
            AllowAll = allowAll,
            Allows = DecodeScopes(json["allow"]),
            Asks = DecodeScopes(json["ask"]),
            Denies = DecodeScopes(json["deny"]),
        };
    }

    private static List<PermissionScope>? DecodeScopes(JsonNode? raw) =>
        AnyJson.AsArray(raw) is { } arr
            ? arr.OfType<JsonValue>()
                 .Select(v => v.GetValue<string>())
                 .Select(PermissionScopeNames.FromWire)
                 .Where(s => s != PermissionScope.Unknown)
                 .ToList()
            : null;
}
