import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CHUNK_SIZE,
  type Commit,
  ancestorsOf,
  applyChangesToTree,
  buildBlob,
  buildCommit,
  chunkIdOf,
  commitCidOf,
  diffTrees,
  emptyTree,
  generateDeviceIdentity,
  headsOf,
  isSafeWorkspacePath,
  lwwHead,
  reassembleBlob,
  setTreeEntry,
  treeCidOf,
  verifyCommit,
} from "../index.js";

test("cid: 4MB chunk boundaries and stable chunk ids", () => {
  const data = new Uint8Array(CHUNK_SIZE + 1);
  data[data.length - 1] = 7;
  const { chunks, manifest } = buildBlob(data);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].byteLength, CHUNK_SIZE);
  assert.equal(chunks[1].byteLength, 1);
  assert.deepEqual(
    manifest.chunkIds,
    chunks.map((chunk) => chunkIdOf(chunk))
  );
  // Small payloads still produce exactly one chunk (never an empty list).
  assert.equal(buildBlob(new Uint8Array(0)).chunks.length, 1);
});

test("cid: blob round-trip verifies every chunk and detects corruption", () => {
  const data = new TextEncoder().encode("design doc body ".repeat(1000));
  const { manifest, chunks } = buildBlob(data);
  const store = new Map(manifest.chunkIds.map((id, i) => [id, chunks[i]]));

  const ok = reassembleBlob(manifest, (id) => store.get(id));
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.deepEqual(ok.data, data);
  }

  const missing = reassembleBlob(manifest, () => undefined);
  assert.equal(missing.ok, false);
  if (!missing.ok) {
    assert.deepEqual(missing.missing, manifest.chunkIds);
  }

  const corrupted = new Uint8Array(chunks[0]);
  corrupted[0] ^= 0xff;
  const corrupt = reassembleBlob(manifest, (id) => (id === manifest.chunkIds[0] ? corrupted : store.get(id)));
  assert.equal(corrupt.ok, false);
  if (!corrupt.ok) {
    assert.deepEqual(corrupt.corrupt, [manifest.chunkIds[0]]);
  }
});

test("cid: identical content hashes to one manifest cid (cross-commit dedup)", () => {
  const blobA = buildBlob(new TextEncoder().encode("architecture sketch v2"));
  const blobB = buildBlob(new TextEncoder().encode("architecture sketch v2"));
  assert.equal(blobA.manifestCid, blobB.manifestCid);
  assert.notEqual(blobA.manifestCid, buildBlob(new TextEncoder().encode("architecture sketch v3")).manifestCid);
});

test("ws tree: set/remove, deterministic treeCid, change-set overlay", () => {
  const entry = { blob: "aa".repeat(16), mode: "100644" as const };
  const tree = setTreeEntry(setTreeEntry(emptyTree(), "src/main.ts", entry), "README.md", entry);
  assert.equal(treeCidOf(tree), treeCidOf({ version: 1, entries: { ...tree.entries } }));
  assert.notEqual(treeCidOf(tree), treeCidOf(setTreeEntry(tree, "src/other.ts", entry)));

  const overlay = applyChangesToTree(tree, { "README.md": null, "src/auth.ts": entry });
  assert.equal(overlay.entries["README.md"], undefined);
  assert.deepEqual(overlay.entries["src/auth.ts"], entry);
});

test("ws tree: unsafe paths rejected (absolute, traversal, empty segments)", () => {
  assert.equal(isSafeWorkspacePath("src/auth.ts"), true);
  assert.equal(isSafeWorkspacePath("/etc/passwd"), false);
  assert.equal(isSafeWorkspacePath("../secrets.json"), false);
  assert.equal(isSafeWorkspacePath("src//main.ts"), false);
  assert.equal(isSafeWorkspacePath(""), false);
  assert.equal(isSafeWorkspacePath("a/./b"), false);
  assert.throws(() => setTreeEntry(emptyTree(), "../escape", { blob: "x", mode: "100644" }));
});

test("ws diff: added/removed/modified/renamed/unchanged", () => {
  const baseFile = { blob: "aa".repeat(16), mode: "100644" as const };
  const oldTree = setTreeEntry(
    setTreeEntry(setTreeEntry(emptyTree(), "kept.ts", baseFile), "edited.ts", baseFile),
    "moved.ts",
    {
      blob: "bb".repeat(16),
      mode: "100644",
    }
  );
  const newTree = setTreeEntry(
    setTreeEntry(setTreeEntry(emptyTree(), "kept.ts", baseFile), "edited.ts", {
      blob: "cc".repeat(16),
      mode: "100644",
    }),
    "renamed.ts",
    { blob: "bb".repeat(16), mode: "100644" }
  );
  newTree.entries["added.ts"] = { blob: "dd".repeat(16), mode: "100644" };

  const diff = diffTrees(oldTree, newTree);
  assert.deepEqual(diff.added, ["added.ts"]);
  assert.deepEqual(diff.modified, ["edited.ts"]);
  assert.deepEqual(diff.renamed, [{ from: "moved.ts", to: "renamed.ts" }]);
  assert.equal(diff.unchanged, 1);
  assert.equal(diff.removed.length, 0);

  const removal = diffTrees(newTree, null);
  assert.equal(removal.removed.length, Object.keys(newTree.entries).length);
});

test("ws commit: sign/verify, tamper fails, taskRef changes the commit id", () => {
  const author = generateDeviceIdentity();
  const base = { treeCid: treeCidOf(emptyTree()), parents: [], message: "init", ts: 1000 };
  const commit = buildCommit(author, base);
  assert.equal(verifyCommit(commit, author.publicKeyBase64).ok, true);
  assert.equal(commitCidOf(commit), commit.commitCid);

  const tampered = { ...commit, message: "evil" };
  assert.equal(verifyCommit(tampered, author.publicKeyBase64).ok, false);

  const withRef = buildCommit(author, { ...base, taskRef: "r:task1" });
  assert.notEqual(withRef.commitCid, commit.commitCid);
  assert.equal(verifyCommit(withRef, author.publicKeyBase64).ok, true);
});

test("ws lineage: heads, ancestors and LWW default head over forks", () => {
  const author = generateDeviceIdentity();
  const c0 = buildCommit(author, { treeCid: "t0", parents: [], message: "c0", ts: 1000 });
  const c1 = buildCommit(author, { treeCid: "t1", parents: [c0.commitCid], message: "c1", ts: 2000 });
  // Fork: two children of c1 (parallel members; v1 keeps both, no merge).
  const c2 = buildCommit(author, { treeCid: "t2", parents: [c1.commitCid], message: "c2", ts: 3000 });
  const c3 = buildCommit(author, { treeCid: "t3", parents: [c1.commitCid], message: "c3", ts: 3500 });
  const commits: Commit[] = [c0, c1, c2, c3];
  const byCid = new Map(commits.map((commit) => [commit.commitCid, commit]));

  assert.deepEqual(headsOf(commits).sort(), [c2.commitCid, c3.commitCid].sort());
  const lineage = ancestorsOf(c3.commitCid, byCid);
  assert.ok(lineage.includes(c0.commitCid) && lineage.includes(c1.commitCid) && lineage.includes(c3.commitCid));
  assert.equal(lineage.includes(c2.commitCid), false);

  // LWW head: latest ts wins.
  assert.equal(lwwHead([c2.commitCid, c3.commitCid], byCid), c3.commitCid);
  // Same ts → higher commitCid breaks the tie deterministically.
  const c4 = buildCommit(author, { treeCid: "t4", parents: [c1.commitCid], message: "c4", ts: c2.ts });
  const byCid2 = new Map<string, Commit>([...byCid, [c4.commitCid, c4]]);
  const head = lwwHead([c2.commitCid, c4.commitCid], byCid2);
  assert.equal(head, c2.commitCid > c4.commitCid ? c2.commitCid : c4.commitCid);
});
