/**
 * Background-task bash mutation screen (screenBackgroundBash).
 *
 * User directive 2026-08-30: bash 写入修改必须严格限制 — the background arch
 * task's bash must be read/validate ONLY. The undefined.json incident (a
 * node -e one-liner destroyed a complete artifact) proved prompt rules are
 * not enforcement. These tests pin the screen:
 *   - every mutating shape (redirect, rm/mv/cp, node -e, chained validate+rm)
 *     is DENIED with the write-tool pointer;
 *   - read-only commands and the ONE allowlisted mutation-flagged form (the
 *     bare `node <archify-bin> validate` invocation the skill mandates) pass.
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import { screenBackgroundBash } from "../session-manager-tasks";
import { configureArchifyPaths, type ArchifyPaths } from "../actions/archify-controller";

const BIN = "/vendor/archify/bin/archify.mjs";
const paths: ArchifyPaths = {
  skillDoc: "/vendor/archify/SKILL.md",
  schemasDir: "/vendor/archify/schemas",
  examplesDir: "/vendor/archify/examples",
  bin: BIN,
};

test("mutation shapes are denied", () => {
  configureArchifyPaths(paths);
  try {
    const denied: Array<[string, RegExp]> = [
      ["echo '{}' > map.json", /write-in-cwd/],
      ["cat a >> b.log", /write-in-cwd/],
      ["rm -rf .deeporca/prototypes", /delete-/],
      ["mv old.json new.json", /delete-/],
      ["cp a b", /write-/],
      ["touch marker", /write-/],
      ["sed -i 's/a/b/' f.json", /write-/],
      ["node -e 'fs.writeFileSync(\"x\", y)'", /delete-out-cwd/],
      ['python3 -c \'open("x","w")\'', /delete-out-cwd/],
      ["git commit -m x", /mutate-git-log/],
      ["tee out.txt", /write-/],
      [`node ${BIN} validate architecture f.json --json; rm -rf /`, /chained|write|delete/],
      [`node ${BIN} validate architecture f.json | tee log`, /chained|write/],
    ];
    for (const [cmd, expect] of denied) {
      const reason = screenBackgroundBash(cmd);
      assert.ok(reason, `must deny: ${cmd}`);
      assert.match(reason, expect, `reason carries the detected scope for: ${cmd}`);
      assert.match(reason, /write tool/, "denial points at the write tool");
    }
  } finally {
    configureArchifyPaths(null);
  }
});

test("read-only commands pass", () => {
  configureArchifyPaths(paths);
  try {
    const allowed = [
      "ls -la /target",
      "cat package.json",
      "rg -n 'main' src/",
      "git log --oneline -5",
      "git rev-parse HEAD",
      "find . -name '*.kt'",
      "grep -r foo .",
      "jq '.name' package.json",
      "node --version",
    ];
    for (const cmd of allowed) {
      assert.equal(screenBackgroundBash(cmd), null, `must allow: ${cmd}`);
    }
  } finally {
    configureArchifyPaths(null);
  }
});

test("the bare archify validate invocation is allowlisted (and only bare)", () => {
  configureArchifyPaths(paths);
  try {
    assert.equal(
      screenBackgroundBash(`node ${BIN} validate architecture /t/arch-x.architecture.json --quality showcase --json`),
      null,
      "bare validate passes (inference flags any node <file>, the skill mandates this one)"
    );
    assert.equal(screenBackgroundBash(`node ${BIN} validate workflow f.json`), null);
    // quoted bin path also accepted
    assert.equal(screenBackgroundBash(`node "${BIN}" validate architecture f.json`), null);
  } finally {
    configureArchifyPaths(null);
  }
});

test("no allowlist when the toolkit seam is unconfigured", () => {
  configureArchifyPaths(null);
  // An arbitrary node <file> invocation stays denied — no bin to trust.
  assert.ok(screenBackgroundBash("node /somewhere/else.mjs validate architecture f.json"));
});
