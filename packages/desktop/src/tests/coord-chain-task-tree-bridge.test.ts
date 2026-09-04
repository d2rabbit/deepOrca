import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { generateDeviceIdentity } from "@deeporca/ledger";
import { ChainNode } from "../main/coord-chain/node.js";
import {
  branchToTaskSharePayload,
  buildChainGenealogy,
  collectBranchSnapshot,
  formatGenealogy,
  type ReflogEntryLike,
  type TaskNodeLike,
} from "../main/coord-chain/task-tree-bridge.js";

const THEME = "git:github.com/zshipu/deeporca";

/** A small tree: root → fork branch-b (with why) → step; branch-b merged into branch-a; branch-c open. */
function sampleTree(): {
  index: Parameters<typeof collectBranchSnapshot>[0];
  nodes: TaskNodeLike[];
  reflog: ReflogEntryLike[];
} {
  const rootNode: TaskNodeLike = {
    id: "n-root",
    parentId: null,
    kind: "root",
    title: "登录重构",
    why: "统一鉴权入口",
    artifactRefs: [],
    status: "done",
  };
  const forkNode: TaskNodeLike = {
    id: "n-fork",
    parentId: "n-root",
    kind: "fork",
    title: "fork branch-b",
    why: "并行验证 passkey 方案",
    artifactRefs: [],
    status: "done",
  };
  const stepNode: TaskNodeLike = {
    id: "n-step",
    parentId: "n-fork",
    kind: "step",
    title: "实现 passkey 中间件",
    why: "",
    artifactRefs: ["src/auth/passkey.ts", "src/auth/middleware.ts", "src/auth/passkey.ts"],
    status: "done",
  };
  const mergeNode: TaskNodeLike = {
    id: "n-merge",
    parentId: "n-step",
    kind: "merge",
    title: "merge ← branch-b",
    why: "",
    artifactRefs: [],
    status: "done",
    meta: { mergeConflicts: [{ artifactRef: "src/auth/middleware.ts", targetTitle: "实现 passkey 中间件" }] },
  };
  const nodes = [rootNode, forkNode, stepNode, mergeNode];
  const reflog: ReflogEntryLike[] = [
    { at: "2026-09-01T09:00:00Z", op: "create", branch: "branch-a" },
    { at: "2026-09-01T09:05:00Z", op: "append", branch: "branch-a", nodeId: "n-root" },
    { at: "2026-09-01T09:06:00Z", op: "fork", branch: "branch-b", nodeId: "n-fork", detail: "并行验证 passkey 方案" },
    { at: "2026-09-01T09:10:00Z", op: "append", branch: "branch-b", nodeId: "n-step" },
    { at: "2026-09-01T09:15:00Z", op: "merge", branch: "branch-b", detail: "merge ← branch-b (n-step)" },
  ];
  const index = {
    id: "tree-1",
    title: "登录重构",
    branches: {
      "branch-a": { name: "branch-a", headId: "n-merge", createdAt: "2026-09-01T09:00:00Z" },
      "branch-b": { name: "branch-b", headId: "n-step", createdAt: "2026-09-01T09:06:00Z", mergedInto: "branch-a" },
      "branch-c": { name: "branch-c", headId: "n-root", createdAt: "2026-09-01T09:07:00Z" },
    },
    activeBranch: "branch-a",
  };
  return { index, nodes, reflog };
}

test("bridge: branch snapshot maps onto a task.share payload with fork/merge story", () => {
  const { index, nodes, reflog } = sampleTree();
  const snapshot = collectBranchSnapshot(index, nodes, reflog, "branch-b");
  assert.equal(snapshot.treeTitle, "登录重构");
  assert.equal(snapshot.head?.id, "n-step");
  // Head ancestry includes the fork node (the fork edge is the story).
  assert.ok(snapshot.nodes.some((node) => node.kind === "fork"));

  const payload = branchToTaskSharePayload(snapshot, { commitRef: "c:abc123" });
  assert.equal(payload.title, "登录重构 · branch-b");
  assert.equal(payload.goal, "并行验证 passkey 方案");
  assert.match(payload.trajectory, /fork×1/);
  assert.match(payload.trajectory, /merge×1/);
  assert.match(payload.trajectory, /fork:branch-b 并行验证 passkey 方案/);
  assert.deepEqual(payload.filesTouched, ["src/auth/middleware.ts", "src/auth/passkey.ts"]);
  assert.match(payload.conclusion, /已并入 branch-a/);
  assert.deepEqual(payload.leftovers, ["branch-c"]);
  assert.equal(payload.commitRef, "c:abc123");

  // The merge TARGET branch carries the conflict report (its lineage owns
  // the merge node); the merged source branch does not.
  const targetSnapshot = collectBranchSnapshot(index, nodes, reflog, "branch-a");
  const targetPayload = branchToTaskSharePayload(targetSnapshot);
  assert.match(targetPayload.conclusion, /src\/auth\/middleware\.ts→实现 passkey 中间件/);
  assert.doesNotMatch(targetPayload.conclusion, /已并入/);
  assert.deepEqual(targetPayload.leftovers, ["branch-c"]);
});

test("bridge: chain task.share records assemble into a fork forest", () => {
  const mk = (recordId: string, parentRecordId: string | undefined, title: string, ts: number) => ({
    recordId,
    ...(parentRecordId !== undefined ? { parentRecordId } : {}),
    title,
    goal: "g",
    conclusion: "done",
    author: "did:aaaaaaaaaaaaaaaa",
    ts,
  });
  const root = mk("r:root", undefined, "主任务", 1000);
  const fork1 = mk("r:fork1", "r:root", "fork passkey", 2000);
  const fork2 = mk("r:fork2", "r:root", "fork 旧中间件", 1500);
  const grandchild = mk("r:gc", "r:fork1", "接续 passkey", 3000);
  const dangling = mk("r:dangling", "r:missing", "上游不在本链", 4000);

  const forest = buildChainGenealogy([grandchild, fork1, fork2, root, dangling]);
  assert.deepEqual(
    forest.roots.map((node) => node.recordId),
    ["r:root", "r:dangling"]
  );
  assert.deepEqual(
    (forest.childrenByParent.get("r:root") ?? []).map((node) => node.recordId),
    ["r:fork2", "r:fork1"]
  );
  assert.deepEqual(
    (forest.childrenByParent.get("r:fork1") ?? []).map((node) => node.recordId),
    ["r:gc"]
  );

  const text = formatGenealogy(forest);
  assert.match(text, /^主任务/);
  assert.match(text, /⑂ fork 旧中间件/);
  assert.match(text, / {4}⑂ 接续 passkey/);
});

test("bridge: ChainNode.submitRecord carries parentRecordId into the ledger view", async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), "coord-bridge-"));
  const node = new ChainNode({
    identity: generateDeviceIdentity(),
    deviceName: "solo",
    theme: THEME,
    mode: "create",
    dataRoot,
    blockIntervalMs: 120,
  });
  await node.start();
  try {
    const parent = node.submitRecord("task.share", {
      title: "主任务",
      goal: "根",
      trajectory: "",
      filesTouched: [],
      conclusion: "done",
      leftovers: [],
    });
    await waitFor(() => node.height >= 1);

    const child = node.submitRecord(
      "task.share",
      {
        title: "fork passkey",
        goal: "并行验证",
        trajectory: "fork×1",
        filesTouched: ["src/auth/passkey.ts"],
        conclusion: "已并入 主任务",
        leftovers: [],
      },
      { parentRecordId: parent.recordId }
    );
    await waitFor(() => node.height >= 2);

    const genealogy = node.taskGenealogy();
    assert.equal(genealogy.length, 2);
    const childRow = genealogy.find((row) => row.recordId === child.recordId);
    assert.equal(childRow?.parentRecordId, parent.recordId, "lineage edge persisted");

    const forest = buildChainGenealogy(genealogy);
    assert.equal(forest.roots.length, 1);
    assert.equal(forest.roots[0].title, "主任务");
    assert.equal((forest.childrenByParent.get(parent.recordId) ?? []).length, 1);
    assert.match(formatGenealogy(forest), /⑂ fork passkey/);
  } finally {
    await node.stop();
  }
});

async function waitFor(condition: () => boolean, timeoutMs = 10_000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("timeout");
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
