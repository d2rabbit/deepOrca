/**
 * Store Factory — creates the appropriate storage backend and embedding service
 * based on plugin configuration.
 *
 * Supports:
 * - "sqlite" (default): local SQLite + sqlite-vec + FTS5
 * - "tcvdb": Tencent Cloud VectorDB (server-side embedding + hybridSearch)
 */

import path from "node:path";
import type { MemoryTdaiConfig } from "../../config.js";
import type { IMemoryStore, IEmbeddingService, StoreLogger } from "./types.js";
import { VectorStore } from "./sqlite.js";
import { TcvdbMemoryStore } from "./tcvdb.js";
import { createEmbeddingService, NoopEmbeddingService } from "./embedding.js";
import type { EmbeddingService } from "./embedding.js";
import { createBM25Encoder } from "./bm25-local.js";
import type { BM25LocalEncoder } from "./bm25-local.js";

// Re-export for convenience
export type { IMemoryStore, IEmbeddingService, StoreLogger, BM25LocalEncoder };

const TAG = "[memory-tdai][factory]";

export interface StoreBundle {
  store: IMemoryStore;
  embedding: IEmbeddingService;
  bm25Encoder?: BM25LocalEncoder;
  /** Snapshot of current store config for manifest writing. */
  storeSnapshot: import("../../utils/manifest.js").StoreConfigSnapshot;
}

/**
 * Create the storage backend, embedding service, and optional BM25 encoder
 * based on plugin configuration.
 *
 * @param config       Fully resolved plugin config.
 * @param options.dataDir          Plugin data directory.
 * @param options.logger           Logger instance.
 * @param options.graniteModelDir  Model root for provider="local-onnx" (HF mirror layout).
 *                                 When omitted, defaults to <dataDir>/models.
 */
export async function createStoreBundle(
  config: MemoryTdaiConfig,
  options: { dataDir: string; logger?: StoreLogger; graniteModelDir?: string }
): Promise<StoreBundle> {
  const { logger } = options;

  // ── BM25 local encoder ──
  const bm25Encoder = createBM25Encoder(config.bm25, logger);

  switch (config.storeBackend) {
    case "tcvdb": {
      const tcvdbCfg = config.tcvdb;
      if (!tcvdbCfg.url || !tcvdbCfg.apiKey) {
        throw new Error(`${TAG} TCVDB backend requires tcvdb.url and tcvdb.apiKey`);
      }
      if (!tcvdbCfg.database) {
        throw new Error(
          `${TAG} TCVDB backend requires tcvdb.database — please set a unique database name in your openclaw.json plugin config`
        );
      }
      const database = tcvdbCfg.database;
      const store = new TcvdbMemoryStore({
        url: tcvdbCfg.url,
        username: tcvdbCfg.username,
        apiKey: tcvdbCfg.apiKey,
        database,
        embeddingModel: tcvdbCfg.embeddingModel,
        timeout: tcvdbCfg.timeout,
        caPemPath: tcvdbCfg.caPemPath,
        logger,
        bm25Encoder: bm25Encoder ?? undefined,
      });

      logger?.debug?.(
        `${TAG} Store created: backend=tcvdb, database=${database}, model=${tcvdbCfg.embeddingModel}, ` +
          `bm25=${bm25Encoder ? "enabled" : "disabled"}`
      );

      return {
        store,
        embedding: new NoopEmbeddingService(),
        bm25Encoder,
        storeSnapshot: {
          type: "tcvdb",
          tcvdbUrl: tcvdbCfg.url,
          tcvdbDatabase: database,
          tcvdbAlias: tcvdbCfg.alias || undefined,
        },
      };
    }

    case "sqlite":
    default: {
      // ── Embedding service (only when enabled) ──
      let embeddingService: EmbeddingService | undefined;

      // local-onnx: Granite 97M R2 via @deeporca/embedding (transformers.js).
      // Model files are vendored at build time; dynamic import keeps
      // transformers.js + onnxruntime-node out of the load path when unused.
      if (config.embedding.enabled && config.embedding.provider === "local-onnx") {
        const modelDir = options.graniteModelDir ?? path.join(options.dataDir, "models");
        try {
          const { TransformersEmbeddingService } = await import("@deeporca/embedding");
          const svc = new TransformersEmbeddingService({
            modelDir,
            logger: logger as unknown as {
              debug?: (m: string) => void;
              info: (m: string) => void;
              warn: (m: string) => void;
              error: (m: string) => void;
            },
          });
          // Trigger background model load; embed() will throw EmbeddingNotReadyError
          // (caught by callers → fail-open to BM25/FTS) until ready.
          svc.startWarmup();
          embeddingService = svc as unknown as EmbeddingService;
          logger?.debug?.(`${TAG} local-onnx embedding created (modelDir=${modelDir}), warmup started`);
        } catch (err) {
          // @deeporca/embedding not installed or load failure → fail-open (no embedding).
          logger?.warn?.(
            `${TAG} Failed to load @deeporca/embedding: ${err instanceof Error ? err.message : String(err)}. ` +
              `Falling back to no embedding (BM25/FTS only).`
          );
        }
      } else if (config.embedding.enabled && config.embedding.provider !== "local" && config.embedding.apiKey) {
        embeddingService = createEmbeddingService(
          {
            provider: config.embedding.provider,
            baseUrl: config.embedding.baseUrl,
            apiKey: config.embedding.apiKey,
            model: config.embedding.model,
            dimensions: config.embedding.dimensions,
            sendDimensions: config.embedding.sendDimensions,
            maxInputChars: config.embedding.maxInputChars,
          },
          logger
        );
      }

      // dimensions from config (0 when provider="none" → vec0 deferred)
      const dims = config.embedding.dimensions;
      const dbPath = path.join(options.dataDir, "vectors.db");
      const store = new VectorStore(dbPath, dims, logger);

      logger?.debug?.(
        `${TAG} Store created: backend=sqlite, dbPath=${dbPath}, dimensions=${dims}, ` +
          `embedding=${embeddingService ? "enabled" : "disabled"}, ` +
          `bm25=${bm25Encoder ? "enabled" : "disabled"}`
      );

      return {
        store,
        embedding: embeddingService as unknown as IEmbeddingService,
        bm25Encoder,
        storeSnapshot: {
          type: "sqlite",
          sqlitePath: path.relative(options.dataDir, dbPath),
        },
      };
    }
  }
}
