/**
 * SkillSpector MCP server — disable gate (pure state, stays in core).
 *
 * All spawn/provisioning logic has been migrated to the desktop adapter
 * (SkillSpectorCliController in packages/desktop/src/main/tools/skill-spector-cli.ts).
 * Core accesses it through the SkillSpectorController seam
 * (packages/core/src/actions/skill-spector-controller.ts).
 */

import path from "node:path";

export const SKILL_SPECTOR_MCP_SERVER_NAME = "skill-spector";

// ── Disable flag (host-managed, per project root) ────────────────────────────

const disabledSkillSpectorRoots = new Set<string>();

export function setSkillSpectorDisabled(projectRoot: string, disabled: boolean): void {
  const key = path.resolve(projectRoot);
  if (disabled) {
    disabledSkillSpectorRoots.add(key);
  } else {
    disabledSkillSpectorRoots.delete(key);
  }
}

export function isSkillSpectorDisabled(projectRoot: string): boolean {
  return disabledSkillSpectorRoots.has(path.resolve(projectRoot));
}
