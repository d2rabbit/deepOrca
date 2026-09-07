/**
 * Static audit for the official library's one click-behavior trap: Button's
 * second positional argument is typed `ActionExpression`, but the upstream
 * prop schema is `z.any()` — a bare string compiles fine and then THROWS at
 * click time (react-lang's `!("steps" in action)`), silently: no red wall,
 * no ActionEvent, nothing for the correction loop. The official prompt only
 * documents `Action([...])`, a variable reference, or omission (auto
 * `@ToAssistant(label)`), so a string/ternary-of-strings in that slot is
 * always a dead button.
 *
 * Pure string classification — no React, no SDK imports — so it can be unit
 * tested directly (see tests/openui-action-audit.test.ts). The official
 * renderer feeds the findings into the same non-fatal warning channel as
 * excess-args (openui/correction.ts), which rides the existing correction
 * loop; legacy-library code uses different action semantics and is never
 * audited (OpenuiRenderer gates on the routed mode).
 */

export const DEAD_BUTTON_ACTION_CODE = "dead-button-action";

export type OpenuiActionFinding = { code: typeof DEAD_BUTTON_ACTION_CODE; message: string };

/** Flood guard: one bad generator habit usually repeats; five findings give
 *  the correction loop plenty of signal without wall-of-text summaries. */
const MAX_FINDINGS = 5;

/** A double-quoted string literal with backslash escapes ("…\"…" ok). */
function isStringLiteral(expression: string): boolean {
  const trimmed = expression.trim();
  if (trimmed.length < 2 || !trimmed.startsWith('"') || !trimmed.endsWith('"')) return false;
  for (let index = 1; index < trimmed.length - 1; index += 1) {
    if (trimmed[index] === "\\") index += 1;
    else if (trimmed[index] === '"') return false;
  }
  return true;
}

/** `cond ? "a" : "b"` with string literals on both branches — the ternary
 *  form LLMs reach for when localizing button actions. */
function isTernaryOfLiterals(expression: string): boolean {
  let depth = 0;
  let inString = false;
  for (let index = 0; index < expression.length; index += 1) {
    const char = expression[index];
    if (inString) {
      if (char === "\\") index += 1;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "(" || char === "[" || char === "{") depth += 1;
    else if (char === ")" || char === "]" || char === "}") depth -= 1;
    else if (char === "?" && depth === 0) {
      const colon = findTopLevel(expression, ":", index + 1);
      if (colon < 0) return false;
      return isStringLiteral(expression.slice(index + 1, colon)) && isStringLiteral(expression.slice(colon + 1));
    }
  }
  return false;
}

function findTopLevel(expression: string, target: ":", from: number): number {
  let depth = 0;
  let inString = false;
  for (let index = from; index < expression.length; index += 1) {
    const char = expression[index];
    if (inString) {
      if (char === "\\") index += 1;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "(" || char === "[" || char === "{") depth += 1;
    else if (char === ")" || char === "]" || char === "}") depth -= 1;
    else if (char === target && depth === 0) return index;
  }
  return -1;
}

/** Extract the trimmed top-level argument expressions of the call whose "("
 *  sits at `openParen` (word-scanned, string-aware). Empty string args are
 *  omitted; `Button("Go")` yields one arg. */
function splitCallArgs(code: string, openParen: number): string[] {
  const args: string[] = [];
  let depth = 0;
  let inString = false;
  let current = "";
  for (let index = openParen; index < code.length; index += 1) {
    const char = code[index];
    if (inString) {
      current += char;
      if (char === "\\") {
        if (index + 1 < code.length) current += code[index + 1];
        index += 1;
      } else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      current += char;
    } else if (char === "(" || char === "[" || char === "{") {
      if (depth > 0) current += char;
      depth += 1;
    } else if (char === ")" || char === "]" || char === "}") {
      depth -= 1;
      if (depth === 0 && char === ")") {
        args.push(current.trim());
        return args;
      }
      current += char;
    } else if (char === "," && depth === 1) {
      args.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  // Unbalanced (truncated output) — what we collected is not a valid call.
  return [];
}

function isDeadActionArgument(expression: string): boolean {
  return expression.length > 0 && (isStringLiteral(expression) || isTernaryOfLiterals(expression));
}

/**
 * Find `Button(` call sites (outside string literals; word-boundary checked,
 * so `MyButton(`/`Buttons(` never match) whose second positional argument is
 * a plain string literal or a ternary of two literals. Only the official
 * library is audited — legacy Button treats a string action as a message.
 */
export function auditButtonActions(code: string): OpenuiActionFinding[] {
  const findings: OpenuiActionFinding[] = [];
  let inString = false;
  for (let index = 0; index < code.length && findings.length < MAX_FINDINGS; index += 1) {
    const char = code[index];
    if (inString) {
      if (char === "\\") index += 1;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char !== "B" || !code.startsWith("Button(", index)) continue;
    const previous = index > 0 ? code[index - 1] : "";
    if (/[A-Za-z0-9_$]/.test(previous)) continue;
    const args = splitCallArgs(code, index + "Button".length);
    if (args.length < 2 || !isDeadActionArgument(args[1])) continue;
    findings.push({
      code: DEAD_BUTTON_ACTION_CODE,
      message:
        `Button passes a plain string (${args[1]}) as its action argument — it compiles but throws ` +
        `at click time with no visible error. Use an Action expression instead, e.g. ` +
        `Action([@ToAssistant(${args[1]})]), or omit the argument to send the label to the assistant.`,
    });
  }
  return findings;
}
