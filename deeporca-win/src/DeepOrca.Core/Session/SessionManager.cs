using System.Text.Json.Nodes;
using DeepOrca.Core.Common;
using DeepOrca.Core.Llm;
using DeepOrca.Core.Mcp;
using DeepOrca.Core.Permissions;
using DeepOrca.Core.Prompt;
using DeepOrca.Core.Session;
using DeepOrca.Core.Tools;
using DeepOrca.Core.Types;

namespace DeepOrca.Core.Session;

// SessionManager — 组合根 + 激活循环（对拍 apple SessionManager.swift / 上游 session.ts）。
// 每会话一个控制器 Task → 多会话并发；单写者纪律下沉到 SessionStore/McpManager 内部。

public sealed class SessionConfig
{
    public required string ProjectRoot { get; init; }
    public required DeepOrcaSettings Settings { get; init; }
    public Func<DeepOrcaSettings, (string BaseUrl, string ApiKey)>? EndpointResolver { get; init; }
    /// <summary>测试注入：fake LLM 传输（SSE 桩）；null → 真实网络。</summary>
    public HttpMessageHandler? LlmHandler { get; init; }
}

public sealed class SessionManagerHooks
{
    public Func<SessionEntry, Task> OnSessionUpdate { get; set; } = _ => Task.CompletedTask;
    public Func<SessionMessage, Task> OnMessageAppend { get; set; } = _ => Task.CompletedTask;
    public Func<string, SessionStatus, Task> OnStatusChange { get; set; } = (_, _) => Task.CompletedTask;
    public Func<AskPermissionRequest, Task<PermissionDecision>> OnPermissionRequest { get; set; } = _ => Task.FromResult(PermissionDecision.Ask);
    /// <summary>M5 接入 GitFileHistory；当前为无操作占位。</summary>
    public Func<string, string, string?> RecordCheckpoint { get; set; } = (_, _) => null;
    public Func<IReadOnlyList<AskOption>, Task<string?>> AskUserPresenter { get; set; } = _ => Task.FromResult<string?>(null);
    public Func<string, Task<string>> WebSearch { get; set; } = _ => throw new InvalidOperationException("web search provider lands in M7");
    public Func<string, Task<string>> WebFetch { get; set; } = _ => throw new InvalidOperationException("web fetch provider lands in M7");
}

public sealed class SessionManager : IAsyncDisposable
{
    private readonly SessionConfig _config;
    private readonly SessionManagerHooks _hooks;
    private readonly SessionStore _store;
    private readonly OpenAiClient _llmClient;
    private readonly ToolExecutor _toolExecutor;
    private readonly McpManager _mcpManager;
    private readonly SessionFileRegistry _registry = new();
    private readonly BashHandler _bash;
    private readonly ReadHandler _read;
    private readonly WriteHandler _write;
    private readonly EditHandler _edit;
    private readonly AskUserQuestionHandler _askUser;
    private readonly UpdatePlanHandler _updatePlan;
    private readonly WebSearchHandler _webSearch;
    private readonly WebFetchHandler _webFetch;
    private readonly Func<List<SkillInfo>> _skillsProvider;

    private readonly Dictionary<string, SessionController> _controllers = new();
    private readonly object _controllersGate = new();
    private string? _activeSessionId;

    private sealed class SessionController
    {
        public Task? Task { get; set; }
        public bool Processing { get; set; }
    }

    public SessionManager(SessionConfig config, SessionManagerHooks? hooks = null)
    {
        _config = config;
        _hooks = hooks ?? new SessionManagerHooks();

        var (baseUrl, apiKey) = config.EndpointResolver?.Invoke(config.Settings)
            ?? (config.Settings.BaseUrl ?? "https://api.deepseek.com/v1", config.Settings.ApiKey ?? "");
        _store = new SessionStore(config.ProjectRoot);
        _llmClient = new OpenAiClient(baseUrl, apiKey, handler: config.LlmHandler);

        // 技能候选：按目录优先级扫描（G1 路由/LLM 匹配在 M8 接入；系统提示只带 name+description）
        _skillsProvider = () => SkillScanner.ScanAll(config.ProjectRoot, Runtime.HomeDir);

        // 工具注册表
        _bash = new BashHandler { ProjectRoot = config.ProjectRoot };
        _read = new ReadHandler
        {
            ProjectRoot = config.ProjectRoot,
            Registry = _registry,
            PathGrantProvider = () => _readGrant,
        };
        _write = new WriteHandler
        {
            ProjectRoot = config.ProjectRoot,
            Registry = _registry,
            PathGrantProvider = () => _writeGrant,
        };
        _edit = new EditHandler
        {
            ProjectRoot = config.ProjectRoot,
            Registry = _registry,
            PathGrantProvider = () => _writeGrant,
        };
        _askUser = new AskUserQuestionHandler { Presenter = _hooks.AskUserPresenter };
        _updatePlan = new UpdatePlanHandler { OnUpdate = _ => Task.CompletedTask };
        _webSearch = new WebSearchHandler { SearchProvider = _hooks.WebSearch };
        _webFetch = new WebFetchHandler { FetchProvider = _hooks.WebFetch };

        var handlers = new Dictionary<string, ToolHandler>
        {
            ["bash"] = _bash.Handle,
            ["read"] = _read.Handle,
            ["write"] = _write.Handle,
            ["edit"] = _edit.Handle,
            ["ask_user_question"] = _askUser.Handle,
            ["update_plan"] = _updatePlan.Handle,
            ["web_search"] = _webSearch.Handle,
            ["web_fetch"] = _webFetch.Handle,
        };
        _toolExecutor = new ToolExecutor(handlers);

        // MCP：用户配置 + 内置注册表占位（GitMCP 解析在 M6）
        var mcpConfigs = new Dictionary<string, McpServerConfig>();
        foreach (var (name, server) in config.Settings.McpServers) mcpConfigs[name] = server;
        _mcpManager = new McpManager(mcpConfigs);
    }

    // ── 每轮路径授权（M2 语义：按 permission 计划构造 PathGrant；当前 fail-closed 项目根）──

    private PathGrant? _readGrant;
    private PathGrant? _writeGrant;

    /// <summary>激活循环异常诊断钩子（宿主日志用；null 时静默，循环内已捕获的结构化错误不触发）。</summary>
    public Action<string, Exception>? OnActivationFault { get; set; }

    public SessionStore Store => _store;
    public McpManager McpManager => _mcpManager;
    public SessionFileRegistry Registry => _registry;

    public async Task ConfigureAsync(CancellationToken ct = default)
    {
        await _mcpManager.ConnectAllAsync(ct).ConfigureAwait(false);
    }

    // ── 会话 API ──

    public async Task<List<SessionEntry>> ListSessionsAsync(CancellationToken ct = default) =>
        (await _store.GetIndexAsync(ct).ConfigureAwait(false)).Entries;

    public Task<SessionEntry?> GetSessionAsync(string id, CancellationToken ct = default) =>
        _store.GetEntryAsync(id, ct);

    public Task<List<SessionMessage>> GetMessagesAsync(string id, CancellationToken ct = default) =>
        _store.LoadMessagesAsync(id, ct);

    public void SetActiveSession(string? id) => Interlocked.Exchange(ref _activeSessionId, id);

    public string? GetActiveSessionId()
    {
        lock (_controllersGate) return _activeSessionId;
    }

    public async Task<string> CreateSessionAsync(string prompt, bool planMode = false, CancellationToken ct = default)
    {
        var sessionId = Guid.NewGuid().ToString();
        var now = DateTimeOffset.UtcNow.ToString("o");
        var entry = new SessionEntry
        {
            Id = sessionId,
            Summary = prompt.Length > 100 ? prompt[..100] : prompt,
            Status = SessionStatus.Pending,
            PlanMode = planMode,
            CreateTime = now,
            UpdateTime = now,
        };
        await _store.UpsertEntryAsync(entry, ct).ConfigureAwait(false);

        // 系统提示（cache-stable 定序）
        var systemMessage = SessionMessage.Create(sessionId, SessionMessageRole.System,
            PromptBuilder.BuildSystemPrompt(BuildPromptInput(planMode)));
        await _store.AppendMessageAsync(systemMessage, ct).ConfigureAwait(false);

        var checkpointHash = _hooks.RecordCheckpoint(sessionId, $"Before: {(prompt.Length > 60 ? prompt[..60] : prompt)}");
        var userMsg = SessionMessage.Create(sessionId, SessionMessageRole.User, prompt);
        if (checkpointHash is not null)
        {
            userMsg = userMsg with { CheckpointHash = checkpointHash };
        }
        await _store.AppendMessageAsync(userMsg, ct).ConfigureAwait(false);
        await _hooks.OnMessageAppend(userMsg).ConfigureAwait(false);

        if (planMode)
        {
            var notice = SessionMessage.Create(sessionId, SessionMessageRole.System,
                "Plan mode on — read-only planning. Awaiting <proposed_plan>.");
            await _store.AppendMessageAsync(notice, ct).ConfigureAwait(false);
        }

        _activeSessionId = sessionId;
        await _hooks.OnSessionUpdate(entry).ConfigureAwait(false);
        await _hooks.OnStatusChange(sessionId, SessionStatus.Processing).ConfigureAwait(false);

        StartController(sessionId);
        return sessionId;
    }

    public async Task ReplySessionAsync(string sessionId, string prompt, bool? planMode = null, CancellationToken ct = default)
    {
        var entry = await _store.GetEntryAsync(sessionId, ct).ConfigureAwait(false);
        if (entry is null) return;
        if (IsProcessing(sessionId)) return;

        var previous = entry.PlanMode ?? false;
        var next = planMode ?? previous;
        if (next != previous)
        {
            await _store.UpdateEntryAsync<object?>(sessionId, e =>
            {
                e.PlanMode = next;
                e.UpdateTime = DateTimeOffset.UtcNow.ToString("o");
                e.Status = SessionStatus.Processing;
                return null;
            }, ct).ConfigureAwait(false);
            var notice = SessionMessage.Create(sessionId, SessionMessageRole.System,
                next ? "Plan mode on — read-only planning. Awaiting <proposed_plan>."
                     : "Plan mode off — changes are now permitted.");
            await _store.AppendMessageAsync(notice, ct).ConfigureAwait(false);
        }

        var checkpointHash = _hooks.RecordCheckpoint(sessionId, $"Before: {(prompt.Length > 60 ? prompt[..60] : prompt)}");
        var userMsg = SessionMessage.Create(sessionId, SessionMessageRole.User, prompt);
        if (checkpointHash is not null) userMsg = userMsg with { CheckpointHash = checkpointHash };
        await _store.AppendMessageAsync(userMsg, ct).ConfigureAwait(false);
        await _hooks.OnMessageAppend(userMsg).ConfigureAwait(false);
        await _hooks.OnStatusChange(sessionId, SessionStatus.Processing).ConfigureAwait(false);

        StartController(sessionId);
    }

    public bool IsProcessing(string sessionId)
    {
        lock (_controllersGate)
        {
            return _controllers.TryGetValue(sessionId, out var c) && c.Processing;
        }
    }

    public async Task DeleteSessionAsync(string sessionId, CancellationToken ct = default)
    {
        lock (_controllersGate) _controllers.Remove(sessionId);
        await _store.DeleteSessionAsync(sessionId, ct).ConfigureAwait(false);
    }

    private void StartController(string sessionId)
    {
        lock (_controllersGate)
        {
            _controllers[sessionId] = new SessionController { Processing = false };
        }
        var task = Task.Run(() => RunActivationAsync(sessionId));
        _ = task.ContinueWith(t =>
        {
            if (t.IsFaulted) OnActivationFault?.Invoke(sessionId, t.Exception);
        }, TaskScheduler.Default);
        lock (_controllersGate)
        {
            if (_controllers.TryGetValue(sessionId, out var controller)) controller.Task = task;
        }
    }

    // ── 激活循环（对拍 runActivation）──

    private async Task RunActivationAsync(string sessionId)
    {
        lock (_controllersGate)
        {
            if (_controllers.TryGetValue(sessionId, out var c)) c.Processing = true;
        }

        try
        {
            var messages = await _store.LoadMessagesAsync(sessionId).ConfigureAwait(false);

            // 进入处理态（对齐 apple：写回 entry，UI/CLI 等待循环依赖它）
            await _store.UpdateEntryAsync<object?>(sessionId, e =>
            {
                e.Status = SessionStatus.Processing;
                return null;
            }).ConfigureAwait(false);

            const int maxIterations = 80_000;

            for (var iteration = 0; iteration < maxIterations; iteration++)
            {
                var entry = await _store.GetEntryAsync(sessionId).ConfigureAwait(false);
                if (entry is null) return;
                var planMode = entry.PlanMode ?? false;

                // ── Compaction 检查（M5 接入：阈值估计 → 摘要替换）──
                // threshold 估计以 activeTokens 为准；M5 前直接跳过

                var apiMessages = _converter.BuildWireMessages(
                    messages, _config.Settings.ThinkingEnabled, _config.Settings.Model);
                var toolDefs = await ResolveToolDefinitionsAsync().ConfigureAwait(false);
                var chatMessages = WireToChatMessages(apiMessages);

                var streamEvents = new List<LlmStreamEvent>();
                var errorBox = (string?)null;
                try
                {
                    await foreach (var evt in _llmClient.StreamCompletionAsync(
                                       new ChatCompletionParams
                                       {
                                           Messages = chatMessages,
                                           Tools = toolDefs,
                                           Stream = true,
                                       },
                                       model: _config.Settings.Model,
                                       ct: CancellationToken.None).ConfigureAwait(false))
                    {
                        streamEvents.Add(evt);
                    }
                }
                catch (LlmException ex)
                {
                    errorBox = ex.Message;
                }

                if (errorBox is not null)
                {
                    var failMsg = SessionMessage.Create(sessionId, SessionMessageRole.Assistant,
                        $"⚠️ Request failed: {errorBox}");
                    messages.Add(failMsg);
                    await _store.AppendMessageAsync(failMsg).ConfigureAwait(false);
                    await _hooks.OnMessageAppend(failMsg).ConfigureAwait(false);
                    await _store.UpdateEntryAsync<object?>(sessionId, e =>
                    {
                        e.Status = SessionStatus.Failed;
                        e.FailReason = errorBox;
                        return null;
                    }).ConfigureAwait(false);
                    await _hooks.OnStatusChange(sessionId, SessionStatus.Failed).ConfigureAwait(false);
                    return;
                }

                var accumulator = new StreamAccumulator();
                ModelUsage? streamUsage = null;
                foreach (var evt in streamEvents)
                {
                    if (evt.Delta is { } delta) accumulator.Accumulate(delta);
                    if (evt.Usage is { } u) streamUsage = u;
                }

                var content = accumulator.GetContent();
                var reasoning = accumulator.GetReasoningContent();
                var toolCalls = accumulator.BuildToolCalls();

                // usage 立即累计（每轮响应后）
                if (streamUsage is { TotalTokens: > 0 })
                {
                    await _store.UpdateEntryAsync<object?>(sessionId, e =>
                    {
                        e.Usage = (e.Usage ?? new ModelUsage()).Add(streamUsage);
                        e.UsagePerModel ??= new Dictionary<string, ModelUsage>();
                        e.UsagePerModel[_config.Settings.Model] =
                            (e.UsagePerModel.GetValueOrDefault(_config.Settings.Model) ?? new ModelUsage())
                            .Add(streamUsage);
                        return null;
                    }).ConfigureAwait(false);
                }

                // assistant 消息（有内容或有 tool calls 才落）
                if (!string.IsNullOrEmpty(content) || toolCalls is { Count: > 0 })
                {
                    var toolCallsJson = toolCalls is { Count: > 0 }
                        ? new JsonArray(toolCalls.Select(c => (JsonNode)new JsonObject
                        {
                            ["id"] = c.Id,
                            ["type"] = c.Type,
                            ["function"] = new JsonObject
                            {
                                ["name"] = c.Function.Name,
                                ["arguments"] = c.Function.Arguments,
                            },
                        }).ToArray())
                        : null;

                    var assistantMsg = SessionMessage.Create(
                        sessionId, SessionMessageRole.Assistant,
                        string.IsNullOrEmpty(content) ? null : content,
                        messageParams: toolCallsJson is null ? null : new JsonObject { ["tool_calls"] = toolCallsJson },
                        meta: new MessageMeta
                        {
                            AsThinking = string.IsNullOrEmpty(reasoning) ? null : true,
                            Function = toolCallsJson?.DeepClone(),
                        });
                    messages.Add(assistantMsg);
                    await _store.AppendMessageAsync(assistantMsg).ConfigureAwait(false);
                    await _hooks.OnMessageAppend(assistantMsg).ConfigureAwait(false);
                }

                if (toolCalls is not { Count: > 0 })
                {
                    // 完成：无 tool calls
                    await _store.UpdateEntryAsync<object?>(sessionId, e =>
                    {
                        e.Status = SessionStatus.Completed;
                        e.AssistantReply = string.IsNullOrEmpty(content) ? null : content;
                        e.AssistantThinking = string.IsNullOrEmpty(reasoning) ? null : reasoning;
                        e.UpdateTime = DateTimeOffset.UtcNow.ToString("o");
                        return null;
                    }).ConfigureAwait(false);
                    await _hooks.OnSessionUpdate(entry).ConfigureAwait(false);
                    await _hooks.OnStatusChange(sessionId, SessionStatus.Completed).ConfigureAwait(false);
                    return;
                }

                // ── 整批权限预检（deny > ask > allow）──
                var plan = PermissionEngine.ComputeToolCallPermissions(
                    sessionId, _config.ProjectRoot, toolCalls,
                    _config.Settings.Permissions, planMode: planMode);

                // 构造本轮 PathGrant（read/write 边界按 scope 判定）
                var (writeOutside, readOutside) = PathBoundary.GrantOutsideRootsFlags(
                    plan.Permissions.SelectMany(p => p.Permission == PermissionDecision.Allow
                        ? toolCalls.Where(t => t.Id == p.ToolCallId)
                            .SelectMany(t => PermissionEngine.DescribePermissionRequest(t, _config.ProjectRoot).Scopes)
                            .Select(s => s.Wire())
                        : Enumerable.Empty<string>()),
                    quarantined: false);
                _readGrant = new PathGrant
                {
                    WriteRoots = [PathBoundary.ResolveGateRoot(_config.ProjectRoot)],
                    ReadRoots = [PathBoundary.ResolveGateRoot(_config.ProjectRoot)],
                    AllowWriteOutsideRoots = writeOutside,
                    AllowReadOutsideRoots = readOutside,
                };
                _writeGrant = _readGrant;

                if (plan.AskPermissions.Count > 0 && plan.Permissions.Any(p => p.Permission == PermissionDecision.Ask))
                {
                    var allApproved = true;
                    foreach (var request in plan.AskPermissions)
                    {
                        var decision = await _hooks.OnPermissionRequest(request).ConfigureAwait(false);
                        if (decision == PermissionDecision.Deny)
                        {
                            allApproved = false;
                            await _store.UpdateEntryAsync<object?>(sessionId, e =>
                            {
                                e.Status = SessionStatus.PermissionDenied;
                                return null;
                            }).ConfigureAwait(false);
                            await _hooks.OnStatusChange(sessionId, SessionStatus.PermissionDenied).ConfigureAwait(false);
                        }
                    }
                    if (!allApproved) return;
                }

                // ── 执行工具 ──
                var results = await _toolExecutor.ExecuteToolCallsAsync(
                    sessionId, toolCalls,
                    mcpFallback: toolCall => Task.FromResult<ToolExecutionResult?>(
                        _mcpManager.CallToolAsync(
                            StripMcpPrefix(toolCall.Function.Name),
                            ParseArgs(toolCall.Function.Arguments),
                            CancellationToken.None).GetAwaiter().GetResult()),
                    isCancelled: null).ConfigureAwait(false);

                // 追加 tool 结果消息（按执行顺序与 tool_call 一一配对）
                for (var i = 0; i < results.Count; i++)
                {
                    var toolCall = toolCalls[i];
                    var item = results[i];
                    var toolMsg = SessionMessage.Create(
                        sessionId, SessionMessageRole.Tool,
                        ToolResultJson.ToJson(item.Result).ToJsonString(),
                        messageParams: new JsonObject { ["tool_call_id"] = toolCall.Id },
                        meta: new MessageMeta
                        {
                            Function = new JsonObject
                            {
                                ["id"] = toolCall.Id,
                                ["name"] = toolCall.Function.Name,
                                ["arguments"] = toolCall.Function.Arguments,
                            },
                            ResultMd = item.Result.Ok ? item.Result.Output : item.Result.Error,
                        });
                    messages.Add(toolMsg);
                    await _store.AppendMessageAsync(toolMsg).ConfigureAwait(false);
                    await _hooks.OnMessageAppend(toolMsg).ConfigureAwait(false);
                }
            }
        }
        finally
        {
            lock (_controllersGate)
            {
                if (_controllers.TryGetValue(sessionId, out var c)) c.Processing = false;
            }
        }
    }

    private static string StripMcpPrefix(string name) => name.StartsWith("mcp__", StringComparison.Ordinal)
        ? name[5..] : name;

    private static JsonObject? ParseArgs(string? arguments) => arguments is null ? null : ToolExecutor.LenientParseArguments(arguments);

    private readonly OpenAiMessageConverter _converter = new(new OpenAiMessageConverterOptions
    {
        BuildTurnTail = model => PromptBuilder.CurrentTurnTail(model),
    });

    private static List<ChatMessage> WireToChatMessages(JsonArray wire)
    {
        var result = new List<ChatMessage>();
        foreach (var node in wire)
        {
            if (node is not JsonObject obj) continue;
            result.Add(new ChatMessage
            {
                Role = AnyJson.GetString(obj["role"]) ?? "user",
                Content = AnyJson.GetString(obj["content"]),
                ToolCalls = obj["tool_calls"] is JsonArray calls ? calls.OfType<JsonObject>().Select(c => new ToolCall(
                    AnyJson.GetString(c["id"]) ?? "",
                    new ToolCallFunction(
                        c["function"] is JsonObject fn ? AnyJson.GetString(fn["name"]) ?? "" : "",
                        c["function"] is JsonObject fn2 ? AnyJson.GetString(fn2["arguments"]) ?? "{}" : "{}"))).ToList() : null,
                ToolCallId = AnyJson.GetString(obj["tool_call_id"]),
            });
        }
        return result;
    }

    private PromptBuilder.PromptInput BuildPromptInput(bool planMode) => new()
    {
        ScannedSkills = _skillsProvider(),
        AgentInstructions = AgentInstructionsLoader.Load(_config.ProjectRoot)?.Content,
        Memory = null,
        PlanMode = planMode,
    };

    // ── 工具面 ──

    private static readonly List<ToolDefinition> BuiltinToolDefinitions = BuildBuiltins();

    private static List<ToolDefinition> BuildBuiltins()
    {
        var bash = new ToolDefinition(new ToolFunctionDefinition(
            "bash", "Run a shell command in the project workspace",
            new ToolParameters("object")
            {
                Properties = new()
                {
                    ["command"] = new ToolProperty("string") { Description = "Shell command to run" },
                    ["timeout"] = new ToolProperty("integer") { Description = "Timeout in ms" },
                    ["description"] = new ToolProperty("string") { Description = "What the command does" },
                    ["run_in_background"] = new ToolProperty("boolean") { Description = "Run in background" },
                },
                Required = ["command"],
            }));
        var read = new ToolDefinition(new ToolFunctionDefinition(
            "read", "Read a file; returns a snippet_id for later edits",
            new ToolParameters("object")
            {
                Properties = new()
                {
                    ["file_path"] = new ToolProperty("string") { Description = "Absolute path to read" },
                    ["offset"] = new ToolProperty("integer") { Description = "1-based start line" },
                    ["limit"] = new ToolProperty("integer") { Description = "Max lines" },
                },
                Required = ["file_path"],
            }));
        var write = new ToolDefinition(new ToolFunctionDefinition(
            "write", "Write content to a file (atomic)",
            new ToolParameters("object")
            {
                Properties = new()
                {
                    ["file_path"] = new ToolProperty("string"),
                    ["content"] = new ToolProperty("string"),
                },
                Required = ["file_path", "content"],
            }));
        var edit = new ToolDefinition(new ToolFunctionDefinition(
            "edit", "Edit a file within the read snippet (snippet_id required)",
            new ToolParameters("object")
            {
                Properties = new()
                {
                    ["snippet_id"] = new ToolProperty("string") { Description = "From read tool metadata" },
                    ["file_path"] = new ToolProperty("string"),
                    ["old_string"] = new ToolProperty("string"),
                    ["new_string"] = new ToolProperty("string"),
                    ["replace_all"] = new ToolProperty("boolean"),
                },
                Required = ["snippet_id", "old_string", "new_string"],
            }));
        var ask = new ToolDefinition(new ToolFunctionDefinition(
            "ask_user_question", "Ask the user a question and wait for the answer",
            new ToolParameters("object")
            {
                Properties = new()
                {
                    ["question"] = new ToolProperty("string"),
                    ["options"] = new ToolProperty("array")
                    {
                        Items = new ToolProperty("object")
                        {
                            Properties = new()
                            {
                                ["label"] = new ToolProperty("string"),
                                ["value"] = new ToolProperty("string"),
                                ["description"] = new ToolProperty("string"),
                            },
                        },
                    },
                },
                Required = ["question"],
            }));
        var plan = new ToolDefinition(new ToolFunctionDefinition(
            "update_plan", "Update the plan tree (search/analysis plan mode)",
            new ToolParameters("object")
            {
                Properties = new()
                {
                    ["plan"] = new ToolProperty("object"),
                    ["mode"] = new ToolProperty("string"),
                },
            }));
        var search = new ToolDefinition(new ToolFunctionDefinition(
            "web_search", "Search the web (DDG Lite default)",
            new ToolParameters("object")
            {
                Properties = new() { ["query"] = new ToolProperty("string") },
                Required = ["query"],
            }));
        var fetch = new ToolDefinition(new ToolFunctionDefinition(
            "web_fetch", "Fetch and render a web page",
            new ToolParameters("object")
            {
                Properties = new() { ["url"] = new ToolProperty("string") },
                Required = ["url"],
            }));
        return [bash, read, write, edit, ask, plan, search, fetch];
    }

    public async Task<List<ToolDefinition>> ResolveToolDefinitionsAsync(CancellationToken ct = default) =>
    [
        .. BuiltinToolDefinitions,
        .. await _mcpManager.GetToolDefinitionsAsync(ct).ConfigureAwait(false),
    ];

    public async ValueTask DisposeAsync()
    {
        await _mcpManager.DisposeAsync().ConfigureAwait(false);
        await _store.DisposeAsync().ConfigureAwait(false);
    }
}