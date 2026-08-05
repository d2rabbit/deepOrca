// Vendor uv (https://github.com/astral-sh/uv) into the desktop app.
//
// uv is a single-file statically-linked Rust binary that provides isolated
// Python environments via `uvx` (similar to npx for Python). We vendor the
// pre-built platform binaries so the desktop client can run Python-based MCP
// servers (like code-review-graph) without requiring a host Python install.
//
// `uvx code-review-graph` automatically downloads a standalone Python 3.12
// build and installs CRG into an isolated environment — all managed by uv,
// invisible to the user.
//
// Usage:
//   node scripts/vendor-uv.js            # download/refresh binaries
//   node scripts/vendor-uv.js --force    # force re-download
//
// Env overrides:
//   UV_VERSION  (default: latest stable from GitHub Releases)

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { download as sharedDownload, GITHUB_PROXY } from "./vendor-download.js";
import { withAtomicSwap } from "./vendor-fs.js";
import { platform as osPlatform, arch as osArch } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const targetDir = join(repoRoot, "packages", "desktop", "vendor", "uv");
const versionFile = join(targetDir, ".vendored-uv-version");

const force = process.argv.includes("--force");

function log(message) {
  console.log(`[vendor-uv] ${message}`);
}

/**
 * Map the current host platform/arch to uv's release asset naming.
 * uv uses these target triples:
 *   aarch64-apple-darwin, x86_64-apple-darwin,
 *   aarch64-unknown-linux-gnu, x86_64-unknown-linux-gnu,
 *   aarch64-pc-windows-msvc, x86_64-pc-windows-msvc
 */
function hostTarget() {
  const plat = osPlatform();
  const arch = osArch();
  if (plat === "darwin") {
    return arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
  }
  if (plat === "linux") {
    return arch === "arm64" ? "aarch64-unknown-linux-gnu" : "x86_64-unknown-linux-gnu";
  }
  if (plat === "win32") {
    return arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc";
  }
  throw new Error(`unsupported platform: ${plat} ${arch}`);
}

/** Resolve the latest uv release tag from GitHub API (falls back to hardcoded). */
async function resolveLatestVersion() {
  if (process.env.UV_VERSION) {
    return process.env.UV_VERSION;
  }
  try {
    const apiUrl = "https://api.github.com/repos/astral-sh/uv/releases/latest";
    let resp = await fetch(apiUrl, {
      headers: { "User-Agent": "deeporca-vendor-uv" },
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) {
      resp = await fetch(`${GITHUB_PROXY}${apiUrl}`, {
        headers: { "User-Agent": "deeporca-vendor-uv" },
        signal: AbortSignal.timeout(10000),
      });
    }
    if (resp.ok) {
      const data = await resp.json();
      const tag = data.tag_name; // e.g. "0.11.32"
      return tag.startsWith("v") ? tag.slice(1) : tag;
    }
  } catch {
    // Offline or rate-limited — use fallback.
  }
  log("could not resolve latest uv version from GitHub — using fallback 0.11.32");
  return "0.11.32";
}

/** Download with proxy fallback. */
async function download(url, dest) {
  return sharedDownload(url, dest, log);
}

/** Extract a .tar.gz file using the system tar (available on all supported platforms). */
function extractTarGz(archivePath, destDir) {
  execSync(`tar -xzf "${archivePath}" -C "${destDir}"`, { stdio: "inherit" });
}

async function main() {
  const version = await resolveLatestVersion();
  const previousVersion = existsSync(versionFile) ? readFileSync(versionFile, "utf8").trim() : null;
  const target = hostTarget();

  if (version === previousVersion && existsSync(join(targetDir, target)) && !force) {
    log(`up-to-date (v${version}) — skipping download.`);
    return;
  }

  log(`downloading uv v${version} (prev: ${previousVersion ?? "none"}) …`);

  const ext = target.includes("windows") ? "zip" : "tar.gz";
  const assetName = `uv-${target}.${ext}`;
  const downloadUrl = `https://github.com/astral-sh/uv/releases/download/${version}/${assetName}`;

  // Atomic swap: build into a staging dir, swap into place only when the
  // platform binary dir exists. Earlier code did rmSync(targetDir) BEFORE
  // downloading, so a transient network/proxy failure destroyed a known-good
  // cache (the "keep existing" fallback checked a dir that had just been deleted).
  await withAtomicSwap(targetDir, {
    log,
    tag: "uv",
    build: async (staging) => {
      const archivePath = join(staging, assetName);
      await download(downloadUrl, archivePath);

      // Extract into a platform-specific subdirectory inside staging.
      const extractDir = join(staging, target);
      mkdirSync(extractDir, { recursive: true });

      if (ext === "tar.gz") {
        extractTarGz(archivePath, extractDir);
      } else {
        // .zip on Windows — use tar (Windows 10+ ships tar.exe) or PowerShell.
        try {
          execSync(`tar -xf "${archivePath}" -C "${extractDir}"`, { stdio: "inherit" });
        } catch {
          execSync(`powershell -Command "Expand-Archive -Path '${archivePath}' -DestinationPath '${extractDir}'"`, {
            stdio: "inherit",
          });
        }
      }
      // Write the version marker atomically with the swap.
      writeFileSync(join(staging, ".vendored-uv-version"), version);
    },
    verify: (staging) => existsSync(join(staging, target)),
  });

  log(`done → ${join(targetDir, target)} (uv v${version})`);
}

try {
  await main();
} catch (error) {
  console.error(`[vendor-uv] failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
