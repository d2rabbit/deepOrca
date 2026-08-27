import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  type Block,
  LedgerView,
  buildBlock,
  buildCommit,
  buildSignedRecord,
  commitCidOf,
  generateDeviceIdentity,
  merkleRoot,
  rebuildView,
} from "../index.js";

const BASE_TS = 1_800_000_000_000;

interface Harness {
  author: ReturnType<typeof generateDeviceIdentity>;
  helper: ReturnType<typeof generateDeviceIdentity>;
  blocks: Block[];
}

/** Assemble records into unsigned (approval-free) blocks — the view does not re-verify signatures. */
function makeHarness(): Harness {
  const author = generateDeviceIdentity();
  const helper = generateDeviceIdentity();
  const record = (
    type: Parameters<typeof buildSignedRecord>[1]["type"],
    body: Record<string, unknown>,
    by: typeof author,
    ts: number
  ) => buildSignedRecord(by, { type, ts, author: by.keyId, body: body as never });

  const block0Records = [
    record("member.join", { deviceName: "alpha", pubKey: author.publicKeyBase64 }, author, BASE_TS - 20),
    record("member.join", { deviceName: "beta", pubKey: helper.publicKeyBase64 }, helper, BASE_TS - 10),
  ];
  const block0 = buildBlock({
    height: 0,
    prevBlockHash: "0".repeat(64),
    ts: BASE_TS,
    proposer: author.keyId,
    records: block0Records,
  });

  const taskShare = record(
    "task.share",
    {
      title: "登录重构",
      goal: "换鉴权中间件",
      trajectory: "…",
      filesTouched: ["src/auth.ts"],
      conclusion: "完成",
      leftovers: ["文档"],
    },
    author,
    BASE_TS + 1000
  );
  const claim = record("task.claim", { taskId: taskShare.recordId, note: "b 认领" }, helper, BASE_TS + 2000);
  const progress = record("task.progress", { taskId: taskShare.recordId, percent: 40 }, helper, BASE_TS + 3000);
  const done = record("task.done", { taskId: taskShare.recordId }, author, BASE_TS + 4000);
  const block1 = buildBlock({
    height: 1,
    prevBlockHash: "1".repeat(64),
    ts: BASE_TS + 5000,
    proposer: helper.keyId,
    records: [taskShare, claim, progress, done],
  });

  const assetPublish = record(
    "asset.publish",
    { cid: "aa".repeat(16), name: "需求文档.md", mime: "text/markdown", size: 2048, kind: "requirement" },
    author,
    BASE_TS + 6000
  );
  const revoke = record("asset.revoke", { cid: "aa".repeat(16), reason: "含敏感信息" }, author, BASE_TS + 7000);
  const asset2 = record(
    "asset.publish",
    { cid: "bb".repeat(16), name: "架构图.png", mime: "image/png", size: 4096, kind: "architecture" },
    helper,
    BASE_TS + 7500
  );
  const block2 = buildBlock({
    height: 2,
    prevBlockHash: "2".repeat(64),
    ts: BASE_TS + 8000,
    proposer: author.keyId,
    records: [assetPublish, revoke, asset2],
  });

  const wsCommitBody = { treeCid: "cc".repeat(16), parents: [], message: "重构提交", taskRef: taskShare.recordId };
  const commitObject = buildCommit(author, {
    treeCid: wsCommitBody.treeCid,
    parents: [],
    message: wsCommitBody.message,
    ts: BASE_TS + 9000,
    taskRef: taskShare.recordId,
  });
  const block3 = buildBlock({
    height: 3,
    prevBlockHash: "3".repeat(64),
    ts: BASE_TS + 9500,
    proposer: helper.keyId,
    records: [record("ws.commit", wsCommitBody, author, BASE_TS + 9000)],
  });

  return { author, helper, blocks: [block0, block1, block2, block3] };
}

test("view: members, task LWW, revoke filter and commit reconstruction", () => {
  const { author, blocks } = makeHarness();
  const view = new LedgerView(":memory:");
  for (const block of blocks) {
    view.applyBlock(block);
  }

  assert.equal(view.listMembers().length, 2);

  // Task lifecycle lands on the LWW state: done after claim/progress.
  const tasks = view.listTasks();
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].status, "done");
  assert.equal(tasks[0].percent, 40);

  // asset.revoke filters the view (ledger keeps the record; R13).
  const assets = view.listAssets();
  assert.equal(assets.length, 1);
  assert.equal(assets[0].name, "架构图.png");
  const all = view.listAssets(true);
  assert.equal(all.length, 2);
  assert.equal(all.find((asset) => asset.name === "需求文档.md")?.revoked, 1);

  // The view recomputes the same commitCid the ws/ object model would.
  const commits = view.listCommits();
  assert.equal(commits.length, 1);
  const wsRecord = blocks[3].records[0];
  const expectedCid = commitCidOf({
    version: 1,
    treeCid: (wsRecord.body as unknown as { treeCid: string }).treeCid,
    parents: [],
    message: (wsRecord.body as unknown as { message: string }).message,
    author: author.keyId,
    ts: wsRecord.ts,
    taskRef: (wsRecord.body as unknown as { taskRef: string }).taskRef,
  });
  assert.equal(commits[0].commit_cid, expectedCid);
  // ...and building the real signed commit object from the same fields matches too.
  const mirror = buildCommit(author, {
    treeCid: (wsRecord.body as unknown as { treeCid: string }).treeCid,
    parents: [],
    message: (wsRecord.body as unknown as { message: string }).message,
    ts: wsRecord.ts,
    taskRef: (wsRecord.body as unknown as { taskRef: string }).taskRef,
  });
  assert.equal(mirror.commitCid, expectedCid);

  view.close();
});

test("view: applyBlock is idempotent and rebuild reproduces the same content", () => {
  const { blocks } = makeHarness();
  const view = new LedgerView(":memory:");
  for (const block of blocks) {
    view.applyBlock(block);
    view.applyBlock(block); // double application must be a no-op
  }
  assert.equal(view.listRecords().length, 2 + 4 + 3 + 1);

  const dbPath = join(mkdtempSync(join(tmpdir(), "ledger-view-")), "view.db");
  const rebuilt = rebuildView(dbPath, blocks);
  assert.deepEqual(
    rebuilt.listRecords().map((row) => row.record_id),
    view.listRecords().map((row) => row.record_id)
  );
  assert.deepEqual(rebuilt.listTasks(), view.listTasks());
  assert.deepEqual(rebuilt.listAssets(true), view.listAssets(true));

  // Blocks page newest-first for the panel's chain browser.
  const page = rebuilt.listBlocks(0, 2);
  assert.deepEqual(
    page.map((row) => row.height),
    [3, 2]
  );
  assert.deepEqual(
    rebuilt.listBlocks(2, 10).map((row) => row.height),
    [1, 0]
  );

  rebuilt.close();
  view.close();
});

test("view: stale task updates lose the LWW race", () => {
  const author = generateDeviceIdentity();
  const helper = generateDeviceIdentity();
  const record = (
    type: Parameters<typeof buildSignedRecord>[1]["type"],
    body: Record<string, unknown>,
    by: typeof author,
    ts: number
  ) => buildSignedRecord(by, { type, ts, author: by.keyId, body: body as never });
  const share = record(
    "task.share",
    { title: "t", goal: "g", trajectory: "", filesTouched: [], conclusion: "", leftovers: [] },
    author,
    1000
  );
  const doneAt5000 = record("task.done", { taskId: share.recordId }, author, 5000);
  const staleClaim = record("task.claim", { taskId: share.recordId }, helper, 2000);
  const blockA = buildBlock({
    height: 0,
    prevBlockHash: "0".repeat(64),
    ts: 6000,
    proposer: author.keyId,
    records: [share, doneAt5000],
  });
  const blockB = buildBlock({
    height: 1,
    prevBlockHash: "1".repeat(64),
    ts: 6500,
    proposer: helper.keyId,
    records: [staleClaim],
  });
  // merkle roots must line up with their own records even in this ad-hoc chain
  blockA.merkleRoot = merkleRoot(blockA.records.map((r) => r.recordId));
  blockB.merkleRoot = merkleRoot(blockB.records.map((r) => r.recordId));

  const view = new LedgerView(":memory:");
  view.applyBlock(blockA);
  view.applyBlock(blockB);
  const task = view.listTasks()[0];
  assert.equal(task.status, "done");
  assert.equal(task.head_record_id, doneAt5000.recordId);
  view.close();
});
