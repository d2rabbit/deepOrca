// Vendor OpenWiki (https://github.com/langchain-ai/openwiki) into the desktop app.
//
// OpenWiki's published npm package `openwiki` ships with a pre-compiled
// `dist/cli.js`. This script installs it directly into the vendor directory —
// no git clone, no build step. The --legacy-peer-deps flag handles upstream
// peer dependency conflicts (deepagents wants langsmith ^0.7, root pins ^0.8).
//
// Usage:
//   node scripts/vendor-openwiki.js            # install/refresh
//   node scripts/vendor-openwiki.js --force    # force reinstall
//
// Env overrides:
//   OPENWIKI_VERSION  (default: latest from npm)

import { execFileSync } from "node:child_process";
import { assertSafeVersion } from "./vendor-download.js";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, URL as NodeURL } from "node:url";
import { withAtomicSwap } from "./vendor-fs.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const targetDir = join(repoRoot, "packages", "desktop", "vendor", "openwiki");
const versionFile = join(targetDir, ".vendored-openwiki-version");
const force = process.argv.includes("--force");

function log(message) {
  console.log(`[vendor-openwiki] ${message}`);
}

/**
 * Resolve npm's cli entry for argv-form execution (mirrors vendor-dembrandt):
 * npm_execpath when run under an npm lifecycle script, else the standard
 * Node/nvm-windows layout. Values are validated before use (absolute, no
 * traversal, exactly npm-cli.js) because npm_execpath is env-influenced.
 */
function resolveNpmCli() {
  const candidates = [];
  if (process.env.npm_execpath) candidates.push(process.env.npm_execpath);
  candidates.push(join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"));
  for (const candidate of candidates) {
    if (
      typeof candidate === "string" &&
      candidate.length > 0 &&
      isAbsolute(candidate) &&
      candidate.endsWith("npm-cli.js") &&
      !candidate.split(/[\\/]/).includes("..")
    ) {
      try {
        if (statSync(candidate).isFile()) return candidate;
      } catch {
        // Candidate doesn't exist — try the next.
      }
    }
  }
  return null;
}

/**
 * Pinned openwiki version (same pin discipline as every other vendor script —
 * resolving "latest" from the registry is a moving target and already broke us
 * once: 0.3.3 moved the CLI entry from dist/cli.js to dist/cli/cli.js while
 * this script and the desktop main both expected the old layout). Bump via PR;
 * OPENWIKI_VERSION env overrides for one-off testing.
 */
const PINNED_OPENWIKI_VERSION = "0.3.3";

/** openwiki CLI entry candidates across package layouts (0.2.x → 0.3.x moved it). */
function cliEntryCandidates(root) {
  return [join(root, "dist", "cli", "cli.js"), join(root, "dist", "cli.js")];
}

function resolveCliEntry(root) {
  return cliEntryCandidates(root).find((candidate) => existsSync(candidate)) ?? null;
}

function resolvePinnedVersion() {
  if (process.env.OPENWIKI_VERSION) {
    return assertSafeVersion(process.env.OPENWIKI_VERSION, "OPENWIKI_VERSION");
  }
  return PINNED_OPENWIKI_VERSION;
}

/** Electron version the desktop app runs (drives the native binding's ABI). */
function resolveElectronVersion() {
  try {
    const pkg = JSON.parse(readFileSync(join(repoRoot, "node_modules", "electron", "package.json"), "utf8"));
    if (typeof pkg.version === "string" && pkg.version) return pkg.version;
  } catch {
    // fall through
  }
  throw new Error("cannot resolve the installed Electron version — run npm install first");
}

/**
 * Build better-sqlite3's native binding for the Electron ABI the desktop app
 * ships. Runs `npm rebuild better-sqlite3 --build-from-source` with the
 * electron npm_config_* knobs — source compilation against the pinned
 * Electron headers is forced deliberately (published prebuilds would also
 * work when the version is in better-sqlite3's matrix, but forcing source
 * keeps the result independent of that matrix). Works under nvm/homebrew/
 * system Node layouts alike (a direct node-gyp path guess does not).
 * Hard-fails the vendor step when no binding lands — a missing binding
 * surfaces at runtime as a wiki stage that produces nothing, which is exactly
 * the silent failure this step exists to prevent.
 */
/**
 * SECURITY (Mimosa constraint): mirror URL below is a script constant.
 * Assert it (https + pinned host) so a future edit cannot aim node-gyp's
 * download at a non-public or foreign host without an explicit review here.
 * Returns the url so callers can use the call inline as the env value — an
 * assert helper without a return silently assigns `undefined`, and Node's
 * child_process DROPS undefined env entries (the mirror never reaches npm).
 */
function assertMirrorUrl(url, allowedHost) {
  let parsed;
  try {
    parsed = new NodeURL(url);
  } catch {
    throw new Error(`unsafe mirror url: not a URL: ${JSON.stringify(url)}`);
  }
  if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== allowedHost) {
    throw new Error(`unsafe mirror url: ${url} (expected https://${allowedHost})`);
  }
  return url;
}

/** Probe-free note: npm 11 stopped forwarding unknown .npmrc keys into
 *  lifecycle-script env (observed 2026-08-27), so the mirror is selected at
 *  the dist_url source itself instead of steering script env afterwards. */

/** Strict semver check on the Electron version before it ever reaches a URL,
 *  path, or process argument — the value is read from the repo's own
 *  electron package.json, but a tampered tree must fail here instead of
 *  shaping an artifact URL or path. */
function assertSafeElectronVersion(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`unsafe electron version: ${JSON.stringify(version)}`);
  }
  return version;
}

/** Small GET-to-file helper (Node 24 global fetch; follows the mirror's CDN
 *  redirects). Rejects non-2xx and absurdly small payloads so a captive
 *  portal / HTML error page can never masquerade as a binary artifact. */
async function downloadTo(url, destPath, label) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${label}: HTTP ${response.status} from ${url}`);
  }
  // Uint8Array, not Buffer — scripts/*.js lint without node globals.
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length < 1024) {
    throw new Error(`${label}: suspiciously small payload (${bytes.length}B) from ${url}`);
  }
  writeFileSync(destPath, bytes);
  return destPath;
}

/** Stage a local --nodedir tree so node-gyp's configure reads everything
 *  from disk. WHY (real-machine 2026-08-28): node-gyp 12 verifies every
 *  downloaded artifact against the dist's SHASUMS256.txt, but Electron's
 *  SHASUMS (a) omits the headers tarball entirely and (b) writes
 *  `checksum *name` while node-gyp only strips a `./` prefix — never the
 *  `*` — so every lookup resolves undefined and configure dies with
 *  "local checksum … not match remote undefined" (npmmirror AND
 *  electronjs.org alike). With nodedir set, node-gyp reads headers from
 *  <dir>/include/node and links <dir>/Release/node.lib, downloading and
 *  checksumming nothing. The headers tarball is extracted with the hoisted
 *  `tar` package (pure JS — no shell, no command string). */
async function stageElectronNodeDir(staging, electronVersion) {
  const nodeDir = join(staging, "_electron_nodedir");
  mkdirSync(join(nodeDir, "include"), { recursive: true });
  mkdirSync(join(nodeDir, "Release"), { recursive: true });
  const artifactsUrl = `${assertMirrorUrl("https://npmmirror.com/mirrors/electron/", "npmmirror.com")}v${electronVersion}/`;

  const headersTarball = await downloadTo(
    `${artifactsUrl}node-v${electronVersion}-headers.tar.gz`,
    join(staging, "_electron_headers.tar.gz"),
    "electron headers"
  );
  const { extract } = await import("tar");
  await extract({ file: headersTarball, cwd: nodeDir, strip: 1 });
  if (!existsSync(join(nodeDir, "include", "node", "node.h"))) {
    throw new Error(`electron headers tarball did not extract include/node/node.h into ${nodeDir}`);
  }
  // The import library is Windows-only; POSIX links the .so/.dylib directly.
  if (process.platform === "win32") {
    await downloadTo(`${artifactsUrl}win-x64/node.lib`, join(nodeDir, "Release", "node.lib"), "electron node.lib");
  }
  return nodeDir;
}

async function buildSqliteBinding(staging) {
  // The binding builds inside the TEMP INSTALL's node_modules (staging's own
  // node_modules is only copied over after this step).
  const pkgDir = join(staging, "_npm_install", "node_modules", "better-sqlite3");
  if (!existsSync(pkgDir)) {
    throw new Error(`better-sqlite3 not found at ${pkgDir} — openwiki's dependency tree changed?`);
  }
  const electronVersion = assertSafeElectronVersion(resolveElectronVersion());
  log(`building better-sqlite3 binding (electron v${electronVersion}) …`);
  const nodedir = await stageElectronNodeDir(staging, electronVersion);
  const npmCli = resolveNpmCli();
  const rebuildArgs = ["rebuild", "better-sqlite3"];
  const env = {
    ...process.env,
    npm_config_runtime: "electron",
    npm_config_target: electronVersion,
    // Headers + node.lib come from the staged nodedir tree (see
    // stageElectronNodeDir) — node-gyp downloads nothing, so the broken
    // SHASUMS verification path is never reached. build_from_source keeps
    // better-sqlite3's own install script from preferring a (missing,
    // github-hosted) prebuilt over compiling.
    npm_config_nodedir: nodedir,
    npm_config_build_from_source: "true",
  };
  // The rebuild must run in the INSTALL ROOT (npm resolves the package by
  // name from there), not inside the package dir.
  const installRoot = join(staging, "_npm_install");
  if (npmCli) {
    execFileSync(process.execPath, [npmCli, ...rebuildArgs], { cwd: installRoot, stdio: "inherit", env });
  } else {
    execFileSync("npm", rebuildArgs, { cwd: installRoot, stdio: "inherit", env });
  }
  if (!existsSync(join(pkgDir, "build", "Release", "better_sqlite3.node"))) {
    throw new Error(
      `better-sqlite3 rebuild finished without producing build/Release/better_sqlite3.node (electron v${electronVersion})`
    );
  }
}

async function main() {
  const version = resolvePinnedVersion();
  const previousVersion = existsSync(versionFile) ? readFileSync(versionFile, "utf8").trim() : null;

  // Tree-completeness guard: "up-to-date" must also mean "tree intact". The
  // skills/ dir was observed vanishing from an installed tree (real-machine
  // 2026-08-27) while the version marker stayed current — every build then
  // happily skipped while --init ENOENT'd at runtime. Require the same paths
  // the installer copies before honoring the marker. The better-sqlite3
  // native binding is part of that contract: trees vendored before the
  // buildSqliteBinding step existed carry the 0.3.3 marker but no binding,
  // and every build then skipped while --init died with "Could not locate
  // the bindings file" (real-machine 2026-08-28).
  const requiredPaths = [
    "dist",
    "package.json",
    "skills",
    "node_modules/better-sqlite3/build/Release/better_sqlite3.node",
  ];
  const treeComplete = requiredPaths.every((item) => existsSync(join(targetDir, item)));

  if (version === previousVersion && treeComplete && resolveCliEntry(targetDir) && !force) {
    log(`up-to-date (v${version}) — skipping install.`);
    return;
  }
  if (version === previousVersion && !treeComplete) {
    log(`v${version} marker present but vendored tree incomplete — reinstalling …`);
  }

  log(`installing openwiki v${version} (prev: ${previousVersion ?? "none"}) …`);

  // Atomic swap: install into a staging dir, swap into place only when the
  // entry exists. Earlier code did rmSync(targetDir) BEFORE the npm install,
  // so a transient install/network failure destroyed a known-good cache (the
  // "keep existing" fallback checked an entry that had just been deleted).
  await withAtomicSwap(targetDir, {
    log,
    tag: "openwiki",
    build: async (staging) => {
      // Install the published package into a temp dir under staging.
      // --legacy-peer-deps: handles upstream peer conflicts.
      // --omit=dev: skip devDependencies.
      // --ignore-scripts: skip postinstall scripts for safety.
      const tempInstall = join(staging, "_npm_install");
      mkdirSync(tempInstall, { recursive: true });
      // Dummy package.json so npm doesn't traverse up to the workspace root.
      writeFileSync(join(tempInstall, "package.json"), '{"name":"_openwiki_vendor","private":true}');
      // Run npm argv-form via node + npm-cli.js — same approach as
      // scripts/vendor-dembrandt.js. On Windows a bare "npm" spawn is ENOENT
      // (execFileSync doesn't run .cmd via PATHEXT) while "npm.cmd" throws
      // EINVAL since Node's 2024-04 batch-file hardening (F4 smoke findings).
      const npmCli = resolveNpmCli();
      const installArgs = [
        "install",
        "--no-save",
        "--no-package-lock",
        "--legacy-peer-deps",
        "--omit=dev",
        "--ignore-scripts",
        `openwiki@${version}`,
      ];
      if (npmCli) {
        execFileSync(process.execPath, [npmCli, ...installArgs], { cwd: tempInstall, stdio: "inherit" });
      } else {
        execFileSync("npm", installArgs, { cwd: tempInstall, stdio: "inherit" });
      }

      // Move openwiki's own dist + package.json up to the staging root; the
      // CLI entry inside dist/ is layout-dependent (0.2.x: dist/cli.js,
      // 0.3.x: dist/cli/cli.js) — resolveCliEntry handles both.
      const tempNodeModules = join(tempInstall, "node_modules");
      const npmPkgDir = join(tempNodeModules, "openwiki");
      if (!existsSync(npmPkgDir)) {
        throw new Error(
          `install succeeded but openwiki package dir missing (${npmPkgDir}) — refusing to write a broken vendor marker`
        );
      }
      // Copy openwiki's own dist + package.json + skills up to the staging
      // root. skills/ is REQUIRED: dist/agent/skills.js resolves its bundled
      // skills dir as resolve(dist/agent, "../../skills") — the PACKAGE ROOT's
      // skills/ — and readdir's it at --init; without the copy the vendored
      // tree throws ENOENT on vendor/openwiki/skills (observed 2026-08-23,
      // specs/index-knowledge-rework T1). Guarded: the npm package's `files`
      // declares skills, so a package without it is unexpected → hard fail
      // rather than writing a known-broken vendor marker.
      for (const item of ["dist", "package.json", "skills"]) {
        const src = join(npmPkgDir, item);
        if (!existsSync(src) && item === "skills") {
          throw new Error(
            `openwiki package has no skills/ at ${src} — upstream layout changed; refusing to vendor a tree that ENOENTs at --init`
          );
        }
        if (existsSync(src)) {
          cpSync(src, join(staging, item), { recursive: true });
        }
      }
      // better-sqlite3 ships as source + prebuilds; the install above ran with
      // --ignore-scripts so no binding exists. The desktop runs the CLI under
      // Electron's Node (ELECTRON_RUN_AS_NODE, ABI pinned by the Electron
      // version), so download/compile the binding for THAT ABI — a binding
      // built for the vendoring machine's Node would dlopen-fail at runtime
      // ("Could not locate the bindings file", observed 2026-08-23: wiki stage
      // produced nothing while the build reported success). Must run BEFORE
      // the temp install dir is removed — npm rebuild resolves the package
      // from the install root.
      await buildSqliteBinding(staging);
      // Copy the full node_modules from the temp install (openwiki's runtime deps).
      cpSync(tempNodeModules, join(staging, "node_modules"), { recursive: true });
      // Clean up temp install dir inside staging.
      rmSync(tempInstall, { recursive: true, force: true });
      // Write the version marker atomically with the swap.
      writeFileSync(join(staging, ".vendored-openwiki-version"), version);
    },
    verify: (staging) =>
      resolveCliEntry(staging) !== null &&
      existsSync(join(staging, "node_modules", "better-sqlite3", "build", "Release", "better_sqlite3.node")),
  });

  log(`done → ${targetDir} (openwiki v${version})`);
}

try {
  await main();
} catch (error) {
  console.error(`[vendor-openwiki] failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
