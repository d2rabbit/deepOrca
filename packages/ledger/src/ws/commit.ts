// Chain workspace commit object (design §8.1, R27/R28).
//
// A commit points at a tree, carries parent commitCids (parallel commits = a
// retained lineage fork; v1 has no merge), a message, the author keyId and an
// Ed25519 signature. The commitCid covers the UNSIGNED canonical form so the
// id is stable while the signature travels alongside. Commits are mirrored
// into the ledger as `ws.commit` records — the view layer recomputes the same
// commitCid from the record fields (treeCid/parents/message + record
// author/ts), which is why buildCommit defaults ts/author exactly that way.

import { sha256Hex } from "../cid/cid.js";
import { jcsBytes, type JsonValue } from "../encode/jcs.js";
import { signBytes, verifyBytes, type DeviceIdentity } from "../identity/identity.js";

export interface CommitUnsigned {
  version: 1;
  treeCid: string;
  parents: string[];
  message: string;
  author: string;
  ts: number;
  /** Optional task genealogy link — task.share ↔ ws.commit cross-reference. */
  taskRef?: string;
}

export interface Commit extends CommitUnsigned {
  commitCid: string;
  sig: string;
}

export function commitCidOf(commit: CommitUnsigned): string {
  return sha256Hex(jcsBytes(commitUnsignedPayload(commit)));
}

export function commitUnsignedPayload(commit: CommitUnsigned): JsonValue {
  const payload: { [key: string]: JsonValue } = {
    version: 1,
    treeCid: commit.treeCid,
    parents: [...commit.parents],
    message: commit.message,
    author: commit.author,
    ts: commit.ts,
  };
  if (commit.taskRef !== undefined) {
    payload.taskRef = commit.taskRef;
  }
  return payload;
}

export interface BuildCommitInput {
  treeCid: string;
  parents: string[];
  message: string;
  ts: number;
  taskRef?: string;
}

export function buildCommit(identity: DeviceIdentity, input: BuildCommitInput): Commit {
  const unsigned: CommitUnsigned = {
    version: 1,
    treeCid: input.treeCid,
    parents: [...input.parents],
    message: input.message,
    author: identity.keyId,
    ts: input.ts,
    ...(input.taskRef !== undefined ? { taskRef: input.taskRef } : {}),
  };
  const bytes = jcsBytes(commitUnsignedPayload(unsigned));
  const sig = Buffer.from(signBytes(identity, bytes)).toString("base64");
  return { ...unsigned, commitCid: commitCidOf(unsigned), sig };
}

export type CommitVerification = { ok: true } | { ok: false; reason: string };

export function verifyCommit(commit: Commit, publicKeyBase64: string): CommitVerification {
  const unsigned: CommitUnsigned = {
    version: commit.version,
    treeCid: commit.treeCid,
    parents: commit.parents,
    message: commit.message,
    author: commit.author,
    ts: commit.ts,
    ...(commit.taskRef !== undefined ? { taskRef: commit.taskRef } : {}),
  };
  const expectedCid = commitCidOf(unsigned);
  if (commit.commitCid !== expectedCid) {
    return { ok: false, reason: `commitCid mismatch (expected ${expectedCid})` };
  }
  const signature = new Uint8Array(Buffer.from(commit.sig, "base64"));
  if (signature.length === 0 || !verifyBytes(publicKeyBase64, jcsBytes(commitUnsignedPayload(unsigned)), signature)) {
    return { ok: false, reason: "commit signature verification failed" };
  }
  return { ok: true };
}
