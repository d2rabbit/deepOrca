import type { PermissionSettings } from "../settings";
import type { SandboxLease, SandboxPolicyMatrix, SandboxScope, SandboxState, SandboxVerdict } from "./types";
import { ALL_SANDBOX_SCOPES } from "./types";

// Sans-IO policy engine (specs/sandbox/design.md §4.4): resolves the real
// 10 permission scopes into a verdict matrix and guards it with a 3-state
// lifecycle plus generation fencing. Pure logic, zero I/O — the P3 sandbox
// backends consume this to build their platform profiles.

/**
 * Resolve one scope under a settings snapshot. Precedence mirrors
 * `evaluatePermissionScopes` (permissions.ts): deny > ask > allow >
 * defaultMode fallback.
 */
export function resolveScopeVerdict(scope: SandboxScope, settings: PermissionSettings): SandboxVerdict {
  if (settings.deny?.includes(scope)) {
    return "deny";
  }
  if (settings.ask?.includes(scope)) {
    return "ask";
  }
  if (settings.allow?.includes(scope)) {
    return "allow";
  }
  return settings.defaultMode === "askAll" ? "ask" : "allow";
}

/** Resolve every scope at once. */
export function buildPolicyMatrix(settings: PermissionSettings): SandboxPolicyMatrix {
  const matrix = {} as Record<SandboxScope, SandboxVerdict>;
  for (const scope of ALL_SANDBOX_SCOPES) {
    matrix[scope] = resolveScopeVerdict(scope, settings);
  }
  return matrix;
}

export class SandboxPolicyEngine {
  private state: SandboxState = "creating";
  private matrix: SandboxPolicyMatrix;
  private generationCounter = 0;

  constructor(settings: PermissionSettings) {
    this.matrix = buildPolicyMatrix(settings);
  }

  get lifecycleState(): SandboxState {
    return this.state;
  }

  /** Replace the settings snapshot; affects only future `decide` calls. */
  updateSettings(settings: PermissionSettings): void {
    if (this.state === "dead") {
      return;
    }
    this.matrix = buildPolicyMatrix(settings);
  }

  /** Issue a fresh capability handle; supersedes all earlier generations. */
  beginGeneration(): SandboxLease {
    this.generationCounter += 1;
    return { generation: { id: this.generationCounter, createdAt: new Date().toISOString() } };
  }

  /** creating → active. Idempotent; a dead engine stays dead. */
  activate(): void {
    if (this.state === "creating") {
      this.state = "active";
    }
  }

  /** Terminal: only real destroy point is host `dispose()` (design.md §4.4). */
  kill(): void {
    this.state = "dead";
  }

  isActionable(lease: SandboxLease): boolean {
    return this.state === "active" && lease.generation.id === this.generationCounter;
  }

  /**
   * Verdict for a lease + scope. Fail-closed: non-active engine or fenced
   * (stale) lease denies regardless of the policy matrix.
   */
  decide(lease: SandboxLease, scope: SandboxScope): SandboxVerdict {
    if (!this.isActionable(lease)) {
      return "deny";
    }
    return this.matrix[scope];
  }
}
