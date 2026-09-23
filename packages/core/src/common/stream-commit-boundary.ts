/**
 * 流式重试提交边界（specs/model-vendor-profiles P3.3 — MiniMax llm-retry
 * 「A visible delta is the retry commit boundary」的零依赖移植）。
 *
 * 问题（MiniMax 注释原文）：「Once callers can observe output, silently
 * replacing the physical request would either buffer the whole response or
 * replay duplicate content.」——流式响应什么时候还能安全重试？答案：**首
 * 个非空可见增量出现之前**。之后失败必须保持在已提交的尝试上（错误重放
 * 已缓冲事件再抛，绝不静默换一个物理请求）。
 *
 * 本模块是纯判定 + 事件分类；缓冲与重放机制由传输层实现（P3.3 首期落
 * 纯函数层——接入 createChatCompletionStream 的 reduce 循环属于后续增量）。
 */

export type StreamEventLike = {
  type?: string;
  /** OpenAI delta 形状（宽松读取）。 */
  delta?: {
    content?: unknown;
    reasoning_content?: unknown;
    reasoning?: unknown;
    tool_calls?: ReadonlyArray<unknown>;
  };
};

/** 该事件是否携带「调用方可见」的内容（= 提交边界）。 */
export function commitsOutput(event: StreamEventLike): boolean {
  const delta = event.delta;
  if (!delta) return false;
  if (typeof delta.content === "string" && delta.content.length > 0) return true;
  for (const field of ["reasoning_content", "reasoning"] as const) {
    const value = delta[field];
    if (typeof value === "string" && value.length > 0) return true;
  }
  if (Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0) return true;
  return false;
}

export type RetryDecision =
  | { committable: true } // 尚未提交 → 可静默重试（丢弃该物理请求）
  | { committable: false; reason: "committed" }; // 已提交 → 保持原请求，重放后抛

/**
 * 给定已缓冲的事件序列与刚发生的失败：是否仍可安全地丢弃该物理请求
 * 并重发。序列中**任一**事件已提交 → 不可（committed）。
 */
export function canSilentlyRetry(bufferedEvents: readonly StreamEventLike[]): RetryDecision {
  const committed = bufferedEvents.some((event) => commitsOutput(event));
  return committed ? { committable: false, reason: "committed" } : { committable: true };
}
