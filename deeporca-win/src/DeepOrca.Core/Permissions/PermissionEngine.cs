using System.Text.Json.Nodes;
using DeepOrca.Core.Types;

namespace DeepOrca.Core.Permissions;

// PermissionEngine — scope 化权限评估（对拍 apple PermissionEngine.swift / 上游 permissions.ts）
// 纯函数、无副作用：每次评估一条 tool call，输出 PermissionPlan。
// 优先级：显式 deny > Plan Mode 强制 ask（压过显式授权）> 显式 ask > 显式 allow
//        > 路径级授权 > 模式默认。

public static class PermissionEngine
{
    /// <summary>评估一轮 assistant turn 的全部 tool calls（最高风险 scope 决定该 call 的判定）。</summary>
    public static PermissionPlan ComputeToolCallPermissions(
        string sessionId,
        string projectRoot,
        IReadOnlyList<ToolCall> toolCalls,
        PermissionSettings settings,
        bool planMode = false,
        AlwaysAllowPaths? allowedPaths = null)
    {
        var permissions = new List<MessageToolPermission>();
        var askPermissions = new List<AskPermissionRequest>();

        foreach (var toolCall in toolCalls)
        {
            var request = DescribePermissionRequest(toolCall, projectRoot, allowedPaths);

            var resolved = PermissionDecision.Allow;
            var needsAsk = false;

            foreach (var scope in request.Scopes)
            {
                var verdict = ResolveScopeVerdict(scope, settings, planMode, request.FilePath, allowedPaths);
                switch (verdict)
                {
                    case PermissionDecision.Deny:
                        resolved = PermissionDecision.Deny;
                        break;
                    case PermissionDecision.Ask:
                        needsAsk = true;
                        if (resolved != PermissionDecision.Deny) resolved = PermissionDecision.Ask;
                        break;
                }
            }

            permissions.Add(new MessageToolPermission(toolCall.Id, resolved));
            if (needsAsk || resolved == PermissionDecision.Ask)
            {
                askPermissions.Add(request);
            }
        }

        return new PermissionPlan { Permissions = permissions, AskPermissions = askPermissions };
    }

    /// <summary>
    /// 单 scope 判定。Plan Mode force-ask 无条件压过 allow——包括用户显式授权
    /// （allow-list 条目），"touch nothing" 语义（M5 Plan Mode 的根基）。
    /// </summary>
    public static PermissionDecision ResolveScopeVerdict(
        PermissionScope scope,
        PermissionSettings settings,
        bool planMode = false,
        string? filePath = null,
        AlwaysAllowPaths? allowedPaths = null)
    {
        // 显式 deny 永远赢——Plan Mode 也不会把它转成 ask
        if (settings.Denies is { } denies && denies.Contains(scope)) return PermissionDecision.Deny;

        if (planMode && PlanMode.ForceAskScopes.Contains(scope)) return PermissionDecision.Ask;

        if (settings.Asks is { } asks && asks.Contains(scope)) return PermissionDecision.Ask;
        if (settings.Allows is { } allows && allows.Contains(scope)) return PermissionDecision.Allow;

        // 路径级 always-allow（细粒度授权）
        if (filePath is not null && PathAllowed(filePath, scope, allowedPaths)) return PermissionDecision.Allow;

        return settings.Mode switch
        {
            PermissionMode.Permissive => PermissionDecision.Allow,
            PermissionMode.Strict => PermissionDecision.Ask,
            PermissionMode.Normal => DefaultVerdict(scope),
            PermissionMode.Balanced => DefaultVerdict(scope),
            _ => DefaultVerdict(scope),
        };
    }

    /// <summary>为一条 tool call 构建用户可见的权限请求（含 bash 副作用推断）。</summary>
    public static AskPermissionRequest DescribePermissionRequest(
        ToolCall toolCall,
        string projectRoot,
        AlwaysAllowPaths? allowedPaths = null)
    {
        var name = toolCall.Function.Name;
        var args = toolCall.Function.Arguments;

        switch (name)
        {
            case "bash":
            {
                var command = ExtractJsonString(args, "command") ?? args;
                var scopes = BashSideEffectInference.ScopesFor(command, cwd: projectRoot, projectRoot: projectRoot);
                return new AskPermissionRequest
                {
                    ToolCallId = toolCall.Id,
                    Scopes = [.. scopes.OrderBy(s => s.Wire())],
                    Name = "bash",
                    Command = command.Length > 500 ? command[..500] : command,
                    Description = "Run a shell command",
                };
            }
            case "read" or "write" or "edit":
            {
                var path = ExtractJsonString(args, "file_path") ?? "";
                var inside = IsInsidePath(path, projectRoot);
                var scope = name == "read"
                    ? (inside ? PermissionScope.ReadInCwd : PermissionScope.ReadOutCwd)
                    : (inside ? PermissionScope.WriteInCwd : PermissionScope.WriteOutCwd);
                return new AskPermissionRequest
                {
                    ToolCallId = toolCall.Id,
                    Scopes = [scope],
                    Name = name,
                    Command = path,
                    Description = name == "read" ? "Read a file" : name == "write" ? "Write a file" : "Edit a file",
                    FilePath = path,
                };
            }
            case "web_search" or "web_fetch" or "mcp__web_search" or "mcp__web_fetch":
                return new AskPermissionRequest
                {
                    ToolCallId = toolCall.Id,
                    Scopes = [PermissionScope.Network],
                    Name = name,
                    Command = ExtractJsonString(args, "query") ?? args,
                    Description = "Access the network",
                };
            default:
                return new AskPermissionRequest
                {
                    ToolCallId = toolCall.Id,
                    Scopes = [PermissionScope.Unknown],
                    Name = name,
                    Command = args.Length > 300 ? args[..300] : args,
                    Description = $"Call tool {name}",
                };
        }
    }

    // ── 默认判定 ──

    private static PermissionDecision DefaultVerdict(PermissionScope scope) => scope switch
    {
        PermissionScope.ReadInCwd => PermissionDecision.Allow,
        PermissionScope.ReadOutCwd => PermissionDecision.Allow,
        PermissionScope.QueryGitLog => PermissionDecision.Allow,
        _ => PermissionDecision.Ask, // write/delete/network/mutate-git-log/mcp/unknown
    };

    // ── 路径辅助 ──

    private static bool IsInsidePath(string path, string root)
    {
        if (string.IsNullOrEmpty(path)) return false;
        try
        {
            return BashSideEffectInference.IsInside(ExpandHome(path), root);
        }
        catch
        {
            return false;
        }
    }

    private static bool PathAllowed(string filePath, PermissionScope scope, AlwaysAllowPaths? allowedPaths)
    {
        if (allowedPaths is null) return false;

        var list = scope switch
        {
            PermissionScope.ReadInCwd or PermissionScope.ReadOutCwd => allowedPaths.FileRead,
            PermissionScope.WriteInCwd or PermissionScope.WriteOutCwd => allowedPaths.FileWrite,
            PermissionScope.DeleteInCwd or PermissionScope.DeleteOutCwd => allowedPaths.FileDelete,
            _ => null,
        };
        if (list is null || list.Count == 0) return false;

        string candidate;
        try
        {
            candidate = Path.GetFullPath(ExpandHome(filePath));
        }
        catch
        {
            return false;
        }

        foreach (var allowed in list)
        {
            if (BashSideEffectInference.IsInside(candidate, allowed)) return true;
        }
        return false;
    }

    private static string ExpandHome(string path)
    {
        if (path == "~") return Runtime.HomeDir;
        if (path.StartsWith("~/") || path.StartsWith("~\\")) return Path.Combine(Runtime.HomeDir, path[2..]);
        return path;
    }

    private static string? ExtractJsonString(string argumentsJson, string key)
    {
        if (AnyJson.Parse(argumentsJson) is JsonObject obj) return AnyJson.GetString(obj[key]);
        return null;
    }
}
