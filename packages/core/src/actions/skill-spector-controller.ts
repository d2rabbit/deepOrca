/**
 * SkillSpectorController — the Seam for SkillSpector MCP server operations.
 *
 * SkillSpector (NVIDIA) is a Python MCP server providing skill/MCP security
 * scanning (prompt injection, data exfiltration, supply-chain CVEs).
 *
 * Desktop injects SkillSpectorCliController which handles all spawn/provisioning
 * logic (uv tool install, wheel/git fallback, version pinning).
 */

import type { McpServerConfig } from "../settings";

export interface SkillSpectorController {
  /** Build the MCP server spawn config. Returns null when unavailable. */
  buildMcpServerConfig(root: string): McpServerConfig | null;
}

let controller: SkillSpectorController | null = null;

export function configureSkillSpectorController(c: SkillSpectorController | null): void {
  controller = c;
}

export function getSkillSpectorController(): SkillSpectorController | null {
  return controller;
}
