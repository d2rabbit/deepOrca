/**
 * Download/resolve a PINNED skill-up release binary (specs/skill-eval A1 / T1.1).
 *
 * skill-up (https://github.com/alibaba/skill-up, Apache-2.0, Go) publishes
 * prebuilt binaries on GitHub Releases. We deliberately do NOT `go install
 * @latest` (version drift — design.md §六); instead this script pins one
 * release version and caches the extracted binary under `.cache/skill-up/`
 * (gitignored). CI and local dev therefore run the exact same version.
 *
 * Usage:
 *   node scripts/get-skill-up.mjs            # download (no-op when cached)
 *   node scripts/get-skill-up.mjs --check    # print resolved path/version,
 *                                            # exit 0 when ready, 1 when not
 *
 * Env overrides:
 *   SKILL_UP_VERSION   release tag to pin instead of the constant below
 *                      (validated: /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/)
 *
 * UNCERTAINTY NOTE (asset naming): at implementation time (2026-08-17) GitHub
 * was not reachable from the dev environment, so the exact release asset file
 * names could not be verified. Instead of hardcoding a guessed pattern, the
 * script resolves the asset list from the GitHub Releases API
 * (/repos/alibaba/skill-up/releases/tags/<version>) and matches the platform
 * (goos/goarch) against the asset names. The pinned SKILL_UP_VERSION below is
 * likewise a placeholder until someone with network access confirms the first
 * real tag on https://github.com/alibaba/skill-up/releases and bumps it via PR.
 *
 * Security posture (repo scanner blocks exec-with-dynamic-args):
 * - every child process is spawned in argv form with a literal program name;
 * - the only interpolated values are the validated version constant and asset
 *   names re-validated against /^[A-Za-z0-9._-]+$/ before touching a path/arg;
 * - download URLs must be https (enforced by scripts/vendor-download.js);
 * - downloaded archives get a size sanity window and the extracted binary must
 *   exist and be non-empty before the script reports success.
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { assertSafeVersion, download, fetchText } from "./vendor-download.js";

// --- pinned version ---------------------------------------------------------

/** Release tag pinned for CI + local evals. Bump via PR (design.md §六). */
const SKILL_UP_VERSION = "v0.1.0";

const SKILL_UP_REPO = "alibaba/skill-up";
const SKILL_UP_REPO_API = `https://api.github.com/repos/${SKILL_UP_REPO}`;
const SKILL_UP_REPO_RELEASES = `https://github.com/${SKILL_UP_REPO}/releases`;

// Size sanity window for the downloaded archive. A Go CLI archive is a few MB;
// anything below 512 KB is an HTML error page, anything above 300 MB is wrong.
const MIN_ARCHIVE_BYTES = 512 * 1024;
const MAX_ARCHIVE_BYTES = 300 * 1024 * 1024;
const MIN_BINARY_BYTES = 1024;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_ROOT = path.resolve(__dirname, "..", ".cache", "skill-up");

/** Resolve the effective version (env override → pinned constant), validated. */
export function resolveSkillUpVersion() {
  return assertSafeVersion(process.env.SKILL_UP_VERSION?.trim() || SKILL_UP_VERSION, "SKILL_UP_VERSION");
}

/** Cache layout: .cache/skill-up/skill-up-<version>/skill-up[.exe] */
export function skillUpCacheDir(version = resolveSkillUpVersion()) {
  return path.join(CACHE_ROOT, `skill-up-${version}`);
}

/**
 * Absolute path of the cached binary for the effective (or given) version, or
 * null when not downloaded. Exposed so run-skill-evals.mjs can reuse the cache.
 */
export function resolveCachedSkillUpBinary(version = resolveSkillUpVersion()) {
  const binaryName = process.platform === "win32" ? "skill-up.exe" : "skill-up";
  const binaryPath = path.join(skillUpCacheDir(version), binaryName);
  try {
    const stat = fs.statSync(binaryPath);
    if (stat.isFile() && stat.size >= MIN_BINARY_BYTES) {
      return binaryPath;
    }
  } catch {
    // not downloaded yet
  }
  return null;
}

// --- platform mapping --------------------------------------------------------

function goos() {
  switch (process.platform) {
    case "win32":
      return "windows";
    case "darwin":
      return "darwin";
    case "linux":
      return "linux";
    default:
      throw new Error(`unsupported platform for skill-up download: ${process.platform}`);
  }
}

function goarch() {
  switch (process.arch) {
    case "x64":
      return "amd64";
    case "arm64":
      return "arm64";
    case "ia32":
      return "386";
    default:
      throw new Error(`unsupported arch for skill-up download: ${process.arch}`);
  }
}

// --- asset discovery (GitHub Releases API, proxy fallback) -------------------

/** Asset names we accept: plain file-name characters only, no slashes. */
function isSafeAssetName(name) {
  return typeof name === "string" && /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/.test(name);
}

/**
 * Pick the release asset matching (os, arch). Prefers archives over bare
 * binaries (checksums live next to archives) and .tar.gz over .zip.
 */
function pickAsset(assetNames, os, arch) {
  const candidates = assetNames.filter((name) => {
    const lower = name.toLowerCase();
    if (!lower.includes(os) || !lower.includes(arch)) {
      return false;
    }
    // Reject checksum/signature files — we want the payload.
    return !/\.(txt|sha256|sha256sum|sig|pem|sbom)$/i.test(lower);
  });
  const byScore = (name) => {
    const lower = name.toLowerCase();
    if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) return 0;
    if (lower.endsWith(".zip")) return 1;
    if (lower.endsWith(".exe") || !lower.includes(".")) return 2;
    return 3;
  };
  candidates.sort((a, b) => byScore(a) - byScore(b));
  return candidates[0] ?? null;
}

async function fetchReleaseAssetNames(version) {
  // Try `v`-prefixed and bare tags — skill-up's tag convention is unverified.
  for (const tag of [version, version.replace(/^v/, "")]) {
    const text = await fetchText(`${SKILL_UP_REPO_API}/releases/tags/${encodeURIComponent(tag)}`);
    if (!text) {
      continue;
    }
    try {
      const release = JSON.parse(text);
      const assets = Array.isArray(release?.assets) ? release.assets : [];
      const names = assets.map((a) => a?.name).filter(isSafeAssetName);
      if (names.length > 0) {
        return names;
      }
    } catch {
      // fall through to the next tag form
    }
  }
  return null;
}

// --- archive handling --------------------------------------------------------

/**
 * Extract the downloaded archive inside the cache dir (argv-form tar, no shell
 * string). Windows 10+ ships bsdtar as `tar`, which handles tar.gz and zip.
 */
function extractArchive(archivePath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  execFileSync("tar", ["-xf", archivePath, "-C", destDir], { stdio: "inherit" });
}

/** Locate the skill-up binary inside the extracted tree (depth-first, bounded). */
function findBinaryInDir(dir) {
  const binaryName = process.platform === "win32" ? "skill-up.exe" : "skill-up";
  const queue = [dir];
  let seen = 0;
  while (queue.length > 0 && seen < 500) {
    const current = queue.shift();
    seen += 1;
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
      } else if (entry.name === binaryName) {
        const stat = fs.statSync(fullPath);
        if (stat.size >= MIN_BINARY_BYTES) {
          return fullPath;
        }
      }
    }
  }
  return null;
}

// --- main --------------------------------------------------------------------

async function main() {
  const version = resolveSkillUpVersion();
  const cacheDir = skillUpCacheDir(version);

  if (process.argv.includes("--check")) {
    const binaryPath = resolveCachedSkillUpBinary(version);
    console.log(`skill-up version : ${version}`);
    console.log(`cache dir        : ${cacheDir}`);
    console.log(`binary           : ${binaryPath ?? "(not downloaded)"}`);
    process.exit(binaryPath ? 0 : 1);
  }

  const cached = resolveCachedSkillUpBinary(version);
  if (cached) {
    console.log(`skill-up ${version} already cached at ${cached}`);
    return;
  }

  console.log(`resolving skill-up ${version} for ${goos()}/${goarch()} …`);
  const assetNames = await fetchReleaseAssetNames(version);
  if (!assetNames) {
    console.error(
      `could not list release assets for ${version} (${SKILL_UP_REPO_API}/releases/tags/${version}).\n` +
        `Check the tag on ${SKILL_UP_REPO_RELEASES} and bump SKILL_UP_VERSION in scripts/get-skill-up.mjs\n` +
        `(or set SKILL_UP_VERSION in the environment).`
    );
    process.exit(2);
  }
  const asset = pickAsset(assetNames, goos(), goarch());
  if (!asset) {
    console.error(
      `release ${version} has no asset matching ${goos()}/${goarch()}.\n` + `Available assets: ${assetNames.join(", ")}`
    );
    process.exit(2);
  }

  const archivePath = path.join(cacheDir, asset);
  fs.mkdirSync(cacheDir, { recursive: true });
  const downloadUrl = `${SKILL_UP_REPO_RELEASES}/download/${encodeURIComponent(version)}/${asset}`;
  await download(downloadUrl, archivePath);

  const size = fs.statSync(archivePath).size;
  if (size < MIN_ARCHIVE_BYTES || size > MAX_ARCHIVE_BYTES) {
    console.error(`downloaded archive has implausible size: ${size} bytes (${archivePath}) — refusing to use it`);
    process.exit(2);
  }
  // Guard against an HTML error page saved with a 2xx-looking size.
  const magic = fs.readFileSync(archivePath).subarray(0, 4);
  const isGzip = magic[0] === 0x1f && magic[1] === 0x8b;
  const isZip = magic[0] === 0x50 && magic[1] === 0x4b;
  if (!isGzip && !isZip) {
    const hex = Array.from(magic, (byte) => byte.toString(16).padStart(2, "0")).join("");
    console.error(`downloaded file is neither gzip nor zip (magic bytes ${hex}) — refusing to extract`);
    process.exit(2);
  }

  console.log(`extracting ${asset} …`);
  extractArchive(archivePath, cacheDir);
  const extracted = findBinaryInDir(cacheDir);
  if (!extracted) {
    console.error(`extraction finished but no usable skill-up binary found under ${cacheDir}`);
    process.exit(2);
  }
  // Normalize: put the binary at the well-known location run-skill-evals expects.
  const binaryName = process.platform === "win32" ? "skill-up.exe" : "skill-up";
  const finalPath = path.join(cacheDir, binaryName);
  if (path.resolve(extracted) !== path.resolve(finalPath)) {
    fs.copyFileSync(extracted, finalPath);
  }
  if (process.platform !== "win32") {
    fs.chmodSync(finalPath, 0o755);
  }
  const finalSize = fs.statSync(finalPath).size;
  if (finalSize < MIN_BINARY_BYTES) {
    console.error(`extracted binary is too small (${finalSize} bytes) — refusing`);
    process.exit(2);
  }
  console.log(`skill-up ${version} ready at ${finalPath}`);
}

// Only run as a CLI when invoked directly — run-skill-evals.mjs imports the
// helpers above and must NOT trigger a download as an import side effect.
const invokedAsCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedAsCli) {
  main().catch((error) => {
    console.error(`get-skill-up failed: ${error?.message ?? error}`);
    process.exit(2);
  });
}
