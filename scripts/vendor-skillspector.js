// Vendor SkillSpector (https://github.com/NVIDIA/SkillSpector) into the desktop app.
//
// SkillSpector is a Python package installed at runtime via `uv tool install`.
// This script writes the target version marker so the runtime knows which
// release wheel to install. No git clone needed — the runtime downloads the
// wheel directly from GitHub Releases.
//
// Why not PyPI: the `skillspector` package on PyPI is MALWARE
// (advisory MAL-2026-6561, CVSS 10.0). We install ONLY from GitHub Releases.
//
// Usage:
//   node scripts/vendor-skillspector.js            # write version marker
//   node scripts/vendor-skillspector.js --force    # force rewrite
//
// Env overrides:
//   SKILLSPECTOR_VERSION  (default: 2.5.1)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const targetDir = join(repoRoot, "packages", "desktop", "vendor", "skillspector");
const versionFile = join(targetDir, ".vendored-skillspector-version");
const force = process.argv.includes("--force");

function log(message) {
  console.log(`[vendor-skillspector] ${message}`);
}

const version = process.env.SKILLSPECTOR_VERSION || "2.5.1";

// Ensure the vendor directory exists and write the version marker.
mkdirSync(targetDir, { recursive: true });

if (existsSync(versionFile) && !force) {
  const existing = readFileSync(versionFile, "utf8").trim();
  if (existing === version) {
    log(`up-to-date (v${version}) — skipping.`);
    process.exit(0);
  }
}

writeFileSync(versionFile, version);
log(`done → ${versionFile} (SkillSpector v${version})`);
log(
  `runtime will install from: https://github.com/NVIDIA/SkillSpector/releases/download/v${version}/skillspector-${version}-py3-none-any.whl`
);
