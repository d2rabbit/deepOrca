---
type: architecture
title: Message Conversion and Tool Call Repair
description: How OpenAIMessageConverter converts SessionMessage[] to ChatCompletionMessageParam[], plus weak-model tool call truncation repair and thinking-mode request options.
tags: [message-conversion, tool-call-repair, thinking]
---

# Message Conversion and Tool Call Repair

Session messages (`SessionMessage[]`) must be reliably converted into the OpenAI chat-completions request body: tool calls and tool results are paired by `tool_call_id`, interrupted tool calls are repaired, and image and thinking content are encoded correctly. This is a key part of the cache-friendly design where "sessions are persisted as JSONL and can be replayed consistently."

## OpenAIMessageConverter (`common/openai-message-converter.ts`)

- `SessionMessage[]` → `ChatCompletionMessageParam[]`.
- Tool pairing: matches tool messages with the corresponding assistant `tool_calls` by `tool_call_id`; **interrupted tool calls** (calls without results) are synthesized as placeholders/repaired, ensuring the conversation structure sent back to the model is always valid.
- Multimodal: `contentParams.imageUrls` → image content blocks (subject to the model family's `supportsMultimodal` constraint).
- Thinking: `messageParams.reasoning` is placed according to the model family's `reasoningField` (`reasoning_content` or `thinking`).
- `buildMessages()` renders the init command prompt template at the correct position.
- `applyTurnTail`: **transient turn tail** — per-turn content such as dates/model lines is injected at request time (request-time only), **never persisted** (modifying JSONL would break prefix cache stability). This is key to the cache-friendly prefix design: persisted system messages stay byte-stable, and volatile information only appears at the end of the request body.
- `getTrailingPendingToolCallMessage`: exposes trailing pending tool calls (for the activation loop's pending path replay).

## Weak Model Self-Healing Layer (`common/tool-call-repair.ts`)

Introduced 2026-08-23 (commit 56650316), absorbing the vycode/dirge mechanism: **tool call truncation repair + text-channel scavenging**.

- Truncation repair: attempts to recover when the model outputs incomplete JSON parameters (`lenientParseToolArguments`, the parsing entry point for `ToolExecutor`).
- Text-channel scavenging: when the model writes tool results in plain text instead of tool messages, extracts structured results from the text.
- Design goal: be tolerant of weak models with "clear intent but recoverable text errors", while remaining strict about interface validation.

## Thinking Mode (`common/openai-thinking.ts`)

- `buildThinkingRequestOptions(thinkingEnabled, baseURL, reasoningEffort, model)`: constructs thinking request options by model family/endpoint.
- Five-level scale (`ReasoningEffort` = `ThinkLevel`, see model-capabilities in [core/settings](../core/settings.md)).
- Thinking level can be **hot-swapped** (no model switch required, `ThinkingModeSet` IPC, an independent channel separate from desktop `model:set`).

## Related Pages and Tests

- Conversion main path tests: `openai-message-converter.test.ts` (20KB, covering pairing/interruption/multimodal/thinking).
- `tool-call-repair.test.ts`, `openai-thinking.test.ts`.
- Upstream consumers: the activation loop in [session-lifecycle](session-lifecycle.md); [workflows/llm-tool-loop](../workflows/llm-tool-loop.md).
