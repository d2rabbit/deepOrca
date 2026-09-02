using System.Text.Json.Nodes;
using DeepOrca.Core.Types;

namespace DeepOrca.Core.Llm;

// MessageConverter — SessionMessage[] → OpenAI wire messages（对拍上游 openai-message-converter.ts）。
// 处理：tool_call / tool 结果按 id 配对（含中断回填）、thinking 模式 reasoning 注入、
// 多模态 content parts（按模型能力过滤）、compaction 过滤、临时 turn tail。
// 输出为 wire JsonNode（role/content/tool_calls/tool_call_id/reasoning_content，
// content 可为字符串或 parts 数组）——请求体 "messages" 的最终形状。

public enum ReasoningReplayMode
{
    /// <summary>不回放 reasoning 字段。</summary>
    Omit,
    /// <summary>DeepSeek 契约：每条 assistant 回放空 reasoning 字段，content 照发（保持 cache 前缀字节稳定）。</summary>
    EmptyField,
    /// <summary>回放存储的 reasoning_content。</summary>
    Content,
}

public sealed record OpenAiMessageConverterOptions
{
    /// <summary>渲染 /init 命令提示词模板（命中 user "/init" 时替换内容）。</summary>
    public Func<string>? RenderInitPrompt { get; init; }

    /// <summary>
    /// 请求时构建临时 tail（当前日期 + 活动模型）。只追加到最后一条 user 消息、
    /// 绝不写入持久化 JSONL——时间性上下文走 turn tail 而不污染 cache-stable 前缀。
    /// </summary>
    public Func<string, string?>? BuildTurnTail { get; init; }

    /// <summary>模型多模态能力判定（注入：M4 接入 model-capabilities 注册表；缺省视为不支持 → 过滤 image parts）。</summary>
    public Func<string, bool>? SupportsMultimodal { get; init; }

    /// <summary>Reasoning 回放策略（M1 默认 empty-field = DeepSeek 家族；完整 family 注册表后置）。</summary>
    public ReasoningReplayMode ReasoningReplay { get; init; } = ReasoningReplayMode.EmptyField;

    public const string ReasoningField = "reasoning_content";
}

public sealed record TrailingPendingToolCalls(SessionMessage? Message, List<JsonNode> ToolCalls);

public sealed class OpenAiMessageConverter
{
    private readonly OpenAiMessageConverterOptions _options;

    public OpenAiMessageConverter(OpenAiMessageConverterOptions? options = null)
    {
        _options = options ?? new OpenAiMessageConverterOptions();
    }

    /// <summary>
    /// 构建请求 messages 数组：compaction 过滤 → tool 配对 → 逐条转换 → 中断回填 → turn tail。
    /// </summary>
    public JsonArray BuildWireMessages(List<SessionMessage> messages, bool thinkingEnabled, string model)
    {
        var activeMessages = messages.Where(m => !m.Compacted).ToList();
        var toolPairings = PairToolMessages(activeMessages);
        var wireMessages = new List<JsonObject>();

        for (var index = 0; index < activeMessages.Count; index++)
        {
            var message = activeMessages[index];
            if (message.Role == SessionMessageRole.Tool) continue;

            wireMessages.Add(ConvertMessage(message, thinkingEnabled, model));

            var toolCalls = GetAssistantToolCalls(message);
            if (toolCalls.Count == 0) continue;

            for (var toolCallIndex = 0; toolCallIndex < toolCalls.Count; toolCallIndex++)
            {
                var toolCallId = GetToolCallId(toolCalls[toolCallIndex]);
                if (toolCallId is null) continue;

                if (toolPairings.TryGetValue(PairingKey(index, toolCallIndex), out var pairedToolIndex))
                {
                    wireMessages.Add(ConvertMessage(activeMessages[pairedToolIndex], thinkingEnabled, model));
                    continue;
                }

                wireMessages.Add(BuildInterruptedWireToolMessage(toolCalls, toolCallId));
            }
        }

        var arr = new JsonArray();
        foreach (var wire in ApplyTurnTail(wireMessages, model)) arr.Add(wire);
        return arr;
    }

    /// <summary>末尾 assistant 若带未执行的 tool calls，返回它（中断恢复/M4 循环用）。</summary>
    public TrailingPendingToolCalls GetTrailingPendingToolCallMessage(List<SessionMessage> messages)
    {
        var activeMessages = messages.Where(m => !m.Compacted).ToList();
        var latest = activeMessages.Count > 0 ? activeMessages[^1] : null;
        if (latest is null || latest.Role != SessionMessageRole.Assistant)
        {
            return new TrailingPendingToolCalls(null, []);
        }

        var toolCalls = GetAssistantToolCalls(latest)
            .Where(call => GetToolCallId(call) is not null)
            .ToList();
        return toolCalls.Count == 0
            ? new TrailingPendingToolCalls(null, [])
            : new TrailingPendingToolCalls(latest, toolCalls);
    }

    /// <summary>按 toolCallId 在 tool_calls 数组里找 function 对象（SessionManager appendToolMessages 复用）。</summary>
    public static JsonNode? FindToolFunction(List<JsonNode> toolCalls, string toolCallId)
    {
        foreach (var call in toolCalls)
        {
            if (call is not JsonObject obj) continue;
            if (AnyJson.GetString(obj["id"]) == toolCallId) return obj["function"];
        }
        return null;
    }

    /// <summary>中断回填的 tool 结果体（metadata.interrupted = true；TS JSON.stringify(obj, null, 2) 形状）。</summary>
    public static string BuildInterruptedToolResult(JsonNode? toolFunction, string reason)
    {
        var toolName = toolFunction is JsonObject fn && AnyJson.GetString(fn["name"]) is { } name ? name : "tool";
        var result = new JsonObject
        {
            ["ok"] = false,
            ["name"] = toolName,
            ["error"] = reason,
            ["metadata"] = new JsonObject { ["interrupted"] = true },
        };
        return System.Text.Json.JsonSerializer.Serialize(result, new System.Text.Json.JsonSerializerOptions
        {
            WriteIndented = true,
        });
    }

    // ── private ──

    private JsonObject ConvertMessage(SessionMessage message, bool thinkingEnabled, string model)
    {
        var content = RenderContent(message);
        var wire = new JsonObject { ["role"] = message.Role.Wire() };

        var messageParams = message.MessageParams as JsonObject;

        // user "/init" 模板渲染 + 多模态 parts 组装
        if ((message.Role == SessionMessageRole.User || message.Role == SessionMessageRole.System)
            && message.ContentParams is JsonArray or JsonObject)
        {
            var parts = new JsonArray();
            if (!string.IsNullOrEmpty(content))
            {
                parts.Add(new JsonObject { ["type"] = "text", ["text"] = content });
            }

            var paramsArray = message.ContentParams is JsonArray arr ? arr : [message.ContentParams!];
            foreach (var param in paramsArray)
            {
                if (param is not JsonObject part) continue;
                var type = AnyJson.GetString(part["type"]);
                if (type == "image_url" && !IsMultimodal(model)) continue;
                parts.Add(part.DeepClone());
            }

            wire["content"] = parts.Count > 0 ? parts : content ?? "";
            return FinishMessage(wire, message, messageParams, thinkingEnabled);
        }

        wire["content"] = content;
        return FinishMessage(wire, message, messageParams, thinkingEnabled);
    }

    private JsonObject FinishMessage(
        JsonObject wire, SessionMessage message, JsonObject? messageParams, bool thinkingEnabled)
    {
        if (messageParams?["tool_calls"] is JsonArray toolCalls)
        {
            wire["tool_calls"] = toolCalls.DeepClone();
        }
        if (messageParams?["tool_call_id"] is { } toolCallId)
        {
            wire["tool_call_id"] = toolCallId.DeepClone();
        }

        if (thinkingEnabled && message.Role == SessionMessageRole.Assistant)
        {
            // Thinking-mode：每次回放都带 reasoning 字段。empty-field 策略（DeepSeek）——
            // 字段必须存在但置空，避免把 MB 级历史 reasoning 当 prompt 重传，同时保持
            // 回放前缀字节稳定（服务端 context cache 命中）。
            switch (_options.ReasoningReplay)
            {
                case ReasoningReplayMode.EmptyField:
                    wire[OpenAiMessageConverterOptions.ReasoningField] = "";
                    break;
                case ReasoningReplayMode.Content:
                    var stored = AnyJson.GetString(messageParams?[OpenAiMessageConverterOptions.ReasoningField]) ?? "";
                    wire[OpenAiMessageConverterOptions.ReasoningField] = stored;
                    break;
            }
        }

        return wire;
    }

    private string RenderContent(SessionMessage message)
    {
        if (message.Role == SessionMessageRole.User && message.Content == "/init")
        {
            return _options.RenderInitPrompt?.Invoke() ?? "";
        }
        return message.Content ?? "";
    }

    private bool IsMultimodal(string model) => _options.SupportsMultimodal?.Invoke(model) ?? false;

    /// <summary>tool 结果配对：assistantIndex:toolCallIndex → tool 消息下标。每个 tool 消息至多用一次。</summary>
    private Dictionary<string, int> PairToolMessages(List<SessionMessage> messages)
    {
        var pairings = new Dictionary<string, int>();
        var usedToolMessageIndexes = new HashSet<int>();

        for (var assistantIndex = 0; assistantIndex < messages.Count; assistantIndex++)
        {
            var toolCalls = GetAssistantToolCalls(messages[assistantIndex]);
            for (var toolCallIndex = 0; toolCallIndex < toolCalls.Count; toolCallIndex++)
            {
                var toolCallId = GetToolCallId(toolCalls[toolCallIndex]);
                if (toolCallId is null) continue;

                var toolIndex = FindPairableToolMessageIndex(messages, assistantIndex, toolCallId, usedToolMessageIndexes);
                if (toolIndex is null) continue;

                usedToolMessageIndexes.Add(toolIndex.Value);
                pairings[PairingKey(assistantIndex, toolCallIndex)] = toolIndex.Value;
            }
        }

        return pairings;
    }

    /// <summary>
    /// 在 assistant 之后找首个 tool_call_id 匹配且未被占用的 tool 消息；优先未中断的，
    /// 全部中断时回退首个（对拍上游 findPairableToolMessageIndex）。
    /// </summary>
    private static int? FindPairableToolMessageIndex(
        List<SessionMessage> messages, int assistantIndex, string toolCallId, HashSet<int> usedToolMessageIndexes)
    {
        int? firstMatchingIndex = null;
        for (var index = assistantIndex + 1; index < messages.Count; index++)
        {
            var message = messages[index];
            if (message.Role != SessionMessageRole.Tool || usedToolMessageIndexes.Contains(index)) continue;

            if (GetToolMessageCallId(message) != toolCallId) continue;

            firstMatchingIndex ??= index;
            if (!IsInterruptedToolMessage(message)) return index;
        }
        return firstMatchingIndex;
    }

    private static List<JsonNode> GetAssistantToolCalls(SessionMessage message)
    {
        if (message.Role != SessionMessageRole.Assistant) return [];
        if (message.MessageParams is not JsonObject messageParams) return [];
        if (messageParams["tool_calls"] is not JsonArray toolCalls) return [];
        return [.. toolCalls.OfType<JsonNode>()];
    }

    private static string? GetToolCallId(JsonNode toolCall) =>
        toolCall is JsonObject obj ? AnyJson.GetString(obj["id"]) is { } id && id.Length > 0 ? id : null : null;

    private static string? GetToolMessageCallId(SessionMessage message) =>
        message.MessageParams is JsonObject messageParams
            ? AnyJson.GetString(messageParams["tool_call_id"]) is { } id && id.Length > 0 ? id : null
            : null;

    private static string PairingKey(int assistantIndex, int toolCallIndex) => $"{assistantIndex}:{toolCallIndex}";

    private static bool IsInterruptedToolMessage(SessionMessage message)
    {
        if (message.Content is not { } content || string.IsNullOrWhiteSpace(content)) return false;
        if (AnyJson.Parse(content) is not JsonObject parsed) return false;
        return AnyJson.GetBool(parsed["metadata"] is JsonObject metadata ? metadata["interrupted"] : null) == true;
    }

    private static JsonObject BuildInterruptedWireToolMessage(List<JsonNode> toolCalls, string toolCallId)
    {
        var toolFunction = FindToolFunction(toolCalls, toolCallId);
        return new JsonObject
        {
            ["role"] = "tool",
            ["content"] = BuildInterruptedToolResult(toolFunction, "Previous tool call did not complete."),
            ["tool_call_id"] = toolCallId,
        };
    }

    /// <summary>把 tail 追加到最后一条 user 消息（请求时行为，不改持久化 JSONL）。</summary>
    private List<JsonObject> ApplyTurnTail(List<JsonObject> wireMessages, string model)
    {
        var tail = _options.BuildTurnTail?.Invoke(model);
        if (tail is null) return wireMessages;

        for (var i = wireMessages.Count - 1; i >= 0; i--)
        {
            var message = wireMessages[i];
            if (AnyJson.GetString(message["role"]) != "user") continue;

            switch (message["content"])
            {
                case JsonValue value when value.TryGetValue<string>(out var content):
                    message["content"] = content.Length > 0 ? $"{content}\n\n{tail}" : tail;
                    break;
                case JsonArray parts:
                    parts.Add(new JsonObject { ["type"] = "text", ["text"] = tail });
                    break;
                default:
                    message["content"] = tail;
                    break;
            }
            return wireMessages;
        }
        return wireMessages;
    }
}
