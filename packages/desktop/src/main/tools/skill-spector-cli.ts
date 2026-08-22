/**
 * SkillSpectorCliController — desktop Adapter for SkillSpectorController.
 *
 * Migrated from packages/core/src/common/skill-spector.ts. All spawn/provisioning
 * logic (uv tool install, wheel/git fallback, version pinning, async background
 * provisioning) lives here. Core only knows the SkillSpectorController interface.
 */

import { execFile, execFileSync, type ExecFileSyncOptionsWithStringEncoding } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { McpServerConfig } from "@deeporca/core";
import type { SkillSpectorController } from "@deeporca/core";
import { resolveUvBinary } from "@deeporca/core";

// ── Constants ─────────────────────────────────────────────────────────────────

const SKILLSPECTOR_GIT_URL = "https://github.com/NVIDIA/SkillSpector.git";
const DEFAULT_VERSION = "2.5.1";
const VERSION_RE = /^[A-Za-z0-9._]+$/;

function buildWheelUrl(version: string): string {
  return `https://github.com/NVIDIA/SkillSpector/releases/download/v${version}/skillspector-${version}-py3-none-any.whl`;
}

// ── Adapter ───────────────────────────────────────────────────────────────────

export class SkillSpectorCliController implements SkillSpectorController {
  constructor(private opts: { vendorRoot: string }) {}

  private installedVersion: string | null = null;
  private provisioning = false;
  private logger: ((msg: string, detail?: unknown) => void) | null = null;

  setLogger(log: ((msg: string, detail?: unknown) => void) | null): void {
    this.logger = log;
  }

  buildMcpServerConfig(_projectRoot: string): McpServerConfig | null {
    const uvBinary = resolveUvBinary();
    if (!uvBinary) return null;

    const targetVersion = this.readPinnedVersion();
    if (!targetVersion) return null;

    if (!this.isProvisioned(targetVersion)) {
      void this.provisionInBackground(uvBinary, targetVersion);
      return null;
    }
    if (this.installedVersion !== targetVersion && this.installedVersion !== `${targetVersion}-git`) {
      void this.provisionInBackground(uvBinary, targetVersion);
    }

    return {
      command: uvBinary,
      args: ["tool", "run", "skillspector", "mcp"],
      env: {
        // Same Electron stdout block-buffering hazard as Serena (see
        // serena-cli.ts): the MCP handshake reply is small and FastMCP-style
        // servers don't flush after writes — force unbuffered Python stdout.
        PYTHONUNBUFFERED: "1",
      },
    };
  }

  // ── Version pin ─────────────────────────────────────────────────────────────

  private readPinnedVersion(): string | null {
    try {
      const ver = readFileSync(path.join(this.opts.vendorRoot, ".vendored-skillspector-version"), "utf8").trim();
      return ver && VERSION_RE.test(ver) ? ver : null;
    } catch {
      return DEFAULT_VERSION;
    }
  }

  // ── Provisioning ────────────────────────────────────────────────────────────

  /** uv's tool directory. */
  private uvToolsDir(): string {
    if (process.env.UV_TOOL_DIR) return process.env.UV_TOOL_DIR;
    const dataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
    return path.join(dataHome, "uv", "tools");
  }

  /**
   * Capability marker written after an install that provably carries the MCP
   * extra (see installArgsFor). The tool directory alone is NOT evidence:
   * v2.5.1's unbounded `mcp>=1.2.0` extra happily resolved mcp 2.0.0, which
   * removed `mcp.server.fastmcp` — the env exists, the server still can't
   * boot. The marker makes isProvisioned capability-based so a broken legacy
   * env (no marker) gets re-provisioned exactly once.
   */
  private markerPath(): string {
    return path.join(this.uvToolsDir(), "skillspector", ".deeporca-mcp-ok");
  }

  /** Cheap capability check: marker written by a known-good install. */
  private isProvisioned(targetVersion: string): boolean {
    if (this.installedVersion === targetVersion || this.installedVersion === `${targetVersion}-git`) {
      return true;
    }
    try {
      return readFileSync(this.markerPath(), "utf-8").trim() === targetVersion;
    } catch {
      return false;
    }
  }

  /**
   * Install argv shared by the async and sync paths. `--with mcp<2` is the
   * real fix: upstream's extra is `mcp>=1.2.0` with no upper bound, and
   * mcp 2.x dropped `mcp.server.fastmcp`, which skillspector's server entry
   * imports — the failure masqueraded as "missing optional 'mcp' dependency".
   */
  private installArgsFor(spec: string): string[] {
    return ["tool", "install", "--force", "--with", "mcp<2", spec];
  }

  /** Single async install attempt. */
  private tryInstallAsync(uvBinary: string, spec: string): Promise<Error | null> {
    return new Promise((resolve) => {
      execFile(uvBinary, this.installArgsFor(spec), { timeout: 300_000, windowsHide: true }, (error) =>
        resolve(error ?? null)
      );
    });
  }

  /** Background provisioning (wheel → git fallback). Never blocks. */
  private async provisionInBackground(uvBinary: string, targetVersion: string): Promise<void> {
    if (this.provisioning || process.env.DEEPORCA_SKIP_SKILL_PROVISION === "1") return;
    this.provisioning = true;
    try {
      const wheelSpec = `skillspector[mcp] @ ${buildWheelUrl(targetVersion)}`;
      const wheelErr = await this.tryInstallAsync(uvBinary, wheelSpec);
      if (!wheelErr) {
        this.installedVersion = targetVersion;
        this.writeMarker(targetVersion);
        return;
      }
      // e.g. the pinned release has no wheel asset (v2.5.11 doesn't) — fall
      // through to git, but leave a trace instead of silently going slow.
      this.logger?.(
        `wheel install failed for v${targetVersion}, falling back to git`,
        wheelErr instanceof Error ? wheelErr.message : String(wheelErr)
      );
      const gitSpec = `skillspector[mcp] @ git+${SKILLSPECTOR_GIT_URL}@v${targetVersion}`;
      const gitErr = await this.tryInstallAsync(uvBinary, gitSpec);
      if (!gitErr) {
        this.installedVersion = `${targetVersion}-git`;
        this.writeMarker(targetVersion);
        return;
      }
      this.logger?.(
        `background install failed (v${targetVersion}); SkillSpector MCP will be unavailable until the next reload`,
        wheelErr instanceof Error ? wheelErr.message : String(wheelErr)
      );
    } finally {
      this.provisioning = false;
    }
  }

  private writeMarker(targetVersion: string): void {
    try {
      writeFileSync(this.markerPath(), targetVersion, "utf-8");
    } catch {
      // best-effort — provisioning still succeeded
    }
  }

  // ── Sync install (for tests/CLI only) ───────────────────────────────────────

  /**
   * Synchronous provisioning. BLOCKING + NETWORK — do NOT call from UI paths.
   * Kept for test/CLI compatibility.
   */
  ensureInstalled(): boolean {
    const uvBinary = resolveUvBinary();
    if (!uvBinary) return false;
    const targetVersion = this.readPinnedVersion();
    if (!targetVersion) return false;
    if (this.installedVersion === targetVersion) return true;

    const execOpts: ExecFileSyncOptionsWithStringEncoding = {
      encoding: "utf8",
      timeout: 300_000,
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    };
    const wheelSpec = `skillspector[mcp] @ ${buildWheelUrl(targetVersion)}`;
    try {
      execFileSync(uvBinary, this.installArgsFor(wheelSpec), execOpts);
      this.installedVersion = targetVersion;
      this.writeMarker(targetVersion);
      return true;
    } catch {
      // Wheel failed — try git fallback.
    }
    const gitSpec = `skillspector[mcp] @ git+${SKILLSPECTOR_GIT_URL}@v${targetVersion}`;
    try {
      execFileSync(uvBinary, this.installArgsFor(gitSpec), execOpts);
      this.installedVersion = `${targetVersion}-git`;
      this.writeMarker(targetVersion);
      return true;
    } catch {
      return false;
    }
  }
}
