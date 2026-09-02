using System.Text.Json;
using System.Text.Json.Nodes;
using DeepOrca.Core.Types;
using ModelContextProtocol.Client;
using ModelContextProtocol.Protocol;

namespace DeepOrca.Core.Mcp;

public enum McpServerStatus
{
    Disconnected,
    Connecting,
    Connected,
    Failed,
}

/// <summary>发现到的 MCP 工具（含来源 server，供权限 scope 与 metadata 标注）。</summary>
public sealed record McpToolInfo
{
    public required string Name { get; init; }
    public required string Description { get; init; }
    public required JsonElement JsonSchema { get; init; }
    public required string ServerName { get; init; }

    public ToolDefinition ToToolDefinition() => new(
        new ToolFunctionDefinition(Name, Description, SchemaToParameters(JsonSchema)));

    internal static ToolParameters SchemaToParameters(JsonElement schema)
    {
        if (schema.ValueKind != JsonValueKind.Object) return new ToolParameters("object");
        var obj = (JsonObject?)JsonNode.Parse(schema.GetRawText());
        return SchemaNodeToParameters(obj);
    }

    private static ToolParameters SchemaNodeToParameters(JsonObject? obj)
    {
        if (obj is null) return new ToolParameters("object");
        var parameters = new ToolParameters(AnyJson.GetString(obj["type"]) ?? "object");
        if (obj["properties"] is JsonObject props)
        {
            parameters = parameters with
            {
                Properties = props.ToDictionary(
                    kv => kv.Key,
                    kv => SchemaPropertyToProperty(kv.Value as JsonObject)),
            };
        }
        if (obj["required"] is JsonArray required)
        {
            parameters = parameters with
            {
                Required = required.OfType<JsonValue>()
                    .Select(v => v.GetValue<string>()).ToList(),
            };
        }
        return parameters;
    }

    private static ToolProperty SchemaPropertyToProperty(JsonObject? obj)
    {
        if (obj is null) return new ToolProperty("string");
        var property = new ToolProperty(AnyJson.GetString(obj["type"]) ?? "string")
        {
            Description = AnyJson.GetString(obj["description"]),
        };
        if (obj["properties"] is JsonObject props)
        {
            property = property with
            {
                Properties = props.ToDictionary(
                    kv => kv.Key,
                    kv => SchemaPropertyToProperty(kv.Value as JsonObject)),
            };
        }
        if (obj["items"] is JsonObject items)
        {
            property = property with { Items = SchemaPropertyToProperty(items) };
        }
        if (obj["enum"] is JsonArray enums)
        {
            property = property with
            {
                EnumValues = enums.OfType<JsonValue>()
                    .Select(v => v.GetValue<string>()).ToList(),
            };
        }
        return property;
    }
}

internal sealed record McpConnection
{
    /// <summary>Connecting 阶段尚无 client；Connected 后必非空。</summary>
    public McpClient? Client { get; init; }
    public required StdioClientTransport Transport { get; init; }
    public List<McpToolInfo> Tools { get; set; } = [];
    public McpServerStatus Status { get; set; } = McpServerStatus.Connecting;
}

/// <summary>
/// MCPManager — MCP server 生命周期 + 工具发现/执行（对拍 apple MCPManager.swift /
/// 上游 mcp-manager.ts）。官方 `ModelContextProtocol` SDK（决策点 D4：不 vendor、不加透传包装）。
/// 单写者纪律（design §五）：connections/configs 只经串行门访问。
/// </summary>
public sealed class McpManager : IAsyncDisposable
{
    public const string ClientName = "DeepOrcaWin";
    public const string ClientVersion = "0.1.0";

    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly Dictionary<string, McpConnection> _connections = new();
    private Dictionary<string, McpServerConfig> _configs;

    public McpManager(Dictionary<string, McpServerConfig>? configs = null)
    {
        _configs = configs ?? [];
    }

    /// <summary>替换配置表；被移除的 server 立即断开（用户配置优先于内置注册表）。</summary>
    public async Task SetConfigsAsync(Dictionary<string, McpServerConfig> newConfigs, CancellationToken ct = default)
    {
        List<McpConnection> dropped = [];
        await _gate.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            var removed = _configs.Keys.Where(k => !newConfigs.ContainsKey(k)).ToList();
            foreach (var serverName in removed)
            {
                if (_connections.Remove(serverName, out var found)) dropped.Add(found);
            }
            _configs = newConfigs;
        }
        finally
        {
            _gate.Release();
        }
        foreach (var connection in dropped) await DisposeConnectionAsync(connection).ConfigureAwait(false);
    }

    public Task<Dictionary<string, McpServerConfig>> GetServerConfigsAsync(CancellationToken ct = default) =>
        WithGateLocked(() => new Dictionary<string, McpServerConfig>(_configs), ct);

    public async Task ConnectAllAsync(CancellationToken ct = default)
    {
        await _gate.WaitAsync(ct).ConfigureAwait(false);
        var pending = _configs.Where(kv => kv.Value.Enabled && !_connections.ContainsKey(kv.Key)).ToList();
        _gate.Release();
        foreach (var (name, config) in pending)
        {
            await ConnectAsync(name, config, ct).ConfigureAwait(false);
        }
    }

    public async Task<McpServerStatus> ConnectAsync(string serverName, McpServerConfig config, CancellationToken ct = default)
    {
        await DisconnectAsync(serverName, ct).ConfigureAwait(false);

        await _gate.WaitAsync(ct).ConfigureAwait(false);
        McpConnection connecting;
        try
        {
            var transport = new StdioClientTransport(new StdioClientTransportOptions
            {
                Name = serverName,
                Command = config.Command,
                Arguments = config.Args,
                WorkingDirectory = config.Cwd,
                EnvironmentVariables = config.Env is null
                    ? null
                    : config.Env.ToDictionary(kv => kv.Key, kv => (string?)kv.Value),
            });
            connecting = new McpConnection { Transport = transport };
            _connections[serverName] = connecting;
        }
        finally
        {
            _gate.Release();
        }

        try
        {
            var client = await McpClient.CreateAsync(
                connecting.Transport,
                new McpClientOptions
                {
                    ClientInfo = new Implementation { Name = ClientName, Version = ClientVersion },
                },
                cancellationToken: ct).ConfigureAwait(false);

            var tools = new List<McpToolInfo>();
            var toolList = await client.ListToolsAsync(cancellationToken: ct).ConfigureAwait(false);
            foreach (var tool in toolList)
            {
                tools.Add(new McpToolInfo
                {
                    Name = tool.Name,
                    Description = tool.Description ?? "",
                    JsonSchema = tool.JsonSchema,
                    ServerName = serverName,
                });
            }

            await _gate.WaitAsync(ct).ConfigureAwait(false);
            try
            {
                _connections[serverName] = new McpConnection
                {
                    Client = client,
                    Transport = connecting.Transport,
                    Tools = tools,
                    Status = McpServerStatus.Connected,
                };
            }
            finally
            {
                _gate.Release();
            }
            return McpServerStatus.Connected;
        }
        catch (Exception)
        {
            // 启动失败：标记 failed 后摘除（对齐 apple：连接不可用即摘除，不拖累其它 server）
            await _gate.WaitAsync(CancellationToken.None).ConfigureAwait(false);
            try
            {
                _connections.Remove(serverName);
            }
            finally
            {
                _gate.Release();
            }
            return McpServerStatus.Failed;
        }
    }

    public async Task DisconnectAsync(string serverName, CancellationToken ct = default)
    {
        await _gate.WaitAsync(ct).ConfigureAwait(false);
        McpConnection? connection = null;
        try
        {
            if (_connections.Remove(serverName, out var found)) connection = found;
        }
        finally
        {
            _gate.Release();
        }
        if (connection is not null) await DisposeConnectionAsync(connection).ConfigureAwait(false);
    }

    public async Task DisconnectAllAsync(CancellationToken ct = default)
    {
        await _gate.WaitAsync(ct).ConfigureAwait(false);
        List<McpConnection> connections;
        try
        {
            connections = _connections.Values.ToList();
            _connections.Clear();
        }
        finally
        {
            _gate.Release();
        }
        foreach (var connection in connections) await DisposeConnectionAsync(connection).ConfigureAwait(false);
    }

    // ── 工具面（读经门；执行走 SDK 自身并发）──

    public Task<List<ToolDefinition>> GetToolDefinitionsAsync(CancellationToken ct = default) =>
        WithGateLocked(() => _connections.Values
            .SelectMany(c => c.Tools)
            .Select(t => t.ToToolDefinition())
            .ToList(), ct);

    public Task<List<McpToolInfo>> GetToolInfosAsync(CancellationToken ct = default) =>
        WithGateLocked(() => _connections.Values.SelectMany(c => c.Tools).ToList(), ct);

    public Task<bool> HasToolAsync(string toolName, CancellationToken ct = default) =>
        WithGateLocked(() => _connections.Values.Any(c => c.Tools.Any(t => t.Name == toolName)), ct);

    public Task<McpServerStatus?> GetStatusAsync(string serverName, CancellationToken ct = default) =>
        WithGateLocked<McpServerStatus?>(
            () => _connections.TryGetValue(serverName, out var c) ? c.Status : null, ct);

    /// <summary>
    /// 执行 MCP 工具。按 tool 名找到所属 server；结果序列化为上游 { ok, name, output, error,
    /// metadata } 形状；失败不抛出（结构化错误回传，对齐上游 graceful 语义）。
    /// </summary>
    public async Task<ToolExecutionResult> CallToolAsync(
        string toolName, JsonObject? arguments, CancellationToken ct = default)
    {
        await _gate.WaitAsync(ct).ConfigureAwait(false);
        McpConnection? connection;
        McpToolInfo? tool;
        try
        {
            connection = _connections.Values.FirstOrDefault(c => c.Tools.Any(t => t.Name == toolName));
            tool = connection?.Tools.FirstOrDefault(t => t.Name == toolName);
        }
        finally
        {
            _gate.Release();
        }

        if (tool is null)
        {
            return new ToolExecutionResult
            {
                Ok = false,
                Name = toolName,
                Error = $"No MCP server hosts tool {toolName}",
                Metadata = new JsonObject { ["errorType"] = "notFound" },
            };
        }
        if (connection is null)
        {
            throw new InvalidOperationException("connection was dropped during tool call");
        }

        try
        {
            var result = await tool.CallViaAsync(connection, arguments, ct).ConfigureAwait(false);
            var output = string.Join("\n", result.Content.Select(RenderContent));
            return new ToolExecutionResult
            {
                Ok = !(result.IsError ?? false),
                Name = toolName,
                Output = output,
                Metadata = new JsonObject
                {
                    ["mcpServer"] = tool.ServerName,
                    ["isError"] = result.IsError ?? false,
                },
            };
        }
        catch (Exception ex)
        {
            return new ToolExecutionResult
            {
                Ok = false,
                Name = toolName,
                Error = $"MCP tool {toolName} failed on server {tool.ServerName}: {ex.Message}",
                Metadata = new JsonObject
                {
                    ["mcpServer"] = tool.ServerName,
                    ["errorType"] = "execution",
                },
            };
        }
    }

    /// <summary>tools/list changed：重连（重列工具）后刷新工具表。SDK 事件面按 server 触发。</summary>
    public Task RefreshAsync(string serverName, CancellationToken ct = default)
    {
        if (_configs.TryGetValue(serverName, out var config))
        {
            return ConnectAsync(serverName, config, ct);
        }
        return Task.CompletedTask;
    }

    // ── 内部 ──

    internal static string RenderContent(ContentBlock block) => block switch
    {
        TextContentBlock text => text.Text,
        _ => $"[{block.Type}]",
    };

    private async Task<T> WithGateLocked<T>(Func<T> action, CancellationToken ct)
    {
        await _gate.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            return action();
        }
        finally
        {
            _gate.Release();
        }
    }

    private static async Task DisposeConnectionAsync(McpConnection connection)
    {
        try
        {
            if (connection.Client is not null) await connection.Client.DisposeAsync().ConfigureAwait(false);
        }
        catch
        {
            // 进程退出竞态：连接清理尽力而为
        }
    }

    public async ValueTask DisposeAsync()
    {
        await DisconnectAllAsync().ConfigureAwait(false);
        _gate.Dispose();
    }
}

/// <summary>工具执行桥（internal 扩展分离 SDK 调用细节，便于 Manager 主体保持纯净）。</summary>
internal static class McpToolCallBridge
{
    public static async Task<CallToolResult> CallViaAsync(
        this McpToolInfo tool, McpConnection connection, JsonObject? arguments, CancellationToken ct)
    {
        var args = new Dictionary<string, object?>();
        if (arguments is not null)
        {
            foreach (var (key, node) in arguments)
            {
                args[key] = node switch
                {
                    null => null,
                    JsonValue v when v.TryGetValue<string>(out var s) => s,
                    JsonValue v when v.TryGetValue<bool>(out var b) => b,
                    JsonValue v when v.TryGetValue<int>(out var i) => i,
                    JsonValue v when v.TryGetValue<double>(out var d) => d,
                    JsonValue v when v.TryGetValue<long>(out var l) => l,
                    _ => JsonSerializer.SerializeToElement(node),
                };
            }
        }
        var client = connection.Client ?? throw new InvalidOperationException(
            $"MCP server {tool.ServerName} is not connected");
        return await client.CallToolAsync(tool.Name, args, cancellationToken: ct).ConfigureAwait(false);
    }
}
