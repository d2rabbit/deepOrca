using System.Text.Json.Nodes;
using DeepOrca.Core.Llm;
using Xunit;

namespace DeepOrca.Core.Tests;

// SSE StreamParser 直译用例（对拍 apple StreamParserTests.swift）+ 行级/畸形输入补充

public class SseStreamParserTests
{
    private static string SseLine(JsonObject delta)
    {
        var body = new JsonObject { ["choices"] = new JsonArray(new JsonObject { ["delta"] = delta.DeepClone() }) };
        return "data: " + body.ToJsonString();
    }

    [Fact]
    public void Parses_incremental_content_deltas()
    {
        var parser = new SseStreamParser();
        var chunks = new[]
        {
            """data: {"choices":[{"delta":{"content":"Hello"}}]}""",
            "\n",
            """data: {"choices":[{"delta":{"content":" world"}}]}""",
            "\n",
            "data: [DONE]",
            "\n",
        };

        var accumulator = new StreamAccumulator();
        foreach (var chunk in chunks)
        {
            foreach (var delta in parser.Parse(chunk)) accumulator.Accumulate(delta);
        }

        Assert.Equal("Hello world", accumulator.GetContent());
    }

    [Fact]
    public void Parses_tool_calls_with_by_index_assembly()
    {
        var parser = new SseStreamParser();
        var accumulator = new StreamAccumulator();

        var header = SseLine(new JsonObject
        {
            ["tool_calls"] = new JsonArray(new JsonObject
            {
                ["index"] = 0,
                ["id"] = "call_1",
                ["type"] = "function",
                ["function"] = new JsonObject { ["name"] = "bash", ["arguments"] = "" },
            }),
        });
        var args1 = SseLine(new JsonObject
        {
            ["tool_calls"] = new JsonArray(new JsonObject
            {
                ["index"] = 0,
                ["function"] = new JsonObject { ["arguments"] = """{"command":"ls""" },
            }),
        });
        var args2 = SseLine(new JsonObject
        {
            ["tool_calls"] = new JsonArray(new JsonObject
            {
                ["index"] = 0,
                ["function"] = new JsonObject { ["arguments"] = " -la\"}" },
            }),
        });

        foreach (var line in new[] { header, args1, args2, "data: [DONE]" })
        {
            foreach (var delta in parser.Parse(line + "\n")) accumulator.Accumulate(delta);
        }

        var toolCalls = accumulator.BuildToolCalls();
        Assert.NotNull(toolCalls);
        var call = Assert.Single(toolCalls);
        Assert.Equal("call_1", call.Id);
        Assert.Equal("bash", call.Function.Name);
        Assert.Equal("""{"command":"ls -la"}""", call.Function.Arguments);
    }

    [Fact]
    public void Parses_reasoning_content_separately()
    {
        var parser = new SseStreamParser();
        var accumulator = new StreamAccumulator();

        var lines = new[]
        {
            """data: {"choices":[{"delta":{"reasoning_content":"thinking deep"}}]}""",
            """data: {"choices":[{"delta":{"content":"Answer"}}]}""",
            "data: [DONE]",
        };
        foreach (var line in lines)
        {
            foreach (var delta in parser.Parse(line + "\n")) accumulator.Accumulate(delta);
        }

        Assert.Equal("thinking deep", accumulator.GetReasoningContent());
        Assert.Equal("Answer", accumulator.GetContent());
        Assert.True(accumulator.HasReasoning());
    }

    [Fact]
    public void Survives_malformed_json_without_throwing()
    {
        var parser = new SseStreamParser();
        var deltas = parser.Parse("data: {not-valid-json\n");
        var accumulator = new StreamAccumulator();
        foreach (var delta in deltas) accumulator.Accumulate(delta);
    }

    [Fact]
    public void Scavenges_content_from_code_fenced_json()
    {
        var parser = new SseStreamParser();
        var payload = """data: oops ```{"content":"recovered","name":"bash","arguments":{"command":"pwd"}}```""";
        var deltas = parser.Parse(payload + "\n");

        var delta = Assert.Single(deltas);
        Assert.Equal("recovered", delta.Content);
        Assert.NotNull(delta.ToolCalls);
        var call = Assert.Single(delta.ToolCalls);
        Assert.Equal("bash", call.FunctionName);
        Assert.Contains("pwd", call.FunctionArguments);
    }

    [Fact]
    public void Handles_split_lines_across_chunks()
    {
        var parser = new SseStreamParser();
        var accumulator = new StreamAccumulator();

        var full = """data: {"choices":[{"delta":{"content":"spl"}}]}""" + "\n";

        Assert.Empty(parser.Parse(full[..15]));   // 半行 → 无输出
        Assert.Empty(parser.Parse(full[15..40])); // 仍不完整
        var deltas = parser.Parse(full[40..]);    // 行结束 → 解析
        foreach (var delta in deltas) accumulator.Accumulate(delta);
        Assert.Equal("spl", accumulator.GetContent());
    }

    [Fact]
    public void Ignores_comment_and_event_lines()
    {
        var parser = new SseStreamParser();
        var deltas = parser.Parse(": keep-alive\n" +
                                  "event: ping\n" +
                                  """data: {"choices":[{"delta":{"content":"ok"}}]}""" + "\n");
        var delta = Assert.Single(deltas);
        Assert.Equal("ok", delta.Content);
    }

    [Fact]
    public void Flush_drains_remaining_buffer()
    {
        var parser = new SseStreamParser();
        Assert.Null(parser.Flush());
        Assert.Empty(parser.Parse("""data: {"choices":[{"delta":{"content":"tail"}}]}""")); // 无换行
        var delta = parser.Flush();
        Assert.NotNull(delta);
        Assert.Equal("tail", delta.Content);
    }

    [Fact]
    public void Parses_role_and_refusal()
    {
        var parser = new SseStreamParser();
        var line = SseLine(new JsonObject { ["role"] = "assistant", ["refusal"] = "no" });
        var delta = Assert.Single(parser.Parse(line + "\n"));
        Assert.Equal("assistant", delta.Role);
        Assert.Equal("no", delta.Refusal);
    }
}
