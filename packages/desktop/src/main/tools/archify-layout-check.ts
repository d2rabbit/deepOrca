/**
 * Archify layout-contract checker (specs/arch-visual-readback 门①) — the
 * CHEAPEST of the three verification gates: consumes the renderer's own
 * `--layout-json` report (node geometry, no rendering, no vision) and flags
 * machine-checkable geometric defects.
 *
 * Absorbed from fireworks-tech-graph's "deterministic checks first"
 * philosophy (design philosophy only — no upstream code): cheap exact checks
 * run before containment screenshots and perceptual vision readback. The
 * vendored renderer stays untouched; this module only READS its output.
 *
 * Checks (v1):
 *   - component-overlap: two component boxes intersecting beyond a 1px
 *     tolerance (boundaries legitimately contain their children, so
 *     boundary↔component containment is NOT an overlap);
 *   - out-of-canvas: a component box extending beyond the SVG viewBox.
 */

/** Structural slice of the renderer's --layout-json report (defensive read). */
export interface LayoutReport {
  ok?: boolean;
  diagram_type?: string;
  viewBox?: [number, number] | number[];
  components?: Array<{ id?: string; label?: string; x?: number; y?: number; width?: number; height?: number }>;
  boundaries?: Array<{ id?: string; label?: string; x?: number; y?: number; width?: number; height?: number }>;
}

export interface LayoutViolation {
  readonly kind: "component-overlap" | "out-of-canvas";
  /** The offending node ids (pair for overlaps, single for out-of-canvas). */
  readonly nodes: readonly string[];
  readonly detail: string;
}

export interface LayoutCheckResult {
  /** true when the diagram type has no layout-json support (honest skip). */
  readonly skipped?: boolean;
  readonly skipReason?: string;
  readonly violations: readonly LayoutViolation[];
}

type Box = { id: string; x: number; y: number; width: number; height: number };

function toBoxes(items: Array<Record<string, unknown>> | undefined): Box[] {
  if (!Array.isArray(items)) return [];
  const boxes: Box[] = [];
  for (const item of items) {
    const id = typeof item.id === "string" && item.id ? item.id : typeof item.label === "string" ? item.label : "?";
    const x = Number(item.x);
    const y = Number(item.y);
    const width = Number(item.width);
    const height = Number(item.height);
    if (![x, y, width, height].every((n) => Number.isFinite(n))) continue;
    boxes.push({ id, x, y, width, height });
  }
  return boxes;
}

/** Intersection area beyond `tolerance` px² counts as an overlap. */
function overlapArea(a: Box, b: Box): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

const OVERLAP_TOLERANCE_PX = 1;

/**
 * Pure checker over a parsed layout report. Boundaries are excluded from the
 * overlap check against their contents by design (a boundary is a container);
 * they still participate as nodes in the out-of-canvas check.
 */
export function checkLayoutContract(report: unknown): LayoutCheckResult {
  if (!report || typeof report !== "object") {
    return { violations: [], skipped: true, skipReason: "layout report unreadable" };
  }
  const typed = report as LayoutReport;
  if (typed.ok === false) {
    return { violations: [], skipped: true, skipReason: "renderer reported an invalid layout" };
  }
  const components = toBoxes(typed.components as Array<Record<string, unknown>> | undefined);
  const boundaries = toBoxes(typed.boundaries as Array<Record<string, unknown>> | undefined);
  if (components.length === 0) {
    return { violations: [], skipped: true, skipReason: "no component geometry in the report" };
  }

  const violations: LayoutViolation[] = [];

  // Component↔component overlaps (the renderer's free mode can collide).
  for (let i = 0; i < components.length; i += 1) {
    for (let j = i + 1; j < components.length; j += 1) {
      const a = components[i]!;
      const b = components[j]!;
      const area = overlapArea(a, b);
      if (area > OVERLAP_TOLERANCE_PX) {
        violations.push({
          kind: "component-overlap",
          nodes: [a.id, b.id],
          detail: `boxes intersect by ${Math.round(area)}px² (a: ${a.x},${a.y} ${a.width}×${a.height}; b: ${b.x},${b.y} ${b.width}×${b.height})`,
        });
      }
    }
  }

  // Out-of-canvas: any node (components + boundaries) beyond the viewBox.
  const viewBox = typed.viewBox;
  if (Array.isArray(viewBox) && Number.isFinite(Number(viewBox[0])) && Number.isFinite(Number(viewBox[1]))) {
    const canvasWidth = Number(viewBox[0]);
    const canvasHeight = Number(viewBox[1]);
    for (const box of [...components, ...boundaries]) {
      if (box.x < -1 || box.y < -1 || box.x + box.width > canvasWidth + 1 || box.y + box.height > canvasHeight + 1) {
        violations.push({
          kind: "out-of-canvas",
          nodes: [box.id],
          detail: `box ${box.x},${box.y} ${box.width}×${box.height} exceeds viewBox ${canvasWidth}×${canvasHeight}`,
        });
      }
    }
  }

  return { violations };
}

/**
 * Run the vendored `archify validate <type> <ir> --layout-json` and check its
 * report. Non-architecture diagram types have no layout-json support (the
 * CLI rejects them) — an honest skip, never a failure.
 */
export function runArchifyLayoutCheck(opts: {
  archifyBinPath: string;
  diagramType: string;
  irPath: string;
  spawnSync?: (cmd: string, args: string[]) => { status: number | null; stdout: string; stderr: string };
}): LayoutCheckResult {
  if (opts.diagramType !== "architecture") {
    return {
      violations: [],
      skipped: true,
      skipReason: `layout-json supports architecture diagrams only (got ${opts.diagramType})`,
    };
  }
  const spawn = opts.spawnSync ?? ((cmd: string, args: string[]) => defaultSpawn(cmd, args));
  const result = spawn(process.execPath, [
    opts.archifyBinPath,
    "validate",
    opts.diagramType,
    opts.irPath,
    "--layout-json",
  ]);
  if (result.status !== 0) {
    return {
      violations: [],
      skipped: true,
      skipReason: `validate exited ${result.status}: ${result.stderr.slice(0, 200)}`,
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    return { violations: [], skipped: true, skipReason: "layout-json stdout unparseable" };
  }
  return checkLayoutContract(parsed);
}

import { spawnSync as defaultSpawnRaw } from "node:child_process";
function defaultSpawn(cmd: string, args: string[]): { status: number | null; stdout: string; stderr: string } {
  const run = defaultSpawnRaw(cmd, args, { encoding: "utf8" });
  return { status: run.status, stdout: run.stdout ?? "", stderr: run.stderr ?? "" };
}
