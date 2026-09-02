using System.Text;
using System.Text.Json.Nodes;
using DeepOrca.Core.Common;
using DeepOrca.Core.Types;

using DeepOrca.Core.Permissions;
namespace DeepOrca.Core.Tools;

// ReadHandler — 文件读取（对拍上游 read-handler.ts：文本路径全量；notebook/pdf/image 简约）。
// 片段契约：文本读返回 metadata.snippet {id, filePath, startLine, endLine}，edit 依赖它。

public sealed class ReadHandler
{
    public const int DefaultLineLimit = 2000;
    public const int MaxLineLength = 2000;
    public const int LineNumberWidth = 6;
    public const long MaxReadFileBytes = 50 * 1024 * 1024;

    private static readonly string[] DefaultGitignore =
    [
        "node_modules/", ".git/", "dist/", "build/", "out/", ".next/", ".nuxt/", ".venv/", "venv/",
        "__pycache__/", "*.pyc", "*.pyo", ".pytest_cache/", ".mypy_cache/", ".ruff_cache/", ".gradle/",
        ".idea/", ".vscode/", "*.class", "*.jar", "*.war", "target/",
    ];

    public required string ProjectRoot { get; init; }
    public required SessionFileRegistry Registry { get; init; }
    public required Func<PathGrant?> PathGrantProvider { get; init; }

    public async Task<ToolExecutionResult> Handle(ToolExecutionContext context, CancellationToken ct = default)
    {
        var filePath = context.Arguments["file_path"] is JsonValue v && v.TryGetValue<string>(out var s)
            ? SessionFileRegistry.NormalizeFilePath(s)
            : "";
        if (string.IsNullOrWhiteSpace(filePath))
        {
            return ToolExecutionResult.Fail("read", "Missing required \"file_path\" string.");
        }

        if (!SessionFileRegistry.IsAbsoluteFilePath(filePath))
        {
            if (filePath.StartsWith("../") || filePath.StartsWith("..\\"))
            {
                return ToolExecutionResult.Fail("read", "file_path must be an absolute path.");
            }
            filePath = ResolveRelativePath(filePath, ct);
            if (filePath is null) return ToolExecutionResult.Fail("read", "file_path must be an absolute path. The file_path is ambiguous.");
            if (!File.Exists(filePath))
            {
                return ToolExecutionResult.Fail("read", $"File not found: {filePath}");
            }
        }

        // 执行期读门（P0）
        var gate = PathBoundary.GateRead(PathGrantProvider(), filePath, ProjectRoot);
        if (!gate.Ok)
        {
            return ToolExecutionResult.Fail("read", gate.Reason!,
                errorType: "permissionDenied", retryable: false);
        }

        if (Directory.Exists(filePath))
        {
            return ToolExecutionResult.Fail("read", "file_path points to a directory. Use bash ls for directories.");
        }
        if (!File.Exists(filePath))
        {
            return ToolExecutionResult.Fail("read", $"File not found: {filePath}");
        }

        FileInfo stat;
        try
        {
            stat = new FileInfo(filePath);
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Fail("read", $"Failed to stat file: {ex.Message}");
        }
        var ext = Path.GetExtension(filePath).ToLowerInvariant();
        var mtimeMs = new DateTimeOffset(stat.LastWriteTimeUtc).ToUnixTimeMilliseconds();

        // 图片：多模态 follow-up（contentParams 走 message 转换器）
        if (IsImageExtension(ext))
        {
            if (stat.Length > MaxReadFileBytes)
            {
                return ToolExecutionResult.Fail("read",
                    $"File is too large to read ({(stat.Length / 1024.0 / 1024.0):F1}MB, cap {MaxReadFileBytes / 1024 / 1024}MB)");
            }
            var bytes = await File.ReadAllBytesAsync(filePath, ct).ConfigureAwait(false);
            var mime = GetImageMimeType(ext);
            Registry.MarkFileRead(context.SessionId, filePath, new FileState
            {
                FilePath = filePath, Content = "", Timestamp = mtimeMs, IsPartialView = true,
            });
            return ToolExecutionResult.OkResult("read", "File loaded.", new JsonObject
            {
                ["mime"] = mime,
                ["bytes"] = bytes.Length,
            });
        }

        if (ext == ".pdf")
        {
            if (stat.Length > MaxReadFileBytes)
            {
                return ToolExecutionResult.Fail("read",
                    $"File is too large to read ({(stat.Length / 1024.0 / 1024.0):F1}MB, cap {MaxReadFileBytes / 1024 / 1024}MB)");
            }
            var bytes = await File.ReadAllBytesAsync(filePath, ct).ConfigureAwait(false);
            var pageCount = CountPdfPages(bytes);
            Registry.MarkFileRead(context.SessionId, filePath, new FileState
            {
                FilePath = filePath, Content = "", Timestamp = mtimeMs, IsPartialView = true,
            });
            return ToolExecutionResult.OkResult("read", "WARNING: File is binary.", new JsonObject
            {
                ["mime"] = "application/pdf",
                ["encoding"] = "base64",
                ["bytes"] = bytes.Length,
                ["pageCount"] = pageCount,
            });
        }

        if (ext == ".ipynb")
        {
            var output = ReadNotebook(await File.ReadAllTextAsync(filePath, ct).ConfigureAwait(false));
            Registry.MarkFileRead(context.SessionId, filePath, new FileState
            {
                FilePath = filePath, Content = "", Timestamp = mtimeMs, IsPartialView = true,
            });
            return ToolExecutionResult.OkResult("read", output);
        }

        var offset = ParseLineNumber(context.Arguments["offset"], "offset");
        if (offset.Error is not null) return ToolExecutionResult.Fail("read", offset.Error);
        var limit = ParseLineLimit(context.Arguments["limit"]);
        if (limit.Error is not null) return ToolExecutionResult.Fail("read", limit.Error);

        var textResult = ReadTextFile(filePath, offset.Value, limit.Value, ct);
        Registry.MarkFileRead(context.SessionId, filePath, new FileState
        {
            FilePath = filePath,
            Content = textResult.Content,
            Timestamp = textResult.Timestamp,
            Offset = textResult.IsPartialView ? textResult.StartLine : null,
            Limit = textResult.IsPartialView ? Math.Max(1, textResult.EndLine - textResult.StartLine + 1) : null,
            IsPartialView = textResult.IsPartialView,
            Encoding = textResult.Encoding,
            LineEndings = textResult.LineEndings,
        });
        var snippet = Registry.CreateSnippet(
            context.SessionId, filePath, textResult.StartLine, textResult.EndLine,
            textResult.Output, !textResult.IsPartialView);

        return ToolExecutionResult.OkResult("read", textResult.Output, snippet is null ? null : new JsonObject
        {
            ["snippet"] = new JsonObject
            {
                ["id"] = snippet.Id,
                ["filePath"] = snippet.FilePath,
                ["startLine"] = snippet.StartLine,
                ["endLine"] = snippet.EndLine,
            },
        });
    }

    // ── 相对路径解析：直接命中优先；否则后缀匹配（gitignore 感知）——近似实现，README 注明 ──

    private string? ResolveRelativePath(string relativePath, CancellationToken ct)
    {
        var direct = Path.GetFullPath(Path.Combine(ProjectRoot, relativePath));
        if (File.Exists(direct)) return direct;

        var suffix = "/" + Path.GetRelativePath(ProjectRoot, direct).Replace('\\', '/');
        var ignored = LoadGitignoreMatcher();
        var matches = FindSuffixMatches(ProjectRoot, suffix, ignored);
        if (matches.Count > 1) return null; // 歧义 → 上层报"must be absolute"
        return matches.Count == 1 ? matches[0] : direct;
    }

    private Func<string, bool, bool>? LoadGitignoreMatcher()
    {
        var patterns = new List<string>(DefaultGitignore);
        var gitignorePath = Path.Combine(ProjectRoot, ".gitignore");
        try
        {
            if (File.Exists(gitignorePath))
            {
                patterns.AddRange(File.ReadLines(gitignorePath)
                    .Select(l => l.Trim())
                    .Where(l => l.Length > 0 && !l.StartsWith('#')));
            }
        }
        catch (IOException) { }

        return (relPath, isDir) => IsIgnored(patterns, relPath, isDir);
    }

    /// <summary>近似 gitignore 语义：精确名 / 目录尾斜杠前缀 / 尾 * 后缀 / 含 * 通配转正则。</summary>
    internal static bool IsIgnored(List<string> patterns, string relPath, bool isDir)
    {
        var candidate = isDir && !relPath.EndsWith('/') ? relPath + "/" : relPath;
        foreach (var raw in patterns)
        {
            var pattern = raw;
            var negate = pattern.StartsWith('!');
            if (negate) pattern = pattern[1..];
            var match = false;
            if (pattern.EndsWith('/'))
            {
                match = candidate.StartsWith(pattern, StringComparison.Ordinal) || candidate == pattern.TrimEnd('/');
            }
            else if (pattern.EndsWith('*') && !pattern.Contains('/'))
            {
                match = candidate.EndsWith(pattern[..^1], StringComparison.Ordinal);
            }
            else if (pattern.Contains('*'))
            {
                var regex = "^" + System.Text.RegularExpressions.Regex.Escape(pattern)
                    .Replace(@"\*", ".*") + "$";
                match = System.Text.RegularExpressions.Regex.IsMatch(candidate, regex);
            }
            else
            {
                match = candidate == pattern || candidate.StartsWith(pattern + "/", StringComparison.Ordinal);
            }
            if (match && !negate) return true;
        }
        return false;
    }

    private static List<string> FindSuffixMatches(string root, string suffix, Func<string, bool, bool>? isIgnored)
    {
        var matches = new List<string>();
        var stack = new Stack<string>();
        stack.Push(root);
        while (stack.Count > 0)
        {
            var current = stack.Pop();
            string[] entries;
            try { entries = Directory.GetFileSystemEntries(current); }
            catch (IOException) { continue; }
            foreach (var fullPath in entries)
            {
                var isDir = Directory.Exists(fullPath);
                var relPath = Path.GetRelativePath(root, fullPath).Replace('\\', '/');
                if (isIgnored?.Invoke(relPath, isDir) == true) continue;
                if (isDir)
                {
                    stack.Push(fullPath);
                    continue;
                }
                if (fullPath.EndsWith(suffix, StringComparison.Ordinal)) matches.Add(fullPath);
            }
        }
        return matches;
    }

    // ── 文本读取 ──

    public sealed record TextReadResult(
        string Content, string Output, int StartLine, int EndLine, int TotalLines,
        bool IsPartialView, string Encoding, string LineEndings, long Timestamp);

    public static TextReadResult ReadTextFile(string filePath, int? offset, int limit, CancellationToken ct = default)
    {
        var (raw, encoding, lineEndings, timestamp) = ReadTextWithMetadata(filePath, ct);
        if (string.IsNullOrEmpty(raw))
        {
            return new TextReadResult("", "WARNING: File is empty.", offset ?? 1, offset ?? 1, 0, false,
                encoding, lineEndings, timestamp);
        }

        var lines = raw.Split('\n');
        if (lines.Length == 1 && lines[0] == "")
        {
            return new TextReadResult("", "WARNING: File is empty.", offset ?? 1, offset ?? 1, 0, false,
                encoding, lineEndings, timestamp);
        }

        var startIndex = offset is { } o ? o - 1 : 0;
        var endIndex = Math.Min(startIndex + limit, lines.Length);
        var selected = lines[startIndex..endIndex];
        var startLine = startIndex + 1;
        var endLine = selected.Length > 0 ? startIndex + selected.Length : startLine;
        var isPartial = startLine != 1 || endLine < lines.Length;
        return new TextReadResult(
            string.Join("\n", selected),
            FormatWithLineNumbers(selected, startLine),
            startLine, endLine, lines.Length, isPartial,
            encoding, lineEndings, timestamp);
    }

    /// <summary>BOM 嗅探编码 + LF/CRLF 判定 + mtime 毫秒。</summary>
    public static (string Content, string Encoding, string LineEndings, long Timestamp) ReadTextWithMetadata(
        string filePath, CancellationToken ct = default)
    {
        var bytes = File.ReadAllBytes(filePath);
        var encoding = "utf8";
        var content = Encoding.UTF8.GetString(bytes);
        if (bytes.Length >= 3 && bytes[0] == 0xEF && bytes[1] == 0xBB && bytes[2] == 0xBF)
        {
            content = content[1..]; // 去 BOM
        }
        else if (bytes.Length >= 2 && bytes[0] == 0xFF && bytes[1] == 0xFE)
        {
            encoding = "utf16le";
            content = Encoding.Unicode.GetString(bytes[2..]);
        }
        var lineEndings = content.Contains("\r\n") ? "CRLF" : "LF";
        var timestamp = new DateTimeOffset(File.GetLastWriteTimeUtc(filePath)).ToUnixTimeMilliseconds();
        return (content, encoding, lineEndings, timestamp);
    }

    public static string FormatWithLineNumbers(string[] lines, int startLineNumber)
    {
        return string.Join("\n", lines.Select((line, index) =>
        {
            var lineNumber = startLineNumber + index;
            var trimmed = line.Length > MaxLineLength ? line[..MaxLineLength] : line;
            return $"{lineNumber.ToString().PadLeft(LineNumberWidth)}\t{trimmed}";
        }));
    }

    public static (int? Value, string? Error) ParseLineNumber(JsonNode? value, string label)
    {
        if (value is not JsonValue v) return (null, null);
        if (!v.TryGetValue<int>(out var i) && !v.TryGetValue<double>(out var d))
        {
            return (null, $"{label} must be a number.");
        }
        var numeric = v.TryGetValue<int>(out var intVal) ? intVal : (int)v.GetValue<double>();
        if (numeric < 1) return (null, $"{label} must be >= 1.");
        return (numeric, null);
    }

    public static (int Value, string? Error) ParseLineLimit(JsonNode? value)
    {
        if (value is null) return (DefaultLineLimit, null);
        var r = ParseLineNumber(value, "limit");
        if (r.Error is not null) return (0, r.Error);
        if (r.Value is not { } limitValue || limitValue <= 0) return (0, "limit must be > 0.");
        return (r.Value.Value, null);
    }

    // ── 二进制辅助 ──

    private static bool IsImageExtension(string ext) => ext is ".png" or ".jpg" or ".jpeg" or ".gif" or ".webp"
        or ".bmp" or ".tif" or ".tiff" or ".svg" or ".ico" or ".avif";

    private static string GetImageMimeType(string ext) => ext switch
    {
        ".jpg" or ".jpeg" => "image/jpeg",
        ".gif" => "image/gif",
        ".webp" => "image/webp",
        ".bmp" => "image/bmp",
        ".tif" or ".tiff" => "image/tiff",
        ".svg" => "image/svg+xml",
        ".ico" => "image/x-icon",
        ".avif" => "image/avif",
        _ => "image/png",
    };

    private static int? CountPdfPages(byte[] buffer)
    {
        try
        {
            var content = System.Text.Encoding.Latin1.GetString(buffer);
            return System.Text.RegularExpressions.Regex.Matches(content, @"/Type\s*/Page\b(?!s)").Count;
        }
        catch
        {
            return null;
        }
    }

    private static string ReadNotebook(string raw)
    {
        if (string.IsNullOrEmpty(raw)) return "WARNING: File is empty.";
        if (AnyJson.Parse(raw) is not JsonObject notebook) return "WARNING: Notebook is not valid JSON.";

        var lines = new List<string>();
        if (notebook["cells"] is JsonArray cells)
        {
            var index = 0;
            foreach (var cellNode in cells)
            {
                index++;
                if (cellNode is not JsonObject cell) continue;
                var cellType = AnyJson.GetString(cell["cell_type"]) ?? "unknown";
                lines.Add($"# Cell {index} ({cellType})");

                foreach (var srcLine in NormalizeNotebookField(cell["source"])) lines.Add(srcLine);

                if (cell["outputs"] is JsonArray outputs)
                {
                    var outputIndex = 0;
                    foreach (var outputNode in outputs)
                    {
                        outputIndex++;
                        if (outputNode is not JsonObject output) continue;
                        var outputType = AnyJson.GetString(output["output_type"]) ?? "output";
                        lines.Add($"# Output {outputIndex} ({outputType})");
                        foreach (var outLine in FormatNotebookOutput(output)) lines.Add(outLine);
                    }
                }
            }
        }
        return lines.Count == 0
            ? "WARNING: Notebook has no cells."
            : FormatWithLineNumbers(lines.ToArray(), 1);
    }

    private static List<string> NormalizeNotebookField(JsonNode? value)
    {
        if (value is JsonArray arr)
        {
            return arr.OfType<JsonValue>()
                .Select(v => v.TryGetValue<string>(out var s) ? s.Replace("\r\n", "").TrimEnd('\n') : "")
                .ToList();
        }
        if (AnyJson.GetString(value) is { } str) return [.. str.Split('\n')];
        return [];
    }

    private static List<string> FormatNotebookOutput(JsonObject output)
    {
        var lines = new List<string>();
        foreach (var field in new[] { "text", "traceback" })
        {
            var value = output[field];
            if (value is JsonArray arr)
            {
                lines.AddRange(arr.OfType<JsonValue>()
                    .Select(v => v.TryGetValue<string>(out var s) ? s.Replace("\r\n", "").TrimEnd('\n') : ""));
            }
            else if (AnyJson.GetString(value) is { } str)
            {
                lines.AddRange(str.Split('\n'));
            }
        }
        if (output["data"] is JsonObject data)
        {
            foreach (var key in new[] { "text/plain" })
            {
                if (data[key] is JsonValue v && v.TryGetValue<string>(out var text)) lines.Add(text);
                else if (data[key] is JsonArray arr)
                {
                    lines.AddRange(arr.OfType<JsonValue>()
                        .Select(x => x.TryGetValue<string>(out var s) ? s.Replace("\r\n", "").TrimEnd('\n') : ""));
                }
            }
            foreach (var imageKey in new[] { "image/png", "image/jpeg" })
            {
                if (AnyJson.GetString(data[imageKey]) is { } b64)
                {
                    lines.Add($"[{imageKey} {b64.Length} chars]");
                }
            }
        }
        if (lines.Count == 0) lines.Add("[output omitted]");
        return lines;
    }
}