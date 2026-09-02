/**
 * Session trace normalizer (main tools/session-trace.ts) — DeepSeek-harness
 * style event log over raw session messages. Pins:
 *   - user 指令 opens a Turn; agent behavior (tool calls) follows inside it,
 *   - tool results match back onto their call by id (verdict + duration),
 *   - skill-load system messages become 🧩 skill steps,
 *   - mcp__server__tool calls carry the MCP badge and the bare tool name,
 *   - assistant text becomes an assistant step,
 *   - only the newest KEEP_TURNS turns survive (truncated flag).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { normalizeSessionTrace, readSessionTraceSource } from "../main/tools/session-trace";

type Raw = {
  id?: string;
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  messageParams?: Record<string, unknown> | null;
  meta?: Record<string, unknown>;
  createTime?: string;
};

const msg = (r: Raw, i: number) =>
  ({
    id: r.id ?? `m${i}`,
    sessionId: "s1",
    role: r.role,
    content: r.content ?? null,
    contentParams: null,
    messageParams: r.messageParams ?? null,
    compacted: false,
    visible: true,
    createTime: r.createTime ?? `2026-09-01T10:0${i}:00.000Z`,
    updateTime: r.createTime ?? `2026-09-01T10:0${i}:00.000Z`,
    meta: r.meta,
  }) as never;

const call = (id: string, name: string, args: string) => ({
  id,
  type: "function",
  function: { name, arguments: args },
});

test("session-trace: user 指令 → tool calls → results with verdict and duration", () => {
  const trace = normalizeSessionTrace("s1", "demo", [
    msg({ role: "user", content: "重构登录模块", createTime: "2026-09-01T10:00:00.000Z" }, 1),
    msg(
      {
        role: "assistant",
        content: "done",
        messageParams: {
          tool_calls: [
            call("c1", "bash", '{"command":"pnpm test"}'),
            call("c2", "mcp__github__create_pull_request", '{"branch":"x"}'),
          ],
        },
        createTime: "2026-09-01T10:00:05.000Z",
      },
      2
    ),
    msg(
      {
        role: "tool",
        content: '{"ok":true}',
        messageParams: { tool_call_id: "c1" },
        createTime: "2026-09-01T10:00:07.500Z",
      },
      3
    ),
    msg(
      {
        role: "tool",
        content: '{"ok":false,"error":"boom"}',
        messageParams: { tool_call_id: "c2" },
        createTime: "2026-09-01T10:00:09.000Z",
      },
      4
    ),
  ] as never);

  assert.equal(trace.turns.length, 1);
  const turn = trace.turns[0];
  assert.equal(turn.user, "重构登录模块");
  const [bash, pr] = turn.steps;
  assert.equal(bash.tool, "bash");
  assert.equal(bash.ok, true);
  assert.equal(bash.ms, "2.5s");
  assert.equal(pr.mcp, "github");
  assert.equal(pr.tool, "create_pull_request");
  assert.equal(pr.cls, "t-mcp");
  assert.equal(pr.fail, true);
});

test("session-trace: skill system message → skill step; assistant text → assistant step", () => {
  const trace = normalizeSessionTrace("s1", "demo", [
    msg(
      {
        role: "system",
        meta: { skill: { name: "karpathy-guidelines", path: "/x", description: "编码规范", isLoaded: true } },
      },
      1
    ),
    msg({ role: "assistant", content: "先读代码再动手。", createTime: "2026-09-01T10:00:01.000Z" }, 2),
  ] as never);
  assert.equal(trace.turns.length, 1);
  assert.equal(trace.turns[0].steps[0].tool, "skill");
  assert.equal(trace.turns[0].steps[0].cls, "t-skill");
  assert.equal(trace.turns[0].steps[1].tool, "assistant");
});

test("session-trace: keeps only the newest 3 turns and flags truncation", () => {
  const raws: Raw[] = [];
  for (let i = 1; i <= 5; i++) {
    raws.push({ role: "user", content: `turn ${i}`, createTime: `2026-09-01T10:0${i}:00.000Z` });
    raws.push({ role: "assistant", content: `ok ${i}`, createTime: `2026-09-01T10:0${i}:30.000Z` });
  }
  const trace = normalizeSessionTrace("s1", "demo", raws.map((r, i) => msg(r, i)) as never);
  assert.equal(trace.turns.length, 3);
  assert.equal(trace.truncated, true);
  assert.match(trace.turns[0].user, /turn 3/);
  assert.match(trace.turns[2].user, /turn 5/);
});

// ── readSessionTraceSource (cross-workspace JSONL fetch) ────────────────────

test("readSessionTraceSource: reads JSONL messages + index summary from the project dir", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "deepcode-trace-"));
  try {
    fs.writeFileSync(
      path.join(dir, "s1.jsonl"),
      [
        JSON.stringify({ role: "user", content: "重构登录模块", createTime: "2026-09-01T10:00:00.000Z" }),
        JSON.stringify({ role: "assistant", content: "ok", createTime: "2026-09-01T10:00:05.000Z" }),
      ].join("\n")
    );
    fs.writeFileSync(
      path.join(dir, "sessions-index.json"),
      JSON.stringify({
        version: 1,
        entries: [
          { id: "s1", summary: "登录模块重构" },
          { id: "s2", summary: "其他" },
        ],
      })
    );
    const { messages, summary } = readSessionTraceSource(dir, "s1");
    assert.equal(messages.length, 2);
    assert.equal(messages[0].role, "user");
    assert.equal(summary, "登录模块重构");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("readSessionTraceSource: malformed lines are skipped, summary absent → undefined", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "deepcode-trace-"));
  try {
    fs.writeFileSync(
      path.join(dir, "s1.jsonl"),
      ["not-json", "", JSON.stringify({ role: "user", content: "hi", createTime: "2026-09-01T10:00:00.000Z" })].join(
        "\n"
      )
    );
    fs.writeFileSync(path.join(dir, "sessions-index.json"), JSON.stringify({ version: 1, entries: [] }));
    const { messages, summary } = readSessionTraceSource(dir, "s1");
    assert.equal(messages.length, 1);
    assert.equal(summary, undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("readSessionTraceSource: missing session file and missing index degrade to empty — no throw", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "deepcode-trace-"));
  try {
    const { messages, summary } = readSessionTraceSource(dir, "ghost");
    assert.deepEqual(messages, []);
    assert.equal(summary, undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
