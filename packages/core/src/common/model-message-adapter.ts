/**
 * OpenAI ↔ ModelMessage boundary translation (specs/model-fleet-adaptation
 * §七 / X1.1 — user decision 2026-09-17: translate at the boundary, never
 * migrate persistence).
 *
 * `SessionMessage.messageParams` persists OpenAI wire shape; the experimental
 * AI SDK channel consumes `ModelMessage[]`. This adapter converts OUTBOUND
 * only (request time); the INBOUND direction never exists as data — the
 * transport re-synthesizes OpenAI-shaped streaming chunks, so the session
 * manager's reduce loop (and therefore persistence) sees today's exact shape.
 *
 * The assistant `reasoning_content` → reasoning-part mapping is the FIRST HOP
 * of the replay chain: @ai-sdk/openai-compatible converts reasoning parts
 * back into a `reasoning_content` request-body key (carried when present,
 * omitted when empty — verified against openai-compatible@3.0.51 dist),
 * which is the DeepSeek V4.1 tool-turn replay contract.
 *
 * Pure functions, no IO, no settings reads. Input is validated structurally
 * and unknown shapes degrade best-effort (fail-open), mirroring the lenient
 * handling of the legacy message converter.
 */

import type { ModelMessage, TextPart, ImagePart, ToolCallPart, ToolResultPart } from "ai";

/**
 * Structural stand-in for the AI SDK reasoning part (v7 does not re-export
 * ReasoningPart from "ai"); assignability to AssistantContent is structural.
 */
type ReasoningContentPart = { type: "reasoning"; text: string };

type OpenAIContentPart = {
  type?: unknown;
  text?: unknown;
  image_url?: { url?: unknown } | unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Parse tool-call arguments: JSON object when possible, raw string otherwise. */
function parseToolArguments(raw: unknown): unknown {
  const text = asString(raw);
  if (text === undefined) return {};
  if (text.trim() === "") return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // Non-JSON argument text (malformed model output): pass through as-is —
    // the openai-compatible converter re-stringifies whatever it receives.
    return text;
  }
}

/** Extract plain text from OpenAI string | content-parts-array content. */
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const part of content) {
    const text = isRecord(part) ? asString(part.text) : undefined;
    if (text !== undefined) parts.push(text);
  }
  return parts.join("");
}

/** OpenAI image_url part → AI SDK ImagePart (data URLs split, remote URLs kept). */
function toImagePart(url: string): ImagePart {
  const dataUrlMatch = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(url);
  if (dataUrlMatch) {
    return {
      type: "image",
      image: dataUrlMatch[2] ? dataUrlMatch[3] : url,
      ...(dataUrlMatch[1] ? { mediaType: dataUrlMatch[1] } : {}),
    };
  }
  try {
    return { type: "image", image: new URL(url) };
  } catch {
    // Not a valid URL either — hand the raw string to the SDK and let the
    // provider reject it (mirrors the legacy channel passing it through).
    return { type: "image", image: url };
  }
}

/** Convert OpenAI user/system content-parts array → AI SDK user content. */
function toUserContent(content: unknown): string | Array<TextPart | ImagePart> {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: Array<TextPart | ImagePart> = [];
  for (const raw of content) {
    if (!isRecord(raw)) continue;
    const part = raw as OpenAIContentPart;
    if (part.type === "text" && asString(part.text) !== undefined) {
      parts.push({ type: "text", text: part.text as string });
    } else if (part.type === "image_url") {
      const url = isRecord(part.image_url) ? asString(part.image_url.url) : asString(part.image_url);
      if (url) parts.push(toImagePart(url));
    }
    // Other part types (audio/file) are not produced by the engine today —
    // skipping them mirrors the legacy converter's image-gating behavior.
  }
  return parts;
}

/**
 * Convert an OpenAI-wire message array (the exact `messages` the session
 * manager's request body carries — turn-tail already applied, images already
 * gated) into AI SDK ModelMessages.
 *
 * Tool results carry no tool name on the OpenAI wire, so a first pass
 * indexes toolCallId → toolName from assistant tool_calls (two-pass, order
 * independent); unmatched results fall back to the name "tool".
 */
export function openAIToModelMessages(params: readonly unknown[]): ModelMessage[] {
  // Pass 1: toolCallId → toolName index (assistant tool_calls are the only
  // place the wire shape associates an id with a function name).
  const toolNames = new Map<string, string>();
  for (const param of params) {
    if (!isRecord(param) || param.role !== "assistant") continue;
    const toolCalls = Array.isArray(param.tool_calls) ? param.tool_calls : [];
    for (const call of toolCalls) {
      if (!isRecord(call)) continue;
      const id = asString(call.id);
      const fn = isRecord(call.function) ? call.function : null;
      const name = fn ? asString(fn.name) : undefined;
      if (id && name) toolNames.set(id, name);
    }
  }

  const messages: ModelMessage[] = [];
  for (const param of params) {
    if (!isRecord(param)) continue;
    switch (param.role) {
      case "system":
      case "developer": {
        messages.push({ role: "system", content: textOf(param.content) });
        break;
      }
      case "user": {
        messages.push({ role: "user", content: toUserContent(param.content) });
        break;
      }
      case "assistant": {
        const parts: Array<ReasoningContentPart | TextPart | ToolCallPart> = [];
        // Replay-chain first hop: the persisted reasoning field (family spec
        // reasoningField — "reasoning_content" canonically) becomes a
        // reasoning part. Empty/missing storage must NOT produce a part —
        // the openai-compatible converter omits the wire key when no
        // reasoning part exists, matching the V4.1 "omit when nothing
        // stored" boundary.
        const reasoning =
          asString(param.reasoning_content) ??
          asString(param.reasoning) ??
          (param.reasoning_content === "" ? "" : undefined);
        if (reasoning && reasoning.length > 0) {
          parts.push({ type: "reasoning", text: reasoning });
        }
        const text = asString(param.content);
        if (text !== undefined && text.length > 0) {
          parts.push({ type: "text", text });
        }
        const toolCalls = Array.isArray(param.tool_calls) ? param.tool_calls : [];
        for (const call of toolCalls) {
          if (!isRecord(call)) continue;
          const id = asString(call.id);
          const fn = isRecord(call.function) ? call.function : null;
          const name = fn ? asString(fn.name) : undefined;
          if (!id || !name) continue;
          parts.push({
            type: "tool-call",
            toolCallId: id,
            toolName: name,
            input: parseToolArguments(fn ? fn.arguments : undefined),
          });
        }
        messages.push(parts.length > 0 ? { role: "assistant", content: parts } : { role: "assistant", content: "" });
        break;
      }
      case "tool": {
        const toolCallId = asString(param.tool_call_id);
        if (!toolCallId) break; // unpairable on the wire shape — nothing to map to
        const output = textOf(param.content);
        const result: ToolResultPart = {
          type: "tool-result",
          toolCallId,
          toolName: toolNames.get(toolCallId) ?? "tool",
          output: { type: "text", value: output },
        };
        messages.push({ role: "tool", content: [result] });
        break;
      }
      default:
        break; // unknown role: skip (fail-open; the wire shape never emits one)
    }
  }
  return messages;
}
