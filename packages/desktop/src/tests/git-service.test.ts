/**
 * Tests for git-service ref guards (full-domain audit 2026-09): commitDiff /
 * commitFiles pass a renderer-supplied `hash` into `git show <ref>` — a
 * leading dash makes git parse it as an OPTION (`git show --output=<path>`
 * is an arbitrary-file-write primitive; same CWE-88 class checkout and
 * stashCheckout already reject).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { commitDiff, commitFiles } from "../main/git-service.js";

test("commitDiff rejects a leading-dash ref without spawning git", async () => {
  const result = await commitDiff("/tmp", "--output=/tmp/pwned");
  assert.match(result.diff, /invalid commit ref/);
});

test("commitFiles rejects a leading-dash ref without spawning git", async () => {
  const files = await commitFiles("/tmp", "--output=/tmp/pwned");
  assert.deepEqual(files, []);
});
