/**
 * 端点试探状态（specs/model-vendor-profiles §design 五 / P0.7–P0.8）。
 *
 * 白名单模型的 A 类（wire 可见）优化**乐观应用**；端点产生**可归因拒绝**
 * （HTTP 400 类且非 auth/quota/限流/溢出——那些绝不判为「优化被拒」）时，
 * 对该 `(通道, 模型)` 记禁用并**同轮以默认形态重发一次**。
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

/** `(channel|model)` → true（该组合的 wire 优化已被端点拒绝）。 */
const rejected = new Set<string>();

export interface ProbeEvent {
  model: string;
  channel: string;
  evidence: string;
  at: string;
}

/** 结构化降级日志缓冲（drain 后清空；主进程写日志/遥测用）。 */
const events: ProbeEvent[] = [];

/**
 * 是否仍应对该 (模型, 通道) 应用 A 类 wire 优化。
 * 未记录过拒绝 → true（乐观）；记录过 → false（降级到默认形态）。
 */
export function shouldApplyWireOptimizations(model: string, baseURL?: string): boolean {
  return !rejected.has(`${channelKeyOf(baseURL)}|${model}`);
}

/**
 * 记录一次可归因拒绝：此后该 (通道, 模型) 的 wire 优化在本进程内禁用。
 * @returns true 若是首次记录（调用方据此决定是否同轮重发一次）。
 */
export function recordWireOptimizationRejection(model: string, baseURL: string | undefined, evidence: string): boolean {
  const key = `${channelKeyOf(baseURL)}|${model}`;
  if (rejected.has(key)) return false;
  rejected.add(key);
  events.push({ model, channel: channelKeyOf(baseURL), evidence, at: new Date().toISOString() });
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

/** 测试/新用户轮次复位（探针拒绝随用户轮次过期——端点配置可能已变）。 */
export function resetWireProbe(): void {
  rejected.clear();
}
