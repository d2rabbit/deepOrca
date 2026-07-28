// Vendor OpenWiki (https://github.com/langchain-ai/openwiki) into the desktop app.
//
// Maintains a persistent source clone in `vendor-src/openwiki` and compiles it
// into `packages/desktop/vendor/openwiki` on every build. Before compiling, the
// script fetches the remote and rebuilds if there are new commits — ensuring the
// vendored binary always tracks upstream without manual intervention.
//
// OpenWiki is a Node/TypeScript CLI (Ink-based TUI). The compiled output is a
// plain JS entry (`dist/cli.js` — the package's `bin` target) that the desktop
// client runs through a system Node binary as a built-in command — no external
// install required.
//
// Usage:
//   node scripts/vendor-openwiki.js            # clone/update + compile
//   node scripts/vendor-openwiki.js --force    # force full rebuild
//
// Env overrides:
//   OPENWIKI_REPO  (default https://github.com/langchain-ai/openwiki.git)
//   OPENWIKI_REF   (default main)
// Mirror repos are tried automatically whenever the primary GitHub clone or
// fetch fails, so builds keep working when github.com is unreachable.

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const sourceDir = join(repoRoot, "vendor-src", "openwiki");
const targetDir = join(repoRoot, "packages", "desktop", "vendor", "openwiki");
const entryFile = join(targetDir, "dist", "cli.js");
const headFile = join(targetDir, ".vendored-head");

// Primary GitHub source first; gitcode mirror backs it up when GitHub is blocked.
const REPOS = [
  process.env.OPENWIKI_REPO || "https://github.com/langchain-ai/openwiki.git",
  "https://gitcode.com/gh_mirrors/op/openwiki.git",
];
const REF = process.env.OPENWIKI_REF || "main";
const force = process.argv.includes("--force");
const isWindows = process.platform === "win32";

function log(message) {
  console.log(`[vendor-openwiki] ${message}`);
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

function cloneWithFallback(branch, dest) {
  let lastError = null;
  for (const repo of REPOS) {
    log(`cloning ${repo} @ ${branch} …`);
    try {
      run("git", ["clone", "--branch", branch, repo, dest]);
      return repo;
    } catch (error) {
      lastError = error;
      log(`clone from ${repo} failed — trying next mirror …`);
    }
  }
  throw lastError ?? new Error("all mirrors failed to clone");
}

function fetchWithFallback(dir, branch) {
  // Try each repo as a git remote so a blocked primary can fall back to a mirror.
  for (const repo of REPOS) {
    const remoteName = repo === REPOS[0] ? "origin" : "backup";
    try {
      run("git", ["remote", "set-url", remoteName, repo], dir);
    } catch {
      run("git", ["remote", "add", remoteName, repo], dir);
    }
    log(`fetching ${repo} …`);
    try {
      run("git", ["fetch", remoteName, branch], dir);
      return remoteName;
    } catch {
      log(`fetch from ${repo} failed — trying next mirror …`);
    }
  }
  return null;
}

function main() {
  // ── Step 1: Ensure persistent source clone exists ──
  if (!existsSync(join(sourceDir, ".git"))) {
    log(`cloning → vendor-src/openwiki @ ${REF}`);
    mkdirSync(dirname(sourceDir), { recursive: true });
    try {
      cloneWithFallback(REF, sourceDir);
    } catch (error) {
      // Offline / blocked network: keep any existing vendored build working.
      if (existsSync(entryFile)) {
        log("clone failed on all mirrors (offline?) — keeping the existing vendored build.");
        return;
      }
      throw error;
    }
  } else {
    log("fetching upstream updates …");
    const remote = fetchWithFallback(sourceDir, REF);
    if (!remote) {
      log("fetch failed on all mirrors (offline?) — using local source.");
    }
  }

  // Reset to the latest fetched HEAD from whichever remote succeeded (origin preferred).
  const fetchedRemote = (() => {
    try {
      run("git", ["rev-parse", "--verify", `origin/${REF}`], sourceDir);
      return "origin";
    } catch {
      try {
        run("git", ["rev-parse", "--verify", `backup/${REF}`], sourceDir);
        return "backup";
      } catch {
        return null;
      }
    }
  })();
  if (fetchedRemote) {
    try {
      run("git", ["reset", "--hard", `${fetchedRemote}/${REF}`], sourceDir);
    } catch {
      // If the ref is missing (detached), stay on current.
    }
  }

  const currentHead = getHead(sourceDir);
  const previousHead = existsSync(headFile) ? readFileSync(headFile, "utf8").trim() : null;

  if (currentHead === previousHead && existsSync(entryFile) && !force) {
    log(`up-to-date (${currentHead?.slice(0, 8)}) — skipping build.`);
    return;
  }

  log(`building ${currentHead?.slice(0, 8)} (prev: ${previousHead?.slice(0, 8) ?? "none"}) …`);

  // ── Step 2: Install + compile in source dir ──
  // --legacy-peer-deps: upstream currently ships conflicting peer ranges
  // (deepagents wants langsmith ^0.7 while the root pins ^0.8) — same as
  // installing the published package with npm <7 semantics.
  log("installing dependencies …");
  run("npm", ["install", "--no-audit", "--no-fund", "--legacy-peer-deps"], sourceDir);

  log("compiling (npm run build) …");
  run("npm", ["run", "build"], sourceDir);

  // ── Step 3: Copy runtime artifacts to vendor dir ──
  log(`copying runtime → ${targetDir}`);
  rmSync(targetDir, { recursive: true, force: true });
  mkdirSync(targetDir, { recursive: true });
  for (const name of ["dist", "package.json", "package-lock.json"]) {
    const src = join(sourceDir, name);
    if (existsSync(src)) {
      cpSync(src, join(targetDir, name), { recursive: true });
    }
  }

  log("installing production dependencies …");
  run("npm", ["install", "--omit=dev", "--no-audit", "--no-fund", "--ignore-scripts", "--legacy-peer-deps"], targetDir);

  // Record the compiled HEAD so next build can skip if unchanged.
  writeFileSync(headFile, currentHead ?? "unknown");
  log(`done → ${entryFile} @ ${currentHead?.slice(0, 8)}`);
}

try {
  main();
} catch (error) {
  console.error(`[vendor-openwiki] failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
