/**
 * 循环干预阶梯（specs/model-vendor-profiles P2.1 — kimi toolDedupeService
 * 3/5/8/12 的零依赖移植 + MiMo try-best 的归一化命令重试计数）。
 *
 * 检测键：`toolName + canonicalArgs`（深度键排序后 stringify——仅属性
 * 顺序不同 = 同一次调用）。被拒绝的调用同样计数（「a model hammering a
 * denied call is exactly the loop worth breaking」——deepseek 实证）。
 * 用户插话重置链（「repetition across it is not a loop」）。
 *
 * 阶梯文案（kimi 原文直译的精神，中文产品语境重写）：
 *   L1(3)  要求先写一句「预期新信息」再行动
 *   L2(5)  强制三选一并先声明选择（反证检验 / 要输入 / 收敛）
 *   L3(8)  纯文本最终回复（覆盖阻塞点/已试路径/需要什么）
 *   L4(12) 拒绝执行该调用并终止本轮（stopTurn）
 */

export const REPEAT_L1_START = 3;
export const REPEAT_L2_START = 5;
export const REPEAT_L3_START = 8;
export const REPEAT_FORCE_STOP = 12;

/** 阶梯等级（0 = 未触发）。 */
export type RepeatTier = 0 | 1 | 2 | 3 | 4;

export function repeatTierFor(count: number): RepeatTier {
  if (count >= REPEAT_FORCE_STOP) return 4;
  if (count >= REPEAT_L3_START) return 3;
  if (count >= REPEAT_L2_START) return 2;
  if (count >= REPEAT_L1_START) return 1;
  return 0;
}

/** 深度键排序后 stringify——仅属性顺序不同的两次调用归一为同一 canonical 串。 */
export function canonicalToolCallKey(name: string, args: unknown): string {
  return `${name}::${canonicalJson(args)}`;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value, new Set<object>())) ?? "null";
}

function canonicalize(value: unknown, ancestors: Set<object>): unknown {
  if (Array.isArray(value)) {
    if (ancestors.has(value)) return "[cyclic]";
    ancestors.add(value);
    try {
      return value.map((item) => canonicalize(item, ancestors));
    } finally {
      ancestors.delete(value);
    }
  }
  if (!value || typeof value !== "object") return value;
  if (ancestors.has(value)) return "[cyclic]";
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

/** L1 提醒（kimi REMINDER_TEXT_1 精神）：先声明预期新信息再行动。 */
export const REPEAT_REMINDER_L1 =
  "The same tool call has been repeated several times in a row. Before making your next call, " +
  "write one sentence stating what new information you expect it to produce. Then act on that " +
  "sentence: if it names something this result does not already give you, choose the action that " +
  "best provides it; otherwise, continue with the evidence you already have.";

/** L2 提醒（kimi 三选一）：先声明选择再行动。 */
export const REPEAT_REMINDER_L2 =
  "The same tool call has now been repeated many times. Choose exactly one of the following and " +
  "state your choice before acting:\n" +
  "(1) Falsification check: run the cheapest test that could conclusively disprove your current approach.\n" +
  "(2) Missing input: tell the user precisely what information or decision you need to proceed, and ask for it.\n" +
  "(3) Conclude: deliver your best result based on the evidence already gathered, listing anything that remains uncertain.";

/** L3 提醒：纯文本最终回复。 */
export const REPEAT_REMINDER_L3 =
  "Write your final response now, without any further tool calls. Cover: the current blocker, " +
  "each approach you have tried and what it established, and the specific information or decision " +
  "you need from the user to unblock progress. Text only.";

/** L4 终止文案（kimi HANDOFF_VETO_TEXT 精神）。 */
export const REPEAT_VETO_TEXT =
  "This turn was ended by the repeat breaker after the same tool call was issued 12 times in a " +
  "row. This step accepts a text response only, so the tool call was not executed. Reply in text: " +
  "the current blocker, what you tried, and what you need next.";

export function reminderForTier(tier: RepeatTier): string | null {
  if (tier === 1) return REPEAT_REMINDER_L1;
  if (tier === 2) return REPEAT_REMINDER_L2;
  if (tier === 3) return REPEAT_REMINDER_L3;
  return null; // tier 4 → veto（调用方终止，不发 reminder）
}
