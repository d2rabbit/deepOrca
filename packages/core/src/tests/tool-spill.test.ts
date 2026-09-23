// specs/model-vendor-profiles P1.3 后半 — 工具结果落盘指针（tool-spill）单测。
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { buildSpillNote, SPILL_KEEP_FILES, SPILL_THRESHOLD_CHARS, spillToolOutput } from "../common/tool-spill";

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "deeporca-spill-"));
}

test("content under the threshold is not spilled", () => {
  const root = tempRoot();
  try {
    assert.equal(spillToolOutput(root, "bash", "x".repeat(SPILL_THRESHOLD_CHARS - 1)), null);
    assert.equal(fs.existsSync(path.join(root, ".deeporca", "spill")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("large output is spilled and readable back verbatim; the pointer names the path", () => {
  const root = tempRoot();
  try {
    const content = `${"y".repeat(SPILL_THRESHOLD_CHARS + 10)}\nTAIL_MARKER`;
    const spillPath = spillToolOutput(root, "bash", content);
    assert.ok(spillPath);
    assert.ok(spillPath!.startsWith(path.join(root, ".deeporca", "spill")));
    assert.equal(fs.readFileSync(spillPath!, "utf8"), content);
    const note = buildSpillNote(spillPath!, content.length);
    assert.match(note, new RegExp(spillPath!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(note, /read tool/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("spill dir is pruned to the newest SPILL_KEEP_FILES artifacts", () => {
  const root = tempRoot();
  try {
    const content = "z".repeat(SPILL_THRESHOLD_CHARS + 1);
    const paths: string[] = [];
    for (let i = 0; i < SPILL_KEEP_FILES + 3; i += 1) {
      const p = spillToolOutput(root, "stage-a", content);
      assert.ok(p);
      paths.push(p!);
    }
    const remaining = fs.readdirSync(path.join(root, ".deeporca", "spill"));
    assert.equal(remaining.length, SPILL_KEEP_FILES);
    // 最旧的三个应被清理，最新的保留。
    for (const oldest of paths.slice(0, 3)) {
      assert.equal(fs.existsSync(oldest), false);
    }
    assert.equal(fs.existsSync(paths[paths.length - 1]!), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("fail-open: unusable projectRoot returns null instead of throwing", () => {
  assert.equal(spillToolOutput("", "bash", "z".repeat(SPILL_THRESHOLD_CHARS + 1)), null);
  assert.equal(spillToolOutput("/dev/null/nope", "bash", "z".repeat(SPILL_THRESHOLD_CHARS + 1)), null);
});
