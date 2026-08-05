/**
 * Third-party notice pipeline for vendored components.
 *
 * Vendored binaries (codegraph/openwiki/uv/browser-skill/skillspector/CRG/
 * serena/bento/tailwind) ship inside the installer via electron-builder's
 * extraResources. Many of their prebuilt release archives contain ONLY the
 * binary — no LICENSE/NOTICE file — so we cannot rely on extracting
 * attribution from each archive. Instead this script maintains a manifest of
 * every vendored component (source URL, SPDX license, version source) and:
 *
 *   1. Generates packages/desktop/vendor/ThirdPartyNotices.txt from the
 *      manifest, so the required attribution always ships with the app.
 *   2. In release mode (--check / CI_RELEASE=1) verifies the notice file is
 *      present and non-empty, failing the packaging build otherwise.
 *
 * Usage:
 *   node scripts/vendor-notice.js            # (re)generate ThirdPartyNotices.txt
 *   node scripts/vendor-notice.js --check    # verify present + non-empty (release gate)
 *
 * Keep the MANIFEST below in sync when adding/removing a vendored component
 * or bumping its pinned version.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const vendorDir = join(repoRoot, "packages", "desktop", "vendor");
const noticeFile = join(vendorDir, "ThirdPartyNotices.txt");

/** Manifest of vendored components shipped in the installer.
 *  license = SPDX identifier; source = canonical upstream URL. */
const MANIFEST = [
  {
    name: "CodeGraph",
    upstream: "https://github.com/colbymchenry/codegraph",
    license: "MIT",
    notes: "Prebuilt binary from GitHub Releases (and npm optionalDependency fallback).",
  },
  {
    name: "OpenWiki",
    upstream: "https://github.com/langchain-ai/openwiki",
    license: "MIT",
    notes: "Published npm package `openwiki`, installed with runtime dependencies.",
  },
  {
    name: "uv",
    upstream: "https://github.com/astral-sh/uv",
    license: "MIT OR Apache-2.0",
    notes: "Prebuilt standalone Rust binary from GitHub Releases.",
  },
  {
    name: "BrowserSkill (bsk)",
    upstream: "https://github.com/Tencent/BrowserSkill",
    license: "Apache-2.0",
    notes: "Prebuilt Rust binary from GitHub Releases.",
  },
  {
    name: "SkillSpector",
    upstream: "https://github.com/NVIDIA/SkillSpector",
    license: "Apache-2.0",
    notes: "Python wheel installed at runtime from GitHub Releases (NOT PyPI — the PyPI package is malware).",
  },
  {
    name: "Serena",
    upstream: "https://github.com/oraios/serena",
    license: "MIT",
    notes: "Python package run via uv at runtime; pinned version in scripts/vendor-serena.js.",
  },
  {
    name: "code-review-graph (CRG)",
    upstream: "https://github.com/colbymchenry/code-review-graph",
    license: "MIT",
    notes: "Python package run via uv at runtime; pinned version in scripts/vendor-crg.js.",
  },
  {
    name: "Bento Slides runtime",
    upstream: "https://bento.page",
    license: "See source — open source, embedded DEFLATE-compressed runtime",
    notes: "Embedded in bento template reference; not a separate binary.",
  },
  {
    name: "Tailwind CSS (JIT script)",
    upstream: "https://github.com/tailwindlabs/tailwindcss",
    license: "MIT",
    notes: "Standalone JIT script vendored for offline DeepDesign compilation.",
  },
];

function generate() {
  mkdirSync(vendorDir, { recursive: true });
  const lines = [];
  lines.push("DeepOrca — Third-Party Notices");
  lines.push("==============================");
  lines.push("");
  lines.push("DeepOrca is distributed under the MIT License. It ships the following");
  lines.push("third-party components, each under the license noted below. Source URLs");
  lines.push("are provided for each component.");
  lines.push("");
  for (const c of MANIFEST) {
    lines.push(`• ${c.name}`);
    lines.push(`    Source: ${c.upstream}`);
    lines.push(`    License: ${c.license}`);
    if (c.notes) lines.push(`    Notes: ${c.notes}`);
    lines.push("");
  }
  lines.push("The full license text for the DeepOrca project itself is in the LICENSE");
  lines.push("file at the repository root.");
  lines.push("");
  writeFileSync(noticeFile, lines.join("\n"), "utf8");
  console.log(`[vendor-notice] wrote ${noticeFile} (${MANIFEST.length} components)`);
}

function check() {
  if (!existsSync(noticeFile)) {
    console.error(`[vendor-notice] MISSING ${noticeFile} — run 'node scripts/vendor-notice.js' before packaging.`);
    process.exit(1);
  }
  const text = readFileSync(noticeFile, "utf8");
  if (!text.trim()) {
    console.error(`[vendor-notice] ${noticeFile} is empty — regeneration required before packaging.`);
    process.exit(1);
  }
  // Each manifest component must appear by name in the notice.
  const missing = MANIFEST.filter((c) => !text.includes(c.name)).map((c) => c.name);
  if (missing.length) {
    console.error(`[vendor-notice] ${noticeFile} is missing components: ${missing.join(", ")}`);
    process.exit(1);
  }
  console.log(`[vendor-notice] OK — ${noticeFile} covers all ${MANIFEST.length} components.`);
}

const checkMode = process.argv.includes("--check") || process.env.CI_RELEASE === "1";
if (checkMode && existsSync(noticeFile)) {
  // Release gate: verify the existing notice. (CI generates first, then checks.)
  check();
} else {
  generate();
  if (checkMode) check();
}
