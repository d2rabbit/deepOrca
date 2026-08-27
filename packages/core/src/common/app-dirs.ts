import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createHash } from "node:crypto";

/**
 * Central resolution for DeepOrca config locations, with backward
 * compatibility for legacy Deep Code installs:
 *
 * - If a legacy `.deepcode` directory exists at the given base, keep using it
 *   (structure is fully shared, so nothing needs migrating).
 * - Otherwise resolve to the new `.deeporca` directory (created lazily by
 *   whichever writer needs it).
 */

export const CONFIG_DIR_NAME = ".deeporca";
export const LEGACY_CONFIG_DIR_NAME = ".deepcode";

function resolveConfigRoot(base: string): string {
  const legacy = path.join(base, LEGACY_CONFIG_DIR_NAME);
  if (fs.existsSync(legacy)) {
    return legacy;
  }
  return path.join(base, CONFIG_DIR_NAME);
}

/** User-level config root: `~/.deepcode` when present, else `~/.deeporca`. */
export function getUserConfigRoot(): string {
  return resolveConfigRoot(os.homedir());
}

/** Project-level config root: `<root>/.deepcode` when present, else `<root>/.deeporca`. */
export function getProjectConfigRoot(projectRoot: string): string {
  return resolveConfigRoot(projectRoot);
}

/**
 * Reads an app environment variable with dual-prefix support:
 * `DEEPORCA_<suffix>` wins, `DEEPCODE_<suffix>` is the legacy fallback.
 */
export function getEnvVar(suffix: string): string | undefined {
  return process.env[`DEEPORCA_${suffix}`] ?? process.env[`DEEPCODE_${suffix}`];
}

// Keep project storage paths short enough for Git's internal files on Windows.
// Moved here from session.ts so settings/workspace-trust can derive per-project
// user-level paths without importing the session layer (no cycles).
const MAX_PROJECT_CODE_LENGTH = 64;
const PROJECT_CODE_HASH_LENGTH = 16;

export function getProjectCode(projectRoot: string): string {
  const legacyCode = getLegacyProjectCode(projectRoot);
  if (legacyCode.length <= MAX_PROJECT_CODE_LENGTH) {
    return legacyCode;
  }

  const normalizedRoot = path.resolve(projectRoot);
  const hashInput = process.platform === "win32" ? normalizedRoot.toLowerCase() : normalizedRoot;
  const hash = createHash("sha256").update(hashInput).digest("hex").slice(0, PROJECT_CODE_HASH_LENGTH);
  const prefixLimit = MAX_PROJECT_CODE_LENGTH - PROJECT_CODE_HASH_LENGTH - 1;
  const basename = path.basename(normalizedRoot);
  const prefix =
    sanitizeProjectCodePart(basename)
      .slice(0, prefixLimit)
      .replace(/[-.]+$/g, "") || "project";
  return `${prefix}-${hash}`;
}

function getLegacyProjectCode(projectRoot: string): string {
  return projectRoot.replace(/[\\/]/g, "-").replace(/:/g, "");
}

function sanitizeProjectCodePart(value: string): string {
  return value
    .replace(/[^A-Za-z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
}

export type WorkspaceTrustLevel = "trusted" | "quarantine";

export type WorkspaceTrustStatus = { level: WorkspaceTrustLevel; explicit: boolean };

/**
 * User-level workspace trust store (review finding, 2026-08-16): the trust
 * marker must NOT live in the project's own settings file — that file is
 * committable content of the repo being distrusted, so a malicious checkout
 * could ship `workspaceTrust: "trusted"` and silently disarm the entire
 * quarantine clamp. Stored instead under the user config root, keyed by
 * project code. `explicit: false` means never asked (first open).
 */
function getWorkspaceTrustStorePath(projectRoot: string): string {
  return path.join(getUserConfigRoot(), "projects", getProjectCode(projectRoot), "trust.json");
}

export function readWorkspaceTrustStore(projectRoot: string): WorkspaceTrustStatus {
  try {
    const parsed = JSON.parse(fs.readFileSync(getWorkspaceTrustStorePath(projectRoot), "utf8")) as {
      level?: unknown;
    };
    if (parsed.level === "quarantine") {
      return { level: "quarantine", explicit: true };
    }
    if (parsed.level === "trusted") {
      return { level: "trusted", explicit: true };
    }
  } catch {
    // Absent or corrupt store: never asked (the first-open dialog re-asks).
  }
  return { level: "trusted", explicit: false };
}

export function writeWorkspaceTrustStore(projectRoot: string, level: WorkspaceTrustLevel): void {
  const storePath = getWorkspaceTrustStorePath(projectRoot);
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, `${JSON.stringify({ level }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

/**
 * Fail-closed trust resolution for configuration loading (P0 hardening,
 * 2026-08-27): an UNANSWERED first-open prompt (`explicit: false`) must never
 * arm project-level execution surfaces. The project's .deeporca/settings.json
 * is committable repo content — attacker-controlled — and a workspace that
 * had never been asked previously resolved as trusted, so its
 * mcpServers/env/memory/webSearchTool went live BEFORE the user could make
 * any trust decision (and MCP servers kept running even after a later
 * quarantine). Resolution treats it like quarantine until the user explicitly
 * answers; the trust dialog itself keeps using the raw store status.
 */
export function effectiveWorkspaceTrust(status: WorkspaceTrustStatus): WorkspaceTrustLevel {
  return status.explicit ? status.level : "quarantine";
}
