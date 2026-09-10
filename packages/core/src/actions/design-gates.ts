/**
 * 设计域统一 stage-gate 管道（specs/prompt-doc-chain §9 + 2026-09-11 稳定性强化）。
 *
 * 弱模型（step-3.7 级）的产出质量不可控——提示词写得再严，模型也可能漏页、
 * 漏节、漏三态。此模块把"生成→机械审计→带 findings 修复→fail-closed"做成
 * 共享管道，五个生成 stage（spec / pd-design / prototype / ui-design / arch）
 * 全部走同一循环，稳定性不再依赖模型自觉。
 *
 * 审计器全部是纯函数（输入产物字符串，输出 findings 字符串数组），可以独立
 * 单测——这是"测试通过≠没问题"交叉审查后的核心教训：深度/遵守必须机械执行。
 */

import { parsePageList, extractProgramPages } from "../common/openui-pages";

// ── 共享管道 ─────────────────────────────────────────────────────────────────

export interface DesignStageConfig<T> {
  /** Stage 标识（进度码前缀，如 "prototype.spec"）。 */
  stage: string;
  /** 子代理技能 id。 */
  skill: string;
  /** 构建提示词；findings 非空时为修复轮（逐条注入）。 */
  buildPrompt: (findings: string[] | null) => string;
  /** 从子代理原始输出中抽取产物；null = 抽取失败（进入修复或终止）。 */
  extract: (generated: string) => T | null;
  /** 机械审计；返回 findings（空数组 = 达标）。 */
  audit: (document: T) => string[];
  /** 最大修复轮数（不含首轮）。 */
  maxRepairs: number;
}

export interface DesignStageResult<T> {
  ok: boolean;
  document?: T;
  error?: string;
  /** 修复轮注入的 findings（成功时为最后一轮的原始 findings，供进度展示）。 */
  repairFindings?: string[];
}

/**
 * 统一 stage-gate 管道：生成 → 机械审计 → findings 非空则带 findings 修复
 * （最多 maxRepairs 轮）→ 复审仍败 fail-closed。
 *
 * 稳定性三原则（specs/prompt-doc-chain §9.4）：
 * 1. 骨架/契约内联进提示词（buildPrompt 负责）；
 * 2. 深度/结构要求机械审计（audit 负责）；
 * 3. 审计失败带 findings 修复，两轮耗尽 fail-closed（本循环负责）。
 */
export async function runDesignStage<T>(
  ctx: { runSubagent?: unknown; signal: AbortSignal },
  config: DesignStageConfig<T>
): Promise<DesignStageResult<T>> {
  if (!ctx.runSubagent) return { ok: false, error: "runSubagent not available" };
  const subagent = ctx.runSubagent as (call: {
    skill: string;
    prompt: string;
    silent: boolean;
  }) => Promise<{ sessionId: string; content: string }>;
  const call = (prompt: string) => subagent({ skill: config.skill, prompt, silent: true });
  let lastFindings: string[] | null = null;
  for (let round = 0; round <= config.maxRepairs; round += 1) {
    const isRepair = round > 0;
    const generated = await call(config.buildPrompt(isRepair ? (lastFindings ?? []) : null));
    const extracted = config.extract(generated.content);
    if (extracted === null) {
      // 抽取失败（截断/无围栏/非 markdown）→ 修复轮重试（budget 內）。
      if (isRepair || round === config.maxRepairs) {
        return { ok: false, error: `${config.stage}: extraction failed after ${round + 1} round(s)` };
      }
      lastFindings = ["extraction failed"];
      continue;
    }
    const findings = config.audit(extracted);
    if (findings.length === 0) {
      return { ok: true, document: extracted, repairFindings: lastFindings ?? undefined };
    }
    lastFindings = findings;
    if (round < config.maxRepairs) {
      // 还有修复预算——下一轮 buildPrompt(null) 不合适，直接用 findings 重试。
    }
  }
  return { ok: false, error: `${config.stage}: depth gate still failing after ${config.maxRepairs} repair round(s)` };
}

// ── pd-design.md 审计（六节逐节点名）────────────────────────────────────────

const PD_SECTIONS = ["页面结构", "交互叙事", "信息架构", "视觉基调", "平台策略", "继承要点"] as const;

/** pd-design.md 六节齐全 + 每节有实质内容（≥2 行正文）。 */
export function pdSectionsAudit(markdown: string): string[] {
  const findings: string[] = [];
  for (const section of PD_SECTIONS) {
    if (!markdown.match(new RegExp(`^##\\s+.*${section}`, "m"))) {
      findings.push(`缺少「${section}」节`);
      continue;
    }
    const body = sectionBody(markdown, section);
    const contentLines = body ? (body.match(/\S/g) ?? []).length : 0;
    if (contentLines < 3) findings.push(`「${section}」节内容过少（<10 字符）`);
  }
  return findings;
}

// ── ui-design.md 审计（四节逐节点名）────────────────────────────────────────

const UI_SECTIONS = ["画布构图", "tokens 映射", "视觉层级", "状态呈现"] as const;

/** ui-design.md 四节齐全 + 每节有实质内容。 */
export function uiSectionsAudit(markdown: string): string[] {
  const findings: string[] = [];
  for (const section of UI_SECTIONS) {
    if (!markdown.match(new RegExp(`^##\\s+.*${section}`, "m"))) {
      findings.push(`缺少「${section}」节`);
      continue;
    }
    const body = sectionBody(markdown, section);
    const contentLines = body ? (body.match(/\S/g) ?? []).length : 0;
    if (contentLines < 3) findings.push(`「${section}」节内容过少（<10 字符）`);
  }
  return findings;
}

// ── 架构文档审计（节结构 + Mermaid 必有）─────────────────────────────────────

const ARCH_SECTIONS = ["技术选型", "模块划分"] as const;

/** 架构文档节结构 + Mermaid 图（既有 looksLikeArchDoc 的加强版）。 */
export function archSectionsAudit(markdown: string): string[] {
  const findings: string[] = [];
  if (!/^[ \t]*```[ \t]*mermaid/im.test(markdown)) {
    findings.push("缺少 Mermaid 图（架构图/数据模型/流程至少一张）");
  }
  for (const section of ARCH_SECTIONS) {
    if (!markdown.match(new RegExp(`^#{1,6}\\s+.*${section}`, "m"))) {
      findings.push(`缺少「${section}」相关内容`);
    }
  }
  return findings;
}

// ── 原型页面覆盖门 ───────────────────────────────────────────────────────────

/**
 * PRD 页面清单 vs OpenUI 程序页面集合的覆盖比对（specs/prototype-reliability
 * WP0 的 verify 逻辑前置到 materialize——持久化前机械拦截漏页）。
 * 返回缺失页面 id 列表（空 = 全覆盖或 PRD 无页面清单）。
 */
export function pageCoverageFindings(spec: string, program: string): string[] {
  const pageList = parsePageList(spec);
  if (!pageList || !pageList.hasIds) return [];
  const pages = extractProgramPages(program);
  const declared = new Set<string>();
  for (const page of pageList.pages) {
    if (page.id) declared.add(page.id);
  }
  const missing: string[] = [];
  for (const id of declared) {
    // $page 初始值或比较值任一出现即可。
    if (pages.initial === id || pages.comparisons.has(id)) continue;
    missing.push(id);
  }
  return missing;
}

// ── 节体提取（共享）────────────────────────────────────────────────────────

/** 提取指定标题节的正文（到下一个同级或更高级标题为止）。 */
export function sectionBody(markdown: string, sectionTitle: string): string | null {
  const escaped = sectionTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const start = markdown.search(new RegExp(`^#{1,6}\\s+.*${escaped}`, "m"));
  if (start === -1) return null;
  const rest = markdown.slice(start);
  // 节体从标题行的换行符之后开始——不能用 slice(1)（砍掉一个 # 后标题行
  // 余部仍匹配 ^#{1,3}，节体会截断在标题行自身，行数统计恒为 0）。
  const bodyStart = rest.indexOf("\n");
  if (bodyStart === -1) return "";
  const body = rest.slice(bodyStart + 1);
  const next = body.search(/^#{1,3}\s+/m);
  return next === -1 ? body : body.slice(0, next);
}
