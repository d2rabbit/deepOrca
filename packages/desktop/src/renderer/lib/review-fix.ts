/**
 * One-click fix (review module, real-machine feedback): turn the CURRENT
 * review findings into a structured fix brief that is injected into session
 * mode — the agent must first generate a fix PLAN (UpdatePlan tasks), then
 * fix each finding, then verify. Pure string building; no imports beyond
 * types so it is unit-testable cold.
 */

/** A single review finding (shape shared with the review.full output). */
export type ReviewFinding = {
  path: string;
  startLine: number;
  endLine?: number;
  content: string;
  existingCode?: string;
  suggestionCode?: string;
  /** CRG structural risk tag, e.g. "HIGH (12 callers)" — ordering signal. */
  crgRisk?: string;
};

/** Cap per-finding suggestion code so a huge diff block cannot drown the brief. */
const SUGGESTION_CHAR_CAP = 1600;

function clip(text: string, cap: number): string {
  return text.length > cap ? `${text.slice(0, cap)}\n…（已截断，完整建议见审查结果）` : text;
}

/**
 * Build the fix brief. Returns "" when there is nothing to fix (the caller
 * disables the button anyway — the guard keeps the contract total).
 */
export function buildReviewFixPrompt(findings: ReviewFinding[]): string {
  const items = findings.filter((f) => f.path && f.startLine > 0);
  if (items.length === 0) return "";

  const files = new Set(items.map((f) => f.path));
  const lines: string[] = [];
  lines.push(`一键修复代码审查病灶（共 ${items.length} 项，涉及 ${files.size} 个文件）。`);
  lines.push("");
  lines.push("病灶清单：");
  items.forEach((f, i) => {
    const loc =
      f.endLine != null && f.endLine !== f.startLine
        ? `${f.path}:${f.startLine}-${f.endLine}`
        : `${f.path}:${f.startLine}`;
    const risk = f.crgRisk ? ` [结构风险 ${f.crgRisk}]` : "";
    lines.push(`${i + 1}. ${loc}${risk}`);
    lines.push(`   问题：${f.content.replace(/\s+/g, " ").trim()}`);
    if (f.suggestionCode?.trim()) {
      lines.push(`   建议修改为：`);
      lines.push(
        clip(f.suggestionCode, SUGGESTION_CHAR_CAP)
          .split("\n")
          .map((l) => `     ${l}`)
          .join("\n")
      );
    }
  });
  lines.push("");
  lines.push("执行要求：");
  lines.push(
    "1. 先用 UpdatePlan 工具生成修复规划：按文件分组、每项病灶一个任务（含位置与验收标准），规划必须覆盖以上全部病灶。"
  );
  lines.push("2. 逐项修复：严格按建议修改对应位置，不做无关重构；与建议冲突时在汇报中说明并给出更优方案。");
  lines.push("3. 全部修复后运行 `npm run typecheck` 与相关测试验证，失败需修到通过。");
  lines.push("4. 最后逐项汇报：文件:行 → 处理方式；无法修复的项说明原因。");
  return lines.join("\n");
}

/**
 * Extract findings from a review.full action output (unknown-shaped for the
 * renderer). Returns [] on any shape mismatch — never throws.
 */
export function extractReviewFindings(output: unknown): ReviewFinding[] {
  if (output == null || typeof output !== "object") return [];
  const review = (output as { review?: unknown }).review;
  const comments = review != null && typeof review === "object" ? (review as { comments?: unknown }).comments : null;
  if (!Array.isArray(comments)) return [];
  const findings: ReviewFinding[] = [];
  for (const c of comments) {
    if (c == null || typeof c !== "object") continue;
    const rec = c as Record<string, unknown>;
    const path = typeof rec.path === "string" ? rec.path : "";
    const startLine = Number(rec.startLine ?? rec.start_line ?? 0);
    if (!path || !Number.isFinite(startLine) || startLine <= 0) continue;
    findings.push({
      path,
      startLine,
      endLine: rec.endLine != null ? Number(rec.endLine) : undefined,
      content: typeof rec.content === "string" ? rec.content : "",
      existingCode: typeof rec.existingCode === "string" ? rec.existingCode : undefined,
      suggestionCode: typeof rec.suggestionCode === "string" ? rec.suggestionCode : undefined,
      crgRisk: typeof rec.crgRisk === "string" ? rec.crgRisk : undefined,
    });
  }
  return findings;
}
