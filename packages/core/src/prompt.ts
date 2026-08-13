import { execFileSync, execSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import ejs from "ejs";
import matter from "gray-matter";
import { fileURLToPath } from "url";
import type { SessionMessage } from "./session";
import { findGitBashPath, resolveShellPath } from "./common/shell-utils";
import { supportsMultimodal } from "./common/model-capabilities";

const COMPACT_PROMPT_BASE = `Your task is to create a detailed summary of the conversation so far, paying close attention to the user's explicit requests and your previous actions.
This summary should be thorough in capturing technical details, code patterns, and architectural decisions that would be essential for continuing development work without losing context.

Before providing your final summary, wrap your analysis in <analysis> tags to organize your thoughts and ensure you've covered all necessary points. In your analysis process:

1. Chronologically analyze each message and section of the conversation. For each section thoroughly identify:
   - The user's explicit requests and intents
   - Your approach to addressing the user's requests
   - Key decisions, technical concepts and code patterns
   - Specific details like:
     - file names
     - full code snippets
     - function signatures
     - file edits
  - Errors that you ran into and how you fixed them
  - Pay special attention to specific user feedback that you received, especially if the user told you to do something differently.
2. Double-check for technical accuracy and completeness, addressing each required element thoroughly.

Your summary should include the following sections:

1. Primary Request and Intent: Capture all of the user's explicit requests and intents in detail
2. Key Technical Concepts: List all important technical concepts, technologies, and frameworks discussed.
3. Files and Code Sections: Enumerate specific files and code sections examined, modified, or created. Pay special attention to the most recent messages and include full code snippets where applicable and include a summary of why this file read or edit is important.
4. Errors and fixes: List all errors that you ran into, and how you fixed them. Pay special attention to specific user feedback that you received, especially if the user told you to do something differently.
5. Problem Solving: Document problems solved and any ongoing troubleshooting efforts.
6. All user messages: List ALL user messages that are not tool results. These are critical for understanding the users' feedback and changing intent.
6. Pending Tasks: Outline any pending tasks that you have explicitly been asked to work on.
7. Current Work: Describe in detail precisely what was being worked on immediately before this summary request, paying special attention to the most recent messages from both user and assistant. Include file names and code snippets where applicable.
8. Optional Next Step: List the next step that you will take that is related to the most recent work you were doing. IMPORTANT: ensure that this step is DIRECTLY in line with the user's most recent explicit requests, and the task you were working on immediately before this summary request. If your last task was concluded, then only list next steps if they are explicitly in line with the users request. Do not start on tangential requests or really old requests that were already completed without confirming with the user first.
                       If there is a next step, include direct quotes from the most recent conversation showing exactly what task you were working on and where you left off. This should be verbatim to ensure there's no drift in task interpretation.

Here's an example of how your output should be structured:

<example>
<analysis>
[Your thought process, ensuring all points are covered thoroughly and accurately]
</analysis>

<summary>
1. Primary Request and Intent:
   [Detailed description]

2. Key Technical Concepts:
   - [Concept 1]
   - [Concept 2]
   - [...]

3. Files and Code Sections:
   - [File Name 1]
      - [Summary of why this file is important]
      - [Summary of the changes made to this file, if any]
      - [Important Code Snippet]
   - [File Name 2]
      - [Important Code Snippet]
   - [...]

4. Errors and fixes:
    - [Detailed description of error 1]:
      - [How you fixed the error]
      - [User feedback on the error if any]
    - [...]

5. Problem Solving:
   [Description of solved problems and ongoing troubleshooting]

6. All user messages: 
    - [Detailed non tool use user message]
    - [...]

7. Pending Tasks:
   - [Task 1]
   - [Task 2]
   - [...]

8. Current Work:
   [Precise description of current work]

9. Optional Next Step:
   [Optional Next step to take]

</summary>`;

const SYSTEM_PROMPT_BASE = `你是名叫DeepOrca的交互式编程助手，帮助用户完成软件工程任务。 Use the instructions below and the tools available to you to assist the user.

# 核心行为准则

- 以正确、有用、诚实、清晰为优先。行动前先理解用户的真实目标，而非字面请求。
- 绝不编造信息。明确区分事实、假设、不确定性与观点；不确定时坦率说明，不装懂。
- 仅在必要时提一个精炼的澄清问题；否则做出合理假设并明确说出。
- 对复杂任务，先考虑约束、依赖、边界情况与权衡，再下结论。
- 直接给出结论，不描述内部思考过程，避免无意义的元评论与客套填充。
- 匹配用户的语气、专业程度与期望的详略；仅在能提升清晰度时使用列表、表格等结构化排版。
- 产出完整、正确、可维护的方案；除非用户明确要求，不留占位符或半成品。
- 缺少必需输入（如被引用的文件、数据）时，说明缺什么，而不是猜测。
- 出错时客观承认并立即修正，不找借口。
- 回复前自查：是否回应了用户的请求、有无自相矛盾、关键假设与局限是否已说明。

重要：严禁编造任何非编程相关的 URL。对于编程链接，仅限使用：1) 用户提供的上下文；2) 你确定的官方文档主域名。在输出前，必须自查该链接是否存在于你的上下文记忆中；若不存在，请明确说明无法提供。`;

type PromptToolOptions = {
  model?: string;
  webSearchEnabled?: boolean;
};

type DefaultSkillPromptOptions = {
  enabledSkills?: Record<string, boolean>;
};

const DEFAULT_SKILL_TEMPLATES = ["karpathy-guidelines.md"];
const DEFAULT_SKILL_RESOURCE_FILE_LIMIT = 50;
const SKILL_RESOURCE_EXCLUDED_DIRS = new Set([
  ".cache",
  ".git",
  ".next",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
]);

export type SkillPromptDocument = {
  name: string;
  content: string;
  path?: string;
  skillFilePath?: string;
};

type SkillResourceListing = {
  files: string[];
  truncated: boolean;
};

function readToolDocs(extensionRoot: string, options: PromptToolOptions = {}): string {
  const toolsDir = path.join(extensionRoot, "templates", "tools");
  if (!fs.existsSync(toolsDir)) {
    return "";
  }

  const entries = fs.readdirSync(toolsDir);
  const docs = entries
    .filter((entry) => entry.endsWith(".md") || entry.endsWith(".md.ejs"))
    .sort()
    .map((entry) => {
      const fullPath = path.join(toolsDir, entry);
      try {
        const template = fs.readFileSync(fullPath, "utf8");
        const content = entry.endsWith(".ejs")
          ? ejs.render(template, { supportsMultimodal: supportsMultimodal(options.model ?? "") })
          : template;
        return content.trim();
      } catch {
        return "";
      }
    })
    .filter((content) => content.length > 0);

  return docs.join("\n\n");
}

function readDefaultSkillDocs(
  extensionRoot: string,
  enabledSkills: Record<string, boolean> = {}
): Array<{ name: string; content: string }> {
  const skillsDir = path.join(extensionRoot, "templates", "skills");
  return DEFAULT_SKILL_TEMPLATES.map((entry) => {
    const fullPath = path.join(skillsDir, entry);
    const name = path.basename(entry, ".md");
    if (enabledSkills[name] === false) {
      return null;
    }
    try {
      return {
        name,
        content: fs.readFileSync(fullPath, "utf8").trim(),
      };
    } catch {
      return null;
    }
  }).filter((skill): skill is { name: string; content: string } => Boolean(skill?.content));
}

export function getDefaultSkillPrompt(options: DefaultSkillPromptOptions = {}): string {
  const skillDocs = readDefaultSkillDocs(getExtensionRoot(), options.enabledSkills);
  if (skillDocs.length === 0) {
    return "";
  }

  return buildSkillDocumentsPrompt(skillDocs);
}

/** Read the dedicated prompt used when a submitted turn enters Plan Mode. */
export function getPlanModePrompt(): string {
  const templatePath = path.join(getExtensionRoot(), "templates", "prompts", "plan.md");
  try {
    return fs.readFileSync(templatePath, "utf8").trim();
  } catch {
    return "";
  }
}

export function buildSkillDocumentsPrompt(skills: SkillPromptDocument[]): string {
  const blocks = skills.map((skill) => renderSkillDocumentBlock(skill));
  return `Use the skill documents below to assist the user:\n${blocks.join("\n\n")}`;
}

function renderSkillDocumentBlock(skill: SkillPromptDocument): string {
  const pathAttribute = skill.path ? ` path="${escapeXml(skill.path)}"` : "";
  const resources = renderSkillResources(skill.skillFilePath);
  const content = stripSkillPromptMetadata(skill.content);
  return `<${skill.name}-skill${pathAttribute}>
${content}${resources}
</${skill.name}-skill>`;
}

function stripSkillPromptMetadata(content: string): string {
  try {
    const parsed = matter(content);
    if (!Object.prototype.hasOwnProperty.call(parsed.data, "metadata")) {
      return content;
    }

    const frontmatter = { ...parsed.data };
    delete frontmatter.metadata;
    return matter.stringify(parsed.content, frontmatter);
  } catch {
    return content;
  }
}

function renderSkillResources(skillFilePath?: string): string {
  if (!skillFilePath) {
    return "";
  }

  const listing = listSkillResourceFiles(skillFilePath, DEFAULT_SKILL_RESOURCE_FILE_LIMIT);
  if (listing.files.length === 0 && !listing.truncated) {
    return "";
  }

  const fileLines = listing.files.map((file) => `  <file>${escapeXml(file)}</file>`);
  const noteLine = listing.truncated
    ? [`  <note>Listing capped at ${DEFAULT_SKILL_RESOURCE_FILE_LIMIT} files and may be incomplete.</note>`]
    : [];
  return `\n\n<skill_resources>\n${[...fileLines, ...noteLine].join("\n")}\n</skill_resources>`;
}

function listSkillResourceFiles(skillFilePath: string, limit: number): SkillResourceListing {
  const skillDir = path.dirname(skillFilePath);
  const files: string[] = [];
  let truncated = false;

  const visit = (dir: string, relativeDir = ""): void => {
    if (files.length > limit) {
      truncated = true;
      return;
    }

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith(".")) {
        continue;
      }

      const relativePath = relativeDir ? path.join(relativeDir, entry.name) : entry.name;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKILL_RESOURCE_EXCLUDED_DIRS.has(entry.name)) {
          continue;
        }
        visit(fullPath, relativePath);
        if (truncated) {
          return;
        }
        continue;
      }

      if (!entry.isFile() || entry.name === "SKILL.md") {
        continue;
      }

      files.push(toPosixPath(relativePath));
      if (files.length > limit) {
        truncated = true;
        return;
      }
    }
  };

  visit(skillDir);
  return { files: files.slice(0, limit), truncated };
}

function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function getCurrentDateAndModelPrompt(model?: string): string {
  const date = new Date();
  let prompt = `今天是${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日。随着对话的进行，时间在流逝。`;
  prompt += model ? `\n当前LLM模型为${model}，对话中可通过/model命令切换模型。` : "";
  return prompt;
}

const TOOL_SELECTION_GUIDE = `# 代码工具选择指南

DeepOrca 提供多层代码工具（内置工具、Serena 语义工具、CodeGraph 图谱工具），按场景选择最优工具：

## 编辑代码
- **简单文本替换**（同一文件内）→ 用内置 \`edit\`（snippet 级精准匹配，轻量）
- **替换整个函数/方法/类的实现** → 用 Serena \`replace_symbol_body\`（LSP 语义级，不关心行号）
- **跨文件重命名** → 用 Serena \`rename_symbol\`（原子操作，自动更新所有引用）
- **在某符号前/后插入新代码** → 用 Serena \`insert_before_symbol\` / \`insert_after_symbol\`

## 查找代码
- **找某符号的定义位置** → 用 Serena \`find_symbol\`（实时 LSP，最准确）
- **找谁调用了某符号** → 用 Serena \`find_referencing_symbols\`（实时引用，反映最新代码）
- **分析修改某符号的影响面** → 用 CodeGraph \`codegraph_impact\`（全代码图谱影响分析）
- **查看调用链/依赖关系** → 用 CodeGraph \`codegraph_callees\` / \`codegraph_callers\`（图谱遍历）
- **全文搜索**（非符号级）→ 用内置 \`bash\` + \`rg\`（正则全文搜索）

## 编辑后验证
- 每次代码修改后，建议用 Serena \`get_diagnostics_for_file\` 检查类型/语法错误

## 心智模型
- **Serena = 手术刀**：实时、精准、单符号级操作（LSP 驱动，40+ 语言）
- **CodeGraph = 全景图**：广度、影响面、调用链分析（图谱驱动）
- **内置工具 = 基础**：文本读写、shell 命令、搜索`;

export function getSystemPrompt(_projectRoot: string, options: PromptToolOptions = {}): string {
  const toolDocs = readToolDocs(getExtensionRoot(), options);
  return toolDocs
    ? `${SYSTEM_PROMPT_BASE}\n\n${TOOL_SELECTION_GUIDE}\n\n# Available Tools\n\n${toolDocs}`
    : SYSTEM_PROMPT_BASE;
}

export function getCompactPrompt(sessionMessages: SessionMessage[]): string {
  const jsonl = sessionMessages
    .map((message) =>
      JSON.stringify({
        id: message.id,
        role: message.role,
        content: message.content,
        contentParams: message.contentParams,
        messageParams: message.messageParams,
        createTime: message.createTime,
      })
    )
    .join("\n");
  return `${COMPACT_PROMPT_BASE}\n\nconversation below:\n\n\`\`\`jsonl\n${jsonl}\n\`\`\``;
}

/**
 * Build a system-prompt block from recalled memories. Uses XML-tagged wrapping
 * (matching the skill-document pattern) so the LLM can clearly identify the
 * memory context. Returns empty string when no memories were recalled.
 *
 * Two recall channels:
 *  - `prependContext`: dynamic, per-turn L1 memories relevant to the current
 *    query. Rendered FIRST inside the block so the model sees them ahead of
 *    stable persona/scene context.
 *  - `appendSystemContext`: stable persona + scene navigation + tools guide.
 *
 * Note: `appendSystemContext` may already contain a `<user-persona>` block
 * (TDAI inlines persona there), so this function does NOT re-wrap a separate
 * `persona` field. The `persona` parameter is kept only for legacy callers.
 */
export function getMemoryPrompt(recall: {
  prependContext?: string;
  appendSystemContext?: string;
  persona?: string | null;
  recallStrategy?: string;
}): string {
  const parts: string[] = [];
  if (recall.prependContext) {
    parts.push(`<recalled-memories>\n${recall.prependContext}\n</recalled-memories>`);
  }
  if (recall.appendSystemContext) {
    parts.push(`<cross-session-memory>\n${recall.appendSystemContext}\n</cross-session-memory>`);
  }
  if (parts.length === 0) {
    return "";
  }
  return `<memory-context strategy="${recall.recallStrategy ?? "none"}">\n${parts.join("\n\n")}\n</memory-context>`;
}

/**
 * The machine-level workspace environment block. This is byte-stable for a
 * given machine/project (root path, uname, shell, runtime versions, installed
 * tools) and therefore safe to bake into the cache-stable system-prompt prefix.
 * The date and model line — which change every day / on model switch and would
 * invalidate the DeepSeek prefix cache — are split out into {@link getCurrentTurnTail}
 * and injected per-turn as a transient tail instead.
 */
export function getStableRuntimeContext(projectRoot: string): string {
  const uname = getUnameInfo();
  const shellPath = getShellPathInfo();
  const shellModeOpts = process.platform === "win32" ? { "shell mode": "git-bash" } : {};
  const runtimeVersions = getRuntimeVersionInfo();
  const env = {
    "root path": projectRoot,
    pwd: projectRoot,
    homedir: os.homedir(),
    "system info": uname,
    "shell path": shellPath,
    ...shellModeOpts,
    ...runtimeVersions,
    "command installed": {
      ripgrep: checkToolInstalled("rg"),
      jq: checkToolInstalled("jq"),
    },
  };
  return `# Local Workspace Environment

\`\`\`json
${JSON.stringify(env, null, 2)}
\`\`\``;
}

/**
 * The per-turn transient tail: current date + active model. Evaluated fresh on
 * every API request (the OpenAIMessageConverter appends it to the last user
 * message at conversion time, never to the persisted JSONL). Keeping the date
 * out of the system-prompt prefix means the cross-session/cross-day DeepSeek
 * prefix cache stays warm; baking it in would invalidate the whole prefix the
 * moment the day changes or a new session opens.
 */
export function getCurrentTurnTail(model?: string): string {
  return getCurrentDateAndModelPrompt(model);
}

/**
 * Legacy composite: stable environment block + date/model line. Kept for
 * backward compatibility (tests/CLI flows); the session loop uses the split
 * {@link getStableRuntimeContext} + {@link getCurrentTurnTail} pair instead.
 */
export function getRuntimeContext(projectRoot: string, model?: string): string {
  return `${getCurrentDateAndModelPrompt(model)}

${getStableRuntimeContext(projectRoot)}`;
}

function checkToolInstalled(tool: string): boolean {
  try {
    if (process.platform === "win32") {
      const bashPath = findGitBashPath();
      execFileSync(bashPath, ["-lc", `command -v ${shellSingleQuote(tool)}`], {
        encoding: "utf8",
        stdio: "ignore",
        windowsHide: true,
      });
      return true;
    }
    execSync(`command -v ${tool}`, { encoding: "utf8", stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function getShellPathInfo(): string {
  try {
    return resolveShellPath();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "'\"'\"'")}'`;
}

function getRuntimeVersionInfo(): Record<string, string> {
  const versions: Record<string, string> = {};
  const pythonVersion = getCommandVersion("python3", ["--version"]);
  const nodeVersion = getCommandVersion("node", ["--version"]);

  if (pythonVersion) {
    versions["python3 version"] = pythonVersion.replace(/^Python\s+/i, "");
  }
  if (nodeVersion) {
    versions["node version"] = nodeVersion;
  }

  return versions;
}

function getCommandVersion(command: string, args: string[]): string | null {
  try {
    const commandText = [command, ...args].map(shellSingleQuote).join(" ");
    if (process.platform === "win32") {
      return execFileSync(findGitBashPath(), ["-lc", `${commandText} 2>&1`], {
        encoding: "utf8",
        windowsHide: true,
      }).trim();
    }
    return execSync(`${commandText} 2>&1`, { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function getUnameInfo(): string {
  try {
    if (process.platform === "win32") {
      return execFileSync(findGitBashPath(), ["-lc", "uname -a"], {
        encoding: "utf8",
        windowsHide: true,
      }).trim();
    }
    return execSync("uname -a", { encoding: "utf8" }).trim();
  } catch {
    return `${os.type()} ${os.release()} ${os.arch()}`;
  }
}

export function getExtensionRoot(): string {
  // Prefer `__dirname` which is always available in the CJS bundle output.
  // Fall back to `import.meta.url` for ESM test environments (tsx --test).
  if (typeof __dirname !== "undefined") {
    return path.resolve(__dirname, "..");
  }

  const currentFilePath = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(currentFilePath), "..");
}

export type ToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required?: string[];
      additionalProperties?: boolean;
    };
  };
};

export function getTools(_options: PromptToolOptions = {}, externalTools: ToolDefinition[] = []): ToolDefinition[] {
  const tools: ToolDefinition[] = [
    {
      type: "function",
      function: {
        name: "bash",
        description: "Execute shell commands in a persistent bash session.",
        parameters: {
          type: "object",
          properties: {
            command: {
              type: "string",
              description: "The shell command to execute",
            },
            description: {
              type: "string",
              description:
                'Clear, concise description of what this command does in active voice. Never use words like "complex" or "risk" in the description - just describe what it does.',
            },
            sideEffects: {
              description:
                'Permission scopes required by this bash command. Declare every scope the command touches: the executor independently infers scopes from the command text and unions them with your declaration, so under-reporting cannot bypass the permission policy (a `rm` declared as `read-in-cwd` still picks up `delete-*`). Use ["unknown"] only when the command is genuinely unclassifiable.',
              type: "array",
              items: {
                type: "string",
                enum: [
                  "read-in-cwd",
                  "read-out-cwd",
                  "write-in-cwd",
                  "write-out-cwd",
                  "delete-in-cwd",
                  "delete-out-cwd",
                  "query-git-log",
                  "mutate-git-log",
                  "network",
                  "unknown",
                ],
              },
              uniqueItems: true,
            },
            run_in_background: {
              type: "boolean",
              description:
                "Set to true to run the command in the background. Use this only when you need to perform a blocking task and do not need the result immediately.",
            },
          },
          required: ["command", "sideEffects"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "AskUserQuestion",
        description:
          "When the task has ambiguities or multiple implementation approaches, use this tool to pause execution and ask the user a question to get clarification or make a decision.",
        parameters: {
          type: "object",
          properties: {
            questions: {
              type: "array",
              description: "Questions to present to the user. Usually only one question is needed at a time.",
              items: {
                type: "object",
                properties: {
                  question: {
                    type: "string",
                    description: "The question to ask the user.",
                  },
                  multiSelect: {
                    type: "boolean",
                    description: "Whether the user may choose multiple options.",
                  },
                  options: {
                    type: "array",
                    description: "A list of predefined options for the user to choose from.",
                    items: {
                      type: "object",
                      properties: {
                        label: {
                          type: "string",
                          description: "The display text for the option.",
                        },
                        description: {
                          type: "string",
                          description:
                            "A detailed explanation or hint about this option to help the user understand what happens if they choose it.",
                        },
                      },
                      required: ["label"],
                    },
                  },
                },
                required: ["question", "options"],
              },
            },
          },
          required: ["questions"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "UpdatePlan",
        description:
          "Update the current task plan. The plan argument must be the complete markdown task list to show as the latest progress state.",
        parameters: {
          type: "object",
          properties: {
            plan: {
              type: "string",
              description:
                "The complete markdown task list, including task status markers such as [ ], [>], [x], and optional notes.",
            },
            explanation: {
              type: "string",
              description: "Optional short reason for changing the plan.",
            },
          },
          required: ["plan"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "read",
        description: "Read files from the filesystem (text, images, notebooks).",
        parameters: {
          type: "object",
          properties: {
            file_path: {
              type: "string",
              description: "UNIX-style path to file",
            },
            offset: {
              type: "number",
              description: "Line number to start reading from",
            },
            limit: {
              type: "number",
              description: "Number of lines to read",
            },
          },
          required: ["file_path"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "write",
        description: "Create files or overwrite them with a complete string payload. Prefer edit for existing files.",
        parameters: {
          type: "object",
          properties: {
            file_path: {
              type: "string",
              description: "Absolute path to file",
            },
            content: {
              type: "string",
              description: "Complete file content as a single string. Serialize JSON documents before writing.",
            },
          },
          required: ["file_path", "content"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "edit",
        description: "Perform scoped string replacements in files.",
        parameters: {
          type: "object",
          properties: {
            snippet_id: {
              type: "string",
              description: "Required Read/Edit snippet_id.",
            },
            file_path: {
              type: "string",
              description: "Optional absolute path guard; must match snippet_id's file.",
            },
            old_string: {
              type: "string",
              description: "Exact text to replace inside snippet_id's scope",
            },
            new_string: {
              type: "string",
              description: "Replacement text (must differ from old_string)",
            },
            replace_all: {
              type: "boolean",
              description: "Replace all occurences of old_string (default false)",
              default: false,
            },
            expected_occurrences: {
              type: "number",
              description: "Expected number of matches, especially useful as a safety check with replace_all",
            },
          },
          required: ["snippet_id", "old_string", "new_string"],
          additionalProperties: false,
        },
      },
    },
  ];

  tools.push({
    type: "function",
    function: {
      name: "WebSearch",
      description: "Perform web searching using a natural language query.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "A search query phrased as a clear, specific natural language question or statement that includes key context.",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  });

  for (const tool of externalTools) {
    tools.push(tool);
  }

  return tools;
}
