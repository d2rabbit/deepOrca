// Local content-addressed object store (design §7 blob layer, R12/R13).
//
// Chunks (and, via the same store, nothing else — tree/commit JSON objects
// are derivable from the ledger records) live under
// <root>/chunks/<hex[0..2]>/<hex[2..]>, addressed by their SHA-256 chunk id.
// Files are only ever written AFTER the caller verified
// chunkIdOf(bytes) === advertised id (putChunkVerified refuses otherwise),
// because a stored chunk is trusted implicitly on read.
//
// The store is disposable: the ledger is the single source of truth, so LRU
// eviction under the storage quota may drop any chunk (R13) — holders simply
// re-fetch from a peer that still has it.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chunkIdOf } from "../cid/cid.js";

export const DEFAULT_QUOTA_BYTES = 2 * 1024 * 1024 * 1024;

export class ObjectStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ObjectStoreError";
  }
}

export interface ObjectStoreOptions {
  quotaBytes?: number;
}

interface ChunkStat {
  /** "b:"-prefixed chunk id reconstructed from the file layout. */
  chunkId: string;
  bytes: number;
  atimeMs: number;
}

export class ObjectStore {
  private readonly chunksDir: string;
  private readonly quotaBytes: number;

  constructor(rootDir: string, options: ObjectStoreOptions = {}) {
    this.chunksDir = join(rootDir, "chunks");
    this.quotaBytes = options.quotaBytes ?? DEFAULT_QUOTA_BYTES;
    mkdirSync(this.chunksDir, { recursive: true });
  }

  /** Compute the id for raw bytes without storing them (receive-path check). */
  chunkIdFor(bytes: Uint8Array): string {
    return chunkIdOf(bytes);
  }

  /**
   * Receive-path write: refuses bytes that do not hash to the advertised id —
   * this is the per-chunk verification gate of R12.
   */
  putChunkVerified(chunkId: string, bytes: Uint8Array): string {
    if (chunkIdOf(bytes) !== chunkId) {
      throw new ObjectStoreError(`chunk bytes do not match advertised id ${chunkId}`);
    }
    const path = this.pathFor(chunkId);
    mkdirSync(join(path, ".."), { recursive: true });
    if (!existsSync(path)) {
      writeFileSync(path, bytes, { mode: 0o644 });
    }
    return chunkId;
  }

  /** Convenience for local writes (id derived from the bytes). */
  putChunk(bytes: Uint8Array): string {
    return this.putChunkVerified(chunkIdOf(bytes), bytes);
  }

  getChunk(chunkId: string): Uint8Array | undefined {
    const path = this.pathFor(chunkId);
    if (!existsSync(path)) {
      return undefined;
    }
    // Touch for LRU: reads count as use.
    const now = new Date();
    try {
      utimesSync(path, now, statSync(path).mtime);
    } catch {
      // Best-effort touch; a lost race with eviction just means a miss below.
    }
    return new Uint8Array(readFileSync(path));
  }

  has(chunkId: string): boolean {
    return existsSync(this.pathFor(chunkId));
  }

  deleteChunk(chunkId: string): void {
    rmSync(this.pathFor(chunkId), { force: true });
  }

  usageBytes(): number {
    return this.scan().reduce((sum, stat) => sum + stat.bytes, 0);
  }

  /**
   * Evict least-recently-used chunks until usage is within quota. Returns the
   * evicted ids — safe by design (R13): blobs are re-fetchable, the ledger
   * never depends on them.
   */
  enforceQuota(): string[] {
    const evicted: string[] = [];
    const stats = this.scan();
    let usage = stats.reduce((sum, stat) => sum + stat.bytes, 0);
    if (usage <= this.quotaBytes) {
      return evicted;
    }
    stats.sort((a, b) => a.atimeMs - b.atimeMs);
    for (const stat of stats) {
      if (usage <= this.quotaBytes) {
        break;
      }
      this.deleteChunk(stat.chunkId);
      usage -= stat.bytes;
      evicted.push(stat.chunkId);
    }
    return evicted;
  }

  private scan(): ChunkStat[] {
    const stats: ChunkStat[] = [];
    if (!existsSync(this.chunksDir)) {
      return stats;
    }
    for (const shard of readdirSync(this.chunksDir)) {
      const shardDir = join(this.chunksDir, shard);
      for (const file of readdirSync(shardDir)) {
        const full = join(shardDir, file);
        const info = statSync(full);
        if (!info.isFile()) {
          continue;
        }
        stats.push({ chunkId: "b:" + shard + file, bytes: info.size, atimeMs: info.atimeMs });
      }
    }
    return stats;
  }

  private pathFor(chunkId: string): string {
    if (!chunkId.startsWith("b:")) {
      throw new ObjectStoreError(`not a chunk id: ${chunkId}`);
    }
    const hex = chunkId.slice(2);
    if (!/^[0-9a-f]{24}$/.test(hex)) {
      throw new ObjectStoreError(`malformed chunk id: ${chunkId}`);
    }
    return join(this.chunksDir, hex.slice(0, 2), hex.slice(2));
  }
}
