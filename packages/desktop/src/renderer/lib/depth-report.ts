/**
 * Deep-lane report parsing (specs/depth-lane 渲染优化, user ask 2026-09-05).
 *
 * The S5 report rides the `<proposed_plan>` block contract
 * (templates/prompts/depth-lane.md.ejs kind "report") — until now it rendered
 * as raw markdown. This parser lifts its six sections into a structure the
 * dedicated card can render: 结论先行, confidence, divergences, assumptions,
 * risks (irreversible items flagged), and executable next steps — the last
 * one being what the 任务轨迹 (task-tree) integration seeds.
 */

export type DepthReport = {
  /** Conclusion paragraph (结论先行 — rendered as the hero block). */
  conclusion: string;
  /** True unless the 未收敛 banner is present. */
  converged: boolean;
  /** Parsed percent when the model emitted "NN%" (null → text shown as-is). */
  confidencePct: number | null;
  confidenceText: string;
  divergences: string[];
  assumptions: string[];
  risks: string[];
  /** Risk lines carrying the irreversible/需拍板 marker — surfaced on top. */
  irreversible: string[];
  nextSteps: string[];
  /** Full block text (fallback rendering / clipboard). */
  raw: string;
};

const COMPLETE_BLOCK = /<proposed_plan>\s*([\s\S]*?\S[\s\S]*?)\s*<\/proposed_plan>/;
const IRREVERSIBLE_MARK = /不可逆|需用户拍板|需拍板|irreversible/i;

/** Bullet/numbered lines → trimmed strings; prose paragraphs stay whole. */
function toLines(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = trimmed.match(/^(?:[-*•]|\d+[.、)])\s+(.+)$/);
    if (m) {
      out.push(m[1]!.trim());
    } else if (out.length === 0 && !trimmed.startsWith(">")) {
      out.push(trimmed);
    } else if (!trimmed.startsWith(">")) {
      // continuation of the previous item
      out[out.length - 1] = `${out[out.length - 1] ?? ""} ${trimmed}`.trim();
    }
  }
  return out;
}

/** Split the block into `## heading → body` sections. */
function splitSections(block: string): Map<string, string> {
  const map = new Map<string, string>();
  const parts = block.split(/^##\s+/m);
  for (const part of parts) {
    const nl = part.indexOf("\n");
    if (nl < 0) continue;
    const heading = part.slice(0, nl).trim();
    const body = part.slice(nl + 1).trim();
    if (heading) map.set(heading, body);
  }
  return map;
}

function firstValue(map: Map<string, string>, prefixes: string[]): string {
  for (const key of map.keys()) {
    if (prefixes.some((p) => key.startsWith(p))) return map.get(key) ?? "";
  }
  return "";
}

/**
 * Extract a COMPLETE deep report from message content. Returns null when the
 * block is absent, still streaming (no closing tag), or not a deep report
 * (plain plan-mode proposals keep their existing PlanCard flow).
 */
export function extractDepthReport(content: string | null | undefined): DepthReport | null {
  if (!content) return null;
  const match = content.match(COMPLETE_BLOCK);
  if (!match) return null;
  const block = match[1]!;
  if (!block.includes("深度决策报告") && !block.includes("deep-lane")) return null;

  const sections = splitSections(block);
  const conclusion = firstValue(sections, ["结论"]);
  const confidenceText = firstValue(sections, ["置信度"]).split(/\r?\n/)[0]?.trim() ?? "";
  const pctMatch = confidenceText.match(/(\d{1,3})\s*%/);
  const confidencePct = pctMatch ? Math.min(100, Number(pctMatch[1])) : null;
  const risks = toLines(firstValue(sections, ["风险与红线", "风险"]));
  return {
    conclusion,
    converged: !block.includes("未收敛"),
    confidencePct,
    confidenceText,
    divergences: toLines(firstValue(sections, ["分歧点", "分歧"])),
    assumptions: toLines(firstValue(sections, ["关键假设", "假设"])),
    irreversible: risks.filter((r) => IRREVERSIBLE_MARK.test(r)),
    risks: risks.filter((r) => !IRREVERSIBLE_MARK.test(r)),
    nextSteps: toLines(firstValue(sections, ["可执行下一步", "下一步", "下一步行动"])),
    raw: block,
  };
}

/** Remove the complete deep-report block from content (card renders it). */
export function stripDepthReport(content: string): string {
  return content.replace(/<proposed_plan>[\s\S]*?<\/proposed_plan>/g, "").trim();
}

/** The task-tree seed prompt for the 落为任务轨迹 action. */
export function depthReportTaskPrompt(report: DepthReport): string {
  const steps = report.nextSteps.map((s, i) => `${i + 1}. ${s}`).join("\n");
  return `深度决策报告执行：${report.conclusion.slice(0, 120)}${steps ? `\n下一步：\n${steps}` : ""}`;
}
