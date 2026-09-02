using DeepOrca.Cli;
using DeepOrca.Core.Session;
using DeepOrca.Core.Types;

// DeepOrca.Cli — chat / parallel / tokens / version（对齐 apple 分支验证手段）。
// M4：chat（单发 + 交互）与 parallel（双会话并发）实装；tokens 自 M5 汇总实装。

var command = args.Length > 0 ? args[0] : "chat";
var projectRoot = System.IO.Path.GetFullPath(
    args.FirstOrDefault(a => a.StartsWith("--project="))?.Split('=')[1] ?? ".");
var yes = args.Contains("--yes");

var settings = CliSettings.Resolve(projectRoot);
if (command is "version" or "-v" or "--version")
{
    Console.WriteLine("deeporcacli 0.2.0 (net10.0, win-native, M4)");
    return 0;
}

if (string.IsNullOrEmpty(settings.ApiKey))
{
    Console.Error.WriteLine(
        "No API key configured. Set DEEPORCA_API_KEY or write .deeporca/settings.json (endpoints[].apiKey).");
    return 2;
}

var host = new CliHost(yes);
var manager = new SessionManager(
    new SessionConfig { ProjectRoot = projectRoot, Settings = settings },
    host.BuildHooks());
await manager.ConfigureAsync().ConfigureAwait(false);

switch (command)
{
    case "chat":
        {
            var positional = args.Where(a => !a.StartsWith('-')).Skip(1).ToList();
            if (positional.Count > 0)
            {
                // 单发
                var id = await manager.CreateSessionAsync(string.Join(" ", positional)).ConfigureAwait(false);
                await WaitUntilSettledAsync(manager, id).ConfigureAwait(false);
                var entry = await manager.GetSessionAsync(id).ConfigureAwait(false);
                return entry?.Status == SessionStatus.Completed ? 0 : 1;
            }

            // 交互
            Console.WriteLine("DeepOrca chat — Ctrl+C 退出");
            while (true)
            {
                Console.Write("> ");
                var line = Console.ReadLine();
                if (line is null || line.Trim() is "exit" or "quit") break;
                var id = await manager.CreateSessionAsync(line).ConfigureAwait(false);
                await WaitUntilSettledAsync(manager, id).ConfigureAwait(false);
            }
            return 0;
        }
    case "parallel":
        {
            Console.WriteLine("Running two sessions concurrently…");
            var tasks = new List<Task<string>>();
            for (var i = 0; i < 2; i++)
            {
                var sessionId = await manager.CreateSessionAsync(
                    $"Say hello returning text 'reply-{i}' only.").ConfigureAwait(false);
                tasks.Add(WaitUntilSettledAsync(manager, sessionId));
            }
            await Task.WhenAll(tasks).ConfigureAwait(false);

            var failures = 0;
            foreach (var id in tasks.Select(t => t.Result))
            {
                var entry = await manager.GetSessionAsync(id).ConfigureAwait(false);
                var ok = entry?.Status == SessionStatus.Completed;
                Console.WriteLine($"[parallel] {id[..8]} status={entry?.Status.Wire()} reply={(entry?.AssistantReply is { Length: > 80 } r ? r[..80] : entry?.AssistantReply ?? "(none)")}");
                if (!ok) failures++;
            }
            return failures == 0 ? 0 : 1;
        }
    case "tokens":
        // M5 前：从索引 usage 汇总（spark 到 M5 TokenSummary 全量实现）
        var index = await manager.ListSessionsAsync().ConfigureAwait(false);
        var total = index.Aggregate(new DeepOrca.Core.Types.ModelUsage(), (acc, e) => e.Usage is null ? acc : acc.Add(e.Usage));
        Console.WriteLine($"sessions={index.Count} prompt_tokens={total.PromptTokens} completion_tokens={total.CompletionTokens} total_tokens={total.TotalTokens}");
        return 0;
    default:
        Console.Error.WriteLine("用法：deeporcacli [chat | parallel | tokens | version]");
        return 1;
    }

static async Task<string> WaitUntilSettledAsync(SessionManager manager, string sessionId)
{
    // 等后台激活任务真正启动（状态离开 Pending）并跑完
    while (true)
    {
        var entry = await manager.GetSessionAsync(sessionId).ConfigureAwait(false);
        if (!manager.IsProcessing(sessionId) && entry is not null && entry.Status != SessionStatus.Pending)
        {
            return sessionId;
        }
        await Task.Delay(100).ConfigureAwait(false);
    }
}