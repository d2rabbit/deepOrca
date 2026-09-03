/**
 * shared — 拆分自 Message.tsx（落地实施方案 §八）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import type { MessageKey } from "../../i18n";
import { StreamdownView } from "../StreamdownView";
import { useI18n } from "../../i18n";
import { JsonView } from "../JsonView";
import { firstNonEmptyLine } from "../../lib/messages";
import {
  IconBashTerminal,
  IconBolt,
  IconSparkle,
  IconToolAsk,
  IconToolEdit,
  IconToolGeneric,
  IconToolMcp,
  IconToolPlan,
  IconToolRead,
  IconToolSearch,
  IconToolWrite,
} from "../../ui/icons";

export function Md({
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
export function Avatar({ role }: { role: "user" | "assistant" | "thinking" | "tool" | "mcp" }): JSX.Element {
  const glyph =
    role === "user" ? (
      "U"
    ) : role === "assistant" ? (
      "AI"
    ) : role === "thinking" ? (
      <IconSparkle />
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

/** CANONICAL tool-family classifier — single source for the conversation-flow
 *  CSS modifiers (toolIcon) and the ActivityRail's display-kind projection.
 *  New tool-family checks go HERE, not in per-component matchers. */
export function toolCls(name: string): string {
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
export function toolIcon(name: string): JSX.Element {
  const n = name.toLowerCase();
  if (n === "bash" || n === "cli") return <IconBashTerminal />;
  if (n === "read") return <IconToolRead />;
  if (n === "write") return <IconToolWrite />;
  if (n === "edit") return <IconToolEdit />;
  if (n === "askuserquestion") return <IconToolAsk />;
  if (n === "updateplan") return <IconToolPlan />;
  if (n === "websearch") return <IconToolSearch />;
  if (n.startsWith("mcp__")) return <IconToolMcp />;
  return <IconToolGeneric />;
}

/** 行为流动词（按工具类别；msg.flow.*）——会话流缩略行的第一个词。 */
export const FLOW_VERB_KEY: Record<string, MessageKey> = {
  bash: "msg.flow.bash",
  read: "msg.flow.read",
  write: "msg.flow.write",
  edit: "msg.flow.edit",
  search: "msg.flow.grep",
  mcp: "msg.flow.mcp",
  plan: "msg.flow.plan",
  ask: "msg.flow.ask",
  generic: "msg.flow.other",
};

/** Truncate with an ellipsis: "abcdefgh", 4 → "abcd…". */
export function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

/** Compact character count: 1234 → "1.2k", 500 → "500". */
export function formatCharCount(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(1)}k`;
}

/** Format elapsed time between two ISO timestamps as a human-readable duration. */
export function formatElapsed(startIso: string, endIso: string): string {
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
export function ResultHint({
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
export function ToolResult({
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

export function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

export function BashTerminal({ command, resultMd }: { command: string; resultMd: string }): JSX.Element {
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
