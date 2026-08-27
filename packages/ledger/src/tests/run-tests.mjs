// Test runner for @deeporca/ledger (same wiring as core/memory: node:test via
// tsx, with per-test timeouts and force-exit so a stuck promise fails loudly
// instead of hanging CI).

import { spawnSync } from "child_process";
import { globSync } from "glob";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { fileURLToPath } from "url";

// node:sqlite (the view layer) needs >= 22.5; fail with a clear message.
{
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 5)) {
    console.error(`✖ Node >= 22.5 required (node:sqlite); current is ${process.versions.node}. Run: nvm use 22`);
    process.exit(1);
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Optional positional args run a subset; every file must live in this dir.
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

// Isolate HOME anyway: tests create temp identities/views and must never
// touch a developer's real ~/.deeporca.
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), "deeporca-ledger-test-home-"));

const TEST_TIMEOUT_MS = 120_000;

const result = spawnSync(
  process.execPath,
  [
    "--import",
    "tsx",
    "--test",
    `--test-timeout=${TEST_TIMEOUT_MS}`,
    "--test-force-exit",
    ...testFiles.map((file) => path.join(__dirname, file)),
  ],
  { cwd: path.join(__dirname, "../.."), stdio: "inherit", env: process.env }
);
process.exit(result.status ?? 1);
