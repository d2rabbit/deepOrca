// Unit tests for the family-routed local token counter (P0 of the
// token-statistics rework). The heuristic and payload-coverage assertions are
// exact by construction; the deepseek test validates the exact BPE path
// against the tokenizer package itself.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  countCompletionTokens,
  countConversationTokens,
  countRequestPayloadTokens,
  countTextTokens,
  estimateTextTokensHeuristic,
  warmTokenCounter,
} from "../common/token-counter";

test("heuristic counts CJK at ~1 token per char and ASCII at 4 chars per token", () => {
  assert.equal(estimateTextTokensHeuristic("你好"), 2);
  assert.equal(estimateTextTokensHeuristic("abcdefgh"), 2);
  assert.equal(estimateTextTokensHeuristic("你好abcd"), 3, "2 CJK + ceil(4 ascii / 4)");
  assert.equal(estimateTextTokensHeuristic(""), 0);
});

test("countTextTokens falls back to the heuristic for unknown families", () => {
  assert.equal(countTextTokens("test-model", "abcdefgh"), 2);
  assert.equal(countTextTokens("test-model", ""), 0);
});

test("countConversationTokens includes tool_calls arguments and per-message overhead", () => {
  const plain = countConversationTokens("test-model", [{ role: "user", content: "abcdefgh", messageParams: null }]);
  // 2 (content) + 12 (overhead)
  assert.equal(plain, 14);

  const withCalls = countConversationTokens("test-model", [
    {
      role: "assistant",
      content: "",
      messageParams: {
        tool_calls: [{ id: "c1", function: { name: "bash", arguments: "ls -la" } }],
      },
    },
  ]);
  // "bash" = 1 + "ls -la" = ceil(6/4) = 2 + overhead 12 — the OLD estimator
  // ignored tool_calls entirely; this pins the fix.
  assert.equal(withCalls, 15);
});

test("countRequestPayloadTokens covers messages, tool schema and multimodal parts", () => {
  const messagesOnly = countRequestPayloadTokens("test-model", {
    messages: [{ role: "system", content: "abcdefgh" }],
  });
  assert.equal(messagesOnly, 14);

  const withTools = countRequestPayloadTokens("test-model", {
    messages: [{ role: "system", content: "abcdefgh" }],
    tools: [{ type: "function", function: { name: "bash", description: "Run a command" } }],
  });
  assert.ok(withTools > messagesOnly, "tool definitions are part of the payload");

  const withImage = countRequestPayloadTokens("test-model", {
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "abcdefgh" },
          { type: "image_url", image_url: { url: "data:image/png;base64,xxx" } },
        ],
      },
    ],
  });
  assert.equal(withImage, 2 + 1024 + 12, "text part counted, image folded to the fixed constant");
});

test("countCompletionTokens counts content, reasoning and tool calls", () => {
  const tokens = countCompletionTokens("test-model", {
    content: "abcdefgh",
    reasoning: "ijklmnop",
    refusal: null,
    toolCalls: [{ function: { name: "bash", arguments: "ls" } }],
  });
  // 2 + 2 + "bash"(1) + "ls"(1)
  assert.equal(tokens, 6);
});

test("deepseek family counts exactly via the local tokenizer once warmed", async () => {
  await warmTokenCounter("deepseek-chat");
  const { fromPreTrained } = await import("@tlibnx/tokenizer-deepseek_v4");
  const tokenizer = await fromPreTrained();
  const sample = "你好世界，mixed English 与中文 content，function call: bash(ls -la) 结束。";
  const expected = (tokenizer(sample, { add_special_tokens: false }).input_ids as number[]).length;
  assert.ok(expected > 0, "tokenizer produced ids");
  assert.equal(countTextTokens("deepseek-chat", sample), expected, "exact path matches the tokenizer");
  // Memoized second call stays consistent.
  assert.equal(countTextTokens("deepseek-chat", sample), expected);
});
