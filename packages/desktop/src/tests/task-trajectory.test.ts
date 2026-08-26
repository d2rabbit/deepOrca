/**
 * Functional tests for task trajectory extraction (task-tree R3-7): real
 * JSONL fixtures on disk reduced to operation records — ordering, counts,
 * file extraction, failure marking, multi-session merge, missing files.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { extractTaskTrajectory } from "../main/task-trajectory";

function tempProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "deepcode-traj-"));
}

function toolLine(createTime: string, name: string, ok: boolean, paramsMd?: string): string {
  return JSON.stringify({
    id: `m-${createTime}-${name}`,
    sessionId: "s1",
    role: "tool",
    content: JSON.stringify({ ok, name, output: "…" }),
    createTime,
    meta: paramsMd ? { paramsMd } : undefined,
  });
}

test("extracts ordered operations with ok/summary/files and aggregates counts", () => {
  const dir = tempProjectDir();
  fs.writeFileSync(
    path.join(dir, "session-a.jsonl"),
    [
      JSON.stringify({ role: "user", content: "do things", createTime: "2026-08-24T01:00:00Z" }),
      toolLine("2026-08-24T01:00:01Z", "read", true, 'read {"file_path": "/tmp/a.ts"}'),
      JSON.stringify({ role: "assistant", content: "thinking…", createTime: "2026-08-24T01:00:02Z" }),
      toolLine("2026-08-24T01:00:03Z", "bash", false, "bash npm run build\nsecond line not in summary"),
      toolLine(
        "2026-08-24T01:00:05Z",
        "mcp__serena__find_symbol",
        true,
        'find_symbol body_path={"file_path": "src/x.ts"}'
      ),
      "not-json-line",
    ].join("\n")
  );
  const result = extractTaskTrajectory(["session-a"], dir);
  assert.equal(result.sessionCount, 1);
  assert.equal(result.operations.length, 3);
  // Chronological regardless of file order (they were ordered already — check sorting contract):
  assert.ok(result.operations[0].at <= result.operations[1].at);
  assert.equal(result.operations[0].tool, "read");
  assert.equal(result.operations[0].ok, true);
  assert.deepEqual(result.operations[0].files, ["/tmp/a.ts"]);
  assert.equal(result.operations[1].tool, "bash");
  assert.equal(result.operations[1].ok, false);
  assert.equal(result.operations[1].summary, "bash npm run build");
  assert.equal(result.operations[2].tool, "mcp__serena__find_symbol");
  assert.deepEqual(result.operations[2].files, ["src/x.ts"]);
  assert.deepEqual(result.toolCounts, { read: 1, bash: 1, mcp__serena__find_symbol: 1 });
  assert.deepEqual(result.filesTouched.sort(), ["/tmp/a.ts", "src/x.ts"]);
});

test("merges multiple sessions (last 8), skips missing files, counts all sessions", () => {
  const dir = tempProjectDir();
  fs.writeFileSync(path.join(dir, "s1.jsonl"), toolLine("2026-08-24T02:00:00Z", "read", true, "x"));
  fs.writeFileSync(path.join(dir, "s2.jsonl"), toolLine("2026-08-24T01:00:00Z", "write", true, "y"));
  // s3 missing on disk — skipped silently.
  const result = extractTaskTrajectory(["s1", "s2", "s3"], dir);
  assert.equal(result.sessionCount, 3, "sessionCount reflects bindings, not readable files");
  assert.equal(result.operations.length, 2);
  assert.ok(result.operations[0].at < result.operations[1].at, "cross-session chronological order");
  assert.deepEqual(result.toolCounts, { read: 1, write: 1 });
});

test("caps the operation ring at the most recent 500", () => {
  const dir = tempProjectDir();
  const lines: string[] = [];
  for (let i = 0; i < 520; i++) {
    lines.push(toolLine(new Date(Date.UTC(2026, 7, 24, 3, 0, i)).toISOString(), "bash", true, "op"));
  }
  fs.writeFileSync(path.join(dir, "s-big.jsonl"), lines.join("\n"));
  const result = extractTaskTrajectory(["s-big"], dir);
  assert.equal(result.operations.length, 500);
  // Ring keeps the NEWEST 500 (seconds 20..519).
  assert.equal(
    result.operations[result.operations.length - 1].at,
    new Date(Date.UTC(2026, 7, 24, 3, 0, 519)).toISOString()
  );
  assert.equal(result.operations[0].at, new Date(Date.UTC(2026, 7, 24, 3, 0, 20)).toISOString());
  // Counts aggregate over EVERYTHING scanned, not just the ring tail.
  assert.equal(result.toolCounts.bash, 520);
});

test("non-tool roles and non-JSON tool content never appear", () => {
  const dir = tempProjectDir();
  fs.writeFileSync(
    path.join(dir, "s-mixed.jsonl"),
    [
      JSON.stringify({ role: "assistant", content: "a very chatty reply", createTime: "2026-08-24T04:00:00Z" }),
      JSON.stringify({ role: "tool", content: "plain text not json", createTime: "2026-08-24T04:00:01Z" }),
      toolLine("2026-08-24T04:00:02Z", "read", true),
    ].join("\n")
  );
  const result = extractTaskTrajectory(["s-mixed"], dir);
  assert.equal(result.operations.length, 1);
  assert.equal(result.operations[0].tool, "read");
});
