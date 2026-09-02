using System.Net;
using System.Text;
using System.Text.Json.Nodes;
using DeepOrca.Core.Llm;
using DeepOrca.Core.Types;
using Xunit;

namespace DeepOrca.Core.Tests;

// OpenAiClient 用例：wire 请求体形状（snake_case）、SSE 端到端解析、错误体语义、
// include_usage 尾包。HttpClient 以 handler 注入，不触网。

public class OpenAiClientTests
{
    private sealed class StubHandler(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
    {
        public HttpRequestMessage? LastRequest { get; private set; }
        public string? LastBody { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            LastRequest = request;
            LastBody = request.Content is null ? null : request.Content.ReadAsStringAsync(ct).GetAwaiter().GetResult();
            return Task.FromResult(respond(request));
        }
    }

    private static HttpResponseMessage SseResponse(params string[] lines)
    {
        var body = string.Join("\n", lines) + "\n";
        return new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(body, Encoding.UTF8, "text/event-stream"),
        };
    }

    private static ChatCompletionParams Params() => new()
    {
        Messages = [new ChatMessage { Role = "user", Content = "hi" }],
        Tools =
        [
            new ToolDefinition(new ToolFunctionDefinition(
                "bash", "run shell",
                new ToolParameters("object")
                {
                    Properties = new()
                    {
                        ["command"] = new ToolProperty("string") { Description = "cmd", EnumValues = ["a", "b"] },
                        ["nested"] = new ToolProperty("object")
                        {
                            Properties = new() { ["deep"] = new ToolProperty("boolean") },
                        },
                    },
                    Required = ["command"],
                })),
        ],
        Temperature = 0.3,
        MaxTokens = 128,
    };

    [Fact]
    public void Builds_wire_request_body_with_snake_case()
    {
        var body = OpenAiClient.BuildRequestJson(Params(), "deepseek-chat", stream: true);

        Assert.Equal("deepseek-chat", body["model"]!.GetValue<string>());
        Assert.True(body["stream"]!.GetValue<bool>());
        Assert.True(body["stream_options"]!["include_usage"]!.GetValue<bool>());
        Assert.Equal(0.3, body["temperature"]!.GetValue<double>());
        Assert.Equal(128, body["max_tokens"]!.GetValue<int>());

        var tool = body["tools"]![0]!;
        Assert.Equal("bash", tool["function"]!["name"]!.GetValue<string>());
        var parameters = tool["function"]!["parameters"]!;
        Assert.Equal("command", parameters["required"]![0]!.GetValue<string>());
        Assert.Equal(new[] { "a", "b" },
            parameters["properties"]!["command"]!["enum"]!.AsArray()
                .Select((JsonNode? n) => n!.GetValue<string>()).ToArray());
        Assert.NotNull(parameters["properties"]!["nested"]!["properties"]!["deep"]); // 递归编码

        var message = body["messages"]![0]!;
        Assert.Equal("user", message["role"]!.GetValue<string>());
        Assert.Equal("hi", message["content"]!.GetValue<string>());
    }

    [Fact]
    public async Task Streams_deltas_and_usage_end_to_end()
    {
        var handler = new StubHandler(_ => SseResponse(
            """data: {"choices":[{"delta":{"role":"assistant","content":"你"}}]}""",
            """data: {"choices":[{"delta":{"content":"好"}}]}""",
            """data: {"choices":[{"delta":{},"finish_reason":"stop"}]}""",
            """data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12,"prompt_cache_hit_tokens":4,"prompt_cache_miss_tokens":6}}""",
            "data: [DONE]"));
        var client = new OpenAiClient("https://api.test/v1", "key", handler);

        var events = new List<LlmStreamEvent>();
        await foreach (var evt in client.StreamCompletionAsync(Params(), "deepseek-chat"))
        {
            events.Add(evt);
        }

        // 请求路径 + 认证头
        Assert.Equal("https://api.test/v1/chat/completions", handler.LastRequest!.RequestUri!.ToString());
        Assert.Equal("Bearer key", handler.LastRequest.Headers.GetValues("Authorization").Single());

        var deltas = events.Where(e => e.Delta is not null).Select(e => e.Delta!).ToList();
        Assert.Equal("你好", string.Concat(deltas.Select(d => d.Content ?? "")));

        var usage = events.Last(e => e.Usage is not null).Usage!;
        Assert.Equal(10, usage.PromptTokens);
        Assert.Equal(2, usage.CompletionTokens);
        Assert.Equal(12, usage.TotalTokens);
        Assert.Equal(4, usage.PromptCacheHitTokens);
        Assert.Equal(6, usage.PromptCacheMissTokens);
    }

    [Fact]
    public async Task Http_error_carries_status_and_body_prefix()
    {
        var handler = new StubHandler(_ => new HttpResponseMessage(HttpStatusCode.TooManyRequests)
        {
            Content = new StringContent("rate limited hard", Encoding.UTF8, "application/json"),
        });
        var client = new OpenAiClient("https://api.test/v1", "key", handler);

        var ex = await Assert.ThrowsAsync<LlmException>(
            async () => await client.CompleteAsync(Params(), "deepseek-chat"));

        Assert.Equal(LlmErrorKind.HttpError, ex.Kind);
        Assert.Equal(429, ex.StatusCode);
        Assert.Contains("HTTP 429", ex.Message);
        Assert.Contains("rate limited hard", ex.Message);
    }

    [Fact]
    public async Task Non_streaming_completion_returns_content_and_usage()
    {
        var handler = new StubHandler(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(
                """{"choices":[{"message":{"role":"assistant","content":"summarized"},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":1,"total_tokens":6}}""",
                Encoding.UTF8, "application/json"),
        });
        var client = new OpenAiClient("https://api.test/v1", "key", handler);

        var result = await client.CompleteAsync(Params(), "deepseek-chat");

        Assert.Equal("summarized", result.Content);
        Assert.NotNull(result.Usage);
        Assert.Equal(6, result.Usage.TotalTokens);

        var body = (JsonObject)AnyJson.Parse(handler.LastBody!)!;
        Assert.False(body["stream"]!.GetValue<bool>()); // 非流式不带 stream_options
        Assert.Null(body["stream_options"]);
    }

    [Fact]
    public async Task Missing_content_raises_invalid_response()
    {
        var handler = new StubHandler(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent("""{"choices":[{"message":{}}]}""", Encoding.UTF8, "application/json"),
        });
        var client = new OpenAiClient("https://api.test/v1", "key", handler);

        var ex = await Assert.ThrowsAsync<LlmException>(
            async () => await client.CompleteAsync(Params(), "deepseek-chat"));
        Assert.Equal(LlmErrorKind.InvalidResponse, ex.Kind);
    }
}
