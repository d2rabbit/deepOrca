/**
 * License compliance gate for the full dependency tree.
 *
 * Scans every installed package (all workspaces, dev included — dev tools can
 * still end up in CI artifacts) and fails on any license outside the allow
 * list, so copyleft or commercially restrictive licenses (GPL/AGPL/SSPL/
 * Commons Clause/BUSL/CC-BY-NC/…) can never slip in via a dependency bump.
 *
 * Two mechanisms, deliberately separate:
 *   1. ALLOWED — SPDX ids accepted tree-wide (permissive licenses).
 *   2. EXCEPTIONS — individual (package, license) pairs accepted with a
 *      written justification. Every entry must say WHY it is safe; keep it
 *      current or the gate loses its meaning.
 *
 * Wired into `npm run check` (see package.json). Run directly:
 *   node scripts/check-licenses.js
 */

import { init } from "license-checker-rseidelsohn";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

/** SPDX ids accepted anywhere in the tree. */
const ALLOWED = new Set([
  "MIT",
  "MIT-0",
  "ISC",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "Apache-2.0",
  "BlueOak-1.0.0",
  "CC0-1.0",
  "0BSD",
  "Unlicense",
  "WTFPL",
  "Zlib",
  "Python-2.0",
  "CC-BY-4.0", // data-only packages (e.g. caniuse-lite), used at build time, not shipped
  "Public Domain",
]);

/**
 * (package-name pattern, license) pairs accepted with justification.
 * Pattern matches the package name (everything before the trailing @version).
 */
const EXCEPTIONS = [
  {
    match: (name) =>
      name === "deeporca" ||
      name === "@deeporca/core" ||
      name === "@deeporca/desktop" ||
      name === "@deeporca/memory" ||
      name === "@deeporca/embedding",
    license: "MPL-2.0",
    why: "Our own workspace packages (this monorepo), relicensed MIT → MPL-2.0. Not third-party code; the tree-wide MPL ban for external deps stays in force.",
  },
  {
    match: (name) => name.startsWith("@img/sharp-libvips"),
    license: "LGPL-3.0-or-later",
    why: "Prebuilt libvips dynamically loaded by sharp — unmodified and replaceable, so no copyleft on DeepOrca. LGPL obligations (notice + full texts + source pointer) are shipped in packages/desktop/vendor/ThirdPartyNotices.txt via scripts/vendor-notice.js.",
  },
  {
    match: (name) => name.startsWith("@img/sharp-win32"),
    license: "Apache-2.0 AND LGPL-3.0-or-later",
    why: "Windows sharp binary statically bundles the SAME prebuilt libvips that mac/linux split into @img/sharp-libvips-* packages (win32 ships it inside one package, hence the conjunction license). Same terms as the libvips entry: unmodified and replaceable, no copyleft on DeepOrca; LGPL obligations discharged via packages/desktop/vendor/ThirdPartyNotices.txt.",
  },
  {
    match: (name) => name === "spdx-exceptions",
    license: "CC-BY-3.0",
    why: "Data-only package (SPDX exception list) pulled in by the license-checker dev tool. Build-time only, never shipped in the product; attribution satisfied by this notice.",
  },
  {
    match: (name) => name === "spdx-ranges",
    license: "MIT AND CC-BY-3.0",
    why: "Code MIT + SPDX range data CC-BY-3.0, pulled in by the license-checker dev tool. Build-time only, never shipped; attribution satisfied by this notice.",
  },
];

/** Split an SPDX expression on OR and accept if ANY side is allowed
 *  (dual-licensed packages let the recipient choose). Parentheses and the
 *  trailing "*" license-checker adds for inferred licenses are normalized. */
function isAllowedExpression(raw) {
  const normalized = String(raw).replace(/[()]/g, "").replace(/\*$/, "").trim();
  return normalized.split(/\s+OR\s+/i).some((part) => ALLOWED.has(part.trim()));
}

function findException(name, license) {
  const normalized = String(license).replace(/[()]/g, "").replace(/\*$/, "").trim();
  return EXCEPTIONS.find((e) => e.match(name) && e.license === normalized);
}

const packages = await new Promise((resolvePromise, reject) => {
  init({ start: repoRoot, excludePrivatePackages: true }, (error, data) => {
    if (error) reject(error);
    else resolvePromise(data);
  });
});

const violations = [];
const exceptionHits = [];
let total = 0;

for (const [id, info] of Object.entries(packages)) {
  total += 1;
  const license = info.licenses ?? "UNKNOWN";
  const name = id.replace(/@[^@]*$/, "");
  if (isAllowedExpression(license)) continue;
  const exception = findException(name, license);
  if (exception) {
    exceptionHits.push(`${id} — ${license}\n    ↳ ${exception.why}`);
    continue;
  }
  violations.push(`${id} — ${license}`);
}

console.log(`[license-check] scanned ${total} packages`);
if (exceptionHits.length > 0) {
  console.log(`[license-check] ${exceptionHits.length} accepted exception(s):`);
  for (const hit of exceptionHits) console.log(`  ${hit}`);
}

if (violations.length > 0) {
  console.error(`\n[license-check] FAIL — ${violations.length} package(s) outside the allow list:`);
  for (const v of violations) console.error(`  ${v}`);
  console.error(
    "\nResolve by removing/replacing the dependency, or add a justified entry to EXCEPTIONS in scripts/check-licenses.js after a license review."
  );
  process.exit(1);
}

console.log("[license-check] OK — no copyleft or commercially restrictive licenses found.");
