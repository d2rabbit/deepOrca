using System.Text.Json.Nodes;
using DeepOrca.Core.Common;
using DeepOrca.Core.Types;

using DeepOrca.Core.Permissions;
namespace DeepOrca.Core.Tools;

// EditHandler — 片段限定编辑（对拍上游 edit-handler.ts 的完整契约）。
// 铁律：snippet_id 必填；只在片段行范围内搜索 old_string；写入前做
// "modified since read" 守卫（mtime 对照）；成功后缓存刷新 + 版本自增。

public sealed class EditHandler
{
    public const string OutdatedSnippetNotFoundError =
        "old_string not found in file. The snippet's file version is outdated — read the file again before editing.";

    public required string ProjectRoot { get; init; }
    public required SessionFileRegistry Registry { get; init; }
    public required Func<PathGrant?> PathGrantProvider { get; init; }

    public async Task<ToolExecutionResult> Handle(ToolExecutionContext context, CancellationToken ct = default)
    {
        var snippetId = AnyJson.GetString(context.Arguments["snippet_id"])?.Trim() ?? "";
        var oldString = AnyJson.GetString(context.Arguments["old_string"]) ?? "";
        var newString = AnyJson.GetString(context.Arguments["new_string"]) ?? "";
        var replaceAll = AnyJson.GetBool(context.Arguments["replace_all"]) ?? false;
        var expectedOccurrences = AnyJson.GetInt(context.Arguments["expected_occurrences"]);

        var snippet = Registry.GetSnippet(context.SessionId, snippetId);
        if (snippet is null)
        {
            return ToolExecutionResult.Fail("edit", $"Unknown snippet_id: {snippetId}");
        }

        var filePath = AnyJson.GetString(context.Arguments["file_path"]) is { } fp && fp.Trim().Length > 0
            ? SessionFileRegistry.NormalizeFilePath(fp.Trim())
            : snippet.FilePath;
        if (!SessionFileRegistry.IsAbsoluteFilePath(filePath))
        {
            return ToolExecutionResult.Fail("edit", "file_path must be an absolute path.");
        }

        var gate = PathBoundary.GateWrite(PathGrantProvider(), filePath, ProjectRoot);
        if (!gate.Ok)
        {
            return ToolExecutionResult.Fail("edit", gate.Reason!,
                errorType: "permissionDenied", retryable: false);
        }

        if (snippet.FilePath != filePath)
        {
            return ToolExecutionResult.Fail("edit", "snippet_id does not belong to the provided file_path.");
        }
        if (oldString == newString)
        {
            return ToolExecutionResult.Fail("edit", "new_string must differ from old_string.");
        }
        if (!File.Exists(filePath))
        {
            return ToolExecutionResult.Fail("edit", $"File not found: {filePath}");
        }

        var fileState = Registry.GetFileState(context.SessionId, filePath);
        if (fileState is null)
        {
            return ToolExecutionResult.Fail("edit", "Must read file before editing.");
        }
        if (HasFileChangedSinceState(filePath, fileState))
        {
            return ToolExecutionResult.Fail("edit",
                "File has been modified since read. Read it again before editing.");
        }

        var (raw, encoding, lineEndings, _) = ReadHandler.ReadTextWithMetadata(filePath, ct);
        var scope = BuildSearchScope(raw, snippet);
        var replacementOld = oldString;
        var replacementNew = newString;

        var matches = FindOccurrences(raw, oldString, scope);
        var matchedVia = "exact";

        // 读结果带行号缩进时的 tab 修正（read 输出格式 6 位行号 + \t —— 模型常照抄）
        if (matches.Count == 0)
        {
            var tabStrippedOld = StripReadResultLineTabs(oldString);
            if (tabStrippedOld != oldString)
            {
                var strippedMatches = FindOccurrences(raw, tabStrippedOld, scope);
                if (strippedMatches.Count == 1)
                {
                    matches = strippedMatches;
                    matchedVia = "line_leading_tab_correction";
                    replacementOld = tabStrippedOld;
                    replacementNew = StripReadResultLineTabs(newString);
                }
            }
        }

        if (matches.Count == 0)
        {
            if (Registry.HasSnippetOutdatedFileVersion(context.SessionId, snippet))
            {
                return ToolExecutionResult.Fail("edit", OutdatedSnippetNotFoundError,
                    metadata: ScopeMetadata(scope));
            }
            return ToolExecutionResult.Fail("edit", "old_string not found in file.",
                metadata: ScopeMetadata(scope));
        }

        if (!replaceAll && matches.Count > 1)
        {
            return ToolExecutionResult.Fail("edit",
                "old_string is not unique; use snippet_id, replace_all, or provide more context.",
                metadata: new JsonObject
                {
                    ["match_count"] = matches.Count,
                    ["scope"] = ScopeMetadata(scope),
                    ["candidates"] = BuildCandidateMetadata(filePath, raw, matches),
                });
        }

        if (expectedOccurrences is { } expected && matches.Count != expected && replaceAll)
        {
            return ToolExecutionResult.Fail("edit",
                $"expected_occurrences mismatch: found {matches.Count}, expected {expected}.",
                metadata: new JsonObject
                {
                    ["match_count"] = matches.Count,
                    ["scope"] = ScopeMetadata(scope),
                    ["candidates"] = BuildCandidateMetadata(filePath, raw, matches),
                });
        }

        var updated = ApplyReplacement(raw, replacementOld, replacementNew, matches, replaceAll);
        var diffPreview = BuildDiffPreview(raw, updated);
        await File.WriteAllTextAsync(filePath, updated, ct).ConfigureAwait(false);

        var (_, _, _, freshTimestamp) = ReadHandler.ReadTextWithMetadata(filePath, ct);
        Registry.MarkFileRead(context.SessionId, filePath, new FileState
        {
            FilePath = filePath,
            Content = updated,
            Timestamp = freshTimestamp,
            Encoding = encoding,
            LineEndings = lineEndings,
        });

        var replacedCount = replaceAll ? matches.Count : 1;
        return ToolExecutionResult.OkResult("edit",
            $"Replaced {replacedCount} occurrence(s) in {filePath}.",
            new JsonObject
            {
                ["file_path"] = filePath,
                ["replaced_count"] = replacedCount,
                ["matched_via"] = matchedVia,
                ["cache_refreshed"] = true,
                ["read_scope_type"] = snippet.ScopeType,
                ["encoding"] = encoding,
                ["line_endings"] = lineEndings,
                ["diff_preview"] = diffPreview,
                ["scope"] = ScopeMetadata(scope),
            });
    }

    // ── 核心原语（静态、可测）──

    private static bool HasFileChangedSinceState(string filePath, FileState state)
    {
        try
        {
            var fresh = new DateTimeOffset(File.GetLastWriteTimeUtc(filePath)).ToUnixTimeMilliseconds();
            return fresh != state.Timestamp;
        }
        catch (IOException)
        {
            return true;
        }
    }

    public sealed record SearchScope(int StartOffset, int EndOffset, string FilePath, int StartLine, int EndLine, string? SnippetId);

    public static SearchScope BuildSearchScope(string raw, FileSnippet snippet)
    {
        var lines = raw.Split('\n');
        var startOffset = 0;
        var line = 1;
        while (line < snippet.StartLine && line <= lines.Length)
        {
            startOffset += lines[line - 1].Length + 1;
            line++;
        }
        // 末行含内容本身 + 结尾换行（split 语义：每行长度 + 1，文件尾无换行时钳到 raw.Length）
        var endOffset = raw.Length;
        var endLine = Math.Min(snippet.EndLine, lines.Length);
        var target = snippet.StartLine;
        var cursor = startOffset;
        while (target <= endLine && target <= lines.Length)
        {
            var next = cursor + lines[target - 1].Length + 1;
            cursor = Math.Min(next, raw.Length);
            target++;
        }
        endOffset = cursor;
        return new SearchScope(startOffset, endOffset, snippet.FilePath, snippet.StartLine, snippet.EndLine, snippet.Id);
    }

    /// <summary>在片段范围内找全部出现位置（含 offset → 行号换算）。</summary>
    public static List<MatchOccurrence> FindOccurrences(string raw, string needle, SearchScope scope)
    {
        var result = new List<MatchOccurrence>();
        if (needle.Length == 0) return result;
        // 片段范围 [StartOffset, EndOffset]；末行允许结尾换行符并入匹配（+1 宽容）
        var searchFrom = scope.StartOffset;
        while (true)
        {
            var idx = raw.IndexOf(needle, searchFrom, StringComparison.Ordinal);
            if (idx < 0 || idx >= scope.EndOffset) break;
            var end = idx + needle.Length;
            if (end > scope.EndOffset + 1) break; // 越过片段尾
            result.Add(new MatchOccurrence(idx, end,
                OffsetToLine(raw, idx), OffsetToLine(raw, Math.Max(0, end - 1))));
            searchFrom = idx + 1;
        }
        return result;
    }

    public sealed record MatchOccurrence(int StartOffset, int EndOffset, int StartLine, int EndLine);

    public static int OffsetToLine(string raw, int offset)
    {
        var line = 1;
        for (var i = 0; i < offset && i < raw.Length; i++)
        {
            if (raw[i] == '\n') line++;
        }
        return line;
    }

    public static string StripReadResultLineTabs(string value)
    {
        var lines = value.Split('\n');
        for (var i = 0; i < lines.Length; i++)
        {
            var line = lines[i];
            // 格式"     6\t..."：6 位行号 + tab
            var tab = line.IndexOf('\t');
            if (tab > 0 && tab <= 6 && line[..tab].Trim().Length > 0 &&
                int.TryParse(line[..tab].Trim(), out _))
            {
                lines[i] = line[(tab + 1)..];
            }
        }
        return string.Join("\n", lines);
    }

    private static string ApplyReplacement(string raw, string oldString, string newString,
        List<MatchOccurrence> matches, bool replaceAll)
    {
        if (!replaceAll)
        {
            var m = matches[0];
            return raw[..m.StartOffset] + newString + raw[m.EndOffset..];
        }
        // 从后往前替换，避免偏移漂移
        var sb = new System.Text.StringBuilder(raw);
        foreach (var m in matches.OrderByDescending(x => x.StartOffset))
        {
            sb.Remove(m.StartOffset, m.EndOffset - m.StartOffset);
            sb.Insert(m.StartOffset, newString);
        }
        return sb.ToString();
    }

    internal static string BuildDiffPreview(string before, string after)
    {
        if (before == after) return "(no changes)";
        var beforeLines = before.Split('\n');
        var afterLines = after.Split('\n');
        var max = Math.Min(beforeLines.Length, afterLines.Length);
        var firstDiff = 0;
        while (firstDiff < max && beforeLines[firstDiff] == afterLines[firstDiff]) firstDiff++;

        var contextStart = Math.Max(0, firstDiff - 2);
        var lines = new List<string>();
        for (var i = contextStart; i < Math.Min(beforeLines.Length, firstDiff + 3); i++)
        {
            lines.Add($"- {beforeLines[i]}");
        }
        for (var i = contextStart; i < Math.Min(afterLines.Length, firstDiff + 3); i++)
        {
            lines.Add($"+ {afterLines[i]}");
        }
        return string.Join("\n", lines);
    }

    private static JsonObject ScopeMetadata(SearchScope scope) => new()
    {
        ["snippet_id"] = scope.SnippetId,
        ["file_path"] = scope.FilePath,
        ["start_line"] = scope.StartLine,
        ["end_line"] = scope.EndLine,
    };

    /// <summary>非唯一匹配的候选元数据（每个匹配带行范围 + 上下文预览，供模型用 snippet_id 重试）。</summary>
    private static JsonArray BuildCandidateMetadata(string filePath, string raw, List<MatchOccurrence> matches)
    {
        var lines = raw.Split('\n');
        var arr = new JsonArray();
        foreach (var m in matches.Take(5))
        {
            var contextStart = Math.Max(0, m.StartLine - 3);
            var contextEnd = Math.Min(lines.Length, m.EndLine + 2);
            arr.Add(new JsonObject
            {
                ["file_path"] = filePath,
                ["start_line"] = m.StartLine,
                ["end_line"] = m.EndLine,
                ["preview"] = string.Join("\n", lines[contextStart..contextEnd]),
            });
        }
        return arr;
    }
}