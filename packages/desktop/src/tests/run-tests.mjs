// Test runner for @deeporca/desktop — mirrors core's node:test + tsx setup.
import { globSync } from "glob";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import * as path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testFiles = globSync("*.test.ts", { cwd: __dirname });

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
