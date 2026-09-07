/**
 * Prototype suite actions. Generation is delegated to the existing design
 * skills; immutable suite reads and writes cross the desktop A2UI MCP seam.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type { ActionContext, ActionDefinition, ActionRun } from "./types";
import { OPENUI_PRESERVE_CONTRACT } from "./openui-contract";

const DESIGNS_DIR = ".deeporca/designs";
const SPEC_FILE = "spec.md";
const A2UI_TOOL_PREFIX = "mcp__a2ui__";

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

export interface PrototypeSuiteContent {
  requirement?: string;
  spec?: string;
  openui?: string;
  verification?: PrototypeVerificationResult;
}

export interface UiSuiteContent {
  requirement?: string;
  openui?: string;
  tokens?: unknown;
  components?: unknown;
  quality?: Record<string, unknown>;
  sourcePrototype?: { suiteId: string; versionId: string };
  designSystemId?: string;
}

interface SuiteVersionPayload {
  artifactRef: ArtifactRef;
  title: string;
  status: string;
  content: PrototypeSuiteContent | UiSuiteContent;
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

function subagentContent(result: unknown): string | null {
  if (!isRecord(result) || typeof result.content !== "string") return null;
  return result.content.trim() || null;
}

function extractGeneratedBody(result: unknown): string | null {
  const content = subagentContent(result);
  if (!content) return null;
  const fence = content.match(/```(?:markdown|md|openui|dd|html|json)?\s*\n([\s\S]*?)```/i);
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
  return /^[ \t]*[A-Za-z_$][\w$]*\s*=\s*\w/m.test(code) && /^[ \t]*root\s*=\s*\w/m.test(code);
}

/** A structured spec must carry at least one markdown section heading. */
export function looksLikeSpecDocument(markdown: string): boolean {
  return /^#{1,6}\s+\S/m.test(markdown);
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
  versionId: string
): Promise<{ ok: true; value: SuiteVersionPayload } | { ok: false; error: string }> {
  const result = await executeA2ui(ctx, "read_suite_version", { suiteId, versionId });
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
    },
  };
}

export interface PrototypeSpecInput {
  requirement: string;
  suiteId?: string;
  baseVersionId?: string;
  note?: string;
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
    },
    required: ["requirement"],
    additionalProperties: false,
  },
  sideEffects: ["write-in-cwd"],
};

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
    const generated = await ctx.runSubagent({
      skill: "spec-writer",
      prompt:
        "Write the complete structured requirements document for the requirement below. Include background/goals, " +
        "users/scenarios, functional requirements, an explicit page list, and acceptance criteria. Do not call tools. " +
        "Return only the complete markdown document in one markdown code fence.\n\n" +
        requirement,
      silent: true,
    });
    const document = extractGeneratedBody(generated);
    if (!document || !looksLikeSpecDocument(document)) {
      return {
        ok: false,
        error: "spec-writer returned an empty or section-less requirements document (truncated output?) — regenerate",
      };
    }
    const saved = await executeA2ui(ctx, "render_spec", {
      document,
      requirement,
      ...(suiteId ? { suiteId } : {}),
      ...(baseVersionId ? { versionId: baseVersionId } : {}),
      note: input.note?.trim() || (suiteId ? "prototype specification revision" : "initial prototype specification"),
    });
    if (!saved.ok) return saved;
    ctx.emit({ message: "Prototype specification saved", percent: 100, data: { code: "prototype.spec.saved" } });
    return { ok: true, artifactRef: saved.artifactRef, refreshStore: !saved.artifactRef };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
};

export interface PrototypeMaterializeInput {
  suiteId?: string;
  versionId?: string;
  specArtifactId?: string;
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
  if (suiteId && versionId) {
    const read = await readSuiteVersion(ctx, suiteId, versionId);
    if (!read.ok) return read;
    if (read.value.artifactRef.kind !== "prototype") return { ok: false, error: "suite is not a prototype suite" };
    const content = read.value.content as PrototypeSuiteContent;
    spec = content.spec?.trim() || null;
    requirement = content.requirement;
  } else if (legacyId) {
    spec = readArtifactFile(ctx.projectRoot, legacyId, SPEC_FILE);
  }
  if (!spec) return { ok: false, error: "requirements document not found; run prototype.spec first" };

  ctx.emit({
    message: "Generating OpenUI prototype from the selected specification",
    percent: 50,
    data: { code: "prototype.materialize.generating" },
  });
  try {
    const generated = await ctx.runSubagent({
      skill: "pm-designer-openui",
      prompt:
        "Create the complete OpenUI Lang prototype for the requirements document below. " +
        "Build ONE directly interactive application, never a stack of separate screens: declare " +
        '`$page = "<first-page>"`, give each page of the requirements\' page list its own view variable, ' +
        'render exactly one view in root behind a ternary (`$page == "orders" ? ordersView : null`), keep a ' +
        'persistent navigation shell, and switch views with buttons carrying `Action([@Set($page, "target")])`. ' +
        "Cover its page list and flows strictly without inventing scope. Do not call tools. " +
        "Return only the OpenUI Lang program in one code fence.\n\n" +
        spec,
      silent: true,
    });
    const code = extractGeneratedBody(generated);
    if (!code || !looksLikeOpenuiProgram(code)) {
      return {
        ok: false,
        error:
          "pm-designer-openui returned an empty or truncated OpenUI program (no root/component statements) — regenerate",
      };
    }
    const saved = await executeA2ui(ctx, "render_openui", {
      code,
      ...(requirement ? { requirement } : {}),
      ...(suiteId ? { suiteId, versionId } : {}),
      ...(input.note?.trim() ? { note: input.note.trim() } : {}),
    });
    if (!saved.ok) return saved;
    ctx.emit({
      message: "OpenUI prototype saved with verification pending",
      percent: 100,
      data: { code: "prototype.materialize.saved" },
    });
    return { ok: true, artifactRef: saved.artifactRef, refreshStore: !saved.artifactRef };
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
  const checks: PrototypeVerificationCheck[] = [
    { id: "spec-non-empty", label: "Specification is non-empty", status: spec ? "passed" : "failed" },
    {
      id: "page-list-present",
      label: "Specification declares a page list",
      status: hasPageList(spec) ? "passed" : "failed",
    },
    { id: "openui-non-empty", label: "OpenUI program is non-empty", status: openui ? "passed" : "failed" },
    {
      id: "openui-root",
      label: "OpenUI program declares root",
      status: /(?:^|\n)\s*root\s*=/.test(openui) ? "passed" : "failed",
    },
  ];
  for (const [index, check] of (input.checks ?? []).entries()) {
    checks.push({
      id: check.id?.trim() || `external-${index + 1}`,
      label: check.label,
      status: check.passed ? "passed" : "failed",
      ...(check.observation?.trim() ? { observation: check.observation.trim() } : {}),
    });
  }
  const verification: PrototypeVerificationResult = {
    status: checks.every((check) => check.status === "passed" || check.status === "healed") ? "passed" : "failed",
    checks,
    generatedAt: new Date().toISOString(),
    healingRounds: 0,
  };
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
  const current = input.part === "spec" ? content.spec : content.openui;
  if (!current?.trim()) return { ok: false, error: `${input.part} content is empty in the selected version` };
  const skill = input.part === "spec" ? "spec-writer" : "pm-designer-openui";
  const generated = await ctx.runSubagent({
    skill,
    prompt:
      `Revise only the ${input.part} content below. Target: ${target}. Instruction: ${instruction}. ` +
      (input.part === "openui" ? `${OPENUI_PRESERVE_CONTRACT} ` : "") +
      "Preserve unrelated content and return only the complete revised document in one code fence. Do not call tools.\n\n" +
      current,
    silent: true,
  });
  const revised = extractGeneratedBody(generated);
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
  if (input.part === "spec") {
    args.document = revised;
    if (content.requirement) args.requirement = content.requirement;
  } else {
    args.code = revised;
  }
  const saved = await executeA2ui(ctx, tool, args);
  return saved.ok
    ? { ok: true, artifactRef: saved.artifactRef, refreshStore: !saved.artifactRef }
    : { ok: false, error: saved.error };
};

export { executeA2ui, extractGeneratedBody, hasPageList, parseArtifactRef, readArtifactFile };
