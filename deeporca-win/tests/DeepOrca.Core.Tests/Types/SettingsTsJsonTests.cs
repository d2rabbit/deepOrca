using System.Text.Json.Nodes;
using DeepOrca.Core.Types;
using Xunit;

namespace DeepOrca.Core.Tests;

// TS 形态 settings.json 反序列化用例（对拍 apple SettingsTypes.swift fromTSJSON）

public class SettingsTsJsonTests
{
    [Fact]
    public void Parses_endpoints_array_with_first_endpoint_wins()
    {
        var json = (JsonObject)AnyJson.Parse("""
        {
          "model": "fallback-model",
          "baseURL": "https://fallback.example/v1",
          "apiKey": "fallback-key",
          "primaryEndpointId": "ep-2",
          "endpoints": [
            {
              "id": "ep-1",
              "baseURL": "https://api.deepseek.com/v1",
              "apiKey": "sk-1",
              "models": [{ "id": "deepseek-chat" }, { "id": "deepseek-reasoner" }]
            },
            { "id": "ep-2", "baseURL": "https://other.example/v1", "apiKey": "sk-2" }
          ]
        }
        """)!;

        var settings = DeepOrcaSettings.FromTsJson(json);

        Assert.Equal("deepseek-chat", settings.Model);           // models[0].id 覆盖 model
        Assert.Equal("https://api.deepseek.com/v1", settings.BaseUrl); // 首条胜出
        Assert.Equal("sk-1", settings.ApiKey);
        Assert.Equal("ep-2", settings.PrimaryEndpointId);        // primaryEndpointId 透传
        Assert.NotNull(settings.Endpoints);
        Assert.Equal(2, settings.Endpoints.Count);
        Assert.Equal(["deepseek-chat", "deepseek-reasoner"], settings.Endpoints[0].Models);
    }

    [Fact]
    public void Falls_back_when_no_endpoints()
    {
        var json = (JsonObject)AnyJson.Parse("""
        { "model": "deepseek-chat", "baseURL": "https://api.deepseek.com/v1", "apiKey": "sk" }
        """)!;

        var settings = DeepOrcaSettings.FromTsJson(json);

        Assert.Equal("deepseek-chat", settings.Model);
        Assert.Equal("https://api.deepseek.com/v1", settings.BaseUrl);
        Assert.Null(settings.Endpoints);
    }

    [Theory]
    [InlineData("allowAll", PermissionMode.Permissive, true)]
    [InlineData("askAll", PermissionMode.Strict, false)]
    [InlineData("strict", PermissionMode.Strict, false)]
    [InlineData("permissive", PermissionMode.Permissive, false)]
    [InlineData("normal", PermissionMode.Normal, false)]
    [InlineData("anything-else", PermissionMode.Balanced, false)]
    public void Maps_ts_default_mode(string mode, PermissionMode expected, bool allowAll)
    {
        var json = (JsonObject)AnyJson.Parse($$"""{ "permissions": { "defaultMode": "{{mode}}" } }""")!;
        var settings = DeepOrcaSettings.FromTsJson(json);

        Assert.Equal(expected, settings.Permissions.Mode);
        Assert.Equal(allowAll, settings.Permissions.AllowAll);
    }

    [Fact]
    public void Decodes_scope_lists_from_wire_names()
    {
        var json = (JsonObject)AnyJson.Parse("""
        {
          "permissions": {
            "allow": ["read-in-cwd", "query-git-log", "network"],
            "ask": ["write-in-cwd"],
            "deny": ["mutate-git-log", "not-a-real-scope"]
          }
        }
        """)!;

        var settings = DeepOrcaSettings.FromTsJson(json);

        Assert.Equal(
            [PermissionScope.ReadInCwd, PermissionScope.QueryGitLog, PermissionScope.Network],
            settings.Permissions.Allows);
        Assert.Equal([PermissionScope.WriteInCwd], settings.Permissions.Asks);
        // 未知 scope 被丢弃
        Assert.Equal([PermissionScope.MutateGitLog], settings.Permissions.Denies);
    }

    [Fact]
    public void Parses_mcp_servers_pass_through()
    {
        var json = (JsonObject)AnyJson.Parse("""
        {
          "mcpServers": {
            "filesystem": { "command": "npx", "args": ["-y", "@x/fs"], "env": { "K": "V" }, "enabled": false },
            "broken": "not-an-object"
          }
        }
        """)!;

        var settings = DeepOrcaSettings.FromTsJson(json);

        Assert.True(settings.McpServers.TryGetValue("filesystem", out var fs));
        Assert.Equal("npx", fs.Command);
        Assert.Equal(["-y", "@x/fs"], fs.Args);
        Assert.Equal("V", fs.Env!["K"]);
        Assert.False(fs.Enabled);
        Assert.False(settings.McpServers.ContainsKey("broken")); // 非对象条目跳过
    }

    [Fact]
    public void Round_trips_through_core_serializer_camel_case()
    {
        var json = (JsonObject)AnyJson.Parse("""
        { "model": "m1", "baseURL": "https://x/v1", "compactTokenThreshold": 100 }
        """)!;
        var settings = DeepOrcaSettings.FromTsJson(json);

        var serialized = CoreJson.Serialize(settings);

        // camelCase 存储面（与 TS / apple JSONL 兼容）；compactTokenThreshold 保持默认
        // （FromTsJson 与 apple fromTSJSON 同构：只解析 model/baseURL/apiKey/endpoints/
        // permissions/mcpServers 六块，其余字段 M2+ 按需补）
        Assert.Contains("\"baseUrl\"", serialized);
        Assert.Contains("\"compactTokenThreshold\":64000", serialized);
    }
}
