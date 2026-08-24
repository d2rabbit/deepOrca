/**
 * Tests for spawnTracked — the hardened child-process runner (core) shared by
 * the wiki/CRG/OCR CLI adapters. These pin the failure class that hit the
 * index-knowledge module on real machines:
 *   - `close`-only detection hanging forever when a pipe-inherited grandchild
 *     outlives the CLI (THE regression test below),
 *   - no timeout (wedged child = infinite spinner),
 * plus the basic contract (exit codes, stdout/stderr capture, line taps).
 *
 * Uses real short-lived node children via process.execPath — no mocks, so the
 * stdio semantics under test are the kernel's actual ones.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnTracked, configureSpawnTrackedLogger } from "../common/spawn-tracked";

const node = process.execPath;

test("clean exit resolves with code 0 and captured output", async () => {
  const lines: string[] = [];
  const res = await spawnTracked({
    label: "t-ok",
    command: node,
    args: ["-e", "console.log('hello'); process.exit(0)"],
    cwd: process.cwd(),
    timeoutMs: 15_000,
    onStdoutLine: (l) => lines.push(l),
    logSpawn: false,
  });
  assert.equal(res.code, 0);
  assert.ok(res.stdout.includes("hello"));
  assert.deepEqual(lines, ["hello"]);
  assert.equal(res.forcedOk, false);
});

test("non-zero exit resolves (caller decides semantics) with stderr captured", async () => {
  const res = await spawnTracked({
    label: "t-fail",
    command: node,
    args: ["-e", "console.error('boom'); process.exit(3)"],
    cwd: process.cwd(),
    timeoutMs: 15_000,
    logSpawn: false,
  });
  assert.equal(res.code, 3);
  assert.ok(res.stderr.includes("boom"));
});

test("hard timeout rejects and kills the wedged child", async () => {
  await assert.rejects(
    spawnTracked({
      label: "t-timeout",
      command: node,
      args: ["-e", "setTimeout(() => {}, 30000)"],
      cwd: process.cwd(),
      timeoutMs: 400,
      logSpawn: false,
    }),
    /超时/
  );
});

test("REGRESSION: pipe-inherited grandchild cannot delay completion (exit is authoritative)", async () => {
  // Parent spawns a holder that INHERITS stdout/stderr (our pipes) and lives
  // ~8s, then the parent exits 0 immediately. Node's `close` on the parent
  // would wait for the holder — spawnTracked must settle from `exit` within
  // the flush grace instead of hanging (the index-module bug class).
  const parentScript = `
    const { spawn } = require("child_process");
    spawn(process.execPath, ["-e", "setTimeout(() => {}, 8000)"], {
      stdio: ["ignore", "inherit", "inherit"]
    });
    console.log("parent-done");
    setTimeout(() => process.exit(0), 50);
  `;
  const startedAt = Date.now();
  const res = await spawnTracked({
    label: "t-grandchild",
    command: node,
    args: ["-e", parentScript],
    cwd: process.cwd(),
    timeoutMs: 15_000,
    logSpawn: false,
  });
  const elapsedMs = Date.now() - startedAt;
  assert.equal(res.code, 0, `expected exit 0, got ${res.code}`);
  // Grace is 2s; the 8s pipe holder must NOT have delayed us past ~5s.
  assert.ok(elapsedMs < 5000, `completion delayed ${elapsedMs}ms — close-wait regression`);
  assert.ok(res.stdout.includes("parent-done"), `final stdout flush lost: ${res.stdout}`);
});

test("heartbeat finishOk force-settles success while the process is wedged", async () => {
  // Simulates the wiki completion-marker case: work is recorded, exit hangs.
  // The heartbeat's finishOk must resolve ok despite the child never exiting.
  const res = await spawnTracked({
    label: "t-forceok",
    command: node,
    args: ["-e", "setTimeout(() => {}, 30000)"],
    cwd: process.cwd(),
    timeoutMs: 15_000,
    heartbeatMs: 150,
    onHeartbeat: ({ finishOk }) => {
      finishOk("完成标记已确认");
    },
    logSpawn: false,
  });
  assert.equal(res.forcedOk, true);
  assert.equal(res.forcedNote, "完成标记已确认");
  // Not a clean exit — killed — but the caller treats forcedOk as success.
  assert.notEqual(res.code, 0);
});

test("stderr lines reach the host logger when configured", async () => {
  const logged: string[] = [];
  configureSpawnTrackedLogger((line) => logged.push(line));
  try {
    await spawnTracked({
      label: "t-stderrlog",
      command: node,
      args: ["-e", "console.error('noise'); process.exit(0)"],
      cwd: process.cwd(),
      timeoutMs: 15_000,
      logSpawn: false,
    });
    assert.ok(
      logged.some((l) => l.includes("noise")),
      `stderr not logged: ${logged.join(" | ")}`
    );
  } finally {
    configureSpawnTrackedLogger(null);
  }
});
