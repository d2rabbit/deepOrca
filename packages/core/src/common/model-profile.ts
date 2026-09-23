/**
 * 模型厂商画像与专属优化 — 匹配层（specs/model-vendor-profiles）。
 *
 * 定位：**白名单制**的模型 → 专属优化画像解析器。2026-09-22 用户终版拍板：
 * 仅白名单内的本代官方端点型号享受家族专属优化；白名单外的一切模型
 * （同端点其它型号、未来代、权重版本）**全部走兜底**（与今日行为一致）。
 *
 * HARD CONSTRAINT: 零依赖（不 import 任何模块，含 model-catalog）——目录
 * 条目与通道信息由调用方注入，保持本模块可进 renderer bundle
 * （`@deeporca/core/capabilities` 子路径同规格）。
 *
 * 五段命中（家族/子家族判定只看模型串与注入的目录 `family` 字段，
 * 不读取 baseURL/端点/节点）：
 *   ⓪ 别名层   kimi-for-coding 等稳定别名 → 代际由运行时目录元数据定
 *   ① 具名层   精确型号白名单（本代官方端点型号）
 *   ② 家族层   白名单所属家族的兜底 pattern（同家族新型号按保守默认）
 *   ③ UNKNOWN  保守默认（全策略关闭 = 兜底）
 *
 * 白名单来源（requirements 支持矩阵，2026-09-22 用户拍板）：
 *   - MiniMax-M3.1 暂时隐藏（未正式发布，不入单）
 *   - qwen3.8 官方端点仅 flash / max / plus / max-preview
 *   - 其余家族按四期调研的本代型号登记
 */

import type { CatalogModelEntry } from "./model-catalog";

export type ModelVendorId = "deepseek" | "stepfun" | "kimi" | "minimax" | "qwen" | "mimo" | "glm" | "unknown";

/** A 类：wire 可见优化（受端点试探约束）。 */
export type ProfileWire = {
  /** 思考不可关闭（发关闭态会被端点 400）。 */
  thinkingMandatory?: boolean;
  /** 「关闭」态投影到的档位（关不掉就投最弱档）。 */
  offEffort?: string;
  /** 该模型接受的 effort 档位值（菜单与合法性校验；无目录则 undefined）。 */
  effortValues?: readonly string[];
  /** 流式 reasoning 的字段回退链（含数组形状时取 summary）。 */
  reasoningReadFields?: readonly string[];
};

/** B 类：纯本地优化（模型匹配即生效，不参与试探）。 */
export type ProfileLocal = {
  /** 工具文本通道兜捞是否启用 + 散文占比守卫（0=不守卫）。 */
  toolTextFallback?: { enabled: boolean; proseRatioGuard: number };
};

export type ModelProfile = {
  vendor: ModelVendorId;
  /** "model" = 命中白名单/别名；"family" = 命中家族 pattern（白名单外，保守默认）；"fallback" = UNKNOWN 兜底。 */
  matchedBy: "model" | "family" | "fallback";
  /** A 类（仅 matchedBy==="model" 时有意义）。 */
  wire: ProfileWire;
  /** B 类（仅 matchedBy==="model" 时有意义）。 */
  local: ProfileLocal;
  /** 证据来源（仓库/文件:行号 或目录字段）。 */
  evidence: readonly string[];
};

/** 别名 → 所属家族（代际由运行时目录元数据定，见 resolveModelProfile）。 */
const ALIASES: Readonly<Record<string, ModelVendorId>> = {
  "kimi-for-coding": "kimi",
  "kimi-code": "kimi",
  "kimi-coding": "kimi",
};

/**
 * 具名白名单（2026-09-22 用户拍板的支持矩阵）。
 * 大小写不敏感比对（trim + toLowerCase；MiniMax 官方 id 为 PascalCase）。
 */
const WHITELIST: Readonly<Record<string, ModelVendorId>> = {
  // deepseek（本代：V4 / V4.1，全 1M）
  "deepseek-flash": "deepseek",
  "deepseek-v4-flash": "deepseek",
  "deepseek-v4-pro": "deepseek",
  "deepseek-v4-flash-vision-exp": "deepseek",
  // stepfun（本代：step-5 1M + 既有 3.7/路由）
  "step-5-preview": "stepfun",
  "step-3.7-flash": "stepfun",
  "step-router-v1": "stepfun",
  // kimi（断代线：k2.7-code 与 K3；k2.5/k2.6 旧代不入单）
  "kimi-k3": "kimi",
  "kimi-k2.7-code": "kimi",
  "kimi-k2.7-code-highspeed": "kimi",
  // minimax（M3.1 隐藏未发布——不入单；M2 全系旧代不入单）
  "minimax-m3": "minimax",
  // qwen（官方端点两款 + plus；权重版本 id 不入单）
  "qwen3.8-flash": "qwen",
  "qwen3.8-max": "qwen",
  "qwen3.8-plus": "qwen",
  "qwen3.8-max-preview": "qwen",
  // glm（5.3 系本代；5.2 及更早不入单）
  "glm-5.3": "glm",
  "glm-5.3-flash": "glm",
  "glm-5.3-flashx": "glm",
  "glm-5.3-highspeed": "glm",
  // mimo（v2.5/v2.6 一代 1M 系；v2-flash / v2-omni 旧代不入单）
  "mimo-v2.5": "mimo",
  "mimo-v2.5-pro": "mimo",
  "mimo-v2.5-pro-ultraspeed": "mimo",
  "mimo-v2.6-pro": "mimo",
  "mimo-v2.6-pro-ultraspeed": "mimo",
  "mimo-v2.6-flash": "mimo",
};

/** 家族兜底 pattern：白名单外、但明确属于该家族的型号 → 保守默认（无专属优化）。 */
const FAMILY_PATTERNS: ReadonlyArray<{ vendor: ModelVendorId; pattern: RegExp }> = [
  { vendor: "deepseek", pattern: /^deepseek-/i },
  { vendor: "stepfun", pattern: /^step-/i },
  { vendor: "kimi", pattern: /^kimi-/i },
  { vendor: "minimax", pattern: /^minimax-/i },
  { vendor: "qwen", pattern: /^qwen/i },
  { vendor: "mimo", pattern: /^mimo/i },
  { vendor: "glm", pattern: /^glm/i },
];

/** 各家族 B 类本地策略（仅白名单命中时生效；evidence 见调研报告）。 */
const LOCAL_POLICIES: Partial<Record<ModelVendorId, ProfileLocal>> = {
  qwen: { toolTextFallback: { enabled: true, proseRatioGuard: 0.8 } },
};

/** 各家族 A 类静态策略（目录派生值优先叠加）。 */
const WIRE_POLICIES: Partial<Record<ModelVendorId, ProfileWire>> = {
  stepfun: { offEffort: "low" }, // 思考不可关，off 投影 low（openai-thinking stepfunBuilder 既有行为）
  kimi: { reasoningReadFields: ["reasoning_content", "reasoning_details", "reasoning"] },
  minimax: { reasoningReadFields: ["reasoning_content", "reasoning_details", "reasoning"] },
};

const EMPTY_PROFILE: ModelProfile = {
  vendor: "unknown",
  matchedBy: "fallback",
  wire: {},
  local: {},
  evidence: [],
};

/** 目录派生：思考是否不可关（reasoning 且档位值全不含 none/off/disabled）。 */
export function thinkingMandatoryFromCatalog(entry?: CatalogModelEntry | null): boolean {
  if (!entry || !entry.reasoning || !entry.reasoningOptions || entry.reasoningOptions.length === 0) return false;
  const efforts = entry.reasoningOptions.filter((o): o is Extract<typeof o, { type: "effort" }> => o.type === "effort");
  if (efforts.length === 0) return false;
  return efforts.every(
    (o) => !o.values.includes("none") && !o.values.includes("off") && !o.values.includes("disabled")
  );
}

/** 目录派生：effort 档位值集合（首个 effort 项）。 */
export function catalogEffortValues(entry?: CatalogModelEntry | null): readonly string[] | undefined {
  if (!entry?.reasoningOptions) return undefined;
  const efforts = entry.reasoningOptions.filter((o): o is Extract<typeof o, { type: "effort" }> => o.type === "effort");
  return efforts[0]?.values;
}

/**
 * 模型 → 专属优化画像。纯函数、零依赖。
 *
 * @param input.model        模型串（唯一匹配依据；别名/白名单/pattern 三段）
 * @param input.catalogEntry 可选目录条目（能力派生与别名的代际解析；不参与家族判定）
 */
export function resolveModelProfile(input: { model: string; catalogEntry?: CatalogModelEntry | null }): ModelProfile {
  const trimmed = (input.model ?? "").trim();
  if (!trimmed) return EMPTY_PROFILE;

  // ⓪ 别名层：稳定别名（同 id 换模型的运营模式）→ 家族归属固定，
  //    代际与能力由调用方注入的目录元数据定（A 类按目录派生；目录不可用则仅家族保守项）。
  const aliasVendor = ALIASES[trimmed.toLowerCase()];
  if (aliasVendor) {
    return {
      vendor: aliasVendor,
      matchedBy: "model",
      wire: wireFor(aliasVendor, input.catalogEntry),
      local: LOCAL_POLICIES[aliasVendor] ?? {},
      evidence: [
        "别名层：kimi acp-server/model-catalog.ts:45 TOGGLEABLE_THINKING_MODELS（第一方稳定别名模式）",
        ...(input.catalogEntry ? ["目录元数据（运行时）定代际"] : ["目录不可用 → 家族保守项 + 全维试探"]),
      ],
    };
  }

  // ① 具名白名单（大小写不敏感；MiniMax PascalCase 官方 id 由此命中）。
  const key = trimmed.toLowerCase();
  const whitelistVendor = WHITELIST[key] ?? WHITELIST[trimmed];
  if (whitelistVendor) {
    return {
      vendor: whitelistVendor,
      matchedBy: "model",
      wire: wireFor(whitelistVendor, input.catalogEntry),
      local: LOCAL_POLICIES[whitelistVendor] ?? {},
      evidence: [`白名单（specs/model-vendor-profiles requirements 支持矩阵 2026-09-22）`],
    };
  }

  // ② 家族 pattern：明确属于某家族但不在白名单（旧代/未来代）→ 保守默认，无专属优化。
  const family = FAMILY_PATTERNS.find((f) => f.pattern.test(trimmed));
  if (family) {
    return {
      vendor: family.vendor,
      matchedBy: "family",
      wire: {},
      local: {},
      evidence: ["家族 pattern 命中但非白名单型号 → 兜底（2026-09-22 拍板：白名单外全兜底）"],
    };
  }

  // ③ UNKNOWN。
  return EMPTY_PROFILE;
}

/** 组装 A 类：家族静态策略 + 目录派生叠加（目录优先）。 */
function wireFor(vendor: ModelVendorId, entry?: CatalogModelEntry | null): ProfileWire {
  const base = WIRE_POLICIES[vendor] ?? {};
  const mandatory = thinkingMandatoryFromCatalog(entry);
  const efforts = catalogEffortValues(entry);
  const readFields = entry?.interleavedField
    ? [entry.interleavedField, "reasoning_content", "reasoning"]
    : base.reasoningReadFields;
  return {
    ...base,
    ...(mandatory ? { thinkingMandatory: true } : {}),
    ...(efforts ? { effortValues: efforts } : {}),
    ...(readFields ? { reasoningReadFields: readFields } : {}),
  };
}

// ── 第一方通道判定（试探加速专用，不参与正确性）────────────────────────────

/** 各家族第一方域名（hostname 后缀匹配）。不可判定 → false（保守）。 */
const FIRST_PARTY_HOSTS: Readonly<Record<ModelVendorId, readonly string[]>> = {
  deepseek: ["deepseek.com"],
  stepfun: ["stepfun.com"],
  kimi: ["moonshot.ai", "moonshot.cn"],
  minimax: ["minimax.io", "minimaxi.com"],
  qwen: ["aliyuncs.com"],
  mimo: ["xiaomimimo.com"],
  glm: ["bigmodel.cn", "z.ai"],
  unknown: [],
};

function hostnameOf(baseURL: string | undefined): string {
  if (!baseURL) return "";
  try {
    return new URL(baseURL).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * 端点是否该家族第一方通道（hostname 后缀主 + 目录 provider id 辅）。
 * **仅用于试探加速**（预置「已知接受」，省首轮试探成本）；不可判定一律 false。
 */
export function isFirstPartyChannel(input: {
  vendor: ModelVendorId;
  baseURL?: string;
  catalogProviderId?: string;
}): boolean {
  const host = hostnameOf(input.baseURL);
  const hosts = FIRST_PARTY_HOSTS[input.vendor] ?? [];
  if (host && hosts.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))) return true;
  return false;
}

/**
 * 散文占比守卫（P2.3；qwen xml-tool-call-fallback 0.8 同构）：
 * 显式调用区域扣除后，剩余散文占比超过阈值即认为模型在「讲解」格式
 * 而非「调用」工具。纯字符串判定，零依赖。
 *
 * @param regionChars 显式调用区域（`<tool_call>` 标签 / ```json 围栏）的字符数
 * @param guard 阈值（0–1），<=0 表示不守卫
 */
export function exceedsProseRatioGuard(text: string, regionChars: number, guard: number): boolean {
  if (guard <= 0 || text.length === 0) return false;
  const prose = text.length - Math.min(regionChars, text.length);
  return prose / text.length > guard;
}
