/**
 * SerenaCliController — desktop Adapter for SerenaController.
 *
 * Migrated from packages/core/src/common/serena-mcp.ts. All spawn/config logic
 * (uv command assembly, SERENA_HOME management, version pinning, availability check)
 * lives here. Core only knows the SerenaController interface.
 *
 * Serena is spawned as a stdio subprocess: `uv tool run --from serena-agent==<ver>
 * serena-agent start-mcp-server --context ide-assistant --project <root>`.
 * The --context ide-assistant flag suppresses Serena's file/search/shell tools
 * (DeepOrca provides its own), exposing only semantic symbol tools.
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { McpServerConfig } from "@deeporca/core";
import type { SerenaController } from "@deeporca/core";
import { getUserConfigRoot } from "@deeporca/core";

// ── SERENA_HOME management ──────────────────────────────────────────────────

const SERENA_CONFIG_DIR_NAME = "serena-config";
const SERENA_CONFIG_FILE_NAME = "serena_config.yml";

// Serena's SerenaConfig.from_config_file() HARD-requires a top-level `projects`
// key. We pass projects via --project, so an empty list satisfies the schema.
// web_dashboard:false disables the entire dashboard subsystem (on Windows,
// Serena's tray_manager pops a native window even when only open_on_launch is false).
const SERENA_CONFIG_CONTENT =
  "# Managed by DeepOrca — runs Serena silently as a stdio MCP server.\n" +
  "# The `projects` key is REQUIRED by SerenaConfig; we activate the real\n" +
  "# project via --project on the CLI, so an empty list just satisfies the schema.\n" +
  "web_dashboard: false\n" +
  "web_dashboard_open_on_launch: false\n" +
  "projects: []\n";

/**
 * Ensure a DeepOrca-managed SERENA_HOME directory exists with a config that
 * disables Serena's dashboard. Serena rewrites this file on every startup
 * (adding default fields), so we check and patch every time.
 */
function ensureSerenaHeadlessHome(): string {
  const home = path.join(getUserConfigRoot(), SERENA_CONFIG_DIR_NAME);
  try {
    mkdirSync(home, { recursive: true });
    const configFile = path.join(home, SERENA_CONFIG_FILE_NAME);
    const existing = existsSync(configFile) ? readFileSync(configFile, "utf8") : "";
    const needsWrite = !existing || !existing.includes("projects:") || !existing.includes("web_dashboard: false");
    if (needsWrite) {
      if (existing && existing.includes("projects:")) {
        // Serena rewrote the file — patch dashboard keys in place (preserves additions).
        let patched = existing;
        patched = patched.replace(/^web_dashboard:.*$/m, "web_dashboard: false");
        patched = patched.replace(/^web_dashboard_open_on_launch:.*$/m, "web_dashboard_open_on_launch: false");
        if (!/^web_dashboard:\s*false/m.test(patched)) {
          patched = `web_dashboard: false\n` + patched;
        }
        writeFileSync(configFile, patched, "utf8");
      } else {
        writeFileSync(configFile, SERENA_CONFIG_CONTENT, "utf8");
      }
    }
  } catch {
    // Best-effort: if we can't write the config, Serena falls back to defaults.
  }
  return home;
}

// ── Adapter ────────────────────────────────────────────────────────────────

export class SerenaCliController implements SerenaController {
  constructor(
    private opts: {
      /** Resolved uv binary path, or null to fall back to system uvx. */
      uvBinary: string | null;
      /** Path to vendor/serena/ containing .vendored-serena-version. */
      vendorRoot: string;
    }
  ) {}

  private cachedAvailable: boolean | null = null;

  isAvailable(): boolean {
    if (this.cachedAvailable !== null) return this.cachedAvailable;

    // 1. Vendored uv binary.
    if (this.opts.uvBinary) {
      this.cachedAvailable = true;
      return true;
    }

    // 2. System uv on PATH.
    try {
      execSync(process.platform === "win32" ? "where uv" : "which uv", {
        encoding: "utf8",
        timeout: 3000,
        stdio: ["ignore", "pipe", "ignore"],
      });
      this.cachedAvailable = true;
      return true;
    } catch {
      this.cachedAvailable = false;
      return false;
    }
  }

  buildMcpServerConfig(projectRoot: string): McpServerConfig | null {
    if (!this.isAvailable()) return null;

    const uvBinary = this.opts.uvBinary;
    const command = uvBinary ?? "uvx";

    // Version pin: read from vendor marker for reproducibility.
    const pinnedVersion = this.readPinnedVersion();
    const serenaSpec = pinnedVersion ? `serena-agent==${pinnedVersion}` : "serena-agent";

    const prefixArgs = uvBinary
      ? ["tool", "run", "--python", "3.13", "--from", serenaSpec, "serena-agent"]
      : ["--python", "3.13", "--from", serenaSpec, "serena-agent"];

    return {
      command,
      args: [...prefixArgs, "start-mcp-server", "--context", "ide-assistant", "--project", projectRoot],
      env: { SERENA_HOME: ensureSerenaHeadlessHome() },
    };
  }

  private readPinnedVersion(): string | null {
    try {
      const ver = readFileSync(path.join(this.opts.vendorRoot, ".vendored-serena-version"), "utf8").trim();
      return ver || null;
    } catch {
      return null;
    }
  }
}
