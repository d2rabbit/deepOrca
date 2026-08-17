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
import * as fs from "node:fs";
import * as path from "node:path";
import type { CodegraphController, ControllerProgress } from "@deeporca/core";

const { CodeGraph } = codegraphModule;
type CodeGraphInstance = codegraphModule.CodeGraph;

export class SdkCodegraphController implements CodegraphController {
  /** Per-project-root CodeGraph instances (session is single-project). */
  private instances = new Map<string, CodeGraphInstance>();

  private async getOrOpen(root: string): Promise<CodeGraphInstance> {
    let cg = this.instances.get(root);
    if (!cg) {
      cg = await CodeGraph.open(root, { sync: true });
      this.instances.set(root, cg);
    }
    return cg;
  }

  async reindex(root: string, onProgress?: (p: ControllerProgress) => void): Promise<void> {
    onProgress?.({ message: "clearing existing index", percent: 5 });
    // Destroy old instance if any, then init fresh.
    const old = this.instances.get(root);
    if (old) {
      try {
        await old.uninitialize();
      } catch {
        // Best effort — may already be closed.
      }
      this.instances.delete(root);
    }
    onProgress?.({ message: "initializing CodeGraph", percent: 10 });
    const cg = await CodeGraph.init(root);
    this.instances.set(root, cg);
    onProgress?.({ message: "indexing all files", percent: 20 });
    await cg.indexAll({
      onProgress: (p: { phase?: string; current?: number; total?: number }) => {
        const pct = p.total ? 20 + Math.floor((75 * (p.current ?? 0)) / p.total) : undefined;
        onProgress?.({
          message: `${p.phase ?? "indexing"}: ${p.current ?? 0}/${p.total ?? "?"}`,
          percent: pct,
        });
      },
    });
    onProgress?.({ message: "CodeGraph index complete", percent: 100 });
  }

  async sync(root: string): Promise<void> {
    const cg = await this.getOrOpen(root);
    await cg.sync();
  }

  hasProject(root: string): boolean {
    return fs.existsSync(path.join(root, ".codegraph"));
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
