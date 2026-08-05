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

import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
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

/** Resolve the latest openwiki version from npm registry. */
async function resolveLatestVersion() {
  if (process.env.OPENWIKI_VERSION) {
    return process.env.OPENWIKI_VERSION;
  }
  try {
    const resp = await fetch("https://registry.npmjs.org/openwiki/latest", {
      signal: AbortSignal.timeout(10000),
    });
    if (resp.ok) {
      const data = await resp.json();
      return data.version;
    }
  } catch {
    // Offline — use fallback.
  }
  log("could not resolve latest openwiki version from npm — using fallback 0.2.5");
  return "0.2.5";
}

async function main() {
  const version = await resolveLatestVersion();
  const previousVersion = existsSync(versionFile) ? readFileSync(versionFile, "utf8").trim() : null;
  const entryFile = join(targetDir, "dist", "cli.js");

  if (version === previousVersion && existsSync(entryFile) && !force) {
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
      execSync(
        `npm install --no-save --no-package-lock --legacy-peer-deps --omit=dev --ignore-scripts openwiki@${version}`,
        { cwd: tempInstall, stdio: "inherit" }
      );

      // Move node_modules/openwiki/* up to the staging root so the entry is at
      // <stagingRoot>/dist/cli.js (matching the path the desktop main expects).
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
    verify: (staging) => existsSync(join(staging, "dist", "cli.js")),
  });

  log(`done → ${targetDir} (openwiki v${version})`);
}

try {
  await main();
} catch (error) {
  console.error(`[vendor-openwiki] failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
