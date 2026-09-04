// Two-node loopback e2e (OC2 task 13, automated slice):
//   A creates a chain → B joins via ws → member.join finalizes →
//   both directions of record gossip finalize → asset publish on A,
//   manifest+chunk fetch on A with per-chunk verification →
//   reconnect: a fresh node instance with B's identity resyncs and keeps up.
//
// Runs two full ChainNodes over a real ws loopback with the handshake +
// AES-GCM channel from @deeporca/ledger. Each node gets its own data root to
// simulate two machines (the real deployment has one node per chain per
// machine, sharing the directory).

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { generateDeviceIdentity } from "@deeporca/ledger";
import { ChainNode } from "../main/coord-chain/node.js";

const THEME = "git:github.com/zshipu/deeporca";

function newRoot(): string {
  return mkdtempSync(join(tmpdir(), "coord-chain-e2e-"));
}

async function waitFor(description: string, condition: () => boolean, timeoutMs = 20_000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error(`timeout waiting for: ${description}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

test("coord-chain e2e: create → join → gossip → asset fetch → reconnect", async () => {
  const identityA = generateDeviceIdentity();
  const identityB = generateDeviceIdentity();
  const rootA = newRoot();
  const rootB = newRoot();

  // --- A creates the chain; the creator join seals into block 0 immediately.
  const nodeA = new ChainNode({
    identity: identityA,
    deviceName: "alpha",
    theme: THEME,
    mode: "create",
    dataRoot: rootA,
    blockIntervalMs: 120,
  });
  await nodeA.start();
  assert.equal(nodeA.isMember, true, "creator becomes member when block 0 seals");
  assert.match(nodeA.chainIdValue, /^orca1[a-z2-7]{20}$/);

  // --- B joins over ws: handshake → chainInfo → snapshot → replay → join.
  const nodeB = new ChainNode({
    identity: identityB,
    deviceName: "beta",
    theme: THEME,
    mode: "join",
    joinUrl: `ws://127.0.0.1:${nodeA.status().port}`,
    dataRoot: rootB,
    blockIntervalMs: 120,
  });
  await nodeB.start();
  await waitFor("B adopts A's chain", () => nodeB.chainIdValue === nodeA.chainIdValue && nodeB.height >= 0);
  assert.equal(nodeB.height, nodeA.height, "B replays to A's head");
  await waitFor("B's member.join seals", () => nodeB.isMember && nodeA.height >= 1);
  assert.equal(nodeA.height, nodeB.height);
  assert.equal(nodeA.status().memberCount, 2);
  assert.equal(nodeB.status().memberCount, 2);

  // --- Record gossip, A → B.
  nodeA.submitRecord("note", { text: "hello from alpha" });
  await waitFor("B seals A's note", () => nodeB.height >= 2);
  const noteOnB = nodeB.ledgerView?.listRecords("note") ?? [];
  assert.ok(
    noteOnB.some((row) => JSON.parse(row.body_json).text === "hello from alpha"),
    "note visible in B's view"
  );

  // --- Record gossip, B → A (task.share with commitRef-less payload).
  nodeB.submitRecord("task.share", {
    title: "接续任务",
    goal: "验证跨机任务谱系",
    trajectory: "read; edit; test",
    filesTouched: ["src/auth.ts"],
    conclusion: "done",
    leftovers: [],
  });
  await waitFor("A seals B's task.share", () => nodeA.height >= 3);
  const tasksOnA = nodeA.ledgerView?.listTasks() ?? [];
  assert.equal(tasksOnA.length, 1);
  assert.equal(tasksOnA[0].title, "接续任务");
  assert.equal(tasksOnA[0].status, "shared");

  // --- Asset publish on A, manifest + chunk fetch on B (R11/R12).
  const content = new TextEncoder().encode("需求文档内容 ".repeat(2000));
  const { manifestCid } = nodeA.publishAsset(content, { name: "需求.md", mime: "text/markdown", kind: "requirement" });
  await waitFor("B sees the asset record", () =>
    (nodeB.ledgerView?.listAssets() ?? []).some((asset) => asset.cid === manifestCid)
  );
  const fetched = await nodeB.fetchAsset(manifestCid);
  assert.deepEqual(fetched, content, "B reassembles the asset byte-for-byte");

  // --- Reconnect: a fresh node instance with B's identity resyncs and keeps up.
  await nodeB.stop();
  const nodeB2 = new ChainNode({
    identity: identityB,
    deviceName: "beta",
    theme: THEME,
    mode: "join",
    joinUrl: `ws://127.0.0.1:${nodeA.status().port}`,
    dataRoot: newRoot(),
    blockIntervalMs: 120,
  });
  await nodeB2.start();
  await waitFor("B2 resyncs", () => nodeB2.chainIdValue === nodeA.chainIdValue && nodeB2.height === nodeA.height);
  assert.equal(nodeB2.isMember, true, "restart with the same device identity stays a member (no new join)");

  nodeA.submitRecord("note", { text: "after reconnect" });
  await waitFor("B2 keeps up after reconnect", () => nodeB2.height >= nodeA.height && (nodeB2.height ?? 0) >= 4);
  assert.equal(nodeB2.height, nodeA.height);

  await nodeB2.stop();
  await nodeA.stop();
});

test("coord-chain: cross-theme join is refused by the handshake pin", async () => {
  const identityA = generateDeviceIdentity();
  const root = newRoot();
  const nodeA = new ChainNode({
    identity: identityA,
    deviceName: "alpha",
    theme: "git:github.com/zshipu/project-a",
    mode: "create",
    dataRoot: root,
    blockIntervalMs: 100,
  });
  await nodeA.start();
  await waitFor("A seals block 0", () => nodeA.height >= 0);

  const impostor = new ChainNode({
    identity: generateDeviceIdentity(),
    deviceName: "intruder",
    theme: "name:a-different-project",
    mode: "join",
    joinUrl: `ws://127.0.0.1:${nodeA.status().port}`,
    dataRoot: newRoot(),
    blockIntervalMs: 100,
  });
  // The initiator pins its own themeShort; A's responder pins the other —
  // the handshake must fail, so start() rejects instead of adopting.
  await assert.rejects(impostor.start());
  await impostor.stop().catch(() => undefined);
  assert.equal(impostor.chainIdValue, "", "no chain adopted across themes");
  await nodeA.stop();
});
