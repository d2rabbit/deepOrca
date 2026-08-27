// Signed ledger record (design §5). The chain only carries metadata — every
// record is ≤8KB canonical JSON, Ed25519-signed by its author, with a
// content-derived recordId so gossip can dedupe idempotently (R9). The signed
// payload intentionally EXCLUDES the optional parentRecordId field entirely
// when absent (not "present as undefined") so canonical bytes stay stable.

import { createHash } from "node:crypto";
import { jcsBytes, jcsStringify, type JsonValue } from "../encode/jcs.js";
import { toHex } from "../encode/bytes.js";
import { signBytes, verifyBytes, type DeviceIdentity } from "../identity/identity.js";

export const MAX_RECORD_BYTES = 8 * 1024;

export type RecordType =
  | "member.join"
  | "member.leave"
  | "asset.publish"
  | "asset.update"
  | "asset.revoke"
  | "ws.commit"
  | "task.share"
  | "task.claim"
  | "task.progress"
  | "task.done"
  | "session.offer"
  | "note";

export interface MemberJoinBody {
  deviceName: string;
  pubKey: string;
}

export interface MemberLeaveBody {
  deviceName?: string;
}

export type AssetKind = "requirement" | "design" | "architecture" | "file" | "other";

export interface AssetPublishBody {
  cid: string;
  name: string;
  mime: string;
  size: number;
  kind: AssetKind;
  note?: string;
}

export interface AssetUpdateBody {
  cid: string;
  parentRecordId: string;
}

export interface AssetRevokeBody {
  cid: string;
  reason: string;
}

export interface WsCommitBody {
  treeCid: string;
  parents: string[];
  message: string;
  taskRef?: string;
  assetRefs?: string[];
}

export interface TaskShareBody {
  title: string;
  goal: string;
  trajectory: string;
  filesTouched: string[];
  conclusion: string;
  leftovers: string[];
  commitRef?: string;
}

export interface TaskClaimBody {
  taskId: string;
  note?: string;
}

export interface TaskProgressBody {
  taskId: string;
  note?: string;
  percent?: number;
}

export interface TaskDoneBody {
  taskId: string;
  note?: string;
}

export interface SessionOfferBody {
  taskId: string;
  summary: string;
  commitRef?: string;
}

export interface NoteBody {
  text: string;
  refRecordId?: string;
}

export type RecordBody =
  | MemberJoinBody
  | MemberLeaveBody
  | AssetPublishBody
  | AssetUpdateBody
  | AssetRevokeBody
  | WsCommitBody
  | TaskShareBody
  | TaskClaimBody
  | TaskProgressBody
  | TaskDoneBody
  | SessionOfferBody
  | NoteBody;

export interface UnsignedRecord {
  type: RecordType;
  /** Millis since epoch; replay enforces ts ≤ block.ts. */
  ts: number;
  /** Author keyId; must be a chain member (or the joiner for member.join). */
  author: string;
  /** Optional lineage pointer (task genealogy / asset version chain). */
  parentRecordId?: string;
  body: RecordBody;
}

export interface SignedRecord extends UnsignedRecord {
  /** "r:" + first 24 hex chars of SHA-256(canonical payload bytes). */
  recordId: string;
  /** Ed25519 signature over the canonical payload bytes, base64. */
  sig: string;
}

/** Exact canonical payload — this object's JCS bytes are what gets signed/id-hashed. */
export function recordPayload(record: UnsignedRecord): JsonValue {
  const payload: { [key: string]: JsonValue } = {
    type: record.type,
    ts: record.ts,
    author: record.author,
    // Bodies are JSON-shaped by construction (validated in verifySignedRecord).
    body: record.body as unknown as JsonValue,
  };
  if (record.parentRecordId !== undefined) {
    payload.parentRecordId = record.parentRecordId;
  }
  return payload;
}

export function recordIdFromPayloadBytes(bytes: Uint8Array): string {
  const digest = createHash("sha256").update(bytes).digest();
  return "r:" + toHex(digest.subarray(0, 12));
}

export function buildSignedRecord(identity: DeviceIdentity, record: UnsignedRecord): SignedRecord {
  const payloadBytes = jcsBytes(recordPayload(record));
  const sig = signBytes(identity, payloadBytes);
  const signed: SignedRecord = {
    ...record,
    recordId: recordIdFromPayloadBytes(payloadBytes),
    sig: Buffer.from(sig).toString("base64"),
  };
  assertRecordSize(signed);
  return signed;
}

export type RecordVerification = { ok: true } | { ok: false; reason: string };

/**
 * Full verification: structural shape per type, author-pubkey signature,
 * recordId binding and the 8KB ceiling. Never throws on bad input — the
 * replay layer must be able to point at the first bad record and stop.
 */
export function verifySignedRecord(record: SignedRecord, publicKeyBase64: string): RecordVerification {
  const shape = validateRecordShape(record);
  if (!shape.ok) {
    return shape;
  }
  if (typeof record.sig !== "string" || typeof record.recordId !== "string") {
    return { ok: false, reason: "missing signature or recordId" };
  }
  if (Buffer.byteLength(jcsStringify(record as unknown as JsonValue), "utf8") > MAX_RECORD_BYTES) {
    return { ok: false, reason: `record exceeds ${MAX_RECORD_BYTES} bytes` };
  }
  let payloadBytes: Uint8Array;
  try {
    payloadBytes = jcsBytes(recordPayload(record));
  } catch (error) {
    return { ok: false, reason: `payload is not canonicalizable: ${(error as Error).message}` };
  }
  const expectedId = recordIdFromPayloadBytes(payloadBytes);
  if (record.recordId !== expectedId) {
    return { ok: false, reason: `recordId mismatch (expected ${expectedId})` };
  }
  const signature = new Uint8Array(Buffer.from(record.sig, "base64"));
  if (signature.length === 0 || !verifyBytes(publicKeyBase64, payloadBytes, signature)) {
    return { ok: false, reason: "signature verification failed" };
  }
  return { ok: true };
}

function assertRecordSize(record: SignedRecord): void {
  const size = Buffer.byteLength(jcsStringify(record as unknown as JsonValue), "utf8");
  if (size > MAX_RECORD_BYTES) {
    throw new Error(`record exceeds ${MAX_RECORD_BYTES} byte ceiling (got ${size})`);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasString(body: Record<string, unknown>, key: string): boolean {
  return typeof body[key] === "string" && (body[key] as string).length > 0;
}

const ASSET_KINDS = new Set<string>(["requirement", "design", "architecture", "file", "other"]);

/** Minimal per-type structural checks — deeper semantics live in the view layer. */
export function validateRecordShape(record: UnsignedRecord): RecordVerification {
  if (typeof record.ts !== "number" || !Number.isFinite(record.ts)) {
    return { ok: false, reason: "ts must be a finite number" };
  }
  if (typeof record.author !== "string" || record.author.length === 0) {
    return { ok: false, reason: "author must be a keyId string" };
  }
  if (!isPlainObject(record.body)) {
    return { ok: false, reason: "body must be an object" };
  }
  const body = record.body as unknown as Record<string, unknown>;
  const ok = { ok: true as const };
  const fail = (reason: string): RecordVerification => ({ ok: false, reason });
  switch (record.type) {
    case "member.join":
      return hasString(body, "deviceName") && hasString(body, "pubKey")
        ? ok
        : fail("member.join needs deviceName and pubKey");
    case "member.leave":
      return ok;
    case "asset.publish":
      if (
        !hasString(body, "cid") ||
        !hasString(body, "name") ||
        !hasString(body, "mime") ||
        typeof body.size !== "number"
      ) {
        return fail("asset.publish needs cid/name/mime/size");
      }
      return typeof body.kind === "string" && ASSET_KINDS.has(body.kind) ? ok : fail("asset.publish has invalid kind");
    case "asset.update":
    case "asset.revoke":
    case "task.claim":
    case "task.progress":
    case "task.done":
    case "session.offer":
    case "note":
      return hasString(
        body,
        record.type === "note"
          ? "text"
          : record.type === "asset.update" || record.type === "asset.revoke"
            ? "cid"
            : record.type === "session.offer"
              ? "taskId"
              : "taskId"
      )
        ? ok
        : fail(`${record.type} missing its primary field`);
    case "ws.commit":
      return hasString(body, "treeCid") && hasString(body, "message") && Array.isArray(body.parents)
        ? ok
        : fail("ws.commit needs treeCid/parents/message");
    case "task.share":
      return hasString(body, "title") && hasString(body, "goal") ? ok : fail("task.share needs title and goal");
    default:
      return fail(`unknown record type: ${String(record.type)}`);
  }
}
