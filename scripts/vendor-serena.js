// Vendor Serena (https://github.com/oraios/serena) version pin for the desktop app.
//
// Serena's GitHub Releases have no binary/wheel assets — only auto-generated source
// archives. Serena is installed at runtime via `uv tool run` from PyPI.
// This script writes a version marker so the runtime pins to a specific version
// instead of pulling latest. The actual install happens on first use via uv.
//
// Usage:
//   node scripts/vendor-serena.js            # check/update version pin
//   node scripts/vendor-serena.js --force    # force rewrite
//
// Env overrides:
//   SERENA_VERSION  (default: latest from PyPI API)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

async function main() {
  const version = await resolveLatestVersion();

  mkdirSync(targetDir, { recursive: true });

  if (existsSync(versionFile) && !force) {
    const existing = readFileSync(versionFile, "utf8").trim();
    if (existing === version) {
      log(`up-to-date (v${version}) — skipping.`);
      return;
    }
  }

  writeFileSync(versionFile, version);
  log(`done → ${versionFile} (serena-agent v${version})`);
  log(`runtime will pin: uv tool run --from serena-agent==${version}`);
}

try {
  await main();
} catch (error) {
  console.error(`[vendor-serena] failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
