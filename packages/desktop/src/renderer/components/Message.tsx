import { memo, useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense, type JSX } from "react";
import type { SessionMessage, SkillInfo } from "../../shared/ipc";
import type { ReasoningMode } from "../lib/appearance";
import { extractStoreReferences, splitStoreRefSegments, type StoreRefToken } from "../lib/store-refs";
import { StreamdownView } from "./StreamdownView";

// Lazy-load A2UI Surface renderer — only needed when agent produces A2UI output.
const A2uiMessage = lazy(() => import("../a2ui/A2uiMessage").then((m) => ({ default: m.A2uiMessage })));
// Lazy-load comparison matrix — only needed when agent uses <comparison> tags.
const ComparisonMatrix = lazy(() => import("./ComparisonMatrix").then((m) => ({ default: m.ComparisonMatrix })));
import { getRichToolType, RichToolResult } from "./RichToolResult";
import {
  buildThinkingSummary,
  buildToolSummary,
  formatToolParams,
  getDiffLines,
  getPlanLines,
  getResultMd,
} from "../lib/messages";
import { useI18n } from "../i18n";
import { JsonView } from "./JsonView";
import {
  IconCommand,
  IconBolt,
  IconToolRead,
  IconToolWrite,
  IconToolEdit,
  IconToolAsk,
  IconToolPlan,
  IconToolSearch,
  IconToolMcp,
  IconToolGeneric,
} from "../ui/index";

function Md({
  text,
  isAnimating = false,
  streaming = true,
}: {
  text: string;
  isAnimating?: boolean;
  /** Streaming parse mode for live content; immutable payloads (tool results)
   *  pass false so remend/block-splitting is skipped on every expand. */
  streaming?: boolean;
}): JSX.Element {
  // Streaming mode: Streamdown splits the text into memoized blocks and
  // remend repairs unclosed syntax, so mid-stream chunks don't flash broken
  // markup. The caret is our own CSS (.ui-streamdown.is-animating), not
  // Streamdown's caret prop — don't pass both. Code-block copy is built in.
  return <StreamdownView className="ui-md" markdown={text} streaming={streaming} isAnimating={isAnimating} />;
}

/**
 * Circular avatar shown beside each bubble. Colored by role so the chat reads
 * at a glance — user (neutral), assistant (accent), thinking (amber), tool
 * (type-tinted). Mirrors the avatar-per-message layout of modern chat UIs.
 */
function Avatar({ role }: { role: "user" | "assistant" | "thinking" | "tool" | "mcp" }): JSX.Element {
  const glyph =
    role === "user" ? (
      "U"
    ) : role === "assistant" ? (
      "AI"
    ) : role === "thinking" ? (
      "✦"
    ) : (
      <span className="ui-avatar-bolt">
        <IconBolt />
      </span>
    );
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
 * Detect a result that is one pure JSON payload (a single ```json fence or
 * bare JSON) and parse it. Only composites qualify — a bare string/number
 * is better served by the plain markdown path.
 */
function tryParseJsonResult(resultMd: string): unknown | undefined {
  const trimmed = resultMd.trim();
  const fenced = trimmed.match(/^```json\s*\n([\s\S]*?)\n?```$/);
  const body = (fenced ? fenced[1]! : trimmed).trim();
  if (!body.startsWith("{") && !body.startsWith("[")) return undefined;
  try {
    const parsed: unknown = JSON.parse(body);
    return parsed !== null && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Result renderer for tool cards. The Read tool's output arrives with
 * line-number prefixes (e.g. "     1\t# AGENTS.md") so the agent can
 * cite lines. For .md / .html we strip those prefixes and render the
 * file as it was meant to be read; for code files we keep the
 * line-numbered view because the prefixes are the whole point.
 * Pure-JSON payloads get the interactive tree/raw JsonView card instead
 * of a flat fenced block (rendering-engine spec, card #7).
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
    return <Md text={stripReadLineNumbers(resultMd)} streaming={false} />;
  }
  if (toolName.toLowerCase() === "read" && (ext === "html" || ext === "htm")) {
    // HTML is rendered as HTML (CSP blocks inline scripts); the line
    // numbers in the output would otherwise leak into the markup.
    return <Md text={stripReadLineNumbers(resultMd)} streaming={false} />;
  }
  const json = tryParseJsonResult(resultMd);
  if (json !== undefined) {
    return <JsonView data={json} />;
  }
  return <Md text={resultMd} streaming={false} />;
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
// ── Store references (@…/.deeporca/deepwiki|reviews/…) in user prompts ──────
// The wiki/report quote bridges insert absolute @-mention paths into the
// prompt. Rendering those raw paths as plain text is noisy — recognize the
// two canonical stores (shared parser: lib/store-refs.ts, also powering the
// composer's reference highlighting) and render branded chips instead.

function ReferenceSegments({ text, refs }: { text: string; refs: StoreRefToken[] }): JSX.Element {
  const byRaw = new Map(refs.map((r) => [r.raw, r]));
  const parts: JSX.Element[] = [];
  splitStoreRefSegments(text).forEach((seg, i) => {
    if (seg.kind === "text") {
      parts.push(<span key={`t${i}`}>{seg.text}</span>);
      return;
    }
    const ref = byRaw.get(seg.ref.raw) ?? seg.ref;
    parts.push(
      <span key={`r${i}`} className={`ui-ref-chip ${ref.kind}`} title={ref.raw.slice(1)}>
        <span className="ui-ref-chip-icon">{ref.kind === "wiki" ? "📖" : "🛡"}</span>
        <span className="ui-ref-chip-body">
          <span className="ui-ref-chip-kind">{ref.kind === "wiki" ? "Wiki" : "审查报告"}</span>
          <span className="ui-ref-chip-label">{ref.label}</span>
        </span>
      </span>
    );
  });
  return <>{parts}</>;
}

function UserBubble({ message }: { message: SessionMessage }): JSX.Element {
  const { t } = useI18n();
  const attachments = Array.isArray(message.contentParams) ? message.contentParams.length : 0;
  const skills = message.meta?.userPrompt?.skills ?? [];
  const command = parseSlashCommand(message.content || "");

  // Command invocations render as a dedicated card instead of a text bubble.
  const refs = message.content ? extractStoreReferences(message.content) : { hasRefs: false, refs: [] };
  const body = command ? (
    <CommandCard name={command.name} args={command.args} createTime={message.createTime} />
  ) : message.content || attachments > 0 || skills.length === 0 ? (
    <div className="ui-bubble user">
      {refs.hasRefs ? (
        <span style={{ whiteSpace: "pre-wrap" }}>
          <ReferenceSegments text={message.content ?? ""} refs={refs.refs} />
        </span>
      ) : (
        <span style={{ whiteSpace: "pre-wrap" }}>{message.content || t("msg.noContent")}</span>
      )}
      {attachments > 0 ? <span className="ui-bubble-attach">{t("msg.images", { n: attachments })}</span> : null}
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
  elapsed,
  streaming = false,
}: {
  content: string;
  messageParams: unknown;
  reasoningMode: ReasoningMode;
  isLatest: boolean;
  elapsed?: string;
  streaming?: boolean;
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
          {elapsed ? <span className="ui-thinking-elapsed">{elapsed}</span> : null}
          {charCount > 0 ? <span className="ui-thinking-chars">{formatCharCount(charCount)}</span> : null}
          <span className="ui-thinking-chevron">{expanded ? "▾" : "▸"}</span>
        </button>
        {expanded && content ? (
          <div className="ui-thinking-body" ref={bodyRef}>
            <Md text={content} isAnimating={streaming} />
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

function AssistantBubble({
  message,
  streaming = false,
}: {
  message: SessionMessage;
  streaming?: boolean;
}): JSX.Element {
  const { t } = useI18n();
  const content = (message.content || "").trim();
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Extract <comparison> blocks for rich rendering.
  const comparisonBlocks = useMemo(() => {
    const matches: string[] = [];
    const regex = /<comparison>\s*([\s\S]*?)\s*<\/comparison>/g;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(content)) !== null) {
      matches.push(m[1]!);
    }
    return matches;
  }, [content]);
  // Content without comparison blocks (rendered as markdown).
  const contentWithoutComparisons =
    comparisonBlocks.length > 0 ? content.replace(/<comparison>[\s\S]*?<\/comparison>/g, "").trim() : content;

  // Clear the pending copy-feedback reset when the bubble unmounts.
  useEffect(
    () => () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    },
    []
  );

  const handleCopy = useCallback(() => {
    if (!content) return;
    void navigator.clipboard
      .writeText(content)
      .then(() => {
        setCopied(true);
        if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
        copyTimerRef.current = setTimeout(() => setCopied(false), 1500);
      })
      // Clipboard can be locked — swallow so the unhandled rejection
      // doesn't hit the console; the copied flag simply never flips.
      .catch(() => {});
  }, [content]);

  return (
    <div className="ui-bubble-row assistant">
      <Avatar role="assistant" />
      <div className="ui-bubble assistant">
        {contentWithoutComparisons ? <Md text={contentWithoutComparisons} isAnimating={streaming} /> : null}
        {comparisonBlocks.length > 0
          ? comparisonBlocks.map((block, i) => (
              <Suspense key={`cmp-${i}`} fallback={<div>{t("msg.loadingComparison")}</div>}>
                <ComparisonMatrix content={block} />
              </Suspense>
            ))
          : null}
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

/**
 * Terminal frame for bash tool cards (rendering-engine spec, card #8):
 * traffic-light window header + "Bash Terminal" title + copy-command
 * button, over a prompt-colored command line and the raw output.
 */
function BashTerminal({ command, resultMd }: { command: string; resultMd: string }): JSX.Element {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear the pending copy-feedback reset when the frame unmounts.
  useEffect(
    () => () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    },
    []
  );

  const handleCopy = useCallback(() => {
    void navigator.clipboard
      .writeText(command)
      .then(() => {
        setCopied(true);
        if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
        copyTimerRef.current = setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  }, [command]);

  const output = stripCodeFence(resultMd).trim();
  return (
    <div className="ui-term">
      <div className="ui-term-head">
        <span className="ui-term-dot red" aria-hidden="true" />
        <span className="ui-term-dot amber" aria-hidden="true" />
        <span className="ui-term-dot green" aria-hidden="true" />
        <span className="ui-term-title">{t("msg.bashTerminal")}</span>
        <button
          type="button"
          className={`ui-term-copy${copied ? " copied" : ""}`}
          onClick={handleCopy}
          title={copied ? t("msg.copied") : t("msg.copy")}
          aria-label={t("msg.copy")}
        >
          {copied ? "✓" : "⧉"}
        </button>
      </div>
      <div className="ui-term-body">
        <div className="ui-term-cmd">
          <span className="ui-term-user">agent@deeporca</span>
          <span className="ui-term-punc">:</span>
          <span className="ui-term-path">~</span>
          <span className="ui-term-punc">$ </span>
          <span className="ui-term-input">{command}</span>
        </div>
        {output ? <div className="ui-term-out">{output}</div> : null}
      </div>
    </div>
  );
}

function ToolCard({ message }: { message: SessionMessage }): JSX.Element {
  const { t } = useI18n();
  // Memoize derived data — tool messages are immutable after creation, so
  // these computations never change. Without useMemo, every parent re-render
  // (tick, scroll, sidebar refresh) re-parses JSON and re-computes diffs.
  const summary = useMemo(() => buildToolSummary(message), [message]);
  const params = useMemo(() => formatToolParams(summary), [summary]);
  const resultMd = useMemo(() => getResultMd(message), [message]);
  const diffLines = useMemo(() => getDiffLines(summary), [summary]);
  const planLines = useMemo(() => getPlanLines(summary), [summary]);
  const toolClass = toolCls(summary.name);
  const isMcp = summary.name.toLowerCase().startsWith("mcp__");
  const isBash = toolClass === "bash";
  // Rendering-engine spec: tool names are mono "tool::<name>" (amber) and
  // MCP calls are "mcp::<server>/<tool>" (purple) with an "MCP Server" badge.
  const displayName = isMcp
    ? `mcp::${summary.name.replace(/^mcp__/, "").replace(/__/g, "/")}`
    : `tool::${summary.name.toLowerCase()}`;
  const isFileTool = COLLAPSIBLE_TOOLS.has(summary.name.toLowerCase());
  const showHeaderHint = SHOW_RESULT_HINT_IN_HEADER.has(summary.name.toLowerCase());
  const [bodyOpen, setBodyOpen] = useState(!isFileTool);
  const [resultOpen, setResultOpen] = useState(false);
  const [resultCopied, setResultCopied] = useState(false);
  const resultCopyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear the pending copy-feedback reset when the card unmounts.
  useEffect(
    () => () => {
      if (resultCopyTimerRef.current) clearTimeout(resultCopyTimerRef.current);
    },
    []
  );

  const handleCopyResult = useCallback(() => {
    if (!resultMd) return;
    void navigator.clipboard
      .writeText(resultMd)
      .then(() => {
        setResultCopied(true);
        if (resultCopyTimerRef.current) clearTimeout(resultCopyTimerRef.current);
        resultCopyTimerRef.current = setTimeout(() => setResultCopied(false), 1500);
      })
      .catch(() => {});
  }, [resultMd]);

  // The header element is a button for collapsible tools (so the whole
  // card is clickable to expand/collapse) and a plain div for other
  // tools, where the header is just visual metadata.
  const headerInner = (
    <>
      <span className="ui-tool-icon">{toolIcon(summary.name)}</span>
      {!isMcp ? <span className="ui-tool-kind">{t("msg.toolLabel")}</span> : null}
      <span className="ui-tool-name">{displayName}</span>
      {/* Collapsible tools surface the file path / command inline so the
         user can identify the operation without expanding the card. For
         bash the terminal frame already shows the command when open. */}
      {isFileTool && params && !(isBash && bodyOpen) ? <span className="ui-tool-params-inline">{params}</span> : null}
      {isMcp ? <span className="ui-tool-badge mcp">{t("msg.mcpServer")}</span> : null}
      {/* Status badge — ✓ success / ✗ failure, per the rendering-engine spec. */}
      {summary.ok ? (
        <span className="ui-tool-badge ok">✓ {t("msg.toolOk")}</span>
      ) : (
        <span className="ui-tool-badge err">✗ {t("msg.toolFail")}</span>
      )}
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
        <button type="button" className="ui-tool-head" onClick={() => setBodyOpen((v) => !v)} aria-expanded={bodyOpen}>
          {headerInner}
        </button>
      ) : (
        <div className="ui-tool-head">{headerInner}</div>
      )}
      {/* Non-file tools keep the params in a dark PARAMS panel (spec card #3). */}
      {!isFileTool && params ? (
        <div className="ui-tool-params-panel">
          <div className="ui-tool-params-label">
            <span>{t("msg.params")}</span>
            <span className="ui-tool-params-fmt">{isMcp ? "MCP" : "JSON"}</span>
          </div>
          <div className="ui-tool-params">{params}</div>
        </div>
      ) : null}
      {/* Body — for file tools, only rendered when expanded. */}
      {(!isFileTool || bodyOpen) && (
        <>
          {/* Bash renders as a terminal frame: command + output inline. */}
          {isBash ? <BashTerminal command={summary.params.trim()} resultMd={resultMd} /> : null}
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
          {/* Interactive plan checklist for UpdatePlan */}
          {planLines.length > 0 ? (
            <div className="ui-tool-plan">
              <div className="ui-tool-plan-label">
                <IconToolPlan /> {t("msg.plan")}
                <span className="ui-tool-plan-count">
                  {planLines.filter((l) => l.match(/^\s*[-*]\s*\[x\]/i)).length}/{planLines.length}
                </span>
              </div>
              <div className="ui-tool-plan-body">
                {planLines.map((line, i) => {
                  const checked = /^\s*[-*]\s*\[x\]/i.test(line);
                  const text = line.replace(/^\s*[-*]\s*\[[ xX]\]\s*/, "");
                  const isSubItem = /^\s{2,}/.test(line);
                  return (
                    <label key={i} className={`ui-plan-item${checked ? " done" : ""}${isSubItem ? " sub" : ""}`}>
                      <input type="checkbox" checked={checked} readOnly />
                      <span className="ui-plan-item-text">{text}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          ) : null}
          {/* Collapsible result — bash output already lives in the terminal frame. */}
          {resultMd && !isBash ? (
            <div className="ui-tool-result-wrap">
              <button
                className="ui-tool-result-toggle"
                onClick={() => setResultOpen((v) => !v)}
                aria-expanded={resultOpen}
              >
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
                    aria-label={t("msg.copy")}
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
// Memoized: message objects are stable references, so unrelated app-level
// re-renders (loading ticks, sidebar refreshes) skip the whole subtree.
export const Message = memo(function Message({
  message,
  reasoningMode = "normal",
  expandedThinkingId,
  streaming = false,
}: {
  message: SessionMessage;
  reasoningMode?: ReasoningMode;
  expandedThinkingId?: string | null;
  /** True on the last message while the session is busy — shows the caret. */
  streaming?: boolean;
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
          elapsed={
            message.createTime && message.updateTime && message.createTime !== message.updateTime
              ? formatElapsed(message.createTime, message.updateTime)
              : undefined
          }
          streaming={streaming}
        />
      );
    }
    return <AssistantBubble message={message} streaming={streaming} />;
  }

  if (message.role === "tool") {
    const toolName = buildToolSummary(message).name.toLowerCase();

    // A2UI tool results — render as interactive Surface instead of plain ToolCard.
    if (toolName.includes("a2ui") || toolName.includes("render_surface") || toolName.includes("update_surface")) {
      const a2uiJson = extractA2uiPayload(message);
      if (a2uiJson) {
        const summary = extractA2uiSummary(message);
        return (
          <div className="ui-bubble-row tool">
            <Avatar role="mcp" />
            <Suspense fallback={<div className="ui-tool-card">{t("msg.loadingSurface")}</div>}>
              <A2uiMessage a2uiJson={a2uiJson} summary={summary} />
            </Suspense>
          </div>
        );
      }
    }

    // Rich tool results — structured rendering for known tool types.
    const richType = getRichToolType(message);
    if (richType) {
      const avatarRole: "tool" | "mcp" = toolName.startsWith("mcp") || toolName.startsWith("mcp__") ? "mcp" : "tool";
      return (
        <div className="ui-bubble-row tool">
          <Avatar role={avatarRole} />
          <RichToolResult message={message} />
        </div>
      );
    }

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
});

// ── A2UI payload extraction helpers ─────────────────────────────────────────

/** Extract A2UI JSON payload from a tool result message. */
function extractA2uiPayload(message: SessionMessage): string | null {
  try {
    const parsed = JSON.parse(message.content || "{}");
    // The MCP executor (mcp-manager.ts) lifts any resource with
    // mimeType `application/a2ui+json` into `metadata.a2ui` — this is the
    // only path the built-in a2ui server produces, and it is always set
    // when an A2UI surface is returned. The previous regex fallback that
    // tried to scrape the payload out of `output` was unreachable in
    // practice and corrupted escaped JSON; removed.
    const meta = parsed.metadata ?? {};
    // metadata.a2ui is already a JSON string (mcp-manager lifts the
    // `application/a2ui+json` resource's `.text`, which itself is
    // JSON.stringify(messages) from a2ui-mcp.ts). Stringifying it again would
    // double-encode and break processor.ts's JSON.parse. Mirror App.tsx's
    // typeof check. Only stringify if it somehow arrives as an object.
    if (meta.a2ui) return typeof meta.a2ui === "string" ? meta.a2ui : JSON.stringify(meta.a2ui);
    return null;
  } catch {
    return null;
  }
}

/** Extract the text summary from an A2UI tool result. */
function extractA2uiSummary(message: SessionMessage): string | undefined {
  try {
    const parsed = JSON.parse(message.content || "{}");
    return typeof parsed.output === "string" ? parsed.output.split("\n")[0] : undefined;
  } catch {
    return undefined;
  }
}
