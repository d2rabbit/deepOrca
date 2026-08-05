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
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { platform as osPlatform, arch as osArch } from "node:os";
import { download as sharedDownload, fetchText, GITHUB_PROXY } from "./vendor-download.js";

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
    const apiUrl = "https://api.github.com/repos/colbymchenry/codegraph/releases/latest";
    const proxyApiUrl = `${GITHUB_PROXY}${apiUrl}`;
    let resp = await fetch(apiUrl, {
      headers: { "User-Agent": "deeporca-vendor-codegraph" },
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) {
      resp = await fetch(proxyApiUrl, {
        headers: { "User-Agent": "deeporca-vendor-codegraph" },
        signal: AbortSignal.timeout(10000),
      });
    }
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

/** Download with proxy fallback. */
async function download(url, dest) {
  return sharedDownload(url, dest, log);
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

    // Verify checksum when SHA256SUMS is available. A present-but-mismatched
    // (or present-but-missing-this-asset) checksum must FAIL CLOSED — earlier
    // code caught the mismatch in the same handler as "SHA256SUMS unavailable"
    // and logged "verification skipped", then shipped the untrusted archive.
    // Only an unreachable SHA256SUMS endpoint is non-fatal (best-effort).
    const sumsUrl = `https://github.com/colbymchenry/codegraph/releases/download/v${version}/SHA256SUMS`;
    let sumsText = null;
    try {
      sumsText = await fetchText(sumsUrl, log);
    } catch (sumsErr) {
      log(`WARNING: SHA256SUMS unavailable — checksum verification skipped: ${sumsErr.message}`);
    }
    if (sumsText) {
      const expectedHash = sumsText
        .split("\n")
        .find((line) => line.includes(assetName))
        ?.split(/\s+/)[0];
      if (!expectedHash) {
        // SHA256SUMS exists but has no line for this asset — treat as a
        // checksum failure (the release manifest does not cover this asset).
        throw new Error(`SHA256SUMS present but contains no entry for ${assetName}`);
      }
      const { createHash } = await import("node:crypto");
      const archiveBuffer = readFileSync(archivePath);
      const actualHash = createHash("sha256").update(archiveBuffer).digest("hex");
      if (actualHash !== expectedHash) {
        throw new Error(`checksum mismatch: expected ${expectedHash}, got ${actualHash}`);
      }
      log(`checksum verified ✓ (${assetName})`);
    }
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
  // The tarball has a nested top-level dir (codegraph-<target>/) — strip it.
  mkdirSync(binaryDir, { recursive: true });
  if (!isWindows) {
    execSync(`tar -xzf "${archivePath}" --strip-components=1 -C "${binaryDir}"`, { stdio: "inherit" });
  } else {
    // Windows: extract to temp then move contents up (no --strip-components in Windows tar).
    const tempExtract = join(targetDir, "_extract");
    mkdirSync(tempExtract, { recursive: true });
    try {
      execSync(`tar -xf "${archivePath}" -C "${tempExtract}"`, { stdio: "inherit" });
    } catch {
      execSync(`powershell -Command "Expand-Archive -Path '${archivePath}' -DestinationPath '${tempExtract}'"`, {
        stdio: "inherit",
      });
    }
    // Move the nested dir's contents up to binaryDir.
    const nested = join(tempExtract, `codegraph-${platformArch}`);
    if (existsSync(nested)) {
      execSync(`xcopy /E /I /Y "${nested}" "${binaryDir}"`, { stdio: "inherit" });
    } else {
      // Fallback: move all contents directly.
      execSync(`xcopy /E /I /Y "${tempExtract}" "${binaryDir}"`, { stdio: "inherit" });
    }
    rmSync(tempExtract, { recursive: true, force: true });
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
