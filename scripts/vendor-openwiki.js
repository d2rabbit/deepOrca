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
import { fileURLToPath } from "node:url";
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

async function main() {
  const version = resolvePinnedVersion();
  const previousVersion = existsSync(versionFile) ? readFileSync(versionFile, "utf8").trim() : null;

  if (version === previousVersion && resolveCliEntry(targetDir) && !force) {
    log(`up-to-date (v${version}) — skipping install.`);
    return;
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
      // Copy openwiki's own dist + package.json up to the staging root.
      for (const item of ["dist", "package.json"]) {
        const src = join(npmPkgDir, item);
        if (existsSync(src)) {
          cpSync(src, join(staging, item), { recursive: true });
        }
      }
      // Copy the full node_modules from the temp install (openwiki's runtime deps).
      cpSync(tempNodeModules, join(staging, "node_modules"), { recursive: true });
      // Clean up temp install dir inside staging.
      rmSync(tempInstall, { recursive: true, force: true });
      // Write the version marker atomically with the swap.
      writeFileSync(join(staging, ".vendored-openwiki-version"), version);
    },
    verify: (staging) => resolveCliEntry(staging) !== null,
  });

  log(`done → ${targetDir} (openwiki v${version})`);
}

try {
  await main();
} catch (error) {
  console.error(`[vendor-openwiki] failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
