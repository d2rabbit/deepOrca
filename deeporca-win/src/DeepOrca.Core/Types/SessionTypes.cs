using System.Text.Json.Nodes;

namespace DeepOrca.Core.Types;

// SessionTypes — 会话核心数据模型（对拍 apple SessionTypes.swift / 上游 session-types.ts）
// 存储 camelCase（CoreJson source-gen），与 TS / apple JSONL 字节兼容。

public enum SessionStatus
{
    Failed,
    Pending,
    Processing,
    WaitingForUser,
    Completed,
    Interrupted,
    Paused,
    AskPermission,
    PermissionDenied,
}

public enum SessionMessageRole
{
    System,
    User,
    Assistant,
    Tool,
}

public static class SessionWire
{
    /// <summary>存储/索引 wire 名（snake_case，如 "waiting_for_user"）↔ enum。</summary>
    public static string Wire(this SessionStatus status) => status switch
    {
        SessionStatus.Failed => "failed",
        SessionStatus.Pending => "pending",
        SessionStatus.Processing => "processing",
        SessionStatus.WaitingForUser => "waiting_for_user",
        SessionStatus.Completed => "completed",
        SessionStatus.Interrupted => "interrupted",
        SessionStatus.Paused => "paused",
        SessionStatus.AskPermission => "ask_permission",
        SessionStatus.PermissionDenied => "permission_denied",
        _ => "pending",
    };

    public static SessionStatus StatusFromWire(string name) => name switch
    {
        "failed" => SessionStatus.Failed,
        "pending" => SessionStatus.Pending,
        "processing" => SessionStatus.Processing,
        "waiting_for_user" => SessionStatus.WaitingForUser,
        "completed" => SessionStatus.Completed,
        "interrupted" => SessionStatus.Interrupted,
        "paused" => SessionStatus.Paused,
        "ask_permission" => SessionStatus.AskPermission,
        "permission_denied" => SessionStatus.PermissionDenied,
        _ => SessionStatus.Pending,
    };

    public static string Wire(this SessionMessageRole role) => role switch
    {
        SessionMessageRole.System => "system",
        SessionMessageRole.User => "user",
        SessionMessageRole.Assistant => "assistant",
        SessionMessageRole.Tool => "tool",
        _ => "user",
    };

    public static SessionMessageRole RoleFromWire(string name) => name switch
    {
        "system" => SessionMessageRole.System,
        "user" => SessionMessageRole.User,
        "assistant" => SessionMessageRole.Assistant,
        "tool" => SessionMessageRole.Tool,
        _ => SessionMessageRole.User,
    };
}

public sealed record ModelUsage
{
    public int PromptTokens { get; init; }
    public int CompletionTokens { get; init; }
    public int TotalTokens { get; init; }
    public Dictionary<string, int>? CompletionTokensDetails { get; init; }
    public Dictionary<string, int>? PromptTokensDetails { get; init; }
    public int? PromptCacheHitTokens { get; init; }
    public int? PromptCacheMissTokens { get; init; }
    public int? TotalReqs { get; init; }

    public static ModelUsage Empty { get; } = new();

    public void Deconstruct(out int prompt, out int completion, out int total) =>
        (prompt, completion, total) = (PromptTokens, CompletionTokens, TotalTokens);

    /// <summary>逐轮累加（record init-only：返回合并结果，调用方持有新值）。</summary>
    public ModelUsage Add(ModelUsage other) => new()
    {
        PromptTokens = PromptTokens + other.PromptTokens,
        CompletionTokens = CompletionTokens + other.CompletionTokens,
        TotalTokens = TotalTokens + other.TotalTokens,
        PromptCacheHitTokens = (PromptCacheHitTokens ?? 0) + (other.PromptCacheHitTokens ?? 0),
        PromptCacheMissTokens = (PromptCacheMissTokens ?? 0) + (other.PromptCacheMissTokens ?? 0),
        TotalReqs = (TotalReqs ?? 0) + (other.TotalReqs ?? 1),
    };
}

public sealed record SessionProcessEntry
{
    public required string StartTime { get; init; }
    public required string Command { get; init; }
    public int? TimeoutMs { get; init; }
    public string? DeadlineAt { get; init; }
    public bool? TimedOut { get; init; }
}

public sealed record TaskRef
{
    public required string TreeId { get; init; }
    public required string Branch { get; init; }
    public required string NodeId { get; init; }
}

public sealed record SkillInfo
{
    public required string Name { get; init; }
    public required string Path { get; init; }
    public required string Description { get; init; }
    public bool? IsLoaded { get; init; }
    public bool? AllowImplicitInvocation { get; init; }
    public bool? PluginOwned { get; init; }
    public List<string>? Categories { get; init; }
    public List<string>? Inputs { get; init; }
    public List<string>? Outputs { get; init; }
}

public sealed record UserPromptContent
{
    public string? Text { get; init; }
    public List<string>? ImageUrls { get; init; }
    public List<SkillInfo>? Skills { get; init; }
    public List<UserToolPermission>? Permissions { get; init; }
    public List<PermissionScope>? AlwaysAllows { get; init; }
    public AlwaysAllowPaths? AlwaysAllowPaths { get; init; }
    public bool? PlanMode { get; init; }
}

public sealed record SessionEntry
{
    public required string Id { get; init; }
    public string? Summary { get; set; }
    public string? AssistantReply { get; set; }
    public string? AssistantThinking { get; set; }
    public string? AssistantRefusal { get; set; }
    public JsonNode? ToolCalls { get; set; }
    public SessionStatus Status { get; set; } = SessionStatus.Pending;
    public string? FailReason { get; set; }
    public ModelUsage? Usage { get; set; }
    /// <summary>Keyed by model id（usagePerModel 统计，M5 TokenSummary 消费）。</summary>
    public Dictionary<string, ModelUsage>? UsagePerModel { get; set; }
    public int ActiveTokens { get; set; }
    public string CreateTime { get; init; } = DateTimeOffset.UtcNow.ToString("o");
    public string UpdateTime { get; set; } = DateTimeOffset.UtcNow.ToString("o");
    /// <summary>
    /// 后台进程跟踪（key = pid）。注意 AGENTS.md 会话索引不变量：内存形态与磁盘形态的
    /// 归一化边界由 SessionStore 负责，此 record 只承载磁盘形状。
    /// </summary>
    public Dictionary<string, SessionProcessEntry>? Processes { get; set; }
    public List<AskPermissionRequest>? AskPermissions { get; set; }
    public bool? PlanMode { get; set; }
    public TaskRef? TaskRef { get; set; }
    public bool? IsSilentSubagent { get; set; }
    public string? WorkspaceDir { get; set; }
}

public sealed record MessageMeta
{
    /// <summary>assistant tool_calls 镜像（apple 形状：[{id,name,arguments}]）。</summary>
    public JsonNode? Function { get; init; }
    public string? ParamsMd { get; init; }
    public string? ResultMd { get; init; }
    public bool? AsThinking { get; init; }
    public bool? IsSummary { get; init; }
    public bool? IsModelChange { get; init; }
    public SkillInfo? Skill { get; init; }
    public List<MessageToolPermission>? Permissions { get; init; }
    public UserPromptContent? UserPrompt { get; init; }
}

public sealed record SessionMessage
{
    public string Id { get; init; } = Guid.NewGuid().ToString();
    public required string SessionId { get; init; }
    public required SessionMessageRole Role { get; init; }
    public string? Content { get; init; }
    /// <summary>user/system 多模态附加 parts（TS contentParams 形状）。</summary>
    public JsonNode? ContentParams { get; init; }
    /// <summary>
    /// 线上协议扩展（TS messageParams 形状）：assistant 持 tool_calls；tool 持 tool_call_id
    /// —— 消息转换器按 id 配对（M1.4），存储原样透传。
    /// </summary>
    public JsonNode? MessageParams { get; init; }
    public bool Compacted { get; init; }
    public bool Visible { get; init; } = true;
    public string CreateTime { get; init; } = DateTimeOffset.UtcNow.ToString("o");
    public string UpdateTime { get; init; } = DateTimeOffset.UtcNow.ToString("o");
    public MessageMeta? Meta { get; init; }
    public string? Html { get; init; }
    public string? CheckpointHash { get; init; }

    public static SessionMessage Create(
        string sessionId,
        SessionMessageRole role,
        string? content,
        JsonNode? messageParams = null,
        MessageMeta? meta = null,
        bool compacted = false,
        JsonNode? contentParams = null) =>
        new()
        {
            SessionId = sessionId,
            Role = role,
            Content = content,
            MessageParams = messageParams,
            Meta = meta,
            Compacted = compacted,
            ContentParams = contentParams,
        };
}

public sealed record SessionsIndex
{
    public int Version { get; init; } = 1;
    public List<SessionEntry> Entries { get; set; } = [];
    public string? OriginalPath { get; init; }
}

public enum StreamPhase
{
    Start,
    Update,
    End,
}

public sealed record LlmStreamProgress
{
    public required string RequestId { get; init; }
    public string? SessionId { get; init; }
    public string StartedAt { get; init; } = DateTimeOffset.UtcNow.ToString("o");
    public int? EstimatedTokens { get; init; }
    public string? FormattedTokens { get; init; }
    public required StreamPhase Phase { get; init; }
}
