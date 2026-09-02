using DeepOrca.Core.Types;

namespace DeepOrca.Core.Prompt;

// PromptBuilder — 系统提示组装，cache-stable 定序（对拍 apple PromptBuilder.swift / 上游 prompt.ts）。
// 区块顺序固定（DeepSeek 前缀缓存命中的前提）：base → 默认技能 → 扫描技能 XML →
// Runtime Environment → AGENTS.md → memory → plan mode。任何一处顺序漂移都会破坏缓存。

public static class PromptBuilder
{
    /// <summary>不可变 base 系统提示（模型无关）。</summary>
    public const string BaseSystemPrompt = """
    You are DeepOrca, a coding agent running natively on Windows.
    You help users write, understand, and modify code in their project workspace.

    ## Core Principles
    - Be helpful, correct, and honest. If you are not sure, say so.
    - Prefer the built-in tools (bash, read, write, edit) for filesystem work.
    - Never fabricate file contents, URLs, or API responses.
    - When a tool call fails, read the error carefully and retry with a fix.
    - Keep responses concise unless the user asks for detail.
    """;

    /// <summary>默认技能（karpathy-guidelines 等价物；design：内建默认技能模板）。</summary>
    public const string DefaultSkillPrompt = """
    <skill-name path="coding-guidelines">Write code that is simple, readable, and idiomatic. Prefer small functions. Match the surrounding code style. Avoid over-engineering.</skill-name>
    """;

    public const string PlanModePrompt = """
    You are in PLAN MODE. You must NOT modify any files.
    Read the project, analyze the task, then present a concrete plan.
    Wait for user approval before making any changes.
    """;

    /// <summary>运行时上下文（每台机器 byte-stable；design §三：OS/shell/arch 换 Windows 形态）。</summary>
    public static string StableRuntimeContext(DateTime? date = null) =>
        $"""
        ## Runtime Environment
        - OS: {OsString()}
        - Architecture: {ArchString()}
        - Shell: {ShellString()}
        - Date: {CurrentDateString(date)}
        """;

    /// <summary>临时 turn tail —— 追加到用户消息结尾（不进 system 前缀，转换器 M1 已接）。</summary>
    public static string CurrentTurnTail(string model, DateTime? date = null) =>
        $"(Current date: {CurrentDateString(date)} · Active model: {model})";

    /// <summary>把技能全文包成 XML 注入块（skill 名 = 目录名；路径分隔符跨平台提取）。</summary>
    public static string SkillDocument(SkillInfo skill, string content)
    {
        var dirName = skill.Path.TrimEnd('/', '\\').Split('/', '\\').Last();
        return $"<skill-name path=\"{dirName}\">\n{content}\n</skill-name>";
    }

    public static string MemoryPrompt(string? recalled)
    {
        if (string.IsNullOrEmpty(recalled)) return "";
        return $"""
        <memory-context>
        <recalled-memories>
        {recalled}
        </recalled-memories>
        </memory-context>
        """;
    }

    /// <summary>Compaction 摘录提示（M5 用）。</summary>
    public static string CompactPrompt(string serializedConversation) =>
        $"""
        The conversation is getting long. Summarize the following conversation into a compact form that preserves all critical information (decisions, file paths, commands, open issues). Output only the summary, no preamble.

        <conversation>
        {serializedConversation}
        </conversation>
        """;

    // ── 组装（固定顺序；M3 快照测试锁字节）──

    public sealed record PromptInput
    {
        public List<SkillInfo> ScannedSkills { get; init; } = [];
        public string? AgentInstructions { get; init; }
        public string? Memory { get; init; }
        public bool PlanMode { get; init; }
        public DateTime? Date { get; init; }
    }

    public static string BuildSystemPrompt(PromptInput input)
    {
        var sections = new List<string> { BaseSystemPrompt, DefaultSkillPrompt };

        if (input.ScannedSkills.Count > 0)
        {
            sections.AddRange(input.ScannedSkills.Select(s =>
            {
                var content = SkillScanner.ReadSkillContent(s.Path) ?? s.Description;
                return SkillDocument(s, content);
            }));
        }

        sections.Add(StableRuntimeContext(input.Date));

        if (!string.IsNullOrEmpty(input.AgentInstructions))
        {
            sections.Add(input.AgentInstructions);
        }

        if (!string.IsNullOrEmpty(input.Memory))
        {
            sections.Add(MemoryPrompt(input.Memory));
        }

        if (input.PlanMode)
        {
            sections.Add(PlanModePrompt);
        }

        return string.Join("\n\n", sections);
    }

    // ── 平台文案 ──

    private static string OsString()
    {
        var version = Environment.OSVersion.Version;
        return OperatingSystem.IsWindows()
            ? $"Microsoft Windows {version.Major}.{version.Minor} ({version.Build})"
            : $"macOS (Darwin {version})";
    }

    private static string ArchString() => System.Runtime.InteropServices.RuntimeInformation.ProcessArchitecture switch
    {
        System.Runtime.InteropServices.Architecture.Arm64 => "arm64",
        System.Runtime.InteropServices.Architecture.X64 => "x86_64",
        var arch => arch.ToString().ToLowerInvariant(),
    };

    private static string ShellString() =>
        OperatingSystem.IsWindows() ? "Git Bash (bash.exe)" : "zsh";

    public static string CurrentDateString(DateTime? date = null) =>
        (date ?? DateTime.Now).ToString("yyyy-MM-dd");
}