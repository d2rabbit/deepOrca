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
  ok?: boolean;
  fail?: boolean;
  ms?: string;
  mcp?: string;
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
const KEEP_TURNS = 3;

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
function readCall(raw: unknown): { id: string; name: string; arg: string } | null {
  if (raw == null || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  const fn = c.function as Record<string, unknown> | undefined;
  const name = typeof fn?.name === "string" ? fn.name : typeof c.name === "string" ? (c.name as string) : "";
  if (!name) return null;
  let arg = "";
  if (typeof fn?.arguments === "string") {
    arg = fn.arguments;
  } else if (fn?.arguments != null) {
    try {
      arg = JSON.stringify(fn.arguments);
    } catch {
      arg = "";
    }
  }
  return { id: typeof c.id === "string" ? c.id : "", name, arg: clip(arg) };
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

export function normalizeSessionTrace(sessionId: string, title: string, messages: SessionMessage[]): SessionTrace {
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
        const step: TraceStep = { cls, ic, tool: call.name, arg: call.arg };
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

  const truncated = turns.length > KEEP_TURNS;
  const kept = truncated ? turns.slice(-KEEP_TURNS) : turns;
  return { sessionId, title, turns: kept, truncated: truncated || undefined };
}
