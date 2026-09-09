/**
 * openui-pages — the PRD↔program mapping core of prototype-reliability WP0/WP2.
 *
 * Spec-writer's PRD is the single source of truth for WHAT to build; until
 * now nothing mechanized that contract — verify only matched a「页面清单」
 * heading. This module provides the deterministic parsers both verify and
 * materialize consume:
 *
 *  - `extractTargetPlatforms(spec)` — WP0: the PRD's 目标平台 declaration
 *    decides which devices materialize generates (mobile-only products never
 *    pay for a desktop generation).
 *  - `parsePageList(spec)` — WP0.1/WP2.2: the standardized 页面清单 table with
 *    the new 页面 ID column (`订单列表(orders)` or a dedicated id column),
 *    giving verify a page-name↔`$page`-value mapping instead of a count.
 *  - `extractProgramPages(code)` — WP2.2: the OpenUI Lang side — every page
 *    the program declares/compares/navigates to, for closure + coverage
 *    checks (Axure-style interaction-wire and page-tree mechanics).
 *  - `componentUsage/componentJaccard` — WP4.2: structural distance between
 *    platform variants (component-mix histogram; a rename keeps the mix, a
 *    real platform shell swaps it), replacing byte equality.
 *
 * Pure string parsing, no fs/no deps — mirrored by unit tests.
 */

import type { OpenuiDevice } from "../actions/openui-contract";

// ── shared GFM helpers ───────────────────────────────────────────────────────

/** Split a GFM table row into trimmed cells (`| a | b |` → ["a", "b"]). */
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

/** Strip code fences so fenced `##`/table rows never leak into section scans. */
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

// ── target platforms (WP0.2) ─────────────────────────────────────────────────

const PLATFORM_KEYWORDS: ReadonlyArray<{ pattern: RegExp; device: OpenuiDevice }> = [
  { pattern: /desktop[- ]?app|桌面应用|桌面端\s*app/i, device: "desktop" },
  { pattern: /mini[- ]?program|小程序/i, device: "mobile" },
  { pattern: /tablet|平板/i, device: "tablet" },
  { pattern: /mobile|移动端|手机|app\b/i, device: "mobile" },
  { pattern: /web|网页|浏览器|pc\b|desktop|桌面/i, device: "desktop" },
];

/**
 * Parse the PRD's 目标平台 declaration into a device set. Accepts single
 * values (`移动端 App`), combos (`多端(web+mobile)` / `web + mobile`), and the
 * plain platform names. Returns null when the spec declares no platform —
 * the caller then defaults to desktop-only plus a「平台未声明」observation.
 *
 * Order matters: desktop-app before desktop (the longer keyword wins), and
 * the explicit 多端(...) combo syntax is split on separators first.
 */
export function extractTargetPlatforms(spec: string): OpenuiDevice[] | null {
  const lines = outsideFences(spec).split(/\r?\n/);
  const row = lines.find((line) => {
    if (!line.includes("|")) return false;
    const cells = splitTableRow(line);
    return cells.length >= 2 && /^(目标平台|目标端|适用平台|平台)$/.test(cells[0]);
  });
  if (!row) return null;
  const declared = splitTableRow(row).slice(1).join(" ");
  // 多端(web+mobile) 的括号负载才是设备列表;但 (iOS/Android) 这类发布注不是
  // ——只有负载里出现平台关键词时才采用负载,否则按整段解析。
  const parenPayloads = [...declared.matchAll(/[（(]([^）)]+)[）)]/g)].map((m) => m[1]);
  const comboPayload = parenPayloads.find((payload) => PLATFORM_KEYWORDS.some(({ pattern }) => pattern.test(payload)));
  const source = comboPayload ?? declared;
  const devices = new Set<OpenuiDevice>();
  // 交叉审查修正:只按标点分隔(+、/、，、；、和),不按空白分词——"桌面端 App"
  // 是一个不可拆的复合词,按空白拆成 ["桌面端","App"] 会分别命中 desktop 与
  // mobile(幽灵端);每段整体模式匹配,PLATFORM_KEYWORDS 已按特异性排序。
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
  // 无组合括号且整段只写了「多端」这类总称时,按声明三端处理。
  if (devices.size === 0 && /多端|全平台|三端|跨端/.test(declared)) {
    return ["desktop", "mobile", "tablet"];
  }
  return devices.size > 0 ? [...devices] : null;
}

// ── page list with IDs (WP0.1/WP2.2) ─────────────────────────────────────────

export interface SpecPage {
  /** Display name (first column, bold/backticks stripped). */
  readonly name: string;
  /** English kebab/camel id — the program's `$page` value. Parsed from the
   *  页面 ID column or the inline `名称(id)` convention; absent on legacy
   *  PRDs (coverage then degrades to a count comparison). */
  readonly id?: string;
}

export interface SpecPageList {
  readonly pages: SpecPage[];
  /** True when every row carries a usable id (enables per-page matching). */
  readonly hasIds: boolean;
}

const ID_INLINE = /[（(]\s*([a-z][a-z0-9-_]*)\s*[）)]/i;
const ID_COLUMN = /^[a-z][a-z0-9-_]*$/i;
const PAGE_LIST_HEADER = /^(页面(名称|名|清单)?|屏幕|名称|name|screen|page(\s+name)?)$/i;

/**
 * Parse the standardized 页面清单 section (GFM table). Ported from desktop's
 * prototype-brief extractPageListScreens with two upgrades: code-fence
 * transparency and the 页面 ID mapping (inline `订单列表(orders)` or a
 * dedicated ID column). Returns null when the spec has no 页面清单 section.
 */
export function parsePageList(spec: string): SpecPageList | null {
  const lines = outsideFences(spec).split(/\r?\n/);
  // \s* 零空格容忍:`##页面清单` 与 verify 的 hasPageList 同规(评审 F)。
  const headingIndex = lines.findIndex((line) => /^#{1,6}\s*/.test(line) && /页面清单|page\s+list|pages\b/i.test(line));
  if (headingIndex === -1) return null;
  const pages: SpecPage[] = [];
  let headerSkipped = false;
  for (let index = headingIndex + 1; index < lines.length; index++) {
    const line = lines[index].trim();
    if (/^#{1,6}\s*/.test(line)) break; // 页面清单节结束
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
    // ID 优先级:行内 名称(id) > 独立 id 列(首列后第一个纯英文列)。
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

// ── program-side page extraction (WP2.2) ─────────────────────────────────────

export interface ProgramPages {
  /** `$page = "x"` initial value (null when undeclared — auto-null default). */
  readonly initial: string | null;
  /** Every value compared via `$page == "x"` (ternary view switching). */
  readonly comparisons: ReadonlySet<string>;
  /** Every target of `@Set($page, "x")` — the interaction wires. */
  readonly navTargets: ReadonlySet<string>;
}

/**
 * Extract the page set from an OpenUI Lang program. The CREATE contract
 * mandates one ternary per page (`$page == "orders" ? ordersView : …`), so
 * `comparisons` is the program's declared page set; a page reachable only as
 * the final fallback colon never appears — exactly the case ID coverage
 * should flag, because the contract requires the explicit comparison.
 */
export function extractProgramPages(code: string): ProgramPages {
  const initialMatch = code.match(/^\s*\$page\s*=\s*"([^"]+)"/m);
  const comparisons = new Set<string>();
  for (const match of code.matchAll(/\$page\s*==\s*"([^"]+)"/g)) comparisons.add(match[1]);
  const navTargets = new Set<string>();
  for (const match of code.matchAll(/@Set\(\s*\$page\s*,\s*"([^"]+)"/g)) navTargets.add(match[1]);
  return {
    initial: initialMatch ? initialMatch[1] : null,
    comparisons,
    navTargets,
  };
}

// ── structural distance (WP4.2) ──────────────────────────────────────────────

/**
 * Component-usage histogram — the structural fingerprint for variant
 * distinctness. Statement NAMES can't separate the two cases we care about
 * (a renamed copy of the desktop program vs a genuinely different mobile
 * shell — both drift the name set); the COMPONENT MIX does: a rename keeps
 * the exact same Stack/Card/Table histogram, while a real platform variant
 * swaps the navigation shell and layout grammar (tab bar vs sidebar, card
 * list vs table), moving the histogram.
 */
export function componentUsage(code: string): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const match of code.matchAll(/\b([A-Z][A-Za-z0-9_]*)\s*\(/g)) {
    counts.set(match[1], (counts.get(match[1]) ?? 0) + 1);
  }
  return counts;
}

/** Weighted Jaccard over component-usage histograms (1 = identical mix). */
export function componentJaccard(a: string, b: string): number {
  const histA = componentUsage(a);
  const histB = componentUsage(b);
  if (histA.size === 0 && histB.size === 0) return 1;
  let sumA = 0;
  let sumB = 0;
  for (const count of histA.values()) sumA += count;
  for (const count of histB.values()) sumB += count;
  let intersection = 0;
  for (const [name, count] of histA) {
    intersection += Math.min(count, histB.get(name) ?? 0);
  }
  const union = sumA + sumB - intersection;
  return union === 0 ? 1 : intersection / union;
}
