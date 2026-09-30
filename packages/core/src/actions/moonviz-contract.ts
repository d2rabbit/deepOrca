/**
 * MoonViz contract layer (specs/moonviz-engine-replacement T1.4) — the thin,
 * deterministic bridge between the PRD chain and the MoonViz engine.
 *
 * Replaces openui-contract.ts + the PRD-side parsers of openui-pages.ts
 * (engine-agnostic GFM parsing migrates here; OpenUI-syntax-specific program
 * parsing — $page comparisons, @Set targets, component histograms — dies with
 * the stack: the ENGINE now answers artboards/flows/tap authoritatively).
 *
 * Contents:
 *  - `MOONVIZ_SEED_DOC` — the canonical cold-start document. `session_open("")`
 *    returns -1, so materialize opens this once and immediately layers
 *    `template`/`create` ops on top; it is never persisted.
 *  - `MOONVIZ_DEVICE_CONTRACTS` / `MOONVIZ_QUALITY_CONTRACT` — prompt
 *    materials (migrated wording, moonviz vocabulary: one doc, three
 *    artboards, op-plan output).
 *  - PRD parsers: `extractTargetPlatforms` / `parsePageList` / `hasPageList`
 *    (verbatim migration from openui-pages.ts / prototype.ts — the PRD format
 *    is unchanged).
 *  - Coverage: `moonvizCoverageFindings(spec, artboards, flows)` — the
 *    PRD↔document page/flow comparison that replaced the $page regex checks.
 *  - `parseOpPlan` — the subagent op-plan extraction (one op per line).
 *  - Component vocabulary accessor over the injected components.json snapshot.
 */

import { moonvizComponentVocabulary } from "../common/moonviz-engine";

// ── seed document ────────────────────────────────────────────────────────────

/**
 * Canonical `.mbt.md` cold start (visual-block form — frontmatter + artboard
 * comment + mbt code block; `session_open("")` = -1 so seeding needs a real
 * doc). Mirrors scripts/vendor-moonviz.js SEED_DOC; `__seed` is deleted by
 * the materialize op plan before save, so it never reaches a suite version.
 */
export const MOONVIZ_SEED_DOC = `---
moonviz:
  format: visual-document
  revision: 1
  entry: __seed
---

# __seed

<!-- moonviz:artboard __seed -->
\`\`\`mbt
fn visual___seed() -> @decl.Prototype {
  let page = @decl.prototype(name="__seed", width=390.0, height=844.0)
  page
}
\`\`\`
`;

// ── devices & artboard plan ──────────────────────────────────────────────────

export type MoonvizDevice = "desktop" | "mobile" | "tablet";

export const MOONVIZ_DEVICES: readonly MoonvizDevice[] = ["desktop", "mobile", "tablet"];

/** Three-platform = ONE document with three artboards (design §0.4), each
 *  structurally its own canvas at the platform's canonical size. */
export const MOONVIZ_ARTBOARD_SIZES: Record<MoonvizDevice, { width: number; height: number }> = {
  desktop: { width: 1200, height: 800 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 390, height: 844 },
};

/** Artboard id suffix per device — artboard ids are `<page-id>@<device>` in
 *  multi-device docs and plain `<page-id>` in single-device docs, keeping
 *  one-to-one coverage mapping in both shapes. */
export function moonvizArtboardId(pageId: string, device: MoonvizDevice, multiDevice: boolean): string {
  return multiDevice ? `${pageId}@${device}` : pageId;
}

export function parseMoonvizArtboardId(artboardId: string): { pageId: string; device: MoonvizDevice | null } {
  const at = artboardId.lastIndexOf("@");
  if (at > 0) {
    const suffix = artboardId.slice(at + 1);
    if ((MOONVIZ_DEVICES as readonly string[]).includes(suffix)) {
      return { pageId: artboardId.slice(0, at), device: suffix as MoonvizDevice };
    }
  }
  return { pageId: artboardId, device: null };
}

/** Parse/normalize a caller-supplied device list against the known set. */
export function normalizeMoonvizDevices(devices?: readonly string[]): MoonvizDevice[] {
  if (!devices || devices.length === 0) return ["desktop"];
  const known = new Set<string>(MOONVIZ_DEVICES);
  const picked = devices.map((d) => d.trim()).filter((d): d is MoonvizDevice => known.has(d));
  return picked.length > 0 ? [...new Set(picked)] : ["desktop"];
}

// ── prompt contracts (migrated wording, moonviz vocabulary) ──────────────────

/** For revisions: what the model must keep from the existing document. */
export const MOONVIZ_PRESERVE_CONTRACT =
  "Preserve the existing artboards, their nodes, interactions and flows — the result stays ONE document " +
  "covering the same pages; never delete an artboard the instruction does not mention.";

/** For creation: single-interactive-document requirement with concrete ops. */
export const MOONVIZ_CREATE_CONTRACT =
  "It must be ONE .mbt.md document with one artboard per page of the 页面清单 (artboard id = page id, " +
  "or `<page-id>@<device>` when several devices are targeted), built through engine ops only: " +
  "`template`/`create <ab> <w> <h>` for artboards, then `place`, `interact`, `state`, `set-state`, " +
  "`flow` — navigation is `flow <from-ab> <to-ab> <node-id>`, never a hand-drawn arrow. " +
  "Do not write mbt code blocks yourself; emit OPS, one per line.";

/** Quality bar (pm-designer quality contract distilled; moonviz wording). */
export const MOONVIZ_QUALITY_CONTRACT =
  "Quality bar: the prototype must feel ALIVE — every implied control (tabs/modals/forms/filters/" +
  "switches/row actions) is placed and wired (`interact`/`state`/`set-state`), no dead buttons, every page " +
  "reachable via flows in one click, empty/confirm/loading feedback present; HIGH FIDELITY — real product " +
  "copy in the document's language, believable internally-consistent demo data, at most one primary CTA per " +
  "screen, no lorem ipsum; CONSISTENT — reuse the built-in tokens (`token`/`theme` ops) instead of ad-hoc colors.";

/** Per-platform artboard contracts — each device gets a STRUCTURALLY different
 *  canvas (navigation model, column layout, density) at its canonical size. */
export const MOONVIZ_DEVICE_CONTRACTS: Record<MoonvizDevice, string> = {
  desktop:
    "PLATFORM CONTRACT — desktop artboards are 1200×800: persistent LEFT SIDEBAR navigation (menu items with labels, " +
    "active state) plus a slim top bar (page title + primary global action); content uses the wide canvas — " +
    "multi-column card grids, side-by-side panels, dense data TABLES with row actions. Never a single centered column.",
  mobile:
    "PLATFORM CONTRACT — mobile artboards are 390×844: BOTTOM TAB BAR navigation pinned at the bottom of every page " +
    "(3-5 tabs, icon-style short labels, active state), content is ONE stacked column sized for one hand; the primary " +
    "CTA sits at the bottom within thumb reach; forms are full-width stacked fields; replace wide tables with CARD LISTS. " +
    "Never reuse the desktop sidebar or a wide table.",
  tablet:
    "PLATFORM CONTRACT — tablet artboards are 768×1024: SPLIT VIEW — a narrow left rail (navigation or master list) " +
    "beside a detail pane; two-column layouts where desktop uses three and mobile uses one; comfortable touch targets. " +
    "Neither a stretched phone column nor a shrunken desktop grid.",
};

/** Op-syntax cheatsheet injected into generation prompts (short form — the
 *  full machine-readable surface is `list_ops`; the snapshot covers it). */
export const MOONVIZ_OPS_CHEATSHEET =
  "Op syntax (one per line):\n" +
  "- `create <ab> <w> <h>` — new empty artboard\n" +
  "- `template <template-id> <ab> <w> <h>` — instantiate a built-in page template\n" +
  "- `place <ab> <comp> <id> [variant|-] [x] [y] [w] [h] [k=v…]` — place a component (w/h are the FINAL bbox; out-of-parent placements are REJECTED)\n" +
  "- `interact <ab> <node> <event> <action…>` / `state <ab> …` / `set-state <ab> …` — behavior\n" +
  "- `flow <from-ab> <to-ab> <node-id>` — navigation wire\n" +
  "- `theme <name>` / `token <k=v…>` — visual consistency\n" +
  "Rejections come back as `mbt_gate_block:<artboard>:<predicate>:<node>` — fix THAT placement and re-emit only the failed op.";

// ── component vocabulary (snapshot accessor) ─────────────────────────────────

/** Prompt block listing the component vocabulary (compact, id + variant count).
 *  词汇来源 = vendor 快照（components.json）；运行时 `list_components` 直调
 *  是校准通道——快照与引擎目录的漂移由 P0 电池的 drift 检查拦截。 */
export function moonvizComponentVocabularyBlock(): string {
  const vocabulary = moonvizComponentVocabulary();
  if (vocabulary.length === 0) return "";
  const lines = vocabulary.map((component) => {
    const variants = component.variants?.length ?? 0;
    return `- ${component.id}${variants ? ` (${variants} variants)` : ""}${component.name ? ` — ${component.name}` : ""}`;
  });
  return `## Component vocabulary (place <ab> <comp> … must use these ids)\n${lines.join("\n")}`;
}

// ── PRD-side parsers (migrated from openui-pages.ts verbatim) ────────────────

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isTableSeparator(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^:?-{2,}:?$/.test(cell.replace(/\s/g, "")) || cell === "");
}

function outsideFences(markdown: string): string {
  const out: string[] = [];
  let inFence = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) out.push(line);
  }
  return out.join("\n");
}

const PLATFORM_KEYWORDS: ReadonlyArray<{ pattern: RegExp; device: MoonvizDevice }> = [
  // "Web App"/"桌面 App"/"网页 App" 是 desktop 的复合词——必须先于 mobile 行的
  // 裸 app\b 匹配(token 不按空白分词,"Web App" 是单 token,否则被 app\b 捞成
  // mobile,Web 产品被硬造成手机程序)。
  { pattern: /desktop[- ]?app|桌面应用|桌面端\s*app|桌面\s*app|web\s*app|网页\s*app/i, device: "desktop" },
  { pattern: /mini[- ]?program|小程序/i, device: "mobile" },
  { pattern: /tablet|平板/i, device: "tablet" },
  { pattern: /mobile|移动端|手机|app\b/i, device: "mobile" },
  { pattern: /web|网页|浏览器|pc\b|desktop|桌面/i, device: "desktop" },
];

/** Parse the PRD's 目标平台 declaration into a device set (null = undeclared). */
export function extractTargetPlatforms(spec: string): MoonvizDevice[] | null {
  const lines = outsideFences(spec).split(/\r?\n/);
  const row = lines.find((line) => {
    if (!line.includes("|")) return false;
    const cells = splitTableRow(line);
    return cells.length >= 2 && /^(目标平台|目标端|适用平台|平台)$/.test(cells[0]);
  });
  if (!row) return null;
  const declared = splitTableRow(row).slice(1).join(" ");
  const parenPayloads = [...declared.matchAll(/[（(]([^）)]+)[）)]/g)].map((m) => m[1]);
  const comboPayload = parenPayloads.find((payload) => PLATFORM_KEYWORDS.some(({ pattern }) => pattern.test(payload)));
  const source = comboPayload ?? declared;
  const devices = new Set<MoonvizDevice>();
  // 只按标点分隔(+、/、，、；、和),不按空白分词——"桌面端 App" 是一个不可拆
  // 的复合词,按空白拆会分别命中 desktop 与 mobile(幽灵端)。
  const tokens = source.split(/[+,/，、；;]|和/);
  for (const token of tokens) {
    const cleaned = token.trim();
    if (!cleaned) continue;
    for (const { pattern, device } of PLATFORM_KEYWORDS) {
      if (pattern.test(cleaned)) {
        devices.add(device);
        break;
      }
    }
  }
  if (devices.size === 0 && /多端|全平台|三端|跨端/.test(declared)) {
    return ["desktop", "mobile", "tablet"];
  }
  return devices.size > 0 ? [...devices] : null;
}

export interface SpecPage {
  readonly name: string;
  readonly id?: string;
}

export interface SpecPageList {
  readonly pages: SpecPage[];
  readonly hasIds: boolean;
}

const ID_INLINE = /[（(]\s*([a-z][a-z0-9-_]*)\s*[）)]/;
const ID_COLUMN = /^[a-z][a-z0-9-_]*$/;
const PAGE_LIST_HEADER = /^(页面(名称|名|清单)?|屏幕|名称|name|screen|page(\s+name)?)$/i;

/** Parse the standardized 页面清单 section (GFM table, 页面 ID column aware). */
export function parsePageList(spec: string): SpecPageList | null {
  const lines = outsideFences(spec).split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => /^#{1,6}\s*/.test(line) && /页面清单|page\s+list|pages\b/i.test(line));
  if (headingIndex === -1) return null;
  const pages: SpecPage[] = [];
  let headerSkipped = false;
  for (let index = headingIndex + 1; index < lines.length; index++) {
    const line = lines[index].trim();
    if (/^#{1,6}\s*/.test(line)) break;
    if (!line.includes("|")) continue;
    const cells = splitTableRow(line);
    if (cells.length < 2 || isTableSeparator(cells)) continue;
    const cleaned = cells.map((cell) => cell.replace(/[`*]/g, "").trim());
    const name = cleaned[0];
    if (!name) continue;
    if (!headerSkipped) {
      headerSkipped = true;
      if (PAGE_LIST_HEADER.test(name) || /^(目的|purpose|关键元素|页面\s*id|page\s*id)$/i.test(cleaned[1] ?? "")) {
        continue;
      }
    }
    let id: string | undefined;
    const inline = name.match(ID_INLINE);
    if (inline) {
      id = inline[1];
    } else {
      const idCell = cleaned.slice(1).find((cell) => ID_COLUMN.test(cell));
      if (idCell) id = idCell;
    }
    pages.push({ name: name.replace(ID_INLINE, "").trim() || name, ...(id ? { id } : {}) });
  }
  return { pages, hasIds: pages.length > 0 && pages.every((page) => Boolean(page.id)) };
}

/** A structured spec must carry at least one markdown section heading. */
export function looksLikeSpecDocument(markdown: string): boolean {
  return /^#{1,6}\s+\S/m.test(markdown);
}

/** A 页面清单 heading must exist for coverage mapping to be possible. */
export function hasPageList(spec: string): boolean {
  return /(?:^|\n)#{1,6}\s*(?:\d+[.)、]?\s*)?(?:页面清单(?![A-Za-z0-9_])|page\s+list\b|pages\b)/im.test(spec);
}

// ── coverage: PRD ↔ document artboards/flows ─────────────────────────────────

export interface MoonvizArtboardSummary {
  id: string;
  name?: string;
  width?: number;
  height?: number;
}

export interface MoonvizFlowSummary {
  from?: string;
  to?: string;
  node?: string;
  [key: string]: unknown;
}

export interface MoonvizCoverageFinding {
  /** failed = the contract is violated (must fix); pending = observation for
   *  human confirmation (mirrors the verify check semantics). */
  severity: "failed" | "pending";
  id: string;
  label: string;
  observation: string;
}

/**
 * PRD↔document coverage (replaces the $page/@Set regex checks): with page
 * IDs present, every PRD page must have a same-id artboard, and every
 * artboard must trace back to the PRD; with ≥2 pages the document must wire
 * at least one flow. Legacy PRDs (no IDs) degrade to a count comparison.
 */
export function moonvizCoverageFindings(
  spec: string,
  artboards: MoonvizArtboardSummary[],
  flows: MoonvizFlowSummary[]
): MoonvizCoverageFinding[] {
  const findings: MoonvizCoverageFinding[] = [];
  const pageList = parsePageList(spec);
  const artboardIds = new Set(artboards.map((artboard) => parseMoonvizArtboardId(artboard.id).pageId));
  if (pageList && pageList.hasIds) {
    const prdIds = new Set(pageList.pages.map((page) => page.id!).filter(Boolean));
    const seenIds = new Set<string>();
    for (const page of pageList.pages) {
      if (!page.id || seenIds.has(page.id)) continue; // 重复行只报一次（check id 空间唯一）
      seenIds.add(page.id);
      if (!artboardIds.has(page.id)) {
        findings.push({
          severity: "failed",
          id: `auto:coverage-${page.id}-missing`,
          label: `PRD page "${page.name}" (${page.id}) is implemented as an artboard`,
          observation: `页面清单中的「${page.name}」没有对应画板（artboard id=${page.id}）——原型未覆盖 PRD。`,
        });
      }
    }
    for (const id of artboardIds) {
      if (!prdIds.has(id)) {
        findings.push({
          severity: "pending",
          id: `auto:coverage-${id}-extra`,
          label: `Document artboard "${id}" exists in the PRD page list`,
          observation: `画板 "${id}" 不在页面清单中——确认是否为有意补充(如详情子页)。`,
        });
      }
    }
    if (prdIds.size >= 2 && flows.length === 0) {
      findings.push({
        severity: "failed",
        id: "auto:flows-empty",
        label: "Multi-page document wires at least one navigation flow",
        observation: "多页文档没有任何 flow 导航线——页面之间不可达，为每条跳转补 `flow <from-ab> <to-ab> <node-id>`。",
      });
    }
  } else if (pageList) {
    const prdCount = pageList.pages.length;
    if (prdCount !== artboardIds.size) {
      findings.push({
        severity: "pending",
        id: "auto:coverage-count",
        label: "Document artboard count matches the PRD page list",
        observation: `PRD 列出 ${prdCount} 页,文档 ${artboardIds.size} 画板(旧格式 PRD 无页面 ID 列,仅数量比对)——重新生成需求文档可启用逐页比对。`,
      });
    }
  }
  return findings;
}

// ── op plan parsing ──────────────────────────────────────────────────────────

/** Engine op verbs (core/ops.mbt dispatch) — parseOpPlan only accepts lines
 *  whose first token is one of these, so prose lines never masquerade as ops. */
const OP_VERBS = new Set([
  "adaptive",
  "align",
  "copy",
  "create",
  "delete",
  "delete-artboard",
  "duplicate",
  "fill",
  "fix",
  "flip",
  "flow",
  "group",
  "interact",
  "keep",
  "move",
  "place",
  "radius",
  "reorder",
  "resize-canvas",
  "responsive",
  "restyle",
  "set-state",
  "state",
  "stroke",
  "template",
  "text",
  "theme",
  "token",
  "unflow",
  "ungroup",
  "uninteract",
  "update",
  "width-fill",
]);

/** Extract the op plan from subagent output: the LAST code fence wins (the
 *  model may narrate before it); one op per line; blank lines, ``` fences,
 *  markdown headings, `//` comments and any line whose first token is not an
 *  engine op verb are skipped. A `delete-artboard __seed` line is tolerated
 *  anywhere (materialize seeds from MOONVIZ_SEED_DOC). */
export function parseOpPlan(output: unknown): string[] | null {
  const content =
    typeof (output as { content?: unknown })?.content === "string"
      ? (output as { content: string }).content
      : typeof output === "string"
        ? output
        : null;
  if (!content) return null;
  // Truncation guard: an unclosed fence means the output was cut off
  // mid-plan — refuse instead of mining prose for accidental op lines.
  const fenceMarkers = [...content.matchAll(/^[ \t]*```/gm)].length;
  if (fenceMarkers % 2 !== 0) return null;
  const fences = [...content.matchAll(/^[ \t]*```[^\n]*\n([\s\S]*?)^[ \t]*```[ \t]*$/gm)];
  const body = fences.length > 0 ? fences[fences.length - 1][1] : content;
  const ops: string[] = [];
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("```") || line.startsWith("#") || line.startsWith("//")) continue;
    const verb = line.split(/\s+/)[0];
    if (!OP_VERBS.has(verb)) continue;
    ops.push(line);
  }
  return ops.length > 0 ? ops : null;
}

/** Deterministic artboard count of a canonical document — DISTINCT PAGE count
 *  (the comment marker is the per-artboard unit; `<page>@<device>` suffixed
 *  ids of multi-device documents collapse to their pageId, matching the
 *  leafer canvas-depth gate's "one Frame per page" contract). */
export function moonvizArtboardCount(doc: string): number {
  const pageIds = new Set<string>();
  for (const match of doc.matchAll(/<!--\s*moonviz:artboard\s+([\w@-]+)\s*-->/g)) {
    pageIds.add(parseMoonvizArtboardId(match[1]).pageId);
  }
  return pageIds.size;
}
