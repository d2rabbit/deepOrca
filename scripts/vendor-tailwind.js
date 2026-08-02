// Vendor the Tailwind CSS standalone JIT script for local/offline use.
//
// The Tailwind Play CDN (cdn.tailwindcss.com) is a ~400KB JIT compiler that
// generates utility classes at runtime in the browser. DeepDesign compiles
// .dd files into self-contained HTML with this script inlined, so designs
// work offline without depending on an external CDN.
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

// Tailwind Play CDN URLs — the script is versionless but we track the download
// date so we can refresh periodically. Primary: cdn.tailwindcss.com.
// Fallback: unpkg.com/@tailwindcss/browser (same script, different host).
const SOURCES = ["https://cdn.tailwindcss.com", "https://unpkg.com/@tailwindcss/browser@4"];

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
