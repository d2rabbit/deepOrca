namespace DeepOrca.Core.Types;

// PermissionTypes — 权限系统类型（对拍 apple PermissionTypes.swift / 上游 permissions.ts）

public sealed record PermissionRequest
{
    public string Id { get; init; } = Guid.NewGuid().ToString();
    public required string ToolCallId { get; init; }
    public required List<PermissionScope> Scopes { get; init; }
    public required string Name { get; init; }
    public required string Command { get; init; }
    public string? Description { get; init; }
    public string? FilePath { get; init; }
}

public enum PermissionMode
{
    /// <summary>Context-aware: read=allow, write=ask, delete=ask.</summary>
    Balanced,
    /// <summary>Default scopes.</summary>
    Normal,
    /// <summary>Deny-by-default.</summary>
    Strict,
    /// <summary>Allow-by-default.</summary>
    Permissive,
}

public sealed record PermissionSettings
{
    public PermissionMode Mode { get; init; } = PermissionMode.Balanced;
    public bool AllowAll { get; init; }
    public List<PermissionScope>? Asks { get; init; }
    public List<PermissionScope>? Allows { get; init; }
    public List<PermissionScope>? Denies { get; init; }
    /// <summary>Keyed by tool name.</summary>
    public Dictionary<string, List<PermissionScope>>? ToolGrants { get; init; }
}

/// <summary>Plan Mode 把这些 scope 的 allow（含显式授权）强制转 ask（M5，上游 forceAskScopes）。</summary>
public static class PlanMode
{
    public static readonly PermissionScope[] ForceAskScopes =
    [
        PermissionScope.WriteInCwd,
        PermissionScope.WriteOutCwd,
        PermissionScope.DeleteInCwd,
        PermissionScope.DeleteOutCwd,
        PermissionScope.MutateGitLog,
    ];
}

public sealed record AlwaysAllowPaths
{
    public List<string>? FileRead { get; init; }
    public List<string>? FileWrite { get; init; }
    public List<string>? FileDelete { get; init; }
}
