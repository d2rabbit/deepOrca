/**
 * Run skill-up evals for the built-in plugin packages (specs/skill-eval A2 /
 * T1.2, design.md §3.3).
 *
 * Finds the plugin packages whose files changed since a git ref, runs
 * `skill-up run` inside each package's evals/ directory, collects the
 * benchmark.md / grading.json reports, and prints a summary table.
 *
 * Usage:
 *   node scripts/run-skill-evals.mjs [--since <ref>] [--all] [--package <name>]
 *                                    [--report-only] [--nightly]
 *
 * Flags:
 *   --since <ref>    Only evaluate packages with changes under
 *                    packages/core/templates/plugins/<pkg>/** since <ref>
 *                    (default: origin/master).
 *   --all            Evaluate every plugin package that has an evals/ dir.
 *   --package <name> Evaluate exactly one plugin package.
 *   --report-only    Default mode. Never exit non-zero on eval failures —
 *                    reports are uploaded as CI artifacts instead (design.md
 *                    §3.3: PRs do not hang a red line on eval scores).
 *   --nightly        Full-run mode. Exit 1 when any package fails; three
 *                    consecutive nightly regressions open an issue (issue
 *                    automation lives in the workflow, not here).
 *
 * Exit codes:
 *   0  ok (or: eval failures in --report-only mode)
 *   1  eval failures in --nightly mode
 *   2  infra error (skill-up binary missing, git failed, API key missing, …)
 *
 * Env:
 *   DEEPSEEK_API_KEY       required — the eval engine calls the LLM
 *   SKILL_EVAL_TIMEOUT_MS  per-package timeout (default 15 min)
 *
 * Note on `slow` tags: no case carries a slow tag yet. When the first
 * real-tool case lands, PR mode must skip tagged cases and nightly must
 * include them — defer to skill-up's own tag filtering flags once the pinned
 * binary's CLI surface is verified (see scripts/get-skill-up.mjs).
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveCachedSkillUpBinary } from "./get-skill-up.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const PLUGINS_ROOT = path.join(REPO_ROOT, "packages", "core", "templates", "plugins");
const DEFAULT_SINCE_REF = "origin/master";
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;

const EXIT_OK = 0;
const EXIT_EVAL_FAILURE = 1;
const EXIT_INFRA = 2;

// --- arg parsing -------------------------------------------------------------

function parseArgs(argv) {
  const args = { since: null, all: false, package: null, reportOnly: false, nightly: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--since":
        args.since = argv[++i];
        if (!args.since) {
          throw new Error("--since requires a git ref argument");
        }
        break;
      case "--all":
        args.all = true;
        break;
      case "--package":
        args.package = argv[++i];
        if (!args.package || args.package.startsWith("--")) {
          throw new Error("--package requires a plugin package name argument");
        }
        break;
      case "--report-only":
        args.reportOnly = true;
        break;
      case "--nightly":
        args.nightly = true;
        break;
      case "--help":
      case "-h":
        console.log(
          "usage: node scripts/run-skill-evals.mjs [--since <ref>] [--all] [--package <name>] [--report-only] [--nightly]"
        );
        process.exit(EXIT_OK);
        break;
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (args.nightly && args.reportOnly) {
    throw new Error("--nightly and --report-only are mutually exclusive");
  }
  // Default mode is report-only (safe in every context, incl. PRs).
  if (!args.nightly) {
    args.reportOnly = true;
  }
  return args;
}

// --- package discovery ---------------------------------------------------------

function listPluginPackages() {
  return fs
    .readdirSync(PLUGINS_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function hasEvalsDir(pkg) {
  return fs.existsSync(path.join(PLUGINS_ROOT, pkg, "evals", "eval.yaml"));
}

function changedPackagesSince(ref) {
  // argv form only — the ref comes from the CLI/CI and must never be
  // shell-parsed (repo security scanner: no exec with dynamic shell strings).
  const result = spawnSync("git", ["diff", "--name-only", ref], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) {
    throw new Error(`git diff failed to spawn: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`git diff --name-only ${ref} failed (${result.status}): ${result.stderr?.trim()}`);
  }
  const prefix = "packages/core/templates/plugins/";
  const changed = new Set();
  for (const line of result.stdout.split(/\r?\n/)) {
    const file = line.trim();
    if (!file.startsWith(prefix)) {
      continue;
    }
    const rest = file.slice(prefix.length);
    const pkg = rest.split("/")[0];
    if (pkg) {
      changed.add(pkg);
    }
  }
  return [...changed];
}

// --- skill-up binary resolution ------------------------------------------------

function lookupOnPath(name) {
  const tool = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(tool, [name], { encoding: "utf8" });
  if (result.status !== 0) {
    return null;
  }
  const candidates = result.stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    // npm-style .cmd/.bat shims cannot be spawned in argv form (Node refuses
    // shell-script executables without a shell string, which repo policy
    // forbids). Only accept real executables.
    .filter((candidate) => !/\.(cmd|bat)$/i.test(candidate));
  return candidates[0] ?? null;
}

function resolveSkillUpBinary() {
  const cached = resolveCachedSkillUpBinary();
  if (cached) {
    return { path: cached, source: "cache (.cache/skill-up — run scripts/get-skill-up.mjs to refresh)" };
  }
  const onPath = lookupOnPath("skill-up") ?? (process.platform === "win32" ? lookupOnPath("skill-up.exe") : null);
  if (onPath) {
    return { path: onPath, source: "PATH" };
  }
  return null;
}

// --- report collection -----------------------------------------------------------

function walkFiles(dir, predicate, acc = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, predicate, acc);
    } else if (predicate(entry.name)) {
      acc.push(fullPath);
    }
  }
  return acc;
}

/**
 * Defensive grading.json summary: the exact upstream schema is not pinned in
 * this repo, so count anything that looks like a per-case record with a
 * pass/fail-ish field. Returns null when nothing recognizable is found.
 */
function summarizeGradingJson(gradingPath) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(gradingPath, "utf8"));
  } catch {
    return null;
  }
  const records = [];
  const visit = (node) => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== "object") {
      return;
    }
    const status = node.status ?? node.passed ?? node.result ?? node.ok;
    if (typeof status === "boolean" || typeof status === "string") {
      const text = String(status).toLowerCase();
      if (text === "true" || text === "pass" || text === "passed" || text === "ok") {
        records.push(true);
      } else if (text === "false" || text === "fail" || text === "failed" || text === "error") {
        records.push(false);
      }
    }
    Object.values(node).forEach(visit);
  };
  visit(parsed);
  if (records.length === 0) {
    return null;
  }
  const passed = records.filter(Boolean).length;
  return { passed, failed: records.length - passed, total: records.length };
}

// --- runner ---------------------------------------------------------------------

function runPackage(binaryPath, pkg, timeoutMs) {
  const evalsDir = path.join(PLUGINS_ROOT, pkg, "evals");
  const startedAt = Date.now();
  // argv form only — no shell string, no user-controlled flags. `skill-up run`
  // discovers eval.yaml in the cwd (design.md §3.3). The pinned binary's exact
  // subcommand surface should be re-verified on first CI run.
  const result = spawnSync(binaryPath, ["run"], {
    cwd: evalsDir,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 32 * 1024 * 1024,
    env: process.env,
  });
  const durationS = ((Date.now() - startedAt) / 1000).toFixed(1);
  const timedOut = result.error?.code === "ETIMEDOUT";
  const failed = timedOut || result.status !== 0;

  const benchmarks = walkFiles(evalsDir, (name) => name === "benchmark.md");
  const gradings = walkFiles(evalsDir, (name) => name === "grading.json");
  const gradingSummary = summarizeGradingJson(gradings[0] ?? "");

  if (failed) {
    console.error(`\n[skill-evals] ${pkg} FAILED after ${durationS}s (exit ${result.status ?? "signal"})`);
    if (result.stdout?.trim()) {
      console.error(`  stdout: ${result.stdout.trim().split(/\r?\n/).slice(-20).join("\n  ")}`);
    }
    if (result.stderr?.trim()) {
      console.error(`  stderr: ${result.stderr.trim().split(/\r?\n/).slice(-20).join("\n  ")}`);
    }
  }

  return {
    pkg,
    ok: !failed,
    exitStatus: timedOut ? "timeout" : String(result.status),
    durationS,
    benchmark: benchmarks[0] ?? null,
    grading: gradingSummary,
  };
}

function printSummary(results) {
  const nameWidth = Math.max(8, ...results.map((r) => r.pkg.length));
  const header = `  ${"package".padEnd(nameWidth)}  ${"result".padEnd(7)}  ${"cases".padEnd(9)}  benchmark.md`;
  const line = "-".repeat(header.length);
  console.log("\n[skill-evals] summary");
  console.log(header);
  console.log(line);
  for (const r of results) {
    const cases = r.grading ? `${r.grading.passed}/${r.grading.total}` : "-";
    const rel = r.benchmark ? path.relative(REPO_ROOT, r.benchmark) : "(missing)";
    console.log(
      `  ${r.pkg.padEnd(nameWidth)}  ${(r.ok ? "PASS" : "FAIL").padEnd(7)}  ${cases.padEnd(9)}  ${rel}  [${r.durationS}s]`
    );
  }
  console.log(line);
}

// --- main -------------------------------------------------------------------------

function fail(message) {
  console.error(`[skill-evals] ${message}`);
  process.exit(EXIT_INFRA);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = args.nightly ? "nightly" : "report-only";
  console.log(`[skill-evals] mode: ${mode}`);

  const allPackages = listPluginPackages();
  let selected;
  if (args.package) {
    if (!allPackages.includes(args.package)) {
      fail(`unknown plugin package: ${args.package} (available: ${allPackages.join(", ")})`);
    }
    selected = [args.package];
  } else if (args.all) {
    selected = allPackages;
  } else {
    const since = args.since ?? DEFAULT_SINCE_REF;
    let changed;
    try {
      changed = changedPackagesSince(since);
    } catch (error) {
      fail(error.message);
    }
    selected = changed;
    console.log(`[skill-evals] changed plugin packages since ${since}: ${changed.join(", ") || "(none)"}`);
  }

  const evaluable = selected.filter(hasEvalsDir);
  const skipped = selected.filter((pkg) => !hasEvalsDir(pkg));
  if (skipped.length > 0) {
    console.log(`[skill-evals] no evals/ dir, skipping: ${skipped.join(", ")}`);
  }
  if (evaluable.length === 0) {
    console.log("[skill-evals] nothing to evaluate.");
    process.exit(EXIT_OK);
  }

  const binary = resolveSkillUpBinary();
  if (!binary) {
    fail(
      "skill-up binary not found.\n" +
        "  Run: node scripts/get-skill-up.mjs   (downloads the pinned release into .cache/skill-up/)\n" +
        "  Or install skill-up on PATH with the same version (see scripts/get-skill-up.mjs header)."
    );
  }
  if (!process.env.DEEPSEEK_API_KEY) {
    fail("DEEPSEEK_API_KEY is not set — the eval engine needs it to call the LLM.");
  }
  console.log(`[skill-evals] skill-up: ${binary.path} (${binary.source})`);
  console.log(`[skill-evals] packages: ${evaluable.join(", ")}`);

  const timeoutMs = Number(process.env.SKILL_EVAL_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
  const results = evaluable.map((pkg) => runPackage(binary.path, pkg, timeoutMs));
  printSummary(results);

  const failures = results.filter((r) => !r.ok);
  if (failures.length === 0) {
    console.log("[skill-evals] all evaluated packages passed.");
    process.exit(EXIT_OK);
  }
  if (args.reportOnly) {
    console.log(`[skill-evals] ${failures.length} package(s) failed — report-only mode, not failing the build.`);
    process.exit(EXIT_OK);
  }
  console.log(`[skill-evals] ${failures.length} package(s) failed in nightly mode — exiting 1.`);
  process.exit(EXIT_EVAL_FAILURE);
}

main();
