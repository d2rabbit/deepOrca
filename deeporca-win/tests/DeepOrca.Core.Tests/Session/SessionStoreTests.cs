using DeepOrca.Core.Session;
using DeepOrca.Core.Types;
using Xunit;

namespace DeepOrca.Core.Tests;

// SessionStore 用例：JSONL 往返、去抖索引不变量（读优先内存）、终端 flush、容量上限

public class SessionStoreTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), $"deeporca-store-{Guid.NewGuid():N}");

    private SessionStore NewStore() => new(_root);

    public void Dispose()
    {
        try { Directory.Delete(_root, recursive: true); } catch (IOException) { }
    }

    private static SessionMessage Msg(string sessionId, SessionMessageRole role, string content) =>
        SessionMessage.Create(sessionId, role, content);

    private static SessionEntry Entry(string id) => new()
    {
        Id = id,
        Summary = $"session {id}",
        Status = SessionStatus.Completed,
        CreateTime = DateTime.UtcNow.ToString("o"),
        UpdateTime = DateTime.UtcNow.ToString("o"),
    };

    [Fact]
    public async Task Messages_survive_jsonl_round_trip()
    {
        await using var store = NewStore();
        var messages = new[]
        {
            Msg("s1", SessionMessageRole.System, "sys"),
            Msg("s1", SessionMessageRole.User, "hello"),
            Msg("s1", SessionMessageRole.Assistant, "hi"),
        };
        foreach (var m in messages) await store.AppendMessageAsync(m);

        var loaded = await store.LoadMessagesAsync("s1");
        Assert.Equal(3, loaded.Count);
        Assert.Equal("sys", loaded[0].Content);
        Assert.Equal(SessionMessageRole.Assistant, loaded[2].Role);
    }

    [Fact]
    public async Task Upsert_reads_prefer_in_memory_index_within_debounce_window()
    {
        await using var store = NewStore();
        var entry = Entry("s1");
        await store.UpsertEntryAsync(entry);

        // debounce 窗口内（250ms）立即多次更新：全部 rebase 同一内存基线，不丢更新
        await store.UpdateEntryAsync<string?>("s1", e =>
        {
            e.AssistantReply = "first";
            return null;
        });
        await store.UpdateEntryAsync<string?>("s1", e =>
        {
            e.AssistantReply = "second";
            e.Usage = new ModelUsage { TotalTokens = 7 };
            return null;
        });

        var read = await store.GetEntryAsync("s1");
        Assert.Equal("second", read!.AssistantReply);       // 第二次更新没被第一次覆盖
        Assert.Equal(7, read.Usage!.TotalTokens);
    }

    [Fact]
    public async Task Flush_persists_index_and_reopen_loads_it()
    {
        await using (var store = NewStore())
        {
            await store.UpsertEntryAsync(Entry("keep-me"));
            await store.FlushIndexAsync();
        }

        await using var reopened = NewStore();
        var entry = await reopened.GetEntryAsync("keep-me");
        Assert.NotNull(entry);
        Assert.Equal("session keep-me", entry.Summary);
    }

    [Fact]
    public async Task Delete_is_terminal_and_flushes_immediately()
    {
        await using (var store = NewStore())
        {
            await store.UpsertEntryAsync(Entry("doomed"));
            await store.FlushIndexAsync();
            await store.AppendMessageAsync(Msg("doomed", SessionMessageRole.User, "x"));
            await store.DeleteSessionAsync("doomed"); // 不 FlushIndex，终端性语义自带 flush
        }

        // 新实例从磁盘读：条目与消息目录都消失
        await using var reopened = NewStore();
        Assert.Null(await reopened.GetEntryAsync("doomed"));
        Assert.False(Directory.Exists(Path.Combine(_root, ".deeporca", "sessions", "doomed")));
    }

    [Fact]
    public async Task Debounce_timer_flushes_eventually()
    {
        await using var store = NewStore();
        await store.UpsertEntryAsync(Entry("auto-flush"));

        // 等 debounce(250ms) + 余量，不由测试手动 flush
        await Task.Delay(700);
        await using var reopened = NewStore();
        Assert.NotNull(await reopened.GetEntryAsync("auto-flush"));
    }

    [Fact]
    public async Task Entry_cap_keeps_most_recent_50()
    {
        await using var store = NewStore();
        for (var i = 0; i < 55; i++)
        {
            var entry = Entry($"s{i}");
            entry.UpdateTime = DateTime.UtcNow.AddSeconds(i).ToString("o");
            await store.UpsertEntryAsync(entry);
        }

        var index = await store.GetIndexAsync();
        Assert.Equal(SessionStore.MaxEntries, index.Entries.Count);
        Assert.DoesNotContain(index.Entries, e => e.Id == "s0"); // 最旧被淘汰
        Assert.Contains(index.Entries, e => e.Id == "s54");      // 最新保留
    }

    [Fact]
    public async Task Rewrite_replaces_whole_message_log_atomically()
    {
        await using var store = NewStore();
        await store.AppendMessageAsync(Msg("s1", SessionMessageRole.User, "old-1"));
        await store.AppendMessageAsync(Msg("s1", SessionMessageRole.User, "old-2"));

        var compacted = new List<SessionMessage>
        {
            Msg("s1", SessionMessageRole.System, "compacted summary"),
            SessionMessage.Create("s1", SessionMessageRole.User, "old-2", compacted: true),
        };
        await store.RewriteMessagesAsync("s1", compacted);

        var loaded = await store.LoadMessagesAsync("s1");
        Assert.Equal(2, loaded.Count);
        Assert.Equal("compacted summary", loaded[0].Content);
        Assert.True(loaded[1].Compacted);
    }
}
