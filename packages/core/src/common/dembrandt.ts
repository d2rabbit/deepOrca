/**
 * Dembrandt — offline-first vendor seam + disable gate + spawn config (pure
 * state + config, stays in core).
 *
 * dembrandt (MIT, pinned 0.28.0) is a website design-token extraction engine:
 * URL → W3C DTCG tokens / Tailwind @theme / DESIGN.md, plus a drift gate
 * (docs/research/2026-08-17-external-repos-prestudy.md §1). Integrated as an
 * L2 builtin in two halves that share this module's spawn spec:
 *   - MCP server  — registered in session.ts augmentMcpServersWithBuiltins.
 *   - CLI actions — design.extract / design.drift in actions/design.ts.
 *
 * OFFLINE-ONLY (E1e). The runtime used to be `npx -y --package
 * dembrandt@0.28.0 …` — a registry download on every cold machine. Now
 * scripts/vendor-dembrandt.js installs the pinned package at BUILD time into
 * packages/desktop/vendor/dembrandt (isolated node_modules, measured 26.3MB,
 * no browser binary, onnxruntime-node skipped via --omit=optional), and the
 * host injects that directory here via configureDembrandtVendorRoot (same host-
 * injection pattern as configureUvVendorRoot / configureCrgVersionRoot — the
 * vendor root is Resources/app/vendor/dembrandt in packaged builds, never
 * derived from __dirname inside core). There is deliberately NO runtime npx
 * fallback: a missing vendor tree returns an unavailable command and a clear
 * build-time provisioning error rather than reaching the network.
 *
 * System browser, zero download — Electron's built-in Chromium via CDP
 * (user decision 2026-08-17: "使用内置的Chromium"):
 *  - Upstream 0.28.0 launches through playwright-core with no shared
 *    channel/executablePath option; only the CLI honors BROWSER_CDP_ENDPOINT
 *    (connectOverCDP) — the MCP server and PDF renderer do not.
 *  - vendor-dembrandt.js therefore applies a version-pinned, fail-closed patch
 *    to all three launch sites so they prefer DEMBRANDT_CDP_ENDPOINT (CDP) and
 *    only fall back to a plain launch.
 *  - The desktop host (main/tools/dembrandt-browser.ts) lazily starts a hidden
 *    offscreen BrowserWindow with remote debugging on a fixed loopback port
 *    and injects the endpoint via configureDembrandtCdpEndpointProvider.
 *  - Playwright's managed browser cache remains a manual offline escape hatch
 *    (PLAYWRIGHT_BROWSERS_PATH), and PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 is
 *    always exported as a hard guard. The upstream `install-browser`
 *    downloader is never invoked.
 *
 * The disable gate copies the exact serena-mcp.ts mechanism: host-managed,
 * keyed by resolved project root, in-memory only (hosts that want persistence
 * write their settings and re-apply the flag at boot).
 */

import * as fs from "node:fs";
import path from "node:path";
import { getUserConfigRoot, getEnvVar } from "./app-dirs";
import type { McpServerConfig } from "../settings";

export const DEMBRANDT_MCP_SERVER_NAME = "dembrandt";
export const DEMBRANDT_PACKAGE = "dembrandt";
/** Pinned version — the vendor script installs exactly this, avoiding supply-chain drift. */
export const DEMBRANDT_VERSION = "0.28.0";
export const DEMBRANDT_PACKAGE_SPEC = `${DEMBRANDT_PACKAGE}@${DEMBRANDT_VERSION}`;

// ── Vendored install (host-injected root, never __dirname-derived) ───────────

let dembrandtVendorRoot: string | null = null;
let dembrandtCdpEndpointGetter: (() => string | null) | null = null;

/**
 * Point the resolver at the vendored dembrandt directory (desktop boot calls
 * this; `null` resets, which tests use for isolation). Mirrors
 * configureUvVendorRoot. The root is stored RAW (not path.resolve'd) so the
 * traversal validation in validateVendorRoot runs on what was configured.
 */
export function configureDembrandtVendorRoot(root: string | null): void {
  dembrandtVendorRoot = root;
}

/** The host-injected vendored dembrandt root, or null when unset. */
export function getDembrandtVendorRoot(): string | null {
  return dembrandtVendorRoot;
}

/**
 * Inject the built-in-Chromium CDP endpoint getter (desktop boot wires it to
 * the hidden offscreen Electron Chromium window's module state — the window is
 * started lazily by the host; once up, the getter returns the fixed loopback
 * endpoint synchronously). Returning null means no built-in provider is ready
 * (non-Electron hosts), and dembrandt falls back to a Playwright-managed
 * browser only when one was provisioned offline.
 */
export function configureDembrandtCdpEndpointGetter(getter: (() => string | null) | null): void {
  dembrandtCdpEndpointGetter = getter;
}

/** Resolve the configured vendor root: injected value, then env override. */
function activeVendorRoot(): string | null {
  return dembrandtVendorRoot ?? getEnvVar("DEMBRANDT_VENDOR_ROOT") ?? null;
}

/**
 * dembrandt's package.json bin map — the JS entries the vendored spawn runs
 * through a node runner (argv form, never the .bin shims: those are shell
 * scripts on POSIX and .cmd/.ps1 on Windows, both of which need a shell).
 */
const DEMBRANDT_BIN_REL: Record<"dembrandt" | "dembrandt-mcp", string> = {
  dembrandt: path.join("node_modules", "dembrandt", "dist", "index.js"),
  "dembrandt-mcp": path.join("node_modules", "dembrandt", "dist", "mcp-server.js"),
};

/**
 * SECURITY (path-gate, mirrors isSafeUvBinary in common/uv.ts): the vendor root
 * is a dynamic value (host injection / env). Before it can flow into spawn
 * argv it must be absolute with no traversal segments — relative or `..`
 * roots are rejected and the resolver falls back to npx rather than spawning
 * something outside the vendored tree.
 */
export function validateDembrandtVendorRoot(
  root: string
): { ok: true; resolved: string } | { ok: false; reason: string } {
  if (!root) {
    return { ok: false, reason: "empty vendor root" };
  }
  if (!path.isAbsolute(root)) {
    return { ok: false, reason: `vendor root is not absolute: ${root}` };
  }
  if (root.split(/[\\/]/).includes("..")) {
    return { ok: false, reason: `vendor root contains '..' segments: ${root}` };
  }
  return { ok: true, resolved: path.resolve(root) };
}

/**
 * Resolve a bin entry under a validated vendor root, enforcing containment:
 * the resolved path must stay under the root (no `..` escapes) and exist on
 * disk. Returns null on any failure — the caller falls back to npx.
 */
function resolveVendoredBin(root: string, binary: "dembrandt" | "dembrandt-mcp"): string | null {
  const candidate = path.resolve(root, DEMBRANDT_BIN_REL[binary]);
  const rel = path.relative(root, candidate);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    return null;
  }
  try {
    return fs.statSync(candidate).isFile() ? candidate : null;
  } catch {
    return null;
  }
}

// ── Offline browser provisioning (no downloads, ever) ────────────────────────

/**
 * The offline-provisioned Playwright browser cache DeepOrca recognizes:
 * `<userConfigRoot>/browsers/ms-playwright`. Playwright-core's registry reads
 * PLAYWRIGHT_BROWSERS_PATH at launch, so pointing it here makes a packager-
 * provisioned `chromium-<rev>` directory the engine dembrandt launches —
 * without shipping a browser in the installer. Nothing in this module writes
 * to or downloads into this directory.
 */
export function getDembrandtBrowsersDir(): string {
  return path.join(getUserConfigRoot(), "browsers", "ms-playwright");
}

/**
 * The PLAYWRIGHT_BROWSERS_PATH value to export, or null to leave playwright's
 * default cache resolution untouched. Only set when the provisioning dir
 * actually holds an engine directory (`chromium*`/`firefox*`): with nothing
 * provisioned, overriding would HIDE a matching engine the user already has in
 * the default cache (a regression for offline availability), and an empty dir
 * behaves identically to a missing one — extraction fails fast with dembrandt's
 * own "browser engine not available" error either way.
 */
export function findProvisionedDembrandtBrowsersPath(): string | null {
  const dir = getDembrandtBrowsersDir();
  try {
    for (const entry of fs.readdirSync(dir)) {
      if (/^(chromium|firefox)/.test(entry)) {
        return dir;
      }
    }
  } catch {
    // Directory absent — nothing provisioned.
  }
  return null;
}

/**
 * Env overrides merged over the inherited environment by both spawn surfaces
 * (the MCP manager merges config.env over process.env; ElectronNodeSpawner
 * merges opts.env over process.env the same way):
 *  - PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 — hard guard: nothing may fetch.
 *  - DEMBRANDT_CDP_ENDPOINT — built-in Electron Chromium via the vendored CDP
 *    patch, when the host provider is wired and ready.
 *  - PLAYWRIGHT_BROWSERS_PATH — manual offline escape hatch (provisioned cache).
 *  - ELECTRON_RUN_AS_NODE=1 — only meaningful on the vendored variant, where
 *    the runner is process.execPath (Electron bundled as plain Node).
 */
function dembrandtChildEnv(vendored: boolean, cdpEndpoint: string | null): Record<string, string> {
  const env: Record<string, string> = { PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1" };
  if (vendored) {
    env.ELECTRON_RUN_AS_NODE = "1";
  }
  if (cdpEndpoint) {
    env.DEMBRANDT_CDP_ENDPOINT = cdpEndpoint;
  }
  const browsersPath = findProvisionedDembrandtBrowsersPath();
  if (browsersPath) {
    env.PLAYWRIGHT_BROWSERS_PATH = browsersPath;
  }
  return env;
}

// ── Command resolver ─────────────────────────────────────────────────────────

/** How to spawn a dembrandt binary (CLI or MCP server). */
export type DembrandtCommand =
  | {
      kind: "vendored";
      /** Node runner — process.execPath (Electron-as-Node in desktop, plain node elsewhere). */
      nodeBin: string;
      /** [vendored bin js, …] — prepend to the binary's own CLI flags. */
      args: string[];
      env: Record<string, string>;
    }
  | {
      kind: "unavailable";
      /** Why no offline spawn spec exists (build provisioning gap). */
      reason: string;
      env: Record<string, string>;
    };

/**
 * Resolve how to spawn a dembrandt binary — offline-ONLY (no runtime npx
 * fallback; a missing vendored tree is a build-provisioning error, not a
 * network opportunity).
 *
 * 1. `vendored` — validated vendor root holds the bin js (absolute, no `..`,
 *    contained, existing): `<process.execPath> <vendorRoot>/node_modules/
 *    dembrandt/dist/<bin>.js …` — zero network, deterministic version.
 * 2. `unavailable` — no vendored tree. Callers surface `reason`; nothing is
 *    spawned. A packaged app never reaches this (desktop:build vendors it).
 */
export function resolveDembrandtCommand(binary: "dembrandt" | "dembrandt-mcp"): DembrandtCommand {
  let cdpEndpoint: string | null = null;
  try {
    cdpEndpoint = dembrandtCdpEndpointGetter?.() ?? null;
  } catch {
    cdpEndpoint = null; // provider not ready — fall through to Playwright-managed path
  }
  const root = activeVendorRoot();
  if (root) {
    const validated = validateDembrandtVendorRoot(root);
    if (validated.ok) {
      const bin = resolveVendoredBin(validated.resolved, binary);
      if (bin) {
        return {
          kind: "vendored",
          nodeBin: process.execPath,
          args: [bin],
          env: dembrandtChildEnv(true, cdpEndpoint),
        };
      }
    }
  }
  return {
    kind: "unavailable",
    reason:
      "dembrandt is not provisioned for offline use: the vendored tree is missing. " +
      "Run `node scripts/vendor-dembrandt.js` (or `npm run desktop:build`) — DeepOrca never downloads it at runtime.",
    env: dembrandtChildEnv(false, cdpEndpoint),
  };
}

/**
 * Validate a target URL before handing it to dembrandt (the CLI fetches and
 * renders it): http/https only, and the host must not be localhost, loopback,
 * a private/reserved IP, or a link-local address — SSRF surface guard.
 */
export function validateDembrandtTargetUrl(raw: string): { ok: true; url: string } | { ok: false; error: string } {
  let parsed: URL;
  const trimmed = raw.trim();
  // An input that already carries a scheme must be http/https — otherwise a
  // scheme-less default of https would smuggle "ftp://…" through as host "ftp".
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) && !/^https?:\/\//i.test(trimmed)) {
    return { ok: false, error: `only http/https URLs are allowed` };
  }
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  // Reject raw whitespace/control characters up front — `new URL()` silently
  // percent-encodes them, which would smuggle a malformed host past the check.
  if (/[\s\u0000-\u001f\u007f-\u009f]/.test(candidate)) {
    return { ok: false, error: `invalid URL: ${raw}` };
  }
  try {
    parsed = new URL(candidate);
  } catch {
    return { ok: false, error: `invalid URL: ${raw}` };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: `only http/https URLs are allowed` };
  }
  const host = parsed.hostname.toLowerCase();
  const bracketless = host.replace(/^\[|\]$/g, "");
  if (
    bracketless === "localhost" ||
    bracketless.endsWith(".localhost") ||
    bracketless === "::1" ||
    bracketless === "0.0.0.0" ||
    bracketless === "0"
  ) {
    return { ok: false, error: `refusing non-public host: ${host}` };
  }
  const ipv4 = bracketless.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);
    const blocked =
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224;
    if (blocked) {
      return { ok: false, error: `refusing private/loopback/reserved address: ${host}` };
    }
  }
  if (/^(fc|fd|fe8|fe9|fea|feb)/i.test(bracketless)) {
    return { ok: false, error: `refusing IPv6 ULA/link-local address: ${host}` };
  }
  return { ok: true, url: parsed.toString() };
}

// ── Disable flag (host-managed, per project root) ────────────────────────────

const disabledDembrandtRoots = new Set<string>();

/** Enable or disable the built-in dembrandt MCP server for a project root. */
export function setDembrandtDisabled(projectRoot: string, disabled: boolean): void {
  const key = path.resolve(projectRoot);
  if (disabled) {
    disabledDembrandtRoots.add(key);
  } else {
    disabledDembrandtRoots.delete(key);
  }
}

/** True when the built-in dembrandt MCP server has been disabled for a project root. */
export function isDembrandtDisabled(projectRoot: string): boolean {
  return disabledDembrandtRoots.has(path.resolve(projectRoot));
}

// ── Project detection (mirrors hasCodegraphProject in common/codegraph.ts) ───

/**
 * True when the project shows design activity: a `designs/` directory
 * (design.materialize's persistence target and the DesignPanel's source of
 * truth) or the brand contract `.deeporca/DESIGN.md`. dembrandt's 13 MCP
 * tools are only injected into design-active projects — the same
 * project-scoping codegraph applies with `.codegraph/`.
 *
 * Rationale for gating at all (rather than registering everywhere): every
 * declared builtin is connected at session boot; restricting to
 * design-active projects keeps bare workspaces free of an extra stdio server.
 * The design.extract / design.drift ACTIONS are the always-available
 * ingestion entry points; they create `.deeporca/DESIGN.md`, which then
 * activates this server for follow-up interactive work (compute_drift,
 * findings, …).
 */
export function hasDembrandtDesignContext(projectRoot: string): boolean {
  try {
    if (fs.statSync(path.join(projectRoot, "designs")).isDirectory()) return true;
  } catch {
    // No designs/ directory — fall through to the brand contract check.
  }
  try {
    return fs.statSync(path.join(projectRoot, ".deeporca", "DESIGN.md")).isFile();
  } catch {
    return false;
  }
}

// ── MCP config builder ────────────────────────────────────────────────────────

/**
 * Build the MCP server spawn config for dembrandt (13 tools: extract,
 * compute_drift, findings, …). Returns null when the server is disabled for
 * this project root, the project shows no design context, OR the offline
 * vendored tree is not provisioned (never spawn npx at runtime).
 *
 * Offline-only: the command comes from resolveDembrandtCommand — vendored
 * `node <vendor>/node_modules/dembrandt/dist/mcp-server.js`. The MCP manager
 * merges `env` over the inherited process environment (incl. the built-in
 * Chromium CDP endpoint when the host provider is wired) and hands
 * command/args to the SDK's StdioClientTransport — see createManagedClient in
 * mcp/mcp-manager.ts.
 */
export function buildDembrandtMcpServerConfig(projectRoot: string): McpServerConfig | null {
  if (isDembrandtDisabled(projectRoot)) {
    return null;
  }
  if (!hasDembrandtDesignContext(projectRoot)) {
    return null;
  }
  const cmd = resolveDembrandtCommand("dembrandt-mcp");
  if (cmd.kind !== "vendored") {
    return null; // not provisioned offline — do not register an unrunnable server
  }
  return {
    command: cmd.nodeBin,
    args: cmd.args,
    env: cmd.env,
    cwd: projectRoot,
  };
}
