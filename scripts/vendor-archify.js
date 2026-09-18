// Vendor Archify (https://github.com/tt-a1i/archify) into the desktop app.
//
// Archify is an Agent Skill + zero-runtime-dependency Node CLI (plain .mjs)
// that turns a typed JSON IR into validated, self-contained interactive HTML
// diagrams (architecture / workflow / sequence / dataflow / lifecycle). We
// vendor the repo's `archify/` skill subdirectory only — it carries the bin,
// schemas, renderers, examples and SKILL.md contract. Git-based pin (same
// discipline as the other vendors): a moving "latest" already broke openwiki
// once, so the ref is pinned and bumped via PR.
//
// Usage:
//   node scripts/vendor-archify.js            # install/refresh
//   node scripts/vendor-archify.js --force    # force re-clone + copy
//
// Env overrides:
//   ARCHIFY_REF  (default: v2.15.0)

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { withAtomicSwap } from "./vendor-fs.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const targetDir = join(repoRoot, "packages", "desktop", "vendor", "archify");
const refFile = join(targetDir, ".vendored-archify-ref");
const force = process.argv.includes("--force");

/** Pinned upstream ref (tag). ARCHIFY_REF overrides for one-off testing. */
function resolvePinnedRef() {
  const raw = process.env.ARCHIFY_REF ?? "v2.15.0";
  if (!/^v?\d+\.\d+\.\d+$/.test(raw)) {
    throw new Error(`unsafe ARCHIFY_REF: ${JSON.stringify(raw)} (expected a vX.Y.Z tag)`);
  }
  return raw.startsWith("v") ? raw : `v${raw}`;
}

function log(message) {
  console.log(`[vendor-archify] ${message}`);
}

/**
 * deeporca carry-patches, re-applied on every install/refresh (upstream is
 * github.com/tt-a1i/archify; we fix here instead of waiting for a release).
 *
 * macOS pipe diagnostics truncation (real-machine 2026-09-18): libuv wraps
 * stdio pipes non-blocking, so `fs.writeSync` can PARTIALLY write or throw
 * EAGAIN once the pipe fills, and a trailing `process.exit()` drops the rest —
 * an 18KB renderer diagnostic arrived as 8KB of unparseable JSON, which the
 * CLI's fail-closed wrapper then reported as `internal/unclassified`. The
 * patches drain buffers fully (EAGAIN retry loop) before every exit that
 * follows a stream write on the machine paths (renderer diagnostics boundary,
 * `--layout-json` stdout report, CLI `fail()`).
 *
 * Anchors must match EXACTLY: when a ref bump changes the surrounding code,
 * failing loudly here is correct — either upstream fixed it (drop the patch)
 * or moved it (re-anchor), never silently ship the bug again.
 */
function applyDeeporcaPatches(staging) {
  const patchFile = (relativePath, replacements) => {
    const file = join(staging, relativePath);
    let source = readFileSync(file, "utf-8");
    for (const [anchor, replacement] of replacements) {
      if (!source.includes(anchor)) {
        throw new Error(
          `carry-patch anchor not found in ${relativePath} — upstream changed; re-anchor or drop the patch in scripts/vendor-archify.js:\n  ${anchor.slice(0, 120)}…`
        );
      }
      source = source.replace(anchor, replacement);
    }
    writeFileSync(file, source);
    log(`carry-patched ${relativePath}`);
  };

  patchFile("renderers/shared/diagnostics.mjs", [
    [
      `    try {
      fs.writeSync(process.stderr.fd, payload);
    } catch {`,
      `    try {
      writeAllSync(process.stderr.fd, Buffer.from(payload, 'utf8'));
    } catch {`,
    ],
    [
      `export function installRendererDiagnosticBoundary() {`,
      `// deeporca carry-patch (scripts/vendor-archify.js): libuv wraps stdio pipes
// non-blocking, so a single fs.writeSync can partially write — or throw EAGAIN
// once the pipe fills — and the remainder is lost forever when process.exit()
// follows (an 18KB diagnostic arrived as 8KB of unparseable JSON on macOS).
// Drain the whole buffer synchronously, retrying EAGAIN after ~1ms while the
// parent reader drains the other end of the pipe.
export function writeAllSync(fd, buffer) {
  let written = 0;
  while (written < buffer.length) {
    try {
      written += fs.writeSync(fd, buffer, written, buffer.length - written);
    } catch (error) {
      if (error && (error.code === 'EAGAIN' || error.code === 'EWOULDBLOCK')) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1);
        continue;
      }
      throw error;
    }
  }
  return written;
}

export function installRendererDiagnosticBoundary() {`,
    ],
  ]);

  patchFile("renderers/architecture/render-architecture.mjs", [
    [
      `import { throwDiagnosticProblems } from '../shared/diagnostics.mjs';`,
      `import { throwDiagnosticProblems, writeAllSync } from '../shared/diagnostics.mjs';`,
    ],
    [
      `  console.log(JSON.stringify(buildLayoutReport(), null, 2));
  process.exit(0);`,
      `  // deeporca carry-patch: console.log is async on macOS pipes; exit(0) right
  // after could truncate the layout report. Write it synchronously instead.
  writeAllSync(process.stdout.fd, Buffer.from(\`\${JSON.stringify(buildLayoutReport(), null, 2)}\\n\`, 'utf8'));
  process.exit(0);`,
    ],
  ]);

  patchFile("bin/archify.mjs", [
    [
      `import { fileURLToPath, pathToFileURL } from 'node:url';`,
      `import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeAllSync } from '../renderers/shared/diagnostics.mjs';`,
    ],
    [
      `function fail(message, code = 2) {
  console.error(message);
  process.exit(code);
}`,
      `function fail(message, code = 2) {
  // deeporca carry-patch: console.error is async on macOS pipes and
  // process.exit() can cut it off — write the message synchronously first.
  try {
    writeAllSync(process.stderr.fd, Buffer.from(\`\${message}\\n\`, 'utf8'));
  } catch {
    // best-effort: the exit status still communicates the failure
  }
  process.exit(code);
}`,
    ],
  ]);
}

/** Shallow clone the pinned tag into a temp dir; returns the clone path. */
function clonePinned(staging, ref) {
  const cloneDir = join(staging, "_clone");
  mkdirSync(cloneDir, { recursive: true });
  // argv-form git (no shell string); --depth keeps the clone small; the tag
  // comes from the validated pin above.
  execFileSync("git", ["clone", "--depth", "1", "--branch", ref, "https://github.com/tt-a1i/archify.git", cloneDir], {
    cwd: staging,
    stdio: "pipe",
  });
  return cloneDir;
}

async function main() {
  const ref = resolvePinnedRef();
  const previousRef = existsSync(refFile) ? readFileSync(refFile, "utf-8").trim() : null;

  // Tree-completeness guard (same lesson as vendor-openwiki): "marker present"
  // must also mean "tree intact" — the bin entry, SKILL contract, schemas and
  // examples are all load-bearing for the arch pipeline.
  const requiredPaths = ["bin/archify.mjs", "SKILL.md", "schemas", "renderers", "scripts/check-render-output.mjs"];
  const treeComplete = requiredPaths.every((item) => existsSync(join(targetDir, item)));

  if (ref === previousRef && treeComplete && !force) {
    log(`up-to-date (${ref}) — skipping clone.`);
    return;
  }
  if (ref === previousRef && !treeComplete) {
    log(`${ref} marker present but vendored tree incomplete — re-vendoring …`);
  }

  log(`installing archify ${ref} (prev: ${previousRef ?? "none"}) …`);

  await withAtomicSwap(targetDir, {
    log,
    tag: "archify",
    build: async (staging) => {
      const cloneDir = clonePinned(staging, ref);
      const skillDir = join(cloneDir, "archify");
      if (!existsSync(join(skillDir, "bin", "archify.mjs"))) {
        throw new Error(`clone has no archify/bin/archify.mjs — upstream layout changed?`);
      }
      // Copy the skill package's payload only (bin/schemas/renderers/examples/
      // references/SKILL.md/LICENSE); skip its dev-only package-lock noise.
      for (const item of [
        "bin",
        "schemas",
        "renderers",
        "examples",
        "references",
        "assets",
        "scripts",
        "SKILL.md",
        "package.json",
        "LICENSE",
      ]) {
        const src = join(skillDir, item);
        if (existsSync(src)) {
          const dest = join(staging, item);
          if (item.endsWith(".md") || item.endsWith(".json") || item === "LICENSE") {
            writeFileSync(dest, readFileSync(src));
          } else {
            const { cpSync } = await import("node:fs");
            cpSync(src, dest, { recursive: true });
          }
        }
      }
      rmSync(cloneDir, { recursive: true, force: true });
      applyDeeporcaPatches(staging);
      writeFileSync(join(staging, ".vendored-archify-ref"), ref);
    },
    verify: (staging) =>
      existsSync(join(staging, "bin", "archify.mjs")) &&
      existsSync(join(staging, "SKILL.md")) &&
      existsSync(join(staging, "schemas", "architecture.schema.json")),
  });

  log(`done → ${targetDir} (archify ${ref})`);
}

try {
  await main();
} catch (error) {
  console.error(`[vendor-archify] failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
