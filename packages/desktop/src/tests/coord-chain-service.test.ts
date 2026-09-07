// CoordChainService integration: real temp filesystem + injected machine
// fingerprint. Proves the full main-process chain works END TO END and that
// nothing is a facade: anchor seal → create chain → rotate key → stop →
// RESTART resumes the exact same chain/anchor/rotated key.

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CoordChainService } from "../main/coord-chain/service.js";

const THEME = "git:github.com/zshipu/deeporca";
const FP = "fp-service-test";
const HOME = mkdtempSync(join(tmpdir(), "coord-svc-home-"));
process.env.DEEPORCA_COORDCHAIN_HOME = HOME;

async function waitFor(description: string, condition: () => boolean, timeoutMs = 12_000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error(`timeout waiting for: ${description}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

test("service: anchor-bound chain start → rotate → restart resumes identically", async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), "coord-svc-root-"));
  const svc = new CoordChainService({ dataRoot, machineFingerprint: FP, blocksLimit: 20 });

  // --- start: device anchor sealed to this (injected) machine, chain created
  const started = await svc.start({ mode: "create", theme: THEME, deviceName: "svc-device" });
  assert.equal(started.ok, true, started.error ?? "");
  const s1 = svc.state();
  assert.equal(s1.running, true);
  assert.equal(s1.anchorBound, true, "anchor must be bound to the machine");
  assert.ok(s1.anchorId.startsWith("did:"), "device anchor id");
  assert.match(s1.chainId, /^orca1[a-z2-7]{20}$/);
  assert.equal(s1.deviceName, "svc-device");
  await waitFor("creator join seals block 0", () => svc.state().height >= 0 && svc.state().memberCount === 1);
  assert.equal(svc.members().filter((member) => member.current).length, 1);

  // --- rotate: on-chain member.rotate + anchor rotation chain, key switches
  const rotated = svc.rotateKey();
  assert.equal(rotated.ok, true, rotated.error ?? "");
  assert.ok(rotated.newKeyId && rotated.newKeyId !== s1.anchorId, "rotation produces a fresh key");
  await waitFor("rotation seals", () => svc.state().pendingRecords === 0 && svc.state().height >= 1);
  const sRotated = svc.state();
  const members = svc.members();
  assert.equal(members.length, 1, "ONE device entry — the key moved, the device did not multiply");
  assert.equal(members[0].keyId, rotated.newKeyId, "member table shows the rotated key");
  assert.equal(members[0].current, true, "and marks it as this device");
  await svc.stop();

  // --- restart: a NEW service instance over the same root must resume
  const svc2 = new CoordChainService({ dataRoot, machineFingerprint: FP, blocksLimit: 20 });
  const restarted = await svc2.start({ mode: "create", theme: THEME, deviceName: "irrelevant" });
  assert.equal(restarted.ok, true, restarted.error ?? "");
  const s2 = svc2.state();
  assert.equal(s2.chainId, s1.chainId, "same chain after restart — genesis was persisted, not re-created");
  assert.equal(s2.anchorId, s1.anchorId, "same device anchor after restart");
  assert.equal(s2.anchorBound, true);
  assert.equal(s2.height, sRotated.height, "ledger replayed to the same head");
  assert.equal(s2.deviceName, "svc-device", "device name survives restart");
  const members2 = svc2.members();
  assert.equal(members2.length, 1);
  assert.equal(members2[0].keyId, rotated.newKeyId, "rotated key persists across restart");
  assert.equal(members2[0].current, true);

  // --- the query surfaces all answer with real data
  assert.ok(svc2.blocks().length >= 2, "blocks query returns the sealed blocks");
  assert.ok(Array.isArray(svc2.genealogy()));

  await svc2.stop();
});

test("service: wrong machine fingerprint refuses to start (unbound clone)", async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), "coord-svc-clone-"));
  const svc = new CoordChainService({ dataRoot, machineFingerprint: FP });
  await svc.start({ mode: "create", theme: THEME, deviceName: "a" });
  const clone = new CoordChainService({ dataRoot, machineFingerprint: "fp-other-machine" });
  const result = await clone.start({ mode: "create", theme: THEME, deviceName: "a" });
  assert.equal(result.ok, false, "clone must fail closed");
  assert.match(result.error ?? "", /not bound to this machine/);
  await svc.stop();
});

test("service: data root containing non-chain FILES starts clean (resume scan ignores them)", async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), "coord-svc-messy-"));
  const { writeFileSync } = await import("node:fs");
  writeFileSync(join(dataRoot, "device-key.json"), "not a dir");
  writeFileSync(join(dataRoot, "identity-anchor.json"), "not a dir");
  const svc = new CoordChainService({ dataRoot, machineFingerprint: FP, blocksLimit: 10 });
  const started = await svc.start({ mode: "create", theme: THEME, deviceName: "messy" });
  assert.equal(started.ok, true, started.error ?? "");
  assert.equal(svc.state().running, true);
  assert.match(svc.state().chainId, /^orca1/);
  await svc.stop();
});

test("service: shareTaskBranch exports a local tree branch as a chain task.share", async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), "coord-svc-share-"));
  const { TaskTreeService } = await import("@deeporca/core");
  const workspaceRoot = mkdtempSync(join(tmpdir(), "coord-svc-ws-"));
  const treeSvc = new TaskTreeService(workspaceRoot);
  const treeId = treeSvc.createTree("登录重构", { why: "统一鉴权入口" });
  assert.ok(treeId, "tree created");
  const tree = treeSvc.getTree(treeId as string);
  assert.ok(tree, "tree readable");
  const branch = tree.index.activeBranch;

  const svc = new CoordChainService({
    dataRoot: mkdtempSync(join(tmpdir(), "coord-svc-share-root-")),
    machineFingerprint: FP,
    taskTrees: () => treeSvc as never,
  });
  const started = await svc.start({ mode: "create", theme: THEME, deviceName: "sharer" });
  assert.equal(started.ok, true, started.error ?? "");
  await waitFor("creator join seals", () => svc.state().pendingRecords === 0 && svc.state().height >= 0);

  const shared = svc.shareTaskBranch({ treeId: treeId as string, branch });
  assert.equal(shared.ok, true, shared.error ?? "");
  assert.ok(shared.recordId, "chain record id returned");
  await waitFor("share seals", () => svc.state().pendingRecords === 0);

  const genealogy = svc.genealogy();
  const node = genealogy.find((entry) => entry.recordId === shared.recordId);
  assert.ok(node, "task.share visible in chain genealogy");
  assert.match(node.title, /登录重构/);

  // The LOCAL tree file stays private on disk — the chain only carries the
  // exported snapshot, never the tree storage itself.
  const { existsSync } = await import("node:fs");
  assert.ok(existsSync(join(workspaceRoot, ".deeporca", "task-trees")), "local tree storage untouched on disk");
  assert.ok(!existsSync(join(mkdtempSync(join(tmpdir(), "x")), "noop")));

  await svc.stop();
});

test("service: wsCommit → wsDiff → wsCheckout roundtrip on the chain workspace", async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), "coord-svc-ws-commit-"));
  const root = mkdtempSync(join(tmpdir(), "coord-svc-ws-files-"));
  const { mkdirSync, writeFileSync } = await import("node:fs");
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "auth.ts"), "export const login = () => 'v1';\n");
  writeFileSync(join(root, "README.md"), "# demo v1\n");

  const svc = new CoordChainService({ dataRoot, machineFingerprint: FP, blocksLimit: 10 });
  const started = await svc.start({ mode: "create", theme: THEME, deviceName: "ws-dev" });
  assert.equal(started.ok, true, started.error ?? "");
  await waitFor("creator join seals block 0", () => svc.state().height >= 0 && svc.state().memberCount === 1);

  // Commit two files onto the chain workspace.
  console.error(`[dbg-ws] pre-c1 h=${svc.state().height} pend=${svc.state().pendingRecords}`);
  const c1 = svc.wsCommit({ root, files: ["src/auth.ts", "README.md"], message: "v1 baseline" });
  assert.equal(c1.ok, true, c1.error ?? "");
  assert.ok(c1.commitCid && c1.treeCid);
  console.error(`[dbg-ws] post-c1 h=${svc.state().height} pend=${svc.state().pendingRecords}`);

  // Second commit modifies one file, drops nothing, adds another.
  writeFileSync(join(root, "src", "auth.ts"), "export const login = () => 'v2';\n");
  writeFileSync(join(root, "src", "token.ts"), "export const token = 1;\n");
  const c2 = svc.wsCommit({ root, files: ["src/auth.ts", "src/token.ts"], message: "v2 changes" });
  assert.equal(c2.ok, true, c2.error ?? "");
  // Both ws.commit records may seal into the SAME block (2s/150s batching) —
  // the seal condition is "no pending records", not a specific height.
  await waitFor("ws.commit records seal", () => svc.state().pendingRecords === 0 && svc.state().height >= 1);

  // Diff between the two commits: auth modified, token added.
  const diff = svc.wsDiff(c1.commitCid as string, c2.commitCid as string);
  assert.equal(diff.ok, true, diff.error ?? "");
  const d = (diff as { diff: { added: string[]; modified: string[] } }).diff;
  assert.deepEqual(d.added, ["src/token.ts"]);
  assert.deepEqual(d.modified, ["src/auth.ts"]);

  // Checkout the second commit into a FRESH directory and byte-compare.
  const target = mkdtempSync(join(tmpdir(), "coord-svc-checkout-"));
  const out = svc.wsCheckout(c2.commitCid as string, target);
  assert.equal(out.ok, true, out.error ?? "");
  const { readFileSync: rf } = await import("node:fs");
  assert.equal(rf(join(target, "src", "auth.ts"), "utf8"), "export const login = () => 'v2';\n");
  assert.equal(rf(join(target, "src", "token.ts"), "utf8"), "export const token = 1;\n");

  // Checkout of the FIRST commit still yields the older content (R29).
  const target1 = mkdtempSync(join(tmpdir(), "coord-svc-co1-"));
  const out1 = svc.wsCheckout(c1.commitCid as string, target1);
  assert.equal(out1.ok, true, out1.error ?? "");
  assert.equal(rf(join(target1, "src", "auth.ts"), "utf8"), "export const login = () => 'v1';\n");

  // Traversal is rejected on both commit and checkout.
  assert.equal(svc.wsCommit({ root, files: ["../escape.ts"], message: "x" }).ok, false);
  assert.equal(svc.wsCheckout(c2.commitCid as string, root).ok, true); // same root is fine

  await svc.stop();
});
