using System.Text.RegularExpressions;
using DeepOrca.Core.Types;

namespace DeepOrca.Core.Permissions;

public enum BashSideEffect
{
    /// <summary>Modifies files/directories: rm, mv, cp, touch, mkdir, rmdir, truncate, dd, tee…</summary>
    FileMutation,
    /// <summary>Mutates git history: commit, reset, rebase, tag, push, rm --cached…</summary>
    GitHistoryMutation,
    /// <summary>Deletes content: rm -rf, shred, unlink.</summary>
    Delete,
    /// <summary>Executes inline code: python -c, node -e, eval, $( )…</summary>
    InlineInterpreter,
    /// <summary>Network access: curl, wget, nc, ssh, git clone/fetch/pull…</summary>
    Network,
    /// <summary>Installs/modifies system packages: brew, apt, npm install, pip install…</summary>
    PackageMutation,
    /// <summary>Pipes directly into a shell (command | bash/sh/zsh).</summary>
    PipeToShell,
}

/// <summary>
/// bash 命令副作用推断（对拍 apple BashSideEffectInference.swift / 上游 inferBashSideEffects）。
/// 推断只能加风险，不能减风险。
/// </summary>
public static class BashSideEffectInference
{
    private static bool Matches(string text, params string[] patterns) =>
        patterns.Any(p => Regex.IsMatch(text, p));

    public static HashSet<BashSideEffect> Infer(string command)
    {
        var effects = new HashSet<BashSideEffect>();
        var lower = command.ToLowerInvariant();

        // ── 文件改动 ──
        if (Matches(lower,
                @"\brm\b", @"\bmv\b", @"\bcp\b", @"\btouch\b", @"\bmkdir\b",
                @"\brmdir\b", @"\btruncate\b", @"\bdd\b", @"\btee\b",
                @"\bsed\s+-i", @"\bperl\s+-pi", @"\bshred\b", @"\bunlink\b",
                @"\bchmod\b", @"\bchown\b", @"\bmv\s+.*\s+.*"))
        {
            effects.Add(BashSideEffect.FileMutation);
        }

        // ── 删除 ──
        if (Matches(lower,
                @"\brm\s+-[a-z]*r[a-z]*f?", @"\brm\s+-[a-z]*f[a-z]*",
                @"\brm\s+-[a-z]*r", @"\bshred\b", @"\btruncate\s+-s\s+0",
                @"\brm\s+--recursive", @"\bunlink\b"))
        {
            effects.Add(BashSideEffect.Delete);
        }

        // ── git 历史改动（query-only 的 log/status/diff/branch/show 不算）──
        if (Matches(lower,
                @"\bgit\s+(commit|reset|rebase|tag|push|fetch|pull|merge|revert|cherry-pick|gc|prune|filter-branch|replace|update-ref|am)",
                @"\bgit\s+commit", @"\bgit\s+reset", @"\bgit\s+rebase",
                @"\bgit\s+rm\s+--cached", @"\bgit\s+clean", @"\bgit\s+checkout\s+-[bf]"))
        {
            effects.Add(BashSideEffect.GitHistoryMutation);
        }

        // ── 内联解释器 ──
        if (Matches(lower,
                @"(python|python3|py|node|nodejs|ruby|php|perl|bash|sh|zsh|fish|tclsh|awk|mawk|gawk)\s+-c\s+",
                @"\beval\s+", @"\$\(", @"`[^`]+`"))
        {
            effects.Add(BashSideEffect.InlineInterpreter);
        }

        // ── 网络 ──
        if (Matches(lower,
                @"\bcurl\b", @"\bwget\b", @"\bnc\b", @"\bncat\b",
                @"\bssh\b", @"\bscp\b", @"\brsync\b", @"\bsftp\b",
                @"\bgit\s+(clone|fetch|pull|push|ls-remote)",
                @"\bbrew\s+(install|update|upgrade)",
                @"\bsocat\b", @"\bftp\b",
                @"https?://"))
        {
            effects.Add(BashSideEffect.Network);
        }

        // ── 包管理改动 ──
        if (Matches(lower,
                @"\b(brew|apt|apt-get|yum|dnf|pacman|pip|pip3|npm|yarn|pnpm|gem|go\s+install|cargo\s+install|npx)\b.*\b(install|uninstall|upgrade|update|remove|add|rm)\b",
                @"\bnpm\s+(install|uninstall|update|ci|add|rm)\b",
                @"\bpip\s+(install|uninstall|upgrade)\b",
                @"\bbrew\b", @"\bapt\b", @"\bapt-get\b"))
        {
            effects.Add(BashSideEffect.PackageMutation);
        }

        // ── 管道入 shell ──
        if (Matches(lower,
                @"\|\s*(bash|sh|zsh|fish)\b", @"tee\s+/dev/(tcp|udp)"))
        {
            effects.Add(BashSideEffect.PipeToShell);
        }

        return effects;
    }

    /// <summary>推断出的副作用 → 权限 scope 集合（对拍上游映射）。</summary>
    public static HashSet<PermissionScope> ScopesFor(string command, string cwd, string projectRoot)
    {
        var effects = Infer(command);
        var scopes = new HashSet<PermissionScope>();

        if (effects.Contains(BashSideEffect.FileMutation)) scopes.Add(PermissionScope.WriteInCwd);
        if (effects.Contains(BashSideEffect.Delete)) scopes.Add(PermissionScope.DeleteInCwd);
        if (effects.Contains(BashSideEffect.GitHistoryMutation)) scopes.Add(PermissionScope.MutateGitLog);
        if (effects.Contains(BashSideEffect.Network)) scopes.Add(PermissionScope.Network);
        if (effects.Contains(BashSideEffect.PackageMutation))
        {
            scopes.Add(PermissionScope.WriteOutCwd);
            scopes.Add(PermissionScope.Network);
        }
        if (effects.Contains(BashSideEffect.PipeToShell) || effects.Contains(BashSideEffect.InlineInterpreter))
        {
            scopes.Add(PermissionScope.ReadInCwd);
            scopes.Add(PermissionScope.WriteInCwd);
        }

        // 触及 cwd/projectRoot 之外路径的命令 → in-cwd scope 升级为 out-cwd
        if (ContainsOutsidePath(command, cwd, projectRoot))
        {
            var outScopes = scopes
                .Where(s => s is PermissionScope.WriteInCwd or PermissionScope.DeleteInCwd or PermissionScope.ReadInCwd)
                .Select(s => s switch
                {
                    PermissionScope.WriteInCwd => PermissionScope.WriteOutCwd,
                    PermissionScope.DeleteInCwd => PermissionScope.DeleteOutCwd,
                    PermissionScope.ReadInCwd => PermissionScope.ReadOutCwd,
                    _ => s,
                })
                .ToList(); // 先物化再合并（源集合即目标集合，惰性枚举会撞修改中枚举）
            scopes.UnionWith(outScopes);
        }

        if (scopes.Count == 0) scopes.Add(PermissionScope.Unknown);

        return scopes;
    }

    // ── 路径分析 ──

    private static bool ContainsOutsidePath(string command, string cwd, string projectRoot)
    {
        // 启发式：找出不在 projectRoot 下的绝对路径 / ~/ 路径。
        // Windows 增加 盘符:/ 路径形态；POSIX 保持 (~|/) 形态。
        var pathPattern = Runtime.PathIsWindows
            ? @"(~|[A-Za-z]:[\\/]|/)[^ ""'\n]*"
            : @"(~|/)[^ ""'\n]*";
        var root = ExpandHome(projectRoot);

        foreach (Match m in Regex.Matches(command, pathPattern))
        {
            var path = ExpandHome(m.Value);
            // 只读/良性系统路径跳过
            if (path.StartsWith("/usr/") || path.StartsWith("/bin/") || path.StartsWith("/etc/") ||
                path.StartsWith("/dev/") || path.StartsWith("/proc/") || path.StartsWith("/sys/"))
            {
                continue;
            }
            if (Runtime.PathIsWindows &&
                (path.StartsWith(@"C:\Windows\", StringComparison.OrdinalIgnoreCase) ||
                 path.StartsWith(@"C:\Program Files", StringComparison.OrdinalIgnoreCase)))
            {
                continue;
            }

            if (File.Exists(path) || Directory.Exists(path))
            {
                if (!IsInside(path, root)) return true;
            }
        }
        return false;
    }

    private static string ExpandHome(string path)
    {
        if (path == "~") return Runtime.HomeDir;
        if (path.StartsWith("~/") || path.StartsWith("~\\")) return Path.Combine(Runtime.HomeDir, path[2..]);
        return path;
    }

    /// <summary>带分隔符边界的前缀包含（对拍 TS path-inside 语义；apple 的裸 hasPrefix 在前缀重叠目录上误判，此处收紧）。</summary>
    internal static bool IsInside(string candidate, string root)
    {
        var c = Path.GetFullPath(candidate).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        var r = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        if (c.Equals(r, StringComparison.OrdinalIgnoreCase)) return true;
        var rWithSep = r + Path.DirectorySeparatorChar;
        return c.StartsWith(rWithSep, StringComparison.OrdinalIgnoreCase);
    }
}

/// <summary>平台探测（bash 工具 / 沙盒 / 路径推断共用；测试可注入）。</summary>
public static class Runtime
{
    public static bool PathIsWindows { get; set; } = OperatingSystem.IsWindows();
    public static string HomeDir { get; set; } = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
}
