// Vendor CodeGraph (https://github.com/colbymchenry/codegraph) into the desktop app.
//
// CodeGraph publishes fully self-contained prebuilt binaries via GitHub Releases
// (bundled Node 24 + sqlite + app). This script downloads the matching platform
// binary directly — no source clone, no npm install, no build step.
//
// Release assets follow the naming convention:
//   codegraph-{platform}-{arch}.tar.gz  (unix)
//   codegraph-{platform}-{arch}.zip     (windows)
// Plus a SHA256SUMS file for verification.
//
// Usage:
//   node scripts/vendor-codegraph.js            # download/refresh binary
//   node scripts/vendor-codegraph.js --force    # force re-download
//
// Env overrides:
//   CODEGRAPH_VERSION  (default: latest from GitHub Releases API)

import { execSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { platform as osPlatform, arch as osArch } from "node:os";
import { Readable } from "node:stream";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const targetDir = join(repoRoot, "packages", "desktop", "vendor", "codegraph");
const versionFile = join(targetDir, ".vendored-codegraph-version");
const force = process.argv.includes("--force");

function log(message) {
  console.log(`[vendor-codegraph] ${message}`);
}

/**
 * Map the current host platform/arch to CodeGraph's release asset naming.
 * CodeGraph uses platform-arch identifiers matching npm optionalDependencies:
 *   darwin-arm64, darwin-x64, linux-arm64, linux-x64, win32-arm64, win32-x64
 */
function hostPlatformArch() {
  const plat = osPlatform();
  const arch = osArch();
  let platformName;
  let archName;
  if (plat === "darwin") platformName = "darwin";
  else if (plat === "linux") platformName = "linux";
  else if (plat === "win32") platformName = "win32";
  else throw new Error(`unsupported platform: ${plat}`);
  if (arch === "arm64") archName = "arm64";
  else if (arch === "x64") archName = "x64";
  else throw new Error(`unsupported arch: ${arch}`);
  return `${platformName}-${archName}`;
}

/** Resolve the latest CodeGraph release tag from GitHub API (falls back to hardcoded). */
async function resolveLatestVersion() {
  if (process.env.CODEGRAPH_VERSION) {
    return process.env.CODEGRAPH_VERSION;
  }
  try {
    const resp = await fetch("https://api.github.com/repos/colbymchenry/codegraph/releases/latest", {
      headers: { "User-Agent": "deeporca-vendor-codegraph" },
      signal: AbortSignal.timeout(10000),
    });
    if (resp.ok) {
      const data = await resp.json();
      const tag = data.tag_name; // e.g. "v1.5.0"
      return tag.startsWith("v") ? tag.slice(1) : tag;
    }
  } catch {
    // Offline or rate-limited — use fallback.
  }
  log("could not resolve latest CodeGraph version from GitHub — using fallback 1.5.0");
  return "1.5.0";
}

/** Download a URL to a file path. */
async function download(url, dest) {
  log(`downloading ${url}`);
  const resp = await fetch(url, {
    headers: { "User-Agent": "deeporca-vendor-codegraph" },
    signal: AbortSignal.timeout(300000), // 5 min — binaries can be ~280MB
    redirect: "follow",
  });
  if (!resp.ok || !resp.body) {
    throw new Error(`download failed: ${resp.status} ${resp.statusText}`);
  }
  const stream = createWriteStream(dest);
  await Readable.fromWeb(resp.body).pipe(stream);
  return new Promise((resolve, reject) => {
    stream.on("finish", resolve);
    stream.on("error", reject);
  });
}

/** Extract a .tar.gz file using the system tar. */
function extractTarGz(archivePath, destDir) {
  execSync(`tar -xzf "${archivePath}" -C "${destDir}"`, { stdio: "inherit" });
}

async function main() {
  const version = await resolveLatestVersion();
  const previousVersion = existsSync(versionFile) ? readFileSync(versionFile, "utf8").trim() : null;
  const platformArch = hostPlatformArch();
  const binaryDir = join(targetDir, platformArch);

  if (version === previousVersion && existsSync(binaryDir) && !force) {
    log(`up-to-date (v${version}, ${platformArch}) — skipping download.`);
    return;
  }

  log(`downloading CodeGraph v${version} (${platformArch}, prev: ${previousVersion ?? "none"}) …`);

  // Clean target.
  rmSync(targetDir, { recursive: true, force: true });
  mkdirSync(targetDir, { recursive: true });

  // Determine archive name and URL.
  const isWindows = platformArch.startsWith("win32");
  const ext = isWindows ? "zip" : "tar.gz";
  const assetName = `codegraph-${platformArch}.${ext}`;
  const downloadUrl = `https://github.com/colbymchenry/codegraph/releases/download/v${version}/${assetName}`;
  const archivePath = join(targetDir, assetName);

  try {
    await download(downloadUrl, archivePath);
  } catch (error) {
    // Check if an npm-based fallback exists
    log(`GitHub Releases download failed: ${error.message}`);
    log("attempting npm optionalDependency fallback …");
    try {
      execSync(`npm install --no-save @colbymchenry/codegraph-${platformArch}@${version}`, {
        cwd: targetDir,
        stdio: "inherit",
      });
      // The npm package installs into node_modules/@colbymchenry/codegraph-{plat}-{arch}/bin/
      const npmPkgDir = join(targetDir, "node_modules", `@colbymchenry`, `codegraph-${platformArch}`);
      if (existsSync(npmPkgDir)) {
        mkdirSync(binaryDir, { recursive: true });
        execSync(`cp -R "${npmPkgDir}/"* "${binaryDir}/"`, { stdio: "inherit" });
        rmSync(join(targetDir, "node_modules"), { recursive: true, force: true });
        writeFileSync(versionFile, version);
        log(`done via npm fallback → ${binaryDir} (CodeGraph v${version})`);
        return;
      }
    } catch {
      // npm fallback also failed
    }
    if (existsSync(binaryDir)) {
      log(`all downloads failed (offline?) — keeping existing CodeGraph binary`);
      return;
    }
    throw error;
  }

  // Extract into a platform-specific subdirectory.
  mkdirSync(binaryDir, { recursive: true });
  if (!isWindows) {
    extractTarGz(archivePath, binaryDir);
  } else {
    try {
      execSync(`tar -xf "${archivePath}" -C "${binaryDir}"`, { stdio: "inherit" });
    } catch {
      execSync(`powershell -Command "Expand-Archive -Path '${archivePath}' -DestinationPath '${binaryDir}'"`, {
        stdio: "inherit",
      });
    }
  }

  // Clean up archive.
  rmSync(archivePath, { force: true });

  // Write version marker.
  writeFileSync(versionFile, version);
  log(`done → ${binaryDir} (CodeGraph v${version})`);
}

try {
  await main();
} catch (error) {
  console.error(`[vendor-codegraph] failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
