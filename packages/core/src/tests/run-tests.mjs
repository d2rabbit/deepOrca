// Test runner for @deeporca/core
import { globSync } from "glob";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";

// Node version guard: the repo pins Node 22 (.nvmrc) and core/memory use
// node:sqlite (needs >= 22.5). Under an older Node the sqlite layers degrade
// SILENTLY and tests fail with confusing assertions instead of a clear error
// (observed: store-cache tests failing under nvm-default Node 20). Fail fast.
{
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 5)) {
    console.error(`✖ Node >= 22.5 required (node:sqlite); current is ${process.versions.node}. Run: nvm use 22`);
    process.exit(1);
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Allow optional positional file arguments to run a subset of tests. With no
// args, run every *.test.ts in this directory (sorted for deterministic order).
// With args, each is resolved against this directory and must live inside it,
// so a typo or an absolute path from elsewhere cannot pull in an unrelated
// file. AGENTS.md documents the single-file command:
//   node packages/<pkg>/src/tests/run-tests.mjs packages/<pkg>/src/tests/<file>.test.ts
const cliArgs = process.argv.slice(2);
let testFiles;
if (cliArgs.length === 0) {
  testFiles = globSync("*.test.ts", { cwd: __dirname }).sort();
} else {
  testFiles = [];
  for (const arg of cliArgs) {
    const resolved = path.resolve(arg);
    // Must live inside this tests directory.
    const rel = path.relative(__dirname, resolved);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      console.error(`[run-tests] refusing to run file outside tests dir: ${arg}`);
      process.exit(2);
    }
    if (!fs.existsSync(resolved)) {
      console.error(`[run-tests] test file does not exist: ${arg}`);
      process.exit(2);
    }
    testFiles.push(path.basename(resolved));
  }
}
if (testFiles.length === 0) {
  console.error("[run-tests] no test files matched.");
  process.exit(2);
}

// Isolate HOME for the entire test run. Tests create throwaway workspaces under
// $TMPDIR and the session layer persists them under `<HOME>/.deepcode/projects/`
// — without an isolated HOME, every run pollutes the developer's real session
// index with hundreds of dead temp-workspace entries (which the desktop sidebar
// then enumerates). A single process-wide override makes this impossible to get
// wrong in individual test files.
const testHome = fs.mkdtempSync(path.join(os.tmpdir(), "deeporca-test-home-"));

// Watchdog flags. Without these, one promise that never settles (e.g. a mock that
// only resolves via an abort listener when the signal had already fired) hangs the
// whole run forever at 0% CPU, and CI cannot tell that apart from a slow suite.
// `--test-timeout` turns a stuck test into a failure with a stack trace;
// `--test-force-exit` keeps a handle retained after the run from blocking exit.
// force-exit masks handle leaks, so treat it as a backstop, not a licence to leak.
//
// IMPORTANT: for files built from top-level `test()` calls, node:test applies this
// timeout to the *whole file* as well as to each test — so it must exceed the total
// runtime of the slowest file, not just the slowest test. session.test.ts currently
// runs ~200s (dominated by MCP startup timeouts), so 300s leaves headroom while
// still bounding a hang. The 45-minute CI job timeout is the outer guard.
const TEST_TIMEOUT_MS = 300_000;

const result = spawnSync(
  process.execPath,
  ["--import", "tsx", "--test", `--test-timeout=${TEST_TIMEOUT_MS}`, "--test-force-exit", ...testFiles],
  {
    stdio: "inherit",
    cwd: __dirname,
    env: {
      ...process.env,
      HOME: testHome,
      // Windows equivalents so os.homedir()/path resolution stays isolated there too.
      USERPROFILE: testHome,
      // Never fire network installs (SkillSpector uv tool install) from tests —
      // a background provision would keep the test process alive for minutes.
      DEEPORCA_SKIP_SKILL_PROVISION: "1",
    },
  }
);

process.exit(result.status ?? 1);
