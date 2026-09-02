using System.Text.Json.Nodes;
using DeepOrca.Core.Common;
using DeepOrca.Core.Types;

using DeepOrca.Core.Permissions;
namespace DeepOrca.Core.Tools;

// WriteHandler — 文件写入（对拍上游 write-handler.ts）。
// 原子写（临时文件 + move）、父目录自动创建、写入后刷新文件状态（increment version）。

public sealed class WriteHandler
{
    public required string ProjectRoot { get; init; }
    public required SessionFileRegistry Registry { get; init; }
    public required Func<PathGrant?> PathGrantProvider { get; init; }

    public async Task<ToolExecutionResult> Handle(ToolExecutionContext context, CancellationToken ct = default)
    {
        var filePath = context.Arguments["file_path"] is JsonValue v && v.TryGetValue<string>(out var s)
            ? SessionFileRegistry.NormalizeFilePath(s)
            : "";
        var content = context.Arguments["content"] is JsonValue cv && cv.TryGetValue<string>(out var c) ? c : null;
        if (string.IsNullOrWhiteSpace(filePath))
        {
            return ToolExecutionResult.Fail("write", "Missing required \"file_path\" string.", errorType: "inputParse");
        }
        if (content is null)
        {
            return ToolExecutionResult.Fail("write", "Missing required \"content\" string.", errorType: "inputParse");
        }

        if (!SessionFileRegistry.IsAbsoluteFilePath(filePath))
        {
            if (filePath.StartsWith("../") || filePath.StartsWith("..\\"))
            {
                return ToolExecutionResult.Fail("write", "file_path must be an absolute path.");
            }
            filePath = Path.GetFullPath(Path.Combine(ProjectRoot, filePath));
        }

        var gate = PathBoundary.GateWrite(PathGrantProvider(), filePath, ProjectRoot);
        if (!gate.Ok)
        {
            return ToolExecutionResult.Fail("write", gate.Reason!,
                errorType: "permissionDenied", retryable: false);
        }

        try
        {
            var dir = Path.GetDirectoryName(filePath);
            if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);

            var temp = filePath + $".tmp-{Guid.NewGuid():N}";
            await File.WriteAllTextAsync(temp, content, ct).ConfigureAwait(false);
            File.Move(temp, filePath, overwrite: true);

            var (_, encoding, lineEndings, timestamp) = ReadHandler.ReadTextWithMetadata(filePath, ct);
            Registry.MarkFileRead(context.SessionId, filePath, new FileState
            {
                FilePath = filePath,
                Content = content,
                Timestamp = timestamp,
                Encoding = encoding,
                LineEndings = lineEndings,
            });

            return ToolExecutionResult.OkResult("write",
                $"Written {content.Length} characters to {Path.GetFileName(filePath)}",
                new JsonObject
                {
                    ["path"] = filePath,
                    ["bytesWritten"] = content.Length,
                    ["lines"] = content.Split('\n').Length,
                    ["cache_refreshed"] = true,
                });
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Fail("write",
                $"Failed to write {filePath}: {ex.Message}", errorType: "execution");
        }
    }
}