import { test } from "node:test";
import assert from "node:assert/strict";
import {
  lenientParseToolArguments,
  repairTruncatedJson,
  scavengeToolCalls,
  iterateJsonObjects,
} from "../common/tool-call-repair";

// ---------------------------------------------------------------------------
// repairTruncatedJson — the four max_tokens truncation shapes.
// ---------------------------------------------------------------------------

test("repairTruncatedJson: already-parseable fast path is untouched", () => {
  const r = repairTruncatedJson('{"file_path":"a.ts","content":"x"}');
  assert.equal(r.changed, false);
  assert.deepEqual(r.notes, []);
  assert.equal(r.fallback, false);
});

test("repairTruncatedJson: closes an unterminated string", () => {
  const r = repairTruncatedJson('{"content":"hello wor');
  assert.equal(r.fallback, false);
  assert.deepEqual(JSON.parse(r.repaired), { content: "hello wor" });
  assert.ok(r.notes.includes("closed unterminated string"));
});

test("repairTruncatedJson: fills a dangling key with null", () => {
  const r = repairTruncatedJson('{"file_path":"a.ts","content":');
  assert.equal(r.fallback, false);
  assert.deepEqual(JSON.parse(r.repaired), { file_path: "a.ts", content: null });
  assert.ok(r.notes.some((n) => n.includes("dangling key")));
});

test("repairTruncatedJson: pops open braces in reverse order", () => {
  const r = repairTruncatedJson('{"outer":{"list":[1,2,{"deep":"still');
  assert.equal(r.fallback, false);
  const parsed = JSON.parse(r.repaired) as { outer: { list: unknown[] } };
  assert.deepEqual(parsed.outer.list[2], { deep: "still" });
});

test("repairTruncatedJson: trims a trailing comma", () => {
  const r = repairTruncatedJson('{"a":1,');
  assert.equal(r.fallback, false);
  assert.deepEqual(JSON.parse(r.repaired), { a: 1 });
  assert.ok(r.notes.includes("trimmed trailing comma"));
});

test("repairTruncatedJson: quoted braces never confuse the depth", () => {
  const r = repairTruncatedJson('{"code":"if (a) { return }');
  assert.equal(r.fallback, false);
  const parsed = JSON.parse(r.repaired) as { code: string };
  assert.equal(parsed.code, "if (a) { return }");
});

test("repairTruncatedJson: hard fallback {} when unrecoverable", () => {
  const r = repairTruncatedJson("}}}}");
  assert.equal(r.fallback, true);
  assert.deepEqual(JSON.parse(r.repaired), {});
});

test("repairTruncatedJson: empty input becomes {}", () => {
  const r = repairTruncatedJson("   ");
  assert.deepEqual(JSON.parse(r.repaired), {});
});

// ---------------------------------------------------------------------------
// lenientParseToolArguments — the structured-channel repair chain.
// ---------------------------------------------------------------------------

test("lenientParse: plain JSON passes with no notes", () => {
  const r = lenientParseToolArguments('{"x":1}');
  assert.ok(r.ok);
  if (r.ok) {
    assert.deepEqual(r.args, { x: 1 });
    assert.deepEqual(r.repairedNotes, []);
  }
});

test("lenientParse: truncated args are repaired and noted", () => {
  const r = lenientParseToolArguments('{"command":"git status","cwd":"/tmp');
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.args.command, "git status");
    assert.ok(r.repairedNotes.length > 0);
  }
});

test("lenientParse: markdown-fenced args are unwrapped", () => {
  const raw = '```json\n{"file_path":"a.ts"}\n```';
  const r = lenientParseToolArguments(raw);
  assert.ok(r.ok);
  if (r.ok) {
    assert.deepEqual(r.args, { file_path: "a.ts" });
    assert.ok(r.repairedNotes.some((n) => n.includes("fence")));
  }
});

test("lenientParse: JSON wrapped in leading prose is extracted", () => {
  const raw = 'Sure, here are the arguments:\n{"pattern":"TODO","path":"src/"}\nLet me know!';
  const r = lenientParseToolArguments(raw);
  assert.ok(r.ok);
  if (r.ok) {
    assert.deepEqual(r.args, { pattern: "TODO", path: "src/" });
    assert.ok(r.repairedNotes.some((n) => n.includes("surrounding text")));
  }
});

test("lenientParse: non-object JSON is rejected, not coerced", () => {
  const r = lenientParseToolArguments("[1,2,3]");
  assert.ok(!r.ok);
});

test("lenientParse: garbage reports the bounded preview error", () => {
  const r = lenientParseToolArguments("not json at all {{{");
  assert.ok(!r.ok);
  if (!r.ok) {
    assert.ok(r.error.includes("First 200 chars"));
  }
});

// ---------------------------------------------------------------------------
// iterateJsonObjects — balanced-object scanner.
// ---------------------------------------------------------------------------

test("iterateJsonObjects: finds nested balanced objects, skips unmatched", () => {
  const text = 'prose {"a":{"b":1}} more {"c":2} dangling {"oops';
  const found = iterateJsonObjects(text);
  assert.deepEqual(found, ['{"a":{"b":1}}', '{"c":2}']);
});

// ---------------------------------------------------------------------------
// scavengeToolCalls — text-channel recovery with the name gate.
// ---------------------------------------------------------------------------

const ALLOWED = new Set(["bash", "read", "edit"]);

test("scavenge: <tool_call> tag with OpenAI shape is recovered", () => {
  const text = 'I will run that now.\n<tool_call>{"name":"bash","arguments":{"command":"ls -la"}}</tool_call>';
  const r = scavengeToolCalls(text, ALLOWED);
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0]!.name, "bash");
  assert.deepEqual(JSON.parse(r.calls[0]!.arguments), { command: "ls -la" });
});

test("scavenge: ```json fence with {name, arguments} shape is recovered", () => {
  const text = '```json\n{"name": "read", "arguments": {"file_path": "a.ts"}}\n```';
  const r = scavengeToolCalls(text, ALLOWED);
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0]!.name, "read");
});

test("scavenge: truncated call inside an explicit tag is closed (tag bounds enable repair)", () => {
  const text = '<tool_call>{"name":"edit","arguments":{"file_path":"a.ts","old":"x</tool_call>';
  const r = scavengeToolCalls(text, ALLOWED);
  assert.equal(r.calls.length, 1);
  const args = JSON.parse(r.calls[0]!.arguments) as Record<string, unknown>;
  assert.equal(args.file_path, "a.ts");
});

test("scavenge: bare balanced JSON with a dispatchable name is recovered", () => {
  const text = 'Let me check: {"name":"bash","arguments":{"command":"pwd"}} that should work.';
  const r = scavengeToolCalls(text, ALLOWED);
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0]!.name, "bash");
});

test("scavenge: invented tool names are NEVER dispatched (the name gate)", () => {
  const text = '<tool_call>{"name":"delete_everything","arguments":{}}</tool_call>';
  const r = scavengeToolCalls(text, ALLOWED);
  assert.equal(r.calls.length, 0);
  assert.ok(r.unknownNames.includes("delete_everything"));
});

test("scavenge: explicit region is not double-counted by the raw scan", () => {
  const text =
    '<tool_call>{"name":"bash","arguments":{"command":"ls"}}</tool_call> then {"name":"read","arguments":{"file_path":"b.ts"}}';
  const r = scavengeToolCalls(text, ALLOWED);
  assert.equal(r.calls.length, 2);
  assert.deepEqual(
    r.calls.map((c) => c.name),
    ["bash", "read"]
  );
});

test("scavenge: max-calls cap bounds runaway extraction", () => {
  const text = Array.from({ length: 10 }, (_, i) => `{"name":"bash","arguments":{"command":"echo ${i}"}}`).join(" ");
  const r = scavengeToolCalls(text, ALLOWED);
  assert.equal(r.calls.length, 4);
});

test("scavenge: oversized input is skipped, not scanned", () => {
  const big = "x".repeat(100 * 1024 + 1);
  const r = scavengeToolCalls(big, ALLOWED);
  assert.equal(r.calls.length, 0);
  assert.ok(r.notes.some((n) => n.includes("too large")));
});

test("scavenge: empty allowed set is a no-op (gate never widens)", () => {
  const r = scavengeToolCalls('{"name":"bash","arguments":{}}', new Set());
  assert.equal(r.calls.length, 0);
});

test("scavenge: {tool_name, tool_args} free-form variant is recognized", () => {
  const text = '{"tool_name":"read","tool_args":{"file_path":"x.md"}}';
  const r = scavengeToolCalls(text, ALLOWED);
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0]!.name, "read");
});

test("scavenge: nested OpenAI function shape is recognized", () => {
  const text = '{"type":"function","function":{"name":"edit","arguments":{"file_path":"y.ts"}}}';
  const r = scavengeToolCalls(text, ALLOWED);
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0]!.name, "edit");
});
