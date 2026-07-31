/**
 * Expo / React Native MCP server integration.
 *
 * Expo's MCP server (`npx expo mcp`) provides SDK knowledge injection, mobile
 * simulator interaction, and React Native DevTools access for AI agents.
 *
 * This module registers the MCP server when the project is a React Native /
 * Expo project (app.json with expo config, or package.json with react-native
 * dependency) and `npx expo` is available.
 *
 * Docs: https://docs.expo.dev/mcp/
 */

import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import type { McpServerConfig } from "../settings";

export const EXPO_MCP_SERVER_NAME = "expo-mcp";

// ── Disable flag (host-managed, per project root) ────────────────────────────

const disabledExpoRoots = new Set<string>();

/** Enable or disable the built-in Expo MCP server for a project root. */
export function setExpoDisabled(projectRoot: string, disabled: boolean): void {
  const key = path.resolve(projectRoot);
  if (disabled) {
    disabledExpoRoots.add(key);
  } else {
    disabledExpoRoots.delete(key);
  }
}

/** True when the built-in Expo MCP server has been disabled for a project root. */
export function isExpoDisabled(projectRoot: string): boolean {
  return disabledExpoRoots.has(path.resolve(projectRoot));
}

/**
 * True when the project is a React Native / Expo project.
 * Checks for app.json with expo config OR package.json with react-native dep.
 */
export function hasReactNativeProject(projectRoot: string): boolean {
  // Check app.json for expo config
  const appJsonPath = path.join(projectRoot, "app.json");
  if (existsSync(appJsonPath)) {
    try {
      const appJson = JSON.parse(readFileSync(appJsonPath, "utf8"));
      if (appJson.expo) return true;
    } catch {
      // Malformed JSON — fall through.
    }
  }
  // Check package.json for react-native dependency
  const pkgJsonPath = path.join(projectRoot, "package.json");
  if (existsSync(pkgJsonPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
      const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
      if (deps["react-native"] || deps["expo"]) return true;
    } catch {
      // Malformed — fall through.
    }
  }
  return false;
}

/** Cache for the Expo availability check. */
let expoChecked = false;
let expoAvailable = false;

/**
 * Check whether `npx expo` is available. Cached after the first call.
 */
export function isExpoAvailable(): boolean {
  if (expoChecked) return expoAvailable;
  expoChecked = true;
  try {
    execSync("npx expo --version", {
      encoding: "utf8",
      timeout: 15000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    expoAvailable = true;
    return true;
  } catch {
    return false;
  }
}

/**
 * Build the MCP server config for Expo.
 *
 * Expo MCP is a REMOTE HTTP server (https://mcp.expo.dev/mcp), not a local
 * stdio subprocess. There is no `expo mcp` CLI subcommand — the local dev
 * server flow requires EXPO_UNSTABLE_MCP_SERVER=1 + running `expo start`.
 *
 * Since DeepOrca's McpServerConfig only supports stdio (command + args),
 * we cannot auto-register the remote Expo MCP. Instead, users should manually
 * configure it in settings if their MCP client supports HTTP transport
 * (planned Phase 0 of plugin hub — see roadmap §十二).
 *
 * Returns null to skip auto-registration. Users add it manually.
 */
export function buildExpoMcpServerConfig(): McpServerConfig | null {
  // Expo MCP is remote-only — no local stdio spawn possible.
  // Auto-registration disabled until HTTP MCP transport is supported.
  return null;
}
