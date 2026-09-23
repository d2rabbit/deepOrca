// specs/model-vendor-profiles P3.3 — 流式提交边界：可见增量判定、缓冲序列
// 重试决策。
import { test } from "node:test";
import assert from "node:assert/strict";
import { commitsOutput, canSilentlyRetry } from "../common/stream-commit-boundary";

test("commit: non-empty text delta commits", () => {
  assert.equal(commitsOutput({ delta: { content: "h" } }), true);
  assert.equal(commitsOutput({ delta: { content: "" } }), false);
  assert.equal(commitsOutput({ delta: {} }), false);
  assert.equal(commitsOutput({}), false);
});

test("commit: non-empty reasoning delta commits (both field spellings)", () => {
  assert.equal(commitsOutput({ delta: { reasoning_content: "think" } }), true);
  assert.equal(commitsOutput({ delta: { reasoning: "think" } }), true);
  assert.equal(commitsOutput({ delta: { reasoning_content: "" } }), false);
});

test("commit: tool-call deltas always commit (they are visible)", () => {
  assert.equal(commitsOutput({ delta: { tool_calls: [{ index: 0 }] } }), true);
  assert.equal(commitsOutput({ delta: { tool_calls: [] } }), false);
});

test("retry: empty/metadata-only buffer can be silently retried", () => {
  assert.deepEqual(canSilentlyRetry([]), { committable: true });
  assert.deepEqual(canSilentlyRetry([{ type: "start" }, { delta: { content: "" } }]), { committable: true });
});

test("retry: any committed event locks the request (no silent replacement)", () => {
  // MiniMax 契约：一旦调用方能观察输出，静默替换物理请求会缓冲整响应或
  // 重放重复内容——必须保持在已提交尝试上。
  const buffered = [
    { type: "start" },
    { delta: { role: "assistant" } },
    { delta: { content: "Hel" } }, // ← 提交点
    { delta: { content: "lo" } },
  ];
  assert.deepEqual(canSilentlyRetry(buffered), { committable: false, reason: "committed" });
  // 失败发生在首个可见增量之前 → 可静默重试。
  assert.deepEqual(canSilentlyRetry([{ type: "start" }]), { committable: true });
});
