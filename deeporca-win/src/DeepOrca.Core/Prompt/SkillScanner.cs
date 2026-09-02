using System.Text.RegularExpressions;
using DeepOrca.Core.Permissions;
using DeepOrca.Core.Types;

namespace DeepOrca.Core.Prompt;

// SkillScanner — 技能发现（对拍 apple SkillScanner.swift / 上游 session-manager-skills.ts）
// 目录优先级：项目 .deeporca → .deepcode → .agents → 用户级同序（AGENTS.md 约定）。

public static class SkillScanner
{
    /// <summary>扫描单个目录下的技能子目录（每个须含 SKILL.md）。</summary>
    public static List<SkillInfo> ScanDirectory(string dir)
    {
        if (!Directory.Exists(dir)) return [];

        var skills = new List<SkillInfo>();
        DirectoryInfo[] entries;
        try
        {
            entries = new DirectoryInfo(dir).GetDirectories();
        }
        catch (IOException)
        {
            return [];
        }

        foreach (var entry in entries)
        {
            if ((entry.Attributes & FileAttributes.Hidden) != 0) continue;
            var skillFile = Path.Combine(entry.FullName, "SKILL.md");
            if (!File.Exists(skillFile)) continue;
            var skill = ParseSkillFile(entry.FullName);
            if (skill is not null) skills.Add(skill);
        }
        return skills;
    }

    /// <summary>按优先级扫全部标准根；早根胜出（同名技能后者忽略）。</summary>
    public static List<SkillInfo> ScanAll(string projectRoot, string? home = null)
    {
        var seen = new HashSet<string>();
        var result = new List<SkillInfo>();

        foreach (var root in StandardRoots(projectRoot, home ?? Runtime.HomeDir))
        {
            foreach (var skill in ScanDirectory(root))
            {
                if (seen.Add(skill.Name)) result.Add(skill);
            }
        }
        return result;
    }

    public static string[] StandardRoots(string projectRoot, string home) =>
    [
        Path.Combine(projectRoot, ".deeporca", "skills"),
        Path.Combine(projectRoot, ".deepcode", "skills"),
        Path.Combine(projectRoot, ".agents", "skills"),
        Path.Combine(home, ".deeporca", "skills"),
        Path.Combine(home, ".deepcode", "skills"),
        Path.Combine(home, ".agents", "skills"),
    ];

    /// <summary>解析技能目录：SKILL.md frontmatter（name 取目录名 / description / 分类等）。</summary>
    public static SkillInfo? ParseSkillFile(string skillDir)
    {
        var skillFile = Path.Combine(skillDir, "SKILL.md");
        string content;
        try
        {
            content = File.ReadAllText(skillFile);
        }
        catch (IOException)
        {
            return null;
        }

        var name = Path.GetFileName(skillDir.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
        var description = ExtractFrontmatterField(content, "description") ?? $"Skill at {skillDir}";
        var allowImplicit = ExtractFrontmatterField(content, "allow_implicit_invocation") == "true";
        var categories = ExtractFrontmatterList(content, "categories");

        // 扫描态技能不整篇注入系统提示（Available Skills 区只带 name+description），
        // 保持可路由（isLoaded=false 语义；G1 shortlist / G3 分片注入的候选集）。
        return new SkillInfo
        {
            Name = name,
            Path = skillDir,
            Description = description,
            IsLoaded = false,
            AllowImplicitInvocation = allowImplicit,
            Categories = categories,
        };
    }

    /// <summary>读技能全文（SKILL.md body）；不可读返回 null，调用方 fail-open 用短形式。</summary>
    public static string? ReadSkillContent(string path)
    {
        try
        {
            return File.ReadAllText(Path.Combine(path, "SKILL.md"));
        }
        catch (IOException)
        {
            return null;
        }
    }

    // ── frontmatter 辅助 ──

    /// <summary>在 --- 界定的 YAML frontmatter 里找 `field: value`（去引号）。</summary>
    public static string? ExtractFrontmatterField(string content, string field)
    {
        var frontmatter = FrontmatterBlock(content);
        if (frontmatter is null) return null;

        var match = Regex.Match(frontmatter, $@"(?m)^{Regex.Escape(field)}\s*:\s*(.+)$");
        if (!match.Success) return null;

        var raw = match.Groups[1].Value.Trim();
        if (raw.Length >= 2 && ((raw.StartsWith('"') && raw.EndsWith('"')) || (raw.StartsWith('\'') && raw.EndsWith('\''))))
        {
            raw = raw[1..^1];
        }
        return raw.Length == 0 ? null : raw;
    }

    /// <summary>frontmatter 里的 `field: [a, b]` 内联列表。</summary>
    public static List<string>? ExtractFrontmatterList(string content, string field)
    {
        var frontmatter = FrontmatterBlock(content);
        if (frontmatter is null) return null;

        var match = Regex.Match(frontmatter, $@"(?m)^{Regex.Escape(field)}\s*:\s*\[(.*)\]\s*$");
        if (!match.Success) return null;

        var items = match.Groups[1].Value
            .Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)
            .Select(s => s.Replace("\"", "").Trim())
            .Where(s => s.Length > 0)
            .ToList();
        return items.Count == 0 ? null : items;
    }

    /// <summary>提取 --- 界定的 frontmatter 文本块（首行 --- 到次行 --- 之间）。</summary>
    public static string? FrontmatterBlock(string content)
    {
        var lines = content.Split('\n');
        int? start = null, end = null;
        for (var i = 0; i < lines.Length; i++)
        {
            if (lines[i].Trim() != "---") continue;
            if (start is null) start = i;
            else { end = i; break; }
        }
        if (start is not { } s || end is not { } e || s >= e) return null;
        return string.Join("\n", lines[(s + 1)..e]);
    }
}
