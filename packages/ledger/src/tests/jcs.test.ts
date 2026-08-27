import assert from "node:assert/strict";
import { test } from "node:test";
import { JcsError, jcsBytes, jcsStringify, parseCanonicalJson } from "../encode/jcs.js";
import { base32LowerNoPad } from "../encode/base32.js";

test("jcs: object keys sort by code unit, nested structures serialize without whitespace", () => {
  assert.equal(jcsStringify({ b: 1, a: 2 }), '{"a":2,"b":1}');
  assert.equal(jcsStringify({ z: [1, { c: true, a: null }], a: "x" }), '{"a":"x","z":[1,{"a":null,"c":true}]}');
});

test("jcs: strings use minimal JSON escaping", () => {
  assert.equal(
    jcsStringify('quote " backslash \\ newline \n tab \t'),
    '"quote \\" backslash \\\\ newline \\n tab \\t"'
  );
  // Valid non-ASCII (incl. emoji) stays literal; only control chars escape.
  assert.equal(jcsStringify("中文 emoji \u{1F600}"), '"中文 emoji 😀"');
});

test("jcs: numbers follow ES6 shortest form; -0 becomes 0; non-finite rejected", () => {
  assert.equal(jcsStringify(-0), "0");
  assert.equal(jcsStringify(9007199254740991), "9007199254740991");
  assert.equal(jcsStringify(1e21), "1e+21");
  assert.equal(jcsStringify(0.1), "0.1");
  assert.throws(() => jcsStringify(Number.NaN), JcsError);
  assert.throws(() => jcsStringify(Number.POSITIVE_INFINITY), JcsError);
});

test("jcs: lone surrogates rejected", () => {
  assert.throws(() => jcsStringify("\ud800"), JcsError);
  assert.throws(() => jcsStringify("tail\udfff"), JcsError);
  assert.doesNotThrow(() => jcsStringify("\ud83d\ude00"));
});

test("jcs: parseCanonicalJson accepts canonical text and rejects non-canonical forms", () => {
  assert.deepEqual(parseCanonicalJson('{"a":1,"b":[true,null]}'), { a: 1, b: [true, null] });
  // unordered keys
  assert.throws(() => parseCanonicalJson('{"b":1,"a":2}'), JcsError);
  // 1.0 is not the canonical form of the number 1
  assert.throws(() => parseCanonicalJson('{"a":1.0}'), JcsError);
  // duplicate keys collapse on JSON.parse and fail the round-trip
  assert.throws(() => parseCanonicalJson('{"a":1,"a":2}'), JcsError);
  // whitespace is not canonical
  assert.throws(() => parseCanonicalJson('{"a": 1}'), JcsError);
});

test("jcs: bytes are deterministic UTF-8 of the canonical text", () => {
  const value = { k: "值", n: 42 };
  assert.deepEqual(jcsBytes(value), jcsBytes({ n: 42, k: "值" }));
  assert.equal(new TextDecoder().decode(jcsBytes(value)), '{"k":"值","n":42}');
});

test("base32: RFC 4648 lowercase, no padding", () => {
  assert.equal(base32LowerNoPad(new Uint8Array([0x00])), "aa");
  assert.equal(base32LowerNoPad(new Uint8Array([0xff])), "74");
  assert.equal(base32LowerNoPad(new TextEncoder().encode("foo")), "mzxw6");
  assert.equal(base32LowerNoPad(new Uint8Array(0)), "");
});
