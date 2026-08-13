/**
 * SkillSpectorCliController — desktop Adapter for SkillSpectorController.
 *
 * Migrated from packages/core/src/common/skill-spector.ts. All spawn/provisioning
 * logic (uv tool install, wheel/git fallback, version pinning, async background
 * provisioning) lives here. Core only knows the SkillSpectorController interface.
 */

import { execFile, execFileSync, type ExecFileSyncOptionsWithStringEncoding } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
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

  /** Cheap on-disk check: has skillspector been provisioned? */
  private isProvisioned(targetVersion: string): boolean {
    if (this.installedVersion === targetVersion || this.installedVersion === `${targetVersion}-git`) {
      return true;
    }
    try {
      return statSync(path.join(this.uvToolsDir(), "skillspector")).isDirectory();
    } catch {
      return false;
    }
  }

  /** Single async install attempt. */
  private tryInstallAsync(uvBinary: string, spec: string): Promise<Error | null> {
    return new Promise((resolve) => {
      execFile(uvBinary, ["tool", "install", "--force", spec], { timeout: 300_000, windowsHide: true }, (error) =>
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
        return;
      }
      const gitSpec = `skillspector[mcp] @ git+${SKILLSPECTOR_GIT_URL}@v${targetVersion}`;
      const gitErr = await this.tryInstallAsync(uvBinary, gitSpec);
      if (!gitErr) {
        this.installedVersion = `${targetVersion}-git`;
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
      execFileSync(uvBinary, ["tool", "install", "--force", wheelSpec], execOpts);
      this.installedVersion = targetVersion;
      return true;
    } catch {
      // Wheel failed — try git fallback.
    }
    const gitSpec = `skillspector[mcp] @ git+${SKILLSPECTOR_GIT_URL}@v${targetVersion}`;
    try {
      execFileSync(uvBinary, ["tool", "install", "--force", gitSpec], execOpts);
      this.installedVersion = `${targetVersion}-git`;
      return true;
    } catch {
      return false;
    }
  }
}
