// specs/model-vendor-profiles P3.1 后半 — 受限表达式 DSL（option-map）单测。
// 语义基准：调研报告 D9.3 表达力边界 + D9.5 ZCode 实测词汇表。
import { test } from "node:test";
import assert from "node:assert/strict";
import { compileOptionMap, RestrictedCelError } from "../common/option-map";

test("literals, input passthrough and ternary evaluate to object patches", () => {
  const program = compileOptionMap(
    `input == "disabled" ? {"thinking": {"type": "disabled"}} : {"thinking": {"type": "enabled"}, "effort": input}`
  );
  assert.deepEqual(program.evaluate("disabled"), { thinking: { type: "disabled" } });
  assert.deepEqual(program.evaluate("high"), { thinking: { type: "enabled" }, effort: "high" });
});

test("arithmetic, comparison, logic, modulo and unary operators", () => {
  assert.deepEqual(compileOptionMap(`{"n": 1 + 2 * 3 - 4 / 2, "m": 7 % 4}`).evaluate(0), { n: 5, m: 3 });
  assert.deepEqual(compileOptionMap(`{"lt": 1 < 2, "le": 2 <= 2, "gt": 3 > 4, "ge": 3 >= 4}`).evaluate(0), {
    lt: true,
    le: true,
    gt: false,
    ge: false,
  });
  assert.deepEqual(
    compileOptionMap(`{"and": input > 0 && input < 10, "or": input == "x" || input == "y"}`).evaluate(5),
    {
      and: true,
      or: false,
    }
  );
  assert.deepEqual(compileOptionMap(`{"neg": -input, "not": !true, "plus": +input}`).evaluate(3), {
    neg: -3,
    not: false,
    plus: 3,
  });
});

test("string concatenation with + (string and scalar mix)", () => {
  const program = compileOptionMap(`{"v": "level-" + input}`);
  assert.deepEqual(program.evaluate("high"), { v: "level-high" });
  assert.deepEqual(program.evaluate(3), { v: "level-3" });
});

test("arrays and nested objects pass through as JSON", () => {
  const program = compileOptionMap(`{"list": [1, "two", true, null, {"k": input}]}`);
  assert.deepEqual(program.evaluate("v"), { list: [1, "two", true, null, { k: "v" }] });
});

test("assertObjectResult: a scalar branch at the ROOT fails at COMPILE time", () => {
  assert.throws(
    () => compileOptionMap(`input == "a" ? {"ok": true} : "nope"`),
    (error: unknown) => error instanceof RestrictedCelError && /object/.test(error.message)
  );
  assert.throws(
    () => compileOptionMap(`input == "a" ? {"ok": true} : [1, 2]`),
    (error: unknown) => error instanceof RestrictedCelError
  );
  // 但对象字面量**值位置**上的三元可以产标量——结果整体仍是对象（ZCode
  // 语义：校验的是结果形状，不是每个子值的形状）。
  const program = compileOptionMap(`{"effort": input == "low" ? "low" : "high"}`);
  assert.deepEqual(program.evaluate("low"), { effort: "low" });
});

test("expressiveness boundary: property access, calls and unknown identifiers are rejected", () => {
  assert.throws(() => compileOptionMap(`{"a": input.foo}`), RestrictedCelError);
  assert.throws(() => compileOptionMap(`{"a": size(input)}`), RestrictedCelError);
  assert.throws(
    () => compileOptionMap(`{"a": model}`),
    (error: unknown) => {
      assert.ok(error instanceof RestrictedCelError);
      assert.match(error.message, /only 'input'/);
      return true;
    }
  );
});

test("unterminated string and empty expression throw with offsets", () => {
  assert.throws(() => compileOptionMap(`{"a": "open`), RestrictedCelError);
  assert.throws(() => compileOptionMap(``), RestrictedCelError);
});

test("compile memoization: same source returns the same program instance", () => {
  const source = `{"thinking": {"type": input == "disabled" ? "disabled" : "enabled"}}`;
  assert.equal(compileOptionMap(source), compileOptionMap(source));
});

test("evaluate results are deeply frozen", () => {
  const program = compileOptionMap(`{"thinking": {"type": "enabled"}}`);
  const value = program.evaluate("high") as { thinking: { type: string } };
  assert.throws(() => {
    (value as unknown as Record<string, unknown>).thinking = "x";
  });
});

test("ZCode glm four-spelling map (D9.5 原型) evaluates the full shape", () => {
  const glmMap =
    "{" +
    '"thinking": {"type": input == "disabled" || input == "none" ? "disabled" : "enabled"},' +
    '"enable_thinking": input != "disabled" && input != "none",' +
    '"reasoning_effort": input == "disabled" ? "none" : input == "enabled" ? "high" : input,' +
    '"reasoning": {"effort": input == "disabled" ? "none" : input == "enabled" ? "high" : input}' +
    "}";
  const program = compileOptionMap(glmMap);
  assert.deepEqual(program.evaluate("disabled"), {
    thinking: { type: "disabled" },
    enable_thinking: false,
    reasoning_effort: "none",
    reasoning: { effort: "none" },
  });
  assert.deepEqual(program.evaluate("enabled"), {
    thinking: { type: "enabled" },
    enable_thinking: true,
    reasoning_effort: "high",
    reasoning: { effort: "high" },
  });
  assert.deepEqual(program.evaluate("max"), {
    thinking: { type: "enabled" },
    enable_thinking: true,
    reasoning_effort: "max",
    reasoning: { effort: "max" },
  });
});
