using System.Net;
using System.Text;
using System.Text.Json.Nodes;
using DeepOrca.Core.Common;
using DeepOrca.Core.Session;
using DeepOrca.Core.Tools;
using DeepOrca.Core.Types;
using Xunit;

namespace DeepOrca.Core.Tests;

// M4 组合测试：SessionManager 激活循环 E2E（fake SSE LLM）+ 工具面 + CLI 管线

public class SessionManagerTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), $"deeporca-sess-{Guid.NewGuid():N}");
    private readonly List<ToolExecutor> _executors = [];

    public void Dispose()
    {
        try { Directory.Delete(_root, recursive: true); } catch (IOException) { }
    }

    /// <summary>可编程 fake LLM：(delta, usage) 成对构成一次真实 SSE 响应流。</summary>
    private sealed class FakeLlmHandler(List<(string DeltaJson, string UsageJson)> turns) : HttpMessageHandler
    {
        private int _call;

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var (deltaJson, usageJson) = turns[Math.Min(_call, turns.Count - 1)];
            _call++;
            var sse = "data: " + deltaJson + "\n" + "data: " + usageJson + "\n" + "data: [DONE]\n";
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(sse, Encoding.UTF8, "text/event-stream"),
            });
        }
    }

    private SessionManager NewManager(List<(string DeltaJson, string UsageJson)> llmTurns, Action<SessionManagerHooks>? tuneHooks = null)
    {
        return NewManager(llmTurns, PermissionMode.Permissive, tuneHooks);
    }

    private SessionManager NewManager(
        List<(string DeltaJson, string UsageJson)> llmTurns,
        PermissionMode permissionMode,
        Action<SessionManagerHooks>? tuneHooks = null)
    {
        var hooks = new SessionManagerHooks
        {
            OnPermissionRequest = _ => Task.FromResult(PermissionDecision.Allow),
        };
        tuneHooks?.Invoke(hooks);
        var settings = new DeepOrcaSettings
        {
            Model = "deepseek-chat",
            ApiKey = "test-key",
            BaseUrl = "https://api.test/v1",
            Permissions = new PermissionSettings { Mode = permissionMode },
        };
        return new SessionManager(
            new SessionConfig
            {
                ProjectRoot = _root,
                Settings = settings,
                LlmHandler = new FakeLlmHandler(llmTurns),
            },
            hooks);
    }

    private static string Delta(JsonObject delta) =>
        new JsonObject { ["choices"] = new JsonArray(new JsonObject { ["delta"] = delta.DeepClone() }) }.ToJsonString();

    private static string UsageTail(int prompt, int completion) =>
        new JsonObject
        {
            ["choices"] = new JsonArray(),
            ["usage"] = new JsonObject
            {
                ["prompt_tokens"] = prompt,
                ["completion_tokens"] = completion,
                ["total_tokens"] = prompt + completion,
            },
        }.ToJsonString();

    private static JsonObject ToolCallDelta(string id, string name, string arguments) => new()
    {
        ["role"] = "assistant",
        ["tool_calls"] = new JsonArray(new JsonObject
        {
            ["index"] = 0,
            ["id"] = id,
            ["type"] = "function",
            ["function"] = new JsonObject { ["name"] = name, ["arguments"] = arguments },
        }),
    };

    private static JsonObject TextDelta(string content) => new()
    {
        ["role"] = "assistant",
        ["content"] = content,
    };

    [Fact]
    public async Task End_to_end_tool_loop_completes_with_usage()
    {
        await using var manager = NewManager([
            (Delta(ToolCallDelta("call_1", "bash", """{"command":"echo hello-from-bash"}""")), UsageTail(10, 5)),
            (Delta(TextDelta("done with tool")), UsageTail(15, 8)),
        ]);

        var id = await manager.CreateSessionAsync("run the tool");

        for (var i = 0; i < 200 && (manager.IsProcessing(id) || (await manager.GetSessionAsync(id))?.Status == SessionStatus.Pending); i++) await Task.Delay(50);

        var entry = await manager.GetSessionAsync(id);
        Assert.Equal(SessionStatus.Completed, entry!.Status);
        Assert.Equal("done with tool", entry.AssistantReply);

        // 消息序列：system / user / assistant(tool_calls) / tool / assistant(回答)
        var messages = await manager.GetMessagesAsync(id);
        Assert.Equal(5, messages.Count);
        Assert.Equal(SessionMessageRole.Assistant, messages[2].Role);
        Assert.Equal(SessionMessageRole.Tool, messages[3].Role);
        Assert.Contains("hello-from-bash", messages[3].Content!);
        Assert.Equal("call_1", messages[3].MessageParams?["tool_call_id"]?.GetValue<string>());

        // usage 累计（两轮）
        Assert.NotNull(entry.Usage);
        Assert.True(entry.Usage.TotalTokens >= 25);
        Assert.NotNull(entry.UsagePerModel);
        Assert.True(entry.UsagePerModel.ContainsKey("deepseek-chat"));
    }

    [Fact]
    public async Task Parallel_sessions_complete_concurrently()
    {
        await using var manager = NewManager([
            (Delta(TextDelta("first")), UsageTail(3, 3)),
            (Delta(TextDelta("second")), UsageTail(3, 3)),
        ]);

        var ids = new List<string>();
        for (var i = 0; i < 2; i++)
        {
            ids.Add(await manager.CreateSessionAsync($"prompt {i}"));
        }

        for (var i = 0; i < 200 && ids.Any(id => manager.IsProcessing(id) || (manager.GetSessionAsync(id).GetAwaiter().GetResult())?.Status == SessionStatus.Pending); i++) await Task.Delay(50);

        foreach (var id in ids)
        {
            var entry = await manager.GetSessionAsync(id);
            Assert.Equal(SessionStatus.Completed, entry!.Status);
        }
        Assert.Equal(2, (await manager.ListSessionsAsync()).Count);
    }

    [Fact]
    public async Task Permission_denied_status_when_user_denies()
    {
        // balanced 下 git push -> mutateGitLog -> ask（permissive 会直接 allow，测不到 deny 分支）
        await using var manager = NewManager(
            [
                (Delta(ToolCallDelta("call_x", "bash", """{"command":"git push origin main"}""")), UsageTail(5, 5)),
            ],
            PermissionMode.Balanced,
            hooks => hooks.OnPermissionRequest = _ => Task.FromResult(PermissionDecision.Deny));

        var id = await manager.CreateSessionAsync("do it");
        for (var i = 0; i < 100 && (manager.IsProcessing(id) || (await manager.GetSessionAsync(id))?.Status == SessionStatus.Pending); i++) await Task.Delay(50);

        var entry = await manager.GetSessionAsync(id);
        Assert.Equal(SessionStatus.PermissionDenied, entry!.Status);
        // 工具没执行
        var messages = await manager.GetMessagesAsync(id);
        Assert.DoesNotContain(messages, m => m.Role == SessionMessageRole.Tool);
    }

    [Fact]
    public async Task Llm_failure_marks_session_failed()
    {
        await using var manager = NewManager(
            [(Delta(TextDelta("broken")), UsageTail(0, 0))],
            hooks => { _ = hooks; });
        // 用坏 handler：第一轮后直接抛——通过让 FakeLlm 返回非 2xx
        var settings = new DeepOrcaSettings
        {
            Model = "deepseek-chat",
            ApiKey = "test-key",
            BaseUrl = "https://api.test/v1",
        };
        await using var failing = new SessionManager(
            new SessionConfig
            {
                ProjectRoot = _root,
                Settings = settings,
                LlmHandler = new FailingHandler(),
            },
            new SessionManagerHooks());

        var id = await failing.CreateSessionAsync("ping");
        for (var i = 0; i < 100 && (failing.IsProcessing(id) || (await failing.GetSessionAsync(id))?.Status == SessionStatus.Pending); i++) await Task.Delay(50);

        var entry = await failing.GetSessionAsync(id);
        Assert.Equal(SessionStatus.Failed, entry!.Status);
        Assert.Contains("HTTP 500", entry.FailReason);
    }

    private sealed class FailingHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct) =>
            Task.FromResult(new HttpResponseMessage(HttpStatusCode.InternalServerError)
            {
                Content = new StringContent("boom", Encoding.UTF8),
            });
    }
}

// ReadHandler 片段契约（对拍 read-handler.ts）

public class ReadHandlerTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), $"deeporca-read-{Guid.NewGuid():N}");
    private readonly SessionFileRegistry _registry = new();

    public void Dispose()
    {
        try { Directory.Delete(_root, recursive: true); } catch (IOException) { }
    }

    private ReadHandler NewHandler() => new()
    {
        ProjectRoot = _root,
        Registry = _registry,
        PathGrantProvider = () => PathGrant.ProjectOnly(_root),
    };

    private static ToolExecutionContext Ctx(string sessionId, JsonObject args) => new()
    {
        SessionId = sessionId,
        ProjectRoot = Path.GetTempPath(),
        Cwd = Path.GetTempPath(),
        ToolCallId = "tc",
        ToolName = "read",
        Arguments = args,
    };

    [Fact]
    public async Task Read_returns_line_numbers_and_snippet_metadata()
    {
        Directory.CreateDirectory(_root);
        var file = Path.Combine(_root, "a.txt");
        await File.WriteAllTextAsync(file, "line1\nline2\nline3\n");

        var handler = NewHandler();
        var result = await handler.Handle(Ctx("s1", new JsonObject { ["file_path"] = file }));

        Assert.True(result.Ok);
        Assert.Contains("     1\tline1", result.Output);
        Assert.Contains("     3\tline3", result.Output);
        var snippet = result.Metadata!["snippet"]!;
        Assert.Equal(1, snippet["startLine"]!.GetValue<int>());
        // 尾换行产生空尾行（split 语义，与 TS 一致）：endLine=4
        Assert.Equal(4, snippet["endLine"]!.GetValue<int>());
        Assert.StartsWith("full_file_", snippet["id"]!.GetValue<string>());
    }

    [Fact]
    public async Task Read_offset_limit_produces_partial_snippet()
    {
        Directory.CreateDirectory(_root);
        var file = Path.Combine(_root, "many.txt");
        await File.WriteAllTextAsync(file, string.Join("\n", Enumerable.Range(1, 10).Select(i => $"row-{i}")) + "\n");

        var handler = NewHandler();
        var result = await handler.Handle(Ctx("s1", new JsonObject
        {
            ["file_path"] = file,
            ["offset"] = 4,
            ["limit"] = 3,
        }));

        Assert.True(result.Ok);
        Assert.Contains("     4\trow-4", result.Output);
        Assert.DoesNotContain("row-1", result.Output);
        var snippet = result.Metadata!["snippet"]!;
        Assert.Equal(4, snippet["startLine"]!.GetValue<int>());
        Assert.Equal(6, snippet["endLine"]!.GetValue<int>());
        Assert.StartsWith("snippet_", snippet["id"]!.GetValue<string>());
    }

    [Fact]
    public async Task Read_rejects_out_of_project_absolute_path_when_no_grant()
    {
        var outside = Path.Combine(Path.GetTempPath(), $"outside-{Guid.NewGuid():N}.txt");
        await File.WriteAllTextAsync(outside, "x");

        var handler = NewHandler();
        var result = await handler.Handle(Ctx("s1", new JsonObject { ["file_path"] = outside }));

        Assert.False(result.Ok);
        Assert.Contains("outside the allowed read boundary", result.Error);
        File.Delete(outside);
    }

    [Fact]
    public async Task Read_not_found_and_directory_cases()
    {
        var handler = NewHandler();
        var missing = await handler.Handle(Ctx("s1", new JsonObject { ["file_path"] = Path.Combine(_root, "nope.txt") }));
        Assert.False(missing.Ok);
        Assert.Contains("File not found", missing.Error);

        Directory.CreateDirectory(Path.Combine(_root, "adir"));
        var dirResult = await handler.Handle(Ctx("s1", new JsonObject { ["file_path"] = Path.Combine(_root, "adir") }));
        Assert.False(dirResult.Ok);
        Assert.Contains("directory", dirResult.Error);
    }
}

// EditHandler 片段契约（对拍 edit-handler.ts）

public class EditHandlerTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), $"deeporca-edit-{Guid.NewGuid():N}");
    private readonly SessionFileRegistry _registry = new();

    public void Dispose()
    {
        try { Directory.Delete(_root, recursive: true); } catch (IOException) { }
    }

    private (EditHandler Handler, string File) Setup(string content)
    {
        Directory.CreateDirectory(_root);
        var file = Path.Combine(_root, "x.cs");
        File.WriteAllText(file, content);
        return (new EditHandler
        {
            ProjectRoot = _root,
            Registry = _registry,
            PathGrantProvider = () => PathGrant.ProjectOnly(_root),
        }, file);
    }

    private async Task<(FileSnippet Snippet, string File)> ReadThenGetSnippet(string sessionId)
    {
        var file = Path.Combine(_root, "x.cs");
        var read = new ReadHandler
        {
            ProjectRoot = _root,
            Registry = _registry,
            PathGrantProvider = () => PathGrant.ProjectOnly(_root),
        };
        var result = await read.Handle(new ToolExecutionContext
        {
            SessionId = sessionId, ProjectRoot = _root, Cwd = _root,
            ToolCallId = "r", ToolName = "read", Arguments = new JsonObject { ["file_path"] = file },
        });
        var snippetId = result.Metadata!["snippet"]!["id"]!.GetValue<string>();
        return (_registry.GetSnippet(sessionId, snippetId)!, file);
    }

    private static ToolExecutionContext EditCtx(string sessionId, string file, string snippetId, string oldStr, string newStr, bool replaceAll = false) => new()
    {
        SessionId = sessionId, ProjectRoot = Path.GetTempPath(), Cwd = Path.GetTempPath(),
        ToolCallId = "e", ToolName = "edit",
        Arguments = new JsonObject
        {
            ["snippet_id"] = snippetId,
            ["file_path"] = file,
            ["old_string"] = oldStr,
            ["new_string"] = newStr,
            ["replace_all"] = replaceAll,
        },
    };

    [Fact]
    public async Task Edit_searches_only_within_snippet_range()
    {
        var content = "alpha\nbeta\nalpha\n";
        var (handler, file) = Setup(content);
        var (snippet, _) = await ReadThenGetSnippet("s1");
        // 片段是整文件（full）→ 两个 alpha 都命中 → 非唯一报错
        var first = await handler.Handle(EditCtx("s1", file, snippet.Id, "alpha", "gamma"));
        Assert.False(first.Ok);
        Assert.Contains("not unique", first.Error);
        Assert.NotNull(first.Metadata!["candidates"]);
    }

    [Fact]
    public async Task Edit_single_replace_updates_file_and_refreshes_cache()
    {
        var content = "beta\nalpha\n";
        var (handler, file) = Setup(content);
        var (snippet, _) = await ReadThenGetSnippet("s1");

        var result = await handler.Handle(EditCtx("s1", file, snippet.Id, "alpha", "gamma"));

        Assert.True(result.Ok);
        Assert.Equal("beta\ngamma\n", File.ReadAllText(file));
        Assert.True(result.Metadata!["cache_refreshed"]!.GetValue<bool>());
        Assert.Equal("full", result.Metadata!["read_scope_type"]!.GetValue<string>());
        Assert.NotNull(result.Metadata!["diff_preview"]);
        Assert.Contains("alpha", result.Metadata!["diff_preview"]!.GetValue<string>());
    }

    [Fact]
    public async Task Edit_requires_read_first_and_guards_modified_since_read()
    {
        var (handler, file) = Setup("original\n");
        // 未 read → 拒绝（snippet 存在但文件状态缺失：模拟恢复会话的清空状态）
        var restored = _registry.CreateSnippet("s2", file, 1, 1, "original", fullFile: false);
        var withoutRead = await handler.Handle(EditCtx("s2", file, restored!.Id, "original", "changed"));
        Assert.False(withoutRead.Ok);
        Assert.Contains("Must read file before editing", withoutRead.Error);

        // read 后外部修改 → 守卫（mtime 毫秒截断与 TS 一致，写入前留 5ms 保证 mtime 变化）
        var (snippet, _) = await ReadThenGetSnippet("s3");
        await Task.Delay(5);
        await File.WriteAllTextAsync(file, "external-change\n");
        var result = await handler.Handle(EditCtx("s3", file, snippet.Id, "original", "changed"));
        Assert.False(result.Ok);
        Assert.Contains("modified since read", result.Error);
    }

    [Fact]
    public async Task Edit_unknown_snippet_and_mismatched_file_errors()
    {
        var (handler, file) = Setup("abc\n");
        var unknown = await handler.Handle(EditCtx("s1", file, "snippet_999", "abc", "xyz"));
        Assert.False(unknown.Ok);
        Assert.Contains("Unknown snippet_id", unknown.Error);

        var (snippet, _) = await ReadThenGetSnippet("s4");
        var wrongFile = await handler.Handle(EditCtx("s4", Path.Combine(_root, "other.cs"), snippet.Id, "abc", "xyz"));
        Assert.False(wrongFile.Ok);
        Assert.Contains("does not belong", wrongFile.Error);
    }

    [Fact]
    public async Task Edit_tab_stripped_correction_matches_read_output()
    {
        var content = "value = 1\n";
        var (handler, file) = Setup(content);
        var (snippet, _) = await ReadThenGetSnippet("s5");

        // 模型把 read 输出格式（"     6\tvalue = 1"）原样当 old_string
        var result = await handler.Handle(EditCtx("s5", file, snippet.Id, "     1\tvalue = 1", "value = 2"));

        Assert.True(result.Ok);
        Assert.Equal("value = 2\n", File.ReadAllText(file));
    }

    [Fact]
    public async Task Edit_replace_all_handles_multiple_matches()
    {
        var content = "x\nx\nx\n";
        var (handler, file) = Setup(content);
        var (snippet, _) = await ReadThenGetSnippet("s6");

        var result = await handler.Handle(EditCtx("s6", file, snippet.Id, "x", "y", replaceAll: true));

        Assert.True(result.Ok);
        Assert.Equal(3, result.Metadata!["replaced_count"]!.GetValue<int>());
        Assert.Equal("y\ny\ny\n", File.ReadAllText(file));
    }
}

// ToolExecutor 分发（对拍 executor.ts）

public class ToolExecutorTests
{
    [Fact]
    public async Task Resolves_capitalized_aliases_and_executes()
    {
        var executor = new ToolExecutor(new Dictionary<string, ToolHandler>
        {
            ["bash"] = (ctx, ct) => Task.FromResult(ToolExecutionResult.OkResult("bash", $"ran:{ctx.Arguments["command"]}")),
        });
        var calls = new List<ToolCall>
        {
            new("c1", new ToolCallFunction("Bash", """{"command":"ls"}""")),
        };

        var results = await executor.ExecuteToolCallsAsync("s1", calls);

        var r = Assert.Single(results);
        Assert.True(r.Result.Ok);
        Assert.Contains("ran:ls", r.Result.Output);
    }

    [Fact]
    public async Task Lenient_parse_extracts_from_prose_and_fences()
    {
        var executor = new ToolExecutor(new Dictionary<string, ToolHandler>
        {
            ["read"] = (ctx, ct) => Task.FromResult(ToolExecutionResult.OkResult("read", "ok")),
        });

        // 码农风格围栏
        var fenced = new ToolCall("c1", new ToolCallFunction("Read", "```json\n{\"file_path\":\"/a/b\"}\n```"));
        var r1 = Assert.Single(await executor.ExecuteToolCallsAsync("s1", [fenced]));
        Assert.True(r1.Result.Ok);

        // 散文里的 JSON
        var prose = new ToolCall("c2", new ToolCallFunction("read", "here is the plan {\"file_path\":\"/x/y\"} thanks"));
        var r2 = Assert.Single(await executor.ExecuteToolCallsAsync("s1", [prose]));
        Assert.True(r2.Result.Ok);
    }

    [Fact]
    public async Task Unknown_tool_returns_not_found()
    {
        var executor = new ToolExecutor([]);
        var calls = new List<ToolCall> { new("c1", new ToolCallFunction("no_such_tool", "{}")) };

        var r = Assert.Single(await executor.ExecuteToolCallsAsync("s1", calls));
        Assert.False(r.Result.Ok);
        Assert.Equal("notFound", r.Result.ErrorType);
        Assert.Contains("Unknown tool", r.Result.Error);
    }

    [Fact]
    public async Task Mcp_fallback_used_for_unregistered_tools()
    {
        var executor = new ToolExecutor([]);
        var calls = new List<ToolCall> { new("c1", new ToolCallFunction("echo", """{"text":"hi"}""")) };

        var results = await executor.ExecuteToolCallsAsync("s1", calls,
            mcpFallback: call => Task.FromResult<ToolExecutionResult?>(
                ToolExecutionResult.OkResult(call.Function.Name, $"mcp:{call.Function.Arguments}")));

        var r = Assert.Single(results);
        Assert.True(r.Result.Ok);
        Assert.Contains("mcp:", r.Result.Output);
    }
}

// BashHandler（marker/cwd/超时/退出码）

public class BashHandlerTests
{
    [Fact]
    public async Task Executes_command_and_strips_marker()
    {
        var handler = new BashHandler { ProjectRoot = Path.GetTempPath() };
        var result = await handler.Handle(new ToolExecutionContext
        {
            SessionId = "s1", ProjectRoot = Path.GetTempPath(), Cwd = Path.GetTempPath(),
            ToolCallId = "b", ToolName = "bash",
            Arguments = new JsonObject { ["command"] = "echo marker-test-output" },
        });

        Assert.True(result.Ok);
        Assert.Equal("marker-test-output", result.Output!.Trim());
        Assert.DoesNotContain("__DEEPORCA_PWD__", result.Output);
        Assert.Equal(0, result.Metadata!["exitCode"]!.GetValue<int>());
    }

    [Fact]
    public async Task Non_zero_exit_is_structured_failure()
    {
        var handler = new BashHandler { ProjectRoot = Path.GetTempPath() };
        var result = await handler.Handle(new ToolExecutionContext
        {
            SessionId = "s1", ProjectRoot = Path.GetTempPath(), Cwd = Path.GetTempPath(),
            ToolCallId = "b", ToolName = "bash",
            Arguments = new JsonObject { ["command"] = "exit 3" },
        });

        Assert.False(result.Ok);
        Assert.Contains("exit code 3", result.Error);
        Assert.Equal(3, result.Metadata!["exitCode"]!.GetValue<int>());
    }

    [Fact]
    public async Task Timeout_kills_long_running_command()
    {
        var handler = new BashHandler { ProjectRoot = Path.GetTempPath(), MinTimeoutMs = 1000 };
        var sw = System.Diagnostics.Stopwatch.StartNew();
        var result = await handler.Handle(new ToolExecutionContext
        {
            SessionId = "s1", ProjectRoot = Path.GetTempPath(), Cwd = Path.GetTempPath(),
            ToolCallId = "b", ToolName = "bash",
            Arguments = new JsonObject { ["command"] = "sleep 30", ["timeout"] = 1500 },
        });
        sw.Stop();

        Assert.False(result.Ok);
        Assert.Contains("timed out", result.Error);
        Assert.True(sw.ElapsedMilliseconds < 15000, $"timeout took {sw.ElapsedMilliseconds}ms");
    }

    [Fact]
    public async Task Session_cwd_tracks_cd_and_persists()
    {
        var dir = Path.Combine(Path.GetTempPath(), $"deeporca-cwd-{Guid.NewGuid():N}");
        Directory.CreateDirectory(dir);
        var handler = new BashHandler { ProjectRoot = Path.GetTempPath() };

        var cd = await handler.Handle(new ToolExecutionContext
        {
            SessionId = "s1", ProjectRoot = Path.GetTempPath(), Cwd = Path.GetTempPath(),
            ToolCallId = "b", ToolName = "bash",
            Arguments = new JsonObject { ["command"] = $"cd {dir}" },
        });
        Assert.True(cd.Ok);

        var pwd = await handler.Handle(new ToolExecutionContext
        {
            SessionId = "s1", ProjectRoot = Path.GetTempPath(), Cwd = handler.GetSessionCwd("s1"),
            ToolCallId = "b", ToolName = "bash",
            Arguments = new JsonObject { ["command"] = "pwd" },
        });
        Assert.True(pwd.Ok);
        Assert.Contains(Path.GetFullPath(dir), pwd.Output!);
        Directory.Delete(dir, recursive: true);
    }

    [Fact]
    public async Task No_output_is_reported_explicitly()
    {
        var handler = new BashHandler { ProjectRoot = Path.GetTempPath() };
        var result = await handler.Handle(new ToolExecutionContext
        {
            SessionId = "s1", ProjectRoot = Path.GetTempPath(), Cwd = Path.GetTempPath(),
            ToolCallId = "b", ToolName = "bash",
            Arguments = new JsonObject { ["command"] = "true" },
        });

        Assert.True(result.Ok);
        Assert.Equal("(no output)", result.Output);
    }
}