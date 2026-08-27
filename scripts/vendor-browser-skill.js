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
//   BSK_VERSION  (optional; default is the PINNED version below — bump it
//                 deliberately together with a digest re-check, never float)

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { platform as osPlatform, arch as osArch } from "node:os";
import { download as sharedDownload, GITHUB_PROXY, assertSafeVersion } from "./vendor-download.js";
import { withAtomicSwap } from "./vendor-fs.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const targetDir = join(repoRoot, "packages", "desktop", "vendor", "browser-skill");
const versionFile = join(targetDir, ".vendored-bsk-version");
const force = process.argv.includes("--force");

/** Pinned release (P2 hardening 2026-08-27): floating `releases/latest` let
 *  upstream — or a compromised proxy in the fallback chain — repoint the
 *  vendored binary to whatever ships next. Follow crg/serena: pin, and bump
 *  deliberately via BSK_VERSION together with a digest re-check. */
const BSK_PINNED_VERSION = "0.1.9";

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

/** Resolve the bsk version: explicit BSK_VERSION, else the pinned tag.
 *  (Replaced floating releases/latest — see BSK_PINNED_VERSION.) */
async function resolveLatestVersion() {
  if (process.env.BSK_VERSION) {
    return assertSafeVersion(process.env.BSK_VERSION, "BSK_VERSION");
  }
  return BSK_PINNED_VERSION;
}

/**
 * Best-effort fetch of the pinned release asset's sha256 digest from the
 * GitHub API (assets[].digest, "sha256:<hex>"). Digest and bytes come from
 * the same channel — this defends against transmission/mirror tampering,
 * not a malicious publisher (same trust model as crg/serena). Unavailable
 * → null → download proceeds logged as unverified.
 */
async function resolveAssetDigest(version, assetName) {
  const apiUrl = `https://api.github.com/repos/Tencent/BrowserSkill/releases/tags/cli-v${version}`;
  for (const url of [apiUrl, `${GITHUB_PROXY}${apiUrl}`]) {
    try {
      const resp = await fetch(url, {
        headers: { "User-Agent": "deeporca-vendor-bsk" },
        signal: AbortSignal.timeout(10000),
      });
      if (!resp.ok) continue;
      const data = await resp.json();
      const asset = (data.assets ?? []).find((a) => a.name === assetName);
      const digest = asset?.digest;
      return typeof digest === "string" && digest.startsWith("sha256:") ? digest : null;
    } catch {
      // Offline — fall through to next candidate / unverified warning.
    }
  }
  return null;
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
      const expectedSha256 = await resolveAssetDigest(version, assetName);
      if (!expectedSha256) {
        log("no sha256 digest available from release metadata — downloaded unverified");
      }
      await sharedDownload(downloadUrl, archivePath, log, expectedSha256);

      // Extract into staging.
      if (ext === "tar.gz") {
        execFileSync("tar", ["-xzf", archivePath, "-C", staging], { stdio: "inherit" });
      } else {
        try {
          execFileSync("tar", ["-xf", archivePath, "-C", staging], { stdio: "inherit" });
        } catch {
          execFileSync(
            "powershell",
            ["-Command", `Expand-Archive -Path '${archivePath}' -DestinationPath '${staging}'`],
            {
              stdio: "inherit",
            }
          );
        }
      }

      const stagingBinary = join(staging, binaryName);
      // Make binary executable on unix.
      if (process.platform !== "win32" && existsSync(stagingBinary)) {
        execFileSync("chmod", ["+x", stagingBinary]);
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
