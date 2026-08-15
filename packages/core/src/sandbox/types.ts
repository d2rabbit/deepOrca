import type { PermissionScope } from "../settings";

// P2 Sans-IO policy core (specs/sandbox/design.md §4.4). Types only, zero
// I/O, no Electron/Node-only APIs beyond types — this module must stay
// importable from any sandbox backend.

/** The real 10 permission scopes (`settings.ts`) — never a fabricated set. */
export type SandboxScope = PermissionScope;

export const ALL_SANDBOX_SCOPES: readonly SandboxScope[] = [
  "read-in-cwd",
  "read-out-cwd",
  "write-in-cwd",
  "write-out-cwd",
  "delete-in-cwd",
  "delete-out-cwd",
  "query-git-log",
  "mutate-git-log",
  "network",
  "mcp",
];

export type SandboxVerdict = "allow" | "deny" | "ask";

/** Resolved verdict for every scope under a settings snapshot. */
export type SandboxPolicyMatrix = Readonly<Record<SandboxScope, SandboxVerdict>>;

/**
 * 3-state lifecycle — deliberately no Draining/grace: the desktop app has no
 * session-end event, the only real destroy point is `dispose()` (design.md
 * §4.4). A dead engine denies everything, forever.
 */
export type SandboxState = "creating" | "active" | "dead";

export type SandboxGeneration = {
  readonly id: number;
  readonly createdAt: string;
};

/**
 * Capability handle handed to a sandboxed execution context. Fenced by
 * generation: once a newer generation begins (or the engine dies), stale
 * leases must not be able to act — cheap dangling-handle protection.
 */
export type SandboxLease = {
  readonly generation: SandboxGeneration;
};
