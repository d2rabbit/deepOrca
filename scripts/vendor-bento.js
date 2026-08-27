// Vendor Bento Slides template (https://github.com/nyblnet/bento) into the desktop app.
//
// Bento publishes a single self-contained HTML file per release.
// This script downloads the latest Bento_Slides.bento.html into the
// bento-slides skill's references/ directory.
//
// Usage:
//   node scripts/vendor-bento.js            # download/refresh template
//   node scripts/vendor-bento.js --force    # force re-download
//
// Env overrides:
//   BENTO_VERSION  (default: latest from GitHub Releases API)

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { download as sharedDownload, GITHUB_PROXY } from "./vendor-download.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const targetPath = join(
  repoRoot,
  "packages",
  "core",
  "templates",
  "plugins",
  "work",
  "skills",
  "bento-slides",
  "references",
  "bento-template.bento.html"
);
const versionFile = join(dirname(targetPath), ".vendored-bento-version");
const force = process.argv.includes("--force");

function log(message) {
  console.log(`[vendor-bento] ${message}`);
}

/**
 * Fetch a release's metadata (direct, then githubdog proxy). Returns
 * { tag, digest } where digest is the Bento_Slides.bento.html asset's
 * sha256 ("sha256:<hex>") — GitHub computes asset digests at upload time, so
 * the download can be verified end-to-end even when the bytes came through
 * the proxy (M1 hardening 2026-08-27). Null digest = not verifiable this run.
 */
async function fetchReleaseInfo(apiUrl) {
  const tryUrls = [apiUrl, `${GITHUB_PROXY}${apiUrl}`];
  for (const u of tryUrls) {
    try {
      const resp = await fetch(u, {
        headers: { "User-Agent": "deeporca-vendor-bento" },
        signal: AbortSignal.timeout(10000),
      });
      if (!resp.ok) continue;
      const data = await resp.json();
      const tag = typeof data.tag_name === "string" ? data.tag_name : null;
      const digest = data.assets?.find((a) => a?.name === "Bento_Slides.bento.html")?.digest ?? null;
      if (tag) return { tag, digest };
    } catch {
      // try next source
    }
  }
  return null;
}

async function resolveRelease() {
  if (process.env.BENTO_VERSION) {
    // Pinned by env — look the tag up so we still get its asset digest.
    const info = await fetchReleaseInfo(
      `https://api.github.com/repos/nyblnet/bento/releases/tags/v${process.env.BENTO_VERSION}`
    );
    return {
      version: process.env.BENTO_VERSION,
      digest: info?.digest ?? null,
    };
  }
  const info = await fetchReleaseInfo("https://api.github.com/repos/nyblnet/bento/releases/latest");
  if (info) {
    return { version: info.tag.startsWith("v") ? info.tag.slice(1) : info.tag, digest: info.digest };
  }
  log("could not resolve latest bento version — using fallback 1.0.16");
  return { version: "1.0.16", digest: null };
}

async function download(url, dest, expectedSha256) {
  return sharedDownload(url, dest, log, expectedSha256);
}

async function main() {
  const { version, digest } = await resolveRelease();
  const previousVersion = existsSync(versionFile) ? readFileSync(versionFile, "utf8").trim() : null;

  if (version === previousVersion && existsSync(targetPath) && !force) {
    log(`up-to-date (v${version}) — skipping download.`);
    return;
  }

  log(`downloading Bento Slides v${version} (prev: ${previousVersion ?? "none"}) …`);

  const downloadUrl = `https://github.com/nyblnet/bento/releases/download/v${version}/Bento_Slides.bento.html`;

  try {
    await download(downloadUrl, targetPath, digest);
  } catch (error) {
    log(`download failed: ${error.message}`);
    if (existsSync(targetPath)) {
      log("keeping existing bento template");
      return;
    }
    throw error;
  }

  writeFileSync(versionFile, version);
  log(`done → ${targetPath} (bento v${version})`);
}

try {
  await main();
} catch (error) {
  console.error(`[vendor-bento] failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
