using System.Text.Json;
using DeepOrca.Core.Types;

namespace DeepOrca.Core.Session;

/// <summary>
/// SessionStore — JSONL 消息存储 + 去抖会话索引（对拍 apple SessionStore.swift / 上游
/// session-manager-index.ts）。
///
/// 单写者纪律（design §五）：所有状态访问经唯一入口串行化（SemaphoreSlim 门，
/// <see cref="WithGateAsync{T}"/> 统一获取/释放），内存 index 永远权威——读路径不存在
/// "回到磁盘重读"的旁路，因此 debounce 窗口内多次更新按同一内存基线 rebase，
/// AGENTS.md 会话索引不变量（读必须优先 pendingIndex，否则窗口内两次更新第一次被
/// 永久丢失）在这里是**结构性成立**而非靠约定。C# Dictionary 落盘即 JSON 对象，
/// 不存在 TS 内存 Map/磁盘对象的双形态问题。
///
/// 终端性变更（删除等用户可见决策）走 <see cref="DeleteSessionAsync"/> → 立即 flush，
/// 不进 debounce 窗口。
/// </summary>
public sealed class SessionStore : IAsyncDisposable
{
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly string _storeRoot;
    private readonly JsonSerializerOptions _storageOptions;
    private SessionsIndex _index = new();
    private bool _indexDirty;
    private Timer? _debounceTimer;
    private bool _disposed;

    /// <summary>索引落盘去抖窗口（对齐上游 250ms）。</summary>
    public static readonly TimeSpan IndexDebounce = TimeSpan.FromMilliseconds(250);

    /// <summary>会话条目上限（超出按 updateTime 淘汰最旧）。</summary>
    public const int MaxEntries = 50;

    public SessionStore(string projectRoot, JsonSerializerOptions? storageOptions = null)
    {
        _storeRoot = Path.Combine(projectRoot, ".deeporca", "sessions");
        _storageOptions = storageOptions ?? Storage.Options;
        _index = LoadIndex(_storeRoot, _storageOptions) ?? new SessionsIndex();
    }

    /// <summary>storage 序列化面（camelCase；测试可注入对拍变体）。</summary>
    public static class Storage
    {
        public static readonly JsonSerializerOptions Options = new()
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull,
            WriteIndented = false,
        };
    }

    // ── Index（全部经门串行）──

    public Task<SessionsIndex> GetIndexAsync(CancellationToken ct = default) =>
        WithGateAsync(async () => _index, ct);

    public Task<SessionEntry?> GetEntryAsync(string sessionId, CancellationToken ct = default) =>
        WithGateAsync<SessionEntry?>(() => Task.FromResult(FindEntry(sessionId)), ct);

    public Task UpsertEntryAsync(SessionEntry entry, CancellationToken ct = default) =>
        WithGateAsync<object?>(() =>
        {
            UpsertEntryLocked(entry);
            MarkIndexDirty();
            return Task.FromResult<object?>(null);
        }, ct);

    /// <summary>
    /// 更新条目（load → mutate → save 的原子版）：门内取出当前条目、由调用方委托修改、
    /// 落回 debounce。等价上游 updateSessionEntry，且窗口内多次更新都 rebase 同一内存基线。
    /// </summary>
    public Task<T> UpdateEntryAsync<T>(
        string sessionId, Func<SessionEntry, T> mutate, CancellationToken ct = default)
    {
        return WithGateAsync(async () =>
        {
            var entry = FindEntry(sessionId)
                ?? throw new InvalidOperationException($"session {sessionId} not in index");
            var result = mutate(entry);
            MarkIndexDirty();
            return result;
        }, ct);
    }

    /// <summary>终端性变更：删会话目录 + 立即 flush（绕过 debounce）。</summary>
    public Task DeleteSessionAsync(string sessionId, CancellationToken ct = default) =>
        WithGateAsync(async () =>
        {
            _index.Entries.RemoveAll(e => e.Id == sessionId);
            var dir = Path.Combine(_storeRoot, sessionId);
            if (Directory.Exists(dir))
            {
                try { Directory.Delete(dir, recursive: true); } catch (IOException) { /* best-effort */ }
            }
            await FlushIndexLocked(force: true).ConfigureAwait(false); // 终端性变更必须落盘（内存已与磁盘失配）
            return true;
        }, ct);

    /// <summary>立即落盘索引（终端性变更/UI 退出时调用）。</summary>
    public Task FlushIndexAsync(CancellationToken ct = default) =>
        WithGateAsync(() => FlushIndexLocked(), ct);

    // ── Messages（JSONL）──

    public Task AppendMessageAsync(SessionMessage message, CancellationToken ct = default) =>
        WithGateAsync(async () =>
        {
            var dir = Path.Combine(_storeRoot, message.SessionId);
            Directory.CreateDirectory(dir);
            var file = Path.Combine(dir, "messages.jsonl");
            await File.AppendAllTextAsync(file, CoreJson.Serialize(message) + "\n", ct).ConfigureAwait(false);
            return true;
        }, ct);

    public Task<List<SessionMessage>> LoadMessagesAsync(string sessionId, CancellationToken ct = default) =>
        WithGateAsync(() => Task.FromResult(LoadMessagesLocked(sessionId)), ct);

    /// <summary>原子重写整份消息日志（Compaction 就地改消息：截断 + compacted 标记 + 摘要，M5 用）。</summary>
    public Task RewriteMessagesAsync(string sessionId, IReadOnlyList<SessionMessage> messages, CancellationToken ct = default) =>
        WithGateAsync(async () =>
        {
            var dir = Path.Combine(_storeRoot, sessionId);
            Directory.CreateDirectory(dir);
            var file = Path.Combine(dir, "messages.jsonl");
            var sb = new System.Text.StringBuilder();
            foreach (var message in messages) sb.Append(CoreJson.Serialize(message)).Append('\n');
            var tmp = file + ".tmp";
            await File.WriteAllTextAsync(tmp, sb.ToString(), ct).ConfigureAwait(false);
            File.Move(tmp, file, overwrite: true);
            return true;
        }, ct);

    // ── 门（单写者唯一入口；获取/释放必须成对）──

    private async Task<T> WithGateAsync<T>(Func<Task<T>> action, CancellationToken ct)
    {
        ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed), this);
        await _gate.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            return await action().ConfigureAwait(false);
        }
        finally
        {
            _gate.Release();
        }
    }

    // ── 内部（调用方必须已持门）──

    private SessionEntry? FindEntry(string sessionId) =>
        _index.Entries.FirstOrDefault(e => e.Id == sessionId);

    private void UpsertEntryLocked(SessionEntry entry)
    {
        var idx = _index.Entries.FindIndex(e => e.Id == entry.Id);
        if (idx >= 0) _index.Entries[idx] = entry;
        else _index.Entries.Add(entry);

        if (_index.Entries.Count > MaxEntries)
        {
            _index.Entries.Sort((a, b) => string.Compare(b.UpdateTime, a.UpdateTime, StringComparison.Ordinal));
            _index.Entries = _index.Entries.Take(MaxEntries).ToList();
        }
    }

    private void MarkIndexDirty()
    {
        _indexDirty = true;
        _debounceTimer?.Dispose();
        // 持门只改状态；落盘由定时器在门外重新排队进门（避免占着门睡眠/写盘）
        _debounceTimer = new Timer(
            _ => { _ = Task.Run(FlushAfterDebounceAsync); }, null,
            IndexDebounce, Timeout.InfiniteTimeSpan);
    }

    private async Task FlushAfterDebounceAsync()
    {
        if (!Volatile.Read(ref _indexDirty)) return;
        try
        {
            await WithGateAsync(() => FlushIndexLocked(), CancellationToken.None).ConfigureAwait(false);
        }
        catch (ObjectDisposedException) { /* 退出竞态，忽略 */ }
        catch (IOException) { /* best-effort，与上游一致 */ }
    }

    private async Task<bool> FlushIndexLocked(bool force = false)
    {
        _debounceTimer?.Dispose();
        _debounceTimer = null;
        if (!force && !_indexDirty && File.Exists(Path.Combine(_storeRoot, "index.json"))) return false;
        _indexDirty = false;
        Directory.CreateDirectory(_storeRoot);
        var file = Path.Combine(_storeRoot, "index.json");
        var json = System.Text.Json.JsonSerializer.Serialize(_index, _storageOptions);
        var tmp = file + ".tmp";
        await File.WriteAllTextAsync(tmp, json).ConfigureAwait(false);
        File.Move(tmp, file, overwrite: true);
        return true;
    }

    private List<SessionMessage> LoadMessagesLocked(string sessionId)
    {
        var file = Path.Combine(_storeRoot, sessionId, "messages.jsonl");
        if (!File.Exists(file)) return [];
        var messages = new List<SessionMessage>();
        foreach (var line in File.ReadLines(file))
        {
            if (string.IsNullOrWhiteSpace(line)) continue;
            try
            {
                var message = System.Text.Json.JsonSerializer.Deserialize<SessionMessage>(line, _storageOptions);
                if (message is not null) messages.Add(message);
            }
            catch (JsonException)
            {
                // 单行损坏跳过（对齐上游 best-effort 解码）
            }
        }
        return messages;
    }

    private static SessionsIndex? LoadIndex(string storeRoot, JsonSerializerOptions options)
    {
        var file = Path.Combine(storeRoot, "index.json");
        if (!File.Exists(file)) return null;
        try
        {
            return System.Text.Json.JsonSerializer.Deserialize<SessionsIndex>(File.ReadAllText(file), options);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (Volatile.Read(ref _disposed)) return;
        Volatile.Write(ref _disposed, true);
        try
        {
            // 直接进门（不走带 disposed 检查的 WithGateAsync）：退出时把未落盘的索引写掉
            await _gate.WaitAsync(CancellationToken.None).ConfigureAwait(false);
            try
            {
                await FlushIndexLocked().ConfigureAwait(false);
            }
            finally
            {
                _gate.Release();
            }
        }
        catch (IOException)
        {
            // best-effort
        }
        finally
        {
            _debounceTimer?.Dispose();
            _gate.Dispose();
        }
    }
}
