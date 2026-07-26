import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import type { SessionMessage, SkillInfo } from "../../shared/ipc";
import type { ReasoningMode } from "../lib/appearance";
import { renderMarkdown } from "../markdown";
import {
  buildThinkingSummary,
  buildToolSummary,
  formatStatusName,
  formatToolParams,
  getDiffLines,
  getPlanLines,
  getResultMd,
} from "../lib/messages";
import { useI18n } from "../i18n";
import {
  IconCommand,
  IconToolRead,
  IconToolWrite,
  IconToolEdit,
  IconToolAsk,
  IconToolPlan,
  IconToolSearch,
  IconToolMcp,
  IconToolGeneric,
} from "../ui/index";

function Md({ text }: { text: string }): JSX.Element {
  function handleClick(e: React.MouseEvent<HTMLDivElement>): void {
    const btn = (e.target as HTMLElement).closest(".code-block-copy");
    if (!btn) return;
    const wrap = btn.closest(".code-block-wrap");
    const code = wrap?.querySelector("code");
    if (code) {
      void navigator.clipboard.writeText(code.textContent ?? "").then(() => {
        btn.textContent = "✓";
        setTimeout(() => {
          btn.textContent = "⧉";
        }, 1500);
      });
    }
  }
  return <div className="ui-md" onClick={handleClick} dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />;
}

/**
 * Circular avatar shown beside each bubble. Colored by role so the chat reads
 * at a glance — user (neutral), assistant (accent), thinking (amber), tool
 * (type-tinted). Mirrors the avatar-per-message layout of modern chat UIs.
 */
function Avatar({ role }: { role: "user" | "assistant" | "thinking" | "tool" | "mcp" }): JSX.Element {
  const glyph = role === "user" ? "U" : role === "assistant" ? "AI" : role === "thinking" ? "✦" : "⚡";
  return (
    <div className={`ui-avatar ui-avatar--${role}`} aria-hidden="true">
      {glyph}
    </div>
  );
}

/** Map tool name → CSS modifier for visual differentiation. */
function toolCls(name: string): string {
  const n = name.toLowerCase();
  if (n === "bash" || n === "cli") return "bash";
  if (n === "read") return "read";
  if (n === "write") return "write";
  if (n === "edit") return "edit";
  if (n === "askuserquestion") return "ask";
  if (n === "updateplan") return "plan";
  if (n === "websearch") return "search";
  if (n.startsWith("mcp__")) return "mcp";
  return "generic";
}

/**
 * Per-tool-type icon. SVG for all families — crisp, theme-tinted glyphs
 * that inherit currentColor for automatic active/hover state changes.
 */
function toolIcon(name: string): JSX.Element {
  const n = name.toLowerCase();
  if (n === "bash" || n === "cli") return <BashTerminalIcon />;
  if (n === "read") return <IconToolRead />;
  if (n === "write") return <IconToolWrite />;
  if (n === "edit") return <IconToolEdit />;
  if (n === "askuserquestion") return <IconToolAsk />;
  if (n === "updateplan") return <IconToolPlan />;
  if (n === "websearch") return <IconToolSearch />;
  if (n.startsWith("mcp__")) return <IconToolMcp />;
  return <IconToolGeneric />;
}

/** Inline-SVG terminal glyph: a window with a chevron prompt and a cursor. */
function BashTerminalIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M4 6.5 L6 8 L4 9.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <line x1="7" y1="9.5" x2="10.5" y2="9.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

/** Compact character count: 1234 → "1.2k", 500 → "500". */
function formatCharCount(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(1)}k`;
}

/** Format elapsed time between two ISO timestamps as a human-readable duration. */
function formatElapsed(startIso: string, endIso: string): string {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (ms < 0 || Number.isNaN(ms)) return "";
  if (ms < 1000) return `${ms}ms`;
  const secs = ms / 1000;
  if (secs < 60) return `${secs.toFixed(1)}s`;
  const mins = Math.floor(secs / 60);
  const remainSecs = Math.round(secs % 60);
  return `${mins}m${remainSecs}s`;
}

/**
 * Smart preview text for the collapsed result toggle. For bash we surface
 * the exit code + a one-liner of stdout (much more informative than a
 * truncated JSON blob), and for everything else we fall back to the first
 * non-empty line of the result. Strips markdown code fences that the
 * `wrapPlainStructured` pass in messages.ts may have added, so the user
 * sees "exit 0" instead of "```json\n{...".
 */
function ResultHint({
  toolName,
  metadata,
  resultMd,
}: {
  toolName: string;
  metadata: Record<string, unknown> | null;
  resultMd: string;
}): JSX.Element {
  const cleaned = stripCodeFence(resultMd).trim();
  if (toolName.toLowerCase() === "bash") {
    const exitCode = typeof metadata?.["exitCode"] === "number" ? (metadata["exitCode"] as number) : null;
    const signal = typeof metadata?.["signal"] === "string" ? (metadata["signal"] as string) : null;
    const firstLine = firstNonEmptyLine(cleaned);
    const summary = signal != null ? `signal ${signal}` : exitCode != null ? `exit ${exitCode}` : firstLine || "ok";
    return <span className="ui-tool-result-hint"> ({summary})</span>;
  }
  const preview = firstNonEmptyLine(cleaned);
  if (!preview) return <></>;
  return <span className="ui-tool-result-hint"> ({truncate(preview, 60)})</span>;
}

function stripCodeFence(text: string): string {
  return text
    .replace(/^```[a-zA-Z0-9]*\n/, "")
    .replace(/\n```\s*$/, "")
    .trim();
}

function firstNonEmptyLine(text: string): string {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim().replace(/\s+/g, " ");
    if (trimmed) return trimmed;
  }
  return "";
}

/**
 * Result renderer for tool cards. The Read tool's output arrives with
 * line-number prefixes (e.g. "     1\t# AGENTS.md") so the agent can
 * cite lines. For .md / .html we strip those prefixes and render the
 * file as it was meant to be read; for code files we keep the
 * line-numbered view because the prefixes are the whole point.
 */
function ToolResult({
  toolName,
  params,
  resultMd,
}: {
  toolName: string;
  params: string;
  resultMd: string;
}): JSX.Element {
  const ext = fileExtensionFromParams(toolName, params);
  if (toolName.toLowerCase() === "read" && (ext === "md" || ext === "markdown")) {
    return <Md text={stripReadLineNumbers(resultMd)} />;
  }
  if (toolName.toLowerCase() === "read" && (ext === "html" || ext === "htm")) {
    // HTML is rendered as HTML (CSP blocks inline scripts); the line
    // numbers in the output would otherwise leak into the markup.
    return <Md text={stripReadLineNumbers(resultMd)} />;
  }
  return <Md text={resultMd} />;
}

function fileExtensionFromParams(toolName: string, params: string): string {
  if (!["read", "write", "edit"].includes(toolName.toLowerCase())) return "";
  // The params string starts with the file path (e.g. `"./AGENTS.md"` or
  // `D:\path\to\file.ts`). Strip surrounding quotes/whitespace, then
  // take the part after the last dot.
  const cleaned = params.replace(/^['"`\s]+|['"`\s]+$/g, "").split(/\s+/)[0] ?? "";
  const match = cleaned.match(/\.([a-zA-Z0-9]+)$/);
  return match ? match[1]!.toLowerCase() : "";
}

/**
 * Strip the "     N\t" prefix that the core Read handler prepends to
 * every line (see formatWithLineNumbers in read-handler.ts). Lines that
 * don't match the prefix are returned as-is so non-numbered text
 * (e.g. a "WARNING: File is empty." notice) survives intact.
 */
function stripReadLineNumbers(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\d+\t/, ""))
    .join("\n");
}

// ── Slash command detection ───────────────────────────────────────────────────
/**
 * Detect a user message that is a slash command invocation ("/init", "/continue
 * extra args"…). The first whitespace-separated token must be exactly "/<word>"
 * — a leading absolute path like "/Volumes/data" contains a second slash and is
 * therefore not treated as a command.
 */
function parseSlashCommand(content: string): { name: string; args: string } | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith("/")) return null;
  const firstToken = trimmed.split(/\s+/, 1)[0] ?? "";
  if (!/^\/[a-zA-Z][\w-]*$/.test(firstToken)) return null;
  return { name: firstToken.slice(1), args: trimmed.slice(firstToken.length).trim() };
}

/** Source badge for a skill card: bundled skills ship with the product. */
function SkillSourceBadge({ skill }: { skill: SkillInfo }): JSX.Element {
  const { t } = useI18n();
  const bundled = skill.path.startsWith("bundled:");
  return (
    <span className={`ui-skill-card-badge${bundled ? " bundled" : ""}`} title={skill.path}>
      {bundled ? t("msg.skillSourceBuiltin") : t("msg.skillSourceLocal")}
    </span>
  );
}

/** Mini skill card attached to a user message (skills sent with the prompt). */
function SkillAttachmentCard({ skill }: { skill: SkillInfo }): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="ui-msg-skill-card" title={skill.description || skill.name}>
      <span className="ui-msg-skill-card-icon" aria-hidden="true">
        ✦
      </span>
      <div className="ui-msg-skill-card-main">
        <div className="ui-msg-skill-card-head">
          <span className="ui-msg-skill-card-kind">{t("msg.skillBadge")}</span>
          <span className="ui-msg-skill-card-name">{skill.name}</span>
        </div>
        {skill.description ? <div className="ui-msg-skill-card-desc">{truncate(skill.description, 80)}</div> : null}
      </div>
    </div>
  );
}

/** Card rendering for a user-triggered slash command ("/init" …). */
function CommandCard({ name, args, createTime }: { name: string; args: string; createTime?: string }): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="ui-cmd-card">
      <span className="ui-cmd-card-icon" aria-hidden="true">
        <IconCommand />
      </span>
      <div className="ui-cmd-card-main">
        <div className="ui-cmd-card-head">
          <span className="ui-cmd-card-kind">{t("msg.commandBadge")}</span>
          <span className="ui-cmd-card-name">{name}</span>
        </div>
        {args ? <div className="ui-cmd-card-args">{args}</div> : null}
      </div>
      {createTime ? <span className="ui-msg-time user">{formatTime(createTime)}</span> : null}
    </div>
  );
}

// ── User bubble (QQ-style: right-aligned) ─────────────────────────────────────
function UserBubble({ message }: { message: SessionMessage }): JSX.Element {
  const { t } = useI18n();
  const attachments = Array.isArray(message.contentParams) ? message.contentParams.length : 0;
  const skills = message.meta?.userPrompt?.skills ?? [];
  const command = parseSlashCommand(message.content || "");

  // Command invocations render as a dedicated card instead of a text bubble.
  const body = command ? (
    <CommandCard name={command.name} args={command.args} createTime={message.createTime} />
  ) : message.content || attachments > 0 || skills.length === 0 ? (
    <div className="ui-bubble user">
      <span style={{ whiteSpace: "pre-wrap" }}>{message.content || t("msg.noContent")}</span>
      {attachments > 0 ? <span className="ui-bubble-attach">{attachments} img</span> : null}
      {message.createTime ? <span className="ui-msg-time user">{formatTime(message.createTime)}</span> : null}
    </div>
  ) : null;

  return (
    <div className="ui-bubble-row user">
      <div className="ui-user-stack">
        {skills.length > 0 ? (
          <div className="ui-msg-skills">
            {skills.map((skill) => (
              <SkillAttachmentCard key={skill.name} skill={skill} />
            ))}
          </div>
        ) : null}
        {body}
      </div>
      <Avatar role="user" />
    </div>
  );
}

// ── Thinking block (collapsible) ──────────────────────────────────────────────
function ThinkingBlock({
  content,
  messageParams,
  reasoningMode,
  isLatest,
}: {
  content: string;
  messageParams: unknown;
  reasoningMode: ReasoningMode;
  isLatest: boolean;
}): JSX.Element | null {
  const { t } = useI18n();
  const summary = buildThinkingSummary(content, messageParams);
  const charCount = content.length;
  // Reasoning is shown expanded by default — the user wants to see the
  // model's working, not just a one-line summary. reasoningMode === "hidden"
  // suppresses the block entirely; otherwise the block is visible and the
  // user can collapse it manually if they want a quieter view.
  const [expanded, setExpanded] = useState(reasoningMode !== "hidden");
  const bodyRef = useRef<HTMLDivElement>(null);

  // Respect the global reasoningMode toggle (e.g. /raw cycles between
  // normal → expanded → hidden) without dragging the local collapse state
  // around when the latest message changes.
  useEffect(() => {
    setExpanded(reasoningMode !== "hidden");
  }, [reasoningMode]);

  // When the user expands an older thinking block, scroll the top of the
  // body into view. block: "nearest" avoids hijacking scroll position
  // when the body is already fully on screen, so this is a non-intrusive
  // nudge rather than a forced jump.
  useEffect(() => {
    if (expanded && bodyRef.current && !isLatest) {
      bodyRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [expanded, isLatest]);

  if (reasoningMode === "hidden") return null;

  return (
    <div className="ui-bubble-row assistant">
      <Avatar role="thinking" />
      <div className="ui-bubble thinking">
        <button className="ui-thinking-toggle" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
          <span className="ui-thinking-icon">{expanded ? "◉" : "◎"}</span>
          <span className="ui-thinking-label">{t("msg.thinking")}</span>
          <span className="ui-thinking-summary">{truncate(summary || t("msg.reasoning"), 80)}</span>
          {charCount > 0 ? <span className="ui-thinking-chars">{formatCharCount(charCount)}</span> : null}
          <span className="ui-thinking-chevron">{expanded ? "▾" : "▸"}</span>
        </button>
        {expanded && content ? (
          <div className="ui-thinking-body" ref={bodyRef}>
            <Md text={content} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ── Assistant bubble ──────────────────────────────────────────────────────────
/** Format a timestamp as a short time string (HH:MM). */
function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function AssistantBubble({ message }: { message: SessionMessage }): JSX.Element {
  const { t } = useI18n();
  const content = (message.content || "").trim();
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    if (!content) return;
    void navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [content]);

  return (
    <div className="ui-bubble-row assistant">
      <Avatar role="assistant" />
      <div className="ui-bubble assistant">
        {content ? <Md text={content} /> : null}
        {content ? (
          <button
            type="button"
            className={`ui-msg-copy${copied ? " copied" : ""}`}
            onClick={handleCopy}
            title={copied ? t("msg.copied") : t("msg.copy")}
            aria-label={t("msg.copy")}
          >
            {copied ? "✓" : "⧉"}
          </button>
        ) : null}
        {message.createTime ? <span className="ui-msg-time">{formatTime(message.createTime)}</span> : null}
      </div>
    </div>
  );
}

// ── Tool card (differentiated by tool type) ───────────────────────────────────
// Collapsible tool families: read/write/edit/bash/cli. Their cards default
// to folded so the chat stays scannable; the header doubles as an expand
// toggle and surfaces the file path / command inline so the user can
// identify the operation without expanding. Bash cards additionally show
// the result hint (exit code / first line) in the header so the outcome
// is visible at a glance — no need to expand to see "did it work?".
// Other tools (ask/plan/search/mcp) keep their content visible — their
// result remains individually collapsible as before.
const COLLAPSIBLE_TOOLS = new Set(["read", "write", "edit", "bash", "cli"]);
const SHOW_RESULT_HINT_IN_HEADER = new Set(["bash", "cli"]);

function ToolCard({ message }: { message: SessionMessage }): JSX.Element {
  const { t } = useI18n();
  const summary = buildToolSummary(message);
  const params = formatToolParams(summary);
  const resultMd = getResultMd(message);
  const diffLines = getDiffLines(summary);
  const planLines = getPlanLines(summary);
  const toolClass = toolCls(summary.name);
  const isMcp = summary.name.toLowerCase().startsWith("mcp__");
  const displayName = isMcp ? summary.name.replace(/^mcp__/, "").replace(/__/g, " · ") : formatStatusName(summary.name);
  const isFileTool = COLLAPSIBLE_TOOLS.has(summary.name.toLowerCase());
  const showHeaderHint = SHOW_RESULT_HINT_IN_HEADER.has(summary.name.toLowerCase());
  const [bodyOpen, setBodyOpen] = useState(!isFileTool);
  const [resultOpen, setResultOpen] = useState(false);
  const [resultCopied, setResultCopied] = useState(false);

  const handleCopyResult = useCallback(() => {
    if (!resultMd) return;
    void navigator.clipboard.writeText(resultMd).then(() => {
      setResultCopied(true);
      setTimeout(() => setResultCopied(false), 1500);
    });
  }, [resultMd]);

  // The header element is a button for collapsible tools (so the whole
  // card is clickable to expand/collapse) and a plain div for other
  // tools, where the header is just visual metadata.
  const headerInner = (
    <>
      <span className="ui-tool-icon">{toolIcon(summary.name)}</span>
      <span className="ui-tool-name">{displayName}</span>
      {/* Collapsible tools surface the file path / command inline so the
         user can identify the operation without expanding the card. */}
      {isFileTool && params ? <span className="ui-tool-params-inline">{params}</span> : null}
      {summary.ok ? null : <span className="ui-tool-badge err">✗</span>}
      {/* Elapsed time badge — how long the tool took to execute. */}
      {message.createTime && message.updateTime && message.createTime !== message.updateTime ? (
        <span className="ui-tool-elapsed">{formatElapsed(message.createTime, message.updateTime)}</span>
      ) : null}
      {/* Bash cards show the result hint (exit code, first line) in the
         header — the user shouldn't have to expand to know whether the
         command succeeded. */}
      {showHeaderHint && resultMd && !bodyOpen ? (
        <ResultHint toolName={summary.name} metadata={summary.metadata} resultMd={resultMd} />
      ) : null}
      {isFileTool ? <span className="ui-tool-chevron">{bodyOpen ? "▾" : "▸"}</span> : null}
    </>
  );

  return (
    <div
      className={`ui-tool-card ${toolClass}${summary.ok ? "" : " err"}${isFileTool ? " collapsible" : ""}${isFileTool && bodyOpen ? " open" : ""}`}
    >
      {isFileTool ? (
        <button type="button" className="ui-tool-head" onClick={() => setBodyOpen((v) => !v)}>
          {headerInner}
        </button>
      ) : (
        <div className="ui-tool-head">{headerInner}</div>
      )}
      {/* Non-file tools keep the params on a separate line (current behavior). */}
      {!isFileTool && params ? <div className="ui-tool-params">{params}</div> : null}
      {/* Body — for file tools, only rendered when expanded. */}
      {(!isFileTool || bodyOpen) && (
        <>
          {/* Diff preview for edit/write */}
          {diffLines.length > 0 ? (
            <div className="ui-diff">
              {diffLines.map((line, i) => (
                <div key={i} className={line.kind === "added" ? "add" : line.kind === "removed" ? "del" : "ctx"}>
                  {line.marker}
                  {line.content}
                </div>
              ))}
            </div>
          ) : null}
          {/* Plan lines for UpdatePlan */}
          {planLines.length > 0 ? (
            <div className="ui-tool-plan">
              <div className="ui-tool-plan-label">
                <IconToolPlan /> {t("msg.plan")}
              </div>
              <div className="ui-tool-plan-body">{planLines.join("\n")}</div>
            </div>
          ) : null}
          {/* Collapsible result */}
          {resultMd ? (
            <div className="ui-tool-result-wrap">
              <button className="ui-tool-result-toggle" onClick={() => setResultOpen((v) => !v)}>
                <span>{resultOpen ? "▾" : "▸"}</span>
                <span>{t("msg.result")}</span>
                {!resultOpen ? (
                  <ResultHint toolName={summary.name} metadata={summary.metadata} resultMd={resultMd} />
                ) : null}
              </button>
              {resultOpen ? (
                <div className="ui-tool-result">
                  <button
                    type="button"
                    className={`ui-tool-result-copy${resultCopied ? " copied" : ""}`}
                    onClick={handleCopyResult}
                    title={resultCopied ? t("msg.copied") : t("msg.copy")}
                  >
                    {resultCopied ? "✓" : "⧉"}
                  </button>
                  <ToolResult toolName={summary.name} params={params} resultMd={resultMd} />
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

// ── System note (centered, muted) ─────────────────────────────────────────────
function SystemNote({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="ui-bubble-row system">
      <div className="ui-system-note">{children}</div>
    </div>
  );
}

// ── Skill loaded card (system message with meta.skill) ───────────────────────
function SkillLoadedCard({ skill }: { skill: SkillInfo }): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="ui-bubble-row system">
      <div className="ui-skill-card">
        <span className="ui-skill-card-icon" aria-hidden="true">
          ✦
        </span>
        <div className="ui-skill-card-main">
          <div className="ui-skill-card-head">
            <span className="ui-skill-card-title">{t("msg.skillLoadedTitle")}</span>
            <span className="ui-skill-card-name">{skill.name}</span>
            <SkillSourceBadge skill={skill} />
          </div>
          {skill.description ? <div className="ui-skill-card-desc">{truncate(skill.description, 140)}</div> : null}
        </div>
        <span className="ui-skill-card-check" aria-hidden="true">
          ✓
        </span>
      </div>
    </div>
  );
}

// ── Main Message dispatcher ───────────────────────────────────────────────────
export function Message({
  message,
  reasoningMode = "normal",
  expandedThinkingId,
}: {
  message: SessionMessage;
  reasoningMode?: ReasoningMode;
  expandedThinkingId?: string | null;
}): JSX.Element | null {
  const { t } = useI18n();
  if (!message.visible) return null;

  if (message.role === "user") {
    return <UserBubble message={message} />;
  }

  if (message.role === "assistant") {
    if (message.meta?.asThinking) {
      return (
        <ThinkingBlock
          content={(message.content || "").trim()}
          messageParams={message.messageParams}
          reasoningMode={reasoningMode}
          isLatest={message.id === expandedThinkingId}
        />
      );
    }
    return <AssistantBubble message={message} />;
  }

  if (message.role === "tool") {
    const toolName = buildToolSummary(message).name.toLowerCase();
    const avatarRole: "tool" | "mcp" = toolName.startsWith("mcp") || toolName.startsWith("mcp__") ? "mcp" : "tool";
    return (
      <div className="ui-bubble-row tool">
        <Avatar role={avatarRole} />
        <ToolCard message={message} />
      </div>
    );
  }

  if (message.role === "system") {
    if (message.meta?.isModelChange) {
      return <SystemNote>{message.content || ""}</SystemNote>;
    }
    if (message.meta?.skill) {
      return <SkillLoadedCard skill={message.meta.skill} />;
    }
    if (message.meta?.isSummary) {
      return <SystemNote>› {t("msg.summaryInserted")}</SystemNote>;
    }
    return null;
  }

  return null;
}
