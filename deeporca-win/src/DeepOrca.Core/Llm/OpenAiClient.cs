using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Text.Json.Nodes;
using DeepOrca.Core.Types;

namespace DeepOrca.Core.Llm;

// OpenAiClient — OpenAI 兼容流式客户端（对拍 apple OpenAIClient.swift）。
// HttpClient + IAsyncEnumerable（design §三）；wire 字段 snake_case 手工拼装。
// 测试性：接受 HttpMessageHandler 注入，不在构造里创建真实网络依赖。

public sealed record StreamOptions(bool IncludeUsage = true);

public sealed record ResponseFormat(string Type = "text");

public sealed record ChatCompletionParams
{
    public required List<ChatMessage> Messages { get; init; }
    public List<ToolDefinition>? Tools { get; init; }
    public double? Temperature { get; init; } = 0.7;
    public int? MaxTokens { get; init; } = 4096;
    public bool Stream { get; init; } = true;
    public StreamOptions? StreamOptions { get; init; } = new();
    public double? TopP { get; init; }
    public double? PresencePenalty { get; init; }
    public double? FrequencyPenalty { get; init; }
    public List<string>? Stop { get; init; }
    public int? Seed { get; init; }
    public ResponseFormat? ResponseFormat { get; init; }
}

public sealed record CompletionResult(string Content, ModelUsage? Usage);

/// <summary>流式事件：Delta 为解析出的增量；Usage 为 include_usage 尾包（真实 token 计数）。</summary>
public sealed record LlmStreamEvent(ParsedDelta? Delta, ModelUsage? Usage);

public enum LlmErrorKind
{
    InvalidResponse,
    HttpError,
    Network,
    Cancelled,
    StreamTimeout,
    Unknown,
}

public sealed class LlmException : Exception
{
    public LlmErrorKind Kind { get; }
    public int? StatusCode { get; }

    public LlmException(LlmErrorKind kind, string message, int? statusCode = null, Exception? inner = null)
        : base(message, inner)
    {
        Kind = kind;
        StatusCode = statusCode;
    }

    public static LlmException HttpError(int code, string body) =>
        new(LlmErrorKind.HttpError, $"HTTP {code}: {Truncate(body, 200)}", code);

    public static LlmException InvalidResponse(string detail) =>
        new(LlmErrorKind.InvalidResponse, $"Invalid response: {detail}");

    private static string Truncate(string s, int max) => s.Length <= max ? s : s[..max];
}

public sealed class OpenAiClient
{
    private readonly HttpClient _http;
    private readonly string _baseUrl;
    private readonly string _apiKey;

    /// <summary>接受 handler 注入以便单测；生产路径用默认 HttpClient（PooledConnectionLifetime 对齐 180s keepAlive 语义）。</summary>
    public OpenAiClient(string baseUrl, string apiKey, HttpMessageHandler? handler = null, TimeSpan? timeout = null)
    {
        _baseUrl = baseUrl.TrimEnd('/');
        _apiKey = apiKey;
        if (handler is not null)
        {
            _http = new HttpClient(handler) { Timeout = timeout ?? Timeout.InfiniteTimeSpan };
        }
        else
        {
            _http = new HttpClient(new SocketsHttpHandler
            {
                PooledConnectionLifetime = TimeSpan.FromMinutes(3),
            })
            { Timeout = timeout ?? Timeout.InfiniteTimeSpan };
        }
    }

    /// <summary>流式补全：SSE 逐事件产出 delta，include_usage 尾包产出真实 usage。取消走 ct。</summary>
    public async IAsyncEnumerable<LlmStreamEvent> StreamCompletionAsync(
        ChatCompletionParams parameters,
        string? model = null,
        [EnumeratorCancellation] CancellationToken ct = default)
    {
        var body = BuildRequestJson(parameters, model ?? fallbackModel(parameters), stream: true);

        HttpResponseMessage response;
        try
        {
            response = await SendAsync(body, ct).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw new LlmException(LlmErrorKind.Cancelled, "Request was cancelled");
        }
        catch (HttpRequestException ex)
        {
            throw new LlmException(LlmErrorKind.Network, $"Network error: {ex.Message}", inner: ex);
        }

        using (response)
        {
            if (!response.IsSuccessStatusCode)
            {
                var errorBody = await response.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
                throw LlmException.HttpError((int)response.StatusCode, errorBody);
            }

            var parser = new SseStreamParser();
            var stream = await response.Content.ReadAsStreamAsync(ct).ConfigureAwait(false);
            using var reader = new StreamReader(stream);

            while (await reader.ReadLineAsync(ct).ConfigureAwait(false) is { } line)
            {
                if (line.StartsWith("data:"))
                {
                    var payload = line[5..].Trim();
                    if (payload == "[DONE]") continue;

                    foreach (var delta in parser.Parse(line + "\n"))
                    {
                        yield return new LlmStreamEvent(delta, null);
                    }

                    if (WireUsage(payload) is { } usage)
                    {
                        yield return new LlmStreamEvent(null, usage);
                    }
                }
            }

            if (parser.Flush() is { } final)
            {
                yield return new LlmStreamEvent(final, null);
            }
        }
    }

    /// <summary>非流式补全（Compaction / 摘要等后台任务用）。</summary>
    public async Task<CompletionResult> CompleteAsync(
        ChatCompletionParams parameters,
        string? model = null,
        CancellationToken ct = default)
    {
        var body = BuildRequestJson(parameters, model ?? fallbackModel(parameters), stream: false);
        HttpResponseMessage response;
        try
        {
            response = await SendAsync(body, ct).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw new LlmException(LlmErrorKind.Cancelled, "Request was cancelled");
        }
        catch (HttpRequestException ex)
        {
            throw new LlmException(LlmErrorKind.Network, $"Network error: {ex.Message}", inner: ex);
        }

        using (response)
        {
            var responseBody = await response.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            if (!response.IsSuccessStatusCode)
            {
                throw LlmException.HttpError((int)response.StatusCode, responseBody);
            }

            if (AnyJson.Parse(responseBody) is not JsonObject json
                || AnyJson.AsArray(json["choices"]) is not { } choices
                || choices.Count == 0
                || choices[0] is not JsonObject first
                || first["message"] is not JsonObject message
                || AnyJson.GetString(message["content"]) is not { } content)
            {
                throw LlmException.InvalidResponse("Missing content in response");
            }

            return new CompletionResult(content, ParseWireUsage(responseBody));
        }
    }

    private async Task<HttpResponseMessage> SendAsync(JsonObject body, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, $"{_baseUrl}/chat/completions")
        {
            Content = new StringContent(body.ToJsonString(), System.Text.Encoding.UTF8, "application/json"),
        };
        request.Headers.TryAddWithoutValidation("Authorization", $"Bearer {_apiKey}");
        return await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct).ConfigureAwait(false);
    }

    private static string fallbackModel(ChatCompletionParams parameters) => throw
        LlmException.InvalidResponse("model must be provided either in params or as override");

    // ── wire 组装（snake_case，静态可测）──

    public static JsonObject BuildRequestJson(ChatCompletionParams parameters, string model, bool stream)
    {
        var body = new JsonObject
        {
            ["model"] = model,
            ["messages"] = BuildMessagesJson(parameters.Messages),
            ["stream"] = stream,
        };

        if (stream && parameters.StreamOptions is { } so)
        {
            body["stream_options"] = new JsonObject { ["include_usage"] = so.IncludeUsage };
        }

        if (parameters.Tools is { } tools && tools.Count > 0)
        {
            var arr = new JsonArray();
            foreach (var tool in tools)
            {
                arr.Add(new JsonObject
                {
                    ["type"] = tool.Type,
                    ["function"] = new JsonObject
                    {
                        ["name"] = tool.Function.Name,
                        ["description"] = tool.Function.Description,
                        ["parameters"] = EncodeToolParameters(tool.Function.Parameters),
                    },
                });
            }
            body["tools"] = arr;
        }

        if (parameters.Temperature is { } temp) body["temperature"] = temp;
        if (parameters.MaxTokens is { } maxTok) body["max_tokens"] = maxTok;
        if (parameters.TopP is { } topP) body["top_p"] = topP;
        if (parameters.Seed is { } seed) body["seed"] = seed;
        if (parameters.Stop is { } stop)
        {
            body["stop"] = new JsonArray([.. stop.Select(s => (JsonNode?)s)]);
        }
        if (parameters.ResponseFormat is { } rf)
        {
            body["response_format"] = new JsonObject { ["type"] = rf.Type };
        }

        return body;
    }

    /// <summary>apple buildMessagesArray 直译：role/content/reasoning_content/refusal/tool_calls/tool_call_id。</summary>
    public static JsonArray BuildMessagesJson(List<ChatMessage> messages)
    {
        var arr = new JsonArray();
        foreach (var msg in messages)
        {
            var obj = new JsonObject { ["role"] = msg.Role };
            if (msg.Content is { } content) obj["content"] = content;
            if (msg.ReasoningContent is { } reasoning) obj["reasoning_content"] = reasoning;
            if (!string.IsNullOrEmpty(msg.Refusal)) obj["refusal"] = msg.Refusal;

            if (msg.ToolCalls is { } calls && calls.Count > 0)
            {
                var callArr = new JsonArray();
                foreach (var call in calls)
                {
                    callArr.Add(new JsonObject
                    {
                        ["id"] = call.Id,
                        ["type"] = call.Type,
                        ["function"] = new JsonObject
                        {
                            ["name"] = call.Function.Name,
                            ["arguments"] = call.Function.Arguments,
                        },
                    });
                }
                obj["tool_calls"] = callArr;
            }

            if (msg.ToolCallId is { } toolCallId) obj["tool_call_id"] = toolCallId;

            arr.Add(obj);
        }
        return arr;
    }

    internal static JsonObject EncodeToolParameters(ToolParameters parameters)
    {
        var obj = new JsonObject { ["type"] = parameters.Type };
        if (parameters.Properties is { } props)
        {
            var propsObj = new JsonObject();
            foreach (var (key, value) in props) propsObj[key] = EncodeToolProperty(value);
            obj["properties"] = propsObj;
        }
        if (parameters.Required is { } required)
        {
            obj["required"] = new JsonArray([.. required.Select(r => (JsonNode?)r)]);
        }
        return obj;
    }

    private static JsonObject EncodeToolProperty(ToolProperty property)
    {
        var obj = new JsonObject { ["type"] = property.Type };
        if (property.Description is { } d) obj["description"] = d;
        if (property.Properties is { } props)
        {
            var propsObj = new JsonObject();
            foreach (var (key, value) in props) propsObj[key] = EncodeToolProperty(value);
            obj["properties"] = propsObj;
        }
        if (property.Items is { } items) obj["items"] = EncodeToolProperty(items);
        if (property.EnumValues is { } enums)
        {
            obj["enum"] = new JsonArray([.. enums.Select(e => (JsonNode?)e)]);
        }
        return obj;
    }

    /// <summary>usage 尾包（include_usage）或非流式响应体的 snake_case 解析。</summary>
    public static ModelUsage? WireUsage(string payload)
    {
        if (AnyJson.Parse(payload) is JsonObject json && json["usage"] is JsonObject usage)
        {
            return UsageFromJson(usage);
        }
        return null;
    }

    public static ModelUsage? ParseWireUsage(string responseBody) => WireUsage(responseBody);

    private static ModelUsage UsageFromJson(JsonObject usage) => new()
    {
        PromptTokens = AnyJson.GetInt(usage["prompt_tokens"]) ?? 0,
        CompletionTokens = AnyJson.GetInt(usage["completion_tokens"]) ?? 0,
        TotalTokens = AnyJson.GetInt(usage["total_tokens"]) ?? 0,
        PromptCacheHitTokens = AnyJson.GetInt(usage["prompt_cache_hit_tokens"]),
        PromptCacheMissTokens = AnyJson.GetInt(usage["prompt_cache_miss_tokens"]),
    };
}
