/**
 * Dart / Flutter MCP server integration.
 *
 * The official Dart MCP server (`dart mcp-server`, Dart SDK 3.9+) exposes
 * runtime layout analysis, widget-tree inspection, pub.dev search, test
 * execution, and `dart format` to AI agents. It is the companion to the
 * Flutter/Dart bundled skills — the skills teach the agent *how* to develop
 * Flutter apps; this MCP server lets the agent *interact* with a running
 * Flutter project (fetch runtime errors, inspect widget trees, search
 * packages, run tests).
 *
 * Unlike codegraph/CRG, the Dart MCP server is NOT a vendored binary — it
 * ships with the Dart SDK itself. We only register the spawn config; the user
 * must have `dart` (≥ 3.9) on PATH. If `dart` is absent, the config is simply
 * not registered and the Flutter skills still work (just without live runtime
 * introspection).
 *
 * Docs: https://docs.flutter.dev/ai/mcp-server
 */

import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import type { McpServerConfig } from "../settings";

export const DART_MCP_SERVER_NAME = "dart-mcp-server";

/** True when the project has a pubspec.yaml (Dart/Flutter project root). */
export function hasDartProject(projectRoot: string): boolean {
  return existsSync(path.join(projectRoot, "pubspec.yaml"));
}

/** Cache for the `dart` availability check (avoids repeated execSync calls). */
let dartChecked = false;
let dartAvailable = false;

/**
 * Check whether `dart` is on PATH and reports version ≥ 3.9 (the minimum for
 * `dart mcp-server`). Cached after the first call — PATH doesn't change mid-session.
 */
export function isDartMcpAvailable(): boolean {
  if (dartChecked) return dartAvailable;
  dartChecked = true;
  try {
    const version = execSync("dart --version 2>&1", {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    // Output looks like: "Dart SDK version: 3.9.0 (stable) ..."
    const match = version.match(/(\d+)\.(\d+)\.(\d+)/);
    if (!match) return false;
    const major = parseInt(match[1]!, 10);
    const minor = parseInt(match[2]!, 10);
    dartAvailable = major > 3 || (major === 3 && minor >= 9);
    return dartAvailable;
  } catch {
    return false;
  }
}

/**
 * Build the MCP server config for the Dart MCP server.
 * Returns null when `dart` is not on PATH or too old — the caller skips
 * registration so the absence surfaces as "no server" rather than a crash.
 */
export function buildDartMcpServerConfig(): McpServerConfig | null {
  if (!isDartMcpAvailable()) {
    return null;
  }
  return {
    command: "dart",
    args: ["mcp-server"],
  };
}
