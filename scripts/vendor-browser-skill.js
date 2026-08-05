// Vendor BrowserSkill (https://github.com/Tencent/BrowserSkill) into the desktop app.
//
// BrowserSkill publishes prebuilt Rust binaries (`bsk` CLI) via GitHub Releases.
// Asset naming: bsk-v<version>-<arch>-<platform>-<env>.tar.gz / .zip
//
// Usage:
//   node scripts/vendor-browser-skill.js            # download/refresh binary
//   node scripts/vendor-browser-skill.js --force    # force re-download
//
// Env overrides:
//   BSK_VERSION  (default: latest cli release from GitHub Releases API)

import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { platform as osPlatform, arch as osArch } from "node:os";
import { download as sharedDownload, GITHUB_PROXY } from "./vendor-download.js";
import { withAtomicSwap } from "./vendor-fs.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const targetDir = join(repoRoot, "packages", "desktop", "vendor", "browser-skill");
const versionFile = join(targetDir, ".vendored-bsk-version");
const force = process.argv.includes("--force");

function log(message) {
  console.log(`[vendor-browser-skill] ${message}`);
}

/**
 * Map host platform/arch to BrowserSkill's release asset naming.
 * Assets: bsk-v<ver>-<arch>-<platform>-<env>.<ext>
 */
function hostAssetName(version) {
  const plat = osPlatform();
  const arch = osArch();
  let archName;
  let platformPart;
  let ext;

  if (arch === "arm64") archName = "aarch64";
  else if (arch === "x64") archName = "x86_64";
  else throw new Error(`unsupported arch: ${arch}`);

  if (plat === "darwin") {
    platformPart = "apple-darwin";
    ext = "tar.gz";
  } else if (plat === "linux") {
    platformPart = "unknown-linux-musl";
    ext = "tar.gz";
  } else if (plat === "win32") {
    platformPart = "pc-windows-msvc";
    ext = "zip";
  } else {
    throw new Error(`unsupported platform: ${plat}`);
  }

  return { assetName: `bsk-v${version}-${archName}-${platformPart}.${ext}`, ext };
}

/** Resolve the latest BrowserSkill CLI release tag from GitHub API. */
async function resolveLatestVersion() {
  if (process.env.BSK_VERSION) {
    return process.env.BSK_VERSION;
  }
  try {
    const apiUrl = "https://api.github.com/repos/Tencent/BrowserSkill/releases/latest";
    let resp = await fetch(apiUrl, {
      headers: { "User-Agent": "deeporca-vendor-bsk" },
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) {
      resp = await fetch(`${GITHUB_PROXY}${apiUrl}`, {
        headers: { "User-Agent": "deeporca-vendor-bsk" },
        signal: AbortSignal.timeout(10000),
      });
    }
    if (resp.ok) {
      const data = await resp.json();
      const tag = data.tag_name; // e.g. "cli-v0.1.9"
      // Extract version from tag: "cli-v0.1.9" → "0.1.9"
      return tag.startsWith("cli-v") ? tag.slice(5) : tag.startsWith("v") ? tag.slice(1) : tag;
    }
  } catch {
    // Offline — use fallback.
  }
  log("could not resolve latest bsk version — using fallback 0.1.9");
  return "0.1.9";
}

/** Download with proxy fallback. */
async function download(url, dest) {
  return sharedDownload(url, dest, log);
}

async function main() {
  const version = await resolveLatestVersion();
  const previousVersion = existsSync(versionFile) ? readFileSync(versionFile, "utf8").trim() : null;
  const { assetName, ext } = hostAssetName(version);
  const binaryName = process.platform === "win32" ? "bsk.exe" : "bsk";

  if (version === previousVersion && existsSync(join(targetDir, binaryName)) && !force) {
    log(`up-to-date (v${version}) — skipping download.`);
    return;
  }

  log(`downloading bsk v${version} (prev: ${previousVersion ?? "none"}) …`);

  const downloadUrl = `https://github.com/Tencent/BrowserSkill/releases/download/cli-v${version}/${assetName}`;

  // Atomic swap: build into a staging dir, swap into place only on success.
  // Earlier code did rmSync(targetDir) BEFORE downloading, so a transient
  // network/proxy failure destroyed a known-good cache (the "keep existing"
  // fallback checked a binary that had just been deleted).
  await withAtomicSwap(targetDir, {
    log,
    tag: "browser-skill",
    build: async (staging) => {
      const archivePath = join(staging, assetName);
      await download(downloadUrl, archivePath);

      // Extract into staging.
      if (ext === "tar.gz") {
        execSync(`tar -xzf "${archivePath}" -C "${staging}"`, { stdio: "inherit" });
      } else {
        try {
          execSync(`tar -xf "${archivePath}" -C "${staging}"`, { stdio: "inherit" });
        } catch {
          execSync(`powershell -Command "Expand-Archive -Path '${archivePath}' -DestinationPath '${staging}'"`, {
            stdio: "inherit",
          });
        }
      }

      const stagingBinary = join(staging, binaryName);
      // Make binary executable on unix.
      if (process.platform !== "win32" && existsSync(stagingBinary)) {
        execSync(`chmod +x "${stagingBinary}"`);
      }
      // Write the version marker atomically with the swap.
      writeFileSync(join(staging, ".vendored-bsk-version"), version);
    },
    verify: (staging) => existsSync(join(staging, binaryName)),
  });

  log(`done → ${targetDir} (bsk v${version})`);
}

try {
  await main();
} catch (error) {
  console.error(`[vendor-browser-skill] failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
