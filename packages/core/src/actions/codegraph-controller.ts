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

/** Change-count summary of an incremental sync (empty when the adapter
 *  can't produce one — e.g. the CRG CLI path). Mirrors the SDK's SyncResult. */
export interface ControllerSyncResult {
  filesChecked: number;
  filesAdded: number;
  filesModified: number;
  filesRemoved: number;
  durationMs: number;
}

export interface CodegraphController {
  /** Full re-index: clear existing `.codegraph/` and rebuild from scratch. */
  reindex(root: string, onProgress?: (p: ControllerProgress) => void): Promise<void>;

  /** Incremental sync — re-parse only changed files. Fire-and-forget safe.
   *  onProgress streams the same scanning/resolving phases a re-index emits
   *  (a sync behind the build button must show flow, not a frozen line); the
   *  resolved summary feeds the change-count log line. */
  sync(root: string, onProgress?: (p: ControllerProgress) => void): Promise<ControllerSyncResult | void>;

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
