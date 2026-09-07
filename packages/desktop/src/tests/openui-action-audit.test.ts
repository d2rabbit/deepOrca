/**
 * Unit tests for the bare-string Button action audit
 * (renderer/openui/action-audit.ts, M3 double-review follow-up).
 *
 * Regression anchor: a plain string in Button's second `ActionExpression`
 * slot compiles (upstream z.any()) but throws at click time with no surface
 * feedback. The audit must flag exactly that shape — literals and
 * literal-ternaries — without false-positiving legitimate authoring:
 * Action([...]) expressions, variable references, omitted arguments,
 * third-position enum strings, Button( inside string literals, and
 * word-boundary look-alikes (MyButton(/Buttons().
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { auditButtonActions, DEAD_BUTTON_ACTION_CODE } from "../renderer/openui/action-audit";

test("flags a bare-string action as a dead button", () => {
  const findings = auditButtonActions('root = Stack([Button("保存", "save_form")])');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, DEAD_BUTTON_ACTION_CODE);
  assert.match(findings[0].message, /"save_form"/);
  assert.match(findings[0].message, /Action\(\[@ToAssistant\("save_form"\)\]\)/);
});

test("flags a ternary of two string literals (localized dead button)", () => {
  const findings = auditButtonActions('btn = Button("Go", $open ? "close" : "open")');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, DEAD_BUTTON_ACTION_CODE);
});

test("does not flag legitimate authoring", () => {
  assert.equal(auditButtonActions('btn = Button("View", Action([@OpenUrl("https://x.dev")]))').length, 0);
  assert.equal(auditButtonActions('btn = Button("Go", onSubmit)').length, 0, "variable reference");
  assert.equal(auditButtonActions('btn = Button("Go")').length, 0, "omitted → auto @ToAssistant");
  assert.equal(auditButtonActions('btn = Button("Go", Action([@Set($x, 1)]), "primary")').length, 0);
  assert.equal(
    auditButtonActions('btn = Button($done ? "Close" : "Reopen", Action([@Set($done, !$done)]))').length,
    0,
    "ternary label with a real action"
  );
});

test("third-position enum strings are not mistaken for the action slot", () => {
  // variant/type/size live at positions 3+, only position 2 is ActionExpression.
  assert.equal(
    auditButtonActions('btn = Button("Delete", Action([@Set($x, 1)]), "destructive", "normal", "large")').length,
    0
  );
});

test("string literals and word boundaries do not produce phantom findings", () => {
  assert.equal(
    auditButtonActions('hint = TextContent("the Button( helper renders buttons")').length,
    0,
    "Button( inside a string literal"
  );
  assert.equal(auditButtonActions('a = MyButton("x", "y")').length, 0, "word boundary");
  assert.equal(auditButtonActions("a = Buttons([btn1, btn2])").length, 0, "Buttons( is a different component");
  assert.equal(
    auditButtonActions('note = MarkdownContent("see Button(\\"a\\", \\"b\\") docs")').length,
    0,
    "escaped quotes inside strings"
  );
});

test("findings flood-cap at five", () => {
  const code = Array.from({ length: 8 }, (_, i) => `b${i} = Button("t${i}", "a${i}")`).join("\n");
  assert.equal(auditButtonActions(code).length, 5);
});
