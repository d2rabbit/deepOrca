using System.Text.Json.Nodes;
using DeepOrca.Core.Llm;
using DeepOrca.Core.Types;
using Xunit;

namespace DeepOrca.Core.Tests;

// MessageConverter 用例（对拍上游 openai-message-converter.ts 语义）
// tool 结果按 id 配对、中断回填、compaction 过滤、turn tail、trailing pending、
// thinking reasoning 注入、多模态过滤。

public class MessageConverterTests
{
    private static JsonObject ToolCallJson(string id, string name, string arguments = "{}") => new()
    {
        ["id"] = id,
        ["type"] = "function",
        ["function"] = new JsonObject { ["name"] = name, ["arguments"] = arguments },
    };

    private static SessionMessage AssistantWithToolCalls(string sessionId, params JsonObject[] calls)
    {
        var arr = new JsonArray();
        foreach (var call in calls) arr.Add(call.DeepClone());
        return SessionMessage.Create(sessionId, SessionMessageRole.Assistant, null,
            messageParams: new JsonObject { ["tool_calls"] = arr });
    }

    private static SessionMessage ToolResult(string sessionId, string toolCallId, string content, bool interrupted = false)
    {
        var messageParams = new JsonObject { ["tool_call_id"] = toolCallId };
        var finalContent = content;
        if (interrupted)
        {
            finalContent = new JsonObject
            {
                ["ok"] = false,
                ["name"] = "tool",
                ["error"] = "interrupted",
                ["metadata"] = new JsonObject { ["interrupted"] = true },
            }.ToJsonString();
        }
        return SessionMessage.Create(sessionId, SessionMessageRole.Tool, finalContent, messageParams: messageParams);
    }

    [Fact]
    public void Pairs_tool_results_with_tool_calls_by_id()
    {
        var converter = new OpenAiMessageConverter();
        var messages = new List<SessionMessage>
        {
            SessionMessage.Create("s1", SessionMessageRole.System, "sys"),
            SessionMessage.Create("s1", SessionMessageRole.User, "run it"),
            AssistantWithToolCalls("s1", ToolCallJson("call_1", "bash"), ToolCallJson("call_2", "read")),
            ToolResult("s1", "call_1", """result-one"""),
            ToolResult("s1", "call_2", """result-two"""),
        };

        var wire = converter.BuildWireMessages(messages, thinkingEnabled: false, model: "deepseek-chat");

        Assert.Equal(5, wire.Count);
        Assert.Equal("system", wire[0]!["role"]!.GetValue<string>());
        Assert.Equal("user", wire[1]!["role"]!.GetValue<string>());
        Assert.Equal("assistant", wire[2]!["role"]!.GetValue<string>());
        Assert.Equal("call_1", wire[3]!["tool_call_id"]!.GetValue<string>());
        Assert.Contains("result-one", wire[3]!["content"]!.GetValue<string>());
        Assert.Equal("call_2", wire[4]!["tool_call_id"]!.GetValue<string>());
        Assert.Contains("result-two", wire[4]!["content"]!.GetValue<string>());
    }

    [Fact]
    public void Backfills_interrupted_tool_call_without_result()
    {
        var converter = new OpenAiMessageConverter();
        var messages = new List<SessionMessage>
        {
            SessionMessage.Create("s1", SessionMessageRole.User, "go"),
            AssistantWithToolCalls("s1", ToolCallJson("call_x", "bash", """{"command":"ls"}""")),
            // 该 call 的结果缺失（会话被中断）
        };

        var wire = converter.BuildWireMessages(messages, thinkingEnabled: false, model: "deepseek-chat");

        var toolMessage = wire[2]!;
        Assert.Equal("tool", toolMessage["role"]!.GetValue<string>());
        Assert.Equal("call_x", toolMessage["tool_call_id"]!.GetValue<string>());
        var content = toolMessage["content"]!.GetValue<string>();
        Assert.Contains("\"ok\": false", content);
        Assert.Contains("Previous tool call did not complete.", content);
        Assert.Contains("interrupted", content);
        Assert.Contains("bash", content); // tool 名从 tool_calls 里找回
    }

    [Fact]
    public void Prefers_non_interrupted_result_over_interrupted_one()
    {
        var converter = new OpenAiMessageConverter();
        var messages = new List<SessionMessage>
        {
            SessionMessage.Create("s1", SessionMessageRole.User, "go"),
            AssistantWithToolCalls("s1", ToolCallJson("call_1", "bash")),
            ToolResult("s1", "call_1", "", interrupted: true),  // 先到的中断结果
            ToolResult("s1", "call_1", "real-result"),          // 后到的真实结果
        };

        var wire = converter.BuildWireMessages(messages, thinkingEnabled: false, model: "deepseek-chat");

        // 配对选中未中断结果（idx 3）；中断结果（idx 2）不产生额外 wire 消息
        Assert.Equal(3, wire.Count);
        Assert.Equal("tool", wire[2]!["role"]!.GetValue<string>());
        Assert.Contains("real-result", wire[2]!["content"]!.GetValue<string>());
    }

    [Fact]
    public void Filters_compacted_messages()
    {
        var converter = new OpenAiMessageConverter();
        var compacted = SessionMessage.Create("s1", SessionMessageRole.User, "old", compacted: true);
        var messages = new List<SessionMessage>
        {
            compacted,
            SessionMessage.Create("s1", SessionMessageRole.User, "new"),
        };

        var wire = converter.BuildWireMessages(messages, thinkingEnabled: false, model: "deepseek-chat");

        var user = Assert.Single(wire)!;
        Assert.Equal("new", user["content"]!.GetValue<string>());
    }

    [Fact]
    public void Appends_turn_tail_to_last_user_message_only()
    {
        var converter = new OpenAiMessageConverter(new OpenAiMessageConverterOptions
        {
            BuildTurnTail = _ => "[tail]",
        });
        var messages = new List<SessionMessage>
        {
            SessionMessage.Create("s1", SessionMessageRole.User, "first"),
            SessionMessage.Create("s1", SessionMessageRole.Assistant, "reply"),
            SessionMessage.Create("s1", SessionMessageRole.User, "second"),
        };

        var wire = converter.BuildWireMessages(messages, thinkingEnabled: false, model: "deepseek-chat");

        Assert.Equal("first", wire[0]!["content"]!.GetValue<string>());           // 前面的 user 不动
        Assert.Equal("second\n\n[tail]", wire[2]!["content"]!.GetValue<string>()); // 只改最后一条
    }

    [Fact]
    public void Renders_init_prompt_for_init_command()
    {
        var converter = new OpenAiMessageConverter(new OpenAiMessageConverterOptions
        {
            RenderInitPrompt = () => "INIT-TEMPLATE",
        });
        var messages = new List<SessionMessage>
        {
            SessionMessage.Create("s1", SessionMessageRole.User, "/init"),
        };

        var wire = converter.BuildWireMessages(messages, thinkingEnabled: false, model: "deepseek-chat");
        Assert.Equal("INIT-TEMPLATE", wire[0]!["content"]!.GetValue<string>());
    }

    [Fact]
    public void Replays_empty_reasoning_field_when_thinking_enabled()
    {
        var converter = new OpenAiMessageConverter(); // 默认 EmptyField（DeepSeek 家族）
        var messages = new List<SessionMessage>
        {
            SessionMessage.Create("s1", SessionMessageRole.Assistant, "answer"),
        };

        var wire = converter.BuildWireMessages(messages, thinkingEnabled: true, model: "deepseek-chat");

        Assert.Equal("", wire[0]!["reasoning_content"]!.GetValue<string>());
        Assert.Equal("answer", wire[0]!["content"]!.GetValue<string>());
    }

    [Fact]
    public void Omits_reasoning_field_when_thinking_disabled_or_mode_omit()
    {
        var omitConverter = new OpenAiMessageConverter(new OpenAiMessageConverterOptions
        {
            ReasoningReplay = ReasoningReplayMode.Omit,
        });
        var messages = new List<SessionMessage>
        {
            SessionMessage.Create("s1", SessionMessageRole.Assistant, "answer"),
        };

        var wire = omitConverter.BuildWireMessages(messages, thinkingEnabled: true, model: "deepseek-chat");
        Assert.Null(wire[0]!["reasoning_content"]);

        var offConverter = new OpenAiMessageConverter();
        var wire2 = offConverter.BuildWireMessages(messages, thinkingEnabled: false, model: "deepseek-chat");
        Assert.Null(wire2[0]!["reasoning_content"]);
    }

    [Fact]
    public void Filters_image_parts_for_non_multimodal_models()
    {
        var converter = new OpenAiMessageConverter(new OpenAiMessageConverterOptions
        {
            SupportsMultimodal = model => model.Contains("vision"),
        });
        var contentParams = new JsonArray(
            new JsonObject { ["type"] = "image_url", ["image_url"] = new JsonObject { ["url"] = "https://x/img.png" } });
        var messages = new List<SessionMessage>
        {
            SessionMessage.Create("s1", SessionMessageRole.User, "look", contentParams: contentParams),
        };

        var textOnly = converter.BuildWireMessages(messages, thinkingEnabled: false, model: "deepseek-chat");
        // TS 语义：过滤后 content 仍是 parts 数组（text part 常在），image part 被剔除
        var textParts = Assert.IsType<JsonArray>(textOnly[0]!["content"]);
        var textPart = Assert.Single(textParts)!;
        Assert.Equal("look", textPart["text"]!.GetValue<string>());

        var vision = converter.BuildWireMessages(messages, thinkingEnabled: false, model: "qwen-vision");
        Assert.True(vision[0]!["content"] is JsonArray); // 多模态保留 parts 数组
        var parts = (JsonArray)vision[0]!["content"]!;
        Assert.Equal(2, parts.Count);
    }

    [Fact]
    public void Returns_trailing_pending_tool_call_message()
    {
        var converter = new OpenAiMessageConverter();
        var assistant = AssistantWithToolCalls("s1", ToolCallJson("call_9", "bash"));
        var messages = new List<SessionMessage>
        {
            SessionMessage.Create("s1", SessionMessageRole.User, "go"),
            assistant,
        };

        var trailing = converter.GetTrailingPendingToolCallMessage(messages);
        Assert.NotNull(trailing.Message);
        Assert.Equal(assistant.Id, trailing.Message.Id);
        Assert.Single(trailing.ToolCalls);
        var fn = OpenAiMessageConverter.FindToolFunction(trailing.ToolCalls, "call_9");
        Assert.Equal("bash", fn is JsonObject obj ? AnyJson.GetString(obj["name"]) : null);

        // 非末尾 assistant 不算 trailing
        var withResult = new List<SessionMessage>(messages) { ToolResult("s1", "call_9", "done") };
        var none = converter.GetTrailingPendingToolCallMessage(withResult);
        Assert.Null(none.Message);
    }
}
