import { test } from "node:test";
import assert from "node:assert/strict";
import { extractOpenuiFence } from "../renderer/openui/inline-extract";

test("extracts a complete openui-lang fence from assistant text", () => {
  const block = extractOpenuiFence("Here is the prototype:\n```openui-lang\nroot = Column([title])\n```\nDone!");
  assert.deepEqual(block, { code: "root = Column([title])", complete: true });
});

test("reports an unclosed fence as incomplete (streaming)", () => {
  const block = extractOpenuiFence("```openui-lang\nroot = Column([ti");
  assert.deepEqual(block, { code: "root = Column([ti", complete: false });
});

test("uses the LAST fence when several blocks are embedded", () => {
  const text = "```openui-lang\nroot = Stack([])\n```\nsecond attempt:\n```openui-lang\nroot = Row([])\n```";
  assert.deepEqual(extractOpenuiFence(text), { code: "root = Row([])", complete: true });
});

test("returns null for text without an openui-lang fence", () => {
  assert.equal(extractOpenuiFence("```ts\nconst x = 1;\n```"), null);
  assert.equal(extractOpenuiFence(""), null);
  assert.equal(extractOpenuiFence("plain reply"), null);
});
