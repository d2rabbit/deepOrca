import * as fs from "fs";
import * as path from "path";
import { createRequire } from "node:module";
import { getUserConfigRoot } from "../common/app-dirs";

// CommonJS-style require bound to this module — works in both the ESM dist and
// bundled outputs. `node:sqlite` is loaded lazily so merely importing this file
// never crashes on runtimes without sqlite support.
const moduleRequire = createRequire(import.meta.url);

/** One indexed documentation chunk. */
export type DocChunk = {
  /** Heading path like "Install > macOS"; empty string for preamble content. */
  heading: string;
  content: string;
};

/** Per-repository index metadata, as shown in the GitMCP panel. */
export type GitmcpRepoMeta = {
  slug: string;
  /** Which document was indexed: "llms.txt" | "llms-full.txt" | "readme". */
  docSource: string | null;
  /** Unix ms of the last successful fetch+index, or null when never indexed. */
  fetchedAt: number | null;
  chunkCount: number;
};

/** A search result row. Lower `score` = better (bm25 rank). */
export type SearchHit = {
  heading: string;
  content: string;
  score: number;
};

/**
 * Retrieval backend abstraction. The FTS5 implementation is the only one for
 * now; a future `VecBackend` (sqlite-vec + embeddings, the reserved
 * `chunks.embedding` column) plugs in here without touching callers.
 */
export interface SearchBackend {
  /** (Re)index the given chunks for a repository. */
  index(repoId: number, chunks: DocChunk[]): void;
  /** Query a repository's chunks, best matches first. */
  search(repoId: number, query: string, limit: number): SearchHit[];
}

/** Default location of the shared multi-repository index database. */
export function getGitmcpIndexDbPath(): string {
  return path.join(getUserConfigRoot(), "gitmcp", "index.db");
}

/**
 * True when the *current* process can load `node:sqlite`. Hosts without it
 * (e.g. the Electron main process on Node < 22) must run index maintenance in
 * an external sqlite-capable runtime via `buildGitmcpMaintenanceCommand()`.
 */
export function gitmcpSqliteAvailable(): boolean {
  try {
    moduleRequire("node:sqlite");
    return true;
  } catch {
    return false;
  }
}

// node:sqlite's DatabaseSync, typed loosely to keep the lazy require simple.
type SqliteDatabase = {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
    get(...params: unknown[]): Record<string, unknown> | undefined;
    all(...params: unknown[]): Array<Record<string, unknown>>;
  };
  close(): void;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS repos (
  id INTEGER PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  doc_source TEXT,
  fetched_at INTEGER,
  chunk_count INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS chunks (
  id INTEGER PRIMARY KEY,
  repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  heading TEXT,
  content TEXT NOT NULL,
  embedding BLOB
);
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(heading, content, content=chunks, content_rowid=id);
CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts(rowid, heading, content) VALUES (new.id, new.heading, new.content);
END;
CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, heading, content) VALUES ('delete', old.id, old.heading, old.content);
END;
CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, heading, content) VALUES ('delete', old.id, old.heading, old.content);
  INSERT INTO chunks_fts(rowid, heading, content) VALUES (new.id, new.heading, new.content);
END;
`;

/**
 * Turn free text into an FTS5 MATCH expression that cannot break the query
 * syntax: split into word tokens and quote each one (implicit AND).
 */
export function toFtsQuery(query: string): string {
  const tokens = query.match(/[\p{L}\p{N}_]+/gu) ?? [];
  return tokens.map((t) => `"${t}"`).join(" ");
}

/** FTS5/BM25 retrieval — the only backend this release. */
class Fts5Backend implements SearchBackend {
  constructor(private readonly db: SqliteDatabase) {}

  index(repoId: number, chunks: DocChunk[]): void {
    // Triggers keep chunks_fts in sync with the content table.
    this.db.prepare("DELETE FROM chunks WHERE repo_id = ?").run(repoId);
    const insert = this.db.prepare("INSERT INTO chunks (repo_id, heading, content) VALUES (?, ?, ?)");
    for (const chunk of chunks) {
      insert.run(repoId, chunk.heading, chunk.content);
    }
  }

  search(repoId: number, query: string, limit: number): SearchHit[] {
    const match = toFtsQuery(query);
    if (!match) {
      return [];
    }
    const rows = this.db
      .prepare(
        `SELECT c.heading AS heading, c.content AS content, bm25(chunks_fts) AS score
         FROM chunks_fts JOIN chunks c ON c.id = chunks_fts.rowid
         WHERE chunks_fts MATCH ? AND c.repo_id = ?
         ORDER BY score LIMIT ?`
      )
      .all(match, repoId, limit);
    return rows.map((row) => ({
      heading: String(row.heading ?? ""),
      content: String(row.content ?? ""),
      score: Number(row.score ?? 0),
    }));
  }
}

/**
 * The shared GitMCP index store (`<config>/gitmcp/index.db`, one database
 * for all repositories). Opens lazily on first use; requires a runtime with
 * `node:sqlite` (guaranteed for the server process by the spawn-config
 * resolution, and for Electron ≥35 in the desktop main process).
 */
export class GitmcpStore {
  private db: SqliteDatabase | null = null;
  private backend: SearchBackend | null = null;

  constructor(private readonly dbPath: string = getGitmcpIndexDbPath()) {}

  private open(): SqliteDatabase {
    if (this.db) {
      return this.db;
    }
    const { DatabaseSync } = moduleRequire("node:sqlite") as {
      DatabaseSync: new (path: string) => SqliteDatabase;
    };
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    const db = new DatabaseSync(this.dbPath);
    db.exec("PRAGMA foreign_keys = ON");
    db.exec(SCHEMA);
    this.db = db;
    this.backend = new Fts5Backend(db);
    return db;
  }

  private getBackend(): SearchBackend {
    this.open();
    return this.backend as SearchBackend;
  }

  /** Replace a repository's indexed document with freshly chunked content. */
  upsertRepoDocument(slug: string, docSource: string, chunks: DocChunk[]): void {
    const db = this.open();
    db.exec("BEGIN");
    try {
      db.prepare(
        `INSERT INTO repos (slug, doc_source, fetched_at, chunk_count) VALUES (?, ?, ?, ?)
         ON CONFLICT(slug) DO UPDATE SET doc_source = excluded.doc_source,
           fetched_at = excluded.fetched_at, chunk_count = excluded.chunk_count`
      ).run(slug, docSource, Date.now(), chunks.length);
      const repoId = this.getRepoId(slug);
      if (repoId !== null) {
        this.getBackend().index(repoId, chunks);
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  private getRepoId(slug: string): number | null {
    const row = this.open().prepare("SELECT id FROM repos WHERE slug = ?").get(slug);
    return row ? Number(row.id) : null;
  }

  /** Index metadata for one repository, or null when it was never indexed. */
  getRepoMeta(slug: string): GitmcpRepoMeta | null {
    const row = this.open()
      .prepare("SELECT slug, doc_source, fetched_at, chunk_count FROM repos WHERE slug = ?")
      .get(slug);
    return row ? toRepoMeta(row) : null;
  }

  /** Index metadata for every repository in the database. */
  listRepoMeta(): GitmcpRepoMeta[] {
    return this.open()
      .prepare("SELECT slug, doc_source, fetched_at, chunk_count FROM repos ORDER BY slug")
      .all()
      .map(toRepoMeta);
  }

  /** All indexed chunks of a repository, in document order (cache fallback). */
  getRepoChunks(slug: string): DocChunk[] {
    const repoId = this.getRepoId(slug);
    if (repoId === null) {
      return [];
    }
    return this.open()
      .prepare("SELECT heading, content FROM chunks WHERE repo_id = ? ORDER BY id")
      .all(repoId)
      .map((row) => ({ heading: String(row.heading ?? ""), content: String(row.content ?? "") }));
  }

  /** Search one repository's chunks; best matches first. */
  search(slug: string, query: string, limit = 8): SearchHit[] {
    const repoId = this.getRepoId(slug);
    if (repoId === null) {
      return [];
    }
    return this.getBackend().search(repoId, query, limit);
  }

  /** Drop a repository and its chunks (FTS rows go via trigger + CASCADE). */
  removeRepo(slug: string): void {
    this.open().prepare("DELETE FROM repos WHERE slug = ?").run(slug);
  }

  close(): void {
    if (this.db) {
      try {
        this.db.close();
      } catch {
        // Already closed — nothing to release.
      }
      this.db = null;
      this.backend = null;
    }
  }
}

function toRepoMeta(row: Record<string, unknown>): GitmcpRepoMeta {
  return {
    slug: String(row.slug),
    docSource: row.doc_source == null ? null : String(row.doc_source),
    fetchedAt: row.fetched_at == null ? null : Number(row.fetched_at),
    chunkCount: Number(row.chunk_count ?? 0),
  };
}

/** Delete a repository's index data. Missing db / sqlite support is a no-op. */
export function removeGitmcpRepoIndex(slug: string, dbPath?: string): void {
  const resolved = dbPath ?? getGitmcpIndexDbPath();
  if (!fs.existsSync(resolved)) {
    return;
  }
  const store = new GitmcpStore(resolved);
  try {
    store.removeRepo(slug);
  } catch {
    // No sqlite runtime or corrupt db — index cleanup is best-effort.
  } finally {
    store.close();
  }
}

/**
 * Read index metadata for the panel without throwing: returns `[]` when the
 * database does not exist yet or the host runtime lacks `node:sqlite`.
 */
export function readGitmcpRepoMeta(dbPath?: string): GitmcpRepoMeta[] {
  const resolved = dbPath ?? getGitmcpIndexDbPath();
  if (!fs.existsSync(resolved)) {
    return [];
  }
  const store = new GitmcpStore(resolved);
  try {
    return store.listRepoMeta();
  } catch {
    return [];
  } finally {
    store.close();
  }
}
