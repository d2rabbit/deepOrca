// Test runner for @deeporca/desktop — mirrors core's node:test + tsx setup.
import { globSync } from "glob";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import * as path from "path";
import * as fs from "node:fs";

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
const TEST_TIMEOUT_MS = 60_000;

const result = spawnSync(
  process.execPath,
  ["--import", "tsx", "--test", `--test-timeout=${TEST_TIMEOUT_MS}`, "--test-force-exit", ...testFiles],
  {
    stdio: "inherit",
    cwd: __dirname,
    env: {
      ...process.env,
      // Point tsx at this package's tsconfig. The root tsconfig has `include: []`
      // and only project-references core, so tsx resolving upward from here finds
      // no config covering renderer sources and falls back to classic JSX — which
      // breaks every .tsx component (they rely on the automatic runtime and do not
      // `import React`). Renderer tests cannot load without this.
      TSX_TSCONFIG_PATH: path.resolve(__dirname, "..", "..", "tsconfig.json"),
    },
  }
);

process.exit(result.status ?? 1);
