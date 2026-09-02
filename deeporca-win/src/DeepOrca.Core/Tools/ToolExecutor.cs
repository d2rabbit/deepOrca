using System.Text.Json.Nodes;
using DeepOrca.Core.Types;

namespace DeepOrca.Core.Tools;

// ToolExecutor — 工具分发（对拍上游 tools/executor.ts + apple ToolExecutor.swift）。
// 内建 handler 注册表 → 别名解析 → 宽松 JSON 参数解析 → 执行；未知工具/MCP 由宿主桥承接。

public sealed record ToolCallExecutionResult(ToolExecutionResult Result, long DurationMs);

public delegate Task<ToolExecutionResult> ToolHandler(ToolExecutionContext context, CancellationToken ct);

public sealed class ToolExecutor
{
    private static readonly Dictionary<string, string> Aliases = new(StringComparer.OrdinalIgnoreCase)
    {
        ["Bash"] = "bash",
        ["Read"] = "read",
        ["Write"] = "write",
        ["Edit"] = "edit",
        ["AskUserQuestion"] = "ask_user_question",
        ["UpdatePlan"] = "update_plan",
        ["WebSearch"] = "web_search",
        ["WebFetch"] = "web_fetch",
    };

    private readonly Dictionary<string, ToolHandler> _handlers;

    public ToolExecutor(Dictionary<string, ToolHandler>? handlers = null)
    {
        _handlers = handlers ?? [];
    }

    /// <summary>注册（幂等覆盖）。</summary>
    public void Register(string name, ToolHandler handler) => _handlers[name] = handler;

    public bool HasTool(string name) => _handlers.ContainsKey(ResolveHandlerName(name));

    public IReadOnlyDictionary<string, ToolHandler> Handlers => _handlers;

    public async Task<List<ToolCallExecutionResult>> ExecuteToolCallsAsync(
        string sessionId,
        IReadOnlyList<ToolCall> toolCalls,
        Func<ToolCall, Task<ToolExecutionResult?>>? mcpFallback = null,
        Func<bool>? isCancelled = null,
        CancellationToken ct = default)
    {
        var results = new List<ToolCallExecutionResult>();

        foreach (var toolCall in toolCalls)
        {
            if (isCancelled?.Invoke() == true) break;
            var startTime = Environment.TickCount64;

            var handlerName = ResolveHandlerName(toolCall.Function.Name);
            if (!_handlers.TryGetValue(handlerName, out var handler))
            {
                // MCP 兜底（manager 注入）；仍无 → 结构化 notFound
                if (mcpFallback is not null)
                {
                    var fallbackResult = await mcpFallback(toolCall).ConfigureAwait(false);
                    if (fallbackResult is not null)
                    {
                        results.Add(new ToolCallExecutionResult(fallbackResult, Environment.TickCount64 - startTime));
                        continue;
                    }
                }
                results.Add(new ToolCallExecutionResult(
                    ToolExecutionResult.Fail(toolCall.Function.Name,
                        $"Unknown tool: {toolCall.Function.Name}",
                        errorType: "notFound"),
                    0));
                continue;
            }

            var arguments = LenientParseArguments(toolCall.Function.Arguments);
            if (arguments is null)
            {
                results.Add(new ToolCallExecutionResult(
                    ToolExecutionResult.Fail(toolCall.Function.Name,
                        $"Failed to parse arguments: Invalid JSON arguments",
                        errorType: "inputParse"),
                    0));
                continue;
            }

            var projectRoot = ProjectRootOf(sessionId);
            var context = new ToolExecutionContext
            {
                SessionId = sessionId,
                ProjectRoot = projectRoot,
                Cwd = projectRoot,
                ToolCallId = toolCall.Id,
                ToolName = toolCall.Function.Name,
                Arguments = arguments,
                IsCancelled = isCancelled,
            };

            try
            {
                var result = await handler(context, ct).ConfigureAwait(false);
                results.Add(new ToolCallExecutionResult(result, Environment.TickCount64 - startTime));
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                results.Add(new ToolCallExecutionResult(
                    ToolExecutionResult.Fail(toolCall.Function.Name,
                        ex.Message, errorType: "execution"),
                    0));
            }
        }

        return results;
    }

    private readonly Dictionary<string, string> _projectRoots = new();

    /// <summary>宿主设置每会话 projectRoot（工具上下文解析相对路径用）。</summary>
    public void SetSessionProjectRoot(string sessionId, string projectRoot)
    {
        lock (_projectRoots) _projectRoots[sessionId] = projectRoot;
    }

    private string ProjectRootOf(string sessionId)
    {
        lock (_projectRoots) return _projectRoots.GetValueOrDefault(sessionId) ?? sessionId;
    }

    private static string ResolveHandlerName(string name)
    {
        if (Aliases.TryGetValue(name, out var alias)) return alias;
        return name.ToLowerInvariant();
    }

    /// <summary>宽松 JSON 解析（上游 lenientParseArguments 直译）：直接解析 → 去代码围栏 → 从散文提取对象。</summary>
    public static JsonObject? LenientParseArguments(string raw)
    {
        var trimmed = raw.Trim();
        if (trimmed.Length == 0) return null;

        if (AnyJson.Parse(trimmed) is JsonObject direct) return direct;

        if (ExtractFromCodeFence(trimmed) is { } fenced && AnyJson.Parse(fenced) is JsonObject fromFence) return fromFence;

        return ExtractJsonObject(trimmed);
    }

    private static string? ExtractFromCodeFence(string text)
    {
        var startFence = text.IndexOf("```", StringComparison.Ordinal);
        if (startFence < 0) return null;
        var searchFrom = startFence + 3;
        var newline = text.IndexOf('\n', searchFrom);
        if (newline >= 0) searchFrom = newline + 1; // 跳过语言标识

        var endFence = text.IndexOf("```", searchFrom, StringComparison.Ordinal);
        var content = endFence > searchFrom
            ? text[searchFrom..endFence]
            : text[searchFrom..];
        return content.Trim();
    }

    /// <summary>找首个 { 与配对 }（引号/转义感知），提取合法 JSON 对象。</summary>
    private static JsonObject? ExtractJsonObject(string text)
    {
        var start = text.IndexOf('{');
        if (start < 0) return null;

        var depth = 0;
        var inString = false;
        var escaped = false;
        for (var i = start; i < text.Length; i++)
        {
            var ch = text[i];
            if (escaped) { escaped = false; continue; }
            if (ch == '\\' && inString) { escaped = true; continue; }
            if (ch == '"') inString = !inString;
            if (inString) continue;

            if (ch == '{') depth++;
            else if (ch == '}')
            {
                depth--;
                if (depth == 0)
                {
                    return AnyJson.Parse(text[start..(i + 1)]) as JsonObject;
                }
            }
        }
        return null;
    }
}