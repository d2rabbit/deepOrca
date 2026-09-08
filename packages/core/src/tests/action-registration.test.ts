/**
 * Registration tripwire (user ask 2026-09-08): every exported prototype
 * action definition MUST appear in session-manager-base's registry — exporting
 * without registering ships a dead action (ACTION_NOT_FOUND at runtime), and
 * action-level tests stub the runner so they cannot catch it. This is exactly
 * how prototype.arch shipped dead in its first cut.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as url from "node:url";

const here = path.dirname(url.fileURLToPath(import.meta.url));

test("every exported prototype action definition is registered in session-manager-base", () => {
  const source = fs.readFileSync(path.join(here, "../session-manager-base.ts"), "utf8");
  const names = [
    "prototypeSpecDefinition",
    "prototypeMaterializeDefinition",
    "prototypeVerifyDefinition",
    "prototypeReviseDefinition",
    "prototypeArchDefinition",
  ];
  const unregistered = names.filter(
    (name) => source.includes(name) === false || !new RegExp(`register\\(${name}`, "m").test(source)
  );
  assert.deepEqual(unregistered, [], "exported but never registered actions");
});
