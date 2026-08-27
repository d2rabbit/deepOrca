// Vendor Code-Review-Graph (https://github.com/tirth8205/code-review-graph) — version pin + wheel download.
//
// Downloads the .whl from PyPI at build time for offline `uv tool run --from <local-wheel>`.
// Falls back to version-pin-only if the download fails.
//
// Usage:
//   node scripts/vendor-crg.js            # check/update version + download wheel
//   node scripts/vendor-crg.js --force    # force rewrite + re-download
//
// Env overrides:
//   CRG_VERSION  (default: latest from PyPI API)

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  createWriteStream,
  createReadStream,
  rmSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const targetDir = join(repoRoot, "packages", "desktop", "vendor", "crg");
const versionFile = join(targetDir, ".vendored-crg-version");
const force = process.argv.includes("--force");

function log(message) {
  console.log(`[vendor-crg] ${message}`);
}

async function resolveLatestVersion() {
  if (process.env.CRG_VERSION) {
    return process.env.CRG_VERSION;
  }
  try {
    const resp = await fetch("https://pypi.org/pypi/code-review-graph/json", {
      signal: AbortSignal.timeout(10000),
    });
    if (resp.ok) {
      const data = await resp.json();
      return data.info.version;
    }
  } catch {
    // Offline — use fallback.
  }
  log("could not resolve latest CRG version from PyPI — using fallback 2.3.7");
  return "2.3.7";
}

/** Find and download the .whl for a pinned version from PyPI. */
async function downloadWheel(version) {
  try {
    const resp = await fetch(`https://pypi.org/pypi/code-review-graph/${version}/json`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const whl = data.urls?.find((u) => u.filename?.endsWith(".whl") && u.filename?.includes("py3-none-any"));
    if (!whl?.url) return null;

    const wheelFile = join(targetDir, whl.filename);
    log(`downloading wheel: ${whl.filename} (${(whl.size / 1024 / 1024).toFixed(1)} MB)`);
    const whlResp = await fetch(whl.url, { signal: AbortSignal.timeout(120000) });
    if (!whlResp.ok) return null;
    await pipeline(whlResp.body, createWriteStream(wheelFile));
    // M1 hardening (2026-08-27): the SAME PyPI response carries the wheel's
    // sha256 — verify the streamed bytes against it; a tampered/CDN-corrupted
    // wheel is deleted, never installed. Missing digest = unverified (logged).
    const expected = whl.digests?.sha256;
    if (expected) {
      const hash = createHash("sha256");
      await pipeline(createReadStream(wheelFile), hash);
      const actual = hash.digest("hex");
      if (actual !== expected.toLowerCase()) {
        rmSync(wheelFile, { force: true });
        throw new Error(`sha256 mismatch for ${whl.filename}: expected ${expected}, got ${actual}`);
      }
      log(`sha256 verified: ${whl.filename}`);
    } else {
      log(`no sha256 digest in PyPI metadata — wheel left unverified`);
    }
    log(`wheel saved → ${wheelFile}`);
    return whl.filename;
  } catch (error) {
    log(
      `wheel download failed (will use online fallback at runtime): ${error instanceof Error ? error.message : String(error)}`
    );
    return null;
  }
}

async function main() {
  const version = await resolveLatestVersion();

  mkdirSync(targetDir, { recursive: true });

  if (existsSync(versionFile) && !force) {
    const existing = readFileSync(versionFile, "utf8").trim();
    if (existing === version) {
      log(`up-to-date (v${version}) — checking wheel.`);
      const wheelExists = existsSync(join(targetDir, `code_review_graph-${version}-py3-none-any.whl`));
      if (!wheelExists) {
        await downloadWheel(version);
      }
      return;
    }
  }

  writeFileSync(versionFile, version);
  await downloadWheel(version);
  log(`done → ${versionFile} (code-review-graph v${version})`);
}

try {
  await main();
} catch (error) {
  console.error(`[vendor-crg] failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
