// Test runner for @deeporca/core
import { globSync } from "glob";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testFiles = globSync("*.test.ts", { cwd: __dirname });

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
