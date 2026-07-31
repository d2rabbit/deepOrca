/**
 * HarmonyOS MCP server integration — DevEco CLI.
 *
 * DevEco CLI (`devecocli`, Huawei HDC 2026) provides project creation, build
 * (hvigor), deployment, emulator management, screenshot, layout inspection,
 * and documentation search for HarmonyOS apps. It supports both CLI mode
 * (default, via bash) and MCP mode (`devecocli mcp`).
 *
 * This module registers the MCP mode when `devecocli` is on PATH and the
 * project is a HarmonyOS project (build-profile.json5 / oh-package.json5).
 * The CLI mode is taught via the harmonyos-* bundled skills.
 *
 * Install: `npm i -g @deveco/deveco-cli`
 * Docs: https://developer.huawei.com/consumer/cn/deveco-cli/
 */

import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import type { McpServerConfig } from "../settings";

export const HARMONYOS_MCP_SERVER_NAME = "harmonyos-mcp";

// ── Disable flag (host-managed, per project root) ────────────────────────────

const disabledHarmonyosRoots = new Set<string>();

/** Enable or disable the built-in HarmonyOS MCP server for a project root. */
export function setHarmonyosDisabled(projectRoot: string, disabled: boolean): void {
  const key = path.resolve(projectRoot);
  if (disabled) {
    disabledHarmonyosRoots.add(key);
  } else {
    disabledHarmonyosRoots.delete(key);
  }
}

/** True when the built-in HarmonyOS MCP server has been disabled for a project root. */
export function isHarmonyosDisabled(projectRoot: string): boolean {
  return disabledHarmonyosRoots.has(path.resolve(projectRoot));
}

/** True when the project has a HarmonyOS project file. */
export function hasHarmonyosProject(projectRoot: string): boolean {
  return (
    existsSync(path.join(projectRoot, "build-profile.json5")) || existsSync(path.join(projectRoot, "oh-package.json5"))
  );
}

/** Cache for the `devecocli` availability check. */
let harmonyosChecked = false;
let harmonyosAvailable = false;

/**
 * Check whether `devecocli` is on PATH. Cached after the first call.
 */
export function isHarmonyosAvailable(): boolean {
  if (harmonyosChecked) return harmonyosAvailable;
  harmonyosChecked = true;
  try {
    execSync(process.platform === "win32" ? "where devecocli" : "which devecocli", {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    harmonyosAvailable = true;
    return true;
  } catch {
    return false;
  }
}

/**
 * Build the MCP server config for HarmonyOS DevEco CLI.
 * Returns null when `devecocli` is not on PATH.
 */
export function buildHarmonyosMcpServerConfig(): McpServerConfig | null {
  if (!isHarmonyosAvailable()) {
    return null;
  }
  return {
    command: "devecocli",
    args: ["serve", "mcp"],
  };
}
