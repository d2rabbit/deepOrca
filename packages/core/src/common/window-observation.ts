/**
 * 观察式窗口学习（specs/model-vendor-profiles P3.4 — kimi
 * fullCompactionService 的零依赖移植）。
 *
 * 机制：真实 413/CONTEXT_WINDOW_EXCEEDED 被当作**窗口探针**——
 * `observed[model@channel] = floor(估算tokens × 0.85)`，此后该模型的
 * 压缩阈值取 **min(目录窗口, 观察值)**。目录说 1M 但端点实际只给
 * 128K 时，一次溢出即永久学会（会话内；kimi 原文如此，跨会话不持久）。
 *
 * 防误触谓词：估算必须 ≥ 0.5×effectiveMax——「图片过大」类单请求
 * 超限不是窗口信号，不该改学习值。
 */

export const OBSERVED_WINDOW_RATIO = 0.85;
/** 防误触谓词下限：估算低于有效窗口的一半时不学习（kimi 同构）。 */
export const OBSERVED_WINDOW_MIN_FRACTION = 0.5;

export type WindowObservation = {
  /** 观察到的可用窗口（tokens）。 */
  observedTokens: number;
  at: string;
};

type ChannelKey = string;

function keyOf(model: string, baseURL?: string): ChannelKey {
  let host = "";
  if (baseURL) {
    try {
      host = new URL(baseURL).hostname.toLowerCase();
    } catch {
      host = "";
    }
  }
  return `${host}|${model}`;
}

/** 会话内观察表（进程内存；不跨会话持久化——端点配置会变）。 */
const observed = new Map<ChannelKey, WindowObservation>();

/** 测试复位。 */
export function resetObservedWindows(): void {
  observed.clear();
}

/**
 * 记录一次溢出观察。返回 true 当这次观察**改变了**该模型的有效阈值
 * （观察值低于当前生效窗口）——调用方据此决定是否压缩后原地重试。
 */
export function recordObservedWindow(
  model: string,
  baseURL: string | undefined,
  estimatedTokens: number,
  effectiveMaxTokens: number
): boolean {
  // 防误触：估算太小不是窗口信号。
  if (effectiveMaxTokens <= 0) return false;
  if (estimatedTokens < effectiveMaxTokens * OBSERVED_WINDOW_MIN_FRACTION) return false;
  const observedTokens = Math.floor(estimatedTokens * OBSERVED_WINDOW_RATIO);
  if (observedTokens <= 0) return false;
  const key = keyOf(model, baseURL);
  const previous = observed.get(key);
  // 只收紧不放宽（同模型重复学习取更小值——保守）。
  if (previous && previous.observedTokens <= observedTokens) return false;
  observed.set(key, { observedTokens, at: new Date().toISOString() });
  return true;
}

/**
 * 该模型当前生效的压缩窗口：min(目录/注册表窗口, 观察值)。无观察 →
 * 原窗口（目录 fail-open 语义不变）。
 */
export function effectiveWindowTokens(model: string, baseURL: string | undefined, declaredTokens: number): number {
  const entry = observed.get(keyOf(model, baseURL));
  if (!entry) return declaredTokens;
  return Math.min(declaredTokens, entry.observedTokens);
}

/** 只读快照（诊断用）。 */
export function observedWindows(): ReadonlyMap<string, WindowObservation> {
  return observed;
}
