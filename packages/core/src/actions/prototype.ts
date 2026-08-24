/**
 * Prototype module actions (design-module split, real-machine feedback):
 * "一句话需求生成原型" mashed two different disciplines into one auto-routed
 * flow. The split gives prototype design its own two-step methodology —
 *
 *   prototype.spec        需求（一句话或详细）→ 结构化需求文档（spec.md）
 *   prototype.materialize 需求文档 → 原型图（OpenUI Lang, render_openui）
 *
 * while UI/UX design (.dd) lives in the separate design.* module
 * (design.materialize: requirement — one sentence allowed — or an existing
 * prototype → UI design document).
 *
 * Both actions are orchestration only: generation goes through
 * ctx.runSubagent (silent — panel-initiated runs leave no session residue)
 * whose skills call the MCP tools that persist to .deeporca/designs/.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ActionDefinition, ActionRun } from "./types";

/** Artifact dir layout shared with desktop's design-store. */
const DESIGNS_DIR = ".deeporca/designs";
const SPEC_FILE = "spec.md";

/** Same id guard as design-store — ids reach path.join, so only plain tokens. */
function isSafeArtifactId(id: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id) && !id.includes("..");
}

/** Read an artifact content file under .deeporca/designs/<id>/; null when absent/unsafe. */
function readArtifactFile(projectRoot: string, id: string, file: string): string | null {
  if (!isSafeArtifactId(id)) return null;
  try {
    const dir = path.resolve(projectRoot, DESIGNS_DIR, id);
    const base = path.resolve(projectRoot, DESIGNS_DIR);
    if (dir !== path.join(base, id)) return null; // containment
    const content = fs.readFileSync(path.join(dir, file), "utf8");
    return content.trim() ? content : null;
  } catch {
    return null;
  }
}

// ── prototype.spec: requirement → structured requirements document ───────────

export interface PrototypeSpecInput {
  /** The requirement — a one-liner is fine; the skill expands it. */
  requirement: string;
}

export interface PrototypeSpecOutput {
  ok: boolean;
  error?: string;
}

export const prototypeSpecDefinition: ActionDefinition<PrototypeSpecInput> = {
  id: "prototype.spec",
  description:
    "Prototype design, step 1: expand a requirement (one sentence is fine) into a structured requirements " +
    "document (背景/目标/用户与场景/功能需求/页面清单/验收标准) persisted as a spec artifact via the " +
    "render_spec tool. Step 2 (prototype.materialize) turns the document into an interactive prototype.",
  category: "design",
  parameters: {
    type: "object",
    properties: {
      requirement: {
        type: "string",
        description: "Natural language requirement (what to build); a single sentence is enough",
      },
    },
    required: ["requirement"],
    additionalProperties: false,
  },
  sideEffects: ["write-in-cwd"],
};

export const prototypeSpecRun: ActionRun<PrototypeSpecInput, PrototypeSpecOutput> = async (input, ctx) => {
  const requirement = input?.requirement?.trim();
  if (!requirement) {
    return { ok: false, error: "requirement is required" };
  }
  if (!ctx.runSubagent) {
    return { ok: false, error: "runSubagent not available — the design subagent channel must be wired" };
  }

  ctx.emit({ message: "📝 正在细化需求并生成需求文档…", percent: 30 });
  try {
    await ctx.runSubagent({
      skill: "spec-writer",
      prompt:
        `Write the structured requirements document for this requirement (expand it, do not invent scope):\n\n` +
        `${requirement}\n\n` +
        "Call the render_spec tool with the complete markdown document. requirement text is included for provenance.",
      silent: true,
    });
    ctx.emit({ message: "✅ 需求文档已生成", percent: 100 });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
};

// ── prototype.materialize: requirements document → interactive prototype ─────

export interface PrototypeMaterializeInput {
  /** spec artifact id produced by prototype.spec (step 1). */
  specArtifactId: string;
}

export interface PrototypeMaterializeOutput {
  ok: boolean;
  error?: string;
}

export const prototypeMaterializeDefinition: ActionDefinition<PrototypeMaterializeInput> = {
  id: "prototype.materialize",
  description:
    "Prototype design, step 2: turn a requirements document (a prototype.spec artifact) into an interactive " +
    "OpenUI Lang prototype via render_openui. The prototype follows the document's 页面清单 strictly — " +
    "no scope invention. Requires a spec artifact from prototype.spec.",
  category: "design",
  parameters: {
    type: "object",
    properties: {
      specArtifactId: {
        type: "string",
        description: "Artifact id of the requirements document (from prototype.spec / the designs list)",
      },
    },
    required: ["specArtifactId"],
    additionalProperties: false,
  },
  sideEffects: ["write-in-cwd"],
};

export const prototypeMaterializeRun: ActionRun<PrototypeMaterializeInput, PrototypeMaterializeOutput> = async (
  input,
  ctx
) => {
  const specId = input?.specArtifactId?.trim();
  if (!specId) {
    return { ok: false, error: "specArtifactId is required — run prototype.spec first" };
  }
  if (!ctx.runSubagent) {
    return { ok: false, error: "runSubagent not available — the design subagent channel must be wired" };
  }

  ctx.emit({ message: "📄 读取需求文档…", percent: 20 });
  const spec = readArtifactFile(ctx.projectRoot, specId, SPEC_FILE);
  if (!spec) {
    return { ok: false, error: `requirements document not found for artifact "${specId}" — run prototype.spec first` };
  }

  ctx.emit({ message: "🎨 正在根据需求文档生成原型图…", percent: 50 });
  try {
    await ctx.runSubagent({
      skill: "pm-designer-openui",
      prompt:
        `Create the interactive prototype for the requirements document below. Derive pages and flows from ` +
        `its 页面清单/功能需求 sections strictly — do not invent scope beyond the document.\n\n` +
        `Call the render_openui tool with the complete OpenUI Lang program.\n\n` +
        `--- 需求文档 ---\n${spec}\n--- 文档结束 ---`,
      silent: true,
    });
    ctx.emit({ message: "✅ 原型图已生成", percent: 100 });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
};

export { readArtifactFile };
