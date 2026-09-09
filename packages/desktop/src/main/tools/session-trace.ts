/**
 * Session trace normalizer (task-tree-hub §trace) — turns a session's message
 * list into the DeepSeek-harness-style event log the task tree renders inline:
 *   user 指令 → per-Turn agent behavior (thinking / tool calls / skill /
 *   MCP / assistant), tool results matched back onto their call by id.
 *
 * Pure + UI-free — unit-tests cold. Tolerant by construction: any message
 * shape it does not understand is skipped, never thrown. readSessionTraceSource
 * is the one disk-reading companion (cross-workspace session JSONL fetch).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SessionMessage } from "@deeporca/core";

export interface TraceStep {
  /** Glyph class driving the icon color (t-bash / t-read / t-agent …). */
  cls: string;
  /** Icon glyph (emoji) rendered in the step chip. */
  ic: string;
  /** Display name: tool name, "skill", "thinking", "assistant", … */
  tool: string;
  /** One-line argument/summary snippet. */
  arg: string;
  /** Full untruncated argument JSON — the detail panel's data source; the
   *  inline row keeps the clipped `arg` (display-noise only). Capped at
   *  ARG_FULL_MAX so a pathological write payload can't stall the sheet. */
  argFull?: string;
  ok?: boolean;
  fail?: boolean;
  /** Terminal-state marker (user ask 2026-09-08): a landed trace is never
   *  "in progress". A call is marked interrupted when its tool result never
   *  arrived — swept either at a turn boundary (a newer user 指令 closed the
   *  turn while the call was still open) or at log end (the terminal sweep,
   *  which is skipped for a session still in flight — normalizeSessionTrace). */
  interrupted?: boolean;
  ms?: string;
  mcp?: string;
  /** Truncated result markdown (meta.resultMd, ≤2000 chars) — used by the
   *  trajectory detail panel for the 结果 section (specs/depth-lane 追加). */
  resultMd?: string;
  /** Start time (assistant message createTime) for the 开始时间 field. */
  at?: string;
  /** Subagent steps carry their own nested steps. */
  nested?: TraceStep[];
}

export interface TraceTurn {
  user: string;
  at: string;
  steps: TraceStep[];
}

export interface SessionTrace {
  sessionId: string;
  title: string;
  turns: TraceTurn[];
  /** true when the session had more turns than we kept (oldest dropped). */
  truncated?: boolean;
}

const ARG_MAX = 110;
const TEXT_MAX = 150;
/** Detail-panel argument cap — full enough for any command/path/question
 *  payload, bounded enough that a megabyte write can't cross IPC for a
 *  view the user may never open. */
const ARG_FULL_MAX = 20_000;
// user ask 2026-09-03 九轮：任务树轨迹就是为了看完整内容 —— 不再截断
// turn 数（旧值 3 只留最近三个 turn）。参数/文本的行内裁剪保留（显示层
// 降噪，完整原文在会话 JSONL 里）。

function clip(s: string, max = ARG_MAX): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

/** classify an LLM tool name → icon class + glyph. */
function classifyTool(name: string): { cls: string; ic: string } {
  const n = name.toLowerCase();
  if (n === "bash") return { cls: "t-bash", ic: "⌨️" };
  if (n === "read") return { cls: "t-read", ic: "📖" };
  if (n === "write") return { cls: "t-write", ic: "📝" };
  if (n === "edit") return { cls: "t-edit", ic: "✏️" };
  if (n === "websearch" || n === "web_search") return { cls: "t-web", ic: "🔎" };
  if (n === "webfetch" || n === "web_fetch") return { cls: "t-web", ic: "🌐" };
  if (n === "askuserquestion") return { cls: "t-question", ic: "❓" };
  if (n === "updateplan") return { cls: "t-read", ic: "☑️" };
  // define-action surface (LLM leg) — composite agent actions read as subagents
  if (/^(arch[_-]?scan|bento|design\.|prototype\.|wiki\.|index\.|review\.|crg\.|task\.)/i.test(n))
    return { cls: "t-agent", ic: "🤖" };
  return { cls: "t-bash", ic: "🔧" };
}

interface OpenCall {
  step: TraceStep;
  callId: string;
  at: number;
}

/** Parse one OpenAI-style tool_call ({id, function:{name, arguments}}). */
function readCall(raw: unknown): { id: string; name: string; arg: string; argFull: string } | null {
  if (raw == null || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  const fn = c.function as Record<string, unknown> | undefined;
  const name = typeof fn?.name === "string" ? fn.name : typeof c.name === "string" ? (c.name as string) : "";
  if (!name) return null;
  let rawArgs = "";
  if (typeof fn?.arguments === "string") {
    rawArgs = fn.arguments;
  } else if (fn?.arguments != null) {
    try {
      rawArgs = JSON.stringify(fn.arguments);
    } catch {
      rawArgs = "";
    }
  }
  const argFull = rawArgs.length > ARG_FULL_MAX ? `${rawArgs.slice(0, ARG_FULL_MAX)}…` : rawArgs;
  return { id: typeof c.id === "string" ? c.id : "", name, arg: clip(rawArgs), argFull };
}

/** Tool result verdict: the serialized envelope is { ok, error?, output? }. */
function verdictOf(content: string | null): { ok?: boolean; fail?: boolean } {
  if (content == null) return {};
  try {
    const parsed = JSON.parse(content) as { ok?: unknown; error?: unknown };
    if (typeof parsed.ok === "boolean") return parsed.ok ? { ok: true } : { fail: true };
  } catch {
    // non-JSON tool output — treat as ok (most fs/shell results)
  }
  return { ok: true };
}

/**
 * Read one session's trace source straight from a project dir — the JSONL
 * message log plus the index summary. Cross-workspace safe: unlike the
 * SessionBridge (bound to the ACTIVE project's session manager), this reads
 * whichever project dir the caller resolved. Missing files yield empty
 * content, never a throw.
 */
export function readSessionTraceSource(
  projectDir: string,
  sessionId: string
): { messages: SessionMessage[]; summary?: string } {
  const messages: SessionMessage[] = [];
  try {
    const raw = readFileSync(join(projectDir, `${sessionId}.jsonl`), "utf-8");
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        messages.push(JSON.parse(line) as SessionMessage);
      } catch {
        // malformed line — skip
      }
    }
  } catch {
    // missing/unreadable session file — empty messages
  }
  let summary: string | undefined;
  try {
    const index = JSON.parse(readFileSync(join(projectDir, "sessions-index.json"), "utf-8")) as {
      entries?: Array<{ id?: unknown; summary?: unknown }>;
    };
    const hit = (index.entries ?? []).find((e) => e.id === sessionId);
    summary = typeof hit?.summary === "string" ? hit.summary : undefined;
  } catch {
    // no index yet — the caller falls back to the id slice as the title
  }
  return { messages, summary };
}

export function normalizeSessionTrace(
  sessionId: string,
  title: string,
  messages: SessionMessage[],
  opts?: { inFlight?: boolean }
): SessionTrace {
  const turns: TraceTurn[] = [];
  let open: OpenCall[] = [];

  const ensureTurn = (at: string): TraceTurn => {
    if (turns.length === 0) turns.push({ user: "（继续会话）", at, steps: [] });
    return turns[turns.length - 1];
  };

  for (const msg of messages) {
    if (msg.role === "user") {
      // skip synthetic/system-ish user messages (thinking-only, summaries)
      const up = msg.meta?.userPrompt;
      const text = (typeof up?.text === "string" && up.text.trim()) || (msg.content ?? "").trim();
      if (!text || msg.meta?.asThinking || msg.meta?.isSummary) continue;
      // Turn boundary: calls still open from the PREVIOUS turn can never
      // receive their results anymore — sweep them to interrupted here. The
      // terminal sweep at loop end only sees the final segment (open resets
      // below), and the inFlight exemption must stay scoped to exactly that
      // segment; without this, an earlier interrupted turn renders badge-less
      // forever.
      for (const o of open) {
        if (!o.step.ok && !o.step.fail) o.step.interrupted = true;
      }
      turns.push({ user: clip(text, TEXT_MAX * 2), at: msg.createTime, steps: [] });
      open = [];
      continue;
    }
    if (msg.role === "system") {
      const skill = msg.meta?.skill;
      if (skill?.isLoaded && skill.name) {
        ensureTurn(msg.createTime).steps.push({
          cls: "t-skill",
          ic: "🧩",
          tool: "skill",
          arg: clip(`${skill.name}（${skill.description || "注入技能"}）`, 90),
          ok: true,
        });
      }
      continue;
    }
    if (msg.role === "assistant") {
      const mp = (msg.messageParams ?? {}) as Record<string, unknown>;
      const calls = Array.isArray(mp.tool_calls) ? mp.tool_calls : [];
      for (const raw of calls) {
        const call = readCall(raw);
        if (!call) continue;
        const { cls, ic } = classifyTool(call.name);
        const step: TraceStep = { cls, ic, tool: call.name, arg: call.arg, argFull: call.argFull, at: msg.createTime };
        if (call.name.startsWith("mcp__")) {
          const parts = call.name.split("__");
          step.mcp = parts[1] || "mcp";
          step.tool = parts.slice(2).join("__") || call.name;
          step.cls = "t-mcp";
          step.ic = "🔌";
        }
        const turn = ensureTurn(msg.createTime);
        turn.steps.push(step);
        open.push({ step, callId: call.id, at: new Date(msg.createTime).getTime() });
      }
      const text = (msg.content ?? "").trim();
      if (text) {
        ensureTurn(msg.createTime).steps.push({
          cls: "t-assistant",
          ic: "💬",
          tool: "assistant",
          arg: clip(text, TEXT_MAX),
          // Full message for the detail panel (same cap as tool args).
          argFull: text.length > ARG_FULL_MAX ? `${text.slice(0, ARG_FULL_MAX)}…` : text,
        });
      }
      continue;
    }
    if (msg.role === "tool") {
      const mp = (msg.messageParams ?? {}) as Record<string, unknown>;
      const callId = typeof mp.tool_call_id === "string" ? mp.tool_call_id : "";
      const hit = callId ? [...open].reverse().find((o) => o.callId === callId) : undefined;
      let target: TraceStep | undefined;
      if (hit) target = hit.step;
      else if (open.length > 0) target = open[open.length - 1].step; // tolerate missing ids
      if (target) {
        const v = verdictOf(msg.content);
        target.ok = v.ok;
        target.fail = v.fail;
        // Carry the truncated result markdown for the detail panel (P0.3).
        const rm = msg.meta?.resultMd;
        if (typeof rm === "string" && rm) target.resultMd = rm;
        if (hit) {
          const dt = new Date(msg.createTime).getTime() - hit.at;
          if (Number.isFinite(dt) && dt >= 0)
            target.ms = dt >= 1000 ? `${(dt / 1000).toFixed(1)}s` : `${Math.round(dt)}ms`;
        }
        if (hit) open = open.filter((o) => o !== hit);
      }
      continue;
    }
  }

  // Terminal-state sweep (user ask 2026-09-08): a landed trace is never "in
  // progress". Any tool call still unmatched when the message log ends never
  // recorded a result — the run was interrupted/abandoned mid-flight. Mark it
  // so the UI renders 已中断 instead of guessing from a missing verdict.
  // Skipped for a live session (opts.inFlight): its unmatched calls are
  // genuinely executing/paused/awaiting permission, not abandoned. A step
  // that already carries a verdict stays completed — the missing-callId
  // fallback below assigns by position WITHOUT removing the step from `open`.
  if (!opts?.inFlight) {
    for (const o of open) {
      if (!o.step.ok && !o.step.fail) o.step.interrupted = true;
    }
  }

  return { sessionId, title, turns };
}
