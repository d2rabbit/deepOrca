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

async function resolveLatestVersion() {
  if (process.env.BENTO_VERSION) {
    return process.env.BENTO_VERSION;
  }
  try {
    const apiUrl = "https://api.github.com/repos/nyblnet/bento/releases/latest";
    let resp = await fetch(apiUrl, {
      headers: { "User-Agent": "deeporca-vendor-bento" },
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) {
      resp = await fetch(`${GITHUB_PROXY}${apiUrl}`, {
        headers: { "User-Agent": "deeporca-vendor-bento" },
        signal: AbortSignal.timeout(10000),
      });
    }
    if (resp.ok) {
      const data = await resp.json();
      const tag = data.tag_name; // e.g. "v1.0.15"
      return tag.startsWith("v") ? tag.slice(1) : tag;
    }
  } catch {
    // Offline — use fallback.
  }
  log("could not resolve latest bento version — using fallback 1.0.15");
  return "1.0.15";
}

async function download(url, dest) {
  return sharedDownload(url, dest, log);
}

async function main() {
  const version = await resolveLatestVersion();
  const previousVersion = existsSync(versionFile) ? readFileSync(versionFile, "utf8").trim() : null;

  if (version === previousVersion && existsSync(targetPath) && !force) {
    log(`up-to-date (v${version}) — skipping download.`);
    return;
  }

  log(`downloading Bento Slides v${version} (prev: ${previousVersion ?? "none"}) …`);

  const downloadUrl = `https://github.com/nyblnet/bento/releases/download/v${version}/Bento_Slides.bento.html`;

  try {
    await download(downloadUrl, targetPath);
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
