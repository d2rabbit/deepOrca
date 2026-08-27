// Vendor Serena (https://github.com/oraios/serena) — version pin + wheel download.
//
// Downloads the .whl from PyPI at build time so the runtime can install offline
// via `uv tool run --from <local-wheel-path>`. Falls back to version-pin-only
// (runtime fetches from PyPI) if the download fails.
//
// Usage:
//   node scripts/vendor-serena.js            # check/update version + download wheel
//   node scripts/vendor-serena.js --force    # force rewrite + re-download
//
// Env overrides:
//   SERENA_VERSION  (default: latest from PyPI API)

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
const targetDir = join(repoRoot, "packages", "desktop", "vendor", "serena");
const versionFile = join(targetDir, ".vendored-serena-version");
const force = process.argv.includes("--force");

function log(message) {
  console.log(`[vendor-serena] ${message}`);
}

async function resolveLatestVersion() {
  if (process.env.SERENA_VERSION) {
    return process.env.SERENA_VERSION;
  }
  try {
    const resp = await fetch("https://pypi.org/pypi/serena-agent/json", {
      signal: AbortSignal.timeout(10000),
    });
    if (resp.ok) {
      const data = await resp.json();
      return data.info.version;
    }
  } catch {
    // Offline — use fallback.
  }
  log("could not resolve latest serena version from PyPI — using fallback 1.6.1");
  return "1.6.1";
}

/** Find and download the .whl for a pinned version from PyPI. */
async function downloadWheel(version) {
  try {
    const resp = await fetch(`https://pypi.org/pypi/serena-agent/${version}/json`, {
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
      // Still try to download wheel if missing.
      const wheelExists = existsSync(join(targetDir, `serena_agent-${version}-py3-none-any.whl`));
      if (!wheelExists) {
        await downloadWheel(version);
      }
      return;
    }
  }

  writeFileSync(versionFile, version);
  await downloadWheel(version);
  log(`done → ${versionFile} (serena-agent v${version})`);
}

try {
  await main();
} catch (error) {
  console.error(`[vendor-serena] failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
