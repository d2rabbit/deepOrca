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

  // Clean target.
  rmSync(targetDir, { recursive: true, force: true });
  mkdirSync(targetDir, { recursive: true });

  // Install the published package directly into the vendor dir.
  // --legacy-peer-deps: handles upstream peer conflicts.
  // --omit=dev: skip devDependencies.
  // --ignore-scripts: skip postinstall scripts for safety.
  try {
    // Use a temp dir outside the workspace to avoid npm workspace interference.
    const tempInstall = join(targetDir, "_npm_install");
    mkdirSync(tempInstall, { recursive: true });
    // Write a dummy package.json so npm doesn't traverse up to the workspace root.
    writeFileSync(join(tempInstall, "package.json"), '{"name":"_openwiki_vendor","private":true}');
    execSync(
      `npm install --no-save --no-package-lock --legacy-peer-deps --omit=dev --ignore-scripts openwiki@${version}`,
      { cwd: tempInstall, stdio: "inherit" }
    );
  } catch (error) {
    if (existsSync(entryFile)) {
      log(`install failed (offline?) — keeping existing openwiki: ${error.message}`);
      return;
    }
    throw error;
  }

  // Move node_modules/openwiki/* up to the vendor root so the entry is at
  // <vendorRoot>/dist/cli.js (matching the path the desktop main expects).
  const npmPkgDir = join(targetDir, "_npm_install", "node_modules", "openwiki");
  if (existsSync(npmPkgDir)) {
    // Copy dist + package.json + node_modules (runtime deps) to vendor root.
    for (const item of ["dist", "package.json", "node_modules"]) {
      const src = join(npmPkgDir, "..", item === "node_modules" ? "" : item);
      if (item === "node_modules") {
        // Copy the full node_modules from the temp install (runtime deps).
        cpSync(join(targetDir, "_npm_install", "node_modules"), join(targetDir, "node_modules"), { recursive: true });
      } else if (existsSync(src)) {
        cpSync(src, join(targetDir, item), { recursive: true });
      }
    }
  }

  // Clean up temp install dir.
  rmSync(join(targetDir, "_npm_install"), { recursive: true, force: true });

  // Verify entry exists.
  if (!existsSync(entryFile)) {
    log(`WARNING: dist/cli.js not found after install — openwiki may not work`);
  }

  // Write version marker.
  writeFileSync(versionFile, version);
  log(`done → ${targetDir} (openwiki v${version})`);
}

try {
  await main();
} catch (error) {
  console.error(`[vendor-openwiki] failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
