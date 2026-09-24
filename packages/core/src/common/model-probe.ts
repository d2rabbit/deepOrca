/**
 * 端点试探状态（specs/model-vendor-profiles §design 五 / P0.7–P0.8）。
 *
 * 白名单模型的 A 类（wire 可见）优化**乐观应用**；端点产生**可归因拒绝**
 * （HTTP 400 类且非 auth/quota/限流/溢出——那些绝不判为「优化被拒」）时，
 * 对该 `(通道,模型[,维度])` 记禁用并**同轮以默认形态重发一次**。
 *
 * 维度级记账：拒绝消息**点名了我们补过的字段**（thinking /
 * reasoning_effort / enable_thinking）→ 只禁该维度；**点名了与补丁无关的
 * 字段**（tools / temperature / max_tokens…）→ 不记账（S1-F2：那不是优化
 * 的锅，同轮原样重发必然再 400）；认不出 → 通配保守。
 *
 * 会话内内存记账（不跨会话持久化——端点配置会变）；记录后的降级随**该
 * 会话**的新用户轮次重新乐观试探（{@link resetWireProbe}——端点可能在
 * 两轮之间被修复）。降级诊断经调用方 `logRoutingEvent(stage:"probe")`
 * 走 host 注入的 routing logger。
 */

import { classifyLlmError, getLlmErrorDetails } from "./llm-error";

/**
 * 通道键：origin + path（剥 query/hash，去尾斜杠）。host 级粒度不够——
 * 同一厂商的不同路径入口（如 stepfun `/v1` 与 `/step_plan/v1`）可能是
 * 不同网关栈，一处的拒绝不应波及另一处的乐观试探。剥 query 是安全要求
 * （round-4 L12）：OpenAI 兼容生态常见 key-in-query 约定（?key=…），
 * 通道键会进日志 detail——query 一律不入键、不入日志。无 baseURL 时用
 * ""——同一进程内仍按模型区分。
 */
function channelKeyOf(baseURL: string | undefined): string {
  if (!baseURL) return "";
  try {
    const url = new URL(baseURL);
    return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
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
 * 记账。round-4 M7：读路径**不物化**空 Set（否则每个发起过请求的会话——
 * 含即建即删的静默 subagent——都在模块级 Map 里永久占位）；会话删除时由
 * deleteSession 显式清桶。无 sessionId 的调用（测试/辅助）落 "" 桶。
 */
const rejectedBySession = new Map<string, Set<string>>();

/**
 * 是否仍应对该 (模型, 通道[, 维度]) 应用 A 类 wire 优化。
 * 通配（"*"）被记 → 全禁；仅某维度被记 → 只禁该维度；未记录 → true（乐观）。
 *
 * round-4 H5：**无 sessionId 的查询读全部桶的联合**——辅助调用（技能匹配/
 * 分解/depth/后台）拿不到会话坐标，若只读 "" 桶则任何会话的 veto 对它们
 * 都不可见，整会话持续重发已证伪形状（G5 引入的覆盖回归）。联合读让无坐标
 * 消费方尊重任一会话学到的端点证据；各会话的按轮过期/删除清桶语义不变
 * （最后一个持有者过期后辅助调用也随之重新乐观）。
 */
export function shouldApplyWireOptimizations(
  model: string,
  baseURL?: string,
  dimension?: WireDimension,
  sessionId?: string
): boolean {
  const channel = channelKeyOf(baseURL);
  const wildcardKey = `${channel}|${model}|*`;
  const dimensionKey = dimension ? `${channel}|${model}|${dimension}` : null;
  const buckets =
    sessionId !== undefined
      ? [rejectedBySession.get(sessionId)]
      : [rejectedBySession.get(""), ...rejectedBySession.values()];
  for (const bucket of buckets) {
    if (!bucket) continue;
    if (bucket.has(wildcardKey)) return false;
    if (dimensionKey && bucket.has(dimensionKey)) return false;
  }
  return true;
}

/**
 * 记录一次可归因拒绝：此后该 (通道, 模型[, 维度]) 的 wire 优化在本会话内禁用。
 * @returns true 若是该键首次记录（调用方据此决定是否同轮重发一次）。
 */
export function recordWireOptimizationRejection(
  model: string,
  baseURL: string | undefined,
  evidence: string,
  dimension: WireDimensionOrWildcard = "*",
  sessionId?: string
): boolean {
  const bucketKey = sessionId ?? "";
  let rejected = rejectedBySession.get(bucketKey);
  if (!rejected) {
    rejected = new Set<string>();
    rejectedBySession.set(bucketKey, rejected);
  }
  const key = `${channelKeyOf(baseURL)}|${model}|${dimension}`;
  if (rejected.has(key)) return false;
  rejected.add(key);
  return true;
}

/**
 * 新用户轮次复位（探针拒绝随用户轮次过期——端点配置可能已变）。
 * round-3 G5：只清**当前会话**的记账；round-4 H1：`undefined` 与其它两个
 * 函数的语义对齐——只清 "" 桶（进程级全清曾是 G5 修复的复活洞：新会话
 * 首条消息 activeSessionId=null → ?? undefined → 误清所有会话）。
 */
export function resetWireProbe(sessionId?: string): void {
  rejectedBySession.delete(sessionId ?? "");
}

/** 测试复位（清全部会话桶）。 */
export function resetWireOptimizationProbe(): void {
  rejectedBySession.clear();
}

// ── 请求来源标记（round-3 G4）──────────────────────────────────────────────
// 失败请求自身的 (model, baseURL) 由 createChatCompletionStream 的错误路径
// 盖上——上层探针记账据此按键，不再用 catch 处主客户端的坐标（失败可能
// 来自压缩的跨模型请求，错键会把 veto 记到无辜模型头上）。

export interface LlmRequestOrigin {
  model: string;
  baseURL: string | undefined;
}

const ORIGIN_SYMBOL = Symbol.for("deeporca.llmRequestOrigin");

export function stampLlmRequestOrigin(error: unknown, model: string, baseURL: string | undefined): void {
  // round-4 H6：空 model 不盖章（空章会抑制 lifecycle 的主客户端回退，
  // 让该类请求的可归因 400 静默不记 veto）。
  if (!model) return;
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
