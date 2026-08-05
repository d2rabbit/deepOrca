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

const result = spawnSync(process.execPath, ["--import", "tsx", "--test", ...testFiles], {
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
});

process.exit(result.status ?? 1);
