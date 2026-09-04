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

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path, { join } from "node:path";
import type { McpServerConfig } from "@deeporca/core";
import type { SerenaController } from "@deeporca/core";
import { getUserConfigRoot } from "@deeporca/core";

// ── SERENA_HOME management ──────────────────────────────────────────────────

const SERENA_CONFIG_DIR_NAME = "serena-config";
const SERENA_CONFIG_FILE_NAME = "serena_config.yml";

/** True when `candidate` resolves strictly inside `root`. */
function isWithinRoot(root: string, candidate: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(candidate));
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * SECURITY (scan fix): versions read from the vendored marker file flow into
 * the uv argv — only a plain token (no shell metacharacters, no traversal)
 * may pass.
 */
const SERENA_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

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
  const configRoot = path.resolve(getUserConfigRoot());
  const home = path.join(configRoot, SERENA_CONFIG_DIR_NAME);
  try {
    // containment check (security scan): home and the config file must stay
    // under the user config root before anything is read or written.
    if (!isWithinRoot(configRoot, home)) {
      throw new Error("SERENA home escaped the user config root");
    }
    const configFile = path.join(home, SERENA_CONFIG_FILE_NAME);
    if (!isWithinRoot(configRoot, configFile)) {
      throw new Error("SERENA config file escaped the user config root");
    }
    mkdirSync(home, { recursive: true });
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

    // 2. System uv on PATH — argv-form lookup with a literal command per
    // platform, no shell string.
    try {
      if (process.platform === "win32") {
        execFileSync("where", ["uv"], {
          encoding: "utf8",
          timeout: 3000,
          stdio: ["ignore", "pipe", "ignore"],
          windowsHide: true,
        });
      } else {
        execFileSync("which", ["uv"], {
          encoding: "utf8",
          timeout: 3000,
          stdio: ["ignore", "pipe", "ignore"],
          windowsHide: true,
        });
      }
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

    // SECURITY (scan fix): validate every dynamic value that flows into the
    // argv array — uv binary (absolute path), project root (absolute path),
    // vendored Serena version (plain token). argv-form only, never a shell string.
    if (uvBinary && (!path.isAbsolute(uvBinary) || uvBinary.split(/[\\/]/).includes(".."))) {
      return null;
    }
    if (!path.isAbsolute(projectRoot) || projectRoot.split(/[\\/]/).includes("..")) {
      return null;
    }

    // Version pin: read from vendor marker for reproducibility.
    // Prefer local wheel (offline) if available; fall back to PyPI spec (online).
    const pinnedVersion = this.readPinnedVersion();
    if (pinnedVersion && !SERENA_VERSION_PATTERN.test(pinnedVersion)) {
      return null;
    }
    const serenaSpec = this.resolveSerenaSpec(pinnedVersion);

    const prefixArgs = uvBinary
      ? ["tool", "run", "--python", "3.13", "--from", serenaSpec, "serena-agent"]
      : ["--python", "3.13", "--from", serenaSpec, "serena-agent"];

    return {
      command,
      args: [...prefixArgs, "start-mcp-server", "--context", "ide-assistant", "--project", projectRoot],
      env: {
        SERENA_HOME: ensureSerenaHeadlessHome(),
        // Serena's MCP responses ride its Python stdout. Under Electron the
        // piped stdout is block-buffered (~8KB) and FastMCP does not flush
        // after small writes — the initialize response (~200B) sits in the
        // buffer, the SDK handshake times out (30s) and the manager marks the
        // server failed with no retry. Forcing unbuffered stdout makes the
        // handshake reply land in ~5ms (verified via Electron+cross-spawn
        // probe); big responses flushed regardless, which is why tools/list
        // worked once initialize got unstuck.
        PYTHONUNBUFFERED: "1",
      },
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

  /** Prefer local wheel (offline), fall back to PyPI spec. */
  private resolveSerenaSpec(version: string | null): string {
    if (version) {
      const wheelName = `serena_agent-${version}-py3-none-any.whl`;
      const wheelPath = join(this.opts.vendorRoot, wheelName);
      // containment check (security scan): the wheel must be an absolute path
      // inside the vendored serena root before it enters the uv argv.
      if (
        path.isAbsolute(wheelPath) &&
        !wheelPath.split(/[\\/]/).includes("..") &&
        isWithinRoot(this.opts.vendorRoot, wheelPath) &&
        existsSync(wheelPath)
      ) {
        return wheelPath;
      }
      return `serena-agent==${version}`;
    }
    return "serena-agent";
  }
}
