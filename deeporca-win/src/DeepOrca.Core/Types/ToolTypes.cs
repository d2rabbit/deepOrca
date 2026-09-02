using System.Text.Json.Nodes;

namespace DeepOrca.Core.Types;

// ToolTypes — 工具系统数据模型（对拍 apple ToolTypes.swift / 上游 common/tool-types.ts）

public enum ToolErrorType
{
    InputParse,
    Execution,
    PermissionDenied,
    Timeout,
    NotFound,
    Network,
}

public sealed record ToolCallFunction(string Name, string Arguments);

public sealed record ToolCall(
    string Id,
    ToolCallFunction Function,
    string Type = "function");

public sealed record ToolFunctionDefinition(string Name, string Description, ToolParameters Parameters);

public sealed record ToolDefinition(ToolFunctionDefinition Function, string Type = "function");

public sealed record ToolParameters(string Type = "object")
{
    public Dictionary<string, ToolProperty>? Properties { get; init; }
    public List<string>? Required { get; init; }
}

/// <summary>JSON Schema property. Recursive by design (properties → items → properties).</summary>
public sealed record ToolProperty(string Type)
{
    public string? Description { get; init; }
    public Dictionary<string, ToolProperty>? Properties { get; init; }
    public ToolProperty? Items { get; init; }
    public List<string>? EnumValues { get; init; }
}

/// <summary>Execution context handed to every tool handler.</summary>
public sealed record ToolExecutionContext
{
    public required string SessionId { get; init; }
    public required string ProjectRoot { get; init; }
    public required string Cwd { get; init; }
    public required string ToolCallId { get; init; }
    public required string ToolName { get; init; }
    public required JsonObject Arguments { get; init; }
    public Func<bool>? IsCancelled { get; init; }
}

/// <summary>{ ok, name, output?, error?, errorType?, retryable?, metadata? } 序列化契约（上游 tool 结果形状）。</summary>
public sealed record ToolExecutionResult
{
    public required bool Ok { get; init; }
    public required string Name { get; init; }
    public string? Output { get; init; }
    public string? Error { get; init; }
    /// <summary>错误分类（inputParse / execution / permissionDenied / timeout / notFound / network）。</summary>
    public string? ErrorType { get; init; }
    /// <summary>重试可行性（权限拒绝类为 false）。</summary>
    public bool? Retryable { get; init; }
    public JsonObject? Metadata { get; init; }
    public bool? AwaitUserResponse { get; init; }
    public List<FollowUpMessage>? FollowUpMessages { get; init; }

    public static ToolExecutionResult OkResult(string name, string output, JsonObject? metadata = null) =>
        new() { Ok = true, Name = name, Output = output, Metadata = metadata };

    public static ToolExecutionResult Fail(
        string name, string error, string? errorType = null, JsonObject? metadata = null, bool? retryable = null) =>
        new() { Ok = false, Name = name, Error = error, ErrorType = errorType, Metadata = metadata, Retryable = retryable };
}

public sealed record FollowUpMessage(string Content, string Role = "system")
{
    public JsonNode? ContentParams { get; init; }
}

// ── Permission 基础类型（对拍 ToolTypes.swift 中的 permission 区块）──

public enum PermissionDecision
{
    Allow,
    Deny,
    Ask,
}

public enum PermissionScope
{
    ReadInCwd,
    ReadOutCwd,
    WriteInCwd,
    WriteOutCwd,
    DeleteInCwd,
    DeleteOutCwd,
    QueryGitLog,
    MutateGitLog,
    Network,
    Mcp,
    Unknown,
}

public static class PermissionScopeNames
{
    /// <summary>TS/settings wire name ↔ enum（"read-in-cwd" 等连字符名是存储/设置格式）。</summary>
    public static string Wire(this PermissionScope scope) => scope switch
    {
        PermissionScope.ReadInCwd => "read-in-cwd",
        PermissionScope.ReadOutCwd => "read-out-cwd",
        PermissionScope.WriteInCwd => "write-in-cwd",
        PermissionScope.WriteOutCwd => "write-out-cwd",
        PermissionScope.DeleteInCwd => "delete-in-cwd",
        PermissionScope.DeleteOutCwd => "delete-out-cwd",
        PermissionScope.QueryGitLog => "query-git-log",
        PermissionScope.MutateGitLog => "mutate-git-log",
        PermissionScope.Network => "network",
        PermissionScope.Mcp => "mcp",
        _ => "unknown",
    };

    public static PermissionScope FromWire(string name) => name switch
    {
        "read-in-cwd" => PermissionScope.ReadInCwd,
        "read-out-cwd" => PermissionScope.ReadOutCwd,
        "write-in-cwd" => PermissionScope.WriteInCwd,
        "write-out-cwd" => PermissionScope.WriteOutCwd,
        "delete-in-cwd" => PermissionScope.DeleteInCwd,
        "delete-out-cwd" => PermissionScope.DeleteOutCwd,
        "query-git-log" => PermissionScope.QueryGitLog,
        "mutate-git-log" => PermissionScope.MutateGitLog,
        "network" => PermissionScope.Network,
        "mcp" => PermissionScope.Mcp,
        _ => PermissionScope.Unknown,
    };
}

public sealed record UserToolPermission(string ToolCallId, string Permission);

public sealed record MessageToolPermission(string ToolCallId, PermissionDecision Permission);

public sealed record AskPermissionRequest
{
    public string Id { get; init; } = Guid.NewGuid().ToString();
    public required string ToolCallId { get; init; }
    public required List<PermissionScope> Scopes { get; init; }
    public required string Name { get; init; }
    public required string Command { get; init; }
    public string? Description { get; init; }
    public string? FilePath { get; init; }
}

public sealed record PermissionPlan
{
    public List<MessageToolPermission> Permissions { get; init; } = [];
    public List<AskPermissionRequest> AskPermissions { get; init; } = [];
}

// ── OpenAI 线上消息（域侧形状；HTTP 请求体由 Llm 层拼 snake_case）──

public sealed record ChatMessage
{
    public required string Role { get; init; }
    public string? Content { get; init; }
    public string? ReasoningContent { get; init; }
    public List<ToolCall>? ToolCalls { get; init; }
    public string? ToolCallId { get; init; }
    public string? Refusal { get; init; }
}

// ── 进程超时控制 ──

public sealed record ProcessTimeoutInfo
{
    public required int TimeoutMs { get; init; }
    public DateTimeOffset Deadline { get; } = DateTimeOffset.UtcNow.AddMilliseconds(0);

    public static ProcessTimeoutInfo Start(int timeoutMs) => new() { TimeoutMs = timeoutMs };
}

public sealed record BackgroundProcessCompletion
{
    public required int Pid { get; init; }
    public int? ExitCode { get; init; }
    public int? Signal { get; init; }
    public required string Output { get; init; }
    public required bool TimedOut { get; init; }
}
