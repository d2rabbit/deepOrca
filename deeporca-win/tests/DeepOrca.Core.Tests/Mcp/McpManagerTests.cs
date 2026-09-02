using DeepOrca.Core.Mcp;
using DeepOrca.Core.Types;
using Xunit;
using Xunit.Abstractions;

namespace DeepOrca.Core.Tests;

// MCPManager 端到端用例（M2.3 本地 MCP server 联调）：官方 SDK + stdio 桩 server。
// 桩 server 见同目录 test-mcp-server.mjs（newline-delimited JSON-RPC）。

public class McpManagerTests
{
    private readonly ITestOutputHelper _output;

    public McpManagerTests(ITestOutputHelper output)
    {
        _output = output;
    }

    private static string StubServerPath()
    {
        // bin/Debug/net10.0 → 上溯到 deeporca-win/tests/DeepOrca.Core.Tests/Mcp/
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        for (var i = 0; i < 6 && dir is not null; i++)
        {
            var candidate = Path.Combine(dir.FullName, "Mcp", "test-mcp-server.mjs");
            if (File.Exists(candidate)) return candidate;
            dir = dir.Parent;
        }
        throw new InvalidOperationException("test-mcp-server.mjs not found");
    }

    private static McpServerConfig StubConfig() => new()
    {
        Name = "test",
        Command = "node",
        Args = [StubServerPath()],
    };

    [Fact]
    public async Task Discovers_tools_from_local_server()
    {
        await using var manager = new McpManager();
        var status = await manager.ConnectAsync("test", StubConfig());

        Assert.Equal(McpServerStatus.Connected, status);
        var tools = await manager.GetToolInfosAsync();
        var echo = Assert.Single(tools);
        Assert.Equal("echo", echo.Name);
        Assert.Equal("test", echo.ServerName);
        Assert.Contains("Echo back", echo.Description);

        var definitions = await manager.GetToolDefinitionsAsync();
        var definition = Assert.Single(definitions);
        Assert.Equal("echo", definition.Function.Name);
        Assert.Equal("object", definition.Function.Parameters.Type);
        Assert.NotNull(definition.Function.Parameters.Required);
        Assert.Contains("text", definition.Function.Parameters.Required!);
        // schema 递归转换
        Assert.Equal("string", definition.Function.Parameters.Properties!["text"].Type);
        Assert.Equal("Text to echo", definition.Function.Parameters.Properties["text"].Description);
    }

    [Fact]
    public async Task Calls_tool_and_renders_text_content()
    {
        await using var manager = new McpManager();
        await manager.ConnectAsync("test", StubConfig());

        var result = await manager.CallToolAsync("echo", new System.Text.Json.Nodes.JsonObject
        {
            ["text"] = "你好",
        });

        Assert.True(result.Ok);
        Assert.Contains("echo: 你好", result.Output);
        Assert.Equal("test", result.Metadata!["mcpServer"]!.GetValue<string>());
    }

    [Fact]
    public async Task Unknown_tool_returns_structured_not_found()
    {
        await using var manager = new McpManager();
        await manager.ConnectAsync("test", StubConfig());

        var result = await manager.CallToolAsync("no_such_tool", null);

        Assert.False(result.Ok);
        Assert.Contains("No MCP server hosts tool", result.Error);
        Assert.Equal("notFound", result.Metadata!["errorType"]!.GetValue<string>());
    }

    [Fact]
    public async Task Failed_server_is_isolated_not_fatal()
    {
        await using var manager = new McpManager();
        var status = await manager.ConnectAsync("broken", new McpServerConfig
        {
            Name = "broken",
            Command = "definitely-not-a-real-binary-xyz",
            Args = [],
        });

        Assert.Equal(McpServerStatus.Failed, status);
        Assert.False(await manager.HasToolAsync("echo"));

        // 好的 server 照常工作
        var ok = await manager.ConnectAsync("test", StubConfig());
        Assert.Equal(McpServerStatus.Connected, ok);
        Assert.True(await manager.HasToolAsync("echo"));
    }

    [Fact]
    public async Task Set_configs_drops_removed_servers()
    {
        await using var manager = new McpManager(new Dictionary<string, McpServerConfig>
        {
            ["test"] = StubConfig(),
        });
        await manager.ConnectAllAsync();
        Assert.True(await manager.HasToolAsync("echo"));

        await manager.SetConfigsAsync([]); // 配置移除 → 断开
        Assert.False(await manager.HasToolAsync("echo"));

        var configs = await manager.GetServerConfigsAsync();
        Assert.Empty(configs);
    }
}
