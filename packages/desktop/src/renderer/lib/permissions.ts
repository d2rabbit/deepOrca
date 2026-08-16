// Permission scope helpers, ported from the CLI's PermissionPrompt, adapted for
// the desktop UI. Builds the UserToolPermission[] + alwaysAllows[] payload the
// core engine expects when resuming a paused turn.

import type { AskPermissionRequest, PermissionScope, UserToolPermission } from "../../shared/ipc";

// AskPermissionScope is a superset that includes "unknown"; we keep it loose here.
export type Scope = PermissionScope | "unknown" | string;

export type PermissionResult = {
  permissions: UserToolPermission[];
  alwaysAllows: PermissionScope[];
  /** Path-level always-allow grants (task 14): narrow, per-path persistence. */
  alwaysAllowPaths: { write: string[]; read: string[] };
  hasDeny: boolean;
};

export type ScopePrompt = { request: AskPermissionRequest; scope: Scope };

const ALWAYS_ALLOWED_SCOPES = new Set<string>([
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
]);

export function isAlwaysAllowedScope(scope: Scope): scope is PermissionScope {
  return ALWAYS_ALLOWED_SCOPES.has(scope);
}

export function buildScopePrompts(requests: AskPermissionRequest[]): ScopePrompt[] {
  const prompts: ScopePrompt[] = [];
  for (const request of requests) {
    const scopes = request.scopes.length > 0 ? request.scopes : ["unknown"];
    for (const scope of scopes) {
      prompts.push({ request, scope });
    }
  }
  return prompts;
}

export function buildResult(
  requests: AskPermissionRequest[],
  decisions: Record<string, "allow" | "deny">,
  alwaysAllows: PermissionScope[],
  alwaysAllowPaths: { write: string[]; read: string[] } = { write: [], read: [] }
): PermissionResult {
  const permissions: UserToolPermission[] = requests.map((request) => ({
    toolCallId: request.toolCallId,
    permission: decisions[request.toolCallId] === "deny" ? ("deny" as const) : ("allow" as const),
  }));
  return {
    permissions,
    alwaysAllows,
    alwaysAllowPaths,
    hasDeny: permissions.some((p) => p.permission === "deny"),
  };
}

/**
 * Unified "already granted" predicate for one ask prompt. MUST be used by
 * both the render-time skip loop and the submit-time remaining loop with the
 * SAME arguments — divergent conditions stall the card (review finding: the
 * card rendered null without submitting after a scope-level always-allow).
 */
export function isPromptGranted(
  scope: Scope,
  filePath: string | undefined,
  alwaysScopes: readonly string[],
  pathGrants: { write: readonly string[]; read: readonly string[] }
): boolean {
  if (alwaysScopes.includes(scope)) {
    return true;
  }
  const grant = pathGrantFor(scope, filePath);
  return grant ? pathGrants[grant.kind].some((path) => path === grant.path) : false;
}

/**
 * For a file-tool ask with a known path, "always allow" persists the PATH
 * (task 14) instead of the whole-disk scope. Returns the grant kind, or null
 * when the scope has no path to bind (bash, network, …).
 */
export function pathGrantFor(
  scope: Scope,
  filePath: string | undefined
): { kind: "write" | "read"; path: string } | null {
  if (!filePath) {
    return null;
  }
  if (scope === "write-out-cwd") {
    return { kind: "write", path: filePath };
  }
  if (scope === "read-out-cwd") {
    return { kind: "read", path: filePath };
  }
  return null;
}

export function scopeRiskColor(scope: Scope): string {
  switch (scope) {
    case "read-in-cwd":
    case "query-git-log":
      return "#3fb950";
    case "read-out-cwd":
    case "write-in-cwd":
    case "network":
    case "mcp":
      return "#d29922";
    default:
      return "#f85149";
  }
}

export function describeScope(scope: Scope): string {
  switch (scope) {
    case "read-in-cwd":
      return "reads inside this workspace";
    case "read-out-cwd":
      return "reads outside this workspace";
    case "write-in-cwd":
      return "writes inside this workspace";
    case "write-out-cwd":
      return "writes outside this workspace";
    case "delete-in-cwd":
      return "deletes inside this workspace";
    case "delete-out-cwd":
      return "deletes outside this workspace";
    case "query-git-log":
      return "Git history queries";
    case "mutate-git-log":
      return "Git history changes";
    case "network":
      return "network access";
    case "mcp":
      return "MCP tool access";
    default:
      return String(scope);
  }
}
