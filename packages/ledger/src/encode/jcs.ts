// JCS (RFC 8785) subset canonical JSON serializer.
//
// The Coord Chain signs every record/commit/block over canonical bytes, so the
// encoding must be deterministic across machines and versions. We deliberately
// implement a *subset* of RFC 8785 and REJECT anything outside it instead of
// best-effort canonicalizing: strings must be valid Unicode (no lone
// surrogates), numbers must be finite (non-integer doubles use the ES6
// shortest round-trip form, matching RFC 8785 §3.2.2.3), object keys sort by
// UTF-16 code units, no insignificant whitespace. `parseCanonicalJson` is the
// fail-closed reader used wherever the input is supposed to already be
// canonical bytes — it round-trips the parsed value and refuses non-canonical
// text (duplicate keys, "1.0", unordered keys) rather than silently accepting.

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export class JcsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JcsError";
  }
}

/** Canonical JSON text per the RFC 8785 subset described above. */
export function jcsStringify(value: JsonValue): string {
  return serialize(value);
}

/** Canonical bytes (UTF-8 of the canonical text) — what signatures hash over. */
export function jcsBytes(value: JsonValue): Uint8Array {
  return new TextEncoder().encode(jcsStringify(value));
}

/**
 * Parse text that is REQUIRED to already be canonical. Anything that would not
 * re-serialize to the exact same text is rejected (JcsError or SyntaxError).
 */
export function parseCanonicalJson(text: string): JsonValue {
  const value = JSON.parse(text) as JsonValue;
  if (jcsStringify(value) !== text) {
    throw new JcsError("input is not canonical JSON (RFC 8785 subset)");
  }
  return value;
}

function serialize(value: JsonValue): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "[" + value.map((item) => serialize(item)).join(",") + "]";
  }
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "string":
      return serializeString(value);
    case "number":
      return serializeNumber(value);
    case "object": {
      const record = value as { [key: string]: JsonValue };
      const keys = Object.keys(record).sort();
      return "{" + keys.map((key) => serializeString(key) + ":" + serialize(record[key])).join(",") + "}";
    }
    default:
      throw new JcsError(`unsupported JSON value: ${String(value)}`);
  }
}

function serializeNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new JcsError("JCS number must be finite (got NaN/Infinity)");
  }
  // RFC 8785: IEEE-754 negative zero serializes as "0".
  const normalized = Object.is(value, -0) ? 0 : value;
  // String() is the ES6 Number::toString shortest round-trip form, which is
  // exactly what RFC 8785 mandates (including exponent forms like "1e+21").
  return String(normalized);
}

function serializeString(value: string): string {
  if (hasLoneSurrogate(value)) {
    throw new JcsError("JCS string contains a lone surrogate (invalid Unicode)");
  }
  // JSON.stringify's escaping (quote, backslash, control chars) matches the
  // RFC 8785 escaping set exactly; everything ≥ U+0020 stays literal.
  return JSON.stringify(value);
}

function hasLoneSurrogate(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = i + 1 < value.length ? value.charCodeAt(i + 1) : 0;
      if (next < 0xdc00 || next > 0xdfff) {
        return true;
      }
      i++;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}
