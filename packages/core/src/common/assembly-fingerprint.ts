/**
 * 装配指纹（specs/model-vendor-profiles P1.5 — MiniMax assembly-fingerprint.ts
 * 的零依赖移植）。
 *
 * 只对「provider 可见且与缓存相关」的装配面（系统提示 + 工具定义）做
 * sha256 截断指纹；**消息历史被刻意排除**——历史增长是追加式（缓存安全），
 * 而装配面变动才会打断前缀。system prompt 保留原始空白（「prompt caches
 * observe it even when humans do not」）；工具保序但定义内对象键排序
 * （canonicalStringify，防键序噪声）。
 *
 * 消费方式：每次请求前对装配面取指纹、与上次比对——不变 ⇒ 前缀缓存应当
 * 命中；变了 ⇒ 变更点即缓存失效点，`changed` 的 part 名直接回答「为什么
 * 这轮没命中」（MiniMax pi_llm_assembly_stability_total 的本地版）。
 */

import { createHash } from "node:crypto";

/** 截断长度（MiniMax FINGERPRINT_LENGTH=16：碰撞概率对本用途足够低）。 */
const FINGERPRINT_LENGTH = 16;

export type AssemblyFingerprintInput = {
  systemPrompt?: string;
  tools?: ReadonlyArray<{
    name: string;
    description: string;
    parameters?: unknown;
  }>;
};

export type AssemblyFingerprint = {
  systemPrompt: string;
  tools: string;
};

/** 对装配面取指纹：system 与 tools 各一个 sha256 截断值。 */
export function fingerprintAssembly(input: AssemblyFingerprintInput): AssemblyFingerprint {
  const toolInterfaces = (input.tools ?? []).map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));
  return {
    // 精确保留空白：提示缓存能观察到人类不会注意到的差异。
    systemPrompt: fingerprint(input.systemPrompt ?? ""),
    // 工具保序、定义内对象键规范化排序。
    tools: fingerprint(canonicalStringify(toolInterfaces)),
  };
}

/** 比对两次指纹，返回发生变化的 part 名（空数组 = 装配面稳定）。 */
export function diffAssemblyFingerprints(
  previous: AssemblyFingerprint | null,
  current: AssemblyFingerprint
): Array<"system_prompt" | "tools"> {
  if (!previous) return [];
  const changed: Array<"system_prompt" | "tools"> = [];
  if (previous.systemPrompt !== current.systemPrompt) changed.push("system_prompt");
  if (previous.tools !== current.tools) changed.push("tools");
  return changed;
}

function fingerprint(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, FINGERPRINT_LENGTH);
}

function canonicalStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value, new Set<object>())) ?? "null";
}

function canonicalize(value: unknown, ancestors: Set<object>): unknown {
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new TypeError("Cannot fingerprint cyclic assembly data");
    ancestors.add(value);
    try {
      return value.map((item) => canonicalize(item, ancestors));
    } finally {
      ancestors.delete(value);
    }
  }
  if (!value || typeof value !== "object") return value;
  if (ancestors.has(value)) throw new TypeError("Cannot fingerprint cyclic assembly data");
  ancestors.add(value);
  try {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const item = (value as Record<string, unknown>)[key];
      if (item === undefined || typeof item === "function" || typeof item === "symbol") continue;
      result[key] = canonicalize(item, ancestors);
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}
