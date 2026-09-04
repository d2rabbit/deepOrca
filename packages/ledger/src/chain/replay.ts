// Full replay verification (design §6, R5).
//
// Joining a chain means downloading every block from height 0 and re-deriving
// the whole state: hash-chain links, per-record signatures, membership
// evolution, proposer rotation, merkle roots and per-block quorum approvals.
// The pubkey table is SELF-CONTAINED — member.join records carry the member's
// public key, and the first block must register the genesis creator — so a
// replica needs nothing but the genesis and the block list. Any mismatch stops
// the replay and reports the offending height as the first inconsistency.

import {
  checkApprovals,
  blockHash,
  buildBlock,
  merkleRoot,
  proposerKeyForHeight,
  type Approval,
  type Block,
} from "../block/block.js";
import { genesisHashDigest } from "../chain/genesis.js";
import { toHex } from "../encode/bytes.js";
import { verifySignedRecord, type SignedRecord } from "../record/record.js";
import { keyIdFromPublicKeyBase64 } from "../identity/identity.js";
import type { Genesis } from "./genesis.js";

export interface MemberEntry {
  keyId: string;
  deviceName: string;
  pubKey: string;
  joinedHeight: number;
  leftHeight?: number;
}

export interface ReplaySuccess {
  ok: true;
  height: number;
  members: Map<string, MemberEntry>;
  recordCount: number;
}

export interface ReplayFailure {
  ok: false;
  /** Height of the first inconsistent block. */
  height: number;
  reason: string;
}

export type ReplayResult = ReplaySuccess | ReplayFailure;

export function replayChain(genesis: Genesis, blocks: Block[]): ReplayResult {
  const members = new Map<string, MemberEntry>();
  const seenRecordIds = new Set<string>();
  const maxRecords = genesis.params.maxBlockRecords;
  let lastBlockTs = -1;
  let recordCount = 0;
  let expectedPrev = toHex(genesisHashDigest(genesis));

  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];
    const fail = (reason: string): ReplayFailure => ({ ok: false, height: block.height, reason });
    const preBlockPubKeys = new Map<string, string>();
    for (const [keyId, member] of members) {
      if (member.leftHeight === undefined) {
        preBlockPubKeys.set(keyId, member.pubKey);
      }
    }

    if (block.height !== index) {
      return { ok: false, height: block.height, reason: `unexpected height ${block.height}, expected ${index}` };
    }
    if (block.prevBlockHash !== expectedPrev) {
      return fail(`prevBlockHash mismatch (expected ${expectedPrev})`);
    }
    if (block.records.length > maxRecords) {
      return fail(`${block.records.length} records exceeds maxBlockRecords ${maxRecords}`);
    }
    if (block.ts < lastBlockTs) {
      return fail(`block ts ${block.ts} goes backwards (previous ${lastBlockTs})`);
    }
    // Height 0 is the membership bootstrap block: the member set is still
    // empty, so the rotation cannot run yet — the genesis creator proposes.
    if (block.height === 0) {
      if (block.proposer !== genesis.creator) {
        return fail("bootstrap block must be proposed by the genesis creator");
      }
    } else {
      const memberKeyIds = [...members.keys()].filter((keyId) => members.get(keyId)?.leftHeight === undefined);
      if (memberKeyIds.length === 0) {
        return fail("no active members to propose the block");
      }
      const expectedProposer = proposerKeyForHeight(block.height, memberKeyIds);
      if (block.proposer !== expectedProposer) {
        return fail(`proposer ${block.proposer} != slot owner ${expectedProposer}`);
      }
    }
    if (merkleRoot(block.records.map((record) => record.recordId)) !== block.merkleRoot) {
      return fail("merkleRoot mismatch");
    }

    for (const record of block.records) {
      if (seenRecordIds.has(record.recordId)) {
        return fail(`duplicate recordId ${record.recordId}`);
      }
      if (record.ts > block.ts) {
        return fail(`record ${record.recordId} ts ${record.ts} is after block ts ${block.ts}`);
      }
      if (record.type === "member.join") {
        const body = record.body as { deviceName: string; pubKey: string };
        const derived = keyIdFromPublicKeyBase64(body.pubKey);
        if (record.author !== derived) {
          return fail(`member.join author ${record.author} does not bind to its pubKey (${derived})`);
        }
        const verification = verifySignedRecord(record, body.pubKey);
        if (!verification.ok) {
          return fail(`member.join record invalid: ${verification.reason}`);
        }
        const existing = members.get(record.author);
        if (existing && existing.leftHeight === undefined) {
          return fail(`duplicate join for ${record.author}`);
        }
        members.set(record.author, {
          keyId: record.author,
          deviceName: body.deviceName,
          pubKey: body.pubKey,
          joinedHeight: block.height,
        });
      } else {
        const member = members.get(record.author);
        if (!member || member.leftHeight !== undefined) {
          return fail(`record ${record.recordId} author ${record.author} is not an active member`);
        }
        const verification = verifySignedRecord(record, member.pubKey);
        if (!verification.ok) {
          return fail(`record ${record.recordId} invalid: ${verification.reason}`);
        }
        if (record.type === "member.leave") {
          member.leftHeight = block.height;
        } else if (record.type === "member.rotate") {
          // Pubkey timeline: the OUTGOING key (record.author) signs the
          // rotation; the membership entry moves to the derived new keyId so
          // later records verify against the new key. History stays verifiable.
          const body = record.body as { oldKeyId: string; newPubKey: string };
          if (body.oldKeyId !== record.author) {
            return fail(`member.rotate oldKeyId ${body.oldKeyId} != author ${record.author}`);
          }
          const newKeyId = keyIdFromPublicKeyBase64(body.newPubKey);
          if (newKeyId === record.author) {
            return fail("member.rotate must rotate to a fresh key");
          }
          if (members.has(newKeyId)) {
            return fail(`member.rotate target ${newKeyId} already exists`);
          }
          const fresh: MemberEntry = { ...member, keyId: newKeyId, pubKey: body.newPubKey };
          members.delete(record.author);
          members.set(newKeyId, fresh);
        }
      }
      seenRecordIds.add(record.recordId);
      recordCount++;
    }

    if (block.height === 0) {
      const creatorJoined = block.records.some(
        (record: SignedRecord) => record.type === "member.join" && record.author === genesis.creator
      );
      if (!creatorJoined) {
        return fail("first block must register the genesis creator via member.join");
      }
    }

    const approvalSet = collectApprovals(block);
    // Approval keys verify against the PRE-block ∪ POST-block member tables:
    // a member rotating out in this block (or joining into it) approves with
    // whatever key they held at block time. The QUORUM base, however, is the
    // POST-block membership — a rotated-out key validates signatures but no
    // longer counts as a committee seat.
    const merged = new Map<string, string>(preBlockPubKeys);
    let postMemberCount = 0;
    for (const [keyId, member] of members) {
      if (member.leftHeight === undefined) {
        merged.set(keyId, member.pubKey);
        postMemberCount++;
      }
    }
    const check = checkApprovals(block, approvalSet, merged, genesis.params.quorum, postMemberCount);
    if (!check.finalized) {
      return fail(`only ${check.validApprovals.length}/${check.quorum} valid approvals`);
    }

    expectedPrev = blockHash(block);
    lastBlockTs = block.ts;
  }
  return { ok: true, height: blocks.length - 1, members, recordCount };
}

function collectApprovals(block: Block): Approval[] {
  return (block as Block & { approvals?: Approval[] }).approvals ?? [];
}

/** Convenience: attach approvals to a block (kept out of the canonical header hash). */
export function withApprovals(block: Block, approvals: Approval[]): Block & { approvals: Approval[] } {
  return Object.assign(buildBlock({ ...block, records: block.records }), { approvals });
}
