/**
 * VectorIndex — pure in-memory cosine index with disk caching.
 *
 * Brute-force dot product over L2-normalized vectors. For the scale we care
 * about (dozens to low-hundreds of skills/tools), this is <1ms per query and
 * avoids any native/vector-DB dependency.
 *
 * Disk cache: embeddings are expensive to compute (model load + inference),
 * so we persist them keyed by a content hash of the indexed texts + model
 * version. On rebuild, a cache hit skips re-embedding entirely.
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import type { RoutingEmbeddingService } from "./types";

export interface VectorIndexEntry {
  id: string;
  text: string;
}

export interface VectorIndexHit {
  id: string;
  /** Cosine similarity score (−1..1; higher is better). */
  score: number;
}

export class VectorIndex {
  private vectors: Float32Array[] = [];
  private ids: string[] = [];
  private texts: string[] = [];
  private embeddingService: RoutingEmbeddingService | null = null;
  private readonly cacheDir: string | null;

  constructor(opts?: { cacheDir?: string }) {
    this.cacheDir = opts?.cacheDir ?? null;
  }

  /**
   * Attach an embedding service. Must be called before rebuild/query.
   * Returns false if the service is not ready (caller should fail-open).
   */
  attach(embeddingService: RoutingEmbeddingService): boolean {
    if (!embeddingService.isReady()) return false;
    this.embeddingService = embeddingService;
    return true;
  }

  get size(): number {
    return this.ids.length;
  }

  /**
   * Rebuild the index from entries. Returns false if embedding is unavailable
   * (service not attached or not ready) — caller should fail-open.
   * Uses disk cache to skip re-embedding when content+model is unchanged.
   */
  async rebuild(entries: VectorIndexEntry[], modelTag?: string): Promise<boolean> {
    if (!this.embeddingService || !this.embeddingService.isReady()) return false;

    const cacheKey = this.computeCacheKey(entries, modelTag);
    const cached = this.cacheDir ? this.tryLoadCache(cacheKey) : null;

    if (cached) {
      this.vectors = cached.vectors;
      this.ids = entries.map((e) => e.id);
      this.texts = entries.map((e) => e.text);
      return true;
    }

    // Encode all texts in batch.
    const texts = entries.map((e) => e.text);
    const vectors = await this.embeddingService.embedBatch(texts);
    if (!vectors || vectors.length !== entries.length) return false;

    this.vectors = vectors;
    this.ids = entries.map((e) => e.id);
    this.texts = texts;

    if (this.cacheDir) {
      this.tryWriteCache(cacheKey, vectors);
    }
    return true;
  }

  /**
   * Query the index for top-K most similar entries.
   * Returns empty array if index is empty or embedding fails.
   */
  async query(text: string, topK: number): Promise<VectorIndexHit[]> {
    if (!this.embeddingService || !this.embeddingService.isReady() || this.vectors.length === 0) {
      return [];
    }

    let queryVec: Float32Array;
    try {
      queryVec = await this.embeddingService.embed(text);
    } catch {
      return [];
    }

    return this.searchByVector(queryVec, topK);
  }

  /** Synchronous cosine search against a precomputed query vector. */
  searchByVector(queryVec: Float32Array, topK: number): VectorIndexHit[] {
    if (this.vectors.length === 0) return [];

    const scored: VectorIndexHit[] = [];
    for (let i = 0; i < this.vectors.length; i++) {
      const score = cosine(queryVec, this.vectors[i]!);
      scored.push({ id: this.ids[i]!, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, Math.max(0, topK));
  }

  // ── Disk cache ───────────────────────────────────────────────────────────

  private computeCacheKey(entries: VectorIndexEntry[], modelTag?: string): string {
    const h = crypto.createHash("sha256");
    for (const e of entries) {
      h.update(e.id);
      h.update("\0");
      h.update(e.text);
      h.update("\0");
    }
    if (modelTag) h.update(modelTag);
    return h.digest("hex").slice(0, 16);
  }

  private tryLoadCache(key: string): { vectors: Float32Array[] } | null {
    if (!this.cacheDir) return null;
    const file = path.join(this.cacheDir, `routing-vec-${key}.json`);
    try {
      if (!fs.existsSync(file)) return null;
      const raw = fs.readFileSync(file, "utf8");
      const data = JSON.parse(raw) as { vectors: number[][] };
      return { vectors: data.vectors.map((v) => new Float32Array(v)) };
    } catch {
      return null;
    }
  }

  private tryWriteCache(key: string, vectors: Float32Array[]): void {
    if (!this.cacheDir) return;
    try {
      fs.mkdirSync(this.cacheDir, { recursive: true });
      const file = path.join(this.cacheDir, `routing-vec-${key}.json`);
      const data = { vectors: vectors.map((v) => Array.from(v)) };
      fs.writeFileSync(file, JSON.stringify(data), "utf8");
    } catch {
      // Cache write failure is non-fatal.
    }
  }
}

/** Cosine similarity for L2-normalized vectors (= dot product). */
function cosine(a: Float32Array, b: Float32Array): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i]! * b[i]!;
  }
  return dot;
}
