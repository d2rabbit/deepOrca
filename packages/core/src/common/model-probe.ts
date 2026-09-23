/**
 * 端点试探状态（specs/model-vendor-profiles §design 五 / P0.7–P0.8）。
 *
 * 白名单模型的 A 类（wire 可见）优化**乐观应用**；端点产生**可归因拒绝**
 * （HTTP 400 类且非 auth/quota/限流/溢出——那些绝不判为「优化被拒」）时，
 * 对该 `(通道,模型[,维度])` 记禁用并**同轮以默认形态重发一次**。
 *
 * 维度级记账（backlog 落地）：拒绝消息**点名了我们补过的字段**（thinking /
 * reasoning_effort / enable_thinking）→ 只禁该维度；**点名了与补丁无关的
 * 字段**（tools / temperature / max_tokens…）→ 不记账（S1-F2：那不是优化
 * 的锅，同轮原样重发必然再 400）；认不出 → 通配保守（禁用全部维度）。
 *
 * 会话内内存记账（首期不做跨会话持久化——端点配置会变）；记录后的
 * 降级在**进程内存活**，并随新用户轮次重新乐观试探（{@link resetWireProbe}
 * ——端点可能在两轮之间被修复）。诊断经 {@link drainProbeEvents} 输出。
 */

import { classifyLlmError, getLlmErrorDetails } from "./llm-error";

/**
 * 通道键：规范化 baseURL 全串（去尾斜杠）。host 级粒度不够——同一厂商
 * 的不同路径入口（如 stepfun `/v1` 与 `/step_plan/v1`）可能是不同网关栈，
 * 一处的拒绝不应波及另一处的乐观试探。无 baseURL 时用 ""——同一进程内
 * 仍按模型区分。
 */
function channelKeyOf(baseURL: string | undefined): string {
  if (!baseURL) return "";
  try {
    return new URL(baseURL).toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

/** wire 优化维度：目前仅 thinking 族补丁；后续维度（如缓存锚形状）在此扩。 */
export type WireDimension = "thinking";
/** "*" = 通配（归因不出具体维度的保守记账——禁用该 (通道,模型) 全部维度）。 */
export type WireDimensionOrWildcard = WireDimension | "*";

/** `(channel|model[*|dimension])` → true（该组合的 wire 优化已被端点拒绝）。 */
const rejected = new Set<string>();

export interface ProbeEvent {
  model: string;
  channel: string;
  /** "*" 或具体维度。 */
  dimension: WireDimensionOrWildcard;
  evidence: string;
  at: string;
}

/** 结构化降级日志缓冲（drain 后清空；主进程写日志/遥测用）。 */
const events: ProbeEvent[] = [];

/**
 * 是否仍应对该 (模型, 通道[, 维度]) 应用 A 类 wire 优化。
 * 通配（"*"）被记 → 全禁；仅某维度被记 → 只禁该维度；未记录 → true（乐观）。
 */
export function shouldApplyWireOptimizations(model: string, baseURL?: string, dimension?: WireDimension): boolean {
  const channel = channelKeyOf(baseURL);
  if (rejected.has(`${channel}|${model}|*`)) return false;
  if (dimension && rejected.has(`${channel}|${model}|${dimension}`)) return false;
  return true;
}

/**
 * 记录一次可归因拒绝：此后该 (通道, 模型[, 维度]) 的 wire 优化在本进程内禁用。
 * @returns true 若是该键首次记录（调用方据此决定是否同轮重发一次）。
 */
export function recordWireOptimizationRejection(
  model: string,
  baseURL: string | undefined,
  evidence: string,
  dimension: WireDimensionOrWildcard = "*"
): boolean {
  const key = `${channelKeyOf(baseURL)}|${model}|${dimension}`;
  if (rejected.has(key)) return false;
  rejected.add(key);
  events.push({
    model,
    channel: channelKeyOf(baseURL),
    dimension,
    evidence,
    at: new Date().toISOString(),
  });
  return true;
}

/** 取出并清空降级事件（每次请求收尾或会话收尾时调用）。 */
export function drainProbeEvents(): ProbeEvent[] {
  if (events.length === 0) return [];
  return events.splice(0, events.length);
}

/** 测试复位。 */
export function resetWireOptimizationProbe(): void {
  rejected.clear();
  events.length = 0;
}

/**
 * ★ 可归因拒绝判定（试探成败的关键，R4/R5）：
 * 仅认 HTTP 400 类（status 400 / 422，或 OpenAI `invalid_request_error` 类型）
 * 且**不属于** auth / quota / 限流 / 上下文溢出 / 服务端 / 超时 /
 * 瞬态——那些类别与「我们多发的优化字段」无关，绝不触发降级。
 */
export function isAttributableRejection(error: unknown): boolean {
  const details = getLlmErrorDetails(error);
  if (details.status !== 400 && details.status !== 422) {
    // OpenAI SDK 有时把 400 包成无 status 的 APIError + type 字段。
    if (details.type !== "invalid_request_error") return false;
  }
  // 语义类别复核：命中任何已知非归因类别 → 不是「优化被拒」。
  const category = classifyLlmError(error);
  return category === "UNKNOWN";
}

/**
 * ★ 归因精确化（维度级记账的判定核心）：
 * 在拒绝消息里找「补丁字段名」与「已知无关字段名」。
 *   - 点名无关字段（tools/temperature/max_tokens/messages/response_format）
 *     → `unrelated`：不是补丁的锅，绝不记账（S1-F2 误禁消除）；
 *   - 点名思考族字段（thinking/reasoning_effort/enable_thinking/reasoning）
 *     → `dimension: "thinking"`：精确禁用该维度；
 *   - 都不匹配 → `unknown`：保守通配（禁用全部维度）。
 * unrelated 先判：一条消息同时点名两类字段时，无关字段的存在说明拒绝
 * 面不止补丁，按不记账处理（重发同请求无意义）。
 */
export type RejectionAttribution =
  | { kind: "dimension"; dimension: WireDimension }
  | { kind: "unrelated" }
  | { kind: "unknown" };

const UNRELATED_FIELD_PATTERN =
  /\b(tools?|tool_calls|temperature|top_p|max_tokens|max_completion_tokens|messages|response_format|stream)\b/i;
// 思考族字段（thinking / enable_thinking / reasoning_effort / reasoning.*）
// 在错误消息里出现任一片段即算点名——enable_thinking 里的下划线让 \b 失效，
// 所以用词干匹配。
const THINKING_FIELD_PATTERN = /\b(think|reason)/i;

export function matchRejectionAttribution(error: unknown): RejectionAttribution {
  const details = getLlmErrorDetails(error);
  const message = `${details.message ?? ""} ${details.type ?? ""}`;
  if (UNRELATED_FIELD_PATTERN.test(message)) return { kind: "unrelated" };
  if (THINKING_FIELD_PATTERN.test(message)) return { kind: "dimension", dimension: "thinking" };
  return { kind: "unknown" };
}

/** 测试/新用户轮次复位（探针拒绝随用户轮次过期——端点配置可能已变）。 */
export function resetWireProbe(): void {
  rejected.clear();
}
