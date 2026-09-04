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
import { AnchorError, createIdentityAnchor, generateDeviceIdentity } from "@deeporca/ledger";
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

test("coord-chain e2e: device key rotation migrates the member and keeps signing", async () => {
  const identityA = generateDeviceIdentity();
  const identityB = generateDeviceIdentity();
  const rootA = newRoot();
  const rootB = newRoot();
  const nodeA = new ChainNode({
    identity: identityA,
    deviceName: "alpha",
    theme: THEME,
    mode: "create",
    dataRoot: rootA,
    blockIntervalMs: 120,
  });
  await nodeA.start();
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
  await waitFor("B joins", () => nodeB.isMember && nodeA.height >= 1);

  // A rotates its signing key on chain.
  const { newIdentity } = nodeA.rotateDeviceKey();
  assert.notEqual(newIdentity.keyId, identityA.keyId);

  // The rotate block seals; B's member table migrates the entry to the new key.
  let lastDump = 0;
  try {
    await waitFor(
      "B sees the rotated member entry",
      () => {
        const member = (nodeB.ledgerView?.listMembers() ?? []).find((row) => row.key_id === newIdentity.keyId);
        if (!member && Date.now() - lastDump > 2000) {
          lastDump = Date.now();
          console.error(
            `[dbg] B h=${nodeB.height} A h=${nodeA.height} members=${JSON.stringify(nodeB.ledgerView?.listMembers() ?? [])}`
          );
        }
        return member !== undefined && Boolean(member);
      },
      15_000
    );
  } catch (error) {
    console.error(
      `[dbg] FINAL A h=${nodeA.height} B h=${nodeB.height} blockRows=${JSON.stringify((nodeB.ledgerView?.listBlocks(0, 10) ?? []).map((b) => b.height))}`
    );
    throw error;
  }
  const migrated = (nodeB.ledgerView?.listMembers() ?? []).find((row) => row.key_id === newIdentity.keyId);
  assert.equal(migrated?.device_name, "alpha", "the DEVICE entry continues, only the key moved");
  const oldEntry = (nodeB.ledgerView?.listMembers() ?? []).find((row) => row.key_id === identityA.keyId);
  assert.equal(oldEntry, undefined, "the old key id is gone from the member table");

  // A signs with the NEW key and B verifies the resulting block/record.
  nodeA.submitRecord("note", { text: "signed with rotated key" });
  await waitFor(
    "B seals the post-rotation note",
    () =>
      nodeB.height >= (nodeA.height >= 0 ? nodeA.height : 0) &&
      (nodeB.ledgerView?.listRecords("note") ?? []).some(
        (row) => JSON.parse(row.body_json).text === "signed with rotated key"
      ),
    15_000
  );
  const note = (nodeB.ledgerView?.listRecords("note") ?? []).find(
    (row) => JSON.parse(row.body_json).text === "signed with rotated key"
  );
  assert.equal(note?.author, newIdentity.keyId, "record author is the rotated key");

  // Second rotation: the pubkey timeline moves again and the device keeps
  // working — the rotation chain is reusable, not a one-shot. Must wait for
  // the PREVIOUS rotation to seal on A too (quorum = both members), otherwise
  // A's member table still carries the key we are rotating FROM.
  await waitFor(
    "first rotation sealed on A",
    () => (nodeA.ledgerView?.listMembers() ?? []).some((row) => row.key_id === newIdentity.keyId),
    15_000
  );
  const second = nodeA.rotateDeviceKey();
  await waitFor(
    "B sees the second rotated entry",
    () => (nodeB.ledgerView?.listMembers() ?? []).some((row) => row.key_id === second.newIdentity.keyId),
    15_000
  );
  const membersAfter2 = nodeB.ledgerView?.listMembers() ?? [];
  // Two DEVICES on the chain (alpha + beta); alpha's entry moved to the
  // second rotated key, beta's is untouched.
  assert.equal(membersAfter2.length, 2, "two device entries after two rotations");
  const alphaEntry = membersAfter2.find((row) => row.key_id === second.newIdentity.keyId);
  assert.ok(alphaEntry, "alpha moved to the second rotated key");
  const betaEntry = membersAfter2.find((row) => row.device_name === "beta");
  assert.ok(betaEntry, "beta untouched");
  assert.equal(
    membersAfter2.some((row) => row.key_id === newIdentity.keyId),
    false,
    "first rotated key is gone"
  );
  nodeA.submitRecord("note", { text: "after second rotation" });
  await waitFor(
    "B seals the second-rotation note",
    () =>
      (nodeB.ledgerView?.listRecords("note") ?? []).some(
        (row) => JSON.parse(row.body_json).text === "after second rotation"
      ),
    15_000
  );
  const note2 = (nodeB.ledgerView?.listRecords("note") ?? []).find(
    (row) => JSON.parse(row.body_json).text === "after second rotation"
  );
  assert.equal(note2?.author, second.newIdentity.keyId, "second rotation key signs");

  await nodeB.stop();
  await nodeA.stop();
});

test("anchor: resume cannot bypass the hardware binding; bound resume reopens the same chain", async () => {
  const fp = "fp-bound-device";
  const seedIdentity = generateDeviceIdentity();
  const anchor = createIdentityAnchor({
    deviceName: "alpha",
    fingerprint: fp,
    identity: seedIdentity,
    createdAt: "2026-09-04T00:00:00.000Z",
  });
  const root = newRoot();

  // First run: bound create, chain seals block 0.
  const first = new ChainNode({
    identity: seedIdentity,
    deviceName: "alpha",
    theme: THEME,
    mode: "create",
    dataRoot: root,
    anchor,
    machineFingerprint: fp,
    blockIntervalMs: 120,
  });
  await first.start();
  await waitFor("block 0 seals", () => first.height >= 0 && first.isMember);
  const chainId = first.chainIdValue;
  await first.stop();

  // Unbound clone over the SAME data root must be refused at the anchor check —
  // before it can resume anything.
  const clone = new ChainNode({
    identity: seedIdentity,
    deviceName: "alpha",
    theme: THEME,
    mode: "create",
    dataRoot: root,
    anchor,
    machineFingerprint: "fp-other-machine",
  });
  await assert.rejects(
    clone.start(),
    (error: unknown) => error instanceof AnchorError && /not bound to this machine/.test((error as Error).message)
  );
  assert.equal(clone.chainIdValue, "", "clone never resumed the chain");

  // Bound restart resumes the exact same chain from the persisted genesis.
  const resumed = new ChainNode({
    identity: seedIdentity,
    deviceName: "alpha",
    theme: THEME,
    mode: "join",
    joinUrl: "ws://127.0.0.1:1",
    dataRoot: root,
    anchor,
    machineFingerprint: fp,
    blockIntervalMs: 120,
  });
  await resumed.start();
  assert.equal(resumed.chainIdValue, chainId, "resume restores the same chain id");
  assert.equal(resumed.height, first.height, "ledger replayed to the same head");
  assert.equal(resumed.isMember, true);
  await resumed.stop();
});
