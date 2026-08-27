// Content addressing + 4MB chunking (design §7 blob layer, R11/R12).
//
// File bodies never enter blocks. They are split into 4MB chunks, each chunk
// is addressed by its own SHA-256 ("b:" + first 24 hex chars), and the
// manifest (ordered chunk-id list + total size) is itself content-addressed.
// Content addressing gives cross-commit dedup for free: identical bytes are
// stored and transferred exactly once.

import { createHash } from "node:crypto";
import { jcsBytes, type JsonValue } from "../encode/jcs.js";
import { toHex } from "../encode/bytes.js";

export const CHUNK_SIZE = 4 * 1024 * 1024;

export function sha256Hex(data: Uint8Array): string {
  return toHex(new Uint8Array(createHash("sha256").update(data).digest()));
}

export function chunkIdOf(chunk: Uint8Array): string {
  return "b:" + sha256Hex(chunk).slice(0, 24);
}

export interface BlobManifest {
  version: 1;
  size: number;
  chunkIds: string[];
}

export function manifestCidOf(manifest: BlobManifest): string {
  return sha256Hex(jcsBytes(manifest as unknown as JsonValue));
}

export function chunkBytes(data: Uint8Array): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < data.byteLength; offset += CHUNK_SIZE) {
    chunks.push(data.subarray(offset, Math.min(offset + CHUNK_SIZE, data.byteLength)));
  }
  if (chunks.length === 0) {
    chunks.push(new Uint8Array(0));
  }
  return chunks;
}

export interface BuiltBlob {
  manifest: BlobManifest;
  manifestCid: string;
  chunks: Uint8Array[];
}

export function buildBlob(data: Uint8Array): BuiltBlob {
  const chunks = chunkBytes(data);
  const manifest: BlobManifest = {
    version: 1,
    size: data.byteLength,
    chunkIds: chunks.map((chunk) => chunkIdOf(chunk)),
  };
  return { manifest, manifestCid: manifestCidOf(manifest), chunks };
}

export type ReassembleResult = { ok: true; data: Uint8Array } | { ok: false; missing: string[]; corrupt: string[] };

/**
 * Reassemble a blob from a chunk-id→bytes resolver. Every chunk is re-hashed
 * before use — a chunk that fails its own CID is reported as corrupt (R12:
 * drop and re-route, never persist unverified bytes).
 */
export function reassembleBlob(
  manifest: BlobManifest,
  resolveChunk: (chunkId: string) => Uint8Array | undefined
): ReassembleResult {
  const missing: string[] = [];
  const corrupt: string[] = [];
  const parts: Uint8Array[] = [];
  for (const chunkId of manifest.chunkIds) {
    const chunk = resolveChunk(chunkId);
    if (chunk === undefined) {
      missing.push(chunkId);
      continue;
    }
    if (chunkIdOf(chunk) !== chunkId) {
      corrupt.push(chunkId);
      continue;
    }
    parts.push(chunk);
  }
  if (missing.length > 0 || corrupt.length > 0) {
    return { ok: false, missing, corrupt };
  }
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const data = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    data.set(part, offset);
    offset += part.byteLength;
  }
  if (data.byteLength !== manifest.size) {
    return { ok: false, missing: [], corrupt: ["<size-mismatch>"] };
  }
  return { ok: true, data };
}
