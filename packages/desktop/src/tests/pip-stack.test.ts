// reconcilePipEntries（renderer/lib/app-models.ts）— 角落 PiP 活状态对账：
// 会话完结/消失自动出栈，闸口标记刷新为活值，无变化时引用稳定。
// 纯函数——不碰 DOM 与 api stub。
import { test } from "node:test";
import assert from "node:assert/strict";
import { reconcilePipEntries, type PipEntry } from "../renderer/lib/app-models";

function entry(overrides: Partial<PipEntry>): PipEntry {
  return {
    root: "D:/ws-a",
    label: "ws-a",
    sessionId: "s1",
    title: null,
    frozen: [],
    blockedAtCapture: false,
    ...overrides,
  };
}

const source = (root: string, sessions: Array<{ id: string; status: string; askPermissions?: unknown[] }>) => ({
  workspaces: [{ root, sessions }],
});

test("settled sessions and vanished roots leave the stack on their own", () => {
  const prev = [
    entry({ root: "D:/a", sessionId: "done" }),
    entry({ root: "D:/b", sessionId: "run" }),
    entry({ root: "D:/gone", sessionId: "x" }),
  ];
  const next = reconcilePipEntries(prev, {
    workspaces: [
      { root: "D:/a", sessions: [{ id: "done", status: "completed" }] },
      { root: "D:/b", sessions: [{ id: "run", status: "processing" }] },
    ],
  });
  assert.deepEqual(
    next.map((e) => e.root),
    ["D:/b"]
  );
});

test("interrupted/failed/denied also settle; pending/processing/waiting stay", () => {
  const statuses: Array<[string, boolean]> = [
    ["interrupted", true],
    ["failed", true],
    ["permission_denied", true],
    ["pending", false],
    ["processing", false],
    ["waiting_for_user", false],
    ["ask_permission", false],
    ["paused", false],
  ];
  for (const [status, shouldDrop] of statuses) {
    const next = reconcilePipEntries([entry({})], source("D:/ws-a", [{ id: "s1", status }]));
    assert.equal(next.length, shouldDrop ? 0 : 1, `status=${status}`);
  }
});

test("gate flag refreshes to live and flips back", () => {
  const raised = reconcilePipEntries([entry({})], source("D:/ws-a", [{ id: "s1", status: "waiting_for_user" }]));
  assert.equal(raised[0].blockedAtCapture, true);
  assert.notEqual(raised[0], entry({}));
  const cleared = reconcilePipEntries(raised, source("D:/ws-a", [{ id: "s1", status: "processing" }]));
  assert.equal(cleared[0].blockedAtCapture, false);
});

test("askPermissions array counts as a gate even while processing", () => {
  const next = reconcilePipEntries(
    [entry({})],
    source("D:/ws-a", [{ id: "s1", status: "processing", askPermissions: [{}] }])
  );
  assert.equal(next[0].blockedAtCapture, true);
});

test("no-change reconcile keeps entry identity (zero render churn)", () => {
  const prev = [entry({ blockedAtCapture: true })];
  const next = reconcilePipEntries(prev, source("D:/ws-a", [{ id: "s1", status: "ask_permission" }]));
  assert.equal(next[0], prev[0]);
});

test("null-sessionId entries keep their capture-time signal", () => {
  const prev = [entry({ sessionId: null, blockedAtCapture: true })];
  const next = reconcilePipEntries(prev, source("D:/ws-a", []));
  assert.equal(next.length, 1);
  assert.equal(next[0], prev[0]);
});
