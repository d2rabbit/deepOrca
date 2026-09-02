using System.Text.RegularExpressions;

using DeepOrca.Core.Permissions;
namespace DeepOrca.Core.Common;

// ShellUtils — shell 解析与包装（对拍上游 common/shell-utils.ts）。
// Windows 必须 Git Bash（design §五：PowerShell 不作 POSIX 替身；缺失给安装指引）。

public static class ShellUtils
{
    public const int DefaultBashTimeoutMs = 10 * 60 * 1000;
    public const int MinBashTimeoutMs = 60 * 1000;

    private static readonly string[] WindowsGitLocations =
    [
        @"C:\Program Files\Git\cmd\git.exe",
        @"C:\Program Files (x86)\Git\cmd\git.exe",
    ];

    private static readonly string[] WindowsBashLocations =
    [
        @"C:\Program Files\Git\bin\bash.exe",
        @"C:\Program Files (x86)\Git\bin\bash.exe",
    ];

    private static readonly Regex NulRedirectRegex = new(@"(\d?&?>+\s*)[Nn][Uu][Ll](?=\s|$|[|&;)\n])", RegexOptions.Compiled);

    private static string? _cachedGitBashPath;

    public static int ClampBashTimeoutMs(int timeoutMs, int? minTimeoutMs = null)
    {
        var minimum = Math.Max(1, minTimeoutMs ?? MinBashTimeoutMs);
        return Math.Max(minimum, timeoutMs);
    }

    /// <summary>解析 shell 路径：Windows → Git Bash（多候选探测）；POSIX → $SHELL 或 /bin/bash。</summary>
    public static string ResolveShellPath(string? envShell = null)
    {
        if (Runtime.PathIsWindows) return FindGitBashPath();
        var env = envShell ?? Environment.GetEnvironmentVariable("SHELL");
        if (!string.IsNullOrEmpty(env) && !env.EndsWith("unknown") && ShellKind(env) != "unknown") return env;
        return "/bin/bash";
    }

    public static string FindGitBashPath()
    {
        if (_cachedGitBashPath is not null) return _cachedGitBashPath;

        var candidates = new List<string>();
        candidates.AddRange(FindOnPath("bash"));
        candidates.AddRange(WindowsBashLocations);
        candidates.AddRange(GitExecToBashCandidates(FindGitExecPath()));
        foreach (var git in FindOnPath("git"))
        {
            var dir = Path.GetDirectoryName(git);
            if (dir is null) continue;
            candidates.Add(Path.Combine(dir, "..", "bin", "bash.exe"));
        }

        foreach (var candidate in candidates)
        {
            if (File.Exists(candidate))
            {
                _cachedGitBashPath = candidate;
                return candidate;
            }
        }

        throw new InvalidOperationException(
            "DeepOrca on Windows requires Git Bash. Install Git for Windows, or ensure Git's bash.exe is available in PATH.");
    }

    public static string ShellKind(string shellPath)
    {
        var executable = shellPath.Replace('\\', '/').Split('/').Last().ToLowerInvariant();
        if (executable is "bash" or "bash.exe") return "bash";
        if (executable is "zsh" or "zsh.exe") return "zsh";
        return "unknown";
    }

    /// <summary>bash/zsh 初始化（干跑 .bashrc/.zshrc；读失败不影响主命令）。</summary>
    public static string? BuildShellInitCommand(string shellPath) => ShellKind(shellPath) switch
    {
        "zsh" =>
            "ZSHRC=\"${ZDOTDIR:-$HOME}/.zshrc\"; if [ -f \"$ZSHRC\" ]; then { . \"$ZSHRC\"; } >/dev/null 2>&1; fi",
        "bash" =>
            "BASHRC=\"${BASH_ENV:-$HOME}/.bashrc\"; if [ -f \"$BASHRC\" ]; then { . \"$BASHRC\"; } >/dev/null 2>&1; fi",
        _ => null,
    };

    public static string? BuildDisableExtglobCommand(string shellPath) => ShellKind(shellPath) switch
    {
        "bash" => "shopt -u extglob 2>/dev/null || true",
        "zsh" => "setopt NO_EXTENDED_GLOB 2>/dev/null || true",
        _ => null,
    };

    /// <summary>NUL 重定向改写（Windows 形态 "> NUL" → "> /dev/null"）。</summary>
    public static string RewriteWindowsNullRedirect(string command) =>
        Runtime.PathIsWindows ? NulRedirectRegex.Replace(command, "$1/dev/null") : command;

    public static string ToNativeCwd(string shellCwd)
    {
        if (!Runtime.PathIsWindows) return shellCwd;
        // Git Bash 输出 /c/... 或 /cygdrive/c/... → C:\...
        var m = Regex.Match(shellCwd, @"^/([A-Za-z])(?:/(.*))?$");
        if (m.Success)
        {
            var drive = m.Groups[1].Value.ToUpperInvariant();
            var rest = m.Groups[2].Success ? "/" + m.Groups[2].Value : "";
            return drive + ":" + rest.Replace('/', '\\');
        }
        var cyg = Regex.Match(shellCwd, @"^/cygdrive/([A-Za-z])(?:/(.*))?$");
        if (cyg.Success)
        {
            var drive = cyg.Groups[1].Value.ToUpperInvariant();
            var rest = cyg.Groups[2].Success ? "/" + cyg.Groups[2].Value : "";
            return drive + ":" + rest.Replace('/', '\\');
        }
        return shellCwd;
    }

    private static List<string> FindOnPath(string executable)
    {
        var result = new List<string>();
        var path = Environment.GetEnvironmentVariable("PATH") ?? "";
        foreach (var dir in path.Split(Path.PathSeparator))
        {
            if (string.IsNullOrEmpty(dir)) continue;
            foreach (var name in Runtime.PathIsWindows
                         ? new[] { executable + ".exe", executable }
                         : new[] { executable })
            {
                var full = Path.Combine(dir, name);
                if (File.Exists(full)) result.Add(full);
            }
        }
        return result;
    }

    private static string? FindGitExecPath()
    {
        foreach (var candidate in WindowsGitLocations)
        {
            if (File.Exists(candidate)) return candidate;
        }
        return null;
    }

    private static List<string> GitExecToBashCandidates(string? gitExec)
    {
        if (gitExec is null) return [];
        var dir = Path.GetDirectoryName(gitExec);
        if (dir is null) return [];
        var root = Path.Combine(dir, "..");
        return
        [
            Path.Combine(dir, "..", "bin", "bash.exe"),
            Path.Combine(root, "bin", "bash.exe"),
            Path.Combine(dir, "bash.exe"),
        ];
    }
}