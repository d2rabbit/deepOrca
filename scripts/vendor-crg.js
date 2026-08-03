// Vendor Code-Review-Graph (https://github.com/tirth8205/code-review-graph) version pin.
//
// CRG's GitHub Releases have no binary/wheel assets — only source archives.
// CRG is installed at runtime via `uv tool run` from PyPI.
// This script writes a version marker so the runtime pins to a specific version.
//
// CRG rendering options (from README):
//   - Interactive: D3.js force-directed graph (default)
//   - Static export: GraphML (Gephi/yEd), Neo4j Cypher, SVG
//   - Documentation: Markdown wiki from community structure, Obsidian vault
//   - Data: JSON export
//
// Usage:
//   node scripts/vendor-crg.js            # check/update version pin
//   node scripts/vendor-crg.js --force    # force rewrite
//
// Env overrides:
//   CRG_VERSION  (default: latest from PyPI API)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
  log(`done → ${versionFile} (code-review-graph v${version})`);
  log(`runtime will pin: uv tool run --from code-review-graph==${version}`);
}

try {
  await main();
} catch (error) {
  console.error(`[vendor-crg] failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
