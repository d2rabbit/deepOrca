// Vendor CodeGraph (https://github.com/colbymchenry/codegraph) into the desktop app.
//
// Maintains a persistent source clone in `vendor-src/codegraph` and compiles it
// into `packages/desktop/vendor/codegraph` on every build. Before compiling, the
// script fetches the remote and rebuilds if there are new commits — ensuring the
// vendored binary always tracks upstream without manual intervention.
//
// CodeGraph requires Node 22.5+ at runtime (node:sqlite). The compiled output is
// a plain JS entry (`dist/bin/codegraph.js`) that the desktop client runs through
// a system Node 22+ binary (see packages/core/src/common/codegraph.ts).
//
// Usage:
//   node scripts/vendor-codegraph.js            # clone/update + compile
//   node scripts/vendor-codegraph.js --force    # force full rebuild
//
// Env overrides:
//   CODEGRAPH_REPO  (default https://github.com/colbymchenry/codegraph.git)
//   CODEGRAPH_REF   (default main)

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const sourceDir = join(repoRoot, "vendor-src", "codegraph");
const targetDir = join(repoRoot, "packages", "desktop", "vendor", "codegraph");
const entryFile = join(targetDir, "dist", "bin", "codegraph.js");
const headFile = join(targetDir, ".vendored-head");

const REPO = process.env.CODEGRAPH_REPO || "https://github.com/colbymchenry/codegraph.git";
const REF = process.env.CODEGRAPH_REF || "main";
const force = process.argv.includes("--force");
const isWindows = process.platform === "win32";

function log(message) {
  console.log(`[vendor-codegraph] ${message}`);
}

function run(command, args, cwd) {
  const needsShell = isWindows && command === "npm";
  return execFileSync(command, args, { cwd, stdio: "pipe", shell: needsShell, encoding: "utf8" });
}

function getHead(dir) {
  try {
    return run("git", ["rev-parse", "HEAD"], dir).trim();
  } catch {
    return null;
  }
}

function main() {
  // ── Step 1: Ensure persistent source clone exists ──
  if (!existsSync(join(sourceDir, ".git"))) {
    log(`cloning ${REPO} @ ${REF} → vendor-src/codegraph …`);
    mkdirSync(dirname(sourceDir), { recursive: true });
    try {
      run("git", ["clone", "--branch", REF, REPO, sourceDir]);
    } catch (error) {
      // Offline / blocked network: keep any existing vendored build working.
      if (existsSync(entryFile)) {
        log("clone failed (offline?) — keeping the existing vendored build.");
        return;
      }
      throw error;
    }
  } else {
    // Fetch latest from remote.
    log("fetching upstream updates …");
    try {
      run("git", ["fetch", "origin", REF], sourceDir);
    } catch {
      log("fetch failed (offline?) — using local source.");
    }
  }

  // Reset to latest remote HEAD.
  try {
    run("git", ["reset", "--hard", `origin/${REF}`], sourceDir);
  } catch {
    // If origin/REF doesn't exist (detached), stay on current.
  }

  const currentHead = getHead(sourceDir);
  const previousHead = existsSync(headFile) ? readFileSync(headFile, "utf8").trim() : null;

  if (currentHead === previousHead && existsSync(entryFile) && !force) {
    log(`up-to-date (${currentHead?.slice(0, 8)}) — skipping build.`);
    return;
  }

  log(`building ${currentHead?.slice(0, 8)} (prev: ${previousHead?.slice(0, 8) ?? "none"}) …`);

  // ── Step 2: Install + compile in source dir ──
  log("installing dependencies …");
  run("npm", ["install", "--no-audit", "--no-fund"], sourceDir);

  log("compiling (npm run build) …");
  run("npm", ["run", "build"], sourceDir);

  // ── Step 3: Copy runtime artifacts to vendor dir ──
  log(`copying runtime → ${targetDir}`);
  rmSync(targetDir, { recursive: true, force: true });
  mkdirSync(targetDir, { recursive: true });
  for (const name of ["dist", "scripts", "package.json", "package-lock.json"]) {
    const src = join(sourceDir, name);
    if (existsSync(src)) {
      cpSync(src, join(targetDir, name), { recursive: true });
    }
  }

  log("installing production dependencies …");
  run("npm", ["install", "--omit=dev", "--no-audit", "--no-fund", "--ignore-scripts"], targetDir);

  // Record the compiled HEAD so next build can skip if unchanged.
  writeFileSync(headFile, currentHead ?? "unknown");
  log(`done → ${entryFile} @ ${currentHead?.slice(0, 8)}`);
}

try {
  main();
} catch (error) {
  console.error(`[vendor-codegraph] failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
