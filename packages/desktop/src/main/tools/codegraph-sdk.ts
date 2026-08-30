/**
 * SdkCodegraphController — the desktop Adapter for CodeGraphController.
 *
 * Imports `@colbymchenry/codegraph` SDK directly and manages per-project
 * CodeGraph instances. Replaces the entire subprocess layer (resolveExecutable,
 * buildMcpServerConfig, spawn, node:sqlite runtime resolution) with in-process
 * SDK calls.
 *
 * The SDK runs on the host's Node runtime (Electron 43 = Node 24.18, which
 * has node:sqlite). tree-sitter grammars are loaded by the SDK internally.
 */

// Namespace import + runtime member access: the package's npm-sdk.js entry
// re-exports dynamically (`module.exports = require(resolveLibrary())`), so
// cjs-module-lexer cannot statically detect named exports and a static
// `import { CodeGraph }` crashes Electron's ESM main at link time.
import * as codegraphModule from "@colbymchenry/codegraph";

import { createRequire as nodeCreateRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";
import type { CodegraphController, ControllerProgress, ControllerSyncResult } from "@deeporca/core";

type CodeGraphInstance = codegraphModule.CodeGraph;

/** The SDK surface this adapter needs (resolved robustly below). */
interface CodegraphSdk {
  CodeGraph: typeof codegraphModule.CodeGraph;
  /** SDK's own initialized check: `.codegraph/` dir AND codegraph.db present. */
  isInitialized(projectRoot: string): boolean;
  /** SDK's own db path (honors the CODEGRAPH_DIR override). */
  getDatabasePath(projectRoot: string): string;
}

/**
 * Resolve the SDK module robustly (audit 2026-08-26 build failure:
 * "Cannot read properties of undefined (reading 'init')"). Because npm-sdk.js
 * is a DYNAMIC CJS re-export, esbuild's ESM namespace exposes ONLY `default`
 * — a plain destructure yields `undefined`, the codegraph stage then threw
 * before doing any work (which also made an existing index look like it
 * rebuilt in 0s). Unwrap default-first, and fail with an actionable message
 * instead of a cryptic TypeError when the bundle is genuinely missing.
 */
function resolveCodeGraphSdk(): CodegraphSdk {
  const mod = codegraphModule as unknown as CodegraphSdk & { default?: CodegraphSdk };
  const resolved = mod.CodeGraph ? mod : mod.default;
  if (!resolved || typeof resolved.CodeGraph?.init !== "function") {
    throw new Error(
      "CodeGraph SDK failed to load — interop/install problem. Ensure `@colbymchenry/codegraph` and its " +
        "platform bundle (`@colbymchenry/codegraph-<platform>-<arch>`) are installed."
    );
  }
  return resolved;
}

/** The index db path — SDK helper when present (CODEGRAPH_DIR-aware), else
 *  the default layout. */
function indexDbPath(root: string): string {
  try {
    const sdk = resolveCodeGraphSdk();
    if (typeof sdk.getDatabasePath === "function") return sdk.getDatabasePath(root);
  } catch {
    // SDK unloadable — fall through to the default layout.
  }
  return path.join(root, ".codegraph", "codegraph.db");
}

/**
 * Count real (non-import/unknown/file) symbols in an index db — the
 * "did indexing actually produce anything" check (audit 2026-08-28, same
 * class as wiki's exit-0-over-skeleton: indexAll resolving over an empty
 * parse used to light the 索引 status dot while the symbols tab stayed
 * empty). Read-only open; 0 on any failure.
 */
const nodeRequire = nodeCreateRequire(import.meta.url);

function countIndexedSymbols(root: string): number {
  const dbPath = indexDbPath(root);
  if (!fs.existsSync(dbPath)) return 0;
  try {
    // Lazy require (repo discipline: node:sqlite needs Node >= 22.5 — load it
    // at use so a runtime without it degrades to 0 here instead of failing at
    // bundle load; the static import broke that graceful path).
    // Minimal structural typing for the lazily-required module (import()
    // type annotations are lint-forbidden here): the constructor returns a
    // db with the two members countIndexedSymbols uses.
    type NodeSqliteDb = {
      prepare: (sql: string) => { get: () => unknown };
      close: () => void;
    };
    type NodeSqlite = { DatabaseSync: new (path: string, opts: { readOnly: boolean }) => NodeSqliteDb };
    const { DatabaseSync } = nodeRequire("node:sqlite") as NodeSqlite;
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const row = db.prepare("SELECT COUNT(*) AS n FROM nodes WHERE kind NOT IN ('import','unknown','file')").get() as {
        n: number;
      };
      return row.n;
    } finally {
      db.close();
    }
  } catch {
    return 0;
  }
}

export class SdkCodegraphController implements CodegraphController {
  /** Per-project-root CodeGraph instances (session is single-project). */
  private instances = new Map<string, CodeGraphInstance>();

  private async getOrOpen(root: string): Promise<CodeGraphInstance> {
    // open() requires an initialized project — callers route here only via
    // hasProject (usable index), so the hollow-dir case never reaches this.
    const { CodeGraph } = resolveCodeGraphSdk();
    let cg = this.instances.get(root);
    if (!cg) {
      cg = await CodeGraph.open(root, { sync: true });
      this.instances.set(root, cg);
    }
    return cg;
  }

  async reindex(root: string, onProgress?: (p: ControllerProgress) => void): Promise<void> {
    const { CodeGraph, isInitialized } = resolveCodeGraphSdk();
    onProgress?.({ message: "clearing existing index", percent: 5 });
    // Release the in-memory instance's db handle first (close() — NOT
    // uninitialize(), which also DELETES the directory; recreate() owns the
    // disk-level discard). An open handle would block the file unlink on
    // Windows.
    const old = this.instances.get(root);
    if (old) {
      try {
        old.close();
      } catch {
        // Best effort — may already be closed.
      }
      this.instances.delete(root);
    }
    onProgress?.({ message: "re-initializing CodeGraph", percent: 10 });
    // The two rebuild entry points are exact complements, each refusing the
    // other's state (real-machine 2026-08-30, GVGL first build): init()
    // throws "already initialized" on an indexed project, and recreate()
    // throws "not initialized … Run init() first" on a never-indexed one —
    // so a fresh workspace's first build must take init(), while an
    // initialized (incl. hollow 0-symbol) one takes recreate().
    //
    // recreate() is the SDK's documented "same result as a fresh init" path
    // (`codegraph index` semantics) for the initialized case: it discards
    // the existing db + WAL sidecars in O(1) and re-initializes instead of
    // opening the old database and DELETE-ing every row.
    const cg = isInitialized(root) ? await CodeGraph.recreate(root) : await CodeGraph.init(root);
    this.instances.set(root, cg);
    onProgress?.({ message: "indexing all files", percent: 20 });
    await cg.indexAll({
      onProgress: (p: { phase?: string; current?: number; total?: number }) => {
        const pct = p.total ? 20 + Math.floor((75 * (p.current ?? 0)) / (p.total ?? 1)) : undefined;
        onProgress?.({
          message: `${p.phase ?? "indexing"}: ${p.current ?? 0}/${p.total ?? "?"}`,
          percent: pct,
        });
      },
    });
    // Post-verify (audit 2026-08-28): a resolved indexAll proves nothing — an
    // empty parse (broken grammar load, wrong root, exclusion gone wrong)
    // used to read as a green stage and an "indexed" status dot over a 0-node
    // db. Fail loudly so the build row shows the real state.
    const nodeCount = countIndexedSymbols(root);
    if (nodeCount === 0) {
      throw new Error(
        "CodeGraph indexed 0 symbols — no parsable source files were found " +
          "(check the workspace root and grammar availability)"
      );
    }
    onProgress?.({ message: `CodeGraph index complete · ${nodeCount} symbols`, percent: 100 });
  }

  async sync(root: string, onProgress?: (p: ControllerProgress) => void): Promise<ControllerSyncResult | void> {
    const cg = await this.getOrOpen(root);
    // A sync behind the build button streams the same scanning/resolving
    // phases a re-index does (the SDK's ExtractionOrchestrator emits them),
    // then returns the change-count summary for the build log line.
    const result = await cg.sync({
      onProgress: (p: { phase?: string; current?: number; total?: number }) => {
        onProgress?.({
          message: `sync ${p.phase ?? "scanning"}: ${p.current ?? 0}/${p.total ?? "?"}`,
          percent: p.total ? Math.floor((100 * (p.current ?? 0)) / p.total) : undefined,
        });
      },
    });
    if (result) {
      return {
        filesChecked: result.filesChecked,
        filesAdded: result.filesAdded,
        filesModified: result.filesModified,
        filesRemoved: result.filesRemoved,
        durationMs: result.durationMs,
      };
    }
  }

  hasProject(root: string): boolean {
    // Routing input for sync-vs-reindex: "usable index", not "directory
    // exists" (audit 2026-08-28). The SDK's isInitialized requires dir AND
    // db; the node count on top routes a hollow/0-symbol leftover (failed
    // init, empty parse) to a FULL REBUILD instead of a sync-over-nothing
    // that would "succeed" while the symbols tab stays empty.
    try {
      const sdk = resolveCodeGraphSdk();
      if (typeof sdk.isInitialized === "function" && !sdk.isInitialized(root)) return false;
    } catch {
      // SDK unloadable — fall back to the db-file presence check below.
    }
    return fs.existsSync(indexDbPath(root)) && countIndexedSymbols(root) > 0;
  }

  getMcpServer(): { connect(transport: unknown): Promise<void> } | null {
    // The CodeGraph SDK's MCPServer does NOT expose connect(transport) — it's
    // a standalone stdio server (start/startDirect). In-process MCP bridging
    // would require wrapping SDK methods in our own McpServer (like A2UI).
    // For now, MCP tools stay as a subprocess via buildCodegraphMcpServerConfig
    // (npm-shim.js, the SDK's CLI entry). The controller handles init/sync only.
    return null;
  }
}
