// Battery B1 (specs/model-fleet-adaptation §七): OpenAI ↔ ModelMessage
// translation round-trip golden test. The "wire" half of the round-trip
// mirrors the VERIFIED @ai-sdk/openai-compatible@3.0.51 converter behavior
// (assistant reasoning parts → `reasoning_content` carried-when-present /
// omitted-when-empty; tool-call parts → tool_calls; tool results → role:tool)
// — the DeepSeek V4.1 replay chain end to end.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ModelMessage } from "ai";
import { openAIToModelMessages } from "../common/model-message-adapter";

/** OpenAI wire shape the engine's converter produces (request side). */
const fixture: unknown[] = [
  { role: "system", content: "You are DeepOrca." },
  { role: "user", content: "List the files." },
  {
    role: "user",
    content: [
      { type: "text", text: "What is in this picture?" },
      { type: "image_url", image_url: { url: "data:image/png;base64,aGVsbG8=" } },
      { type: "image_url", image_url: { url: "https://example.com/cat.jpg" } },
    ],
  },
  {
    role: "assistant",
    content: "Let me check.",
    reasoning_content: "The user wants files; run ls.",
    tool_calls: [
      { id: "call_1", type: "function", function: { name: "bash", arguments: '{"command":"ls"}' } },
      { id: "call_2", type: "function", function: { name: "read", arguments: '{"path":"a.txt"}' } },
    ],
  },
  { role: "tool", tool_call_id: "call_1", content: '{"ok":true,"output":"a.txt b.txt"}' },
  { role: "tool", tool_call_id: "call_2", content: '{"ok":true}' },
  // Replay boundary — assistant WITHOUT stored reasoning (pre-thinking turn).
  { role: "assistant", content: "Done.", tool_calls: [] },
  // Replay boundary — assistant with EMPTY reasoning storage.
  { role: "assistant", content: "Empty reasoning turn.", reasoning_content: "" },
  // Turn-tail already appended to the last user message (request-time only).
  { role: "user", content: "Continue.\n\n[tail: 2026-09-17]" },
];

test("openAIToModelMessages maps roles, tool pairs and images", () => {
  const messages = openAIToModelMessages(fixture);

  assert.equal(messages[0]?.role, "system");
  assert.deepEqual(messages[0], { role: "system", content: "You are DeepOrca." });

  assert.deepEqual(messages[1], { role: "user", content: "List the files." });

  const multimodal = messages[2];
  assert.equal(multimodal?.role, "user");
  const parts = (multimodal as { content: Array<{ type: string }> }).content;
  assert.equal(parts.length, 3);
  assert.deepEqual(parts[0], { type: "text", text: "What is in this picture?" });
  // data URL → split into base64 payload + mediaType
  assert.deepEqual(parts[1], { type: "image", image: "aGVsbG8=", mediaType: "image/png" });
  // remote URL → preserved as URL (href round-trips)
  assert.equal(parts[2]?.type, "image");
  assert.equal(String((parts[2] as { image: URL }).image), "https://example.com/cat.jpg");
});

test("replay chain first hop: stored reasoning becomes a leading reasoning part", () => {
  const messages = openAIToModelMessages(fixture);
  const assistant = messages[3];
  assert.equal(assistant?.role, "assistant");
  const content = (assistant as { content: Array<{ type: string }> }).content;
  assert.deepEqual(content[0], { type: "reasoning", text: "The user wants files; run ls." });
  assert.deepEqual(content[1], { type: "text", text: "Let me check." });
  const toolCalls = content.filter((part) => part.type === "tool-call");
  assert.deepEqual(toolCalls[0], {
    type: "tool-call",
    toolCallId: "call_1",
    toolName: "bash",
    input: { command: "ls" },
  });
  assert.deepEqual(toolCalls[1], {
    type: "tool-call",
    toolCallId: "call_2",
    toolName: "read",
    input: { path: "a.txt" },
  });
});

test("tool results recover toolName via the two-pass toolCallId index", () => {
  const messages = openAIToModelMessages(fixture);
  const tool1 = messages[4] as { role: string; content: Array<Record<string, unknown>> };
  assert.equal(tool1.role, "tool");
  assert.deepEqual(tool1.content[0], {
    type: "tool-result",
    toolCallId: "call_1",
    toolName: "bash",
    output: { type: "text", value: '{"ok":true,"output":"a.txt b.txt"}' },
  });
  const tool2 = messages[5] as { content: Array<Record<string, unknown>> };
  assert.equal(tool2.content[0]?.toolName, "read");
});

test("replay boundary: absent and empty reasoning produce NO reasoning part", () => {
  const messages = openAIToModelMessages(fixture);
  const withoutReasoning = messages[6] as { content: Array<{ type: string }> };
  assert.equal(withoutReasoning.content.filter((part) => part.type === "reasoning").length, 0);
  const emptyReasoning = messages[7] as { content: Array<{ type: string }> };
  assert.equal(emptyReasoning.content.filter((part) => part.type === "reasoning").length, 0);
});

test("turn-tail text passes through verbatim (prefix stability is the caller's job)", () => {
  const messages = openAIToModelMessages(fixture);
  assert.deepEqual(messages[8], { role: "user", content: "Continue.\n\n[tail: 2026-09-17]" });
});

/**
 * Wire-side half of the round-trip — mirrors the verified
 * openai-compatible@3.0.51 converter (dist): assistant reasoning parts are
 * carried back as `reasoning_content` (key omitted when no part exists),
 * tool-call parts JSON-stringify their input, tool results map to role:tool.
 */
function modelMessagesToWire(messages: ModelMessage[]): unknown[] {
  const wire: unknown[] = [];
  for (const message of messages) {
    if (message.role === "system") {
      wire.push({ role: "system", content: message.content });
    } else if (message.role === "user") {
      if (typeof message.content === "string") {
        wire.push({ role: "user", content: message.content });
        continue;
      }
      wire.push({
        role: "user",
        content: message.content.map((part) => {
          if (part.type === "text") return { type: "text", text: part.text };
          const image = part.image;
          if (image instanceof URL) return { type: "image_url", image_url: { url: image.href } };
          if (typeof image === "string" && part.mediaType && !image.startsWith("data:")) {
            return { type: "image_url", image_url: { url: `data:${part.mediaType};base64,${image}` } };
          }
          return { type: "image_url", image_url: { url: image } };
        }),
      });
    } else if (message.role === "assistant") {
      const parts = typeof message.content === "string" ? [] : message.content;
      const reasoning = parts
        .filter((part): part is { type: "reasoning"; text: string } => part.type === "reasoning")
        .map((part) => part.text)
        .join("");
      const text = parts
        .filter((part): part is { type: "text"; text: string } => part.type === "text")
        .map((part) => part.text)
        .join("");
      const toolCalls = parts
        .filter(
          (part): part is { type: "tool-call"; toolCallId: string; toolName: string; input: unknown } =>
            part.type === "tool-call"
        )
        .map((part) => ({
          id: part.toolCallId,
          type: "function",
          function: { name: part.toolName, arguments: JSON.stringify(part.input) },
        }));
      wire.push({
        role: "assistant",
        content: text || null,
        ...(reasoning.length > 0 ? { reasoning_content: reasoning } : {}),
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      });
    } else if (message.role === "tool") {
      for (const part of message.content) {
        if (part.type !== "tool-result") continue;
        wire.push({
          role: "tool",
          tool_call_id: part.toolCallId,
          content: part.output.type === "text" ? part.output.value : JSON.stringify(part.output.value),
        });
      }
    }
  }
  return wire;
}

test("B1 golden round-trip: OpenAI → ModelMessage → wire reproduces the replay contract", () => {
  const wire = modelMessagesToWire(openAIToModelMessages(fixture));

  // Assistant with stored reasoning: replayed verbatim, tool calls restored
  // with stringified arguments (byte-stable JSON key order via JSON.stringify).
  const replayedAssistant = wire[3] as Record<string, unknown>;
  assert.equal(replayedAssistant.reasoning_content, "The user wants files; run ls.");
  assert.equal(replayedAssistant.content, "Let me check.");
  assert.deepEqual(replayedAssistant.tool_calls, [
    { id: "call_1", type: "function", function: { name: "bash", arguments: '{"command":"ls"}' } },
    { id: "call_2", type: "function", function: { name: "read", arguments: '{"path":"a.txt"}' } },
  ]);

  // Boundary: assistants without / with empty stored reasoning carry NO key.
  const withoutReasoning = wire[6] as Record<string, unknown>;
  assert.equal("reasoning_content" in withoutReasoning, false);
  const emptyReasoning = wire[7] as Record<string, unknown>;
  assert.equal("reasoning_content" in emptyReasoning, false);

  // Tool results restored to the wire shape.
  assert.deepEqual(wire[4], { role: "tool", tool_call_id: "call_1", content: '{"ok":true,"output":"a.txt b.txt"}' });

  // Image parts restored to image_url form (data URL reassembled, remote kept).
  const multimodal = wire[2] as { content: Array<Record<string, unknown>> };
  assert.deepEqual(multimodal.content[1], { type: "image_url", image_url: { url: "data:image/png;base64,aGVsbG8=" } });
  assert.deepEqual(multimodal.content[2], { type: "image_url", image_url: { url: "https://example.com/cat.jpg" } });
});
