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
