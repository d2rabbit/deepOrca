/**
 * Prototype suite actions on the MoonViz engine (specs/moonviz-engine-
 * replacement). PRD / pm-design / arch generation is delegated to design
 * skills exactly as before; the prototype document itself is a single
 * canonical `.mbt.md` (three artboards in one doc) driven through ENGINE OPS:
 * the designer subagent emits an op plan, the seam applies it in a session
 * with gate-feedback loops (≤2 rounds), and the canonical echo is the only
 * thing ever persisted. Immutable suite reads/writes cross the desktop A2UI
 * MCP seam (`render_moonviz` / `update_moonviz` replace the retired
 * render/update_openui).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type { ActionContext, ActionDefinition, ActionRun } from "./types";
import {
  MOONVIZ_ARTBOARD_SIZES,
  MOONVIZ_CREATE_CONTRACT,
  MOONVIZ_DEVICE_CONTRACTS,
  MOONVIZ_OPS_CHEATSHEET,
  MOONVIZ_PRESERVE_CONTRACT,
  MOONVIZ_QUALITY_CONTRACT,
  MOONVIZ_SEED_DOC,
  extractTargetPlatforms,
  hasPageList,
  looksLikeSpecDocument,
  moonvizArtboardId,
  moonvizComponentVocabularyBlock,
  moonvizCoverageFindings,
  normalizeMoonvizDevices,
  parseOpPlan,
  parsePageList,
  type MoonvizArtboardSummary,
  type MoonvizDevice,
} from "./moonviz-contract";
import { MoonvizEngineError, MoonvizResetError, moonvizValidateMbt, withSession } from "../common/moonviz-engine";
import { DdpError, encryptDdp } from "../common/ddp-codec";
import { ensureDesignChainRegistration } from "../specs";
import {
  archSectionsAudit,
  callSubagentStable,
  countTableDataRows,
  normalizeGeneratedMarkdown,
  pmSectionsAudit,
  runDesignStage,
  sectionBody,
  subagentContentOf,
} from "./design-gates";

const DESIGNS_DIR = ".deeporca/designs";
const SPEC_FILE = "spec.md";
const A2UI_TOOL_PREFIX = "mcp__a2ui__";
/** Gate-feedback rounds after the INITIAL op plan (deepDesign 推进式回灌):
 *  a rejected op feeds back as a patch instruction and the corrected plan is
 *  re-applied from the same base (failed ops never enter the document
 *  history). Two rounds clear the large majority; beyond that the action
 *  fails with the diagnostics instead of degrading silently. */
const MAX_MOONVIZ_GATE_ROUNDS = 2;

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

export interface PrototypeVerificationResult {
  status: "pending" | "passed" | "failed";
  checks: PrototypeVerificationCheck[];
  generatedAt?: string;
  healingRounds?: number;
}

export type PrototypeDevice = MoonvizDevice;

export interface PrototypeSuiteContent {
  requirement?: string;
  spec?: string;
  /** specs/prompt-doc-chain：pm-design.md——从 PRD 蒸馏的原型提示词文档
   *  （页面结构/交互叙事/信息架构/视觉基调/平台策略/继承要点）。原型生成的
   *  主驱动；spec 重写后失效（render_spec 重置）。 */
  pmDesign?: string;
  /** specs/moonviz-engine-replacement：canonical `.mbt.md` 唯一事实源——
   *  单文档多画板（三端 = 单文档三画板，画板 id `<page>@<device>`），替代
   *  旧 openui/openuiVariants 三程序结构。存量 openui 内容随替换作废。 */
  moonviz?: string;
  verification?: PrototypeVerificationResult;
  /** Technical architecture document (user ask 2026-09-08 技术架构模块). */
  arch?: string;
}

export interface UiSuiteContent {
  requirement?: string;
  /** specs/leafer-ui-engine: UI-Design 新栈产物（Leafer JSON 场景树字符串）。
   *  MoonViz 接管原型栈后 UI 套件是 leafer-only——旧 openui 字段随栈作废。 */
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
  const fence = content.match(/^[ \t]*```(?:markdown|md|openui|dd|html|json|moonviz)?[ \t]*\n([\s\S]*?)```/im);
  if (fence) return fence[1]?.trim() || null;
  // An opened-but-never-closed fence means the subagent output was cut off
  // mid-document; refuse the half-captured body (it used to fall back to the
  // WHOLE message including leading prose) so callers fail with a
  // regenerate hint instead of persisting garbage as a "ready" version.
  if (/^[ \t]*```[^\n]*\n/m.test(content)) return null;
  return content.trim() || null;
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

// ── MoonViz op-plan application（Gate 推进式回灌）────────────────────────────

export interface MoonvizGateFeedback {
  op: string;
  gateBlock: string;
}

/**
 * Apply an op plan inside one engine session with the deepDesign 推进式回灌
 * discipline: the session applies ops in order; on the FIRST gate rejection
 * the batch stops, the rejected op + diagnostic feed back to the designer
 * subagent, and the corrected plan is re-applied from the same base (≤2
 * rounds — beyond that the action fails with the diagnostics, never silently
 * degrades). `apply_human_op` is never exposed to the agent.
 */
async function applyMoonvizOpPlan(
  ctx: ActionContext,
  opts: { skill: string; baseDoc: string; ops: string[]; progressCode: string; basePercent: number }
): Promise<{ ok: true; canonical: string } | { ok: false; error: string }> {
  const baseDoc = opts.baseDoc;
  let ops = [...opts.ops];
  for (let round = 0; ; round += 1) {
    let gateFindings: MoonvizGateFeedback[] = [];
    let canonical = baseDoc;
    try {
      const sessionResult = await withSession(baseDoc, async (session) => {
        for (const op of ops) {
          await session.mutate(op);
        }
      });
      canonical = sessionResult.canonical;
    } catch (error) {
      const engineError = error instanceof MoonvizEngineError ? error : undefined;
      const gateBlock = engineError?.gateBlock;
      if (engineError && gateBlock) {
        // The engine reports one block per rejection; the culprit is the
        // first planned op TARGETING the rejected artboard (ops apply in
        // order, so everything after it never entered the document). Artboard
        // position is op-specific: token[1] for most ops, but `template
        // <template-id> <ab> …` and `flow <from> <to> …` carry it in
        // token[2] — a naive some()-scan would misattribute a flow whose
        // DESTINATION matches. The seeded `delete-artboard __seed` op is
        // never the culprit (the seed board predates the plan).
        const opTargetsArtboard = (op: string): boolean => {
          const tokens = op.split(/\s+/);
          if (tokens[0] === "template" || tokens[0] === "flow") {
            return tokens[1] === gateBlock.artboard || tokens[2] === gateBlock.artboard;
          }
          return tokens[1] === gateBlock.artboard;
        };
        const culprit =
          ops.find((op) => !op.startsWith("delete-artboard") && opTargetsArtboard(op)) ??
          ops.find((op) => !op.startsWith("delete-artboard")) ??
          ops[0] ??
          "";
        gateFindings = [{ op: culprit, gateBlock: engineError.message }];
      } else {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
    if (gateFindings.length === 0) {
      return { ok: true, canonical };
    }
    if (round >= MAX_MOONVIZ_GATE_ROUNDS || !ctx.runSubagent) {
      return {
        ok: false,
        error:
          `MoonViz gate rejected the op plan after ${round} repair round(s): ` +
          gateFindings.map((finding) => finding.gateBlock).join("; "),
      };
    }
    ctx.emit({
      message: `Repairing ${gateFindings.length} gate rejection(s) (round ${round + 1}/${MAX_MOONVIZ_GATE_ROUNDS})`,
      percent: opts.basePercent + round * 5,
      data: { code: opts.progressCode },
    });
    const generated = await callSubagentStable(
      ctx,
      {
        skill: opts.skill,
        prompt:
          "The MoonViz op plan below was REJECTED by the engine gate. Fix ONLY what the gate findings " +
          "require (adjust position/size so the placement fits its parent without sibling overlap, or " +
          "correct the op syntax) and return the COMPLETE corrected op plan in one code fence — " +
          "unchanged ops must be repeated verbatim. Do not call tools.\n\n" +
          MOONVIZ_OPS_CHEATSHEET +
          "\n\n## Gate findings\n" +
          gateFindings.map((finding) => `- REJECTED: \`${finding.op}\` → ${finding.gateBlock}`).join("\n") +
          "\n\n## Current op plan\n" +
          ops.join("\n"),
        silent: true,
      },
      "op-plan-repair"
    );
    const next = parseOpPlan(generated);
    if (!next) {
      return { ok: false, error: "gate repair round returned an unusable op plan — regenerate" };
    }
    // Re-apply the FULL corrected plan from the same base — the engine
    // session is disposable, the plan is the unit of progress.
    ops = next;
  }
}

/** Seed hygiene: materialize opens from MOONVIZ_SEED_DOC; the seed artboard
 *  must be gone before save (a leftover would fail coverage as an extra
 *  artboard). The cleanup op is idempotent-tolerated: a plan that already
 *  deletes `__seed` would error on the second delete, so strip plan-side
 *  deletes and prepend exactly one here. */
function withSeedCleanup(ops: string[]): string[] {
  const cleaned = ops.filter((op) => !(op.startsWith("delete-artboard") && op.includes("__seed")));
  return ["delete-artboard __seed", ...cleaned];
}

/** Build the designer prompt: platform artboard plan + contracts + vocabulary
 *  + the PRD/pm-design payload. Device coverage is spelled out artboard by
 *  artboard so the plan is checkable against PRD coverage mechanically. */
function buildMaterializePrompt(input: {
  pmDesign: string | null;
  spec: string;
  devices: MoonvizDevice[];
  multiDevice: boolean;
}): string {
  const { pmDesign, spec, devices, multiDevice } = input;
  const pageList = parsePageList(spec);
  const pageIds =
    pageList?.pages
      .map((page, index) => page.id ?? `page${index + 1}`)
      .filter((id, index, all) => all.indexOf(id) === index) ?? [];
  const artboardPlan =
    pageIds.length > 0
      ? pageIds
          .flatMap((pageId) =>
            devices.map(
              (device) =>
                `- \`${moonvizArtboardId(pageId, device, multiDevice)}\` (${device} ` +
                `${MOONVIZ_ARTBOARD_SIZES[device].width}×${MOONVIZ_ARTBOARD_SIZES[device].height})`
            )
          )
          .join("\n")
      : devices
          .map(
            (device) =>
              `- one \`${device}\` artboard at ${MOONVIZ_ARTBOARD_SIZES[device].width}×${MOONVIZ_ARTBOARD_SIZES[device].height}`
          )
          .join("\n");
  const deviceContracts = [...new Set(devices)].map((device) => MOONVIZ_DEVICE_CONTRACTS[device]).join(" ");
  const vocabulary = moonvizComponentVocabularyBlock();
  return (
    (pmDesign
      ? "Create the complete MoonViz prototype from the distilled design intent below. "
      : "Create the complete MoonViz prototype for the requirements document below. ") +
    MOONVIZ_CREATE_CONTRACT +
    " " +
    deviceContracts +
    " " +
    MOONVIZ_QUALITY_CONTRACT +
    " " +
    MOONVIZ_OPS_CHEATSHEET +
    (vocabulary ? " " + vocabulary : "") +
    // PRD 遵守契约（与旧栈同款纪律）：逐页、逐优先级、逐三态点名，verify 按
    // 画板/flow 逐项比对。
    " PRD compliance is non-negotiable: (1) EVERY page in the 页面清单/pm-design " +
    "页面结构 gets its own artboard from the plan below; (2) EVERY P0 功能需求 row is " +
    "visibly implemented — its 交互要点 states (empty/loading/error-and-retry) each render a " +
    "distinct branch; (3) the 逐页交互明细 lines are implemented as `interact`/`state`/`set-state` " +
    "ops and every page-to-page jump as a `flow`; (4) do not invent pages, fields, or flows beyond " +
    "the document. " +
    "Do not call tools. " +
    "Return ONLY the op plan — one op per line in a single ```moonviz code fence, no mbt source.\n\n" +
    "## Artboard plan (ids are contractual — coverage is checked against them)\n" +
    artboardPlan +
    (pmDesign
      ? "\n\n## pm-design（设计意图——主驱动）\n" + pmDesign + "\n\n## 需求文档（范围契约源）\n" + spec
      : "\n\n" + spec)
  );
}

// ── PRD 骨架（specs/prompt-doc-chain 单源；与旧栈逐字一致）────────────────────

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

（页面ID 必填——英文 kebab/camel,是原型画板的 id。表后附 Mermaid
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
    const extracted = generated === null ? null : extractMarkdownDocument({ content: generated });
    let document = extracted === null ? null : normalizeGeneratedMarkdown(extracted);
    if (!document || !looksLikeSpecDocument(document)) {
      return {
        ok: false,
        error: "spec-writer returned an empty or section-less requirements document (truncated output?) — regenerate",
      };
    }
    // 深度机械门（交叉审查追加）：结构不全 → 带 findings 修复一轮（机械补强
    // 第二半）。fail-closed,两轮耗尽仍薄则拒绝落盘。
    let findings = specSectionsAudit(document);
    if (findings.length > 0) {
      ctx.emit({
        message: `PRD depth gate: repairing ${findings.length} finding(s)`,
        percent: 55,
        data: { code: "prototype.spec.repairing" },
      });
      const findingsText = findings.map((finding) => "- " + finding).join("\n");
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

// ── materialize：op 计划 → 引擎会话 → canonical 落盘 ─────────────────────────

export interface PrototypeMaterializeInput {
  suiteId?: string;
  versionId?: string;
  specArtifactId?: string;
  /** 目标平台：缺省由 PRD 目标平台声明决定；传 ["desktop","mobile","tablet"]
   *  生成三端——三端 = 单文档三画板（`<page>@<device>`），不再是三程序。 */
  devices?: string[];
  note?: string;
}

export type PrototypeMaterializeOutput = PrototypeSpecOutput;

export const prototypeMaterializeDefinition: ActionDefinition<PrototypeMaterializeInput> = {
  id: "prototype.materialize",
  description:
    "Materialize a prototype suite specification into a MoonViz document (engine ops → canonical .mbt.md). " +
    "Suite/version is preferred; specArtifactId remains supported for legacy artifacts.",
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
          "Target platforms. Omit to derive from the PRD's 目标平台 declaration; " +
          "legacy PRDs without a declaration default to desktop-only. All targets land as artboards " +
          "of ONE document (`<page>@<device>` ids).",
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

  // WP0 指令遵循主线：devices 缺省时由 PRD 的目标平台声明决定生成端——
  // mobile-only 产品不付 desktop 生成的代价；PRD 未声明(legacy)只出 desktop,
  // verify 会补「平台未声明」观察项推动补 PRD。显式 devices 仍是最高优先。
  const declaredPlatforms = extractTargetPlatforms(spec);
  const devices: MoonvizDevice[] =
    input?.devices && input.devices.length > 0
      ? normalizeMoonvizDevices(input.devices)
      : declaredPlatforms
        ? normalizeMoonvizDevices(declaredPlatforms)
        : ["desktop"];
  // legacy artifact 路径(无 suite)没有版本链：收敛为单一主端(desktop 优先)，
  // 多端平台化必须走 suite 路径。
  const planDevices: MoonvizDevice[] = suiteId
    ? devices
    : [devices.includes("desktop") ? "desktop" : (devices[0] ?? "desktop")];
  const multiDevice = planDevices.length > 1;
  try {
    // specs/prompt-doc-chain stage0：所选版本无 pm-design 时自动蒸馏（有则
    // 直接用——手动重算语义由 prototype.pmdesign 承载）。stage0 保存走
    // preserveDerived——不清空 moonviz/verification/arch（同一动作内紧随的
    // op 计划应用会重建派生物；清空会在生成失败/取消时把用户既有原型从
    // head 上抹掉）。重置语义只属于手动重算。
    let pmDesign: string | null = storedPmDesign;
    let baseVersionId = versionId;
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
        // head 前移：save_pm_design 追加了新版本，落盘以新 head 为基线。
        if (!savedPd.artifactRef) {
          return {
            ok: false,
            error:
              "save_pm_design reported success without a persisted artifact ref — stage0 cannot thread the new head",
          };
        }
        baseVersionId = savedPd.artifactRef.versionId;
        ctx.emit({
          message: "pm-design document saved",
          percent: 45,
          data: { code: "prototype.pmdesign.saved" },
        });
      } else {
        // specs/design-stage-gates（OCR plan-failure 分层借鉴）：stage0 自动
        // 蒸馏是增强阶段——失败降级到 spec 直驱的既有提示词（与无 pm-design
        // 的旧路径字节一致），绝不因提示词文档失败阻塞原型化。
        ctx.emit({
          message: `pm-design distillation failed — falling back to spec-driven generation (${distilled.error})`,
          percent: 45,
          data: { code: "prototype.materialize.degraded" },
        });
        pmDesign = null;
      }
    }

    ctx.emit({
      message:
        planDevices.length > 1
          ? `Generating the MoonViz prototype (${planDevices.length} platform artboard sets)`
          : "Generating the MoonViz prototype from the selected specification",
      percent: 50,
      data: { code: "prototype.materialize.generating" },
    });
    const generated = await callSubagentStable(
      ctx,
      {
        skill: "pm-designer-moonviz",
        prompt: buildMaterializePrompt({ pmDesign, spec: spec!, devices: planDevices, multiDevice }),
        silent: true,
      },
      "materialize-moonviz"
    );
    const ops = parseOpPlan(generated);
    if (!ops || !ops.some((op) => /^(template|create)\s/.test(op))) {
      return {
        ok: false,
        error:
          "pm-designer-moonviz returned an empty or unusable op plan (no template/create artboard op) — regenerate",
      };
    }
    if (ctx.signal.aborted) return { ok: false, error: "cancelled" };
    // 引擎会话应用：MOONVIZ_SEED_DOC 冷启动一次 + 种子板清理 + Gate 回灌。
    const applied = await applyMoonvizOpPlan(ctx, {
      skill: "pm-designer-moonviz",
      baseDoc: MOONVIZ_SEED_DOC,
      ops: withSeedCleanup(ops),
      progressCode: "prototype.materialize.repairing",
      basePercent: 55,
    });
    if (!applied.ok) return { ok: false, error: applied.error };
    if (ctx.signal.aborted) return { ok: false, error: "cancelled" };
    const saved = await executeA2ui(ctx, "render_moonviz", {
      doc: applied.canonical,
      ...(requirement ? { requirement } : {}),
      ...(suiteId ? { suiteId, ...(baseVersionId ? { versionId: baseVersionId } : {}) } : {}),
      ...(input.note?.trim() ? { note: input.note.trim() } : {}),
    });
    if (!saved.ok) return saved;
    // 落盘事实守卫（与旧栈同款）：报成功却无 ArtifactRef = 持久化没发生。
    if (!saved.artifactRef) {
      return {
        ok: false,
        error: "render_moonviz reported success without a persisted artifact ref — suite persistence did not happen",
      };
    }
    ctx.emit({
      message: "MoonViz prototype saved with verification pending",
      percent: 100,
      data: { code: "prototype.materialize.saved" },
    });
    return { ok: true, artifactRef: saved.artifactRef, refreshStore: !saved.artifactRef };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
};

// ── verify：引擎直调检查面 ───────────────────────────────────────────────────

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
    "Run deterministic verification over a MoonViz prototype suite version (engine validate/lint/critique/" +
    "tap simulation + PRD coverage) and persist the result. This does not claim browser testing.",
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

interface MoonvizEngineVerification {
  artboards: MoonvizArtboardSummary[];
  flows: Array<Record<string, unknown>>;
  lintFindings: Array<{ artboard: string; finding: Record<string, unknown> }>;
  critiqueFindings: Array<{ artboard: string; finding: Record<string, unknown> }>;
  tapResults: Array<{ flow: string; ok: boolean; detail: string }>;
  validateError?: string;
  validateRan: boolean;
  /** Ladder failure AFTER validate passed (wasm trap mid-lint etc.) — a
   *  pending observation, not a validate verdict. A throw BEFORE validate
   *  (seam unconfigured / worker unbootable) also lands here with
   *  validateRan=false — "not verified", never "verified". */
  ladderError?: string;
}

function envelopeArray(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) return payload as Array<Record<string, unknown>>;
  if (payload && typeof payload === "object") {
    const data = (payload as { data?: unknown }).data;
    if (Array.isArray(data)) return data as Array<Record<string, unknown>>;
    const flows = (payload as { flows?: unknown }).flows;
    if (Array.isArray(flows)) return flows as Array<Record<string, unknown>>;
  }
  return [];
}

/** Engine-backed deterministic verification. 断言等价迁移（P2 出口复核表）：
 *  旧 $page/@Set 正则检查 → 引擎 artboards/flows 权威面；死按钮检查 →
 *  session_lint；结构合法性 → AgentGate 已随 op 内建 + validate_mbt；
 *  repair → Gate 回灌在 materialize/revise；coverage → 合同层比对。 */
async function runMoonvizVerification(doc: string): Promise<MoonvizEngineVerification> {
  const verification: MoonvizEngineVerification = {
    artboards: [],
    flows: [],
    lintFindings: [],
    critiqueFindings: [],
    tapResults: [],
    validateRan: false,
  };
  const validated = await moonvizValidateMbt(doc);
  verification.validateRan = true;
  if (!validated.ok) {
    verification.validateError = validated.error ?? "validate_mbt failed";
    return verification;
  }
  await withSession(doc, async (session) => {
    verification.artboards = envelopeArray(await session.listArtboards()).map((entry) => ({
      id: String(entry.id ?? ""),
      ...(typeof entry.name === "string" ? { name: entry.name } : {}),
      ...(typeof entry.width === "number" ? { width: entry.width } : {}),
      ...(typeof entry.height === "number" ? { height: entry.height } : {}),
    }));
    verification.flows = envelopeArray(await session.flows());
    for (const artboard of verification.artboards) {
      if (!artboard.id) continue;
      try {
        for (const finding of envelopeArray(await session.lint(artboard.id))) {
          verification.lintFindings.push({ artboard: artboard.id, finding });
        }
      } catch (error) {
        // Worker resets must keep their class: withSession's doc-keyed replay
        // is the designed recovery — swallowing the reset here would run the
        // rest of the ladder against a dead handle and fabricate failures.
        if (error instanceof MoonvizResetError) throw error;
        verification.lintFindings.push({
          artboard: artboard.id,
          finding: { rule: "lint_unavailable", message: error instanceof Error ? error.message : String(error) },
        });
      }
      try {
        for (const finding of envelopeArray(await session.critique(artboard.id))) {
          verification.critiqueFindings.push({ artboard: artboard.id, finding });
        }
      } catch {
        // critique 是增益观察面——失败降级为空，不阻断其余检查项。
      }
    }
    for (const flow of verification.flows) {
      const from = String(flow.from ?? flow.fromArtboard ?? "");
      const trigger = String(flow.trigger ?? flow.triggerNode ?? "");
      const nodeId = trigger.includes(":") ? trigger.slice(trigger.indexOf(":") + 1) : trigger;
      const label = `${from || "?"}→${String(flow.to ?? "?")} via ${nodeId}`;
      const artboard = verification.artboards.find((candidate) => candidate.id === from);
      if (!from || !artboard) {
        verification.tapResults.push({ flow: label, ok: false, detail: "flow source artboard missing" });
        continue;
      }
      // 画板几何由 query_nodes 给出（引擎权威），点击语义仿真逐 flow 命中。
      let tapped = false;
      let detail = "trigger node not found";
      try {
        const nodes = envelopeArray(await session.queryNodes(from));
        const node = nodes.find((candidate) => candidate.id === nodeId);
        const rect = (node?.rect ?? {}) as { x?: number; y?: number; w?: number; h?: number };
        if (typeof rect.x === "number" && typeof rect.y === "number") {
          const tapEnvelope = await session.tap(
            from,
            rect.x + (typeof rect.w === "number" ? rect.w / 2 : 0),
            rect.y + (typeof rect.h === "number" ? rect.h / 2 : 0)
          );
          tapped = tapEnvelope.ok;
          detail = tapEnvelope.ok ? "hit" : String(tapEnvelope.error ?? "rejected");
        }
      } catch (error) {
        detail = error instanceof Error ? error.message : String(error);
      }
      verification.tapResults.push({ flow: label, ok: tapped, detail });
    }
  });
  return verification;
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
  const doc = content.moonviz?.trim() ?? "";
  // 确定性检查每次重算；此前版本里的非确定性检查（revise 追加的 pending 观察
  // 项、外部 checks）必须随行——文档化回路是"revise 加观察 → 重新 verify"，
  // 整体替换的 save_suite_result 若不携带就会把 pending 项静默清掉。
  // auto: 是保留命名空间（机械项每次重算、外部输入既覆写不到也不能追加）。
  const deterministicIds = new Set(["spec-non-empty", "page-list-present", "moonviz-non-empty", "moonviz-valid"]);
  const isMechanical = (id: string): boolean => deterministicIds.has(id) || id.startsWith("auto:");
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
      id: "moonviz-non-empty",
      label: "A MoonViz prototype document exists",
      status: doc ? "passed" : "failed",
    },
  ];
  if (doc) {
    ctx.emit({
      message: "Running engine verification (validate / lint / critique / tap simulation)",
      percent: 55,
      data: { code: "prototype.verify.engine" },
    });
    let engine: MoonvizEngineVerification;
    try {
      engine = await runMoonvizVerification(doc);
    } catch (error) {
      // 配置级失败（seam 未注入/worker 不可用）≠ 文档验证失败——记录为
      // 「未验证」（pending），绝不把未验证文档标成 passed。
      engine = {
        artboards: [],
        flows: [],
        lintFindings: [],
        critiqueFindings: [],
        tapResults: [],
        validateRan: false,
        ladderError: error instanceof Error ? error.message : String(error),
      };
    }
    checks.push({
      id: "moonviz-valid",
      label: "The document passes engine validation",
      status: engine.validateError ? "failed" : engine.validateRan ? "passed" : "pending",
      ...(engine.validateError
        ? { observation: engine.validateError }
        : engine.validateRan
          ? {}
          : { observation: "引擎验证未运行（seam 未配置或 worker 不可用）——恢复引擎后重新 verify。" }),
    });
    if (engine.ladderError) {
      checks.push({
        id: "auto:verify-engine-unavailable",
        label: "Engine verification ladder completed",
        status: "pending",
        observation: engine.validateRan
          ? `引擎检查阶梯中断（validate 已通过）：${engine.ladderError}——稍后重新 verify。`
          : `引擎检查阶梯中断：${engine.ladderError}——恢复引擎后重新 verify。`,
      });
    }
    if (!engine.validateError && !engine.ladderError) {
      // 平台一致性（WP0.4 等价迁移）：PRD 声明端 vs 文档画板端。多端文档的
      // 画板 id 携带 @device 后缀；单端文档（plain id）按声明单端放行——
      // 单端文档的端别由 materialize 的计划决定，无后缀不可判别。
      const declared = extractTargetPlatforms(spec);
      const generatedDevices = new Set<string>();
      for (const artboard of engine.artboards) {
        const device = artboard.id.includes("@") ? artboard.id.split("@")[1] : "";
        if (device) generatedDevices.add(device);
      }
      const singleDeviceDoc = generatedDevices.size === 0 && engine.artboards.length > 0;
      if (!declared) {
        checks.push({
          id: "auto:platform-undeclared",
          label: "PRD declares target platforms (目标平台)",
          status: "pending",
          observation: "PRD 未声明目标平台——重新生成需求文档时补充「目标平台」行,materialize 将按声明决定生成端。",
        });
      } else if (singleDeviceDoc) {
        // 单端文档（plain 画板 id）：端别由 materialize 的计划决定，无后缀
        // 不可判别。单平台声明即视为满足；多平台声明 → 补多端画板的观察项。
        if (declared.length > 1) {
          checks.push({
            id: "auto:platform-single-device-doc",
            label: "Multi-platform PRD has per-device artboards",
            status: "pending",
            observation:
              "PRD 声明多端但文档是单端形态（无 <page>@<device> 画板）——重新 materialize（带 devices）生成多端画板。",
          });
        }
      } else {
        for (const device of declared) {
          if (!generatedDevices.has(device)) {
            checks.push({
              id: `auto:platform-${device}-missing`,
              label: `PRD-declared platform "${device}" has artboards`,
              status: "failed",
              observation: `PRD 声明 ${device} 端但文档中没有任何 <page>@${device} 画板——重新 materialize(或补 devices)后重验。`,
            });
          }
        }
        for (const device of generatedDevices) {
          if (!declared.includes(device as MoonvizDevice)) {
            checks.push({
              id: `auto:platform-${device}-extra`,
              label: `Generated platform "${device}" is PRD-declared`,
              status: "pending",
              observation: `生成了 PRD 未声明的 ${device} 端画板——确认是否为有意补充,否则从 PRD 或原型中移除。`,
            });
          }
        }
      }
      // PRD 覆盖（合同层比对）。
      for (const finding of moonvizCoverageFindings(spec, engine.artboards, engine.flows)) {
        checks.push({
          id: finding.id,
          label: finding.label,
          status: finding.severity,
          observation: finding.observation,
        });
      }
      // lint（WCAG/触控/间距/空容器——引擎直调），按规则聚合成 pending 观察。
      const lintByRule = new Map<string, { count: number; message: string }>();
      for (const { finding } of engine.lintFindings) {
        const rule = String(finding.rule ?? "finding");
        const entry = lintByRule.get(rule) ?? { count: 0, message: "" };
        entry.count += 1;
        if (!entry.message) entry.message = String(finding.message ?? "");
        lintByRule.set(rule, entry);
      }
      for (const [rule, entry] of lintByRule) {
        checks.push({
          id: `auto:lint-${rule}`,
          label:
            rule === "lint_unavailable" ? "session_lint ran on every artboard" : `No ${rule} violations (session_lint)`,
          status: "pending",
          observation:
            rule === "lint_unavailable"
              ? `session_lint 在 ${entry.count} 个画板上不可用：${entry.message}——恢复引擎后重新 verify。`
              : `session_lint 报 ${entry.count} 处 ${rule}：${entry.message}——修正后重新 verify 消项。`,
        });
      }
      // critique（8 原则）汇总为一条 pending 观察（顶部建议）。
      if (engine.critiqueFindings.length > 0) {
        const first = engine.critiqueFindings[0].finding;
        checks.push({
          id: "auto:critique",
          label: "session_critique observations addressed",
          status: "pending",
          observation:
            `session_critique 报 ${engine.critiqueFindings.length} 条观察（首条 ` +
            `${String(first.principle ?? first.title ?? "observation")}：${String(first.message ?? first.suggestion ?? "")}）` +
            "——确认或修正后消项。",
        });
      }
      // tap 行为验证（点击语义仿真，逐 flow 命中断言）。
      for (const [index, tap] of engine.tapResults.entries()) {
        checks.push({
          id: `auto:tap-${index + 1}`,
          label: `Flow reachable by tap: ${tap.flow}`,
          status: tap.ok ? "passed" : "failed",
          ...(tap.ok ? {} : { observation: `session_tap 未命中：${tap.detail}——检查触发节点位置与 flow 定义。` }),
        });
      }
    }
  }
  for (const [index, check] of (input.checks ?? []).entries()) {
    if (check.id && isMechanical(check.id.trim())) continue;
    const resolved: PrototypeVerificationCheck = {
      id: check.id?.trim() || `external-${index + 1}`,
      label: check.label,
      status: check.passed ? "passed" : "failed",
      ...(check.observation?.trim() ? { observation: check.observation.trim() } : {}),
    };
    // 按 id 消项：传入的 check 若命中已随行的观察项，则覆写其状态（"revise
    // 加观察 → 处理 → verify 消项"回路的结算端），否则作为新外部项追加。
    const carriedIndex = checks.findIndex((existing) => existing.id === resolved.id);
    if (carriedIndex !== -1) checks[carriedIndex] = resolved;
    else checks.push(resolved);
  }
  // 整体状态三档：有 failed 即 failed；否则有 pending（未消解的观察项）为
  // pending；全 passed/healed 才 passed。
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

// ── revise ───────────────────────────────────────────────────────────────────

export interface PrototypeReviseInput {
  suiteId: string;
  versionId: string;
  part: "spec" | "moonviz" | "verification";
  target: string;
  instruction: string;
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
      part: { type: "string", enum: ["spec", "moonviz", "verification"] },
      target: { type: "string" },
      instruction: { type: "string" },
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
  const current = input.part === "spec" ? content.spec : content.moonviz;
  if (!current?.trim()) return { ok: false, error: `${input.part} content is empty in the selected version` };
  if (input.part === "spec") {
    const generated = await ctx.runSubagent({
      skill: "spec-writer",
      prompt:
        `Revise only the spec content below. Target: ${target}. Instruction: ${instruction}. ` +
        "Preserve unrelated content and return only the complete revised document in one code fence. Do not call tools.\n\n" +
        current,
      silent: true,
    });
    const revised = extractMarkdownDocument(generated);
    if (!revised || !looksLikeSpecDocument(revised)) {
      return {
        ok: false,
        error: "spec-writer returned empty or structurally invalid content (truncated output?) — regenerate",
      };
    }
    if (ctx.signal.aborted) return { ok: false, error: "cancelled" };
    const saved = await executeA2ui(ctx, "render_spec", {
      document: revised,
      suiteId,
      versionId,
      ...(content.requirement ? { requirement: content.requirement } : {}),
      note: input.note?.trim() || `spec revision: ${target}`,
    });
    return saved.ok
      ? { ok: true, artifactRef: saved.artifactRef, refreshStore: !saved.artifactRef }
      : { ok: false, error: saved.error };
  }

  // moonviz 修订：增量 op 计划（以当前 canonical 为上下文），同款 Gate 回灌。
  ctx.emit({
    message: "Planning the revision ops",
    percent: 50,
    data: { code: "prototype.revise.generating" },
  });
  const generated = await callSubagentStable(
    ctx,
    {
      skill: "pm-designer-moonviz",
      prompt:
        `Revise the MoonViz prototype document below. Target: ${target}. Instruction: ${instruction}. ` +
        MOONVIZ_PRESERVE_CONTRACT +
        " Emit ONLY the incremental op plan that transforms the current document into the revised one " +
        "(place/update/interact/flow/delete… ops against the EXISTING artboard ids) — one op per line in a " +
        "single ```moonviz code fence. Do not re-emit unchanged artboards. Do not call tools.\n\n" +
        MOONVIZ_OPS_CHEATSHEET +
        "\n\n## Current document (canonical .mbt.md)\n" +
        current,
      silent: true,
    },
    "revise-moonviz"
  );
  const ops = parseOpPlan(generated);
  if (!ops) {
    return { ok: false, error: "pm-designer-moonviz returned an empty or unusable op plan — regenerate" };
  }
  const applied = await applyMoonvizOpPlan(ctx, {
    skill: "pm-designer-moonviz",
    baseDoc: current,
    ops,
    progressCode: "prototype.revise.repairing",
    basePercent: 60,
  });
  if (!applied.ok) return { ok: false, error: applied.error };
  if (ctx.signal.aborted) return { ok: false, error: "cancelled" };
  const saved = await executeA2ui(ctx, "update_moonviz", {
    doc: applied.canonical,
    suiteId,
    versionId,
    note: input.note?.trim() || `moonviz revision: ${target}`,
  });
  return saved.ok
    ? { ok: true, artifactRef: saved.artifactRef, refreshStore: !saved.artifactRef }
    : { ok: false, error: saved.error };
};

export { executeA2ui, extractGeneratedBody, hasPageList, looksLikeSpecDocument, parseArtifactRef, readArtifactFile };

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
 *  SKILL.md 撤模板改引用）。七节 + 三表行级模板 + 图示槽位说明。 */
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
    // specs/spec-graph-adoption P3（降级路线，T3.0 定稿 2026-09-19）：套件存储
    // 仍是唯一权威（arch 为版本 content 字段，非独立文件），此处仅在 spec 域
    // 播种两个指针锚点（product-design + architecture）让设计链入图。注册
    // 失败绝不拖垮设计动作——best-effort。
    let anchorSkipNote: string | null = null;
    let anchorSkipFile = "";
    try {
      const registered = await ensureDesignChainRegistration(ctx.projectRoot, { suiteId, versionId });
      if (registered.status === "skipped-unparseable-anchor") {
        // Not an error (design action must not fail on spec-domain seeding),
        // but never silent: an unparseable anchor file is hand-owned now.
        anchorSkipNote = ` — spec anchor skipped (hand-edited, unparsable): ${registered.file}`;
        anchorSkipFile = registered.file;
      }
    } catch {
      // honest no-op: the graph misses this chain until the next save
    }
    ctx.emit({
      message: `Technical architecture document saved${anchorSkipNote ?? ""}`,
      percent: 100,
      data: anchorSkipNote
        ? { code: "prototype.arch.anchorSkipped", file: anchorSkipFile }
        : { code: "prototype.arch.saved" },
    });
    return { ok: true, artifactRef: saved.artifactRef, refreshStore: !saved.artifactRef };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
};

// ── export_ddp（specs/moonviz-engine-replacement T3.3）：canonical 文档 →密码 UX（决策 7 遗留）只影响本动作入参。

export interface PrototypeExportDdpInput {
  suiteId: string;
  versionId?: string;
  /** 非空 → DDP1 认证加密；空/省略 → DDP2 免密容器（决策 7 遗留：密码
   *  UX 待产品拍板，动作面先行支持两形态）。 */
  password?: string;
  /** 导出文件名（不含扩展名）；缺省由套件 id 派生。 */
  fileName?: string;
}

export interface PrototypeExportDdpOutput {
  ok: boolean;
  /** 写出的 .ddp 绝对路径。 */
  ddpPath?: string;
  /** 容器形态（"DDP2" 免密 / "DDP1" 加密）。 */
  container?: string;
  bytes?: number;
  error?: string;
}

export const prototypeExportDdpDefinition: ActionDefinition<PrototypeExportDdpInput> = {
  id: "prototype.export-ddp",
  description:
    "Export a prototype suite version's canonical MoonViz document as a .ddp design package " +
    "(empty password → freely viewable DDP2; non-empty → DDP1 authenticated encryption).",
  category: "design",
  parameters: {
    type: "object",
    properties: {
      suiteId: { type: "string" },
      versionId: { type: "string", description: "Suite version to export; omit for the current head" },
      password: {
        type: "string",
        description: "Non-empty enables DDP1 authenticated encryption; empty/omitted produces DDP2 (no password)",
      },
      fileName: { type: "string", description: "Output file name without extension" },
    },
    required: ["suiteId"],
    additionalProperties: false,
  },
  sideEffects: ["write-in-cwd"],
};

export const prototypeExportDdpRun: ActionRun<PrototypeExportDdpInput, PrototypeExportDdpOutput> = async (
  input,
  ctx
) => {
  const suiteId = input?.suiteId?.trim();
  if (!suiteId) return { ok: false, error: "suiteId is required" };
  const read = await readSuiteVersion(ctx, suiteId, input?.versionId?.trim() || undefined);
  if (!read.ok) return { ok: false, error: read.error };
  if (read.value.artifactRef.kind !== "prototype") return { ok: false, error: "suite is not a prototype suite" };
  const doc = "moonviz" in read.value.content ? read.value.content.moonviz?.trim() : undefined;
  if (!doc) {
    return { ok: false, error: "the selected version has no MoonViz document — run materialize first" };
  }
  try {
    const ddp = encryptDdp(doc, input?.password ?? "");
    const safeName = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(input?.fileName?.trim() ?? "")
      ? input!.fileName!.trim()
      : `${suiteId}.ddp`;
    const dir = path.join(ctx.projectRoot, DESIGNS_DIR, suiteId);
    fs.mkdirSync(dir, { recursive: true });
    const outPath = path.join(dir, safeName.endsWith(".ddp") ? safeName : `${safeName}.ddp`);
    fs.writeFileSync(outPath, ddp);
    ctx.emit({
      message: `Design package exported (${input?.password ? "DDP1 encrypted" : "DDP2 open"})`,
      percent: 100,
      data: { code: "prototype.export_ddp.saved" },
    });
    return {
      ok: true,
      ddpPath: outPath,
      container: input?.password ? "DDP1" : "DDP2",
      bytes: ddp.byteLength,
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof DdpError
          ? `ddp export failed: ${error.code}`
          : error instanceof Error
            ? error.message
            : String(error),
    };
  }
};
