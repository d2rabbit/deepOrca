// Sync protocol messages (design §7/§10, tasks OC2-10/11).
//
// Post-handshake traffic: every message is a canonical-JSON text frame inside
// the encrypted channel. Metadata (records/blocks/approvals) rides as JSON;
// blob chunks ride base64 inside chunkData (4MB chunks → ~5.3MB base64, hence
// the generous frame guard). Deep semantic verification is NOT done here —
// decodeMessage only validates the envelope; the sync layer re-verifies
// signatures, chain links and chunk hashes before trusting any payload.

import type { Approval, Block } from "../block/block.js";
import type { SignedRecord } from "../record/record.js";
import { jcsStringify, type JsonValue } from "../encode/jcs.js";

export const MAX_MESSAGE_BYTES = 16 * 1024 * 1024;

export type SyncMessage =
  | { kind: "ping" }
  | { kind: "pong" }
  | { kind: "bye"; reason: string }
  /** New-member bootstrap: pull the full ledger from a height (R5). */
  | { kind: "getChain"; fromHeight: number }
  /** Ledger slice in height order (reply to getChain, or gossip catch-up). */
  | { kind: "blocks"; blocks: Block[] }
  /** Pre-finality record gossip (design §7: records diffuse immediately). */
  | { kind: "record"; record: SignedRecord }
  | { kind: "blockProposal"; block: Block }
  | { kind: "approval"; height: number; blockHash: string; approval: Approval }
  | { kind: "wantChunks"; manifestCid: string; chunkIds: string[] }
  | { kind: "haveChunks"; manifestCid: string; chunkIds: string[] }
  | { kind: "chunkData"; chunkId: string; dataB64: string };

export class MessageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MessageError";
  }
}

export function encodeMessage(message: SyncMessage): string {
  return jcsStringify(message as unknown as JsonValue);
}

export function encodeMessageBytes(message: SyncMessage): Uint8Array {
  return new TextEncoder().encode(encodeMessage(message));
}

export function decodeMessage(text: string): SyncMessage {
  if (Buffer.byteLength(text, "utf8") > MAX_MESSAGE_BYTES) {
    throw new MessageError(`message exceeds ${MAX_MESSAGE_BYTES} bytes`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new MessageError("message is not JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new MessageError("message is not an object");
  }
  const message = parsed as Record<string, unknown>;
  switch (message.kind) {
    case "ping":
      return { kind: "ping" };
    case "pong":
      return { kind: "pong" };
    case "bye":
      return { kind: "bye", reason: requireString(message, "reason") };
    case "getChain":
      return { kind: "getChain", fromHeight: requireNonNegativeInt(message, "fromHeight") };
    case "blocks":
      return { kind: "blocks", blocks: requireArray(message, "blocks") as unknown as Block[] };
    case "record":
      return { kind: "record", record: requireObject(message, "record") as unknown as SignedRecord };
    case "blockProposal":
      return { kind: "blockProposal", block: requireObject(message, "block") as unknown as Block };
    case "approval":
      return {
        kind: "approval",
        height: requireNonNegativeInt(message, "height"),
        blockHash: requireString(message, "blockHash"),
        approval: requireObject(message, "approval") as unknown as Approval,
      };
    case "wantChunks":
    case "haveChunks":
      return {
        kind: message.kind,
        manifestCid: requireString(message, "manifestCid"),
        chunkIds: requireArray(message, "chunkIds") as string[],
      };
    case "chunkData":
      return {
        kind: "chunkData",
        chunkId: requireString(message, "chunkId"),
        dataB64: requireString(message, "dataB64"),
      };
    default:
      throw new MessageError(`unknown message kind: ${String(message.kind)}`);
  }
}

export function decodeMessageBytes(bytes: Uint8Array): SyncMessage {
  return decodeMessage(new TextDecoder().decode(bytes));
}

function requireString(message: Record<string, unknown>, field: string): string {
  const value = message[field];
  if (typeof value !== "string") {
    throw new MessageError(`${message.kind as string}.${field} must be a string`);
  }
  return value;
}

function requireNonNegativeInt(message: Record<string, unknown>, field: string): number {
  const value = message[field];
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new MessageError(`${message.kind as string}.${field} must be a non-negative integer`);
  }
  return value;
}

function requireObject(message: Record<string, unknown>, field: string): Record<string, unknown> {
  const value = message[field];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new MessageError(`${message.kind as string}.${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireArray(message: Record<string, unknown>, field: string): unknown[] {
  const value = message[field];
  if (!Array.isArray(value)) {
    throw new MessageError(`${message.kind as string}.${field} must be an array`);
  }
  return value;
}
