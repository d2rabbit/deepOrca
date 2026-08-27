// Block assembly and finality (design §6, R7–R9).
//
// A block = header {height, prevBlockHash, ts, proposer, merkleRoot} + the
// records it seals. The block hash covers the HEADER only — the merkleRoot
// commits to the records — so approval signatures stay small and verifiable
// without re-downloading record bodies. Proposers rotate by
// slot = height % memberCount over the keyId-sorted member set. Forks are
// adjudicated deterministically: most valid approvals wins, ties go to the
// proposer earliest in member order (then smallest hash as a last resort).

import { createHash } from "node:crypto";
import { jcsBytes, type JsonValue } from "../encode/jcs.js";
import { toHex, utf8Bytes } from "../encode/bytes.js";
import { verifyBytes } from "../identity/identity.js";
import type { SignedRecord } from "../record/record.js";

export type QuorumPolicy = "majority" | "twoThirds" | "all";

export interface BlockHeader {
  height: number;
  prevBlockHash: string;
  ts: number;
  proposer: string;
  merkleRoot: string;
}

export interface Block extends BlockHeader {
  records: SignedRecord[];
}

/** Member approval of a block hash. */
export interface Approval {
  keyId: string;
  /** Ed25519 signature over the raw block-hash digest, base64. */
  sig: string;
}

/** SHA-256 of the canonical header — what prevBlockHash links and approvals sign. */
export function blockHashDigest(header: BlockHeader): Uint8Array {
  const canonical: JsonValue = {
    height: header.height,
    prevBlockHash: header.prevBlockHash,
    ts: header.ts,
    proposer: header.proposer,
    merkleRoot: header.merkleRoot,
  };
  return new Uint8Array(createHash("sha256").update(jcsBytes(canonical)).digest());
}

export function blockHash(header: BlockHeader): string {
  return toHex(blockHashDigest(header));
}

/** Binary Merkle tree over SHA-256(recordId) leaves; odd nodes duplicate the last. */
export function merkleRoot(recordIds: string[]): string {
  if (recordIds.length === 0) {
    return toHex(new Uint8Array(createHash("sha256").digest()));
  }
  let level: Uint8Array[] = recordIds.map((id) => new Uint8Array(createHash("sha256").update(utf8Bytes(id)).digest()));
  while (level.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = i + 1 < level.length ? level[i + 1] : level[i];
      next.push(
        new Uint8Array(
          createHash("sha256")
            .update(Buffer.concat([Buffer.from(left), Buffer.from(right)]))
            .digest()
        )
      );
    }
    level = next;
  }
  return toHex(level[0]);
}

export function buildBlock(input: {
  height: number;
  prevBlockHash: string;
  ts: number;
  proposer: string;
  records: SignedRecord[];
}): Block {
  return {
    height: input.height,
    prevBlockHash: input.prevBlockHash,
    ts: input.ts,
    proposer: input.proposer,
    merkleRoot: merkleRoot(input.records.map((record) => record.recordId)),
    records: input.records,
  };
}

/** Members sort by keyId so every replica derives the same rotation. */
export function proposerKeyForHeight(height: number, memberKeyIds: string[]): string {
  if (memberKeyIds.length === 0) {
    throw new Error("no members to propose a block");
  }
  const sorted = [...memberKeyIds].sort();
  return sorted[height % sorted.length];
}

export function quorumRequired(memberCount: number, policy: QuorumPolicy): number {
  if (memberCount <= 0) {
    return 0;
  }
  switch (policy) {
    case "majority":
      return Math.floor(memberCount / 2) + 1;
    case "twoThirds":
      return Math.max(2, Math.ceil((2 * memberCount) / 3));
    case "all":
      return memberCount;
  }
}

export interface ApprovalCheck {
  validApprovals: Approval[];
  invalidKeyIds: string[];
  quorum: number;
  finalized: boolean;
}

/** Verify each approval's signature against the current member pubkey table. */
export function checkApprovals(
  header: BlockHeader,
  approvals: Approval[],
  pubKeyByKeyId: Map<string, string>,
  policy: QuorumPolicy
): ApprovalCheck {
  const digest = blockHashDigest(header);
  const validApprovals: Approval[] = [];
  const invalidKeyIds: string[] = [];
  const seen = new Set<string>();
  for (const approval of approvals) {
    const pubKey = pubKeyByKeyId.get(approval.keyId);
    if (!pubKey || seen.has(approval.keyId)) {
      invalidKeyIds.push(approval.keyId);
      continue;
    }
    seen.add(approval.keyId);
    const signature = new Uint8Array(Buffer.from(approval.sig, "base64"));
    if (verifyBytes(pubKey, digest, signature)) {
      validApprovals.push(approval);
    } else {
      invalidKeyIds.push(approval.keyId);
    }
  }
  const quorum = quorumRequired(pubKeyByKeyId.size, policy);
  return { validApprovals, invalidKeyIds, quorum, finalized: validApprovals.length >= quorum };
}

export interface ForkCandidate {
  header: BlockHeader;
  /** Count of signature-verified approvals (caller pre-verifies). */
  validApprovalCount: number;
}

/** Deterministic fork winner: most approvals → earliest proposer in member order → smallest hash. */
export function chooseForkWinner(candidates: ForkCandidate[], memberKeyIds: string[]): ForkCandidate {
  if (candidates.length === 0) {
    throw new Error("no candidates to adjudicate");
  }
  const order = new Map([...memberKeyIds].sort().map((keyId, index) => [keyId, index]));
  return [...candidates].sort((a, b) => {
    if (b.validApprovalCount !== a.validApprovalCount) {
      return b.validApprovalCount - a.validApprovalCount;
    }
    const rankA = order.get(a.header.proposer) ?? Number.MAX_SAFE_INTEGER;
    const rankB = order.get(b.header.proposer) ?? Number.MAX_SAFE_INTEGER;
    if (rankA !== rankB) {
      return rankA - rankB;
    }
    return blockHash(a.header) < blockHash(b.header) ? -1 : 1;
  })[0];
}

/** Idempotent recordId dedup container for gossip and replay (R9). */
export class RecordIdIndex {
  private readonly seen = new Set<string>();

  has(recordId: string): boolean {
    return this.seen.has(recordId);
  }

  /** Returns the ids that were new (caller processes those, ignores the rest). */
  addAll(recordIds: string[]): string[] {
    const fresh: string[] = [];
    for (const id of recordIds) {
      if (!this.seen.has(id)) {
        this.seen.add(id);
        fresh.push(id);
      }
    }
    return fresh;
  }

  get size(): number {
    return this.seen.size;
  }
}
