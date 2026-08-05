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
 * CVSS 10.0 — a credential-exfiltrating typosquat). We install ONLY from GitHub Releases:
 *   1. Preferred: the release wheel (fast, prebuilt):
 *      `uv tool install 'skillspector[mcp] @ https://github.com/NVIDIA/SkillSpector/releases/download/v<ver>/skillspector-<ver>-py3-none-any.whl'`
 *   2. Fallback: git pinned to the release tag:
 *      `uv tool install 'skillspector[mcp] @ git+https://github.com/NVIDIA/SkillSpector.git@v<ver>'`
 *
 * NVIDIA now publishes tagged releases (v2.5.0+) with prebuilt wheels on GitHub Releases.
 * The build-time vendor script (scripts/vendor-skillspector.js) writes the target version
 * to `packages/desktop/vendor/skillspector/.vendored-skillspector-version`. This module
 * reads that marker at runtime to pin the install. `--force` re-installs when the
 * pinned version changes.
 *
 * SkillSpector is Python 3.12+ (LangChain stack + native yara-python). Like CRG/Serena it
 * runs through `uv` (shared vendored binary). `uv tool install` provisions an isolated,
 * persistent Python environment on first use — slow the first time (yara-python compiles),
 * fast thereafter.
 *
 * The `mcp` runtime dependency is an optional extra — installing `skillspector[mcp]`
 * is required for the `skillspector mcp` stdio subcommand.
 *
 * Prerequisites: the vendored `uv` binary (or system `uv` on PATH) + a C toolchain for the
 * one-time yara-python build (most platforms ship a wheel, so this is often a no-op).
 *
 * Docs: https://github.com/NVIDIA/SkillSpector
 */

import { execFile, execFileSync, type ExecFileSyncOptionsWithStringEncoding } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import os from "node:os";
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
  installedVersion = null;
}

// The vendor root holding the pinned-SHA marker file. The desktop client injects this at
// boot (mirroring configureCrgVendorRoot) — core never resolves paths via __dirname
// (it is ESM and must stay agnostic of the desktop layout). Null until configured.
let configuredSkillSpectorVendorRoot: string | null = null;

/** Set the vendor dir containing `.vendored-skillspector-sha`. Called by the desktop boot. */
export function configureSkillSpectorVendorRoot(root: string | null): void {
  configuredSkillSpectorVendorRoot = root ? path.resolve(root) : null;
  installedVersion = null;
}

/** Resolve the uv binary path (vendored preferred, system fallback), or null if absent. */
function resolveUvBinary(): string | null {
  if (uvResolver) {
    const uv = uvResolver();
    if (uv) return uv;
  }
  // System uv on PATH.
  try {
    return (
      execFileSync(process.platform === "win32" ? "where" : "which", ["uv"], {
        encoding: "utf8",
        timeout: 3000,
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
      })
        .split(/\r?\n/)[0]
        ?.trim() || null
    );
  } catch {
    return null;
  }
}

// ── Pinned release version (read from the build-time vendor marker) ───────────

/**
 * The build-time vendor script records the selected release version here. The
 * runtime installs that exact GitHub Release wheel or matching git tag. If the
 * marker is absent, use the hard-coded pinned release; a present malformed or
 * unreadable marker fails closed.
 */
const VENDOR_SHA_FILENAME = ".vendored-skillspector-version"; // version marker (not SHA anymore)
const SKILLSPECTOR_GIT_URL = "https://github.com/NVIDIA/SkillSpector.git";

/**
 * The official SkillSpector version to install. NVIDIA now publishes tagged
 * releases with prebuilt wheels on GitHub Releases. We install the wheel
 * directly (faster and more reproducible than git+SHA).
 *
 * Fallback: if the wheel install fails, use git pinned to the same release tag.
 */
const SKILLSPECTOR_VERSION = "2.5.1";

function buildWheelUrl(version: string): string {
  return `https://github.com/NVIDIA/SkillSpector/releases/download/v${version}/skillspector-${version}-py3-none-any.whl`;
}

/**
 * Strict version/tag allowlist. `targetVersion` flows from the build-time
 * vendor marker into a `uv tool install` spec, so it must match a known shape
 * (PEP 440 version or a git tag). Rejects anything that could break out of the
 * argv element or inject shell metacharacters.
 */
const VERSION_RE = /^[A-Za-z0-9._]+$/;
function isValidVersion(v: string): boolean {
  return VERSION_RE.test(v);
}

type PinnedVersion = { state: "missing" } | { state: "invalid" } | { state: "valid"; version: string };

/** Read and validate the pinned version marker when present. */
function readPinnedVersion(): PinnedVersion {
  if (!configuredSkillSpectorVendorRoot) return { state: "missing" };
  try {
    const ver = readFileSync(path.join(configuredSkillSpectorVendorRoot, VENDOR_SHA_FILENAME), "utf8").trim();
    return ver && isValidVersion(ver) ? { state: "valid", version: ver } : { state: "invalid" };
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? { state: "missing" } : { state: "invalid" };
  }
}

// ── Install provisioning (uv tool install, idempotent) ───────────────────────

let installedVersion: string | null = null;

export type SkillSpectorExecFile = (
  file: string,
  args: readonly string[],
  options: ExecFileSyncOptionsWithStringEncoding
) => string | Buffer;

/**
 * Provision SkillSpector into an isolated `uv tool` environment. Prefers the
 * GitHub Releases wheel (fast, prebuilt); falls back to the matching git release
 * tag if the wheel is unavailable. Idempotent within a process.
 *
 * NOTE: the first install can be slow (downloads LangChain stack + may compile
 * yara-python). Subsequent calls are instant.
 *
 * ⚠️ BLOCKING + NETWORK: this runs `uv tool install` synchronously. Do NOT call
 * it from a UI host's startup/event-loop path (it froze the desktop main
 * process once — white screen). MCP config building uses the async background
 * provisioner instead; this sync variant remains for tests and CLI flows.
 */
export function ensureSkillSpectorInstalled(execFileImpl: SkillSpectorExecFile = execFileSync): boolean {
  const uvBinary = resolveUvBinary();
  if (!uvBinary) return false;

  const pinned = readPinnedVersion();
  if (pinned.state === "invalid") return false;
  const targetVersion = pinned.state === "valid" ? pinned.version : SKILLSPECTOR_VERSION;
  if (installedVersion === targetVersion) return true;
  // Defense in depth: the version flows into a uv install spec. Even though we
  // now pass argv (not a shell string), reject anything outside the allowlist.
  if (!isValidVersion(targetVersion)) return false;

  const execOpts: ExecFileSyncOptionsWithStringEncoding = {
    encoding: "utf8",
    timeout: 300_000,
    stdio: ["ignore", "pipe", "ignore"],
    windowsHide: true,
  };

  // Pass argv as an array (no shell) so a uv binary path containing spaces or
  // cmd metacharacters (e.g. "C:\Program Files\DeepOrca\...\uv.exe") is invoked
  // directly, and the install spec is a single argument rather than a
  // shell-quoted string. Earlier code built a shell command with single quotes
  // that cmd.exe treats as literal characters.
  const wheelSpec = `skillspector[mcp] @ ${buildWheelUrl(targetVersion)}`;
  try {
    execFileImpl(uvBinary, ["tool", "install", "--force", wheelSpec], execOpts);
    installedVersion = targetVersion;
    return true;
  } catch {
    // Wheel install failed (offline, yara-python compile, etc.) — try git fallback.
  }

  // Fallback: install from git pinned to the release tag (slower but reproducible).
  const gitSpec = `skillspector[mcp] @ git+${SKILLSPECTOR_GIT_URL}@v${targetVersion}`;
  try {
    execFileImpl(uvBinary, ["tool", "install", "--force", gitSpec], execOpts);
    installedVersion = `${targetVersion}-git`;
    return true;
  } catch {
    // Provisioning failed — non-fatal. SkillSpector stays unavailable.
    return false;
  }
}

// ── Async background provisioning ────────────────────────────────────────────
// SkillSpector's `uv tool install` downloads from GitHub Releases / PyPI — a
// network operation that can take minutes on a slow or blocked connection. It
// must NEVER run synchronously on the caller's thread: the desktop main process
// builds MCP configs on the startup critical path, and a synchronous install
// there freezes the event loop and whites out the window (see 2026-08 incident).
// Provisioning therefore happens in a fire-and-forget async child; the server
// registers on the next SessionManager reload once the install is on disk.

/** uv's tool directory (`UV_TOOL_DIR`, else `$XDG_DATA_HOME/uv/tools`). */
function uvToolsDir(): string {
  if (process.env.UV_TOOL_DIR) return process.env.UV_TOOL_DIR;
  const dataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
  return path.join(dataHome, "uv", "tools");
}

/**
 * Cheap on-disk check: has a `skillspector` tool environment been provisioned?
 * Any installed copy came from our pinned wheel/git install (never bare PyPI),
 * so presence alone is sufficient — no version spawn needed.
 */
function isSkillSpectorProvisioned(targetVersion: string): boolean {
  if (installedVersion === targetVersion || installedVersion === `${targetVersion}-git`) {
    return true;
  }
  try {
    return statSync(path.join(uvToolsDir(), "skillspector")).isDirectory();
  } catch {
    return false;
  }
}

let provisioning = false;

/** Single async `uv tool install` attempt. Resolves false on any failure. */
function tryInstallAsync(uvBinary: string, spec: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(uvBinary, ["tool", "install", "--force", spec], { timeout: 300_000, windowsHide: true }, (error) =>
      resolve(!error)
    );
  });
}

/**
 * Provision SkillSpector in the background (pinned wheel, git-tag fallback).
 * Never blocks the caller; concurrent calls collapse onto the first.
 *
 * Skipped entirely under `DEEPORCA_SKIP_SKILL_PROVISION=1` — the core test
 * suite sets this so creating a SessionManager never spawns a minutes-long
 * network install that would keep the test process alive.
 */
async function provisionSkillSpectorInBackground(uvBinary: string, targetVersion: string): Promise<void> {
  if (provisioning || process.env.DEEPORCA_SKIP_SKILL_PROVISION === "1") {
    return;
  }
  provisioning = true;
  try {
    const wheelSpec = `skillspector[mcp] @ ${buildWheelUrl(targetVersion)}`;
    if (await tryInstallAsync(uvBinary, wheelSpec)) {
      installedVersion = targetVersion;
      return;
    }
    const gitSpec = `skillspector[mcp] @ git+${SKILLSPECTOR_GIT_URL}@v${targetVersion}`;
    if (await tryInstallAsync(uvBinary, gitSpec)) {
      installedVersion = `${targetVersion}-git`;
    }
  } finally {
    provisioning = false;
  }
}

// ── MCP server config builder ────────────────────────────────────────────────

/**
 * Build the MCP server config for SkillSpector.
 *
 * Provisions SkillSpector (pinned to the vendored release version via `uv tool install`) on first
 * use, then launches `skillspector mcp` over stdio. The single `scan_skill` tool it
 * exposes scans a skill/MCP for vulnerabilities; the caller (the agent) decides
 * `use_llm` — DeepOrca's guidance defaults it to false (pure-static, zero credentials).
 *
 * Returns null when uv is unavailable, the pinned version is invalid, or the
 * (asynchronous) first-time install hasn't landed yet — the caller skips
 * registration so the absence is silent rather than a crash. The server shows
 * up on the next SessionManager reload after the background install completes.
 */
export function buildSkillSpectorMcpServerConfig(_projectRoot: string): McpServerConfig | null {
  const uvBinary = resolveUvBinary();
  if (!uvBinary) return null;

  const pinned = readPinnedVersion();
  if (pinned.state === "invalid") return null;
  const targetVersion = pinned.state === "valid" ? pinned.version : SKILLSPECTOR_VERSION;
  // Defense in depth: the version flows into a uv install spec. Even though we
  // pass argv (not a shell string), reject anything outside the allowlist.
  if (!isValidVersion(targetVersion)) return null;

  if (!isSkillSpectorProvisioned(targetVersion)) {
    // First provision: kick off the async install and skip registration for
    // now. Blocking here would freeze the host's startup path.
    void provisionSkillSpectorInBackground(uvBinary, targetVersion);
    return null;
  }
  // Already usable — refresh to the pinned version in the background when this
  // process hasn't confirmed it yet.
  if (installedVersion !== targetVersion && installedVersion !== `${targetVersion}-git`) {
    void provisionSkillSpectorInBackground(uvBinary, targetVersion);
  }

  // `uv tool run` reuses the persistent environment created by `uv tool install`.
  // `skillspector mcp` defaults to stdio transport (issue #199 initialize hang is fixed
  // in the pinned release).
  return {
    command: uvBinary,
    args: ["tool", "run", "skillspector", "mcp"],
  };
}
