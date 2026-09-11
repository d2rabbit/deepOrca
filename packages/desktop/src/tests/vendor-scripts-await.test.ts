/**
 * Build-script invariant: `withAtomicSwap` is async (scripts/vendor-fs.js), so a
 * caller that forgets `await` gets a floating promise — its build/verify/swap
 * failures never reach the script's own try/catch, and the "success" line prints
 * before the swap commits. design-md shipped exactly that way (found in review
 * 2026-09-11): the best-effort "keeping existing vendored copy" branch was
 * unreachable and a real failure exited as an unhandled rejection instead.
 *
 * Nothing else pins this: the vendor scripts are only exercised at build time
 * with git + network, so a static check is the cheap guard that keeps vendor
 * #16 from repeating it.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Walk up from this test file to the repo-root scripts/ directory. */
function scriptsDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 8; depth += 1) {
    try {
      readFileSync(join(dir, "scripts", "vendor-fs.js"), "utf8");
      return join(dir, "scripts");
    } catch {
      dir = resolve(dir, "..");
    }
  }
  throw new Error("scripts/vendor-fs.js not found above the test file");
}

test("every vendor script awaits the async withAtomicSwap", () => {
  const dir = scriptsDir();
  assert.match(
    readFileSync(join(dir, "vendor-fs.js"), "utf8"),
    /export async function withAtomicSwap/,
    "withAtomicSwap is async — callers must await it"
  );

  const callers = readdirSync(dir).filter(
    (name) => name.startsWith("vendor-") && name.endsWith(".js") && name !== "vendor-fs.js"
  );
  assert.ok(callers.length > 5, `expected the vendor script family, saw ${callers.length}`);

  const offenders = callers.filter((name) => {
    const source = readFileSync(join(dir, name), "utf8");
    if (!source.includes("withAtomicSwap(")) return false;
    return !source.includes("await withAtomicSwap(");
  });
  assert.deepEqual(offenders, [], "every caller must use `await withAtomicSwap(`");
});
