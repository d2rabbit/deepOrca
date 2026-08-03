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
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { platform as osPlatform, arch as osArch } from "node:os";
import { Readable } from "node:stream";

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
    const resp = await fetch("https://api.github.com/repos/Tencent/BrowserSkill/releases/latest", {
      headers: { "User-Agent": "deeporca-vendor-bsk" },
      signal: AbortSignal.timeout(10000),
    });
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

/** Download a URL to a file path. */
async function download(url, dest) {
  log(`downloading ${url}`);
  const resp = await fetch(url, {
    headers: { "User-Agent": "deeporca-vendor-bsk" },
    signal: AbortSignal.timeout(60000),
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

async function main() {
  const version = await resolveLatestVersion();
  const previousVersion = existsSync(versionFile) ? readFileSync(versionFile, "utf8").trim() : null;
  const { assetName, ext } = hostAssetName(version);
  const binaryName = process.platform === "win32" ? "bsk.exe" : "bsk";
  const binaryPath = join(targetDir, binaryName);

  if (version === previousVersion && existsSync(binaryPath) && !force) {
    log(`up-to-date (v${version}) — skipping download.`);
    return;
  }

  log(`downloading bsk v${version} (prev: ${previousVersion ?? "none"}) …`);

  rmSync(targetDir, { recursive: true, force: true });
  mkdirSync(targetDir, { recursive: true });

  const downloadUrl = `https://github.com/Tencent/BrowserSkill/releases/download/cli-v${version}/${assetName}`;
  const archivePath = join(targetDir, assetName);

  try {
    await download(downloadUrl, archivePath);
  } catch (error) {
    log(`download failed: ${error.message}`);
    if (existsSync(binaryPath)) {
      log("keeping existing bsk binary");
      return;
    }
    throw error;
  }

  // Extract.
  if (ext === "tar.gz") {
    execSync(`tar -xzf "${archivePath}" -C "${targetDir}"`, { stdio: "inherit" });
  } else {
    try {
      execSync(`tar -xf "${archivePath}" -C "${targetDir}"`, { stdio: "inherit" });
    } catch {
      execSync(`powershell -Command "Expand-Archive -Path '${archivePath}' -DestinationPath '${targetDir}'"`, {
        stdio: "inherit",
      });
    }
  }

  rmSync(archivePath, { force: true });

  // Make binary executable on unix.
  if (process.platform !== "win32" && existsSync(binaryPath)) {
    execSync(`chmod +x "${binaryPath}"`);
  }

  writeFileSync(versionFile, version);
  log(`done → ${targetDir} (bsk v${version})`);
}

try {
  await main();
} catch (error) {
  console.error(`[vendor-browser-skill] failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
