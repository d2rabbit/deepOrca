using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using DeepOrca.Core.Types;

namespace DeepOrca.Core.Llm;

// StreamParser — OpenAI 兼容 API 的 SSE 流解析（对拍 apple StreamParser.swift）。
// 职责：原始 SSE 文本 → ParsedDelta（content / reasoning_content / 按 index 装配 tool_calls）。

public sealed record ParsedDelta(
    string? Content,
    string? ReasoningContent,
    List<PartialToolCall>? ToolCalls,
    string? Role,
    string? Refusal)
{
    public bool IsEmpty =>
        Content is null && ReasoningContent is null && ToolCalls is null && Role is null && Refusal is null;

    public static ParsedDelta Empty { get; } = new(null, null, null, null, null);
}

/// <summary>按 index 增量到达的 tool call 片段。</summary>
public sealed record PartialToolCall(
    int Index,
    string? Id,
    string? Type,
    string? FunctionName,
    string? FunctionArguments)
{
    public bool IsComplete => Id is not null && FunctionName is not null && FunctionArguments is not null;
}

/// <summary>
/// 把流式 delta 累积为完整 assistant 消息。单写者纪律（design §五）：可变状态全部私有，
/// 只经方法读写——不暴露任何旁路修改路径。
/// </summary>
public sealed class StreamAccumulator
{
    private readonly object _gate = new();
    private string _content = "";
    private string _reasoningContent = "";
    private string _refusal = "";
    private string _role = "assistant";
    private readonly SortedDictionary<int, PartialToolCall> _toolCalls = new();

    public void Accumulate(ParsedDelta delta)
    {
        lock (_gate)
        {
            if (delta.Content is { } c) _content += c;
            if (delta.ReasoningContent is { } r) _reasoningContent += r;
            if (delta.Refusal is { } refusal) _refusal += refusal;
            if (delta.Role is { } role) _role = role;

            if (delta.ToolCalls is { } calls)
            {
                foreach (var call in calls)
                {
                    _toolCalls[call.Index] = _toolCalls.TryGetValue(call.Index, out var existing)
                        ? Merge(existing, call)
                        : call;
                }
            }
        }
    }

    public string GetContent() { lock (_gate) { return _content; } }
    public string GetReasoningContent() { lock (_gate) { return _reasoningContent; } }
    public string GetRefusal() { lock (_gate) { return _refusal; } }
    public string GetRole() { lock (_gate) { return _role; } }
    public bool HasContent() => GetContent().Length > 0;
    public bool HasReasoning() => GetReasoningContent().Length > 0;
    public bool HasRefusal() => GetRefusal().Length > 0;

    /// <summary>已完整的 tool calls（按 index 排序）；无则 null。</summary>
    public List<ToolCall>? BuildToolCalls()
    {
        lock (_gate)
        {
            if (_toolCalls.Count == 0) return null;
            var result = new List<ToolCall>();
            foreach (var partial in _toolCalls.Values)
            {
                if (partial.Id is { } id && partial.FunctionName is { } name && partial.FunctionArguments is { } args)
                {
                    result.Add(new ToolCall(id, new ToolCallFunction(name, args)));
                }
            }
            return result;
        }
    }

    public SessionMessage ToSessionMessage(string sessionId)
    {
        var content = GetContent();
        return SessionMessage.Create(
            sessionId,
            SessionMessageRole.Assistant,
            content.Length > 0 ? content : null,
            meta: new MessageMeta { AsThinking = GetReasoningContent().Length > 0 ? true : null });
    }

    private static PartialToolCall Merge(PartialToolCall existing, PartialToolCall next) => new(
        existing.Index,
        next.Id ?? existing.Id,
        next.Type ?? existing.Type,
        next.FunctionName ?? existing.FunctionName,
        (existing.FunctionArguments ?? "") + (next.FunctionArguments ?? ""));
}

/// <summary>
/// 解析 OpenAI 兼容流式响应的原始 SSE 文本。按行驱动：调用方把网络块喂给
/// <see cref="Parse"/>，流结束后调 <see cref="Flush"/> 清空残余缓冲。
/// </summary>
public sealed class SseStreamParser
{
    private readonly StringBuilder _buffer = new();
    private static readonly Regex InlineNameRegex = new("\"name\"\\s*:\\s*\"([^\"]+)\"", RegexOptions.Compiled);

    /// <summary>喂入一个网络块，返回其中完整行解析出的全部 delta。</summary>
    public List<ParsedDelta> Parse(string chunk)
    {
        _buffer.Append(chunk);
        var deltas = new List<ParsedDelta>();

        while (true)
        {
            var buffer = _buffer.ToString();
            var newline = buffer.IndexOf('\n');
            if (newline < 0) break;

            var line = buffer[..newline];
            _buffer.Clear().Append(buffer[(newline + 1)..]);

            // 注释行 / 空行跳过；"event:" 行对 chat completions 无意义，忽略
            if (line.StartsWith(':') || line.Trim().Length == 0) continue;

            if (line.StartsWith("data:"))
            {
                var payload = line[5..].Trim();
                var delta = ParseDataPayload(payload);
                if (delta is not null) deltas.Add(delta);
            }
        }

        return deltas;
    }

    /// <summary>
    /// 流结束后清空缓冲中未换行的残余数据。残余若带 "data:" 前缀（调用方按整行喂入时）同样剥离。
    /// </summary>
    public ParsedDelta? Flush()
    {
        var remaining = _buffer.ToString().Trim();
        _buffer.Clear();
        if (remaining.StartsWith("data:")) remaining = remaining[5..].Trim();
        return remaining.Length > 0 ? ParseDataPayload(remaining) : null;
    }

    private ParsedDelta? ParseDataPayload(string payload)
    {
        if (payload.Length == 0 || payload == "[DONE]") return null;
        var json = AnyJson.Parse(payload);

        if (json is JsonObject obj)
        {
            return ParseJsonPayload(obj) ?? ScavengeFromText(payload);
        }
        if (json is not null)
        {
            return ParseJsonPayload(json) ?? ScavengeFromText(payload);
        }
        // 弱模型可能吐出畸形 JSON —— 尝试从原始文本里打捞
        return ScavengeFromText(payload);
    }

    private static ParsedDelta? ParseJsonPayload(JsonNode json)
    {
        if (json is not JsonObject obj) return null;
        if (AnyJson.AsArray(obj["choices"]) is not { } choices || choices.Count == 0) return null;
        if (choices[0] is not JsonObject first) return null;
        var delta = first["delta"] as JsonObject ?? [];

        string? content = null, reasoning = null, role = null, refusal = null;
        List<PartialToolCall>? toolCalls = null;

        if (AnyJson.GetString(delta["content"]) is { } c) content = c;
        if (AnyJson.GetString(delta["reasoning_content"]) is { } rc) reasoning = rc;
        if (AnyJson.GetString(delta["role"]) is { } r) role = r;
        if (AnyJson.GetString(delta["refusal"]) is { } rf) refusal = rf;

        if (AnyJson.AsArray(delta["tool_calls"]) is { } rawCalls)
        {
            var calls = new List<PartialToolCall>();
            var index = 0;
            foreach (var rawNode in rawCalls)
            {
                if (rawNode is not JsonObject raw) { index++; continue; }
                var idx = AnyJson.GetInt(raw["index"]) ?? index;
                var id = AnyJson.GetString(raw["id"]);
                var type = AnyJson.GetString(raw["type"]);
                var fn = raw["function"] as JsonObject;
                var fnName = AnyJson.GetString(fn?["name"]);
                var fnArgs = AnyJson.GetString(fn?["arguments"]);

                if (id is not null || fnName is not null || fnArgs is not null)
                {
                    calls.Add(new PartialToolCall(idx, id, type, fnName, fnArgs));
                }
                index++;
            }
            if (calls.Count > 0) toolCalls = calls;
        }

        var result = new ParsedDelta(content, reasoning, toolCalls, role, refusal);
        return result.IsEmpty ? null : result;
    }

    /// <summary>
    /// JSON 解析失败时从原始文本打捞 content / arguments——容错产出畸形 JSON 的弱模型。
    /// </summary>
    private static ParsedDelta? ScavengeFromText(string text)
    {
        if (!text.Contains("```") && !text.Contains('{')) return null;

        string? content = null, functionName = null, functionArgs = null;

        var fence = text.IndexOf("```", StringComparison.Ordinal);
        if (fence >= 0)
        {
            var searchFrom = fence + 3;
            var closing = text.IndexOf("```", searchFrom, StringComparison.Ordinal);
            if (closing > searchFrom)
            {
                var codeBlock = text[searchFrom..closing].Trim();
                if (AnyJson.Parse(codeBlock) is JsonObject inner)
                {
                    content = AnyJson.GetString(inner["content"]) ?? AnyJson.GetString(inner["text"]);
                    functionName = AnyJson.GetString(inner["name"]);
                    if (inner["arguments"] is JsonObject argsObj)
                    {
                        functionArgs = argsObj.ToJsonString();
                    }
                }
                else
                {
                    content = codeBlock;
                }
            }
        }

        functionName ??= InlineNameRegex.Match(text) is { Success: true } m ? m.Groups[1].Value : null;

        if (content is null && functionName is null) return null;

        List<PartialToolCall>? calls = null;
        if (functionName is not null && functionArgs is not null)
        {
            calls = [new PartialToolCall(0, null, null, functionName, functionArgs)];
        }

        return new ParsedDelta(content, null, calls, null, null);
    }
}
