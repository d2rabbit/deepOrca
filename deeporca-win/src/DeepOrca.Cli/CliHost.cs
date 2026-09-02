using System.Text.Json.Nodes;
using DeepOrca.Core.Common;
using DeepOrca.Core.Permissions;
using DeepOrca.Core.Prompt;
using DeepOrca.Core.Session;
using DeepOrca.Core.Types;

namespace DeepOrca.Cli;

/// <summary>
/// settings 解析（对拍上游 resolveCurrentSettings）：env → 项目 .deeporca/settings.json
/// → 全局 ~/.deeporca/settings.json（TS endpoints 数组兼容）。
/// </summary>
public static class CliSettings
{
    public static DeepOrcaSettings Resolve(string projectRoot)
    {
        var global = Path.Combine(Runtime.HomeDir, ".deeporca", "settings.json");
        var project = Path.Combine(projectRoot, ".deeporca", "settings.json");

        var merged = new JsonObject();
        MergeInto(merged, ReadJson(global));
        MergeInto(merged, ReadJson(project));

        var settings = DeepOrcaSettings.FromTsJson(merged);

        // env 覆盖（紧追 TS）
        if (Environment.GetEnvironmentVariable("DEEPORCA_API_KEY") is { Length: > 0 } key)
        {
            settings = settings with { ApiKey = key };
        }
        if (Environment.GetEnvironmentVariable("DEEPORCA_BASE_URL") is { Length: > 0 } baseUrl)
        {
            settings = settings with { BaseUrl = baseUrl };
        }
        if (Environment.GetEnvironmentVariable("DEEPORCA_MODEL") is { Length: > 0 } model)
        {
            settings = settings with { Model = model };
        }
        return settings;
    }

    private static JsonObject? ReadJson(string path)
    {
        try
        {
            return File.Exists(path) ? AnyJson.Parse(File.ReadAllText(path)) as JsonObject : null;
        }
        catch
        {
            return null;
        }
    }

    private static void MergeInto(JsonObject target, JsonObject? source)
    {
        if (source is null) return;
        foreach (var (key, value) in source)
        {
            target[key] = value?.DeepClone();
        }
    }
}

/// <summary>CLI 宿主：控制台输出 + 权限交互 + AskUserQuestion 交互。</summary>
public sealed class CliHost
{
    private readonly bool _yes;
    private readonly TextWriter _out;
    private readonly TextReader _in;

    public CliHost(bool yes, TextWriter? output = null, TextReader? input = null)
    {
        _yes = yes;
        _out = output ?? Console.Out;
        _in = input ?? Console.In;
    }

    public SessionManagerHooks BuildHooks() => new()
    {
        OnMessageAppend = m =>
        {
            switch (m.Role)
            {
                case SessionMessageRole.Assistant:
                    _out.WriteLine();
                    _out.WriteLine(m.Content);
                    break;
                case SessionMessageRole.Tool:
                    _out.WriteLine($"[tool] {m.Content}");
                    break;
            }
            return Task.CompletedTask;
        },
        OnStatusChange = (id, status) =>
        {
            if (status == SessionStatus.Completed || status == SessionStatus.Failed ||
                status == SessionStatus.PermissionDenied || status == SessionStatus.Interrupted)
            {
                _out.WriteLine($"[{status.Wire()}]");
            }
            return Task.CompletedTask;
        },
        OnPermissionRequest = request =>
        {
            if (_yes) return Task.FromResult(PermissionDecision.Allow);
            _out.WriteLine($"[permission] tool={request.Name} scopes=[{string.Join(", ", request.Scopes.Select(s => s.Wire()))}]");
            _out.WriteLine($"  {request.Command}");
            _out.Write("Allow? (y/n): ");
            var line = _in.ReadLine()?.Trim().ToLowerInvariant();
            return Task.FromResult(line is "y" or "yes" ? PermissionDecision.Allow : PermissionDecision.Deny);
        },
        AskUserPresenter = options =>
        {
            _out.WriteLine(string.Join("\n", options.Select(o => $"- {o.Label}")));
            _out.Write("Answer: ");
            return Task.FromResult(_in.ReadLine());
        },
    };
}