/**
 * Tool-call self-healing — repair + scavenge for weaker models.
 *
 * Two layers, mechanism ported from dirge's agent loop (see
 * docs/research/2026-08-23-vycode-dirge-selfheal-prestudy.md), re-implemented
 * for TypeScript from the algorithm semantics:
 *
 * 1. repairTruncatedJson — a model that hits max_tokens mid-tool-call leaves
 *    the argument string unterminated (open string, dangling `"key":`, open
 *    brace, trailing comma). A single-pass stack walker closes what is open.
 *    Pure string-level; no schema, no deps, always returns parseable JSON
 *    (hard fallback `{}` with `fallback: true`).
 *
 * 2. lenientParseToolArguments — repair chain for the structured channel:
 *    plain parse → truncation repair → strip code fences → extract the first
 *    balanced object out of surrounding prose, then parse/repair that.
 *
 * 3. scavengeToolCalls — recover calls a weak model wrote into the TEXT
 *    channel instead of the structured tool_calls field (```json fences,
 *    <tool_call> tags, bare balanced JSON). Safety gates mirror dirge: a
 *    candidate is dispatched only when its name is one of the ALLOWED tools
 *    (repair never invents a name); explicit call regions are cut out of the
 *    raw scan's input so one call cannot be counted twice; a max-calls cap
 *    and a 100KB input ceiling bound the work.
 */

export type TruncationRepairResult = {
  repaired: string;
  changed: boolean;
  notes: string[];
  /** true when every attempt failed and the result is the hard fallback "{}". */
  fallback: boolean;
};

/** Stack-based closer for max_tokens-truncated JSON argument strings. */
export function repairTruncatedJson(input: string): TruncationRepairResult {
  if (input.trim() === "") {
    return { repaired: "{}", changed: input !== "{}", notes: [], fallback: false };
  }
  try {
    JSON.parse(input);
    return { repaired: input, changed: false, notes: [], fallback: false };
  } catch {
    // fall through to repair
  }

  // Single pass tracking open { / [ / " — `"` rides the stack so the EOF
  // flush can close an unterminated string; escapes are tracked so a quoted
  // brace never confuses the depth.
  const stack: string[] = [];
  let escaped = false;
  let inString = false;
  let lastSignificant = -1;
  for (let i = 0; i < input.length; i += 1) {
    const c = input[i]!;
    if (!/\s/.test(c)) {
      lastSignificant = i;
    }
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString) {
      if (c === "\\") {
        escaped = true;
      } else if (c === '"') {
        inString = false;
        if (stack[stack.length - 1] === '"') {
          stack.pop();
        }
      }
      continue;
    }
    if (c === '"') {
      inString = true;
      stack.push('"');
    } else if (c === "{" || c === "[") {
      stack.push(c);
    } else if (c === "}" || c === "]") {
      const top = stack[stack.length - 1];
      if ((top === "{" && c === "}") || (top === "[" && c === "]")) {
        stack.pop();
      }
      // A stray closer without a matching open is left untouched — the final
      // parse rejects it and the fallback covers that case.
    }
  }

  const notes: string[] = [];
  let s = lastSignificant >= 0 ? input.slice(0, lastSignificant + 1) : input;

  if (s.endsWith(",")) {
    s = s.slice(0, -1);
    notes.push("trimmed trailing comma");
  }
  if (endsWithDanglingKey(s)) {
    s += " null";
    notes.push("filled dangling key with null");
  }
  if (inString) {
    s += '"';
    if (stack[stack.length - 1] === '"') {
      stack.pop();
    }
    notes.push("closed unterminated string");
  }
  while (stack.length > 0) {
    const top = stack.pop();
    if (top === "{") {
      s += "}";
    } else if (top === "[") {
      s += "]";
    } else if (top === '"') {
      s += '"';
    }
  }

  try {
    JSON.parse(s);
    return { repaired: s, changed: s !== input, notes, fallback: false };
  } catch {
    // Closer exhausted — hard fallback. Keep a bounded preview for auditing.
    const preview = input.length <= 500 ? input : `${input.slice(0, 500)} …[+${input.length - 500} chars]`;
    return {
      repaired: "{}",
      changed: true,
      notes: ["fallback to {}", `unrecoverable truncation — original args preview: ${preview}`],
      fallback: true,
    };
  }
}

function endsWithDanglingKey(s: string): boolean {
  let i = s.length;
  while (i > 0 && /\s/.test(s[i - 1]!)) {
    i -= 1;
  }
  if (i === 0 || s[i - 1] !== ":") {
    return false;
  }
  i -= 1;
  while (i > 0 && /\s/.test(s[i - 1]!)) {
    i -= 1;
  }
  return i > 0 && s[i - 1] === '"';
}

/** Strip a surrounding markdown code fence (```json … ``` / ``` … ```). */
function stripCodeFence(text: string): string | null {
  const match = /^\s*```(?:json|tool)?\s*\n([\s\S]*?)\n?```\s*$/.exec(text);
  return match ? match[1]! : null;
}

/**
 * Yield balanced JSON object substrings from prose. Hand-rolled scanner
 * (string-aware, escape-aware); an unmatched open brace is skipped past so a
 * pathological input cannot go quadratic.
 */
export function iterateJsonObjects(text: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] !== "{") {
      i += 1;
      continue;
    }
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let j = i; j < text.length; j += 1) {
      const c = text[j]!;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (inString) {
        if (c === "\\") {
          escaped = true;
        } else if (c === '"') {
          inString = false;
        }
        continue;
      }
      if (c === '"') {
        inString = true;
      } else if (c === "{") {
        depth += 1;
      } else if (c === "}") {
        depth -= 1;
        if (depth === 0) {
          out.push(text.slice(i, j + 1));
          i = j;
          break;
        }
      }
    }
    i += 1;
  }
  return out;
}

export type LenientParseResult =
  | { ok: true; args: Record<string, unknown>; repairedNotes: string[] }
  | { ok: false; error: string };

/**
 * Repair chain for one tool-call argument string:
 * plain parse → truncation repair → fence strip → balanced-object extraction
 * out of surrounding prose (then parse/repair that). Never throws.
 */
export function lenientParseToolArguments(raw: string): LenientParseResult {
  if (!raw) {
    return { ok: true, args: {}, repairedNotes: [] };
  }
  // 1. Plain parse.
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { ok: true, args: parsed as Record<string, unknown>, repairedNotes: [] };
    }
    return { ok: false, error: "Tool arguments must be a JSON object." };
  } catch {
    // fall through
  }

  // 2. Truncation repair.
  // 2. Truncation repair. A hard fallback ("{}") means the closer gave up —
  // the original args were NOT a truncation shape, so continue down the chain
  // (fence / prose extraction) instead of accepting an empty object.
  const truncation = repairTruncatedJson(raw);
  if (!truncation.fallback) {
    try {
      const parsed = JSON.parse(truncation.repaired);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return {
          ok: true,
          args: parsed as Record<string, unknown>,
          repairedNotes: truncation.notes,
        };
      }
    } catch {
      // fall through
    }
  }

  // 3. Fence strip.
  const fenced = stripCodeFence(raw.trim());
  if (fenced) {
    try {
      const parsed = JSON.parse(fenced);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return {
          ok: true,
          args: parsed as Record<string, unknown>,
          repairedNotes: ["stripped surrounding markdown code fence"],
        };
      }
    } catch {
      // fall through
    }
  }

  // 4. First balanced object out of surrounding prose ("Here are the args: {…}").
  const candidates = iterateJsonObjects(raw);
  for (const candidate of candidates) {
    let text = candidate;
    let notes: string[] = ["extracted JSON object from surrounding text"];
    try {
      JSON.parse(text);
    } catch {
      const inner = repairTruncatedJson(text);
      if (inner.fallback) {
        continue;
      }
      text = inner.repaired;
      notes = [...notes, ...inner.notes];
    }
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return { ok: true, args: parsed as Record<string, unknown>, repairedNotes: notes };
      }
    } catch {
      // try next candidate
    }
  }

  return {
    ok: false,
    error: `Failed to parse tool arguments (plain/truncation/fence/prose extraction all failed). First 200 chars: ${raw.slice(0, 200)}`,
  };
}

// ── Scavenge: text-channel tool-call recovery ────────────────────────────────

export type ScavengedToolCall = {
  name: string;
  arguments: string;
};

export type ScavengeResult = {
  calls: ScavengedToolCall[];
  notes: string[];
  unknownNames: string[];
};

/** Ceiling on scavenge input — bounds the scan against regex blowups. */
const MAX_SCAVENGE_INPUT = 100 * 1024;
/** Default cap on accepted calls per pass. */
const DEFAULT_MAX_CALLS = 4;
/** Cap on recorded unknown names per pass. */
const MAX_UNKNOWN_NAMES = 8;

type CallRegion = { body: string; kind: "tagged" | "fenced" };

/** Find explicit call regions: <tool_call> tags and ```json / ```tool fences. */
function findCallRegions(text: string): CallRegion[] {
  const regions: CallRegion[] = [];
  const tagRe = /<tool_call>([\s\S]*?)<\/tool_call>/g;
  for (const m of text.matchAll(tagRe)) {
    if (m[1] !== undefined) {
      regions.push({ body: m[1], kind: "tagged" });
    }
  }
  const fenceRe = /```(?:json|tool)\s*\n([\s\S]*?)\n?```/g;
  for (const m of text.matchAll(fenceRe)) {
    if (m[1] !== undefined) {
      regions.push({ body: m[1], kind: "fenced" });
    }
  }
  return regions;
}

function parseScavengeJson(candidate: string): Record<string, unknown> | null {
  const text = candidate.trim();
  if (!text) {
    return null;
  }
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    const repaired = repairTruncatedJson(text);
    if (repaired.fallback) {
      return null;
    }
    try {
      const parsed = JSON.parse(repaired.repaired);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
}

/** Read a tool name + args from the three shapes weak models emit. */
function coerceToToolCall(candidate: string, allowed: ReadonlySet<string>): ScavengedToolCall | null {
  const obj = parseScavengeJson(candidate);
  if (!obj) {
    return null;
  }
  const direct = typeof obj.name === "string" ? obj.name : typeof obj.tool_name === "string" ? obj.tool_name : null;
  const nested =
    obj.type === "function" &&
    obj.function &&
    typeof obj.function === "object" &&
    typeof (obj.function as Record<string, unknown>).name === "string"
      ? ((obj.function as Record<string, unknown>).name as string)
      : null;
  const name = direct ?? nested;
  if (!name || !allowed.has(name)) {
    return null;
  }
  let args = "";
  if (typeof obj.arguments === "string") {
    args = obj.arguments;
  } else if (obj.arguments && typeof obj.arguments === "object") {
    args = JSON.stringify(obj.arguments);
  } else if (obj.tool_args && typeof obj.tool_args === "object") {
    args = JSON.stringify(obj.tool_args);
  } else if (typeof obj.tool_args === "string") {
    args = obj.tool_args;
  }
  return { name, arguments: args };
}

/**
 * Recover tool calls written into the text channel. Explicit regions (tags /
 * fences) run first and are CUT OUT of the raw scan's input so one call is
 * never counted twice. A candidate is dispatched only when its name is one of
 * `allowedToolNames` — repair never invents a name and the gate never widens
 * past tools that exist.
 */
export function scavengeToolCalls(
  text: string | null | undefined,
  allowedToolNames: ReadonlySet<string>,
  maxCalls = DEFAULT_MAX_CALLS
): ScavengeResult {
  if (!text || text.length === 0 || allowedToolNames.size === 0) {
    return { calls: [], notes: [], unknownNames: [] };
  }
  if (text.length > MAX_SCAVENGE_INPUT) {
    return {
      calls: [],
      notes: [`scavenge skipped: text too large (${text.length} chars)`],
      unknownNames: [],
    };
  }

  const cap = maxCalls > 0 ? maxCalls : DEFAULT_MAX_CALLS;
  const notes: string[] = [];
  const calls: ScavengedToolCall[] = [];
  const unknownNames: string[] = [];

  // Pattern B first: explicit regions, then cut them out of the raw scan.
  let remainder = text;
  for (const region of findCallRegions(text)) {
    if (calls.length >= cap) {
      break;
    }
    const body = region.body.trim();
    if (!body) {
      continue;
    }
    const coerced = coerceToToolCall(body, allowedToolNames);
    if (coerced) {
      notes.push(`scavenged ${region.kind} call: ${coerced.name}`);
      calls.push(coerced);
    } else {
      const parsed = parseScavengeJson(body);
      const named =
        parsed &&
        (typeof parsed.name === "string" ||
          typeof parsed.tool_name === "string" ||
          (parsed.function && typeof (parsed.function as Record<string, unknown>).name === "string"));
      if (named && unknownNames.length < MAX_UNKNOWN_NAMES) {
        const n =
          typeof parsed!.name === "string"
            ? parsed!.name
            : typeof parsed!.tool_name === "string"
              ? parsed!.tool_name
              : (parsed!.function as Record<string, unknown>).name;
        unknownNames.push(String(n));
      }
    }
    remainder = remainder.replace(region.kind === "tagged" ? `<tool_call>${region.body}</tool_call>` : region.body, "");
  }

  // Pattern C: bare balanced JSON objects in the remainder.
  if (calls.length < cap) {
    for (const candidate of iterateJsonObjects(remainder)) {
      if (calls.length >= cap) {
        break;
      }
      const coerced = coerceToToolCall(candidate, allowedToolNames);
      if (coerced) {
        notes.push(`scavenged call: ${coerced.name}`);
        calls.push(coerced);
      }
    }
  }

  return { calls, notes, unknownNames };
}
