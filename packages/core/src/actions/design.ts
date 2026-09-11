/**
 * design.materialize — the UI-DESIGN module's entry (design-module split,
 * real-machine feedback: one auto-routed "一句话→原型" flow was wrong for
 * both disciplines). UI/UX design takes a requirement (a single sentence is
 * fine) and/or an existing PROTOTYPE artifact as the interaction basis, and
 * produces a Leafer JSON scene tree via the deep-design skill
 * (specs/leafer-ui-engine — the generation stack switched from OpenUI Lang;
 * the prototype module keeps OpenUI Lang, guard-tested split). Legacy suites
 * carrying only `content.openui` keep revising through update_openui below.
 * Prototype generation now lives in the prototype.* module
 * (spec → prototype, see actions/prototype.ts).
 *
 * This is a pure orchestration layer — it calls existing tools, implements
 * no rendering itself.
 *
 * design.extract / design.drift (E1b/E1c) — dembrandt brand ingestion: the
 * CLI extracts a website's design system into tokens, and the drift gate
 * scores a live extraction against a committed baseline. Deterministic, no
 * LLM. See docs/research/2026-08-17-external-repos-prestudy.md §1 and
 * common/dembrandt.ts for the offline-first vendored install + browser
 * provisioning rationale.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type { ActionContext, ActionDefinition, ActionRun } from "./types";
import { OPENUI_CREATE_CONTRACT, OPENUI_PRESERVE_CONTRACT } from "./openui-contract";
import { LEAFER_CREATE_CONTRACT, LEAFER_PRESERVE_CONTRACT, looksLikeLeaferDocument } from "./leafer-contract";
import { canonicalLeaferJson, describeLeaferDocument, leaferNodeStableNameAt } from "./leafer-describe";
import { repairLeaferProgram } from "./leafer-repair";
import { lintLeaferDocument } from "./leafer-lint";
import { validateDembrandtTargetUrl } from "../common/dembrandt";
import { runDembrandtProcess } from "../common/dembrandt-runner";
import { getExtensionRoot } from "../prompt";
import {
  callSubagentStable,
  leaferCanvasFindings,
  normalizeGeneratedMarkdown,
  programPageCount,
  runDesignStage,
  uiSectionsAudit,
} from "./design-gates";
import {
  executeA2ui,
  extractGeneratedBody,
  extractMarkdownDocument,
  looksLikeOpenuiProgram,
  readArtifactFile,
  readSuiteVersion,
  findDeadButtons,
  repairOpenuiProgram,
} from "./prototype";
import { extractProgramPages } from "../common/openui-pages";
import type { ArtifactRef, DesignThemeRef, UiSuiteContent } from "./prototype";

/** specs/prompt-doc-chain：ui-design.md 的产出契约——pm-design 的视觉翻译
 *  （写给视觉画布生成器的指令），不是 pm-design 复述。 */
export const UI_DESIGN_CONTRACT =
  "It must be ONE markdown document: a `# ` title plus these `## ` sections in order — " +
  "`画布构图`（每页一帧：区块布局 / 网格 / 留白，落到画布坐标语言）、" +
  "`tokens 映射`（色彩 / 字级 / 圆角 → 设计系统 token 语义）、`视觉层级`（每帧的焦点序）、" +
  "`状态呈现`（空态 / 加载 / 错误的视觉处理）。 " +
  "The page set MUST come from the pm-design 页面结构 — do not invent pages. " +
  "Write every section as DIRECTIVES to the canvas generator.";

export interface DesignMaterializeInput {
  requirement?: string;
  prototypeArtifactId?: string;
  prototypeSuiteId?: string;
  prototypeVersionId?: string;
  designSystemId?: string;
  suiteId?: string;
  versionId?: string;
  note?: string;
}

export interface DesignMaterializeOutput {
  ok: boolean;
  pipeline?: string;
  artifactId?: string | null;
  artifactRef?: ArtifactRef;
  refreshStore?: boolean;
  error?: string;
}

const DESIGN_SYSTEM_IDS = [
  "brutalist-contrast",
  "dark-tech",
  "editorial",
  "glass-morphism",
  "modern-minimal",
  "soft-neumorphic",
  "swiss-international",
  "terminal-mono",
  "warm-handcrafted",
] as const;

function readDesignSystem(id: string): string | null {
  if (!(DESIGN_SYSTEM_IDS as readonly string[]).includes(id)) return null;
  const root = path.resolve(getExtensionRoot(), "templates", "design", "systems");
  const target = path.resolve(root, `${id}.md`);
  if (!target.startsWith(root + path.sep)) return null;
  try {
    const content = fs.readFileSync(target, "utf8").trim();
    return content || null;
  } catch {
    return null;
  }
}

export const designMaterializeDefinition: ActionDefinition<DesignMaterializeInput> = {
  id: "design.materialize",
  description:
    "UI-design module entry: materialize a requirement (one sentence is fine) and/or an existing prototype " +
    "into a Leafer scene-tree JSON suite version via the deep-design skill. When a prototype artifact is given, the " +
    "design covers its pages and flows. Prototype generation is a separate module (prototype.spec → " +
    "prototype.materialize).",
  category: "design",
  parameters: {
    type: "object",
    properties: {
      requirement: {
        type: "string",
        description: "Design requirement in natural language (a single sentence is fine)",
      },
      prototypeArtifactId: {
        type: "string",
        description: "Legacy prototype artifact id",
      },
      prototypeSuiteId: { type: "string", description: "Prototype suite id used as the interaction source" },
      prototypeVersionId: { type: "string", description: "Immutable prototype suite version" },
      designSystemId: { type: "string", enum: [...DESIGN_SYSTEM_IDS], description: "One bundled design system" },
      suiteId: { type: "string", description: "Existing UI suite to append" },
      versionId: { type: "string", description: "Existing UI suite base version" },
      note: { type: "string", description: "Optional version note" },
    },
    additionalProperties: false,
  },
  sideEffects: ["write-in-cwd"],
};

export const designMaterializeRun: ActionRun<DesignMaterializeInput, DesignMaterializeOutput> = async (input, ctx) => {
  const requirement = input?.requirement?.trim();
  const prototypeId = input?.prototypeArtifactId?.trim();
  const prototypeSuiteId = input?.prototypeSuiteId?.trim();
  const prototypeVersionId = input?.prototypeVersionId?.trim();
  // undefined/null → 默认 dark-tech;显式空串/空白是调用方错误,不是默认值
  // ——否则下方的 required 检查永远不可达(F10)。
  const rawDesignSystemId = input?.designSystemId?.trim();
  const designSystemId = rawDesignSystemId === undefined ? "dark-tech" : rawDesignSystemId;
  const suiteId = input?.suiteId?.trim();
  const versionId = input?.versionId?.trim();
  if (!requirement && !prototypeId && !prototypeSuiteId) {
    return { ok: false, error: "requirement, prototypeArtifactId, or prototypeSuiteId is required" };
  }
  if ((prototypeSuiteId && !prototypeVersionId) || (!prototypeSuiteId && prototypeVersionId)) {
    return { ok: false, error: "prototypeSuiteId and prototypeVersionId must be provided together" };
  }
  if ((suiteId && !versionId) || (!suiteId && versionId)) {
    return { ok: false, error: "suiteId and versionId must be provided together" };
  }
  if (!designSystemId) return { ok: false, error: "designSystemId is required for suite v2 materialization" };
  const designSystem = readDesignSystem(designSystemId);
  if (!designSystem) return { ok: false, error: `unknown or unavailable design system: ${designSystemId}` };
  if (!ctx.runSubagent) return { ok: false, error: "runSubagent not available" };

  let prototypeContent: string | null = null;
  let suiteRequirement: string | undefined;
  // specs/prompt-doc-chain：基底原型的 pm-design（ui-design 强化阶段的翻译源）。
  let basisPmDesign: string | null = null;
  let sourcePrototype: { suiteId: string; versionId: string } | undefined;
  // specs/prd-theme-layer：基底原型的主题/关系（read_suite_version 载荷携带
  // 套件 meta 字段），透传给 UI 套件——UI 设计稿自动继承 PRD 主题。
  let inheritedTheme:
    | { themeId?: string; stage?: string; inherits?: DesignThemeRef; references?: DesignThemeRef[] }
    | undefined;
  if (prototypeSuiteId && prototypeVersionId) {
    const read = await readSuiteVersion(ctx, prototypeSuiteId, prototypeVersionId);
    if (!read.ok) return read;
    if (read.value.artifactRef.kind !== "prototype")
      return { ok: false, error: "source suite is not a prototype suite" };
    prototypeContent = "openui" in read.value.content ? read.value.content.openui?.trim() || null : null;
    basisPmDesign = "pmDesign" in read.value.content ? read.value.content.pmDesign?.trim() || null : null;
    if (!requirement && "requirement" in read.value.content) {
      suiteRequirement = read.value.content.requirement;
    }
    sourcePrototype = { suiteId: prototypeSuiteId, versionId: prototypeVersionId };
    inheritedTheme = {
      ...(read.value.themeId ? { themeId: read.value.themeId } : {}),
      ...(read.value.stage ? { stage: read.value.stage } : {}),
      ...(read.value.inherits ? { inherits: read.value.inherits } : {}),
      ...(read.value.references && read.value.references.length > 0 ? { references: read.value.references } : {}),
    };
    if (!prototypeContent) return { ok: false, error: "selected prototype suite version has no OpenUI content" };
  } else if (prototypeId) {
    prototypeContent = readArtifactFile(ctx.projectRoot, prototypeId, "prototype.openui.txt");
    if (!prototypeContent) return { ok: false, error: `prototype artifact not found for id "${prototypeId}"` };
  }

  // The caller's input object is never mutated; the suite's stored requirement
  // reaches BOTH the generation prompt and the persisted version (previously
  // the prompt still saw the stale pre-read snapshot).
  const effectiveRequirement = requirement ?? suiteRequirement;
  // specs/prompt-doc-chain：基底原型携带 pm-design → 先产出 ui-design.md
  // （视觉强化提示词，随 render_leafer 落盘）再画布生成；无 pm-design（旧
  // 数据）→ 既有提示词字节不变（降级零回归）。
  let uiDesign: string | null = null;
  if (basisPmDesign) {
    ctx.emit({
      message: "Strengthening the design intent into the ui-design prompt document",
      percent: 30,
      data: { code: "design.uidesign.generating" },
    });
    // specs/design-stage-gates S2：uiSectionsAudit 四节门 + findings 修复一轮；
    // 修复仍败 **fail-open 降级**（uiDesign 置空，画布按既有原型驱动提示词
    // 生成，与无 pm-design 的旧路径同构）——OCR plan-failure 分层借鉴：增强
    // 阶段失败不阻塞主管线（此前轻检查失败会硬错误整个 materialize）。
    const uiResult = await runDesignStage(ctx, {
      stage: "ui-design",
      skill: "deep-design",
      buildPrompt: (findings) => {
        const base =
          "Strengthen the interaction design intent below into a ui-design prompt document for a " +
          "visual-canvas generator — a VISUAL TRANSLATION of the pm-design, not a restatement. " +
          UI_DESIGN_CONTRACT +
          " Do not call tools. " +
          "Return only the complete markdown document in one markdown code fence.\n\n" +
          "## pm-design（交互意图，翻译源）\n" +
          basisPmDesign +
          (prototypeContent ? "\n\n## 原型程序（页面/流的保真参照）\n" + prototypeContent : "") +
          (effectiveRequirement ? "\n\n## 需求\n" + effectiveRequirement : "");
        if (findings && findings.length > 0) {
          return base + "\n\n## 深度审计 findings（逐条修复，不得删节）\n" + findings.map((f) => "- " + f).join("\n");
        }
        return base;
      },
      extract: (generated) => {
        // {content} 包装走嵌套围栏感知树（字符串直入会在内层围栏截断）。
        const doc = generated === null ? null : extractMarkdownDocument({ content: generated });
        if (!doc || !/^#\s+/m.test(doc)) return null;
        return normalizeGeneratedMarkdown(doc);
      },
      audit: uiSectionsAudit,
      maxRepairs: 1,
      progressCode: "design.uidesign.repairing",
      basePercent: 40,
    });
    if (uiResult.ok) {
      if (ctx.signal.aborted) return { ok: false, error: "cancelled" };
      uiDesign = uiResult.document;
      // 交叉审查修复：saved 终态码移到 render_leafer 成功后发射——ui-design
      // 随画布同一调用落盘，画布生成失败时不得谎报"已保存"。
    } else {
      ctx.emit({
        message: `ui-design strengthening failed — falling back to prototype-driven generation (${uiResult.error})`,
        percent: 45,
        data: { code: "design.uidesign.degraded" },
      });
    }
  }
  // specs/prompt-doc-chain:materialize.generating 移到 ui-design stage 之后
  // ——进度叙事与真实阶段一致（先蒸馏视觉意图，再生成画布）。
  ctx.emit({
    message: "Generating UI design from the selected prototype and design system",
    percent: 50,
    data: { code: "design.materialize.generating" },
  });
  // specs/leafer-ui-engine WP0.3: the UI-Design stack produces a Leafer JSON
  // scene tree (prototype module stays on OpenUI Lang — guard-tested split).
  const promptParts = [
    effectiveRequirement
      ? `Create a complete Leafer scene-tree JSON document for this requirement: ${effectiveRequirement}`
      : "Create a complete Leafer scene-tree JSON document elevating the selected prototype.",
    LEAFER_CREATE_CONTRACT,
    `Use this bundled design system exactly. Its complete source is included below:\n\n${designSystem}`,
  ];
  if (uiDesign) {
    // specs/prompt-doc-chain：ui-design.md 主驱动——画布从视觉翻译文档出发，
    // 原型程序降为保真参照。
    promptParts.push(
      "The ui-design document below is the distilled VISUAL intent — drive the canvas from it. " +
        "The prototype program after it is the fidelity reference for pages/flows.\n\n" +
        "## ui-design（视觉意图——主驱动）\n" +
        uiDesign +
        (prototypeContent ? "\n\n## 原型程序（保真参照）\n" + prototypeContent : "")
    );
  } else if (prototypeContent) {
    promptParts.push(
      "Cover every page and flow in this OpenUI prototype as separate canvas frames (one Frame per page, " +
        "labeled with a Text node), preserving its information architecture and Action wiring as visual " +
        "annotations:\n\n" +
        prototypeContent
    );
  }
  promptParts.push(
    "Do not call tools. Return only the complete Leafer scene-tree JSON document in one json code fence."
  );

  try {
    const generated = await callSubagentStable(
      ctx,
      { skill: "deep-design", prompt: promptParts.join("\n\n"), silent: true },
      "canvas-generate"
    );
    const content = extractGeneratedBody(generated);
    if (!content || !looksLikeLeaferDocument(content)) {
      return {
        ok: false,
        error: "deep-design returned an empty or invalid Leafer JSON document (no root/children) — regenerate",
      };
    }
    // specs/design-stage-gates S5：画布深度门——基底原型已知页面数时 Frame
    // 缺页 = 破损 UI，定向修复一轮后仍缺则 fail-closed；节点密度只作软提示
    // 进修复契约（弱模型密度弹性大，硬门反致不稳定）。
    const requiredPages = prototypeContent ? programPageCount(prototypeContent) : undefined;
    let canvas = content;
    let depth = leaferCanvasFindings(canvas, requiredPages);
    if (depth.findings.length > 0) {
      ctx.emit({
        message: `Repairing canvas depth (${depth.findings.join("; ")})`,
        percent: 65,
        data: { code: "design.materialize.repairing" },
      });
      const depthRaw = await callSubagentStable(
        ctx,
        {
          skill: "deep-design",
          prompt:
            "The Leafer scene-tree JSON document below is missing required page frames. " +
            "Fix EVERY reported finding and return the COMPLETE corrected document in one json code fence. " +
            "Change nothing beyond what the findings require. Do not call tools.\n\n" +
            `${LEAFER_CREATE_CONTRACT}\n\nDepth findings:\n${depth.findings.map((f) => `- ${f}`).join("\n")}\n\nCurrent document:\n${canvas}`,
          silent: true,
        },
        "canvas-depth-repair"
      );
      const depthDoc = extractGeneratedBody(depthRaw);
      if (depthDoc && looksLikeLeaferDocument(depthDoc)) canvas = depthDoc;
      depth = leaferCanvasFindings(canvas, requiredPages);
      if (depth.findings.length > 0) {
        return { ok: false, error: `leafer canvas depth gate: ${depth.findings.join("; ")}` };
      }
    }
    // EARS 2/3: fail-closed repair loop — persistence only happens with a
    // structurally valid document (the OpenUI loop fails open because the
    // desktop validator/renderer remains the backstop; leafer has no such
    // second line, and the verdict source is deterministic).
    const repaired = await repairLeaferProgram(ctx, {
      text: canvas,
      contract:
        depth.softNotes.length > 0
          ? `${LEAFER_CREATE_CONTRACT}\nDepth notes: ${depth.softNotes.join("; ")}`
          : LEAFER_CREATE_CONTRACT,
      progressCode: "design.materialize.repairing",
      basePercent: 70,
    });
    if (!repaired.ok) return { ok: false, error: repaired.error };
    // 结构修复环理论上可能动掉 Frame——落盘前对最终产物复检硬门（确定性、零成本）。
    const finalDepth = leaferCanvasFindings(repaired.value, requiredPages);
    if (finalDepth.findings.length > 0) {
      return { ok: false, error: `leafer canvas depth gate after repair: ${finalDepth.findings.join("; ")}` };
    }
    if (ctx.signal.aborted) return { ok: false, error: "cancelled" };
    // F11：追加到既有套件且本次没有新 ui-design → 空串显式清除（见上）。
    const uiDesignArg = uiDesign !== null ? uiDesign : suiteId ? "" : undefined;
    const saved = await executeA2ui(ctx, "render_leafer", {
      leafer: repaired.value,
      requirement: effectiveRequirement,
      designSystemId,
      ...(sourcePrototype ? { sourcePrototype } : {}),
      // 主题字段自动继承（specs/prd-theme-layer WP3）：UI 套件 meta 随基底
      // 原型的主题/关系落地，工作台/目录可后经 IPC 手动改。

      // specs/prompt-doc-chain：ui-design.md 随 UI 版本落内容字段（uiDesignArg
      // 见上——含空串显式清除语义）。
      ...(uiDesignArg !== undefined ? { uiDesign: uiDesignArg } : {}),
      ...(inheritedTheme?.themeId ? { themeId: inheritedTheme.themeId } : {}),
      ...(inheritedTheme?.stage ? { stage: inheritedTheme.stage } : {}),
      ...(inheritedTheme?.inherits
        ? {
            inheritsSuiteId: inheritedTheme.inherits.suiteId,
            ...(inheritedTheme.inherits.versionId ? { inheritsVersionId: inheritedTheme.inherits.versionId } : {}),
          }
        : {}),
      ...(inheritedTheme?.references && inheritedTheme.references.length > 0
        ? {
            references: inheritedTheme.references.map((ref) => ({
              suiteId: ref.suiteId,
              ...(ref.versionId ? { versionId: ref.versionId } : {}),
            })),
          }
        : {}),
      ...(suiteId ? { suiteId, versionId } : {}),
      ...(input.note?.trim() ? { note: input.note.trim() } : {}),
    });
    if (!saved.ok) return saved;
    // specs/prompt-doc-chain：ui-design 与画布同调用落盘成功——终态码在此。
    if (uiDesign) {
      ctx.emit({
        message: "ui-design prompt document saved with the canvas",
        percent: 95,
        data: { code: "design.uidesign.saved" },
      });
    }
    ctx.emit({ message: "UI design suite version saved", percent: 100, data: { code: "design.materialize.saved" } });
    try {
      const sessionId = ctx.activeSessionId?.();
      const ref = sessionId ? ctx.getSessionTaskRef?.(sessionId) : undefined;
      if (ref) {
        const service = ctx.taskTrees?.();
        service?.switchBranch(ref.treeId, ref.branch);
        service?.appendStep(ref.treeId, {
          title: `UI design materialized: ${(effectiveRequirement ?? prototypeId ?? prototypeSuiteId ?? "").slice(0, 80)}`,
          why: "design.materialize produced a versioned UI design.",
        });
      }
    } catch {
      // Task lineage is best-effort.
    }
    return {
      ok: true,
      pipeline: "design",
      artifactId: null,
      artifactRef: saved.artifactRef,
      refreshStore: !saved.artifactRef,
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
};

// ── design.lint / design.review / design.revise — suite v2 quality loop ────────

interface StoredLintFinding {
  id: string;
  preset: string;
  ruleId: string;
  severity: "info" | "warning" | "error";
  nodePath: string;
  message: string;
  suggestion?: string;
}

interface DesignQualityReview {
  status: "pending" | "passed" | "failed";
  composite: number;
  rounds: number;
  evidence: Record<string, unknown>;
}

interface DesignQuality {
  lintFindings: StoredLintFinding[];
  runtimeChecks: Array<{ id: string; label: string; status: "pending" | "passed" | "failed"; value?: unknown }>;
  review?: DesignQualityReview;
}

interface SuiteActionInput {
  suiteId: string;
  versionId: string;
  note?: string;
}

interface SuiteActionOutput {
  ok: boolean;
  artifactRef?: ArtifactRef;
  refreshStore?: boolean;
  error?: string;
}

function uiContent(value: unknown): UiSuiteContent | null {
  return typeof value === "object" && value !== null ? (value as UiSuiteContent) : null;
}

function parseJsonValue(text: string): unknown {
  // Line-anchored like prototype.ts's body extraction: a prose line merely
  // MENTIONING ``` must not open the capture ahead of the real json fence.
  const fenced = text.match(/^[ \t]*```(?:json)?[ \t]*\n([\s\S]*?)```/im)?.[1] ?? text;
  return JSON.parse(fenced.trim()) as unknown;
}

function currentQuality(content: UiSuiteContent): DesignQuality {
  const value = content.quality;
  if (value && typeof value === "object") {
    const quality = value as unknown as Partial<DesignQuality>;
    return {
      lintFindings: Array.isArray(quality.lintFindings) ? quality.lintFindings : [],
      runtimeChecks: Array.isArray(quality.runtimeChecks) ? quality.runtimeChecks : [],
      ...(quality.review ? { review: quality.review } : {}),
    };
  }
  return { lintFindings: [], runtimeChecks: [] };
}

/** Deterministic static rules over an OpenUI Lang program (no browser, no LLM). */

/** A style-ish context keyword — hex literals are only colors near these. */
const STYLE_CONTEXT = /(?:color|background|border|fill|stroke|shadow|gradient|style\s*=)/i;

/**
 * Valid hex color token: 3/4/6/8 digits only (no 5/7), and the `#` must not
 * ride on a word char, path separator, `.`, `-` or another `#` — so issue
 * anchors like "#123" in prose or "#aabbccd" garbage never look like colors
 * while `color:#aabbcc` keeps matching.
 */
const HEX_COLOR = /(?<![\w/.#-])#[0-9a-fA-F]{3}(?:[0-9a-fA-F]|[0-9a-fA-F]{3}|[0-9a-fA-F]{5})?(?![0-9a-fA-F])/;

function lintOpenuiDocument(code: string): StoredLintFinding[] {
  const findings: StoredLintFinding[] = [];
  const push = (ruleId: string, severity: StoredLintFinding["severity"], message: string, nodePath?: string) => {
    findings.push({
      id: `${ruleId}-${findings.length + 1}`,
      preset: "openui-static",
      ruleId,
      severity,
      nodePath: nodePath ?? "document",
      message,
    });
  };
  // WP2.4:tiny-font/hardcoded-color 是 CSS 形状正则,在 OpenUI Lang DSL 上
  // 永不命中(死规则);替换为 DSL 有意义的确定性检查(单一来源:prototype.ts
  // 的 findDeadButtons + openui-pages 的程序页面提取),保留 emoji-glyph。
  const lines = code.split("\n");
  lines.forEach((line, index) => {
    const emoji = line.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
    if (emoji) {
      push("emoji-glyph", "info", `Line ${index + 1}: emoji glyph "${emoji[0]}" in UI copy; prefer icon assets.`);
    }
  });
  for (const finding of findDeadButtons(code)) {
    push("dead-button", "warning", finding);
  }
  const pages = extractProgramPages(code);
  for (const target of pages.navTargets) {
    if (!pages.comparisons.has(target) && target !== pages.initial) {
      push("dangling-nav", "warning", `@Set($page, "${target}") targets a page with no view branch — dead navigation.`);
    }
  }
  return findings;
}

export const designLintDefinition: ActionDefinition<SuiteActionInput> = {
  id: "design.lint",
  description:
    "Run deterministic static OpenUI rules over one UI suite version and persist quality.lintFindings. No browser testing is claimed.",
  category: "design",
  parameters: {
    type: "object",
    properties: {
      suiteId: { type: "string" },
      versionId: { type: "string" },
      note: { type: "string" },
    },
    required: ["suiteId", "versionId"],
    additionalProperties: false,
  },
  sideEffects: ["write-in-cwd"],
};

export interface DesignLintOutput extends SuiteActionOutput {
  findings?: StoredLintFinding[];
}

export const designLintRun: ActionRun<SuiteActionInput, DesignLintOutput> = async (input, ctx) => {
  const suiteId = input?.suiteId?.trim();
  const versionId = input?.versionId?.trim();
  if (!suiteId || !versionId) return { ok: false, error: "suiteId and versionId are required" };
  const read = await readSuiteVersion(ctx, suiteId, versionId);
  if (!read.ok) return read;
  if (read.value.artifactRef.kind !== "ui") return { ok: false, error: "suite is not a UI suite" };
  const content = uiContent(read.value.content);
  if (!content) return { ok: false, error: "invalid UI suite content" };
  // specs/leafer-ui-engine WP2.2: field-level dual-stack routing (EARS 9/17) —
  // a leafer version lints the scene JSON, a legacy OpenUI version the program.
  const leafer = content.leafer?.trim();
  const openui = content.openui?.trim();
  if (!leafer && !openui) return { ok: false, error: "selected UI suite version has no design" };
  const findings = leafer ? lintLeaferDocument(leafer, content.tokens) : lintOpenuiDocument(openui!);
  const quality = { ...currentQuality(content), lintFindings: findings };
  const saved = await executeA2ui(ctx, "save_suite_result", {
    suiteId,
    versionId,
    quality,
    note: input.note?.trim() || (leafer ? "deterministic Leafer static lint" : "deterministic OpenUI static lint"),
  });
  return saved.ok
    ? { ok: true, artifactRef: saved.artifactRef, findings, refreshStore: !saved.artifactRef }
    : { ok: false, error: saved.error };
};

export interface DesignReviewInput extends SuiteActionInput {
  focus?: string;
}

export interface DesignReviewOutput extends SuiteActionOutput {
  review?: DesignQualityReview;
}

export const designReviewDefinition: ActionDefinition<DesignReviewInput> = {
  id: "design.review",
  description:
    "Opt-in single-round LLM review of a selected UI suite version. Persists a schema-validated evidence review with rounds=1.",
  category: "design",
  parameters: {
    type: "object",
    properties: {
      suiteId: { type: "string" },
      versionId: { type: "string" },
      focus: { type: "string" },
      note: { type: "string" },
    },
    required: ["suiteId", "versionId"],
    additionalProperties: false,
  },
  sideEffects: ["write-in-cwd"],
};

type ReviewValidation = { ok: true; review: DesignQualityReview } | { ok: false; error: string };

/** True when the value tree carries at least one concrete observation
 *  (non-empty string or finite number) within the depth bound. */
function hasConcreteEvidenceLeaf(value: unknown, depth = 0): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  if (depth >= 4) return false;
  if (Array.isArray(value)) return value.some((item) => hasConcreteEvidenceLeaf(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.values(value).some((item) => hasConcreteEvidenceLeaf(item, depth + 1));
  }
  return false;
}

function validateReview(value: unknown): ReviewValidation {
  if (!value || typeof value !== "object") return { ok: false, error: "review JSON is not an object" };
  const record = value as Record<string, unknown>;
  if ((record.status !== "passed" && record.status !== "failed") || typeof record.composite !== "number") {
    return { ok: false, error: "status must be passed/failed and composite a number" };
  }
  if (!Number.isFinite(record.composite) || record.composite < 0 || record.composite > 1) {
    return { ok: false, error: "composite must be a finite number between 0 and 1" };
  }
  if (!record.evidence || typeof record.evidence !== "object" || Array.isArray(record.evidence)) {
    return { ok: false, error: "evidence must be an object" };
  }
  const evidence = record.evidence as Record<string, unknown>;
  // An empty evidence object would promote the suite to verified on the LLM's
  // word alone — require at least one concrete observation. Re-review fix: the
  // check walks one level of nesting/arrays so legitimate shapes like
  // {"findings": ["#submit"]} or {"contrast": {"ratio": 3.2}} pass while
  // {} / {"a": ""} still fail.
  if (!hasConcreteEvidenceLeaf(evidence)) {
    return { ok: false, error: "evidence must contain at least one non-empty string or number value" };
  }
  return {
    ok: true,
    review: {
      status: record.status,
      composite: record.composite,
      rounds: 1,
      evidence,
    },
  };
}

export const designReviewRun: ActionRun<DesignReviewInput, DesignReviewOutput> = async (input, ctx) => {
  const suiteId = input?.suiteId?.trim();
  const versionId = input?.versionId?.trim();
  if (!suiteId || !versionId) return { ok: false, error: "suiteId and versionId are required" };
  if (!ctx.runSubagent) return { ok: false, error: "runSubagent not available" };
  const read = await readSuiteVersion(ctx, suiteId, versionId);
  if (!read.ok) return read;
  if (read.value.artifactRef.kind !== "ui") return { ok: false, error: "suite is not a UI suite" };
  const content = uiContent(read.value.content);
  if (!content) return { ok: false, error: "invalid UI suite content" };
  // Field-level dual-stack input (EARS 11/17): the review reads whichever
  // artifact the version carries; the schema/validation side is unchanged.
  const designField = content.leafer?.trim()
    ? { kind: "Leafer scene-tree JSON", text: content.leafer }
    : content.openui?.trim()
      ? { kind: "OpenUI design", text: content.openui }
      : null;
  if (!designField) return { ok: false, error: "selected UI suite version has no design" };
  const quality = currentQuality(content);
  const reviewed = await ctx.runSubagent({
    skill: "deep-design",
    prompt:
      `Review the ${designField.kind} and existing deterministic quality below. This is one text-only review round; do not ` +
      "claim browser or runtime checks. Return only JSON with status ('passed' or 'failed'), composite (0..1), and " +
      "evidence (an object containing concrete quoted selectors/tokens/sections and observations)." +
      (input.focus?.trim() ? ` Focus: ${input.focus.trim()}.` : "") +
      `\n\nDESIGN:\n${designField.text}\n\nQUALITY:\n${JSON.stringify(quality)}`,
    silent: true,
  });
  const text = extractGeneratedBody(reviewed);
  if (!text) return { ok: false, error: "deep-design returned no review JSON" };
  let validated: ReviewValidation | null = null;
  try {
    validated = validateReview(parseJsonValue(text));
  } catch {
    validated = null;
  }
  if (!validated?.ok) {
    return {
      ok: false,
      error: `deep-design returned review JSON that failed schema validation${
        validated && !validated.ok ? ` (${validated.error})` : ""
      }`,
    };
  }
  const review = validated.review;
  if (ctx.signal.aborted) return { ok: false, error: "cancelled" };
  const saved = await executeA2ui(ctx, "save_suite_result", {
    suiteId,
    versionId,
    quality: { ...quality, review },
    note: input.note?.trim() || "single-round design review",
  });
  return saved.ok
    ? { ok: true, artifactRef: saved.artifactRef, review, refreshStore: !saved.artifactRef }
    : { ok: false, error: saved.error };
};

export interface DesignReviseInput extends SuiteActionInput {
  part: "design" | "tokens" | "components" | "quality";
  target: string;
  instruction: string;
}

export const designReviseDefinition: ActionDefinition<DesignReviseInput> = {
  id: "design.revise",
  description:
    "Revise a selected UI suite version. Design uses deep-design; tokens/components use structured JSON; quality only clears review to pending.",
  category: "design",
  parameters: {
    type: "object",
    properties: {
      suiteId: { type: "string" },
      versionId: { type: "string" },
      part: { type: "string", enum: ["design", "tokens", "components", "quality"] },
      target: { type: "string" },
      instruction: { type: "string" },
      note: { type: "string" },
    },
    required: ["suiteId", "versionId", "part", "target", "instruction"],
    additionalProperties: false,
  },
  sideEffects: ["write-in-cwd"],
};

export const designReviseRun: ActionRun<DesignReviseInput, SuiteActionOutput> = async (input, ctx) => {
  const suiteId = input?.suiteId?.trim();
  const versionId = input?.versionId?.trim();
  const target = input?.target?.trim();
  const instruction = input?.instruction?.trim();
  if (!suiteId || !versionId || !target || !instruction) {
    return { ok: false, error: "suiteId, versionId, target and instruction are required" };
  }
  const read = await readSuiteVersion(ctx, suiteId, versionId);
  if (!read.ok) return read;
  if (read.value.artifactRef.kind !== "ui") return { ok: false, error: "suite is not a UI suite" };
  const content = uiContent(read.value.content);
  if (!content) return { ok: false, error: "invalid UI suite content" };
  if (input.part === "quality") {
    const saved = await executeA2ui(ctx, "save_suite_result", {
      suiteId,
      versionId,
      clearReview: true,
      note: input.note?.trim() || `quality review cleared: ${target}`,
    });
    return saved.ok
      ? { ok: true, artifactRef: saved.artifactRef, refreshStore: !saved.artifactRef }
      : { ok: false, error: saved.error };
  }
  if (!ctx.runSubagent) return { ok: false, error: "runSubagent not available" };
  if (input.part === "design") {
    // specs/leafer-ui-engine WP0.4: leafer suites revise on the leafer baseline
    // (field-level routing, EARS 17); legacy OpenUI suites keep the update_openui
    // path below — one suite version never mixes both fields.
    if (content.leafer?.trim()) {
      // UI→prompt stable baseline (WP5, M3E #2/#5/#7): the canonical JSON plus
      // the deterministic semantic outline (elements addressed by stable
      // names, geometry translated to position words) make the revision
      // prompt a pure function of the stored document — byte-identical for
      // the same input, so like-for-like instructions cannot jitter.
      const baseline = canonicalLeaferJson(content.leafer) ?? content.leafer;
      const { outline } = describeLeaferDocument(baseline);
      // The deterministic lint addresses nodes by JSON path, but the outline
      // (and the create contract) address them by stable name — resolve the
      // path to its name so the instruction cites the vocabulary the prompt
      // itself advertises (bare path for unnamed nodes; still a pure function
      // of the stored document, so the prompt cannot jitter).
      const targetName = leaferNodeStableNameAt(baseline, target);
      const generated = await ctx.runSubagent({
        skill: "deep-design",
        prompt:
          `Revise only this Leafer scene-tree target: ${target}${targetName ? ` ("${targetName}")` : ""}. ` +
          `Instruction (verbatim): "${instruction}". Preserve unrelated content. ` +
          `${LEAFER_PRESERVE_CONTRACT} ${LEAFER_CREATE_CONTRACT} ` +
          `Current design outline (semantic map — address elements by their stable names):\n${outline}\n\n` +
          // specs/prompt-doc-chain：ui-design 存在时作为视觉意图基线注入
          // （存储文档的纯函数——无抖动约定不破）。
          (content.uiDesign
            ? `Current ui-design visual intent (from the prototype — keep it honored):\n${content.uiDesign}\n\n`
            : "") +
          "Current scene JSON (canonical). Modify ONLY what the instruction requires and return the COMPLETE " +
          `revised document in one json code fence. Do not call tools.\n${baseline}`,
        silent: true,
      });
      const revised = extractGeneratedBody(generated);
      if (!revised || !looksLikeLeaferDocument(revised)) {
        return {
          ok: false,
          error: "deep-design returned empty or invalid Leafer JSON content (truncated output?) — regenerate",
        };
      }
      const repaired = await repairLeaferProgram(ctx, {
        text: revised,
        contract: `${LEAFER_PRESERVE_CONTRACT} ${LEAFER_CREATE_CONTRACT}`,
        progressCode: "design.revise.repairing",
        basePercent: 70,
      });
      if (!repaired.ok) return { ok: false, error: repaired.error };
      if (ctx.signal.aborted) return { ok: false, error: "cancelled" };
      const saved = await executeA2ui(ctx, "render_leafer", {
        leafer: repaired.value,
        suiteId,
        versionId,
        ...(content.designSystemId ? { designSystemId: content.designSystemId } : {}),
        ...(content.sourcePrototype ? { sourcePrototype: content.sourcePrototype } : {}),
        note: input.note?.trim() || `design revision: ${target}`,
      });
      return saved.ok
        ? { ok: true, artifactRef: saved.artifactRef, refreshStore: !saved.artifactRef }
        : { ok: false, error: saved.error };
    }
    if (!content.openui?.trim()) return { ok: false, error: "selected UI suite version has no design" };
    const generated = await ctx.runSubagent({
      skill: "deep-design",
      prompt:
        `Revise only this OpenUI Lang target: ${target}. Instruction: ${instruction}. Preserve unrelated content. ` +
        `${OPENUI_PRESERVE_CONTRACT} ` +
        `Return only the complete revised OpenUI Lang program in one openui code fence. Do not call tools.\n\n${content.openui}`,
      silent: true,
    });
    const revised = extractGeneratedBody(generated);
    if (!revised || !looksLikeOpenuiProgram(revised)) {
      return {
        ok: false,
        error: "deep-design returned empty or structurally invalid content (truncated output?) — regenerate",
      };
    }
    // WP2.5:修订线同标准——持久化前过修复环。
    const verifiedRevised = await repairOpenuiProgram(ctx, {
      code: revised,
      contract: `${OPENUI_PRESERVE_CONTRACT} ${OPENUI_CREATE_CONTRACT}`,
      progressCode: "design.revise.repairing",
      basePercent: 70,
    });
    if (ctx.signal.aborted) return { ok: false, error: "cancelled" };
    const saved = await executeA2ui(ctx, "update_openui", {
      suiteId,
      versionId,
      code: verifiedRevised,
      ...(content.designSystemId ? { designSystemId: content.designSystemId } : {}),
      ...(content.sourcePrototype ? { sourcePrototype: content.sourcePrototype } : {}),
      note: input.note?.trim() || `design revision: ${target}`,
    });
    return saved.ok
      ? { ok: true, artifactRef: saved.artifactRef, refreshStore: !saved.artifactRef }
      : { ok: false, error: saved.error };
  }

  const current = input.part === "tokens" ? content.tokens : content.components;
  const generated = await ctx.runSubagent({
    skill: "deep-design",
    prompt:
      `Revise the ${input.part} JSON only. Target: ${target}. Instruction: ${instruction}. Preserve unrelated values. ` +
      `Return only valid JSON in one json code fence.\n\n${JSON.stringify(current ?? null)}`,
    silent: true,
  });
  const text = extractGeneratedBody(generated);
  if (!text) return { ok: false, error: `deep-design returned no ${input.part} JSON` };
  let revised: unknown;
  try {
    revised = parseJsonValue(text);
  } catch {
    return { ok: false, error: `deep-design returned invalid ${input.part} JSON` };
  }
  const saved = await executeA2ui(ctx, "save_suite_result", {
    suiteId,
    versionId,
    [input.part]: revised,
    note: input.note?.trim() || `${input.part} revision: ${target}`,
  });
  return saved.ok
    ? { ok: true, artifactRef: saved.artifactRef, refreshStore: !saved.artifactRef }
    : { ok: false, error: saved.error };
};

// ── design.extract / design.drift — dembrandt brand ingestion (E1b/E1c) ──────

/**
 * Run the dembrandt CLI (vendored install only — offline; there is no runtime
 * npx fallback) via the host-injected Spawner. The spawn itself lives in
 * common/dembrandt.ts (runDembrandtProcess); this wrapper only adapts the
 * action's URL inputs: every URL reaching the CLI is pre-validated here
 * (http/https, public host — SSRF guard) before it is allowed into argv.
 *
 * With no spawner configured (NULL_SPAWNER) the stdout iteration rejects and
 * the registry surfaces it as a structured ACTION_FAILED ("NULL_SPAWNER: …")
 * instead of a silent no-op.
 */
async function runDembrandtCli(
  ctx: ActionContext,
  cliArgs: readonly string[],
  cwd: string
): Promise<{ code: number; stdout: string; stderr: string; spawnError?: string }> {
  return runDembrandtProcess(ctx, cliArgs, cwd);
}

/** Best-effort minimal JSON parse — the action never depends on the payload shape. */
function tryParseJson(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Keep only the tail of a stderr blob for error messages (it carries the actual cause). */
function stderrTail(stderr: string, max = 800): string {
  const trimmed = stderr.trim();
  return trimmed.length > max ? `…${trimmed.slice(-max)}` : trimmed;
}

const DEMBRANDT_TOKENS_CHAR_CAP = 24_000;

export interface DesignExtractInput {
  /** Website to extract the brand/design system from (http/https URL — the CLI renders it). */
  url: string;
  /** Optional workspace root for the temp output dir (defaults to ctx.projectRoot). */
  projectRoot?: string;
}

export interface DesignExtractOutput {
  ok: boolean;
  url?: string;
  /** Temp dir the CLI's artifacts landed in (spawner cwd — kept for the agent to read via the gated read tool). */
  outputDir?: string;
  /** The CLI's `--json-only` payload — the design tokens (DTCG-shaped, schema-versioned upstream). */
  tokensJson?: string;
  /** Deterministic next-step instruction for the agent (see the comment in designExtractRun). */
  instruction?: string;
  error?: string;
}

export const designExtractDefinition: ActionDefinition<DesignExtractInput> = {
  id: "design.extract",
  description:
    "Extract a website's brand/design system into structured design tokens (colors with semantic roles, " +
    "typography scale, spacing, radius, shadows, motion, logo, contrast audit) via the pinned dembrandt CLI. " +
    "Returns the token JSON plus an instruction to persist the brand contract to .deeporca/DESIGN.md — " +
    "the input side of the design pipeline (deep-design Step 0 / bento / OpenUI generation constraints).",
  category: "design",
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "Website URL to extract the design system from (e.g. 'https://example.com')",
      },
      projectRoot: {
        type: "string",
        description: "Optional workspace root for the temp output dir (defaults to the current project)",
      },
    },
    required: ["url"],
    additionalProperties: false,
  },
  // Honest declaration: the CLI fetches the URL over the network (and renders
  // it with a Playwright-driven browser, provisioned offline — see
  // common/dembrandt.ts). The CLI's own file writes
  // (extraction artifacts) go through the spawner cwd — a temp dir under
  // .deeporca/ in the session workspace, host-gated at the spawner layer —
  // and the durable .deeporca/DESIGN.md write is deliberately NOT done here
  // (see designExtractRun).
  sideEffects: ["network"],
};

export const designExtractRun: ActionRun<DesignExtractInput, DesignExtractOutput> = async (input, ctx) => {
  const url = input?.url?.trim();
  if (!url) {
    return { ok: false, error: "url is required" };
  }
  // SSRF guard: the CLI fetches and renders this URL — only public http/https
  // targets are allowed to reach argv (validate before anything is spawned).
  const target = validateDembrandtTargetUrl(url);
  if (!target.ok) {
    return { ok: false, error: target.error };
  }

  ctx.emit({
    message: `🎨 Extracting brand tokens from ${target.url}…`,
    percent: 20,
    data: { code: "design.tokens.extracting" },
  });

  // Temp workspace for the CLI's artifacts. Upstream has no `--output <dir>`
  // flag — `--save-output` writes `output/<domain>/` relative to the process
  // cwd — so the temp dir is passed as the SPAWN CWD instead (same effect,
  // only documented flags used). Created under .deeporca/ (the product's own
  // config dir) so nothing is scattered in the user's project root.
  const root = input?.projectRoot?.trim() || ctx.projectRoot;
  const outputDir = path.join(root, ".deeporca", "tmp", "dembrandt", `${Date.now()}-${randomUUID().slice(0, 8)}`);
  fs.mkdirSync(outputDir, { recursive: true });

  ctx.emit({
    message: "🌐 Rendering page and extracting tokens…",
    percent: 50,
    data: { code: "design.tokens.rendering" },
  });

  const { code, stdout, stderr, spawnError } = await runDembrandtCli(
    ctx,
    [target.url, "--json-only", "--save-output"],
    outputDir
  );

  if (spawnError) {
    return { ok: false, url: target.url, error: spawnError };
  }

  if (code !== 0) {
    // Exit 1 here is a hard failure (drift's "exit 1 on drift" semantics only
    // apply to --compare). Surface the stderr tail; the common first-run cause
    // is a missing browser engine. DeepOrca uses the Electron built-in Chromium
    // via CDP (no download ever); a browser error here means the provider
    // window failed to start, which surfaces in the stderr tail.
    return {
      ok: false,
      url: target.url,
      error: `dembrandt exited with code ${code}: ${stderrTail(stderr) || "no stderr output"}.`,
    };
  }

  // Minimal parse — never over-parse the schema-versioned payload: the tool
  // result text carries the tokens; `domain` is the only field used here.
  const payload = tryParseJson(stdout);
  const meta = payload?.meta as Record<string, unknown> | undefined;
  let domain: string | undefined;
  if (typeof payload?.domain === "string") {
    domain = payload.domain;
  } else if (meta && typeof meta.domain === "string") {
    domain = meta.domain;
  }

  const truncated = stdout.length > DEMBRANDT_TOKENS_CHAR_CAP;
  const tokensJson = truncated ? `${stdout.slice(0, DEMBRANDT_TOKENS_CHAR_CAP)}\n…[truncated]` : stdout;

  ctx.emit({ message: "✅ Tokens extracted", percent: 90, data: { code: "design.tokens.extracted" } });

  // PERSISTENCE CONTRACT (deliberate, sandbox-correct): this action does NOT
  // write .deeporca/DESIGN.md itself. The write is agent-mediated — the
  // instruction below tells the agent to use the built-in `write` tool, which
  // goes through the write tool's own PathGate/permission gating (and
  // file-history tracking). A direct fs write here would bypass that gate;
  // routing through the agent keeps one privileged writer for project files.
  const instruction = [
    "Persist this brand contract:",
    "1. Distill tokensJson into a brand section (colors with semantic roles, typography scale, spacing/radius/shadows, motion).",
    "2. Use the built-in `write` tool to create or update `.deeporca/DESIGN.md` at the project root with that section",
    "   (the write is permission-gated — that is intentional; this action never writes project files itself).",
    "3. Include a `## Provenance` block in DESIGN.md: source URL, extraction date, tool (dembrandt, pinned vendored version),",
    '   and the note "extracted tokens are for internal design reference only — do not replicate copyrighted visual assets".',
    "4. The deep-design skill's Step 0 reads `.deeporca/DESIGN.md` as the token source for subsequent generation.",
    truncated
      ? `5. tokensJson was truncated — read the full extraction from the files under ${outputDir}.`
      : `5. Full CLI artifacts were also saved under ${outputDir}.`,
  ].join("\n");

  return { ok: true, url: target.url, domain, outputDir, tokensJson, instruction };
};

export interface DesignDriftInput {
  /** Baseline extraction JSON — a file path (typically committed) or URL. */
  baseline: string;
  /** Current design to extract live and compare — a URL (or local file path). */
  current: string;
}

export interface DesignDriftOutput {
  ok: boolean;
  /** True when the drift gate tripped (exit 1): the current design deviates from the baseline. */
  driftDetected?: boolean;
  /** 0–100 drift score from the CLI (0 = pixel-faithful). */
  score?: number;
  summary?: string;
  /** The CLI's `--json-only` drift payload (score/status/summary/changes[]). */
  driftJson?: string;
  error?: string;
}

export const designDriftDefinition: ActionDefinition<DesignDriftInput> = {
  id: "design.drift",
  description:
    "Brand-drift gate: extract a site's live design tokens and compare them against a baseline extraction " +
    "(dembrandt --compare). Returns a deterministic 0–100 drift score with per-token findings — no LLM involved. " +
    "Use after regenerating pages to verify the design did not deviate from the brand baseline.",
  category: "design",
  parameters: {
    type: "object",
    properties: {
      baseline: {
        type: "string",
        description: "Baseline extraction JSON — file path (e.g. '.deeporca/design-baseline.json') or URL",
      },
      current: {
        type: "string",
        description: "Current design to extract and compare — site URL (or local file path)",
      },
    },
    required: ["baseline", "current"],
    additionalProperties: false,
  },
  // Static declaration covering both input modes: the CLI fetches/renders the
  // `current` target over the network (network) and reads the baseline JSON
  // from the workspace (read-in-cwd). sideEffects is a static schema field,
  // so both scopes are declared rather than switched per invocation.
  sideEffects: ["network", "read-in-cwd"],
};

export const designDriftRun: ActionRun<DesignDriftInput, DesignDriftOutput> = async (input, ctx) => {
  const baseline = input?.baseline?.trim();
  const current = input?.current?.trim();
  if (!baseline || !current) {
    return { ok: false, error: "baseline and current are required" };
  }
  // SSRF guard: `current` is fetched/rendered by the CLI, and `baseline` may
  // itself be a URL — validate any URL-shaped input before it reaches argv.
  const currentTarget = validateDembrandtTargetUrl(current);
  if (!currentTarget.ok) {
    return { ok: false, error: `current: ${currentTarget.error}` };
  }
  let baselineArg = baseline;
  if (/^https?:\/\//i.test(baseline)) {
    const baselineTarget = validateDembrandtTargetUrl(baseline);
    if (!baselineTarget.ok) {
      return { ok: false, error: `baseline: ${baselineTarget.error}` };
    }
    baselineArg = baselineTarget.url;
  }

  ctx.emit({
    message: "📐 Comparing current design against baseline…",
    percent: 40,
    data: { code: "design.drift.comparing" },
  });

  // Upstream drift syntax: `dembrandt <target> --compare <baseline.json>
  // --json-only` — there is no `drift` subcommand; --compare IS the drift
  // gate (README + docs/ci.md). Exit codes: 0 = pass, 1 = drift detected
  // (a SUCCESSFUL comparison, not an error), 2 = extraction failure,
  // 67 = navigation timeout.
  const { code, stdout, stderr, spawnError } = await runDembrandtCli(
    ctx,
    [currentTarget.url, "--compare", baselineArg, "--json-only"],
    ctx.projectRoot
  );

  if (spawnError) {
    return { ok: false, error: spawnError };
  }

  if (code !== 0 && code !== 1) {
    return {
      ok: false,
      error: `dembrandt drift gate failed with exit code ${code}: ${stderrTail(stderr) || "no stderr output"}.`,
    };
  }

  const driftDetected = code === 1;

  // Minimal parse: only score/summary are lifted out; the full payload
  // (per-token changes[]) rides along as driftJson.
  const payload = tryParseJson(stdout);
  const candidate: unknown = payload?.drift ?? payload;
  const drift = typeof candidate === "object" && candidate !== null ? (candidate as Record<string, unknown>) : null;
  const rawScore = drift && typeof drift.score === "number" ? drift.score : undefined;
  const summary = drift && typeof drift.summary === "string" ? drift.summary : undefined;

  ctx.emit({
    message: driftDetected ? `⚠️ Drift detected (score ${rawScore ?? "?"})` : "✅ Within baseline",
    percent: 100,
    // Re-review fix: distinct codes — a single "done" collapsed both outcomes
    // into one localized label and hid the score/detected distinction.
    data: { code: driftDetected ? "design.drift.detected" : "design.drift.clean" },
  });

  return {
    ok: true,
    driftDetected,
    score: rawScore,
    summary,
    driftJson: stdout.trim() || undefined,
  };
};
