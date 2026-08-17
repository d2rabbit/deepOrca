/**
 * CodegraphController — the Seam between core's generic engine (session,
 * actions, index-build-all) and the actual CodeGraph execution layer.
 *
 * Core defines this Interface; desktop injects a concrete Adapter
 * (`SdkCodegraphController` that imports `@colbymchenry/codegraph` directly).
 * Tests inject a mock. This keeps core free of any CodeGraph-specific
 * (SDK, subprocess, node:sqlite, tree-sitter) code.
 *
 * Design (codebase-design skill): DEEP module — 5 methods hide SDK init,
 * index/sync lifecycle, MCPServer creation, file watching, and DB management.
 */

/** Progress callback shape shared across all controllers. */
export interface ControllerProgress {
  message: string;
  percent?: number;
}

export interface CodegraphController {
  /** Full re-index: clear existing `.codegraph/` and rebuild from scratch. */
  reindex(root: string, onProgress?: (p: ControllerProgress) => void): Promise<void>;

  /** Incremental sync — re-parse only changed files. Fire-and-forget safe. */
  sync(root: string): Promise<void>;

  /** True when `.codegraph/` exists (index has been initialized). */
  hasProject(root: string): boolean;

  /**
   * Return an in-process MCP server object (has `.connect(transport)`) for the
   * current project, or null when no index exists. The caller registers it via
   * `mcpManager.connectInProcessServer("codegraph", server)`.
   */
  getMcpServer(): { connect(transport: unknown): Promise<void> } | null;
}

let controller: CodegraphController | null = null;

/** Inject the CodeGraph controller (called once at desktop boot). */
export function configureCodegraphController(c: CodegraphController | null): void {
  controller = c;
}

/** The configured controller, or null when the host hasn't injected one. */
export function getCodegraphController(): CodegraphController | null {
  return controller;
}
