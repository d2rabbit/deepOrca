using DeepOrca.Core.Prompt;
using DeepOrca.Core.Types;
using Xunit;

namespace DeepOrca.Core.Tests;

// SkillScanner 用例：目录优先级、frontmatter 解析、同名覆盖、缺失 SKILL.md 跳过

public class SkillScannerTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), $"deeporca-skills-{Guid.NewGuid():N}");

    private string Project => Path.Combine(_root, "proj");
    private string Home => Path.Combine(_root, "home");

    private void WriteSkill(string dir, string name, string description, string? extra = null)
    {
        Directory.CreateDirectory(dir);
        File.WriteAllText(Path.Combine(dir, "SKILL.md"),
            $"---\nname: {name}\ndescription: {description}\n{extra ?? ""}---\nbody");
    }

    public void Dispose()
    {
        try { Directory.Delete(_root, recursive: true); } catch (IOException) { }
    }

    [Fact]
    public void Scans_project_roots_in_priority_order_with_name_dedup()
    {
        Directory.CreateDirectory(Project);
        WriteSkill(Path.Combine(Project, ".deeporca", "skills", "alpha"), "alpha", "project version");
        WriteSkill(Path.Combine(Project, ".deepcode", "skills", "alpha"), "alpha", "legacy version");
        WriteSkill(Path.Combine(Project, ".agents", "skills", "beta"), "beta", "agent level");
        WriteSkill(Path.Combine(Home, ".deeporca", "skills", "gamma"), "gamma", "user level");

        var skills = SkillScanner.ScanAll(Project, Home);

        var names = skills.Select(s => s.Name).ToList();
        Assert.Equal(["alpha", "beta", "gamma"], names);
        // 早根胜出：alpha 用项目 .deeporca 版本
        Assert.Equal("project version", skills.Single(s => s.Name == "alpha").Description);
    }

    [Fact]
    public void Name_comes_from_directory_not_frontmatter()
    {
        WriteSkill(Path.Combine(Project, ".deeporca", "skills", "dir-name"), "frontmatter-name", "desc");

        var skill = SkillScanner.ScanAll(Project, Home).Single();
        Assert.Equal("dir-name", skill.Name);
        Assert.False(skill.IsLoaded); // 扫描态不整篇加载，保持可路由
    }

    [Fact]
    public void Parses_categories_and_implicit_invocation()
    {
        WriteSkill(Path.Combine(Project, ".deeporca", "skills", "multi"),
            "multi", "desc", "allow_implicit_invocation: true\ncategories: [dev, review, \"with space\"]\n");

        var skill = Assert.Single(SkillScanner.ScanAll(Project, Home));
        Assert.True(skill.AllowImplicitInvocation);
        Assert.Equal(["dev", "review", "with space"], skill.Categories);
    }

    [Fact]
    public void Directory_without_skill_md_is_skipped()
    {
        Directory.CreateDirectory(Path.Combine(Project, ".deeporca", "skills", "empty-dir"));
        Directory.CreateDirectory(Project);

        Assert.Empty(SkillScanner.ScanAll(Project, Home));
    }

    [Fact]
    public void Read_skill_content_returns_body_and_fail_opens()
    {
        WriteSkill(Path.Combine(Project, ".deeporca", "skills", "full"), "full", "desc");
        var path = Path.Combine(Project, ".deeporca", "skills", "full");

        var content = SkillScanner.ReadSkillContent(path);
        Assert.NotNull(content);
        Assert.EndsWith("body", content.Trim());
        Assert.Null(SkillScanner.ReadSkillContent(Path.Combine(Project, "no-such-dir")));
    }

    [Fact]
    public void Frontmatter_missing_means_default_description()
    {
        var noFm = Path.Combine(Project, ".deeporca", "skills", "bare");
        Directory.CreateDirectory(noFm);
        File.WriteAllText(Path.Combine(noFm, "SKILL.md"), "just content no frontmatter");

        var skill = Assert.Single(SkillScanner.ScanAll(Project, Home));
        Assert.StartsWith("Skill at", skill.Description);
    }
}

// PromptBuilder cache-stable 快照用例：固定输入 → 逐字节锁死的组装顺序

public class PromptBuilderTests
{
    private static readonly DateTime FixedDate = new(2026, 9, 2);

    private static SkillInfo Skill(string name, string description) => new()
    {
        Name = name,
        Path = $"C:\\Users\\me\\.deeporca\\skills\\{name}",
        Description = description,
    };

    [Fact]
    public void System_prompt_section_order_is_byte_stable()
    {
        var input = new PromptBuilder.PromptInput
        {
            ScannedSkills = [Skill("alpha", "alpha desc")],
            AgentInstructions = "## Project Instructions\nrespect the codebase conventions.",
            Memory = "user prefers kebab-case",
            PlanMode = true,
            Date = FixedDate,
        };

        var prompt = PromptBuilder.BuildSystemPrompt(input);

        // 固定顺序：base → 默认技能 → 扫描技能 XML → runtime → AGENTS.md → memory → plan mode
        Assert.StartsWith(PromptBuilder.BaseSystemPrompt, prompt);
        Assert.Contains("\n\n" + PromptBuilder.DefaultSkillPrompt.TrimEnd('\n'), prompt);
        Assert.Contains("<skill-name path=\"alpha\">", prompt);
        Assert.Contains("## Runtime Environment\n- OS:", prompt);
        Assert.Contains("- Date: 2026-09-02", prompt);
        Assert.Contains("## Project Instructions", prompt);
        Assert.Contains("<memory-context>", prompt);
        Assert.Contains("You are in PLAN MODE", prompt);

        // 区块出现顺序（index 单调）
        var order = new[] { "coding-guidelines", "<skill-name path=\"alpha\">", "Runtime Environment",
                            "Project Instructions", "<memory-context>", "PLAN MODE" }
            .Select(section => prompt.IndexOf(section, StringComparison.Ordinal)).ToList();
        Assert.All(order, idx => Assert.True(idx >= 0));
        for (var i = 1; i < order.Count; i++) Assert.True(order[i] > order[i - 1], $"section {i} out of order");
    }

    [Fact]
    public void Same_input_produces_identical_bytes()
    {
        var input = new PromptBuilder.PromptInput
        {
            ScannedSkills = [Skill("x", "desc")],
            Date = FixedDate,
        };

        var first = PromptBuilder.BuildSystemPrompt(input);
        var second = PromptBuilder.BuildSystemPrompt(input);

        Assert.Equal(first, second); // cache-stable：同输入逐字节一致
    }

    [Fact]
    public void Runtime_context_omits_date_variability_from_sections()
    {
        // 只验证结构：日期在 Runtime 块内，turn tail 不进 system。
        var tail = PromptBuilder.CurrentTurnTail("deepseek-chat", FixedDate);
        Assert.Equal("(Current date: 2026-09-02 · Active model: deepseek-chat)", tail);

        var prompt = PromptBuilder.BuildSystemPrompt(new PromptBuilder.PromptInput { Date = FixedDate });
        Assert.DoesNotContain("Active model", prompt);
    }

    [Fact]
    public void Memory_and_plan_sections_are_optional()
    {
        var bare = PromptBuilder.BuildSystemPrompt(new PromptBuilder.PromptInput
        {
            ScannedSkills = [Skill("s", "d")],
            Date = FixedDate,
        });

        Assert.DoesNotContain("<memory-context>", bare);
        Assert.DoesNotContain("PLAN MODE", bare);
        Assert.DoesNotContain("Project Instructions", bare);
    }

    [Fact]
    public void Skill_document_wraps_content_with_dirname()
    {
        var doc = PromptBuilder.SkillDocument(Skill("my-skill", "desc"), "body text");
        Assert.Equal("<skill-name path=\"my-skill\">\nbody text\n</skill-name>", doc);
    }

    [Fact]
    public void Compact_prompt_preserves_conversation_block()
    {
        var prompt = PromptBuilder.CompactPrompt("<conversation-serialized/>");
        Assert.Contains("Summarize the following conversation", prompt);
        Assert.Contains("<conversation>", prompt);
        Assert.Contains("<conversation-serialized/>", prompt);
        Assert.Contains("</conversation>", prompt);
    }
}

// AgentInstructions 用例：优先级 + 非空语义 + 用户级兜底

public class AgentInstructionsTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), $"deeporca-agents-{Guid.NewGuid():N}");
    private string Project => Path.Combine(_root, "proj");
    private string Home => Path.Combine(_root, "home");

    public void Dispose()
    {
        try { Directory.Delete(_root, recursive: true); } catch (IOException) { }
    }

    [Fact]
    public void Project_priority_order_deeporca_then_deepcode_then_root()
    {
        Directory.CreateDirectory(Project);
        Directory.CreateDirectory(Path.Combine(Project, ".deeporca"));
        Directory.CreateDirectory(Path.Combine(Project, ".deepcode"));
        File.WriteAllText(Path.Combine(Project, ".deeporca", "AGENTS.md"), "deeporca level");
        File.WriteAllText(Path.Combine(Project, ".deepcode", "AGENTS.md"), "deepcode level");
        File.WriteAllText(Path.Combine(Project, "AGENTS.md"), "root level");

        var loaded = AgentInstructionsLoader.Load(Project, Home)!;
        Assert.Equal("deeporca level", loaded.Content);
        Assert.Equal("./.deeporca/AGENTS.md", loaded.DisplayPath);
    }

    [Fact]
    public void Falls_back_to_root_and_user_level()
    {
        Directory.CreateDirectory(Project);
        File.WriteAllText(Path.Combine(Project, "AGENTS.md"), "root level");

        var rootLoaded = AgentInstructionsLoader.Load(Project, Home)!;
        Assert.Equal("root level", rootLoaded.Content);

        // 项目全空 → 用户级兜底
        File.Delete(Path.Combine(Project, "AGENTS.md"));
        Directory.CreateDirectory(Path.Combine(Home, ".deeporca"));
        File.WriteAllText(Path.Combine(Home, ".deeporca", "AGENTS.md"), "user level");

        var userLoaded = AgentInstructionsLoader.Load(Project, Home)!;
        Assert.Equal("user level", userLoaded.Content);
    }

    [Fact]
    public void Empty_files_do_not_count()
    {
        Directory.CreateDirectory(Project);
        var empty = Path.Combine(Project, "AGENTS.md");
        File.WriteAllText(empty, "   \n  ");

        Assert.Null(AgentInstructionsLoader.Load(Project, Home));
    }
}