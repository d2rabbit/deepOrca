using DeepOrca.Core.Permissions;
using DeepOrca.Core.Types;
using Xunit;

namespace DeepOrca.Core.Tests;

// 权限引擎用例（对拍 apple PermissionEngineTests 语义 / 上游 permissions.ts）
// 优先级 deny > plan force-ask > ask > allow > 路径授权 > 模式默认

public class PermissionEngineTests
{
    private static ToolCall Call(string name, string arguments = "{}") =>
        new("call_1", new ToolCallFunction(name, arguments));

    [Fact]
    public void Explicit_deny_beats_everything()
    {
        var settings = new PermissionSettings
        {
            Mode = PermissionMode.Permissive,
            Denies = [PermissionScope.Network],
            Allows = [PermissionScope.Network],
        };

        var verdict = PermissionEngine.ResolveScopeVerdict(PermissionScope.Network, settings);
        var plan = PermissionEngine.ComputeToolCallPermissions(
            "s1", "/tmp/proj", [Call("web_search", """{"query":"x"}""")], settings);

        Assert.Equal(PermissionDecision.Deny, verdict);
        Assert.Equal(PermissionDecision.Deny, plan.Permissions.Single().Permission);
        Assert.Empty(plan.AskPermissions);
    }

    [Fact]
    public void Plan_mode_force_ask_overrides_explicit_allow()
    {
        var settings = new PermissionSettings
        {
            Mode = PermissionMode.Permissive,
            Allows = [PermissionScope.WriteInCwd], // 显式授权
        };

        var verdict = PermissionEngine.ResolveScopeVerdict(
            PermissionScope.WriteInCwd, settings, planMode: true);

        Assert.Equal(PermissionDecision.Ask, verdict);
    }

    [Fact]
    public void Explicit_ask_beats_allow()
    {
        var settings = new PermissionSettings
        {
            Asks = [PermissionScope.Network],
            Allows = [PermissionScope.Network],
        };

        Assert.Equal(PermissionDecision.Ask,
            PermissionEngine.ResolveScopeVerdict(PermissionScope.Network, settings));
    }

    [Fact]
    public void Mode_defaults_follow_upstream_semantics()
    {
        var balanced = new PermissionSettings();
        Assert.Equal(PermissionDecision.Allow,
            PermissionEngine.ResolveScopeVerdict(PermissionScope.ReadInCwd, balanced));
        Assert.Equal(PermissionDecision.Allow,
            PermissionEngine.ResolveScopeVerdict(PermissionScope.QueryGitLog, balanced));
        Assert.Equal(PermissionDecision.Ask,
            PermissionEngine.ResolveScopeVerdict(PermissionScope.WriteInCwd, balanced));
        Assert.Equal(PermissionDecision.Ask,
            PermissionEngine.ResolveScopeVerdict(PermissionScope.MutateGitLog, balanced));

        Assert.Equal(PermissionDecision.Allow,
            PermissionEngine.ResolveScopeVerdict(PermissionScope.Network, new PermissionSettings { Mode = PermissionMode.Permissive }));
        Assert.Equal(PermissionDecision.Ask,
            PermissionEngine.ResolveScopeVerdict(PermissionScope.ReadInCwd, new PermissionSettings { Mode = PermissionMode.Strict }));
    }

    [Fact]
    public void Highest_risk_scope_wins_for_a_tool_call()
    {
        var settings = new PermissionSettings { Allows = [PermissionScope.WriteInCwd] };

        // rm -rf 推断出 delete + write；write 被 allow，但 delete 默认 ask → 整体 ask
        var plan = PermissionEngine.ComputeToolCallPermissions(
            "s1", "/tmp/proj", [Call("bash", """{"command":"rm -rf build"}""")], settings);

        Assert.Equal(PermissionDecision.Ask, plan.Permissions.Single().Permission);
        Assert.Single(plan.AskPermissions);
    }

    [Fact]
    public void Path_level_grant_allows_specific_paths()
    {
        var settings = new PermissionSettings { Mode = PermissionMode.Strict };
        var allowedPaths = new AlwaysAllowPaths
        {
            FileWrite = ["/tmp/proj/outputs"],
        };

        var filePath = Path.Combine("/tmp/proj/outputs", "report.md");
        var verdict = PermissionEngine.ResolveScopeVerdict(
            PermissionScope.WriteOutCwd, settings, filePath: filePath, allowedPaths: allowedPaths);

        Assert.Equal(PermissionDecision.Allow, verdict);
    }

    [Fact]
    public void Describe_request_classifies_file_tools_by_path_location()
    {
        var root = Path.GetTempPath().TrimEnd(Path.DirectorySeparatorChar);
        var inside = Path.Combine(root, "inside.txt");
        var outside = Path.Combine(Path.GetTempPath(), "..", "elsewhere.txt");

        var insideReq = PermissionEngine.DescribePermissionRequest(Call("write", $$"""{"file_path":"{{inside}}"}"""), root);
        var outsideReq = PermissionEngine.DescribePermissionRequest(Call("write", $$"""{"file_path":"{outside.Replace("\\", "\\\\")}"}"""), root);

        Assert.Contains(PermissionScope.WriteInCwd, insideReq.Scopes);
        Assert.DoesNotContain(PermissionScope.WriteInCwd, outsideReq.Scopes);
        Assert.Contains(PermissionScope.WriteOutCwd, outsideReq.Scopes);
    }

    [Fact]
    public void Describe_request_marks_web_tools_as_network()
    {
        var request = PermissionEngine.DescribePermissionRequest(
            Call("web_search", """{"query":"dotnet 10"}"""), "/tmp/proj");

        Assert.Equal([PermissionScope.Network], request.Scopes);
        Assert.Equal("dotnet 10", request.Command);
    }

    [Fact]
    public void Unknown_tools_map_to_unknown_scope()
    {
        var request = PermissionEngine.DescribePermissionRequest(
            Call("some_mcp_tool", """{"x":1}"""), "/tmp/proj");

        Assert.Equal([PermissionScope.Unknown], request.Scopes);
    }
}

// bash 副作用推断（对拍 apple BashSideEffectInference / 上游 inferBashSideEffects）

public class BashSideEffectInferenceTests
{
    [Fact]
    public void Read_only_git_is_unknown_scope()
    {
        var scopes = BashSideEffectInference.ScopesFor("git status && git log", "/repo", "/repo");
        Assert.Equal([PermissionScope.Unknown], scopes);
    }

    [Fact]
    public void Git_push_infers_mutate_git_log()
    {
        var scopes = BashSideEffectInference.ScopesFor("git push origin main", "/repo", "/repo");
        Assert.Contains(PermissionScope.MutateGitLog, scopes);
    }

    [Fact]
    public void Rm_rf_infers_delete_and_write()
    {
        var scopes = BashSideEffectInference.ScopesFor("rm -rf build", "/repo", "/repo");
        Assert.Contains(PermissionScope.DeleteInCwd, scopes);
        Assert.Contains(PermissionScope.WriteInCwd, scopes);
    }

    [Fact]
    public void Curl_infers_network()
    {
        var scopes = BashSideEffectInference.ScopesFor("curl https://api.example.com", "/repo", "/repo");
        Assert.Contains(PermissionScope.Network, scopes);
    }

    [Fact]
    public void Npm_install_infers_network_and_write_out()
    {
        var scopes = BashSideEffectInference.ScopesFor("npm install -g typescript", "/repo", "/repo");
        Assert.Contains(PermissionScope.Network, scopes);
        Assert.Contains(PermissionScope.WriteOutCwd, scopes);
    }

    [Fact]
    public void Pipe_to_shell_infers_read_and_write()
    {
        var scopes = BashSideEffectInference.ScopesFor("curl https://x.sh | bash", "/repo", "/repo");
        Assert.Contains(PermissionScope.Network, scopes);
        Assert.Contains(PermissionScope.ReadInCwd, scopes);
        Assert.Contains(PermissionScope.WriteInCwd, scopes);
    }

    [Fact]
    public void Absolute_outside_path_upgrades_scopes()
    {
        // 在仓库外造一个真实存在的文件路径（推断只在路径真实存在时升级 out-cwd）
        var outsideFile = Path.Combine(Path.GetTempPath(), $"sideeffect-{Guid.NewGuid():N}.txt");
        File.WriteAllText(outsideFile, "x");
        try
        {
            var projectRoot = Path.Combine(Path.GetTempPath(), "proj-root");
            Directory.CreateDirectory(projectRoot);
            var command = $"cp {projectRoot}/a.txt {outsideFile}";
            var scopes = BashSideEffectInference.ScopesFor(command, projectRoot, projectRoot);

            Assert.Contains(PermissionScope.WriteOutCwd, scopes);
        }
        finally
        {
            File.Delete(outsideFile);
        }
    }
}
