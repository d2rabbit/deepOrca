// Vendor SkillSpector (https://github.com/NVIDIA/SkillSpector) into the desktop app.
//
// Maintains a persistent source clone in `vendor-src/skillspector` and records the
// upstream commit SHA into `packages/desktop/vendor/skillspector/.vendored-skillspector-sha`
// on every build. Unlike codegraph/openwiki (Node CLIs compiled to dist/), SkillSpector
// is a Python package — we do NOT compile it here. The pinned SHA is read at runtime by
// `packages/core/src/common/skill-spector.ts`, which runs
// `uv tool install 'skillspector[mcp] @ git+...@<SHA>'` to provision an isolated Python
// environment on first use.
//
// Why git+SHA (not PyPI): the `skillspector` package on PyPI is MALWARE
// (advisory MAL-2026-6561, CVSS 10.0 — a credential-exfiltrating typosquat). NVIDIA has
// NOT published the official package to PyPI. The only safe install is from the GitHub
// repo pinned to a commit SHA (there are no release tags). See the SkillSpector
// integration design: docs/research/2026-07-30-harness-handbook-skillspector-agentreach-opennotebook.md
//
// Usage:
//   node scripts/vendor-skillspector.js            # clone/update + record SHA
//   node scripts/vendor-skillspector.js --force    # force re-record (re-fetch even if unchanged)
//
// Env overrides:
//   SKILLSPECTOR_REPO  (default https://github.com/NVIDIA/SkillSpector.git)
//   SKILLSPECTOR_REF   (default main — SkillSpector's default branch)
// Mirror repos are tried automatically whenever the primary GitHub clone or fetch fails,
// so builds keep working when github.com is unreachable.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const sourceDir = join(repoRoot, "vendor-src", "skillspector");
const targetDir = join(repoRoot, "packages", "desktop", "vendor", "skillspector");
// SkillSpector is Python — there is no compiled entry file. The SHA marker file is both
// the "is vendored" check and the pinned version the runtime reads to install from git.
const shaFile = join(targetDir, ".vendored-skillspector-sha");

// Primary GitHub source first; gitcode mirror backs it up when GitHub is blocked.
// (No known gitcode mirror for SkillSpector yet — add one here if it appears.)
const REPOS = [process.env.SKILLSPECTOR_REPO || "https://github.com/NVIDIA/SkillSpector.git"];
const REF = process.env.SKILLSPECTOR_REF || "main";
const force = process.argv.includes("--force");

function log(message) {
  console.log(`[vendor-skillspector] ${message}`);
}

function run(command, args, cwd) {
  return execFileSync(command, args, { cwd, stdio: "pipe", shell: false, encoding: "utf8" });
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
    log(`cloning → vendor-src/skillspector @ ${REF}`);
    mkdirSync(dirname(sourceDir), { recursive: true });
    try {
      cloneWithFallback(REF, sourceDir);
    } catch (error) {
      // Offline / blocked network: keep any existing SHA marker so the runtime still
      // has a pinned version to install from (it may already be provisioned).
      if (existsSync(shaFile)) {
        log("clone failed (offline?) — keeping the existing pinned SHA.");
        return;
      }
      throw error;
    }
  } else {
    log("fetching upstream updates …");
    const remote = fetchWithFallback(sourceDir, REF);
    if (!remote) {
      log("fetch failed (offline?) — using local source.");
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
  const previousHead = existsSync(shaFile) ? readFileSync(shaFile, "utf8").trim() : null;

  if (currentHead === previousHead && !force) {
    log(`up-to-date (${currentHead?.slice(0, 8)}) — skipping.`);
    return;
  }

  log(`recording SHA ${currentHead?.slice(0, 8)} (prev: ${previousHead?.slice(0, 8) ?? "none"}) …`);

  // ── Step 2: Record the pinned SHA into the vendor dir ──
  // SkillSpector is Python — no build step here. The runtime shim reads this SHA and
  // runs `uv tool install 'skillspector[mcp] @ git+...@<SHA>'` to provision it.
  mkdirSync(targetDir, { recursive: true });
  writeFileSync(shaFile, currentHead ?? "unknown", "utf8");

  log(`done → pinned ${currentHead?.slice(0, 8)}`);
}

try {
  main();
} catch (error) {
  console.error(`[vendor-skillspector] failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
