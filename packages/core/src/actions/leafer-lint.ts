/**
 * Deterministic static rules over a Leafer scene-tree JSON document
 * (specs/leafer-ui-engine WP2.1) — the leafer counterpart of design.ts's
 * lintOpenuiDocument. No browser, no LLM: the same four-finding budget the
 * OpenUI lint keeps, mapped onto scene-tree shapes. EARS 9 pins the rule set:
 * out-of-bounds primitives, empty text nodes, colors outside the design
 * system tokens, and duplicate sibling geometry.
 */

import { LEAFER_CANVAS_PRESETS } from "./leafer-contract";

export interface LeaferLintFinding {
  id: string;
  preset: string;
  ruleId: string;
  severity: "info" | "warning" | "error";
  nodePath: string;
  message: string;
  suggestion?: string;
}

interface LintNode {
  tag?: unknown;
  x?: unknown;
  y?: unknown;
  width?: unknown;
  height?: unknown;
  text?: unknown;
  fill?: unknown;
  stroke?: unknown;
  children?: unknown;
}

const MAX_TREE_DEPTH = 32;
/** Two same-size same-position siblings hide one another — flag exact
 *  duplicates only (threshold-free, deterministic). */
const DUPLICATE_OVERLAP_RATIO = 1;

const isNum = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** Extract literal `#rrggbb`-ish hex colors from a fill/stroke value (solid
 *  strings and gradient stop objects). */
function hexColorsOf(value: unknown, into: string[]): void {
  if (typeof value === "string") {
    const match = value.match(/#[0-9a-fA-F]{3,8}/g);
    if (match) into.push(...match.map((color) => color.toLowerCase()));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) hexColorsOf(item, into);
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const item of Object.values(value as Record<string, unknown>)) hexColorsOf(item, into);
  }
}

/** Deterministic static rules over a stored leafer document. `tokens` is the
 *  suite's design-token record — when it carries usable values, hex colors
 *  outside its palette are reported; without tokens the rule is skipped. */
export function lintLeaferDocument(leaferJson: string, tokens?: unknown): LeaferLintFinding[] {
  const findings: LeaferLintFinding[] = [];
  const push = (
    ruleId: string,
    severity: LeaferLintFinding["severity"],
    message: string,
    nodePath: string,
    suggestion?: string
  ): void => {
    findings.push({
      id: `${ruleId}-${findings.length + 1}`,
      preset: "leafer-static",
      ruleId,
      severity,
      nodePath,
      message,
      ...(suggestion ? { suggestion } : {}),
    });
  };

  let root: LintNode;
  try {
    root = JSON.parse(leaferJson) as LintNode;
  } catch {
    return [
      {
        id: "json-parse-1",
        preset: "leafer-static",
        ruleId: "json-parse",
        severity: "error",
        nodePath: "document",
        message: "stored leafer content is not valid JSON",
      },
    ];
  }
  if (typeof root !== "object" || root === null) {
    return [
      {
        id: "root-shape-1",
        preset: "leafer-static",
        ruleId: "root-shape",
        severity: "error",
        nodePath: "document",
        message: "stored leafer content is not a JSON object",
      },
    ];
  }

  // Canvas size: the stored contract root; fall back to the desktop preset.
  const canvasWidth = isNum(root.width) && root.width > 0 ? root.width : LEAFER_CANVAS_PRESETS.desktop.width;
  const canvasHeight = isNum(root.height) && root.height > 0 ? root.height : LEAFER_CANVAS_PRESETS.desktop.height;

  // Token palette (when the suite carries tokens): every hex literal found in
  // the token record is an allowed color.
  const allowedColors = new Set<string>();
  if (tokens && typeof tokens === "object") {
    const tokenColors: string[] = [];
    hexColorsOf(tokens, tokenColors);
    for (const color of tokenColors) allowedColors.add(color);
  }

  const walk = (node: unknown, path: string, depth: number): void => {
    if (depth > MAX_TREE_DEPTH || typeof node !== "object" || node === null) return;
    const record = node as LintNode;

    if (record.tag === "Text") {
      if (typeof record.text !== "string" || !record.text.trim()) {
        push(
          "empty-text",
          "warning",
          "Text node carries no copy.",
          path,
          "Give it real product copy, or remove the node."
        );
      } else {
        const emoji = record.text.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
        if (emoji) push("emoji-glyph", "info", `emoji glyph "${emoji[0]}" in UI copy; prefer icon assets.`, path);
      }
    }

    const { x, y, width, height } = record;
    if (isNum(x) && isNum(y) && isNum(width) && isNum(height)) {
      if (x + width <= 0 || y + height <= 0 || x >= canvasWidth || y >= canvasHeight) {
        push(
          "out-of-bounds",
          "error",
          `element at x:${x} y:${y} ${width}×${height} lies fully outside the ${canvasWidth}×${canvasHeight} canvas.`,
          path,
          "Move it inside the root canvas or delete it."
        );
      }
    }

    if (allowedColors.size > 0) {
      const used: string[] = [];
      hexColorsOf(record.fill, used);
      hexColorsOf(record.stroke, used);
      for (const color of used) {
        if (!allowedColors.has(color)) {
          push(
            "unlisted-color",
            "info",
            `color ${color} is not part of the suite's design tokens.`,
            path,
            "Swap it for a token palette color, or add the token deliberately."
          );
          break; // one report per node
        }
      }
    }

    if (Array.isArray(record.children)) walkChildren(record.children, path, depth);
  };

  /** Duplicate geometry is judged per parent among siblings; every child is
   *  then walked recursively. */
  const walkChildren = (children: unknown[], parentPath: string, depth: number): void => {
    const seen = new Set<string>();
    children.forEach((child, index) => {
      const childPath = `${parentPath}.children[${index}]`;
      if (typeof child === "object" && child !== null) {
        const kid = child as LintNode;
        if (isNum(kid.x) && isNum(kid.y) && isNum(kid.width) && isNum(kid.height)) {
          const key = `${String(kid.tag)}@${kid.x},${kid.y},${kid.width},${kid.height}`;
          if (seen.has(key)) {
            push(
              "duplicate-geometry",
              "warning",
              `duplicate ${String(kid.tag)} at x:${kid.x} y:${kid.y} ${kid.width}×${kid.height} hides the identical sibling (overlap ratio ≥ ${DUPLICATE_OVERLAP_RATIO}).`,
              childPath,
              "Remove one of the stacked elements."
            );
          }
          seen.add(key);
        }
      }
      walk(child, childPath, depth + 1);
    });
  };

  if (Array.isArray(root.children)) walkChildren(root.children, "document", 0);
  return findings;
}
