// Test runner for @deeporca/embedding — mirrors the core/memory pattern.
import { globSync } from "glob";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import * as path from "path";
import * as fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Optional positional file args run a subset; no args runs every *.test.ts.
// Each arg is resolved against this directory and must live inside it.
const cliArgs = process.argv.slice(2);
let testFiles;
if (cliArgs.length === 0) {
  testFiles = globSync("*.test.ts", { cwd: __dirname }).sort();
} else {
  testFiles = [];
  for (const arg of cliArgs) {
    const resolved = path.resolve(arg);
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

// Watchdog flags — see packages/core/src/tests/run-tests.mjs for the rationale:
// turn a never-settling test into a failure instead of an indefinite hang.
// Higher ceiling than the other packages because the model-backed tests load a
// 97M ONNX model when it is vendored locally.
const TEST_TIMEOUT_MS = 120_000;

const result = spawnSync(
  process.execPath,
  ["--import", "tsx", "--test", `--test-timeout=${TEST_TIMEOUT_MS}`, "--test-force-exit", ...testFiles],
  {
    stdio: "inherit",
    cwd: __dirname,
  }
);

process.exit(result.status ?? 1);
