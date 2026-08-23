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
  /**
   * Called on session dispose — persists surfaces to disk. When `idPrefix` is
   * given, only surfaces whose id starts with it are written and only same-
   * prefixed stale files are cleared (background tasks flush their arch-*
   * surfaces this way without touching the user's design prototypes).
   * When `sinceStamp` (from {@link surfaceStamp}) is also given, only surfaces
   * mutated after that stamp are written — a background task flushes exactly
   * what it produced, never surfaces left over from an earlier task in the
   * same process (e.g. a build of a different workspace root).
   */
  persistSurfaces(projectRoot: string, idPrefix?: string, sinceStamp?: number): void;
  /**
   * Current monotonic surface-mutation stamp. Snapshot before a background
   * task and pass as `sinceStamp` to persistSurfaces afterwards. Optional:
   * hosts without it get the full prefix-scoped flush.
   */
  surfaceStamp?(): number;
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
