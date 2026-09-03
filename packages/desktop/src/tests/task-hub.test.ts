/**
 * Task hub aggregator (main tools/task-hub.ts) — the unified workspace task
 * tree over the four record domains. Pins:
 *   - all four domains normalize into groups, nodes sorted startedAt desc,
 *   - review status mapping (warnings / errors),
 *   - archived session trees carry the archived status,
 *   - per-domain fail-open: a throwing reader costs only its own domain.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { IndexJobRecord, ReviewReportMeta } from "../shared/ipc";
import { buildTaskHub, taskHubCount, type TaskHubDeps } from "../main/tools/task-hub";

const review = (over: Partial<ReviewReportMeta>): ReviewReportMeta => ({
  id: "review-2026-09-01T10-00-00-000",
  generatedAt: "2026-09-01T10:00:00.000Z",
  status: "success",
  filesReviewed: 3,
  comments: 5,
  statusNote: "ok",
  ...over,
});

const job = (over: Partial<IndexJobRecord>): IndexJobRecord => ({
  id: "job-2026-09-01T09-00-00-000",
  root: "/r",
  mode: "update",
  status: "done",
  startedAt: "2026-09-01T09:00:00.000Z",
  endedAt: "2026-09-01T09:05:00.000Z",
  stages: [{ id: "codegraph", status: "done" }],
  ...over,
});

function deps(over: Partial<TaskHubDeps>): TaskHubDeps {
  return {
    root: "/r",
    listTrees: () =>
      [
        {
          id: "tree-1",
          title: "重构登录模块",
          activeBranch: "main",
          branchCount: 3,
          nodeCount: 9,
          updatedAt: "2026-09-01T11:00:00.000Z",
          sessionIds: ["s1", "s2"],
          archived: false,
        },
        {
          id: "tree-old",
          title: "老树",
          activeBranch: "main",
          branchCount: 1,
          nodeCount: 2,
          updatedAt: "2026-08-01T11:00:00.000Z",
          sessionIds: [],
          archived: true,
        },
      ] as never,
    listReviews: () => [
      review({}),
      review({
        id: "review-warn",
        generatedAt: "2026-09-01T12:00:00.000Z",
        status: "completed_with_warnings",
        scopeLabel: "未提交变更",
      }),
    ],
    listDesigns: () => [{ id: "d1", title: "登录页原型", pipeline: "openui", updatedAt: "2026-09-01T08:00:00.000Z" }],
    listJobs: () => [job({})],
    ...over,
  };
}

test("task-hub: aggregates four domains, sorted desc within each", () => {
  const hub = buildTaskHub(deps({}));
  assert.equal(hub.root, "/r");
  assert.deepEqual(
    hub.groups.map((g) => g.domain),
    ["session", "index", "review", "prototype"]
  );
  assert.equal(taskHubCount(hub), 2 + 1 + 2 + 1);
  const reviews = hub.groups.find((g) => g.domain === "review")!.nodes;
  // warn report (12:00) sorts ABOVE the 10:00 one.
  assert.equal(reviews[0].id, "review-warn");
  assert.equal(reviews[0].status, "warning");
  assert.equal(reviews[0].meta?.scopeLabel, "未提交变更");
  // session trees: non-archived first by recency; archived keeps its status.
  const sessions = hub.groups.find((g) => g.domain === "session")!.nodes;
  assert.equal(sessions[0].id, "tree-1");
  assert.equal(sessions[0].status, "done");
  assert.equal(sessions[1].id, "tree-old");
  assert.equal(sessions[1].status, "archived");
});

test("task-hub: review error mapping and index job failure", () => {
  const hub = buildTaskHub(
    deps({
      listReviews: () => [review({ status: "completed_with_errors" })],
      listJobs: () => [job({ status: "error", error: "wiki stage failed" })],
    })
  );
  assert.equal(hub.groups.find((g) => g.domain === "review")!.nodes[0].status, "error");
  const idx = hub.groups.find((g) => g.domain === "index")!.nodes[0];
  assert.equal(idx.status, "error");
  assert.equal(idx.meta?.error, "wiki stage failed");
});

test("task-hub: per-domain fail-open — a broken reader costs only its domain", () => {
  const hub = buildTaskHub(
    deps({
      listTrees: () => {
        throw new Error("corrupt tree");
      },
      listDesigns: () => {
        throw new Error("design store boom");
      },
    })
  );
  assert.equal(hub.groups.find((g) => g.domain === "session")!.nodes.length, 0);
  assert.equal(hub.groups.find((g) => g.domain === "prototype")!.nodes.length, 0);
  // The healthy domains still list.
  assert.equal(hub.groups.find((g) => g.domain === "review")!.nodes.length, 2);
  assert.equal(hub.groups.find((g) => g.domain === "index")!.nodes.length, 1);
});

// ── plain conversation capture (user ask 2026-09-03, GVGL case) ──────────────
test("task-hub: unbound sessions list as chat nodes interleaved by recency", () => {
  const hub = buildTaskHub(
    deps({
      listChats: () => [
        { id: "chat-new", title: "帮我修登录 bug", status: "completed", updatedAt: "2026-09-02T10:00:00.000Z" },
        { id: "chat-mid", title: "解释一下 GVGL 渲染", status: "processing", updatedAt: "2026-08-15T10:00:00.000Z" },
        { id: "chat-old", title: "PONG", status: "failed", updatedAt: "2026-07-01T10:00:00.000Z" },
      ],
    })
  );
  const session = hub.groups.find((g) => g.domain === "session")!.nodes;
  assert.equal(session.length, 5, "2 trees + 3 chats");
  // Recency interleave: tree-1 (09-01) sits between chat-new (09-02) and chat-mid (08-15);
  // the archived tree-old (08-01) lands above only chat-old (07-01).
  assert.deepEqual(
    session.map((n) => n.id),
    ["chat-new", "tree-1", "chat-mid", "tree-old", "chat-old"]
  );
  const chat = session.find((n) => n.id === "chat-mid")!;
  assert.equal(chat.source.kind, "session-chat");
  assert.equal(chat.status, "running", "processing maps to running");
  assert.equal(session.find((n) => n.id === "chat-old")!.status, "error", "failed maps to error");
});

test("task-hub: chat reader failure is fail-open (trees still list)", () => {
  const hub = buildTaskHub(
    deps({
      listChats: () => {
        throw new Error("sessions-index unreadable");
      },
    })
  );
  const session = hub.groups.find((g) => g.domain === "session")!.nodes;
  assert.equal(session.length, 2, "only the trees list");
});
