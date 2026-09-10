/**
 * Leafer JSON scene contract — the UI-Design generation protocol for the
 * leafer-ui-engine spec (specs/leafer-ui-engine). The deep-design subagent
 * returns ONE Leafer scene-tree JSON document; this module is the single
 * source for the contract sentences (the leafer counterpart of
 * openui-contract.ts) plus the deterministic structural validator that the
 * repair loop and the desktop persistence boundary both feed on.
 *
 * Shape verified against leafer-editor@2.2.10 (2026-09-10 pre-research):
 * `leafer.set({ tag, width, height, fill, children })` applies the whole
 * document in one call, `toJSON()` round-trips losslessly (byte-identical
 * re-render), and the app canvas size is NOT part of toJSON — so the stored
 * `content.leafer` document carries explicit `width`/`height` root fields.
 */

/** Root-canvas presets for the three mockup sizes (mirrors OPENUI devices). */
export interface LeaferCanvasSize {
  width: number;
  height: number;
}

export const LEAFER_CANVAS_PRESETS: Record<"desktop" | "mobile" | "tablet", LeaferCanvasSize> = {
  desktop: { width: 1440, height: 1024 },
  mobile: { width: 375, height: 812 },
  tablet: { width: 834, height: 1112 },
};

/** Every `tag` allowed inside a generated scene tree (leafer-editor@2.2.10). */
export const LEAFER_PRIMITIVES = ["Rect", "Ellipse", "Text", "Image", "Path", "Line", "Group", "Box", "Frame"] as const;

export type LeaferPrimitive = (typeof LEAFER_PRIMITIVES)[number];

/** For revisions: what the model must keep from the existing scene document. */
export const LEAFER_PRESERVE_CONTRACT =
  "Preserve the root canvas size/fill and every element not named by the revision instruction — " +
  "the result must stay ONE complete scene document, never a fragment or a description of the change.";

/** For creation: the single-JSON-document requirement with concrete syntax.
 *  M3E-canvas anti-collapse principles internalized (specs/artifact-landing
 *  design.md 附录 D): 受控词汇 (#1, primitives whitelist) · 命名指代 (#5,
 *  stable names) · 负向禁令 (#3, explicit bans) · 落地守则 (#9, token colors /
 *  real copy) · 完成定义 (#10, self-check line). */
export const LEAFER_CREATE_CONTRACT =
  "It must be ONE Leafer scene-tree JSON document in a single json code fence: root object " +
  '`{"tag": "Leafer", "width": <canvas-width>, "height": <canvas-height>, "fill": "<background>", "children": [...]}`. ' +
  `Allowed tags ONLY: ${LEAFER_PRIMITIVES.join(", ")}. ` +
  'Every direct child of the root and every Frame carries a stable "name" (e.g. "hero", "nav-bar") — revisions address elements by these names. ' +
  "Position elements with absolute x/y plus width/height (exception: Text may auto-size); compose rows/columns with " +
  '`flow: "x" | "y"`, `gap`, `padding` and `flowAlign` on Group/Box/Frame containers. Style with fill/stroke/' +
  'cornerRadius/shadow/opacity (solid "#rrggbb" or gradient `{type: "linear" | "radial", stops: [{offset, color}, ...]}`). ' +
  "Every Text node carries real product copy in the document's language — never placeholders, lorem ipsum, or empty strings. " +
  "All geometry stays inside the root canvas (desktop mockups 1440×1024, mobile 375×812, tablet 834×1112). " +
  "NEVER stack identical duplicates on top of each other, NEVER place elements outside the canvas, NEVER invent colors outside the design system palette. " +
  "Use ONLY the colors/typography of the given design system. " +
  "No comments, no trailing commas, strictly valid JSON. " +
  "Before returning, self-check: every element inside the canvas, every Text filled, sibling names unique.";

// ── Deterministic structural validation (the repair loop's verdict source) ──

export interface LeaferIssue {
  code: string;
  path: string;
  message: string;
}

export interface LeaferVerdict {
  valid: boolean;
  issues: LeaferIssue[];
}

interface WalkNode {
  tag: unknown;
  children?: unknown;
  x?: unknown;
  y?: unknown;
  width?: unknown;
  height?: unknown;
  text?: unknown;
}

const MAX_TREE_DEPTH = 32;
const MAX_COORDINATE = 8192;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Parse a generated text into a JSON value, tolerating one json fence around
 *  it (line-anchored like the prototype-side extractors: prose merely
 *  mentioning ``` must not open the capture). */
export function parseLeaferDocument(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const fenced = text.match(/^[ \t]*```(?:json)?[ \t]*\n([\s\S]*?)```/im)?.[1] ?? text;
  try {
    return { ok: true, value: JSON.parse(fenced.trim()) as unknown };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Cheap pre-parse sanity (the counterpart of looksLikeOpenuiProgram): the
 *  text must parse as a JSON object declaring a children array — catches
 *  truncated or prose-contaminated output before the repair loop runs. */
export function looksLikeLeaferDocument(text: string): boolean {
  const parsed = parseLeaferDocument(text);
  if (!parsed.ok) return false;
  const value = parsed.value as WalkNode | null;
  return typeof value === "object" && value !== null && Array.isArray(value.children);
}

function walk(value: unknown, path: string, depth: number, issues: LeaferIssue[]): void {
  if (depth > MAX_TREE_DEPTH) {
    issues.push({ code: "max-depth", path, message: `scene tree nesting exceeds ${MAX_TREE_DEPTH} levels` });
    return;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    issues.push({ code: "bad-node", path, message: "every scene node must be a JSON object" });
    return;
  }
  const node = value as WalkNode;
  if (node.tag !== undefined && !LEAFER_PRIMITIVES.includes(node.tag as LeaferPrimitive)) {
    issues.push({
      code: "unknown-tag",
      path,
      message: `tag '${String(node.tag)}' is not in the allowed set (${LEAFER_PRIMITIVES.join(", ")})`,
    });
  }
  for (const axis of ["x", "y", "width", "height"] as const) {
    const coordinate = node[axis];
    if (coordinate !== undefined && !isFiniteNumber(coordinate)) {
      issues.push({
        code: "bad-number",
        path,
        message: `${axis} must be a finite number, got ${JSON.stringify(coordinate)}`,
      });
    }
  }
  if (node.text !== undefined && typeof node.text !== "string") {
    issues.push({ code: "bad-text", path, message: "Text content must be a string" });
  }
  if (Array.isArray(node.children)) {
    node.children.forEach((child, index) => walk(child, `${path}.children[${index}]`, depth + 1, issues));
  } else if (node.children !== undefined) {
    issues.push({ code: "bad-children", path, message: "children must be an array when present" });
  }
}

/** Full structural verdict over a parsed document: root shape, canvas bounds
 *  and a recursive per-node legality walk. Deterministic — this is the
 *  repair loop's only verdict source (no external parser exists). */
export function validateLeaferDocument(value: unknown): LeaferVerdict {
  const issues: LeaferIssue[] = [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {
      valid: false,
      issues: [{ code: "root-shape", path: "document", message: "the document must be a JSON object" }],
    };
  }
  const root = value as WalkNode;
  if (root.tag !== "Leafer") {
    issues.push({
      code: "root-shape",
      path: "document",
      message: `root.tag must be "Leafer", got ${JSON.stringify(root.tag ?? null)}`,
    });
  }
  for (const axis of ["width", "height"] as const) {
    const size = root[axis];
    if (!isFiniteNumber(size) || size < 1 || size > MAX_COORDINATE) {
      issues.push({
        code: "root-canvas",
        path: "document",
        message: `root.${axis} must be a finite number in 1..${MAX_COORDINATE} (the app canvas size is not part of toJSON — declare it explicitly)`,
      });
    }
  }
  if (!Array.isArray(root.children)) {
    issues.push({
      code: "root-children",
      path: "document",
      message: "root.children must be an array (possibly empty)",
    });
  } else {
    root.children.forEach((child, index) => walk(child, `children[${index}]`, 1, issues));
  }
  // Out-of-bounds: a node whose full geometry lies OUTSIDE the root canvas is
  // almost surely a coordinate bug (partial overflow is legitimate — Frame
  // clips). Only checked when both the canvas and the node geometry are sane.
  const canvasWidth = root.width;
  const canvasHeight = root.height;
  if (isFiniteNumber(canvasWidth) && isFiniteNumber(canvasHeight)) {
    const collectOutOfBounds = (node: unknown, path: string, depth: number): void => {
      if (depth > MAX_TREE_DEPTH || typeof node !== "object" || node === null) return;
      const record = node as WalkNode;
      const { x, y, width, height } = record;
      if (isFiniteNumber(x) && isFiniteNumber(y) && isFiniteNumber(width) && isFiniteNumber(height)) {
        if (x + width <= 0 || y + height <= 0 || x >= canvasWidth || y >= canvasHeight) {
          issues.push({
            code: "out-of-bounds",
            path,
            message: `element at x:${x} y:${y} ${width}×${height} lies fully outside the ${canvasWidth}×${canvasHeight} canvas`,
          });
        }
      }
      if (Array.isArray(record.children)) {
        record.children.forEach((child, index) => collectOutOfBounds(child, `${path}.children[${index}]`, depth + 1));
      }
    };
    if (Array.isArray(root.children)) {
      root.children.forEach((child, index) => collectOutOfBounds(child, `children[${index}]`, 1));
    }
  }
  return { valid: issues.length === 0, issues };
}

/** Structured findings → one patch instruction per line (same shape as
 *  formatOpenuiFeedback, so the repair prompt stays uniform). */
export function formatLeaferFeedback(verdict: LeaferVerdict): string {
  return verdict.issues.map((issue) => `- ${issue.code} at ${issue.path}: ${issue.message}`).join("\n");
}

/** Issue count across every finding — drives the repair budget. */
export function leaferIssueCount(verdict: LeaferVerdict): number {
  return verdict.issues.length;
}
