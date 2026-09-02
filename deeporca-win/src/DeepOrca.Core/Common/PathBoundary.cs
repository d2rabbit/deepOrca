using DeepOrca.Core.Types;

namespace DeepOrca.Core.Common;

// PathBoundary — 执行期路径边界门（对拍上游 common/path-boundary.ts，P0 沙盒 §4.1）。
// 无权限语义的纯路径原语：权限层分类 in/out-of-cwd，这里在每次 fs 触碰前强制。

public sealed record PathGrant
{
    /// <summary>允许的写根（realpath 归一）；恒含 realpath(projectRoot)。</summary>
    public required string[] WriteRoots { get; init; }
    /// <summary>允许的读根：realpath(projectRoot) + 豁免路径。</summary>
    public required string[] ReadRoots { get; init; }
    /// <summary>本次调用的 write-out-cwd 已解析为 allow（一次性授权无法表达为根列表）。</summary>
    public bool AllowWriteOutsideRoots { get; init; }
    /// <summary>本次调用的 read-out-cwd 已解析为 allow。</summary>
    public bool AllowReadOutsideRoots { get; init; }

    public static PathGrant ProjectOnly(string projectRoot) => new()
    {
        WriteRoots = [PathBoundary.ResolveGateRoot(projectRoot)],
        ReadRoots = [PathBoundary.ResolveGateRoot(projectRoot)],
    };
}

public sealed record GateVerdict
{
    public bool Ok { get; init; }
    public string? Reason { get; init; }
    public string? Scope { get; init; }

    public static GateVerdict Allowed => new() { Ok = true };
    public static GateVerdict Denied(string scope, string reason) => new() { Ok = false, Scope = scope, Reason = reason };
}

/// <summary>带隔离语义的 out-of-cwd 布尔推导（quarantined 工作区双 false）。</summary>
public static class PathBoundary
{
    public const int MaxSymlinkDepth = 10;

    public static (bool Write, bool Read) GrantOutsideRootsFlags(IEnumerable<string> scopes, bool quarantined)
    {
        if (quarantined) return (false, false);
        var set = scopes.ToHashSet();
        return (set.Contains("write-out-cwd"), set.Contains("read-out-cwd"));
    }

    /// <summary>读门（gateRead 直译）。无 grant 时退化为 projectRoot 独有、外溢双 false（fail-closed）。</summary>
    public static GateVerdict GateRead(PathGrant? grant, string filePath, string? projectRoot = null)
    {
        var candidate = ResolveGateCandidate(filePath);
        var roots = grant is { } g ? g.ReadRoots : projectRoot is { } r ? [r] : [];
        if (IsPathInRoots(roots, candidate)) return GateVerdict.Allowed;
        if (grant?.AllowReadOutsideRoots == true) return GateVerdict.Allowed;
        return GateVerdict.Denied("read-out-cwd",
            $"Read target is outside the allowed read boundary: {filePath}. This path was not authorized for out-of-project reads. If reading there is genuinely required, ask the user to grant the \"read-out-cwd\" permission.");
    }

    /// <summary>写门（gateWrite 直译）。</summary>
    public static GateVerdict GateWrite(PathGrant? grant, string filePath, string? projectRoot = null)
    {
        var candidate = ResolveGateCandidate(filePath);
        var roots = grant is { } g ? g.WriteRoots : projectRoot is { } r ? [r] : [];
        if (IsPathInRoots(roots, candidate)) return GateVerdict.Allowed;
        if (grant?.AllowWriteOutsideRoots == true) return GateVerdict.Allowed;
        return GateVerdict.Denied("write-out-cwd",
            $"Write target is outside the allowed write boundary: {filePath}. This path was not authorized for out-of-project writes. If writing there is genuinely required, ask the user to grant the \"write-out-cwd\" permission.");
    }

    /// <summary>门判定的规范化候选：链式符号链接 + 父目录 realpath（写目标可能尚不存在）。</summary>
    public static string ResolveGateCandidate(string filePath)
    {
        var resolved = FollowSymlinkChain(Path.GetFullPath(filePath), 0);
        var realParent = SafeRealPath(Path.GetDirectoryName(resolved) ?? resolved) ?? Path.GetDirectoryName(resolved) ?? resolved;
        return Path.Combine(realParent, Path.GetFileName(resolved));
    }

    /// <summary>授权根与门候选共享同一规范化器（否则 /tmp ↔ /private/tmp 确定性失配）。</summary>
    public static string ResolveGateRoot(string root) => ResolveGateCandidate(root);

    private static string FollowSymlinkChain(string target, int depth)
    {
        if (depth >= MaxSymlinkDepth) return target;
        FileSystemInfo info;
        try
        {
            info = new FileInfo(target);
            if (!info.Exists && !Directory.Exists(target))
            {
                // 不存在 → 追父链（写目标常见）
                var parent = Path.GetDirectoryName(target);
                return parent is null ? target : Path.Combine(FollowSymlinkChain(parent, depth + 1), Path.GetFileName(target));
            }
        }
        catch
        {
            return target;
        }

        var linkTarget = ResolveLink(target);
        if (linkTarget is null) return SafeRealPath(target) ?? target;
        return FollowSymlinkChain(Path.Combine(Path.GetDirectoryName(target) ?? "", linkTarget), depth + 1);
    }

    private static string? ResolveLink(string path)
    {
        try
        {
            return File.ResolveLinkTarget(path, returnFinalTarget: false)?.FullName
                ?? Directory.ResolveLinkTarget(path, returnFinalTarget: false)?.FullName;
        }
        catch
        {
            return null;
        }
    }

    public static string? SafeRealPath(string target)
    {
        try
        {
            var dir = Path.GetDirectoryName(target);
            var real = dir is null ? target : Path.Combine(Path.GetFullPath(dir), Path.GetFileName(target));
            if (File.Exists(target)) return Path.GetFullPath(target);
            if (Directory.Exists(real)) return real;
            return null;
        }
        catch
        {
            return null;
        }
    }

    private static bool IsPathInRoots(string[] roots, string candidate)
    {
        foreach (var root in roots)
        {
            var realRoot = SafeRealPath(root) ?? Path.GetFullPath(root);
            var relative = Path.GetRelativePath(realRoot, candidate);
            if (relative == "." || (relative != ".." && !relative.StartsWith("..") && !Path.IsPathRooted(relative)))
            {
                return true;
            }
        }
        return false;
    }
}