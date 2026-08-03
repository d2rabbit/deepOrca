// Vendor the Tailwind CSS standalone JIT script for local/offline use.
//
// DeepDesign compiles .dd files into self-contained HTML with this script
// inlined, so designs work offline without depending on an external CDN.
//
// IMPORTANT: pin to a single Tailwind major version. Mixing the v3 Play CDN
// (cdn.tailwindcss.com) with v4 (@tailwindcss/browser@4) yields incompatible
// runtimes — which one you get depended on network reachability. Both sources
// below serve the SAME v4 package (@tailwindcss/browser@4) from different hosts,
// so the generated classes are deterministic regardless of which host answers.
//
// Usage:
//   node scripts/vendor-tailwind.js          # download/refresh
//   node scripts/vendor-tailwind.js --force  # force re-download

import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const targetDir = join(repoRoot, "packages", "desktop", "vendor", "tailwind");
const targetFile = join(targetDir, "tailwind.js");
const versionFile = join(targetDir, ".vendored-version");

const force = process.argv.includes("--force");

// Pinned to Tailwind v4 (@tailwindcss/browser). Two hosts, same package+version
// — used as primary/fallback for reachability, NOT as version alternatives.
// jsDelivr mirrors npm 1:1 and serves a integrity-stable tarball; unpkg is the
// canonical npm CDN. When upgrading, bump the @4 suffix in BOTH entries.
const TAILWIND_VERSION = "4";
const SOURCES = [
  `https://unpkg.com/@tailwindcss/browser@${TAILWIND_VERSION}`,
  `https://cdn.jsdelivr.net/npm/@tailwindcss/browser@${TAILWIND_VERSION}`,
];

function log(msg) {
  console.log(`[vendor-tailwind] ${msg}`);
}

async function download(url, dest) {
  const resp = await fetch(url, { redirect: "follow" });
  if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status} from ${url}`);
  const ws = createWriteStream(dest);
  await Readable.fromWeb(resp.body).pipe(ws);
  return true;
}

async function main() {
  log("Downloading Tailwind CSS JIT script...");

  // If already vendored and not forced, check if refresh is needed.
  if (!force && existsSync(targetFile) && existsSync(versionFile)) {
    const version = readFileSync(versionFile, "utf8").trim();
    const age = Date.now() - parseInt(version, 10);
    // Refresh every 30 days.
    if (age < 30 * 24 * 60 * 60 * 1000) {
      log(`Already vendored (age: ${Math.round(age / 86400000)}d). Use --force to refresh.`);
      return;
    }
  }

  mkdirSync(targetDir, { recursive: true });

  let success = false;
  for (const url of SOURCES) {
    try {
      log(`  Trying ${url}...`);
      await download(url, targetFile);
      success = true;
      log(`  ✓ Downloaded from ${url}`);
      break;
    } catch (err) {
      log(`  ✗ Failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  if (!success) {
    if (existsSync(targetFile)) {
      log("⚠ All sources failed — keeping existing vendored copy.");
      return;
    }
    log("⚠ All sources failed and no existing copy. DeepDesign will fall back to CDN.");
    return;
  }

  // Record the download timestamp as the "version".
  writeFileSync(versionFile, String(Date.now()));
  log("✓ Tailwind CSS vendored successfully.");
}

main().catch((err) => {
  log(`⚠ Unexpected error: ${err}`);
  if (existsSync(targetFile)) {
    log("  Keeping existing vendored copy.");
  }
});
