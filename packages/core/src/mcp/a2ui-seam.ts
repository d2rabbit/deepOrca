/**
 * A2UI MCP Seam — the injection point for the built-in A2UI MCP server.
 *
 * Core defines this seam; Desktop injects the concrete implementation at boot.
 * The implementation (surface state, templates, MCP tools, persistence) lives
 * in Desktop — core only knows the lifecycle interface.
 *
 * The disable gate stays in core as pure state.
 */

export const A2UI_MCP_SERVER_NAME = "a2ui";

/** A server compatible with connectInProcessServer. */
export interface A2uiServerLike {
  connect(transport: unknown): Promise<void>;
}

/** Bundle returned by the builder: server + lifecycle hooks for surface state. */
export interface A2uiLifecycle {
  /** The MCP server to connect via connectInProcessServer. */
  server: A2uiServerLike;
  /** Called AFTER build, BEFORE connect — restores surfaces from disk. */
  restoreSurfaces(projectRoot: string): void;
  /** Called on session dispose — persists surfaces to disk. */
  persistSurfaces(projectRoot: string): void;
}

export type A2uiServerBuilder = (projectRoot: string) => A2uiLifecycle | null;

let builder: A2uiServerBuilder | null = null;

export function configureA2uiServerBuilder(b: A2uiServerBuilder | null): void {
  builder = b;
}

export function getA2uiServerBuilder(): A2uiServerBuilder | null {
  return builder;
}

// ── Disable gate (pure state, stays in core) ──────────────────────────────────

const disabledA2uiRoots = new Set<string>();

export function setA2uiDisabled(projectRoot: string, disabled: boolean): void {
  if (disabled) {
    disabledA2uiRoots.add(projectRoot);
  } else {
    disabledA2uiRoots.delete(projectRoot);
  }
}

export function isA2uiDisabled(projectRoot: string): boolean {
  return disabledA2uiRoots.has(projectRoot);
}
