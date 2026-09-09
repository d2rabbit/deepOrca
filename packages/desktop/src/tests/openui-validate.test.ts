/**
 * Local OpenUI Lang validator (main tools/a2ui/openui-validate.ts) — the
 * verification signal of the self-recursive validation loop (user ask
 * 2026-09-09). Pins:
 *   - the canonical single-app example parses VALID against the official
 *     schema (the loop must not reject the format it itself teaches),
 *   - schema errors (unknown-component), wiring errors (unresolved /
 *     orphaned) each surface as structured findings,
 *   - the feedback formatter turns findings into per-issue patch lines.
 * Schema freshness is pinned separately in openui-prompt.test.ts.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { formatOpenuiFeedback, validateOpenuiCode } from "../main/tools/a2ui/openui-validate";

const CANONICAL = [
  '$page = "home"',
  'root = Stack([nav, $page == "home" ? homeView : ordersView])',
  'nav = Stack([Button("首页", Action([@Set($page, "home")])), Button("订单", Action([@Set($page, "orders")]))], "row")',
  'homeView = Card([CardHeader("概览"), TextContent("今日订单 128", "large-heavy")])',
  'ordersView = Card([CardHeader("订单列表"), TextContent("筛选：全部", "small")])',
].join("\n");

test("validate: the canonical single-app example is valid", () => {
  const verdict = validateOpenuiCode(CANONICAL);
  assert.equal(verdict.valid, true, JSON.stringify(verdict));
  assert.equal(verdict.incomplete, false);
  assert.equal(verdict.statementCount, 5);
  assert.deepEqual(verdict.errors, []);
  assert.deepEqual(verdict.unresolved, []);
  assert.deepEqual(verdict.orphaned, []);
});

test("validate: unknown component surfaces as a schema error", () => {
  const verdict = validateOpenuiCode("root = Fakebox([])");
  assert.equal(verdict.valid, false);
  assert.equal(verdict.errors.length, 1);
  assert.equal(verdict.errors[0].code, "unknown-component");
  assert.equal(verdict.errors[0].component, "Fakebox");
});

test("validate: a used-but-undefined reference lands in unresolved (wiring)", () => {
  const verdict = validateOpenuiCode("root = Stack([missing])");
  assert.equal(verdict.valid, false);
  assert.deepEqual(verdict.unresolved, ["missing"]);
});

test("validate: a defined-but-unattached view lands in orphaned (wiring)", () => {
  const verdict = validateOpenuiCode(`${CANONICAL}\nlonely = Card([TextContent("x")])`);
  assert.equal(verdict.valid, false);
  assert.deepEqual(verdict.orphaned, ["lonely"]);
});

test("formatOpenuiFeedback renders one patch instruction per finding", () => {
  const verdict = validateOpenuiCode(`${CANONICAL}\nlonely = Card([TextContent("x")])`);
  const feedback = formatOpenuiFeedback(verdict);
  assert.match(feedback, /unattached-definition: 'lonely'/);
  assert.match(feedback, /mount it in the rendered tree, or remove it/);
});
