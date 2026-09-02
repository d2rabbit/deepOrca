using System.Text.Json.Nodes;
using DeepOrca.Core.Types;

using DeepOrca.Core.Permissions;
namespace DeepOrca.Core.Common;

// FileState — 会话级文件状态 + 片段（snippet）契约（对拍上游 common/state.ts）。
// 契约铁律（AGENTS.md）：read 返回 snippet_id；edit 必带 snippet_id 且只在片段范围内搜索。
// 单写者纪律：所有注册表经 lock 串行。

public sealed record FileState
{
    public required string FilePath { get; init; }
    public required string Content { get; init; }
    public required long Timestamp { get; init; }
    public int Version { get; init; }
    public int? Offset { get; init; }
    public int? Limit { get; init; }
    public bool? IsPartialView { get; init; }
    public string? Encoding { get; init; }
    public string? LineEndings { get; init; }

    public bool IsFullFileView =>
        !(IsPartialView ?? false) && Offset is null && Limit is null;
}

public sealed record FileSnippet
{
    public required string Id { get; init; }
    public required string FilePath { get; init; }
    public required int StartLine { get; init; }
    public required int EndLine { get; init; }
    public required string Preview { get; init; }
    public required int FileVersion { get; init; }
    public required string ScopeType { get; init; } // "snippet" | "full"
}

/// <summary>会话级文件状态注册表（read 标记 / snippet 登记 / 版本计数）。</summary>
public sealed class SessionFileRegistry
{
    private readonly object _gate = new();
    private readonly Dictionary<string, Dictionary<string, FileState>> _fileStates = new();
    private readonly Dictionary<string, Dictionary<string, FileSnippet>> _snippets = new();
    private readonly Dictionary<string, int> _snippetCounters = new();
    private readonly Dictionary<string, int> _fullFileCounters = new();
    private readonly Dictionary<string, Dictionary<string, int>> _fileVersions = new();

    public void ClearSession(string sessionId)
    {
        lock (_gate)
        {
            _fileStates.Remove(sessionId);
            _snippets.Remove(sessionId);
            _snippetCounters.Remove(sessionId);
            _fullFileCounters.Remove(sessionId);
            _fileVersions.Remove(sessionId);
        }
    }

    /// <summary>read 命中后登记文件状态（内容供"modify-since-read"守卫做字节级对照）。</summary>
    public void MarkFileRead(string sessionId, string filePath, FileState state)
    {
        lock (_gate)
        {
            if (string.IsNullOrEmpty(sessionId) || string.IsNullOrEmpty(filePath)) return;
            var normalized = NormalizeFilePath(filePath);
            var version = GetFileVersionLocked(sessionId, normalized);
            SetFileVersionLocked(sessionId, normalized, version + 1);
            GetOrCreate(sessionId, _fileStates)[normalized] = state with { FilePath = normalized, Version = version + 1 };
        }
    }

    public FileState? GetFileState(string sessionId, string filePath)
    {
        lock (_gate)
        {
            if (string.IsNullOrEmpty(sessionId)) return null;
            return _fileStates.TryGetValue(sessionId, out var map)
                ? map.GetValueOrDefault(NormalizeFilePath(filePath))
                : null;
        }
    }

    public int GetFileVersion(string sessionId, string filePath)
    {
        lock (_gate)
        {
            if (string.IsNullOrEmpty(sessionId)) return 0;
            return _fileVersions.TryGetValue(sessionId, out var map)
                ? map.GetValueOrDefault(NormalizeFilePath(filePath), 0)
                : 0;
        }
    }

    /// <summary>片段登记（read 工具输出 metadata.snippet）。</summary>
    public FileSnippet? CreateSnippet(string sessionId, string filePath, int startLine, int endLine, string preview, bool fullFile)
    {
        lock (_gate)
        {
            if (string.IsNullOrEmpty(sessionId) || string.IsNullOrEmpty(filePath) || startLine < 1 || endLine < startLine)
            {
                return null;
            }
            var counterKey = fullFile ? _fullFileCounters : _snippetCounters;
            var prefix = fullFile ? "full_file_" : "snippet_";
            var counter = counterKey.GetValueOrDefault(sessionId, 0);
            counterKey[sessionId] = fullFile ? counter + 1 : counter + 1;
            var id = $"{prefix}{counter}";
            var normalized = NormalizeFilePath(filePath);
            var snippet = new FileSnippet
            {
                Id = id,
                FilePath = normalized,
                StartLine = startLine,
                EndLine = endLine,
                Preview = preview,
                FileVersion = GetFileVersionLocked(sessionId, normalized),
                ScopeType = fullFile ? "full" : "snippet",
            };
            GetOrCreate(sessionId, _snippets)[id] = snippet;
            return snippet;
        }
    }

    public FileSnippet? GetSnippet(string sessionId, string snippetId)
    {
        lock (_gate)
        {
            if (string.IsNullOrEmpty(sessionId)) return null;
            return _snippets.TryGetValue(sessionId, out var map)
                ? map.GetValueOrDefault(snippetId)
                : null;
        }
    }

    /// <summary>文件版本落后于片段登记版本（文件被改过 → 需要重新 read）。</summary>
    public bool HasSnippetOutdatedFileVersion(string sessionId, FileSnippet snippet) =>
        GetFileVersion(sessionId, snippet.FilePath) > snippet.FileVersion;

    // ── 路径归一（对拍 normalizeFilePath / isAbsoluteFilePath + Git Bash 形态）──

    public static string NormalizeFilePath(string filePath)
    {
        var native = filePath;
        if (Runtime.PathIsWindows && IsGitBashAbsolutePath(filePath))
        {
            native = PosixPathToWindowsPath(filePath);
        }
        try
        {
            return Path.GetFullPath(native);
        }
        catch
        {
            return native;
        }
    }

    public static bool IsAbsoluteFilePath(string filePath)
    {
        if (!Runtime.PathIsWindows) return Path.IsPathRooted(filePath);
        if (IsGitBashAbsolutePath(filePath)) return true;
        var normalized = filePath.Replace('/', '\\');
        return Path.IsPathRooted(normalized) &&
               (System.Text.RegularExpressions.Regex.IsMatch(normalized, @"^[A-Za-z]:[\\/]") ||
                normalized.StartsWith(@"\\\\"));
    }

    private static bool IsGitBashAbsolutePath(string filePath) =>
        System.Text.RegularExpressions.Regex.IsMatch(filePath, @"^/[A-Za-z](?:/|$)") ||
        System.Text.RegularExpressions.Regex.IsMatch(filePath, @"^/cygdrive/[A-Za-z](?:/|$)");

    private static string PosixPathToWindowsPath(string posixPath)
    {
        var m = System.Text.RegularExpressions.Regex.Match(posixPath, @"^/([A-Za-z])(?:/(.*))?$");
        if (m.Success)
        {
            var drive = m.Groups[1].Value.ToUpperInvariant();
            var rest = m.Groups[2].Success ? "/" + m.Groups[2].Value : "";
            return drive + ":" + rest.Replace('/', '\\');
        }
        var cyg = System.Text.RegularExpressions.Regex.Match(posixPath, @"^/cygdrive/([A-Za-z])(?:/(.*))?$");
        if (cyg.Success)
        {
            var drive = cyg.Groups[1].Value.ToUpperInvariant();
            var rest = cyg.Groups[2].Success ? "/" + cyg.Groups[2].Value : "";
            return drive + ":" + rest.Replace('/', '\\');
        }
        return posixPath.Replace('/', '\\');
    }

    // ── 内部 ──

    private int GetFileVersionLocked(string sessionId, string normalizedPath) =>
        _fileVersions.TryGetValue(sessionId, out var map) ? map.GetValueOrDefault(normalizedPath, 0) : 0;

    private void SetFileVersionLocked(string sessionId, string normalizedPath, int version)
    {
        if (!_fileVersions.TryGetValue(sessionId, out var map))
        {
            map = new Dictionary<string, int>();
            _fileVersions[sessionId] = map;
        }
        map[normalizedPath] = version;
    }

    private static Dictionary<string, T> GetOrCreate<T>(string sessionId, Dictionary<string, Dictionary<string, T>> registry)
    {
        if (!registry.TryGetValue(sessionId, out var map))
        {
            map = new Dictionary<string, T>();
            registry[sessionId] = map;
        }
        return map;
    }
}

/// <summary>工具结果的元数据小工具（{ ok, name, output?, error?, errorType?, retryable?, metadata }）。</summary>
public static class ToolResultJson
{
    public static JsonObject ToJson(ToolExecutionResult result)
    {
        var obj = new JsonObject
        {
            ["ok"] = result.Ok,
            ["name"] = result.Name,
        };
        if (result.Output is { } output) obj["output"] = output;
        if (result.Error is { } error) obj["error"] = error;
        if (result.ErrorType is { } errorType) obj["errorType"] = errorType;
        if (result.Retryable is { } retryable) obj["retryable"] = retryable;
        if (result.Metadata is { } metadata) obj["metadata"] = metadata.DeepClone();
        return obj;
    }
}