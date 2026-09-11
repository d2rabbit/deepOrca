/**
 * 设计域统一 stage-gate 管道（specs/prompt-doc-chain §9 + specs/design-stage-gates）。
 *
 * 弱模型（step-3.7 级）的产出质量不可控——提示词写得再严，模型也可能漏页、
 * 漏节、漏三态。此模块把"生成→机械审计→带 findings 修复→分层失败"做成
 * 共享管道，五个生成 stage（spec / pm-design / prototype / ui-design / arch）
 * 全部走同一循环，稳定性不再依赖模型自觉。
 *
 * specs/design-stage-gates（借鉴 alibaba/open-code-review 垂直 agent 模式）：
 * - 确定性优先：归一化/行计数先于 LLM 修复（OCR RE_LOCATION 三级解析同款）；
 * - 增强 fail-open × 验证 fail-closed：pd/ui 提示词文档失败降级基线路径，
 *   程序产物（Leafer 缺页）不达标拒绝落盘（OCR plan-failure × 行号校验同款）；
 * - 子代理 seam 瞬态重试（OCR 模板预算内重试同款）。
 *
 * 审计器全部是纯函数（输入产物字符串，输出 findings 字符串数组），可以独立
 * 单测——这是"测试通过≠没问题"交叉审查后的核心教训：深度/遵守必须机械执行。
 */

import { parsePageList, extractProgramPages } from "../common/openui-pages";
import { classifyLlmError } from "../common/llm-error";
import type { ActionProgress, RunSubagentOptions } from "./types";

// ── 确定性归一化（OCR 借鉴：确定性修复先于 LLM 修复轮）──────────────────────

/**
 * 文档 stage 产物的确定性归一化——只修"检测得到但内容没变"的格式抖动：
 * LLM 常把 GFM 表格行缩进进列表/引用，行首 `|` 检测全部失效（p-core 真机
 * 「数据与字段 0 行」误判类）。归一化后的文档才是审计与落盘对象。
 */
export function normalizeGeneratedMarkdown(markdown: string): string {
  return markdown
    .split("\n")
    .map((line) => {
      const stripped = line.trimStart();
      if (stripped !== line && stripped.startsWith("|") && (stripped.match(/\|/g) ?? []).length >= 2) {
        return stripped;
      }
      return line;
    })
    .join("\n");
}

/** 纯占位单元格（`<…>` 或 `[TODO…`）——骨架行模板抄进产物也不计数。 */
function isPlaceholderCell(cell: string): boolean {
  return /^<[^<>]*>$/.test(cell) || /^\[TODO/i.test(cell);
}

/**
 * GFM 表数据行计数（占位感知）：`^[ \t]*|` 开头、非分隔行、且至少一个非空
 * 单元格不是占位符。表头行照旧计数（与既有阈值语义一致：3 = 表头 + ≥2 数据行）。
 */
export function countTableDataRows(section: string | null | undefined): number {
  if (!section) return 0;
  let count = 0;
  for (const rawLine of section.split("\n")) {
    const line = rawLine.trim();
    if (!line.startsWith("|")) continue;
    const cells = line
      .slice(1)
      .split("|")
      .map((cell) => cell.trim());
    const meaningful = cells.filter((cell) => cell.length > 0);
    if (meaningful.length === 0) continue;
    if (meaningful.every((cell) => /^:?-{2,}:?$/.test(cell))) continue; // 分隔行
    if (meaningful.every(isPlaceholderCell)) continue; // 骨架占位行
    count += 1;
  }
  return count;
}

// ── 子代理稳定调用 seam（specs/design-stage-gates S6）──────────────────────

const TRANSIENT_RETRY_CATEGORIES = new Set(["RATE_LIMIT", "SERVER", "TRANSIENT", "TIMEOUT"]);
const SUBAGENT_TRANSIENT_RETRY_DELAY_MS = 1000;

/** 子代理结果 → 内容字符串（裸字符串或 `{content}` 包装；空内容归一为 null）。 */
export function subagentContentOf(result: unknown): string | null {
  if (typeof result === "string") return result.trim().length > 0 ? result : null;
  if (result && typeof result === "object" && "content" in result) {
    const content = (result as { content?: unknown }).content;
    return typeof content === "string" && content.trim().length > 0 ? content : null;
  }
  return null;
}

/**
 * 设计管线的子代理调用 seam：瞬态错误（复用 classifyLlmError 的
 * RATE_LIMIT/SERVER/TRANSIENT/TIMEOUT）与空内容各重试一次（1s 退避，同
 * 提示词——前缀缓存友好）；非瞬态错误立即上抛，重试耗尽把结果交还调用方
 * （各 stage 自行决定 fail-open 降级或 fail-closed）。OCR 借鉴：单次瞬态
 * 重试覆盖绝大多数网络/限流抖动，双次以上只会放大超时。
 */
export async function callSubagentStable(
  ctx: { runSubagent?: (opts: RunSubagentOptions) => Promise<unknown>; emit?: (event: ActionProgress) => void },
  opts: RunSubagentOptions,
  stage: string
): Promise<string | null> {
  const run = ctx.runSubagent;
  if (!run) return null;
  const attempt = (): Promise<string | null> =>
    run(opts).then(subagentContentOf, (error: unknown) => {
      throw error;
    });
  try {
    const first = await attempt();
    if (first !== null) return first;
    ctx.emit?.({ message: `${stage}: empty subagent output — retrying once` });
  } catch (error) {
    const category = classifyLlmError(error);
    if (!TRANSIENT_RETRY_CATEGORIES.has(category)) throw error;
    ctx.emit?.({ message: `${stage}: transient LLM error (${category}) — retrying once` });
  }
  await new Promise((resolve) => setTimeout(resolve, SUBAGENT_TRANSIENT_RETRY_DELAY_MS));
  return attempt();
}

// ── 共享 stage-gate 管道 ─────────────────────────────────────────────────────

export interface DesignStageConfig<T> {
  /** Stage 标识（错误信息前缀，如 "pm-design"）。 */
  stage: string;
  /** 子代理技能 id。 */
  skill: string;
  /** 构建提示词；findings 非空时为修复轮（逐条注入）。 */
  buildPrompt: (findings: string[] | null) => string;
  /** 从子代理内容中抽取产物；null = 抽取失败（进入修复或终止）。 */
  extract: (generated: string | null) => T | null;
  /** 机械审计；返回 findings（空数组 = 达标）。 */
  audit: (document: T) => string[];
  /** 最大修复轮数（不含首轮）。 */
  maxRepairs: number;
  /** 修复轮进度码（可选；data.code 稳定契约）。 */
  progressCode?: string;
  /** 修复轮进度基点（每轮 +5）。 */
  basePercent?: number;
}

export type DesignStageResult<T> =
  | { ok: true; document: T; findings?: string[] }
  | { ok: false; error: string; findings?: string[] };

/**
 * 统一 stage-gate 管道：稳定 seam 生成 → 抽取 → 机械审计 → findings 非空则
 * 带 findings 修复（最多 maxRepairs 轮）→ 复审仍败返回结构化错误（错误携带
 * findings 明细）。失败语义（fail-open 降级 vs fail-closed）由调用方裁决——
 * 本引擎只负责"生成-审计-修复"的循环本身。
 */
export async function runDesignStage<T>(
  ctx: {
    runSubagent?: (opts: RunSubagentOptions) => Promise<unknown>;
    signal: AbortSignal;
    emit?: (event: ActionProgress) => void;
  },
  config: DesignStageConfig<T>
): Promise<DesignStageResult<T>> {
  if (!ctx.runSubagent) return { ok: false, error: `${config.stage}: runSubagent not available` };
  let lastFindings: string[] | null = null;
  let lastExtractFailure = false;
  for (let round = 0; round <= config.maxRepairs; round += 1) {
    const isRepair = round > 0;
    if (isRepair) {
      const count = lastExtractFailure ? 1 : (lastFindings ?? []).length;
      ctx.emit?.({
        message: `${config.stage}: repairing ${count} finding(s) (round ${round}/${config.maxRepairs})`,
        percent: (config.basePercent ?? 50) + (round - 1) * 5,
        ...(config.progressCode ? { data: { code: config.progressCode } } : {}),
      });
    }
    const generated = await callSubagentStable(
      ctx,
      { skill: config.skill, prompt: config.buildPrompt(isRepair ? (lastFindings ?? []) : null), silent: true },
      config.stage
    );
    const extracted = config.extract(generated);
    if (extracted === null) {
      lastExtractFailure = true;
      lastFindings = ["extraction failed (empty/title-less/truncated output)"];
      continue;
    }
    lastExtractFailure = false;
    const findings = config.audit(extracted);
    if (findings.length === 0) return { ok: true, document: extracted };
    lastFindings = findings;
  }
  return {
    ok: false,
    error: `${config.stage}: ${lastExtractFailure ? "document extraction failed" : "depth gate still failing"} after ${config.maxRepairs} repair round(s)${lastFindings && lastFindings.length > 0 ? `: ${lastFindings.join("; ")}` : ""}`,
    findings: lastFindings ?? undefined,
  };
}

// ── pm-design.md 审计（六节逐节点名）────────────────────────────────────────

const PM_SECTIONS = ["页面结构", "交互叙事", "信息架构", "视觉基调", "平台策略", "继承要点"] as const;

/** pm-design.md 六节齐全 + 每节有实质内容（≥3 个非空白字符）。 */
export function pmSectionsAudit(markdown: string): string[] {
  const findings: string[] = [];
  for (const section of PM_SECTIONS) {
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

// ── 架构文档审计（specs/design-stage-gates S3 强化版）───────────────────────

const ARCH_SECTIONS = ["技术选型", "系统架构", "数据模型", "核心流程", "模块拆分", "非功能", "风险"] as const;

/**
 * 架构文档深度审计：七节齐全 + Mermaid ≥2 张且必含 erDiagram + 三张关键表
 * 行数门槛（技术选型/模块拆分 ≥3 数据行、风险 ≥2 数据行）。表深走占位感知
 * 行计数——骨架行模板抄进产物过不了门。
 */
export function archSectionsAudit(markdown: string): string[] {
  const findings: string[] = [];
  const diagrams = [...markdown.matchAll(/```[ \t]*mermaid[^\n]*\n([\s\S]*?)```/g)].map((match) => match[1]);
  if (diagrams.length < 2) findings.push(`Mermaid 图仅 ${diagrams.length} 张（需 ≥2：架构/数据模型/流程）`);
  if (!diagrams.some((body) => /^\s*erDiagram\b/m.test(body))) findings.push("缺少 erDiagram 数据模型图");
  for (const section of ARCH_SECTIONS) {
    if (!markdown.match(new RegExp(`^#{1,6}\\s+.*${section}`, "m"))) {
      findings.push(`缺少「${section}」节`);
    }
  }
  const selectionRows = countTableDataRows(sectionBody(markdown, "技术选型"));
  if (selectionRows < 3) findings.push(`技术选型表仅 ${selectionRows} 行（需 ≥3 行 选型/版本/理由）`);
  const moduleRows = countTableDataRows(sectionBody(markdown, "模块拆分"));
  if (moduleRows < 3) findings.push(`模块拆分表仅 ${moduleRows} 行（需 ≥3 行 模块/职责/依赖）`);
  const riskRows = countTableDataRows(sectionBody(markdown, "风险"));
  if (riskRows < 2) findings.push(`风险与对策表仅 ${riskRows} 行（需 ≥2 行 风险/对策）`);
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

// ── 原型交互密度门（specs/design-stage-gates S4）────────────────────────────

/** 程序页面并集基数（初始页 + 全部比较值）。 */
export function programPageCount(program: string): number {
  const pages = extractProgramPages(program);
  const union = new Set<string>(pages.comparisons);
  if (pages.initial) union.add(pages.initial);
  return union.size;
}

/**
 * OpenUI 程序交互密度审计（页面覆盖门之外的第二层，全部机械可判定）：
 * 组件调用总数下限（空壳拦截）、`Action(` 交互数下限（死按钮拦截）、每个
 * 声明页面可达（初始页或存在 `@Set($page,…)` 导航边——孤岛页拦截）。
 * findings 注入修复环契约（fail-open 层，verify 阶段兜底）。
 */
export function openuiInteractivityFindings(spec: string, program: string): string[] {
  const findings: string[] = [];
  const componentCalls = [...program.matchAll(/\b[A-Z][A-Za-z0-9_]*\s*\(/g)].length;
  if (componentCalls < 10) findings.push(`程序组件调用仅 ${componentCalls} 处（交互密度不足，需 ≥10）`);
  const pageList = parsePageList(spec);
  const pageCount = pageList?.hasIds ? pageList.pages.filter((page) => page.id).length : programPageCount(program);
  const actions = [...program.matchAll(/\bAction\s*\(/g)].length;
  const minActions = Math.max(2, pageCount);
  if (actions < minActions) findings.push(`Action 交互仅 ${actions} 处（需 ≥${minActions}——每页至少一处真实交互）`);
  if (pageList?.hasIds) {
    const pages = extractProgramPages(program);
    for (const page of pageList.pages) {
      if (!page.id) continue;
      if (pages.initial === page.id || pages.navTargets.has(page.id)) continue;
      findings.push(`页面 ${page.id} 不可达（非初始页且无 @Set($page) 导航边）`);
    }
  }
  return findings;
}

// ── Leafer 画布深度门（specs/design-stage-gates S5）──────────────────────────

export interface LeaferCanvasDepth {
  /** 硬门 findings（缺页/无 Frame）——修复一轮后仍非空则拒绝落盘。 */
  findings: string[];
  /** 软门提示（节点密度）——只进修复契约，不作落盘门槛。 */
  softNotes: string[];
}

function countNodes(value: unknown): number {
  if (Array.isArray(value)) return value.reduce<number>((sum, item) => sum + countNodes(item), 0);
  if (value && typeof value === "object") {
    let count = 1;
    for (const child of Object.values(value as Record<string, unknown>)) {
      if (child && typeof child === "object") count += countNodes(child);
    }
    return count;
  }
  return 0;
}

/**
 * Leafer 场景深度审计：基底原型已知页面数时顶层 Frame 数不得少（缺页 =
 * 破损 UI，硬门 fail-closed）；节点密度不足仅作软提示（弱模型密度弹性大，
 * 硬门反致不稳定——分层裁决见 specs/design-stage-gates design.md §3.4）。
 */
export function leaferCanvasFindings(text: string, requiredPageCount?: number): LeaferCanvasDepth {
  const findings: string[] = [];
  const softNotes: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { findings: ["画布 JSON 无法解析（深度门）"], softNotes };
  }
  const children =
    parsed && typeof parsed === "object" && Array.isArray((parsed as { children?: unknown }).children)
      ? ((parsed as { children: unknown[] }).children as unknown[])
      : [];
  const frames = children.filter(
    (child) => child && typeof child === "object" && (child as { tag?: unknown }).tag === "Frame"
  );
  // 硬门只在基底原型已知页面数时启用（S5 措辞）：requirement-only 生成没有
  // "每页一 Frame" 契约，结构自检环仍是它的落盘门槛。
  if (typeof requiredPageCount === "number" && requiredPageCount > 0) {
    if (frames.length === 0) {
      findings.push("画布缺少顶层 Frame（每页一个页面容器）");
    } else if (frames.length < requiredPageCount) {
      findings.push(`画布 Frame 数 ${frames.length} 少于原型页面数 ${requiredPageCount}（每页一 Frame）`);
    }
  }
  const nodeCount = countNodes(parsed);
  if (frames.length > 0 && nodeCount < frames.length * 4) {
    softNotes.push(`画布节点密度偏低（${nodeCount} 节点 / ${frames.length} Frame，建议每 Frame ≥8 节点）`);
  }
  return { findings, softNotes };
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
