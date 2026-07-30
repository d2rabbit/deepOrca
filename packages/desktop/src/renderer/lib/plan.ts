// Ported from the CLI's PlanImplementationPrompt so the desktop UI can detect a
// finished plan and offer the same implement / stay / default choices.

export type PlanImplementationChoice = "implement" | "stay" | "default";

/** Return only a complete proposed plan, so partial/historic tags cannot trigger the chooser. */
export function extractProposedPlan(reply: string | null | undefined): string | null {
  if (!reply) {
    return null;
  }
  const match = reply.match(/<proposed_plan>\s*([\s\S]*?\S[\s\S]*?)\s*<\/proposed_plan>/);
  return match?.[1] ?? null;
}

export function getImplementationPrompt(plan: string): string {
  const fullWidthPunctuationCount = (plan.match(/[，、；。]/g) ?? []).length;
  return fullWidthPunctuationCount > 5 ? "实现此方案。" : "Implement the plan.";
}

/**
 * Extract plan steps from a proposed_plan markdown string.
 * Parses lines starting with -, *, or numbered (1.) as steps.
 * Returns an array of { text, level } where level 0 = top-level, 1 = sub-item.
 */
export function extractPlanSteps(plan: string): Array<{ text: string; level: number }> {
  const lines = plan.split(/\r?\n/);
  const steps: Array<{ text: string; level: number }> = [];
  for (const line of lines) {
    const trimmed = line.trimEnd();
    if (!trimmed.trim()) continue;
    // Match: "- text", "* text", "1. text", "  - sub text"
    const bulletMatch = trimmed.match(/^(\s*)([-*]|\d+\.)\s+(.+)$/);
    if (bulletMatch) {
      const indent = bulletMatch[1]!.length;
      const level = indent >= 2 ? 1 : 0;
      steps.push({ text: bulletMatch[3]!, level });
    } else if (trimmed.startsWith("#")) {
      // Skip headings
      continue;
    } else if (steps.length > 0) {
      // Continuation of previous step
      steps[steps.length - 1]!.text += " " + trimmed.trim();
    }
  }
  return steps;
}
