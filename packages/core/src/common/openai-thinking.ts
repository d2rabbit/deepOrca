import type { ReasoningEffort } from "../settings";
import { mapThinkLevel } from "./think-level";
import { resolveModelSpec, type ThinkingProtocolId } from "./model-capabilities";
import { resolveModelProfile } from "./model-profile";
import { catalogLookupModel } from "./model-catalog";
import { shouldApplyWireOptimizations } from "./model-probe";
import { compileOptionMap } from "./option-map";
import { logRoutingEvent } from "../routing/telemetry";

type ThinkingConfig = {
  type: "enabled" | "disabled";
};

type ThinkingRequestOptions = {
  thinking?: ThinkingConfig;
  extra_body?: {
    reasoning_effort?: ReasoningEffort;
  };
  /** StepFun-style TOP-LEVEL effort param (`/v1/chat/completions` accepts
   *  `reasoning_effort` directly — unlike DeepSeek it has no `thinking`
   *  envelope, and the nested extra_body form never reaches the wire). The
   *  OpenAI SDK types this field as the low/medium/high triple, so the value
   *  is narrowed before it can be spread into a typed create() call. */
  reasoning_effort?: "low" | "medium" | "high";
};

type ThinkingBuilder = (thinkingEnabled: boolean, reasoningEffort: ReasoningEffort) => ThinkingRequestOptions;

// Per-family request shapes, keyed by `ModelFamilySpec.thinkingProtocol`.
// `deepseek` and `unknown` are byte-identical today — the table exists so new
// families (S1–S4) can diverge without touching any other entry.
const openAiCompatibleBuilder: ThinkingBuilder = (thinkingEnabled, reasoningEffort) => ({
  thinking: { type: thinkingEnabled ? "enabled" : "disabled" },
  ...(thinkingEnabled ? { extra_body: { reasoning_effort: reasoningEffort } } : {}),
});

// StepFun (step-3.7-flash): reasoning cannot be turned OFF — the API's only
// control is reasoning_effort low/medium/high — so the app's thinking-off
// projects onto `low` (the honest weakest tier), and ON sends the mapped tier
// as a top-level param. No `thinking` envelope: that is DeepSeek's param shape
// and Step's compatibility layer neither needs nor documents it. The clamp
// mirrors the stepfun family map (xhigh/max fold to high) so a model-less call
// site can never leak a tier the API rejects.
const stepfunEffort = (level: ReasoningEffort): "low" | "medium" | "high" =>
  level === "low" || level === "medium" ? level : "high";

const stepfunBuilder: ThinkingBuilder = (thinkingEnabled, reasoningEffort) => ({
  reasoning_effort: thinkingEnabled ? stepfunEffort(reasoningEffort) : "low",
});

const THINKING_BUILDERS: Partial<Record<ThinkingProtocolId, ThinkingBuilder>> = {
  deepseek: openAiCompatibleBuilder,
  stepfun: stepfunBuilder,
  unknown: openAiCompatibleBuilder,
};

/**
 * 统一出口：所有调用方只展开结果进请求体（`...thinkingOptions`），从不
 * 读字段——所以 data-driven map 形状（含 enable_thinking / reasoning 等
 * builder 类型之外的拼写）可以无损通行。
 */
export function buildThinkingRequestOptions(
  thinkingEnabled: boolean,
  baseURL?: string,
  reasoningEffort: ReasoningEffort = "high",
  model?: string,
  sessionId?: string
): Record<string, unknown> {
  const spec = resolveModelSpec({ model: model ?? "", baseURL });
  const builder = THINKING_BUILDERS[spec.thinkingProtocol] ?? openAiCompatibleBuilder;
  // Unified tier → the family's native effort tiers (identity fallback for
  // unregistered families; DeepSeek folds medium/xhigh into high server-side
  // — common/think-level.ts).
  const nativeEffort = mapThinkLevel(spec.id, reasoningEffort) as ReasoningEffort;
  // specs/model-vendor-profiles P0.2: catalog-derived thinkingMandatory —
  // whitelist models whose effort ladder has no off value (qwen3.8-max-preview,
  // glm-5.3, MiniMax-M3.1 …) reject the disabled shape with a 400, so never
  // emit it on the wire. deepseek/stepfun behavior is unchanged (their
  // builders either already force-enable or the catalog has none/off values).
  // swarm round-3 G1 修正：mandatory 是**目录实证的保护**（该端点发 disabled
  // 必 400），不受探针 veto 影响——veto 只该解除「优化补丁」，把保护也
  // 解除会让 veto 后的同轮重发携带目录已证伪的 disabled 形状，二次 400
  // 后整轮死。veto 真正作用的对象只有 map/补丁应用（下方 mapSource 门）。
  const profile = model ? resolveModelProfile({ model, catalogEntry: catalogLookupModel(model) }) : null;
  const mandatory = profile?.wire.thinkingMandatory === true;
  const probeAllowsThinking = shouldApplyWireOptimizations(model ?? "", baseURL, "thinking", sessionId);
  const effectiveEnabled = mandatory ? true : thinkingEnabled;
  // 强制思考 + 用户关思考 → 投影到该家族的「关闭等效」最弱档
  // （stepfun off→low；glm-5.3 系端点无 off 档 → 保持用户档位）。
  let effectiveEffort = nativeEffort;
  if (mandatory && !thinkingEnabled && profile?.wire.offEffort) {
    effectiveEffort = mapThinkLevel(spec.id, profile.wire.offEffort as ReasoningEffort) as ReasoningEffort;
  }

  // P3.1 后半（数据驱动形状）：白名单画像声明了 reasoningLevel 选项映射 →
  // 编译（memo）后用本轮冻结的档位求值，**替代**代码 builder——map 与
  // builder 是同一能力的两种形态，二者只走其一，绝不叠加写同名字段。
  const hasMap = profile?.matchedBy === "model" && profile.wire.optionMaps?.reasoningLevel !== undefined;
  const mapSource = hasMap && probeAllowsThinking ? profile?.wire.optionMaps?.reasoningLevel : undefined;
  if (mapSource) {
    try {
      // 输入用 effective 态（mandatory 已把关思考抬成开），否则不可关模型
      // 上关思考仍会把 disabled 形状发给端点。
      const level = effectiveEnabled ? effectiveEffort : "disabled";
      return compileOptionMap(mapSource).evaluate(level);
    } catch (error) {
      // fail-open：坏配置绝不杀会话。round-4 M9：坏 map（编译/求值失败）
      // 与 veto 同样落「不发思考键」，但必须留下观测痕迹——否则思考开关
      // 静默消失且无案可查（手工维护的 DSL 串一处笔误即整族失效）。
      logRoutingEvent({
        stage: "option-map",
        outcome: "fallback",
        detail: `${model ?? ""}: option map failed (${error instanceof Error ? error.message : String(error)}) — no thinking keys emitted`,
      });
    }
  }
  // round-4 H2/H3（统一回落矩阵）：veto 生效 → 一律「不发任何思考键」，
  // 不分 map/builder、不分 mandatory。三条理由：①`{}` 不是 disabled 形状，
  // G1 的「mandatory 绝不发目录证伪形状」继续成立（服务端默认兜底）；
  // ②重试形状保证与被拒请求不同——round-3 的 mandatory+无map 组合（qwen
  // 系）会重发**逐字节相同**的请求，二连 400 后整轮死且 probeFallback
  // 文案撒谎；③mandatory+map 组合（glm-5.3 快照实测）round-3 会落回
  // 「从未被该端点验证」的通用 builder 信封——正是 G2 要避免的形状。
  if (!probeAllowsThinking) return {};
  return builder(effectiveEnabled, effectiveEffort);
}
