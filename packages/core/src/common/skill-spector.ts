/**
 * SkillSpector MCP server integration — AI skill/MCP security scanner.
 *
 * SkillSpector (NVIDIA/SkillSpector) is an MCP server that scans agent skills and MCP
 * servers for vulnerabilities before installation: prompt injection, data exfiltration,
 * supply-chain CVEs (live OSV lookup), excessive agency, MCP least-privilege violations,
 * and MCP tool poisoning. It exposes a single `scan_skill(target, use_llm, output_format)`
 * tool returning a risk score + recommendation (SAFE / CAUTION / DO_NOT_INSTALL).
 *
 * ⚠️ SECURITY: the `skillspector` package on PyPI is MALWARE (advisory MAL-2026-6561,
 * CVSS 10.0 — a credential-exfiltrating typosquat). NVIDIA has NOT published the official
 * package to PyPI. We MUST install from the GitHub repo pinned to a commit SHA:
 *   `uv tool install 'skillspector[mcp] @ git+https://github.com/NVIDIA/SkillSpector.git@<SHA>'`
 * There are no release tags, so the build-time vendor script (scripts/vendor-skillspector.js)
 * records the upstream main commit SHA into `packages/desktop/vendor/skillspector/.vendored-skillspector-sha`,
 * which this module reads at runtime to pin the install.
 *
 * SkillSpector is Python 3.12+ (LangChain stack + native yara-python). Like CRG/Serena it
 * runs through `uv` (shared vendored binary). `uv tool install` provisions an isolated,
 * persistent Python environment on first use — slow the first time (yara-python compiles),
 * fast thereafter. `--force` re-installs only when the pinned SHA changes.
 *
 * The `mcp` runtime dependency is an optional extra — installing `skillspector[mcp]` is
 * required for the `skillspector mcp` stdio subcommand.
 *
 * Prerequisites: the vendored `uv` binary (or system `uv` on PATH) + a C toolchain for the
 * one-time yara-python build (most platforms ship a wheel, so this is often a no-op).
 *
 * Docs: https://github.com/NVIDIA/SkillSpector
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { McpServerConfig } from "../settings";

export const SKILL_SPECTOR_MCP_SERVER_NAME = "skill-spector";

// ── Disable flag (host-managed, per project root) ────────────────────────────

const disabledSkillSpectorRoots = new Set<string>();

/** Enable or disable the built-in SkillSpector MCP server for a project root. */
export function setSkillSpectorDisabled(projectRoot: string, disabled: boolean): void {
  const key = path.resolve(projectRoot);
  if (disabled) {
    disabledSkillSpectorRoots.add(key);
  } else {
    disabledSkillSpectorRoots.delete(key);
  }
}

/** True when the built-in SkillSpector MCP server has been disabled for a project root. */
export function isSkillSpectorDisabled(projectRoot: string): boolean {
  return disabledSkillSpectorRoots.has(path.resolve(projectRoot));
}

// ── Shared uv binary resolver (reuses the same vendored uv as CRG/Serena) ─────

// We import lazily to avoid a hard dependency on crg.ts when SkillSpector isn't used.
let uvResolver: (() => string | null) | null = null;

/**
 * Set the uv binary resolver. The desktop client calls this at boot, sharing the same
 * vendored uv that CRG/Serena use (configureCrgVendorRoot points at the same
 * `packages/desktop/vendor/uv/` directory).
 */
export function configureSkillSpectorUvResolver(resolver: (() => string | null) | null): void {
  uvResolver = resolver;
}

// The vendor root holding the pinned-SHA marker file. The desktop client injects this at
// boot (mirroring configureCrgVendorRoot) — core never resolves paths via __dirname
// (it is ESM and must stay agnostic of the desktop layout). Null until configured.
let configuredSkillSpectorVendorRoot: string | null = null;

/** Set the vendor dir containing `.vendored-skillspector-sha`. Called by the desktop boot. */
export function configureSkillSpectorVendorRoot(root: string | null): void {
  configuredSkillSpectorVendorRoot = root ? path.resolve(root) : null;
}

/** Resolve the uv binary path (vendored preferred, system fallback), or null if absent. */
function resolveUvBinary(): string | null {
  if (uvResolver) {
    const uv = uvResolver();
    if (uv) return uv;
  }
  // System uv on PATH.
  try {
    return execSync(process.platform === "win32" ? "where uv" : "which uv", {
      encoding: "utf8",
      timeout: 3000,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split("\n")[0]
      .trim();
  } catch {
    return null;
  }
}

// ── Pinned SHA (read from the build-time vendor marker) ──────────────────────

/**
 * The build-time vendor script records the upstream commit SHA here. We install from
 * `git+...@<SHA>` to pin a known-good version and AVOID the malicious PyPI package.
 * If the marker is missing (build didn't vendor / vendor root not configured), fall
 * back to `main` — best-effort, less reproducible, but still safe (installs from
 * GitHub, never PyPI).
 */
const VENDOR_SHA_FILENAME = ".vendored-skillspector-version"; // version marker (not SHA anymore)
const SKILLSPECTOR_GIT_URL = "https://github.com/NVIDIA/SkillSpector.git";

/**
 * The official SkillSpector version to install. NVIDIA now publishes tagged
 * releases with prebuilt wheels on GitHub Releases. We install the wheel
 * directly (faster and more reproducible than git+SHA).
 *
 * Fallback: if the wheel install fails, we fall back to git+main.
 */
const SKILLSPECTOR_VERSION = "2.5.1";
const SKILLSPECTOR_WHEEL_URL = `https://github.com/NVIDIA/SkillSpector/releases/download/v${SKILLSPECTOR_VERSION}/skillspector-${SKILLSPECTOR_VERSION}-py3-none-any.whl`;

/** Read the pinned version from the vendor marker, or null if not vendored. */
function readPinnedVersion(): string | null {
  if (!configuredSkillSpectorVendorRoot) return null;
  try {
    const ver = readFileSync(path.join(configuredSkillSpectorVendorRoot, VENDOR_SHA_FILENAME), "utf8").trim();
    return ver || null;
  } catch {
    return null;
  }
}

// ── Install provisioning (uv tool install, idempotent) ───────────────────────

let installedVersion: string | null = null;

/**
 * Provision SkillSpector into an isolated `uv tool` environment. Prefers the
 * GitHub Releases wheel (fast, prebuilt); falls back to git+main if the wheel
 * is unavailable. Idempotent within a process.
 *
 * NOTE: the first install can be slow (downloads LangChain stack + may compile
 * yara-python). Subsequent calls are instant.
 */
export function ensureSkillSpectorInstalled(): boolean {
  const uvBinary = resolveUvBinary();
  if (!uvBinary) return false;

  const targetVersion = readPinnedVersion() ?? SKILLSPECTOR_VERSION;
  if (installedVersion === targetVersion) return true;

  // Try the release wheel first (fast, prebuilt, pinned to a real tag).
  const wheelSpec = `'skillspector[mcp] @ ${SKILLSPECTOR_WHEEL_URL}'`;
  try {
    execSync(`${uvBinary} tool install --force ${wheelSpec}`, {
      encoding: "utf8",
      timeout: 300_000,
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    installedVersion = targetVersion;
    return true;
  } catch {
    // Wheel install failed (offline, yara-python compile, etc.) — try git fallback.
  }

  // Fallback: install from git pinned to the release tag (slower but reproducible).
  const gitSpec = `'skillspector[mcp] @ git+${SKILLSPECTOR_GIT_URL}@v${targetVersion}'`;
  try {
    execSync(`${uvBinary} tool install --force ${gitSpec}`, {
      encoding: "utf8",
      timeout: 300_000,
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    installedVersion = `${targetVersion}-git`;
    return true;
  } catch {
    // Provisioning failed — non-fatal. SkillSpector stays unavailable.
    return false;
  }
}

// ── MCP server config builder ────────────────────────────────────────────────

/**
 * Build the MCP server config for SkillSpector.
 *
 * Provisions SkillSpector (pinned to the vendored SHA via `uv tool install`) on first
 * use, then launches `skillspector mcp` over stdio. The single `scan_skill` tool it
 * exposes scans a skill/MCP for vulnerabilities; the caller (the agent) decides
 * `use_llm` — DeepOrca's guidance defaults it to false (pure-static, zero credentials).
 *
 * Returns null when uv is unavailable or provisioning fails — the caller skips
 * registration so the absence is silent rather than a crash.
 */
export function buildSkillSpectorMcpServerConfig(_projectRoot: string): McpServerConfig | null {
  const uvBinary = resolveUvBinary();
  if (!uvBinary) return null;

  if (!ensureSkillSpectorInstalled()) return null;

  // `uv tool run` reuses the persistent environment created by `uv tool install`.
  // `skillspector mcp` defaults to stdio transport (issue #199 initialize hang is fixed
  // on main, which is what the pinned SHA tracks).
  return {
    command: uvBinary,
    args: ["tool", "run", "skillspector", "mcp"],
  };
}
