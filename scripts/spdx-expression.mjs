/**
 * Evaluator for the (subset of) SPDX license expressions license-checker
 * emits: license ids joined by AND/OR with optional parentheses. Extracted
 * from check-licenses.js so the gate semantics are unit-testable
 * (scripts/check-licenses.test.mjs).
 *
 * The earlier implementation stripped parentheses and split on OR first —
 * correct only for flat expressions. Stripping turns "(A OR B) AND C" into
 * "A OR B AND C", where OR-first splitting accepts on A alone and waves
 * through the copyleft conjunct the expression was actually refusing. This
 * parser honors nesting: AND binds tighter than OR, parens override.
 */

const OPERATORS = new Set(["AND", "OR"]);

function tokenize(text) {
  const normalized = text.replace(/\*$/, "").trim();
  const tokens = [];
  for (const match of normalized.matchAll(/\(|\)|[^\s()]+/g)) {
    const raw = match[0];
    if (raw === "(") {
      tokens.push({ type: "(", value: raw });
    } else if (raw === ")") {
      tokens.push({ type: ")", value: raw });
    } else {
      const upper = raw.toUpperCase();
      tokens.push(OPERATORS.has(upper) ? { type: "op", value: upper } : { type: "id", value: raw });
    }
  }
  return tokens;
}

/** Evaluate `raw` against the `allowed` id set. Returns true only when the
 *  expression is satisfiable within the allow list. Anything this parser
 *  does not fully understand — WITH-expressions, unbalanced parens, empty
 *  input, trailing garbage — fails closed (false). */
export function isAllowedExpression(raw, allowed) {
  const tokens = tokenize(String(raw ?? ""));
  if (tokens.length === 0) return false;
  let position = 0;

  const parseAtom = () => {
    const token = tokens[position];
    if (!token) throw new Error("unexpected end of expression");
    position += 1;
    if (token.type === "(") {
      const value = parseOr();
      const closing = tokens[position];
      if (!closing || closing.type !== ")") throw new Error("unbalanced parentheses");
      position += 1;
      return value;
    }
    if (token.type === "id") return allowed.has(token.value);
    throw new Error(`unexpected token: ${token.value}`);
  };
  const parseAnd = () => {
    let value = parseAtom();
    while (tokens[position]?.type === "op" && tokens[position].value === "AND") {
      position += 1;
      value = parseAtom() && value;
    }
    return value;
  };
  const parseOr = () => {
    let value = parseAnd();
    while (tokens[position]?.type === "op" && tokens[position].value === "OR") {
      position += 1;
      value = parseAnd() || value;
    }
    return value;
  };

  try {
    const result = parseOr();
    return position === tokens.length ? result : false;
  } catch {
    return false;
  }
}
