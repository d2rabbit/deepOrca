/**
 * Prototype suite actions. Generation is delegated to the existing design
 * skills; immutable suite reads and writes cross the desktop A2UI MCP seam.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type { ActionContext, ActionDefinition, ActionRun } from "./types";
import {
  OPENUI_CREATE_CONTRACT,
  OPENUI_DEVICE_CONTRACTS,
  OPENUI_PRESERVE_CONTRACT,
  OPENUI_QUALITY_CONTRACT,
  normalizeOpenuiDevices,
  type OpenuiDevice,
} from "./openui-contract";
import { componentJaccard, extractProgramPages, extractTargetPlatforms, parsePageList } from "../common/openui-pages";
import {
  archSectionsAudit,
  callSubagentStable,
  countTableDataRows,
  normalizeGeneratedMarkdown,
  openuiInteractivityFindings,
  pageCoverageFindings,
  pmSectionsAudit,
  runDesignStage,
  sectionBody,
  subagentContentOf,
} from "./design-gates";

const DESIGNS_DIR = ".deeporca/designs";
const SPEC_FILE = "spec.md";
const A2UI_TOOL_PREFIX = "mcp__a2ui__";
/** Repair rounds after the INITIAL generation in the self-recursive
 *  validation loop (user ask 2026-09-09): official-parser verdict → patch
 *  prompt → regenerate. OUI-1's repair data: near-miss fixes are usually
 *  one-statement edits, so 2 rounds clear the large majority. */
const MAX_OPENUI_REPAIR_ROUNDS = 2;

export interface ArtifactRef {
  suiteId: string;
  versionId: string;
  kind: "prototype" | "ui";
}

interface PrototypeVerificationCheck {
  id: string;
  label: string;
  status: "pending" | "passed" | "failed" | "healed";
  action?: string;
  observation?: string;
}

interface PrototypeVerificationResult {
  status: "pending" | "passed" | "failed";
  checks: PrototypeVerificationCheck[];
  generatedAt?: string;
  healingRounds?: number;
}

export type PrototypeDevice = "desktop" | "mobile" | "tablet";

export interface PrototypeSuiteContent {
  requirement?: string;
  spec?: string;
  /** specs/prompt-doc-chain：pm-design.md——从 PRD 蒸馏的原型提示词文档
   *  （页面结构/交互叙事/信息架构/视觉基调/平台策略/继承要点）。原型生成的
   *  主驱动；spec 重写后失效（render_spec 重置）。 */
  pmDesign?: string;
  openui?: string;
  /** 平台变体(user ask 2026-09-09:三端是平台化适配,不是同一程序挤宽度)。
   *  desktop 桌面版即 openui 本体;mobile/tablet 是结构性不同的独立程序,
   *  由 materialize 的 devices 循环生成、update_openui(device) 增量修订。 */
  openuiVariants?: Partial<Record<PrototypeDevice, string>>;
  verification?: PrototypeVerificationResult;
  /** Technical architecture document (user ask 2026-09-08 技术架构模块). */
  arch?: string;
}

export interface UiSuiteContent {
  requirement?: string;
  openui?: string;
  /** specs/leafer-ui-engine: UI-Design 新栈产物（Leafer JSON 场景树字符串）。
   *  字段级双栈路由（EARS 17）：有 leafer → Leafer 栈；仅 openui → 旧栈只读。
   *  同一 suite 版本不混写两种字段（guard 测试锁定）。 */
  leafer?: string;
  /** specs/prompt-doc-chain：ui-design.md——原型转 UI 时的视觉强化提示词
   *  （pm-design 的视觉翻译：画布构图/tokens 映射/视觉层级）。随
   *  design.materialize 生成并落盘。 */
  uiDesign?: string;
  tokens?: unknown;
  components?: unknown;
  quality?: Record<string, unknown>;
  sourcePrototype?: { suiteId: string; versionId: string };
  designSystemId?: string;
}

/** specs/prd-theme-layer：PRD 主题关系引用（指向另一套件；versionId 省略 =
 *  跟随其 head）。与 desktop 侧 shared/ipc 的同构类型保持一致。 */
export interface DesignThemeRef {
  suiteId: string;
  versionId?: string;
}

interface SuiteVersionPayload {
  artifactRef: ArtifactRef;
  title: string;
  status: string;
  content: PrototypeSuiteContent | UiSuiteContent;
  /** specs/prd-theme-layer：read_suite_version 载荷附带的套件 meta 主题字段
   *  （design.materialize 由此透传给 UI 套件）。 */
  themeId?: string;
  stage?: string;
  inherits?: DesignThemeRef;
  references?: DesignThemeRef[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeArtifactId(id: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id) && !id.includes("..");
}

function readArtifactFile(projectRoot: string, id: string, file: string): string | null {
  if (!isSafeArtifactId(id)) return null;
  try {
    const base = path.resolve(projectRoot, DESIGNS_DIR);
    const dir = path.resolve(base, id);
    if (!dir.startsWith(base + path.sep)) return null;
    const target = path.resolve(dir, file);
    if (!target.startsWith(dir + path.sep)) return null;
    const content = fs.readFileSync(target, "utf8");
    return content.trim() ? content : null;
  } catch {
    return null;
  }
}

function extractGeneratedBody(result: unknown): string | null {
  const content = subagentContentOf(result);
  if (!content) return null;
  // Line-anchored (re-review fix): prose merely MENTIONING ``` mid-line must
  // not open the extraction — only a real line-initial fence does.
  const fence = content.match(/^[ \t]*```(?:markdown|md|openui|dd|html|json)?[ \t]*\n([\s\S]*?)```/im);
  if (fence) return fence[1]?.trim() || null;
  // An opened-but-never-closed fence means the subagent output was cut off
  // mid-document; refuse the half-captured body (it used to fall back to the
  // WHOLE message including leading prose) so callers fail with a
  // regenerate hint instead of persisting garbage as a "ready" version.
  // Line-anchored (re-review fix): prose merely MENTIONING ``` mid-line must
  // not trip the truncation refusal.
  if (/^[ \t]*```[^\n]*\n/m.test(content)) return null;
  return content.trim() || null;
}

/**
 * Cheap OpenUI Lang structural sanity: a program must bind at least one
 * component and declare the `root` export. Catches truncated or
 * prose-contaminated LLM output (missing closing fence → the whole message
 * including prose is "extracted") BEFORE it persists as a "ready" version.
 */
export function looksLikeOpenuiProgram(code: string): boolean {
  // root 右侧允许 $page 开头(CREATE 契约的标准形态 `root = $page == "home" ? ...`——
  // \w 不匹配 $,按契约写的程序曾被误拒为 truncated)。
  return /^[ \t]*[A-Za-z_$][\w$]*\s*=\s*\w/m.test(code) && /^[ \t]*root\s*=\s*(?:\w|\$)/m.test(code);
}

/** A structured spec must carry at least one markdown section heading. */
export function looksLikeSpecDocument(markdown: string): boolean {
  return /^#{1,6}\s+\S/m.test(markdown);
}

/**
 * Extract a complete markdown document (PRD / 技术架构文档) from subagent
 * output. These documents nest ```mermaid fences, and models wrap the whole
 * document in a ```markdown fence — the single-fence lazy extractor
 * (extractGeneratedBody) truncates at the first inner fence. Decision tree
 * over a LINE-ANCHORED fence scan (a ``` merely mentioned mid-line never
 * counts, so the closer search cannot be dragged onto a trailing note):
 *   wrapped (first fence at position 0) → unwrap (first fence line … last),
 *   prose then a wrapped document       → unwrap when the payload reads as a
 *                                         markdown document, else defer,
 *   bare markdown starting with "#"     → the whole trimmed content is the doc,
 *   anything else                       → the single-fence extraction result.
 * A truncated stream always fails ONE of two combined guards: fence-count
 * parity (a cut mid-document leaves an unmatched opener — odd count; a wrap
 * cut inside an inner fence is even, which is why parity alone cannot do
 * this) and the bare-closer check (the LAST line-anchored fence must be a
 * bare closing ``` — a cut mid-fence leaves an opener, not a closer).
 */
export function extractMarkdownDocument(result: unknown): string | null {
  const direct = extractGeneratedBody(result);
  const raw =
    typeof (result as { content?: unknown })?.content === "string" ? (result as { content: string }).content : null;
  if (raw === null) return direct;
  const trimmed = raw.trim();
  const fences = [...trimmed.matchAll(/^[ \t]*```.*$/gm)];
  if (fences.length === 0) return direct;
  // Combined truncation guards — each catches the window the other misses.
  if (fences.length % 2 !== 0) return null;
  if (!/^[ \t]*```[ \t]*$/.test(fences[fences.length - 1][0])) return null;
  const firstIndex = fences[0].index ?? 0;
  const lastIndex = fences[fences.length - 1].index ?? 0;
  if (firstIndex === 0) {
    // Wrapped: the prompt asked for exactly one markdown code fence.
    const openerEnd = trimmed.indexOf("\n");
    const body = openerEnd !== -1 ? trimmed.slice(openerEnd + 1, lastIndex).trim() : null;
    return body || null;
  }
  if (!trimmed.startsWith("#")) {
    // Leading prose: unwrap only when the first fence is genuinely the
    // wrapper (its payload reads as a markdown document); when the prose
    // precedes a bare document, defer to the single-fence extractor.
    const openerEnd = trimmed.indexOf("\n", firstIndex);
    const candidate = openerEnd !== -1 ? trimmed.slice(openerEnd + 1, lastIndex).trim() : null;
    if (candidate && candidate.startsWith("#")) return candidate;
    return direct;
  }
  // Bare markdown (no wrapper): the whole trimmed content is the document —
  // its fences are inner ones, and the combined parity + bare-closer guards
  // above have established that every opener is closed.
  return trimmed;
}

function parseJsonRecord(text: string | undefined): Record<string, unknown> | null {
  if (!text) return null;
  const candidates = [text.trim(), text.match(/\{[\s\S]*\}/)?.[0]].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (isRecord(parsed)) return parsed;
    } catch {
      // Try the next representation.
    }
  }
  return null;
}

function parseArtifactRef(output: string | undefined): ArtifactRef | null {
  const direct = parseJsonRecord(output);
  const nested = direct && isRecord(direct.artifactRef) ? direct.artifactRef : null;
  const fallbackText = output?.match(/ArtifactRef:\s*(\{[^\n]+\})/)?.[1];
  const candidate = nested ?? parseJsonRecord(fallbackText);
  if (
    !candidate ||
    typeof candidate.suiteId !== "string" ||
    typeof candidate.versionId !== "string" ||
    (candidate.kind !== "prototype" && candidate.kind !== "ui")
  ) {
    return null;
  }
  return { suiteId: candidate.suiteId, versionId: candidate.versionId, kind: candidate.kind };
}

async function executeA2ui(
  ctx: ActionContext,
  tool: string,
  args: Record<string, unknown>
): Promise<{ ok: true; output?: string; artifactRef?: ArtifactRef } | { ok: false; error: string }> {
  if (!ctx.executeMcpTool) return { ok: false, error: "A2UI MCP action channel is not available" };
  const result = await ctx.executeMcpTool(`${A2UI_TOOL_PREFIX}${tool}`, args);
  if (!result.ok) return { ok: false, error: result.error ?? result.output ?? `${tool} failed` };
  return { ok: true, output: result.output, artifactRef: parseArtifactRef(result.output) ?? undefined };
}

export async function readSuiteVersion(
  ctx: ActionContext,
  suiteId: string,
  versionId?: string
): Promise<{ ok: true; value: SuiteVersionPayload } | { ok: false; error: string }> {
  const result = await executeA2ui(ctx, "read_suite_version", { suiteId, ...(versionId ? { versionId } : {}) });
  if (!result.ok) return result;
  const payload = parseJsonRecord(result.output);
  if (!payload || !isRecord(payload.artifactRef) || !isRecord(payload.content)) {
    return { ok: false, error: "read_suite_version returned an invalid payload" };
  }
  const ref = payload.artifactRef;
  if (
    typeof ref.suiteId !== "string" ||
    typeof ref.versionId !== "string" ||
    (ref.kind !== "prototype" && ref.kind !== "ui")
  ) {
    return { ok: false, error: "read_suite_version returned an invalid ArtifactRef" };
  }
  return {
    ok: true,
    value: {
      artifactRef: { suiteId: ref.suiteId, versionId: ref.versionId, kind: ref.kind },
      title: typeof payload.title === "string" ? payload.title : "Untitled",
      status: typeof payload.status === "string" ? payload.status : "draft",
      content: payload.content as PrototypeSuiteContent | UiSuiteContent,
      // 套件 meta 主题字段（specs/prd-theme-layer）——宽松解析，缺失即省略。
      ...(typeof payload.themeId === "string" ? { themeId: payload.themeId } : {}),
      ...(typeof payload.stage === "string" ? { stage: payload.stage } : {}),
      ...(isRecord(payload.inherits) && typeof payload.inherits.suiteId === "string"
        ? {
            inherits: {
              suiteId: payload.inherits.suiteId,
              ...(typeof payload.inherits.versionId === "string" ? { versionId: payload.inherits.versionId } : {}),
            },
          }
        : {}),
      ...(Array.isArray(payload.references)
        ? {
            references: payload.references
              .filter((item) => isRecord(item) && typeof item.suiteId === "string")
              .map((item) => ({
                suiteId: String(item.suiteId),
                ...(isRecord(item) && typeof item.versionId === "string" ? { versionId: String(item.versionId) } : {}),
              })),
          }
        : {}),
    },
  };
}

/** Structured verdict from the desktop-side local validator (mcp validate_openui).
 *  THE single source for this shape: the repair loop consumes it here, and the
 *  desktop validator's stricter (all-required) verdict is assignable to it.
 *  Fields are optional because core parses the MCP JSON as untrusted input. */
export interface OpenuiVerdict {
  valid: boolean;
  incomplete?: boolean;
  statementCount?: number;
  errors?: Array<{ code: string; component?: string; path?: string; message?: string }>;
  unresolved?: string[];
  orphaned?: string[];
  /** WP2.3: dead-button findings from the desktop validator's static audit. */
  deadButtons?: string[];
}

/** Ask the desktop side to parse `code` with the official local parser. Null
 *  when the validator is unavailable for any reason — the loop then fails
 *  open and the flow behaves exactly as before it existed. */
async function readOpenuiVerdict(ctx: ActionContext, code: string): Promise<OpenuiVerdict | null> {
  try {
    const res = await executeA2ui(ctx, "validate_openui", { code });
    if (!res.ok) return null;
    const parsed = parseJsonRecord(res.output);
    if (!parsed || typeof parsed.valid !== "boolean") return null;
    return parsed as unknown as OpenuiVerdict;
  } catch {
    return null;
  }
}

/** Issue count across every finding category — drives the repair budget. */
export function openuiIssueCount(verdict: OpenuiVerdict): number {
  return (
    (verdict.errors?.length ?? 0) +
    (verdict.unresolved?.length ?? 0) +
    (verdict.orphaned?.length ?? 0) +
    (verdict.deadButtons?.length ?? 0) +
    (verdict.incomplete ? 1 : 0)
  );
}

/** Structured findings → one patch instruction per line (lang-core documents
 *  its error taxonomy as "designed for an automated correction loop").
 *  Exported so the desktop validator surfaces the EXACT wording the repair
 *  loop feeds the model — no second copy to drift. */
export function formatOpenuiFeedback(verdict: OpenuiVerdict): string {
  const lines: string[] = [];
  for (const e of verdict.errors ?? []) {
    const where = e.component ? `component '${e.component}'` : "program";
    const at = e.path ? ` at ${e.path}` : "";
    lines.push(`- ${e.code}${at} (${where}): ${e.message || "invalid usage"}`);
  }
  for (const name of verdict.unresolved ?? []) {
    lines.push(
      `- unresolved-reference: '${name}' is used but never defined — define it before root, or remove the usage.`
    );
  }
  for (const name of verdict.orphaned ?? []) {
    lines.push(
      `- unattached-definition: '${name}' is defined but never reachable from root — mount it in the rendered tree, or remove it.`
    );
  }
  if (verdict.incomplete) {
    lines.push("- incomplete: the program looks truncated — return the COMPLETE program, every statement closed.");
  }
  for (const finding of verdict.deadButtons ?? []) {
    lines.push(`- dead-button: ${finding}`);
  }
  return lines.join("\n");
}

/**
 * Self-recursive validation loop (user ask 2026-09-09): parse the generated
 * program with the OFFICIAL local parser, and while it fails, feed the
 * structured findings back to the designer subagent as patch instructions.
 * Failure semantics are fail-open everywhere — no validator, a repair round
 * that returns garbage, or an exhausted budget each fall back to the last
 * good draft, so the loop can only improve the outcome, never block it (the
 * renderer's correction loop remains the backstop for leftovers).
 */
export async function repairOpenuiProgram(
  ctx: ActionContext,
  opts: { code: string; contract: string; progressCode: string; basePercent: number }
): Promise<string> {
  let code = opts.code;
  // Callers guard runSubagent, but the loop itself fails open like every
  // other missing piece — a draft is better than an aborted action.
  if (!ctx.runSubagent) return code;
  for (let round = 0; ; round += 1) {
    const verdict = await readOpenuiVerdict(ctx, code);
    if (!verdict || verdict.valid) return code;
    const issues = openuiIssueCount(verdict);
    if (round >= MAX_OPENUI_REPAIR_ROUNDS) {
      ctx.emit({
        message: `${issues} parser issue(s) remain after ${MAX_OPENUI_REPAIR_ROUNDS} repair round(s) — persisted for manual correction`,
        percent: opts.basePercent,
        data: { code: opts.progressCode },
      });
      return code;
    }
    ctx.emit({
      message: `Repairing ${issues} parser issue(s) (round ${round + 1}/${MAX_OPENUI_REPAIR_ROUNDS})`,
      percent: opts.basePercent + round * 5,
      data: { code: opts.progressCode },
    });
    const generated = await callSubagentStable(
      ctx,
      {
        skill: "pm-designer-openui",
        prompt:
          "The OpenUI Lang program below failed validation against the official parser. " +
          "Fix EVERY reported issue and return the COMPLETE corrected program in one code fence. " +
          "Change nothing beyond what the issues require. Do not call tools.\n\n" +
          `${opts.contract}\n\nParser issues:\n${formatOpenuiFeedback(verdict)}\n\nCurrent program:\n${code}`,
        silent: true,
      },
      "program-repair"
    );
    const next = extractGeneratedBody(generated);
    if (!next || !looksLikeOpenuiProgram(next)) return code; // keep the last good draft
    code = next;
  }
}

/** specs/prompt-doc-chain 交叉审查追加：PRD 骨架单源（SKILL.md 撤模板改引用，
 *  生成提示词内联——弱模型"填空"远强于"读文档自由发挥"）。
 *  specs/design-stage-gates：三张关键表 + 验收清单给出**行级模板**——p-core
 *  真机证明弱模型对"（实体/字段/类型表）"这种抽象描述会自由发挥出非 GFM
 *  形态；占位行（`<…>`）不计数，模板抄进产物也过不了深度门。 */
export const SPEC_SKELETON = `# <产品/功能名称> 需求文档

| 项目 | 内容 |
| --- | --- |
| 产品定位 | 一句话:为<谁>解决<什么问题> |
| **目标平台** | **必填**:\`web\` / \`mobile\` / \`tablet\` / \`desktop-app\` / 组合式。从需求推断;推断不出→写 [TODO: 待确认目标平台] 并加入待确认节,**不得编造** |
| 重要性 / 紧迫性 | 高/中/低 |
| 需求方 | 从上下文推断,否则 [TODO] |
| 文档日期 | <当天日期> |

## 1. 背景与目标

| 目标 | 度量 | 目标值 |
| --- | --- | --- |
| <目标A> | <如何度量> | <数值> |
| <目标B> | <如何度量> | <数值> |

## 2. 用户与场景

| 角色 | 描述 | 核心诉求 |
| --- | --- | --- |
| <角色A> | <一句话画像> | <要完成什么> |

| 场景 | 角色 | 触发 | 期望结果 |
| --- | --- | --- | --- |
| <场景A> | <角色> | <何时何地> | <结果> |

## 3. 功能需求

（每条具体可测;空态 / 加载 / 失败与重试逐条覆盖;至少一条 P0。）

| 模块 | 需求描述 | 优先级 | 交互要点 |
| --- | --- | --- | --- |
| <模块A> | <具体可测的描述> | P0 | <空态/加载/失败如何呈现> |
| <模块A> | <描述> | P0 | <要点> |
| <模块B> | <描述> | P1 | <要点> |

## 4. 数据与字段

（每个页面展示、编辑或过滤的核心实体都必须有字段级定义。）

| 实体 | 字段 | 类型 | 校验与约束 | 示例 |
| --- | --- | --- | --- | --- |
| <实体A> | <字段1> | string | 必填,长度 2-20 | <示例值> |
| <实体A> | <字段2> | enum | 取值:<a>/<b> | <示例值> |
| <实体B> | <字段1> | number | 范围 0-100 | <示例值> |

## 5. 页面清单

（页面ID 必填——英文 kebab/camel,是原型程序 $page 的取值。表后附 Mermaid
 页面导航图（graph TD 形式,节点用页面ID）。）

| 页面 | 页面ID | 目的 | 关键元素与操作 |
| --- | --- | --- | --- |
| <页面名A> | <page-id-a> | <目的> | <元素/操作> |
| <页面名B> | <page-id-b> | <目的> | <元素/操作> |

### <page-id-a> 逐页交互明细

（逐条 \`状态/事件 → 行为\` 行,含空态/加载/错误三态。）

- <初始态描述> → <行为>
- <事件> → <行为>

## 6. 非功能需求

（无内容写"无特殊要求"。）

| 类别 | 要求 | 度量 |
| --- | --- | --- |
| 性能 | <要求> | <度量> |

## 7. 验收标准

（可勾选验收点 5-10 条,覆盖每个 P0,每条"操作 → 预期可见结果"。）

- [ ] <操作> → <预期可见结果>
- [ ] <操作> → <预期可见结果>
- [ ] <操作> → <预期可见结果>
- [ ] <操作> → <预期可见结果>
- [ ] <操作> → <预期可见结果>

## 8. 待确认

（开放问题列表,没有则写"无"。）`;

export interface PrototypeSpecInput {
  requirement: string;
  suiteId?: string;
  baseVersionId?: string;
  note?: string;
  /** specs/prd-theme-layer：主题归属 + 阶段 + 继承/交叉参考（随 render_spec
   *  落套件 meta；参考 PRD 全文注入生成提示词）。 */
  themeId?: string;
  stage?: string;
  inheritsFrom?: DesignThemeRef;
  references?: DesignThemeRef[];
}

export interface PrototypeSpecOutput {
  ok: boolean;
  artifactRef?: ArtifactRef;
  refreshStore?: boolean;
  error?: string;
}

export const prototypeSpecDefinition: ActionDefinition<PrototypeSpecInput> = {
  id: "prototype.spec",
  description:
    "Expand a requirement into a structured prototype specification and create or append a prototype design suite version.",
  category: "design",
  parameters: {
    type: "object",
    properties: {
      requirement: { type: "string", description: "Natural language requirement" },
      suiteId: { type: "string", description: "Prototype suite to revise; omit for a new suite" },
      baseVersionId: { type: "string", description: "Immutable suite version used as the revision base" },
      note: { type: "string", description: "Optional version note" },
      themeId: { type: "string", description: "PRD theme id (specs/prd-theme-layer) — must be an existing theme" },
      stage: { type: "string", description: "Phase label within the theme (display only, e.g. 'Phase 1')" },
      inheritsFrom: {
        type: "object",
        properties: {
          suiteId: { type: "string", description: "PRD suite this one inherits from" },
          versionId: { type: "string", description: "Pinned version; omit to follow its head" },
        },
        required: ["suiteId"],
        additionalProperties: false,
        description: "PRD whose terminology/roles/architecture this one inherits",
      },
      references: {
        type: "array",
        items: {
          type: "object",
          properties: {
            suiteId: { type: "string", description: "Cross-referenced PRD suite" },
            versionId: { type: "string", description: "Pinned version; omit to follow its head" },
          },
          required: ["suiteId"],
          additionalProperties: false,
        },
        description: "Cross-referenced PRD suites consulted as design references",
      },
    },
    required: ["requirement"],
    additionalProperties: false,
  },
  sideEffects: ["write-in-cwd"],
};

// ── PRD 主题层（specs/prd-theme-layer）：参考 PRD 全文注入 ────────────────────
// 单篇预算/总预算（字符）：参考是上下文，不是要复制的产物——预算防失控，
// 截断处标注让模型知道不完整。
const SPEC_REFERENCE_PER_DOC_BUDGET = 8000;
const SPEC_REFERENCE_TOTAL_BUDGET = 24000;
/** 超预算后"仅列标题"行的硬上限——超过则折叠为一行省略说明。 */
const SPEC_REFERENCE_OVERFLOW_LIST_MAX = 20;

function truncateBudgeted(text: string, budget: number): string {
  return text.length <= budget ? text : `${text.slice(0, budget)}\n…[已截断：参考全文超出单篇预算]`;
}

/** 拉取继承/交叉参考 PRD 的 spec 全文并装配"参考 PRD"提示词区块。任何参考
 *  缺失（套件/版本不可用、无 spec、超总预算）都降级为缺失/标题行，绝不阻断
 *  生成；无任何参考时返回空串——提示词保持与无主题层时字节一致（无抖动）。 */
async function collectSpecReferenceBlock(
  ctx: ActionContext,
  inheritsFrom: DesignThemeRef | undefined,
  references: DesignThemeRef[] | undefined
): Promise<string> {
  const entries: Array<{ label: string; ref: DesignThemeRef }> = [];
  if (inheritsFrom?.suiteId?.trim()) entries.push({ label: "继承", ref: inheritsFrom });
  for (const ref of references ?? []) {
    if (ref.suiteId?.trim()) entries.push({ label: "交叉参考", ref });
  }
  if (entries.length === 0) return "";
  const lines: string[] = ["", "## 参考 PRD（设计参考上下文）"];
  let used = 0;
  // 交叉审查修复：超预算的"仅列标题"行本身也计入预算并有硬上限——否则
  // N 条参考=N 行提示词，预算形同虚设（条目数不可控时静默撑爆上下文）。
  let overflowListed = 0;
  let omitted = 0;
  for (const entry of entries) {
    if (used >= SPEC_REFERENCE_TOTAL_BUDGET) {
      if (overflowListed >= SPEC_REFERENCE_OVERFLOW_LIST_MAX) {
        omitted += 1;
        continue;
      }
      overflowListed += 1;
      const line = `### ${entry.label}（超出总预算，仅列标题）：${entry.ref.suiteId}`;
      used += line.length;
      lines.push(line);
      continue;
    }
    const read = await readSuiteVersion(ctx, entry.ref.suiteId, entry.ref.versionId);
    if (!read.ok || read.value.artifactRef.kind !== "prototype") {
      lines.push(
        `### 参考缺失：${entry.label} ${entry.ref.suiteId}${entry.ref.versionId ? ` @ ${entry.ref.versionId}` : ""}（套件或版本不可用，已跳过）`
      );
      continue;
    }
    const spec =
      "spec" in read.value.content && typeof read.value.content.spec === "string" ? read.value.content.spec.trim() : "";
    if (!spec) {
      lines.push(`### 参考缺失：${entry.label} ${read.value.title}（该 PRD 无需求文档，已跳过）`);
      continue;
    }
    const body = truncateBudgeted(spec, Math.min(SPEC_REFERENCE_PER_DOC_BUDGET, SPEC_REFERENCE_TOTAL_BUDGET - used));
    used += body.length;
    lines.push(
      `### ${entry.label}：${read.value.title}（${entry.ref.suiteId}${entry.ref.versionId ? ` @ ${entry.ref.versionId}` : " @ head"}）`
    );
    lines.push(body);
  }
  if (omitted > 0) {
    lines.push(`…（另有 ${omitted} 条参考超出预算，已省略）`);
  }
  lines.push("约束：延续参考 PRD 的术语/角色/架构约定，不复制其内容；与本次需求冲突时以本次需求为准。");
  return lines.join("\n");
}

// ── PRD 深度机械门（specs/prompt-doc-chain 交叉审查追加）────────────────────
// 历次"契约强化"失效的根因：深度要求全在 SKILL.md，落盘门只查"有任意标题"，
// 弱模型薄文档 100% 过门。此审计把深度变成可机械判定的结构事实，不过=带
// findings 修复一轮。

/** 单篇参考 PRD 的深度审计结论（findings 为空 = 达标）。 */
export function specSectionsAudit(markdown: string): string[] {
  const findings: string[] = [];
  const has = (re: RegExp): boolean => re.test(markdown);
  for (const section of ["背景与目标", "用户与场景", "功能需求", "数据与字段", "页面清单", "验收标准", "待确认"]) {
    if (!has(new RegExp(`^##\\s+.*${section}`, "m"))) {
      findings.push(`缺少「${section}」节`);
    }
  }
  // 功能需求表：≥3 行数据行且至少 1 条 P0。行计数占位感知（design-gates
  // countTableDataRows）——骨架模板行抄进产物不计数，缩进表行照常计数。
  const fnSection = sectionBody(markdown, "功能需求");
  const fnRows = countTableDataRows(fnSection);
  if (fnRows < 3) findings.push(`功能需求表仅有 ${fnRows} 行（需 ≥3 行模块/描述/优先级）`);
  if (fnSection && !/P0/.test(fnSection)) findings.push("功能需求缺少 P0 优先级条目");
  // 数据与字段：至少一张实体表 ≥2 数据行（同上占位感知）。
  const dataSection = sectionBody(markdown, "数据与字段");
  const dataRows = countTableDataRows(dataSection);
  if (dataRows < 3)
    findings.push(`数据与字段节缺实体字段表（仅 ${dataRows} 行，需实体/字段/类型/校验/示例 ≥2 数据行）`);
  // 页面清单：每页面ID 有 ### 明细节且 ≥2 条交互行。
  const pageList = parsePageList(markdown);
  if (pageList && pageList.hasIds) {
    for (const page of pageList.pages) {
      if (!page.id) continue;
      const detailRe = new RegExp(`^###\\s+.*${page.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "m");
      if (!detailRe.test(markdown)) {
        findings.push(`页面 ${page.name}(${page.id}) 缺「### ${page.id} 交互明细」小节`);
        continue;
      }
      const detailBody = sectionBody(markdown, page.id);
      const interactionLines = detailBody ? (detailBody.match(/→/g) ?? []).length : 0;
      if (interactionLines < 2) findings.push(`页面 ${page.id} 交互明细不足（需 ≥2 条 状态/事件 → 行为）`);
    }
  }
  // 验收标准：≥5 可勾选项（占位行 `- [ ] <…>` 不计——骨架抄写不达标）。
  const acceptSection = sectionBody(markdown, "验收标准");
  let checkboxes = 0;
  if (acceptSection) {
    for (const line of acceptSection.split("\n")) {
      if (/^-\s*\[\s*\]/.test(line) && !/^-\s*\[\s*\]\s*<[^>]+>/.test(line)) checkboxes += 1;
    }
  }
  if (checkboxes < 5) findings.push(`验收标准仅 ${checkboxes} 条可勾选项（需 ≥5 条覆盖 P0）`);
  return findings;
}

// ── 提示词文档链（specs/prompt-doc-chain）：pm-design.md ─────────────────────
/** pm-design.md 的产出契约：可执行的提示词文档（写给原型生成器的指令），
 *  不是 PRD 复述。 */
export const PM_DESIGN_CONTRACT =
  "It must be ONE markdown document: a `# ` title plus these `## ` sections in order — " +
  "`页面结构`（每页：目的 / 核心区块 / 入口与出口）、`交互叙事`（每页关键流：状态 / 跳转 / 反馈）、" +
  "`信息架构`（导航模型 / 层级 / 术语表）、`视觉基调`（关键词级基调，不写具体样式值）、" +
  '`平台策略`（目标端与密度策略）、`继承要点`（延续自参考 PRD 的约定；无参考则写"无"）。 ' +
  "Write every section as DIRECTIVES to a prototype generator (imperative, executable), " +
  "not a restatement of the PRD. Do not invent pages beyond the PRD's 页面清单.";

/** 生成 pm-design.md：spec（契约源）+ 参考 PRD 上下文 → deep-design 子代理 →
 *  嵌套围栏感知抽取 + 轻结构门（# 标题 + ≥2 个 ## 节）。供独立动作与
 *  materialize stage0 复用——两条路产出完全一致。 */
async function generatePmDesignDocument(
  ctx: ActionContext,
  spec: string,
  inheritsFrom: DesignThemeRef | undefined,
  references: DesignThemeRef[] | undefined
): Promise<{ ok: true; document: string } | { ok: false; error: string; findings?: string[] }> {
  if (!ctx.runSubagent) return { ok: false, error: "runSubagent not available" };
  const referenceBlock = await collectSpecReferenceBlock(ctx, inheritsFrom, references);
  // specs/design-stage-gates：迁共享引擎——生成/瞬态重试/审计/修复轮/错误
  // findings 明细统一由 runDesignStage 承载，本函数只保留 pd 特有的提示词
  // 装配（契约 + 参考块）与抽取规则（markdown + # 标题 + 归一化）。
  const buildPrompt = (findings: string[] | null): string => {
    const base =
      "Analyze the requirements document below and distill it into a pm-design prompt document. " +
      "It drives a prototype generator afterwards — every section must be a directive, not prose. " +
      PM_DESIGN_CONTRACT +
      " Do not call tools. " +
      "Return only the complete markdown document in one markdown code fence.\n\n" +
      "## 需求文档（契约源）\n" +
      spec +
      (referenceBlock ? "\n" + referenceBlock : "");
    if (findings && findings.length > 0) {
      return base + "\n\n## 深度审计 findings（逐条修复，不得删节）\n" + findings.map((f) => "- " + f).join("\n");
    }
    return base;
  };
  const result = await runDesignStage(ctx, {
    stage: "pm-design",
    skill: "deep-design",
    buildPrompt,
    extract: (content) => {
      // {content} 包装走嵌套围栏感知树（同上——字符串直入会在内层围栏截断）。
      const doc = content === null ? null : extractMarkdownDocument({ content });
      if (!doc || !/^#\s+/m.test(doc)) return null;
      return normalizeGeneratedMarkdown(doc);
    },
    audit: pmSectionsAudit,
    maxRepairs: 1,
    progressCode: "prototype.pmdesign.repairing",
    basePercent: 40,
  });
  return result.ok
    ? { ok: true, document: result.document }
    : { ok: false, error: result.error, findings: result.findings };
}

export const prototypeSpecRun: ActionRun<PrototypeSpecInput, PrototypeSpecOutput> = async (input, ctx) => {
  const requirement = input?.requirement?.trim();
  const suiteId = input?.suiteId?.trim();
  const baseVersionId = input?.baseVersionId?.trim();
  if (!requirement) return { ok: false, error: "requirement is required" };
  if (baseVersionId && !suiteId) return { ok: false, error: "baseVersionId requires suiteId" };
  if (!ctx.runSubagent) return { ok: false, error: "runSubagent not available" };

  ctx.emit({
    message: "Generating the structured prototype specification",
    percent: 30,
    data: { code: "prototype.spec.generating" },
  });
  try {
    const referenceBlock = await collectSpecReferenceBlock(ctx, input?.inheritsFrom, input?.references);
    // specs/prompt-doc-chain 交叉审查：骨架内联（单源 SPEC_SKELETON——
    // SKILL.md 撤模板改方法论，防漂移顾虑由单源化消除）。弱模型"填空"
    // 远强于"读文档自由发挥"——这是历次契约强化失效后的机械补强第一半。
    const generated = await callSubagentStable(
      ctx,
      {
        skill: "spec-writer",
        prompt:
          "Write the complete structured PRD for the requirement below. " +
          "Fill the EXACT skeleton below section-for-section — do not rename, reorder, or drop " +
          "sections; replace every <placeholder> with concrete content. " +
          "Do not call tools. " +
          "Return only the complete markdown document in one markdown code fence.\n\n" +
          "## 骨架（逐节填充）\n" +
          SPEC_SKELETON +
          "\n\n## 需求\n" +
          requirement +
          (referenceBlock ? `\n${referenceBlock}` : ""),
        silent: true,
      },
      "spec-generate"
    );
    // PRD 内嵌 ```mermaid 图(标准化格式),必须用嵌套围栏感知抽取,否则文档
    // 在第一张图处被截断且 looksLikeSpecDocument 拦不住(任意标题即过)。
    // specs/design-stage-gates：归一化先行（缩进表格行确定性修复）——归一化
    // 后的文档才是审计与落盘对象（OCR 确定性优先借鉴）。callSubagentStable
    // 返回内容字符串——包回 {content} 形态走嵌套围栏感知树（字符串直入会
    // 退化成单围栏惰性抽取，mermaid 文档在第一个内层围栏截断）。
    const extracted = generated === null ? null : extractMarkdownDocument({ content: generated });
    let document = extracted === null ? null : normalizeGeneratedMarkdown(extracted);
    if (!document || !looksLikeSpecDocument(document)) {
      return {
        ok: false,
        error: "spec-writer returned an empty or section-less requirements document (truncated output?) — regenerate",
      };
    }
    // 深度机械门（交叉审查追加）：结构不全 → 带 findings 修复一轮（机械补强
    // 第二半）。与 openui 修复环同构：fail-closed,两轮耗尽仍薄则拒绝落盘。
    let findings = specSectionsAudit(document);
    if (findings.length > 0) {
      ctx.emit({
        message: `PRD depth gate: repairing ${findings.length} finding(s)`,
        percent: 55,
        data: { code: "prototype.spec.repairing" },
      });
      const findingsText = findings.map((finding) => `- ${finding}`).join("\n");
      const repaired = await callSubagentStable(
        ctx,
        {
          skill: "spec-writer",
          prompt:
            "The PRD below FAILED the depth audit. Fix EVERY finding by expanding the document in place — " +
            "keep all existing correct content, fill the missing sections/tables/details. " +
            "Do not call tools. Return only the complete corrected markdown document in one markdown code fence.\n\n" +
            "## 深度审计 findings\n" +
            findingsText +
            "\n\n## 当前 PRD\n" +
            document,
          silent: true,
        },
        "spec-repair"
      );
      const repairedExtracted = repaired === null ? null : extractMarkdownDocument({ content: repaired });
      const repairedDocument = repairedExtracted === null ? null : normalizeGeneratedMarkdown(repairedExtracted);
      if (!repairedDocument || !looksLikeSpecDocument(repairedDocument)) {
        return {
          ok: false,
          error:
            "spec-writer repair round returned an unusable document — " + `original findings: ${findings.join("; ")}`,
        };
      }
      const remaining = specSectionsAudit(repairedDocument);
      if (remaining.length > 0) {
        return {
          ok: false,
          error: `PRD depth gate still failing after repair: ${remaining.join("; ")}`,
        };
      }
      // 修复产物替换落盘文档——否则修复轮白跑，薄文档原样持久化。
      document = repairedDocument;
      findings = remaining;
    }
    if (ctx.signal.aborted) return { ok: false, error: "cancelled" };
    const saved = await executeA2ui(ctx, "render_spec", {
      document,
      requirement,
      ...(suiteId ? { suiteId } : {}),
      ...(baseVersionId ? { versionId: baseVersionId } : {}),
      // 主题字段随 PRD 落套件 meta（specs/prd-theme-layer WP3）。
      ...(input?.themeId?.trim() ? { themeId: input.themeId.trim() } : {}),
      ...(input?.stage?.trim() ? { stage: input.stage.trim() } : {}),
      ...(input?.inheritsFrom?.suiteId?.trim()
        ? {
            inheritsSuiteId: input.inheritsFrom.suiteId.trim(),
            ...(input.inheritsFrom.versionId?.trim() ? { inheritsVersionId: input.inheritsFrom.versionId.trim() } : {}),
          }
        : {}),
      ...(input?.references && input.references.length > 0
        ? {
            references: input.references
              .filter((ref) => ref.suiteId?.trim())
              .map((ref) => ({
                suiteId: ref.suiteId.trim(),
                ...(ref.versionId?.trim() ? { versionId: ref.versionId.trim() } : {}),
              })),
          }
        : {}),
      note: input.note?.trim() || (suiteId ? "prototype specification revision" : "initial prototype specification"),
    });
    if (!saved.ok) return saved;
    ctx.emit({ message: "Prototype specification saved", percent: 100, data: { code: "prototype.spec.saved" } });
    return { ok: true, artifactRef: saved.artifactRef, refreshStore: !saved.artifactRef };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
};

export interface PrototypePmDesignInput {
  suiteId: string;
  versionId?: string;
  note?: string;
}

export interface PrototypePmDesignOutput {
  ok: boolean;
  artifactRef?: ArtifactRef;
  refreshStore?: boolean;
  error?: string;
}

/** specs/prompt-doc-chain：PRD → pm-design.md（原型提示词文档）。materialize
 *  stage0 的手动重算入口——同一条生成路径（generatePmDesignDocument）。 */
export const prototypePmDesignDefinition: ActionDefinition<PrototypePmDesignInput> = {
  id: "prototype.pmdesign",
  description:
    "Analyze the requirements document (with inherited/cross-referenced PRD context) into pm-design.md — " +
    "the distilled prompt document that drives prototype generation.",
  category: "design",
  parameters: {
    type: "object",
    properties: {
      suiteId: { type: "string", description: "Prototype suite to distill the prompt document for" },
      versionId: { type: "string", description: "Suite version to read; omit for the current head" },
      note: { type: "string", description: "Optional version note" },
    },
    required: ["suiteId"],
    additionalProperties: false,
  },
  sideEffects: ["write-in-cwd"],
};

export const prototypePmDesignRun: ActionRun<PrototypePmDesignInput, PrototypePmDesignOutput> = async (input, ctx) => {
  const suiteId = input?.suiteId?.trim();
  if (!suiteId) return { ok: false, error: "suiteId is required" };
  if (!ctx.runSubagent) return { ok: false, error: "runSubagent not available" };
  const read = await readSuiteVersion(ctx, suiteId, input?.versionId?.trim() || undefined);
  if (!read.ok) return read;
  if (read.value.artifactRef.kind !== "prototype") return { ok: false, error: "suite is not a prototype suite" };
  const spec =
    "spec" in read.value.content && typeof read.value.content.spec === "string" ? read.value.content.spec.trim() : "";
  if (!spec) return { ok: false, error: "requirements document not found; run prototype.spec first" };

  ctx.emit({
    message: "Distilling the pm-design prompt document",
    percent: 30,
    data: { code: "prototype.pmdesign.generating" },
  });
  const generated = await generatePmDesignDocument(ctx, spec, read.value.inherits, read.value.references);
  if (!generated.ok) return { ok: false, error: generated.error };
  if (ctx.signal.aborted) return { ok: false, error: "cancelled" };
  const saved = await executeA2ui(ctx, "save_pm_design", {
    document: generated.document,
    suiteId,
    ...(read.value.artifactRef.versionId ? { versionId: read.value.artifactRef.versionId } : {}),
    ...(input?.note?.trim() ? { note: input.note.trim() } : {}),
  });
  if (!saved.ok) return saved;
  ctx.emit({ message: "pm-design document saved", percent: 100, data: { code: "prototype.pmdesign.saved" } });
  return { ok: true, artifactRef: saved.artifactRef, refreshStore: !saved.artifactRef };
};

export interface PrototypeMaterializeInput {
  suiteId?: string;
  versionId?: string;
  specArtifactId?: string;
  /** 目标平台(user ask 2026-09-09):缺省只生成桌面;传 ["desktop","mobile","tablet"]
   *  生成三端结构化变体,每端一次生成 + 解析修复循环。 */
  devices?: string[];
  note?: string;
}

export type PrototypeMaterializeOutput = PrototypeSpecOutput;

export const prototypeMaterializeDefinition: ActionDefinition<PrototypeMaterializeInput> = {
  id: "prototype.materialize",
  description:
    "Materialize a prototype suite specification into OpenUI Lang. Suite/version is preferred; specArtifactId remains supported for legacy artifacts.",
  category: "design",
  parameters: {
    type: "object",
    properties: {
      suiteId: { type: "string", description: "Prototype suite id" },
      versionId: { type: "string", description: "Prototype suite version containing the specification" },
      specArtifactId: { type: "string", description: "Legacy specification artifact id" },
      devices: {
        type: "array",
        items: { type: "string", enum: ["desktop", "mobile", "tablet"] },
        description:
          "Target platforms. Omit to derive from the PRD's 目标平台 declaration (WP0); " +
          "legacy PRDs without a declaration default to desktop-only.",
      },
      note: { type: "string", description: "Optional version note" },
    },
    additionalProperties: false,
  },
  sideEffects: ["write-in-cwd"],
};

export const prototypeMaterializeRun: ActionRun<PrototypeMaterializeInput, PrototypeMaterializeOutput> = async (
  input,
  ctx
) => {
  const suiteId = input?.suiteId?.trim();
  const versionId = input?.versionId?.trim();
  const legacyId = input?.specArtifactId?.trim();
  if ((suiteId && !versionId) || (!suiteId && versionId)) {
    return { ok: false, error: "suiteId and versionId must be provided together" };
  }
  if (!suiteId && !legacyId) return { ok: false, error: "suiteId/versionId or specArtifactId is required" };
  if (!ctx.runSubagent) return { ok: false, error: "runSubagent not available" };

  let spec: string | null = null;
  let requirement: string | undefined;
  // specs/prompt-doc-chain：版本快照里的 pm-design 与主题参考（suite 路径）。
  let storedPmDesign: string | null = null;
  let themeRefs: { inherits?: DesignThemeRef; references?: DesignThemeRef[] } = {};
  if (suiteId && versionId) {
    const read = await readSuiteVersion(ctx, suiteId, versionId);
    if (!read.ok) return read;
    if (read.value.artifactRef.kind !== "prototype") return { ok: false, error: "suite is not a prototype suite" };
    const content = read.value.content as PrototypeSuiteContent;
    spec = content.spec?.trim() || null;
    requirement = content.requirement;
    storedPmDesign = content.pmDesign?.trim() || null;
    themeRefs = {
      ...(read.value.inherits ? { inherits: read.value.inherits } : {}),
      ...(read.value.references ? { references: read.value.references } : {}),
    };
  } else if (legacyId) {
    spec = readArtifactFile(ctx.projectRoot, legacyId, SPEC_FILE);
  }
  if (!spec) return { ok: false, error: "requirements document not found; run prototype.spec first" };

  // WP0 指令遵循主线:devices 缺省时由 PRD 的目标平台声明决定生成端——
  // mobile-only 产品不付 desktop 生成的代价;PRD 未声明(legacy)只出 desktop,
  // verify 会补「平台未声明」观察项推动补 PRD。显式 devices 仍是最高优先。
  const declaredPlatforms = extractTargetPlatforms(spec);
  const devices: OpenuiDevice[] =
    input?.devices && input.devices.length > 0
      ? normalizeOpenuiDevices(input.devices)
      : declaredPlatforms
        ? normalizeOpenuiDevices(declaredPlatforms)
        : ["desktop"];
  // legacy artifact 路径(无 suite)没有版本链与 openuiVariants 变体槽:逐端
  // render 只会各存一个互不关联的独立 artifact、且只回传最后一个(last-write-
  // wins)——收敛为单一主端(desktop 优先),多端平台化必须走 suite 路径。
  const renderDevices: OpenuiDevice[] = suiteId
    ? devices
    : [devices.includes("desktop") ? "desktop" : (devices[0] ?? "desktop")];
  try {
    // 平台化适配(user ask 2026-09-09):每个设备一次独立生成——各端是导航
    // 模型/列布局/密度结构性不同的程序(设备契约见 openui-contract),不是
    // 同一程序挤宽度。desktop 是本体(openui 字段),mobile/tablet 落
    // openuiVariants,由 render_openui(device) 分流。
    let artifactRef: ArtifactRef | undefined;
    // WP1.1 head 线程化:每端 render_openui 追加新版本后 head 前移,下一端
    // 必须以最新 head 为基线——循环里沿用输入 versionId 会在第二端撞
    // readSuiteBase 的 head-moved 守卫(fix-all 同款坑,修复同款)。
    let baseVersionId = versionId;
    // specs/prompt-doc-chain stage0：所选版本无 pm-design 时自动蒸馏（有则
    // 直接用——手动重算语义由 prototype.pmdesign 承载）。交叉审查修复：stage0
    // 保存走 preserveDerived——不清空 openui/variants/verification/arch（同一
    // 动作内紧随的 render_openui 会重建派生物；清空会在生成失败/取消时把
    // 用户既有原型从 head 上抹掉）。重置语义只属于手动重算（意图变更、不伴
    // 随再生成）。
    let pmDesign: string | null = storedPmDesign;
    if (suiteId && !pmDesign) {
      ctx.emit({
        message: "Distilling the pm-design prompt document",
        percent: 10,
        data: { code: "prototype.pmdesign.generating" },
      });
      const distilled = await generatePmDesignDocument(ctx, spec, themeRefs.inherits, themeRefs.references);
      if (distilled.ok) {
        if (ctx.signal.aborted) return { ok: false, error: "cancelled" };
        const savedPd = await executeA2ui(ctx, "save_pm_design", {
          document: distilled.document,
          preserveDerived: true,
          suiteId,
          ...(baseVersionId ? { versionId: baseVersionId } : {}),
          ...(input.note?.trim() ? { note: input.note.trim() } : {}),
        });
        if (!savedPd.ok) return savedPd;
        pmDesign = distilled.document;
        // head 前移：save_pm_design 追加了新版本，设备循环以新 head 为基线。
        // 真机走查加固：无 ref = 落盘事实缺失，大声失败（静默继续会在设备
        // 循环里以过期 base 撞 head-moved 守卫或无声丢版本）。
        if (!savedPd.artifactRef) {
          return {
            ok: false,
            error:
              "save_pm_design reported success without a persisted artifact ref — stage0 cannot thread the new head",
          };
        }
        baseVersionId = savedPd.artifactRef.versionId;
        // 交叉审查修复：自动路径同样发射 saved 终态码（此前只有手动动作发）。
        ctx.emit({
          message: "pm-design document saved",
          percent: 45,
          data: { code: "prototype.pmdesign.saved" },
        });
      } else {
        // specs/design-stage-gates（OCR plan-failure 分层借鉴）：stage0 自动
        // 蒸馏是增强阶段——失败降级到 spec 直驱的既有提示词（与无 pm-design
        // 的旧路径字节一致），绝不因提示词文档失败阻塞原型化。手动重算
        // （prototype.pmdesign）保持 fail-closed：显式动作产物即契约。
        ctx.emit({
          message: `pm-design distillation failed — falling back to spec-driven generation (${distilled.error})`,
          percent: 45,
          data: { code: "prototype.materialize.degraded" },
        });
        pmDesign = null;
      }
    }
    for (const [index, device] of renderDevices.entries()) {
      // 进度码保持稳定契约:单设备(缺省)与旧版完全一致(一次 generating);
      // 多设备才发每端进度,码不变,renderer i18n 无需新增。
      if (renderDevices.length > 1) {
        ctx.emit({
          message: `[${index + 1}/${renderDevices.length}] ${device} — generating the OpenUI prototype`,
          percent: 15 + Math.round((index / renderDevices.length) * 70),
          data: { code: "prototype.materialize.generating", device },
        });
      } else {
        ctx.emit({
          message: "Generating OpenUI prototype from the selected specification",
          percent: 50,
          data: { code: "prototype.materialize.generating" },
        });
      }
      // specs/prompt-doc-chain：pm-design 存在时为主驱动（spec 降为范围契约
      // 源）；不存在时提示词与既有行为字节一致（旧数据零回归）。
      const pdSection = pmDesign
        ? "\n\n## pm-design（设计意图——主驱动）\n" + pmDesign + "\n\n## 需求文档（范围契约源）\n" + spec
        : "\n\n" + spec;
      const generated = await callSubagentStable(
        ctx,
        {
          skill: "pm-designer-openui",
          prompt:
            (pmDesign
              ? "Create the complete OpenUI Lang prototype from the distilled design intent below. "
              : "Create the complete OpenUI Lang prototype for the requirements document below. ") +
            OPENUI_DEVICE_CONTRACTS[device] +
            " " +
            // 契约单一来源(openui-contract.ts):单应用 $page 结构 + 质量底线
            // (可交互/高保真/可编辑),详情见技能的质量契约节,提示词不另行复述。
            OPENUI_CREATE_CONTRACT +
            " " +
            OPENUI_QUALITY_CONTRACT +
            // PRD 遵守契约（p-core 真机走查：遵守声明太抽象，模型会"意思一下"）——
            // 逐页、逐优先级、逐三态点名，生成后 verify 也按页面ID逐页比对。
            " PRD compliance is non-negotiable: (1) EVERY page in the 页面清单/pm-design " +
            "页面结构 gets its own view and its page id appears as a $page value, reachable " +
            "in one click; (2) EVERY P0 功能需求 row is visibly implemented — its 交互要点 " +
            "states (empty/loading/error-and-retry) each render a distinct branch; (3) the " +
            "逐页交互明细 lines are implemented literally as written; (4) do not invent " +
            "pages, fields, or flows beyond the document. " +
            "Do not call tools. " +
            "Return only the OpenUI Lang program in one code fence." +
            pdSection,
          silent: true,
        },
        `materialize-${device}`
      );
      const code = extractGeneratedBody(generated);
      if (!code || !looksLikeOpenuiProgram(code)) {
        return {
          ok: false,
          error:
            `pm-designer-openui returned an empty or truncated OpenUI program for ${device} ` +
            "(no root/component statements) — regenerate",
        };
      }
      // specs/prompt-doc-chain 稳定性强化 + specs/design-stage-gates S4：
      // 页面覆盖门（PRD 页面清单的每个页面 ID 必须以 $page 比较/跳转出现）
      // 与交互密度门（组件数/Action 数/页面可达性）合并注入修复契约
      // （只对 desktop 主体验证一次，多端走 verify 兜底；fail-open 层）。
      let coverageNote = "";
      if (device === "desktop" || renderDevices.length === 1) {
        const missing = pageCoverageFindings(spec, code);
        const density = openuiInteractivityFindings(spec, code);
        const notes: string[] = [];
        if (missing.length > 0) {
          notes.push(` Missing pages (must add as $page values with views): ${missing.join(", ")}.`);
        }
        for (const finding of density) notes.push(` ${finding}.`);
        coverageNote = notes.join("");
      }
      // Local validation loop: official parser verdict → patch prompt → retry,
      // BEFORE persistence (user ask 2026-09-09). Fail-open when the desktop
      // side has no validator. 修复环契约带设备契约:重生成时不得退回桌面壳。
      const coverageContract = coverageNote
        ? `${OPENUI_CREATE_CONTRACT} ${OPENUI_DEVICE_CONTRACTS[device]}${coverageNote}`
        : `${OPENUI_CREATE_CONTRACT} ${OPENUI_DEVICE_CONTRACTS[device]}`;
      const verifiedCode = await repairOpenuiProgram(ctx, {
        code,
        contract: coverageContract,
        progressCode: "prototype.materialize.repairing",
        basePercent: renderDevices.length > 1 ? 15 + Math.round(((index + 0.5) / renderDevices.length) * 70) : 55,
      });
      if (ctx.signal.aborted) return { ok: false, error: "cancelled" };
      const saved = await executeA2ui(ctx, "render_openui", {
        code: verifiedCode,
        device,
        ...(requirement ? { requirement } : {}),
        ...(suiteId ? { suiteId, ...(baseVersionId ? { versionId: baseVersionId } : {}) } : {}),
        ...(input.note?.trim() ? { note: input.note.trim() } : {}),
      });
      if (!saved.ok) return saved;
      // p-core 真机走查加固：render_openui 报成功却解析不到 ArtifactRef =
      // 没有可验证的落盘事实——大声失败，绝不静默"成功"（refreshStore 路径
      // 会把无声丢失伪装成"只需刷新"）。suite 路径必有 ref。
      if (!saved.artifactRef) {
        return {
          ok: false,
          error: `render_openui reported success without a persisted artifact ref (device ${device}) — suite persistence did not happen`,
        };
      }
      artifactRef = saved.artifactRef;
      baseVersionId = saved.artifactRef.versionId;
    }
    ctx.emit({
      message: "OpenUI prototype saved with verification pending",
      percent: 100,
      data: { code: "prototype.materialize.saved" },
    });
    return { ok: true, artifactRef, refreshStore: !artifactRef };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
};

export interface PrototypeVerifyInput {
  suiteId: string;
  versionId: string;
  checks?: Array<{ id?: string; label: string; passed: boolean; observation?: string }>;
  note?: string;
}

export interface PrototypeVerifyOutput extends PrototypeSpecOutput {
  verification?: PrototypeVerificationResult;
}

export const prototypeVerifyDefinition: ActionDefinition<PrototypeVerifyInput> = {
  id: "prototype.verify",
  description:
    "Run deterministic structural verification over a prototype suite version and persist the result. This does not claim browser testing.",
  category: "design",
  parameters: {
    type: "object",
    properties: {
      suiteId: { type: "string" },
      versionId: { type: "string" },
      checks: {
        type: "array",
        description: "Optional externally observed checks to summarize with the deterministic checks",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            label: { type: "string" },
            passed: { type: "boolean" },
            observation: { type: "string" },
          },
          required: ["label", "passed"],
          additionalProperties: false,
        },
      },
      note: { type: "string" },
    },
    required: ["suiteId", "versionId"],
    additionalProperties: false,
  },
  sideEffects: ["write-in-cwd"],
};

/**
 * Dead-button findings over an OpenUI program — the deterministic core of
 * WP2.3 (design.lint reuses this single source). Two shapes:
 *  - `Action([])` — a wired-but-empty action list; the button does nothing.
 *  - bare-string second positional arg (`Button("x", "submit:login")`) —
 *    compiles against the passthrough schema but throws at click time in the
 *    official library (silent dead button; the renderer audit catches the
 *    double-quoted literal, this also catches single quotes).
 */
export function findDeadButtons(code: string): string[] {
  const findings: string[] = [];
  // 骨架化(交叉审查遗留修复):把所有字符串字面量的「内容」清空后再检测——
  // `Text("不要写 Action([]) 占位")` 或注释性文本里的同形片段不再误报;结构
  // (引号本身)保留,Button("x", "act") 的第二参字符串形态仍可检出。
  const skeleton = code.replace(/"([^"\\]|\\.)*"/g, '""').replace(/'([^'\\]|\\.)*'/g, "''");
  if (/Action\(\s*\[\s*\]\s*\)/.test(skeleton)) {
    findings.push(`empty Action([]) — the button does nothing when clicked`);
  }
  if (/\bButton\(\s*"[^"]*"\s*,\s*('[^']*'|"[^"]*")\s*[,)]/.test(skeleton)) {
    // 第二位置参数只能是 Action 表达式;任何字符串(含误传的 variant 值)都是
    // 参数错位/死按钮——官方库把字符串 action 在点击时静默抛错。
    findings.push(`bare-string button action — the second argument must be Action([...]), never a string`);
  }
  return findings;
}

function hasPageList(spec: string): boolean {
  // \b can never match after a CJK alternative (CJK chars are non-word, the
  // boundary needs a following word char) — pin the boundary to the latin
  // alternatives only, else Chinese headings like "## 页面清单" never verify.
  return /(?:^|\n)#{1,6}\s*(?:\d+[.)、]?\s*)?(?:页面清单(?![A-Za-z0-9_])|page\s+list\b|pages\b)/im.test(spec);
}

export const prototypeVerifyRun: ActionRun<PrototypeVerifyInput, PrototypeVerifyOutput> = async (input, ctx) => {
  const suiteId = input?.suiteId?.trim();
  const versionId = input?.versionId?.trim();
  if (!suiteId || !versionId) return { ok: false, error: "suiteId and versionId are required" };
  const read = await readSuiteVersion(ctx, suiteId, versionId);
  if (!read.ok) return read;
  if (read.value.artifactRef.kind !== "prototype") return { ok: false, error: "suite is not a prototype suite" };
  const content = read.value.content as PrototypeSuiteContent;
  const spec = content.spec?.trim() ?? "";
  const openui = content.openui?.trim() ?? "";
  // 确定性四项每次重算;此前版本里的非确定性检查(revise 追加的 pending 观察
  // 项、外部 checks)必须随行——文档化回路是"revise 加观察 → 重新 verify",
  // 整体替换的 save_suite_result 若不携带就会把 pending 项静默清掉。
  // 机械检查的 id 前缀:每次重算,携带时按前缀淘汰旧实例(否则一次 verify
  // 累积一批过期检查)。交叉审查修正(2026-09-10):统一 auto: 保留命名空间——
  // 此前 nav-/page-/coverage- 等通用前缀会把调用方按同前缀命名的外部 checks
  // (如 nav-smoke-test)在下一次 verify 时静默丢弃;auto: 是保留前缀。
  const deterministicIds = new Set(["spec-non-empty", "page-list-present", "openui-non-empty", "openui-root"]);
  const deterministicPrefixes = ["auto:"];
  const isMechanical = (id: string): boolean =>
    deterministicIds.has(id) || deterministicPrefixes.some((prefix) => id.startsWith(prefix));
  const variants = content.openuiVariants ?? {};
  // 交叉审查修正(2026-09-10):mobile-only PRD 的正常产物只有变体没有本体——
  // 「程序存在」必须按任一端判定,否则 WP0 招牌场景被桌面本位检查永久判死。
  const variantsExist = Boolean(variants.mobile?.trim() || variants.tablet?.trim());
  const carried = (content.verification?.checks ?? []).filter((check) => !isMechanical(check.id));
  const checks: PrototypeVerificationCheck[] = [
    ...carried,
    { id: "spec-non-empty", label: "Specification is non-empty", status: spec ? "passed" : "failed" },
    {
      id: "page-list-present",
      label: "Specification declares a page list",
      status: hasPageList(spec) ? "passed" : "failed",
    },
    {
      id: "openui-non-empty",
      label: "A prototype program exists (base or any platform variant)",
      status: openui || variantsExist ? "passed" : "failed",
    },
    {
      id: "openui-root",
      label: "The base program declares root (when present)",
      status: !openui || /(?:^|\n)\s*root\s*=/.test(openui) ? "passed" : "failed",
    },
  ];
  // ── WP0.4 平台一致性:PRD 声明端 vs 实际生成端 ──
  // 声明端(目标平台行)决定"应该有哪些端";生成端 = 本体(desktop)+ 变体槽。
  // 缺端 failed(声明了 mobile 却没生成)、多端 warning(生成了未声明端)、
  // 未声明(legacy PRD)观察项推动补 PRD——指令遵循的验收闭环。
  const generatedDevices = new Set<string>(openui ? ["desktop"] : []);
  for (const device of ["mobile", "tablet"] as const) {
    if (variants[device]?.trim()) generatedDevices.add(device);
  }
  const declared = extractTargetPlatforms(spec);
  if (!declared) {
    checks.push({
      id: "auto:platform-undeclared",
      label: "PRD declares target platforms (目标平台)",
      status: "pending",
      observation: "PRD 未声明目标平台——重新生成需求文档时补充「目标平台」行,materialize 将按声明决定生成端。",
    });
  } else {
    for (const device of declared) {
      if (!generatedDevices.has(device)) {
        checks.push({
          id: `auto:platform-${device}-missing`,
          label: `PRD-declared platform "${device}" was generated`,
          status: "failed",
          observation: `PRD 声明 ${device} 端但该端程序缺失——重新 materialize(或补 devices)后重验。`,
        });
      }
    }
    for (const device of generatedDevices) {
      if (!declared.includes(device as (typeof declared)[number])) {
        checks.push({
          id: `auto:platform-${device}-extra`,
          label: `Generated platform "${device}" is PRD-declared`,
          status: "pending",
          observation: `生成了 PRD 未声明的 ${device} 端——确认是否为有意补充,否则从 PRD 或原型中移除。`,
        });
      }
    }
  }

  // ── WP2.2 指令遵循:对每个已生成端跑 导航闭包/死页面/页面覆盖 + 死按钮 ──
  const pageList = parsePageList(spec);
  const programs: Array<{ device: string; code: string }> = [
    ...(openui ? [{ device: "desktop", code: openui }] : []),
    ...(["mobile", "tablet"] as const)
      .map((device) => ({ device, code: variants[device]?.trim() ?? "" }))
      .filter((entry) => entry.code),
  ];
  for (const { device, code } of programs) {
    const suffix = device === "desktop" ? "" : `-${device}`;
    // 平台变体结构检查:root 必须有;distinct 用组件指纹(WP4.2)——换名副本
    // 组件构成不变(Jaccard≥阈值 → 同构 failed),真平台壳(底部 tab vs 侧栏、
    // 卡片流 vs 表格)构成实质不同 → 低分通过。
    if (device !== "desktop") {
      checks.push({
        id: `auto:variant${suffix}-root`,
        label: `${device} platform variant declares its own root`,
        status: /(?:^|\n)\s*root\s*=/.test(code) ? "passed" : "failed",
      });
      const similarity = componentJaccard(openui, code);
      checks.push({
        id: `auto:variant${suffix}-distinct`,
        label: `${device} platform variant is a structurally distinct program`,
        status: similarity >= 0.92 ? "failed" : "passed",
        ...(similarity >= 0.92
          ? {
              observation: `组件构成与桌面端几乎一致(Jaccard ${similarity.toFixed(2)})——疑似同一程序换名/微调,重生成该端以获得平台化结构(导航壳与布局语法应不同)。`,
            }
          : {}),
      });
    }
    // 导航闭包:@Set 目标必须是已比较页面(否则点了没视图可切)。
    const pages = extractProgramPages(code);
    const known = new Set([...pages.comparisons, ...(pages.initial ? [pages.initial] : [])]);
    for (const target of pages.navTargets) {
      if (!known.has(target)) {
        checks.push({
          id: `auto:nav${suffix}-${target}-dangling`,
          label: `Navigation target "${target}" has a matching $page view`,
          status: "failed",
          observation: `@Set($page, "${target}") 指向未声明/未比较的页面——拼写错误或缺失视图分支。`,
        });
      }
    }
    // 死页面:被比较但无人导航到、也不是初始页( Axure 页面树的孤儿页检查)。
    for (const page of known) {
      if (page !== pages.initial && !pages.navTargets.has(page)) {
        checks.push({
          id: `auto:page${suffix}-${page}-orphan`,
          label: `Page "${page}" is reachable via navigation`,
          status: "failed",
          observation: `页面 "${page}" 有视图分支但没有任何 @Set 导航到它(也非初始页)——补入口或删除分支。`,
        });
      }
    }
    // 页面覆盖:有 ID 列逐页比对(PRD 页缺实现 failed/程序多页 warning);
    // 旧 PRD 无 ID 列降级为数量比对(不误杀,只观察)。
    if (pageList) {
      if (pageList.hasIds) {
        const ids = new Set(pageList.pages.map((page) => page.id));
        for (const page of pageList.pages) {
          if (!known.has(page.id!)) {
            checks.push({
              id: `auto:coverage${suffix}-${page.id}-missing`,
              label: `PRD page "${page.name}" (${page.id}) is implemented`,
              status: "failed",
              observation: `页面清单中的「${page.name}」未出现在 $page 页面集——原型未覆盖 PRD。`,
            });
          }
        }
        for (const page of known) {
          if (!ids.has(page)) {
            checks.push({
              id: `auto:coverage${suffix}-${page}-extra`,
              label: `Program page "${page}" exists in the PRD page list`,
              status: "pending",
              observation: `程序页面 "${page}" 不在页面清单中——确认是否为有意补充(如详情子页)。`,
            });
          }
        }
      } else {
        const prdCount = pageList.pages.length;
        const programCount = known.size;
        if (prdCount !== programCount) {
          checks.push({
            id: `auto:coverage${suffix}-count`,
            label: "Program page count matches the PRD page list",
            status: "pending",
            observation: `PRD 列出 ${prdCount} 页,程序 ${programCount} 页(旧格式 PRD 无页面 ID 列,仅数量比对)——重新生成需求文档可启用逐页比对。`,
          });
        }
      }
    }
    // 死按钮(WP2.3 的 core 确定性面;渲染前修复环另有 validate verdict)。
    for (const [index, finding] of findDeadButtons(code).entries()) {
      checks.push({
        id: `auto:dead-button${suffix}-${index + 1}`,
        label: `No dead buttons${suffix ? ` (${device})` : ""}`,
        status: "failed",
        observation: finding,
      });
    }
  }
  for (const [index, check] of (input.checks ?? []).entries()) {
    // auto:/确定性 id 是保留命名空间:机械 pending 检查每次 verify 重算,外部
    // 输入(renderer 消项按钮/agent)既覆写不到也不能追加——否则一条 passed
    // 副本与重算的 pending 项同 id 并存,整体状态永卡 pending(消项死按钮)。
    // 静默跳过:机械项由重算机制自清,不需要人工消项。
    if (check.id && isMechanical(check.id.trim())) continue;
    const resolved: PrototypeVerificationCheck = {
      id: check.id?.trim() || `external-${index + 1}`,
      label: check.label,
      status: check.passed ? "passed" : "failed",
      ...(check.observation?.trim() ? { observation: check.observation.trim() } : {}),
    };
    // 按 id 消项:传入的 check 若命中已随行的观察项,则覆写其状态(这是
    // "revise 加观察 → 处理 → verify 消项"回路的结算端),否则作为新外部项追加。
    // 机械 id 已在上方被跳过,这里的匹配天然只落在外部/随行观察项上。
    const carriedIndex = checks.findIndex((existing) => existing.id === resolved.id);
    if (carriedIndex !== -1) checks[carriedIndex] = resolved;
    else checks.push(resolved);
  }
  // 整体状态三档:有 failed 即 failed;否则有 pending(未消解的观察项)为
  // pending;全 passed/healed 才 passed。pending 是"待人工确认"而非"失败"——
  // 否则携带逻辑会把文档化回路变成永久 failed 的死锁(评审 C)。
  const hasFailed = checks.some((check) => check.status === "failed");
  const hasPending = checks.some((check) => check.status === "pending");
  const verification: PrototypeVerificationResult = {
    status: hasFailed ? "failed" : hasPending ? "pending" : "passed",
    checks,
    generatedAt: new Date().toISOString(),
    healingRounds: content.verification?.healingRounds ?? 0,
  };
  if (ctx.signal.aborted) return { ok: false, error: "cancelled" };
  const saved = await executeA2ui(ctx, "save_suite_result", {
    suiteId,
    versionId,
    verification,
    note: input.note?.trim() || "deterministic prototype verification",
  });
  if (!saved.ok) return saved;
  return { ok: true, artifactRef: saved.artifactRef, verification, refreshStore: !saved.artifactRef };
};

export interface PrototypeReviseInput {
  suiteId: string;
  versionId: string;
  part: "spec" | "openui" | "verification";
  target: string;
  instruction: string;
  /** 目标平台变体(user ask 2026-09-09):openui 修订可定向 mobile/tablet;
   *  desktop/缺省修订本体。 */
  device?: string;
  note?: string;
}

export const prototypeReviseDefinition: ActionDefinition<PrototypeReviseInput> = {
  id: "prototype.revise",
  description:
    "Revise one selected prototype suite part from an immutable version. Verification revisions only add pending observations.",
  category: "design",
  parameters: {
    type: "object",
    properties: {
      suiteId: { type: "string" },
      versionId: { type: "string" },
      part: { type: "string", enum: ["spec", "openui", "verification"] },
      target: { type: "string" },
      instruction: { type: "string" },
      device: {
        type: "string",
        enum: ["desktop", "mobile", "tablet"],
        description:
          "Platform variant to revise (openui part): desktop updates the base program; mobile/tablet update their variant.",
      },
      note: { type: "string" },
    },
    required: ["suiteId", "versionId", "part", "target", "instruction"],
    additionalProperties: false,
  },
  sideEffects: ["write-in-cwd"],
};

export const prototypeReviseRun: ActionRun<PrototypeReviseInput, PrototypeSpecOutput> = async (input, ctx) => {
  const suiteId = input?.suiteId?.trim();
  const versionId = input?.versionId?.trim();
  const target = input?.target?.trim();
  const instruction = input?.instruction?.trim();
  if (!suiteId || !versionId || !target || !instruction) {
    return { ok: false, error: "suiteId, versionId, target and instruction are required" };
  }
  const read = await readSuiteVersion(ctx, suiteId, versionId);
  if (!read.ok) return read;
  if (read.value.artifactRef.kind !== "prototype") return { ok: false, error: "suite is not a prototype suite" };
  const content = read.value.content as PrototypeSuiteContent;

  if (input.part === "verification") {
    // Revisions only ADD pending observations — the prior checks must survive
    // the append, not be replaced by the single fresh one.
    const verification: PrototypeVerificationResult = {
      status: "pending",
      checks: [
        ...(content.verification?.checks ?? []),
        {
          id: `revision-${Date.now()}-${randomUUID().slice(0, 8)}`,
          label: target,
          status: "pending",
          observation: instruction,
        },
      ],
    };
    const saved = await executeA2ui(ctx, "save_suite_result", {
      suiteId,
      versionId,
      verification,
      note: input.note?.trim() || `verification observation: ${target}`,
    });
    return saved.ok
      ? { ok: true, artifactRef: saved.artifactRef, refreshStore: !saved.artifactRef }
      : { ok: false, error: saved.error };
  }

  if (!ctx.runSubagent) return { ok: false, error: "runSubagent not available" };
  // openui 修订的设备定向:mobile/tablet 修订走对应变体,且修订提示带该端
  // 平台契约——在手机版上"加一列"的语义与桌面版完全不同。
  const device: OpenuiDevice | undefined =
    input.part === "openui" && input.device && ["mobile", "tablet"].includes(input.device)
      ? (input.device as OpenuiDevice)
      : undefined;
  // WP1.2 设备基线:device 定向修订喂子代理的必须是该端变体——此前恒取
  // content.openui(桌面本体),「桌面程序+手机契约」的杂交产物会写进变体槽
  // 覆盖真正的手机版。desktop/未指定才回落本体。
  const current =
    input.part === "spec"
      ? content.spec
      : device
        ? (content.openuiVariants?.[device] ?? content.openui)
        : content.openui;
  if (!current?.trim()) return { ok: false, error: `${input.part} content is empty in the selected version` };
  const skill = input.part === "spec" ? "spec-writer" : "pm-designer-openui";
  const generated = await ctx.runSubagent({
    skill,
    prompt:
      `Revise only the ${input.part} content below. Target: ${target}. Instruction: ${instruction}. ` +
      (input.part === "openui" ? `${OPENUI_PRESERVE_CONTRACT} ${device ? OPENUI_DEVICE_CONTRACTS[device] : ""} ` : "") +
      "Preserve unrelated content and return only the complete revised document in one code fence. Do not call tools.\n\n" +
      current,
    silent: true,
  });
  const revised = input.part === "spec" ? extractMarkdownDocument(generated) : extractGeneratedBody(generated);
  const structurallyValid =
    revised !== null && (input.part === "spec" ? looksLikeSpecDocument(revised) : looksLikeOpenuiProgram(revised));
  if (!structurallyValid) {
    return {
      ok: false,
      error: `${skill} returned empty or structurally invalid content (truncated output?) — regenerate`,
    };
  }
  const tool = input.part === "spec" ? "render_spec" : "update_openui";
  const args: Record<string, unknown> = {
    suiteId,
    versionId,
    note: input.note?.trim() || `${input.part} revision: ${target}`,
  };
  if (input.part === "openui" && device) args.device = device;
  if (input.part === "spec") {
    args.document = revised;
    if (content.requirement) args.requirement = content.requirement;
  } else {
    // Same local validation loop as materialize (user ask 2026-09-09) — a
    // revision must not regress the program below the parser's bar.
    args.code = await repairOpenuiProgram(ctx, {
      code: revised,
      contract: OPENUI_PRESERVE_CONTRACT,
      progressCode: "prototype.revise.repairing",
      basePercent: 60,
    });
  }
  if (ctx.signal.aborted) return { ok: false, error: "cancelled" };
  const saved = await executeA2ui(ctx, tool, args);
  return saved.ok
    ? { ok: true, artifactRef: saved.artifactRef, refreshStore: !saved.artifactRef }
    : { ok: false, error: saved.error };
};

export { executeA2ui, extractGeneratedBody, hasPageList, parseArtifactRef, readArtifactFile };

export interface PrototypeArchInput {
  suiteId: string;
  versionId: string;
  note?: string;
}

export type PrototypeArchOutput = PrototypeSpecOutput;

export const prototypeArchDefinition: ActionDefinition<PrototypeArchInput> = {
  id: "prototype.arch",
  description:
    "Derive the standardized technical architecture document from an APPROVED prototype suite version " +
    "(runs only after verification passed; user ask 2026-09-08 技术架构模块).",
  category: "design",
  parameters: {
    type: "object",
    properties: {
      suiteId: { type: "string", description: "Prototype suite id" },
      versionId: { type: "string", description: "Prototype suite version whose PRD seeds the document" },
      note: { type: "string", description: "Optional version note" },
    },
    required: ["suiteId", "versionId"],
    additionalProperties: false,
  },
  sideEffects: ["write-in-cwd"],
};

/** An architecture document must be a real markdown doc AND carry at least one
 *  Mermaid diagram — the 标准化 format contract (架构图/数据模型/流程必有图).
 *  Line-anchored: prose merely mentioning ```mermaid is not a diagram. */
export function looksLikeArchDoc(markdown: string): boolean {
  return /^#{1,6}\s+\S/m.test(markdown) && /^[ \t]*```[ \t]*mermaid/im.test(markdown);
}

/** specs/design-stage-gates：架构文档骨架单源（SPEC_SKELETON 同款纪律——
 *  SKILL.md 撤模板改引用）。七节 + 三表行级模板 + 图示槽位说明。弱模型
 *  "填空到行"；占位行不计数，骨架抄写过不了 archSectionsAudit。 */
export const ARCH_SKELETON = `# <产品/功能名称> 技术架构文档

| 项目 | 内容 |
| --- | --- |
| 依据 PRD | <PRD 标题 / 版本> |
| 架构风格 | <如:单页交互原型 / 前端 + 轻服务> |
| 文档日期 | <当天日期> |

## 1. 技术选型

| 领域 | 选型 | 理由 |
| --- | --- | --- |
| <前端框架> | <选型> | <一句话理由> |
| <状态/路由> | <选型> | <理由> |
| <后端/服务> | <选型> | <理由> |

## 2. 系统架构

（Mermaid \`graph TD\`（三反引号 + mermaid 围栏）:subgraph 分层（用户层/交互层/
业务逻辑层/数据层）;图后附模块职责伴表。）

## 3. 数据模型

（Mermaid \`erDiagram\`:核心实体 + 关系 + 关键属性,与 PRD「数据与字段」
 一致;纯展示型原型明确"无持久化实体"并列视图状态模型。图后附实体伴表。）

## 4. 核心流程

（1-2 条端到端关键流程,Mermaid \`sequenceDiagram\` 或 \`flowchart TD\`;
 图后附步骤伴表:步骤/触发/处理/异常路径。）

## 5. 模块拆分

| 模块 | 职责 | 依赖 |
| --- | --- | --- |
| <模块A> | <职责> | <依赖> |
| <模块B> | <职责> | <依赖> |
| <模块C> | <职责> | <依赖> |

## 6. 非功能设计

| 类别 | 设计 | 度量 |
| --- | --- | --- |
| <性能/安全/容错> | <机制> | <度量> |

## 7. 风险与对策

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| <风险A> | <影响> | <对策> |
| <风险B> | <影响> | <对策> |`;

export const prototypeArchRun: ActionRun<PrototypeArchInput, PrototypeArchOutput> = async (input, ctx) => {
  const suiteId = input?.suiteId?.trim();
  const versionId = input?.versionId?.trim();
  if (!suiteId || !versionId) return { ok: false, error: "suiteId and versionId are required" };
  if (!ctx.runSubagent) return { ok: false, error: "runSubagent not available" };

  const read = await readSuiteVersion(ctx, suiteId, versionId);
  if (!read.ok) return read;
  if (read.value.artifactRef.kind !== "prototype") return { ok: false, error: "suite is not a prototype suite" };
  const content = read.value.content as PrototypeSuiteContent;
  // 原型验收成功之后才允许生成技术架构文档(user ask 2026-09-08)。
  if (content.verification?.status !== "passed") {
    return { ok: false, error: "verification must pass before the technical architecture document can be generated" };
  }
  const spec = content.spec?.trim() ?? "";
  if (!spec) return { ok: false, error: "requirements document not found; run prototype.spec first" };

  ctx.emit({
    message: "Generating the technical architecture document from the approved PRD",
    percent: 50,
    data: { code: "prototype.arch.generating" },
  });
  try {
    // specs/design-stage-gates S3：骨架内联 + 强化 archSectionsAudit（七节/
    // erDiagram/表行门槛）+ findings 修复一轮，复审仍败 fail-closed——显式
    // 动作产物即契约（此前 looksLikeArchDoc"有标题有图即过"是同款薄门）。
    const result = await runDesignStage(ctx, {
      stage: "prototype.arch",
      skill: "arch-writer",
      buildPrompt: (findings) => {
        const base =
          "Write the complete standardized technical architecture document derived from the approved PRD below. " +
          "Fill the EXACT skeleton below section-for-section — do not rename, reorder, or drop sections; " +
          "replace every <placeholder> with concrete content; every diagram slot gets a real mermaid fence " +
          "(```mermaid) followed by its companion table. " +
          "Do not call tools. Return only the complete markdown document in one markdown code fence.\n\n" +
          "## 骨架（逐节填充）\n" +
          ARCH_SKELETON +
          "\n\n## 需求文档（已验收）\n" +
          spec;
        if (findings && findings.length > 0) {
          return base + "\n\n## 深度审计 findings（逐条修复，不得删节）\n" + findings.map((f) => "- " + f).join("\n");
        }
        return base;
      },
      // 架构文档内嵌 ```mermaid 围栏,单围栏惰性抽取会在第一个内层围栏处截断;
      // extractMarkdownDocument 按行锚定围栏剥壳,最后一个围栏不是裸闭合行的
      // 输出一律视为截断:拒绝,而不是抢救半份文档。
      extract: (generated) => {
        const doc = generated === null ? null : extractMarkdownDocument({ content: generated });
        if (!doc || !looksLikeArchDoc(doc)) return null;
        return normalizeGeneratedMarkdown(doc);
      },
      audit: archSectionsAudit,
      maxRepairs: 1,
      progressCode: "prototype.arch.repairing",
      basePercent: 60,
    });
    if (!result.ok) return { ok: false, error: result.error };
    const document = result.document;
    if (ctx.signal.aborted) return { ok: false, error: "cancelled" };
    const saved = await executeA2ui(ctx, "save_suite_arch", {
      suiteId,
      versionId,
      document,
      note: input.note?.trim() || "technical architecture document",
    });
    if (!saved.ok) return saved;
    ctx.emit({
      message: "Technical architecture document saved",
      percent: 100,
      data: { code: "prototype.arch.saved" },
    });
    return { ok: true, artifactRef: saved.artifactRef, refreshStore: !saved.artifactRef };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
};
