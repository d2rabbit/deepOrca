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

/**
 * `(channel|model[*|dimension])` → true（该组合的 wire 优化已被端点拒绝）。
 *
 * round-3 G5：记账按**会话隔离**（Map<sessionId, Set<key>>）——此前是进程级
 * 全局 Set，任一会话的用户轮（resetWireProbe）会清掉其它会话刚记的坏端点
 * 记账，导致该会话逐请求重燃必败补丁（S2-F3 熔断 per-session 化的同款
 * 先例）。无 sessionId 的调用（测试/辅助）落 "" 桶。
 */
const rejectedBySession = new Map<string, Set<string>>();

function rejectedSetOf(sessionId: string | undefined): Set<string> {
  const key = sessionId ?? "";
  let set = rejectedBySession.get(key);
  if (!set) {
    set = new Set<string>();
    rejectedBySession.set(key, set);
  }
  return set;
}

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
export function shouldApplyWireOptimizations(
  model: string,
  baseURL?: string,
  dimension?: WireDimension,
  sessionId?: string
): boolean {
  const rejected = rejectedSetOf(sessionId);
  const channel = channelKeyOf(baseURL);
  if (rejected.has(`${channel}|${model}|*`)) return false;
  if (dimension && rejected.has(`${channel}|${model}|${dimension}`)) return false;
  return true;
}

/** 事件缓冲上限（环形丢弃最旧）：长命进程内拒绝事件有界（swarm round-2 F10）。 */
const EVENTS_LIMIT = 64;

/**
 * 记录一次可归因拒绝：此后该 (通道, 模型[, 维度]) 的 wire 优化在本进程内禁用。
 * @returns true 若是该键首次记录（调用方据此决定是否同轮重发一次）。
 */
export function recordWireOptimizationRejection(
  model: string,
  baseURL: string | undefined,
  evidence: string,
  dimension: WireDimensionOrWildcard = "*",
  sessionId?: string
): boolean {
  const rejected = rejectedSetOf(sessionId);
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
  if (events.length > EVENTS_LIMIT) events.splice(0, events.length - EVENTS_LIMIT);
  return true;
}

/** 取出并清空降级事件（每次请求收尾或会话收尾时调用）。 */
export function drainProbeEvents(): ProbeEvent[] {
  if (events.length === 0) return [];
  return events.splice(0, events.length);
}

/** 测试复位。 */
export function resetWireOptimizationProbe(): void {
  rejectedBySession.clear();
  events.length = 0;
}

// ── 请求来源标记（round-3 G4）──────────────────────────────────────────────
// 失败请求自身的 (model, baseURL) 由 createChatCompletionStream 的 create
// 错误路径盖上——上层探针记账据此按键，不再用 catch 处主客户端的坐标
//（失败可能来自压缩/后台的跨模型请求，错键会把 veto 记到无辜模型头上）。

export interface LlmRequestOrigin {
  model: string;
  baseURL: string | undefined;
}

const ORIGIN_SYMBOL = Symbol.for("deeporca.llmRequestOrigin");

export function stampLlmRequestOrigin(error: unknown, model: string, baseURL: string | undefined): void {
  if (!(error instanceof Error)) return;
  (error as Error & { [ORIGIN_SYMBOL]?: LlmRequestOrigin })[ORIGIN_SYMBOL] = { model, baseURL };
}

export function readLlmRequestOrigin(error: unknown): LlmRequestOrigin | null {
  if (!(error instanceof Error)) return null;
  const origin = (error as Error & { [ORIGIN_SYMBOL]?: LlmRequestOrigin })[ORIGIN_SYMBOL];
  return origin ?? null;
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
 *   - 点名思考族字段（thinking / enable_thinking / reasoning_effort /
 *     reasoning）→ `dimension: "thinking"`：精确禁用该维度并同轮重发；
 *   - 仅点名无关字段（tools/temperature/max_tokens/messages/response_format）
 *     → `unrelated`：不是补丁的锅，不记账不重发（S1-F2 误禁消除）；
 *   - 都不匹配 → `unknown`：保守通配（禁用全部维度）。
 * 思考字段**先判**（swarm round-2 F3 修正）：混合措辞（"enable_thinking
 * cannot be used together with tools"）说明补丁在拒绝面内——禁用补丁后
 * 重发可能直接修复；若按 unrelated 跳过，该会话将每轮必败且永不自愈。
 * 最坏情形（真正肇因是 tools）：多付一次必败重试后错误照常上抛，代价
 * 有界。字段匹配用**精确词形**（两端 \b，含下划线全名）——swarm round-2
 * F4：词干匹配会把 "no valid reason given" 之类散文误归 thinking。
 */
export type RejectionAttribution =
  | { kind: "dimension"; dimension: WireDimension }
  | { kind: "unrelated" }
  | { kind: "unknown" };

const UNRELATED_FIELD_PATTERN =
  /\b(tools?|tool_calls|temperature|top_p|max_tokens|max_completion_tokens|messages|response_format|stream)\b/i;
const THINKING_FIELD_PATTERN = /\b(enable_thinking|thinking|reasoning_effort|reasoning)\b/i;

export function matchRejectionAttribution(error: unknown): RejectionAttribution {
  const details = getLlmErrorDetails(error);
  const message = `${details.message ?? ""} ${details.type ?? ""}`;
  if (THINKING_FIELD_PATTERN.test(message)) return { kind: "dimension", dimension: "thinking" };
  if (UNRELATED_FIELD_PATTERN.test(message)) return { kind: "unrelated" };
  return { kind: "unknown" };
}

/**
 * 新用户轮次复位（探针拒绝随用户轮次过期——端点配置可能已变）。
 * round-3 G5：只清**当前会话**的记账——进程级全清会让其它活跃会话的坏
 * 端点记账被无关用户轮抹掉，该会话逐请求重燃必败补丁。
 */
export function resetWireProbe(sessionId?: string): void {
  if (sessionId === undefined) {
    rejectedBySession.clear();
    return;
  }
  rejectedBySession.delete(sessionId);
}
