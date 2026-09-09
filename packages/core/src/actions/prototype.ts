/**
 * Prototype suite actions. Generation is delegated to the existing design
 * skills; immutable suite reads and writes cross the desktop A2UI MCP seam.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type { ActionContext, ActionDefinition, ActionRun } from "./types";
import { OPENUI_CREATE_CONTRACT, OPENUI_PRESERVE_CONTRACT, OPENUI_QUALITY_CONTRACT } from "./openui-contract";

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

export interface PrototypeSuiteContent {
  requirement?: string;
  spec?: string;
  openui?: string;
  verification?: PrototypeVerificationResult;
  /** Technical architecture document (user ask 2026-09-08 技术架构模块). */
  arch?: string;
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
  return /^[ \t]*[A-Za-z_$][\w$]*\s*=\s*\w/m.test(code) && /^[ \t]*root\s*=\s*\w/m.test(code);
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
function extractMarkdownDocument(result: unknown): string | null {
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
async function repairOpenuiProgram(
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
    const generated = await ctx.runSubagent({
      skill: "pm-designer-openui",
      prompt:
        "The OpenUI Lang program below failed validation against the official parser. " +
        "Fix EVERY reported issue and return the COMPLETE corrected program in one code fence. " +
        "Change nothing beyond what the issues require. Do not call tools.\n\n" +
        `${opts.contract}\n\nParser issues:\n${formatOpenuiFeedback(verdict)}\n\nCurrent program:\n${code}`,
      silent: true,
    });
    const next = extractGeneratedBody(generated);
    if (!next || !looksLikeOpenuiProgram(next)) return code; // keep the last good draft
    code = next;
  }
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
        // 提示词只指到技能契约,不逐字复述节名(节名与技能文档漂移就是当初
        // "两份矛盾清单"的根因)。管线模式由"Do not call tools"声明:持久化
        // 由本 action 通过 render_spec 完成,子代理只回文档。
        "Write the complete structured PRD for the requirement below, following the spec-writer document " +
        "contract exactly. Do not call tools. " +
        "Return only the complete markdown document in one markdown code fence.\n\n" +
        requirement,
      silent: true,
    });
    // PRD 内嵌 ```mermaid 图(标准化格式),必须用嵌套围栏感知抽取,否则文档
    // 在第一张图处被截断且 looksLikeSpecDocument 拦不住(任意标题即过)。
    const document = extractMarkdownDocument(generated);
    if (!document || !looksLikeSpecDocument(document)) {
      return {
        ok: false,
        error: "spec-writer returned an empty or section-less requirements document (truncated output?) — regenerate",
      };
    }
    if (ctx.signal.aborted) return { ok: false, error: "cancelled" };
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
        // 契约单一来源(openui-contract.ts):单应用 $page 结构 + 质量底线
        // (可交互/高保真/可编辑),详情见技能的质量契约节,提示词不另行复述。
        OPENUI_CREATE_CONTRACT +
        " " +
        OPENUI_QUALITY_CONTRACT +
        " Cover its page list and flows strictly without inventing scope. " +
        "Do not call tools. " +
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
    // Local validation loop: official parser verdict → patch prompt → retry,
    // BEFORE persistence (user ask 2026-09-09). Fail-open when the desktop
    // side has no validator.
    const verifiedCode = await repairOpenuiProgram(ctx, {
      code,
      contract: OPENUI_CREATE_CONTRACT,
      progressCode: "prototype.materialize.repairing",
      basePercent: 55,
    });
    if (ctx.signal.aborted) return { ok: false, error: "cancelled" };
    const saved = await executeA2ui(ctx, "render_openui", {
      code: verifiedCode,
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
  // 确定性四项每次重算;此前版本里的非确定性检查(revise 追加的 pending 观察
  // 项、外部 checks)必须随行——文档化回路是"revise 加观察 → 重新 verify",
  // 整体替换的 save_suite_result 若不携带就会把 pending 项静默清掉。
  const deterministicIds = new Set(["spec-non-empty", "page-list-present", "openui-non-empty", "openui-root"]);
  const carried = (content.verification?.checks ?? []).filter((check) => !deterministicIds.has(check.id));
  const checks: PrototypeVerificationCheck[] = [
    ...carried,
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
    const generated = await ctx.runSubagent({
      skill: "arch-writer",
      prompt:
        "Write the complete standardized technical architecture document derived from the approved PRD below. " +
        "Follow the arch-writer document contract exactly (技术选型表 / 系统架构 Mermaid / 数据模型 erDiagram / " +
        "核心流程图 / 模块拆分表 / 非功能设计 / 风险与对策表; every diagram followed by a companion table). " +
        "Do not call tools. Return only the complete markdown document in one markdown code fence.\n\n" +
        spec,
      silent: true,
    });
    // 架构文档内嵌 ```mermaid 围栏,单围栏惰性抽取会在第一个内层围栏处截断;
    // extractMarkdownDocument 按行锚定围栏剥壳,最后一个围栏不是裸闭合行的
    // 输出一律视为截断:拒绝,而不是抢救半份文档。
    const document = extractMarkdownDocument(generated);
    if (!document || !looksLikeArchDoc(document)) {
      return {
        ok: false,
        error: "arch-writer returned an empty or diagram-less architecture document (truncated output?) — regenerate",
      };
    }
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
