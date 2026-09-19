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

export interface DesignChainRegistration {
  /** Suite slug → spec-domain directory name (sanitized here). */
  suiteId: string;
  versionId: string;
}

export function sanitizeSuiteSlug(suiteId: string): string {
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

/**
 * Upsert the two anchor nodes for one design suite. Idempotent: existing
 * anchors keep their mtime (and thus their drift gate A baseline) unless the
 * recorded suite version actually changed.
 */
export async function ensureDesignChainRegistration(root: string, input: DesignChainRegistration): Promise<void> {
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
  await upsert(path.join(dir, "product-design.md"), anchorNode(prdFm, prdBody), `${versionRef}\n${versionLine}`);

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
  await upsert(path.join(dir, "architecture.md"), anchorNode(archFm, archBody), `${versionRef}\n${versionLine}`);
}

async function upsert(file: string, content: string, marker: string): Promise<void> {
  try {
    const existing = await fs.readFile(file, "utf8");
    // Same suite version and already an anchor → leave untouched so the
    // node's mtime stays a truthful signal for drift gate A/B/C.
    if (existing.includes(marker) && existing.includes("登记锚点")) return;
  } catch {
    // missing → first registration
  }
  await fs.writeFile(file, content, "utf8");
}
