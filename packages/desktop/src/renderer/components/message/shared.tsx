/**
 * shared — 拆分自 Message.tsx（落地实施方案 §八）。
 * 会话流共用的小件：Markdown 体、头像、规范工具分类器与图标、动词表、
 * 文本格式化工具。demo-flow 对齐后，工具调用的完整内容只渲染在右侧
 * 活动小窗 —— 这里不再承载内联大卡。
 */
import type { JSX } from "react";
import type { MessageKey } from "../../i18n";
import { StreamdownView } from "../StreamdownView";
import { useI18n } from "../../i18n";
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

/** Format a timestamp as a short local time string (HH:MM). */
export function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}
