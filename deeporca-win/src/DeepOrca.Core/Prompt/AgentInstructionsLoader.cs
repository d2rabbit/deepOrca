using DeepOrca.Core.Permissions;

namespace DeepOrca.Core.Prompt;

// AgentInstructions — 项目/宿主 AGENTS.md 加载（对拍 apple AgentInstructionsLoader.swift /
// 上游 session-manager-persistence.loadAgentInstructions）。
// 项目优先级：.deeporca/AGENTS.md → .deepcode/AGENTS.md → ./AGENTS.md；随后用户级兜底。

public sealed record AgentInstructions(string Content, string DisplayPath);

public static class AgentInstructionsLoader
{
    /// <summary>项目指令优先，用户级兜底。</summary>
    public static AgentInstructions? Load(string projectRoot, string? home = null)
    {
        if (LoadProject(projectRoot) is { } project) return project;
        foreach (var path in new[]
                 {
                     Path.Combine(home ?? Runtime.HomeDir, ".deeporca", "AGENTS.md"),
                     Path.Combine(home ?? Runtime.HomeDir, ".deepcode", "AGENTS.md"),
                 })
        {
            if (ReadNonEmpty(path) is { } content) return new AgentInstructions(content, path);
        }
        return null;
    }

    /// <summary>项目候选：.deeporca/AGENTS.md → .deepcode/AGENTS.md → ./AGENTS.md。</summary>
    public static AgentInstructions? LoadProject(string projectRoot)
    {
        var candidates = new[]
        {
            (Path.Combine(projectRoot, ".deeporca", "AGENTS.md"), "./.deeporca/AGENTS.md"),
            (Path.Combine(projectRoot, ".deepcode", "AGENTS.md"), "./.deepcode/AGENTS.md"),
            (Path.Combine(projectRoot, "AGENTS.md"), "./AGENTS.md"),
        };
        foreach (var (path, display) in candidates)
        {
            if (ReadNonEmpty(path) is { } content) return new AgentInstructions(content, display);
        }
        return null;
    }

    /// <summary>非空文件才算数（上游 readNonEmptyFile 语义）。</summary>
    public static string? ReadNonEmpty(string path)
    {
        try
        {
            var content = File.ReadAllText(path);
            return string.IsNullOrWhiteSpace(content) ? null : content;
        }
        catch (IOException)
        {
            return null;
        }
    }
}