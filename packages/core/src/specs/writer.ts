/**
 * Design-chain registration writer (specs/spec-graph-adoption §1.5, fallback
 * route pinned by T3.0 核对 2026-09-19): the prototype suite store
 * (`.deeporca/designs`, suite/version-versioned, verification-gated) stays
 * the SOLE authority for the PRD and the technical-architecture document —
 * this writer only upserts thin REGISTRATION ANCHOR nodes into the spec
 * domain so the design chain is visible/navigable in the spec graph WITHOUT
 * ever creating a second editable copy (拍板②: no parallel authority).
 *
 * T3.0 finding baked in here: the authoritative documents live as FIELDS of
 * the suite version content (not standalone files), so anchors carry NO
 * `artifacts` entries — that field means implementation outputs and would
 * false-fire drift gate B. The suite location lives in the `suite`/`version`
 * frontmatter keys and the pointer-stub body.
 *
 * Best-effort contract: callers wrap in try/catch — a registration failure
 * must never fail the design action that produced the artifact.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

import { parseFrontmatter } from "./frontmatter";

/** Body marker identifying a file as one of OUR registration anchors. */
const ANCHOR_MARKER = "登记锚点";

export interface DesignChainRegistration {
  /** Suite slug → spec-domain directory name (sanitized here). */
  suiteId: string;
  versionId: string;
}

function sanitizeSuiteSlug(suiteId: string): string {
  // Keep letters/numbers across scripts — CJK suite names are the norm, and
  // stripping them would collapse every Chinese-named suite into one slug.
  const slug = suiteId
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "suite";
}

function anchorNode(frontmatterLines: string[], body: string): string {
  return `---\n${frontmatterLines.join("\n")}\n---\n\n${body.trim()}\n`;
}

/** Outcome of one anchor upsert — the skip is reported, never silent. */
export type DesignChainRegistrationResult = {
  status: "written" | "unchanged" | "skipped-unparseable-anchor";
  /** Anchor file the status refers to (absolute path). */
  file: string;
};

/**
 * Upsert the two anchor nodes for one design suite. Idempotent: existing
 * anchors keep their mtime (and thus their drift gate A baseline) unless the
 * recorded suite version actually changed.
 *
 * `skipped-unparseable-anchor`: the slot file's frontmatter no longer parses
 * but its body still carries the anchor marker — a hand-mangled anchor the
 * no-clobber guard refuses to overwrite. No future save re-registers it; a
 * human must fix the file. Callers surface this (best-effort contract still
 * holds: never throw, never fail the design action).
 */
export async function ensureDesignChainRegistration(
  root: string,
  input: DesignChainRegistration
): Promise<DesignChainRegistrationResult> {
  const slug = sanitizeSuiteSlug(input.suiteId);
  const dir = path.join(root, ".deeporca", "specs", slug);
  await fs.mkdir(dir, { recursive: true });
  const versionRef = `suite: ${slug}`;
  const versionLine = `version: ${input.versionId}`;

  const prdBody =
    `> 本节点是 spec 图的**登记锚点**（spec-graph-adoption 降级路线）：产品设计文档（PRD）的权威版本存于原型设计模块的套件存储\n` +
    `>（\`${input.suiteId}\` · \`${input.versionId}\`，\`.deeporca/designs/\` 下该套件版本目录）。\n` +
    `> 在原型设计模块的「需求文档」栏目查看与编辑；正文暂不搬家，二期再迁。\n`;
  const prdFm = [`id: ${slug}`, `type: product-design`, `status: active`, versionRef, versionLine];
  const prdFile = path.join(dir, "product-design.md");
  const prd = await upsert(prdFile, anchorNode(prdFm, prdBody), {
    suite: slug,
    version: input.versionId,
  });

  const archBody =
    `> 本节点是 spec 图的**登记锚点**（spec-graph-adoption 降级路线）：技术架构文档的权威版本存于套件存储\n` +
    `>（\`${input.suiteId}\` · \`${input.versionId}\`），经验收门（verification passed）生成。\n` +
    `> 在原型设计模块的「技术架构」栏目查看；正文暂不搬家，二期再迁。\n`;
  const archFm = [
    `id: ${slug}#architecture`,
    `type: architecture`,
    `status: active`,
    `parent: ${slug}`,
    versionRef,
    versionLine,
  ];
  const archFile = path.join(dir, "architecture.md");
  const arch = await upsert(archFile, anchorNode(archFm, archBody), {
    suite: slug,
    version: input.versionId,
  });

  // Report the most actionable outcome: a skip outranks a write (the chain
  // stays incomplete), a write outranks an unchanged hit. `file` must name
  // the file the status actually refers to (mixed outcomes happen when a
  // human edited exactly one of the two anchors).
  if (prd.status === "skipped-unparseable-anchor") return { status: prd.status, file: prdFile };
  if (arch.status === "skipped-unparseable-anchor") return { status: arch.status, file: archFile };
  if (prd.status === "written") return { status: "written", file: prdFile };
  if (arch.status === "written") return { status: "written", file: archFile };
  return { status: "unchanged", file: archFile };
}

/**
 * Idempotency via STRUCTURED frontmatter comparison, not substring matching —
 * re-quoting, key reordering, or prose edits in the body must not trigger a
 * rewrite (a rewrite would bump the node's mtime and silently shift the
 * drift gate A baseline).
 *
 * No-clobber guard: a file whose frontmatter no longer parses but whose body
 * still carries the anchor marker is a HAND-MANGLED anchor — full-overwriting
 * it would silently destroy the human's edits, so registration skips it
 * (2026-09 swarm review data-loss seam). A foreign file (no marker) in the
 * slot is (re)registered as before.
 */
async function upsert(
  file: string,
  content: string,
  expect: { suite: string; version: string }
): Promise<DesignChainRegistrationResult> {
  let existing: string | null = null;
  try {
    existing = await fs.readFile(file, "utf8");
  } catch {
    // missing/unreadable → (re)register
  }
  if (existing !== null) {
    const fm = parseFrontmatter(existing);
    if (fm && fm.suite === expect.suite && fm.version === expect.version && typeof fm.type === "string") {
      return { status: "unchanged", file };
    }
    if (!fm && existing.includes(ANCHOR_MARKER)) {
      return { status: "skipped-unparseable-anchor", file };
    }
  }
  await fs.writeFile(file, content, "utf8");
  return { status: "written", file };
}
