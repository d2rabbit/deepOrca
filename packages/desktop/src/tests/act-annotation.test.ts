// Unit tests for the OpenUI canvas act-tag producer
// (renderer/openui/act-annotation.ts). Pure DOM — jsdom via the shared
// harness, no React rendering involved: annotateActTags is a plain
// (root) => void pass and the OpenuiRenderer wiring (rAF + MutationObserver)
// is exercised by mount, not here.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { installDom, type DomHandle } from "./dom-harness";
// DOM-free at module load, so a static import is safe here; installDom() below
// provides the jsdom document the functions operate on.
import { annotateActTags, slugifyActLabel } from "../renderer/openui/act-annotation";
import { splitOpenuiErrors } from "../renderer/openui/correction";

let dom: DomHandle;

before(async () => {
  dom = installDom();
});

after(() => dom.cleanup());

/** Parse an HTML fragment into a detached container element. */
function container(html: string): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = html;
  return el;
}

/** Snapshot of every data-act value in the subtree, for idempotency diffs. */
function actSnapshot(root: HTMLElement): Array<[string, string | null]> {
  return Array.from(root.querySelectorAll<HTMLElement>("*")).map((el) => [el.tagName, el.getAttribute("data-act")]);
}

test("annotateActTags stamps buttons, forms and anchors with the documented shapes", () => {
  const root = container(`
    <button type="button">提交订单</button>
    <button type="button">  Sign  in, please!! </button>
    <form><input name="q"></form>
    <a href="/docs/guide">Read the Guide</a>
    <a href="/decorative">!!!</a>
    <button type="button" aria-label="icon only"></button>
  `);
  annotateActTags(root);

  const buttons = root.querySelectorAll("button");
  assert.equal(buttons[0]?.getAttribute("data-act"), "act:提交订单");
  assert.equal(buttons[1]?.getAttribute("data-act"), "act:sign-in-please");
  // Empty-slug elements (punctuation-only anchor, icon-only button) are
  // skipped rather than tagged with a degenerate value.
  assert.equal(root.querySelector("form")?.getAttribute("data-act"), "form:submit");
  assert.equal(root.querySelector("a[href='/docs/guide']")?.getAttribute("data-act"), "nav:goto:read-the-guide");
  assert.equal(root.querySelector("a[href='/decorative']")?.getAttribute("data-act"), null);
  assert.equal(buttons[2]?.getAttribute("data-act"), null);
});

test("annotateActTags is idempotent — a second pass adds nothing new", () => {
  const root = container(`
    <button type="button">提交订单</button>
    <form><input></form>
    <a href="/docs">Docs</a>
    <a href="/x">?</a>
  `);
  annotateActTags(root);
  const before = actSnapshot(root);
  annotateActTags(root);
  assert.deepEqual(actSnapshot(root), before);
  assert.equal(root.querySelectorAll("[data-act]").length, 3);
});

test("annotateActTags never touches elements already carrying data-sem or data-act", () => {
  const root = container(`
    <button data-sem="hero" data-act="act:custom">英雄按钮</button>
    <button data-sem="semantic-only">语义按钮</button>
    <button data-semantic-id="kept">保持不变</button>
    <button data-act="act:kept">已标注</button>
    <form data-act="form:custom"></form>
    <a href="/y" data-act="nav:custom">link</a>
  `);
  annotateActTags(root);

  const buttons = root.querySelectorAll("button");
  assert.equal(buttons[0]?.getAttribute("data-act"), "act:custom");
  assert.equal(buttons[1]?.getAttribute("data-act"), null); // data-sem wins, stays untagged
  // data-semantic-id is not part of the button skip-set (spec:
  // `button:not([data-act]):not([data-sem])`) — the button gains a data-act
  // while its data-semantic-id value is preserved untouched.
  assert.equal(buttons[2]?.getAttribute("data-act"), "act:保持不变");
  assert.equal(buttons[2]?.getAttribute("data-semantic-id"), "kept");
  assert.equal(buttons[3]?.getAttribute("data-act"), "act:kept");
  assert.equal(root.querySelector("form")?.getAttribute("data-act"), "form:custom");
  assert.equal(root.querySelector("a")?.getAttribute("data-act"), "nav:custom");
});

test("slugifyActLabel preserves CJK text", () => {
  assert.equal(slugifyActLabel("提交订单"), "提交订单");
  assert.equal(slugifyActLabel("取消，真的！"), "取消-真的");
});

test("slugifyActLabel collapses whitespace and punctuation runs to single dashes", () => {
  assert.equal(slugifyActLabel("  Sign  in,\tplease!!  "), "sign-in-please");
  assert.equal(slugifyActLabel("Step 2: Confirm"), "step-2-confirm");
  assert.equal(slugifyActLabel("..  Hello  .."), "hello");
});

test("slugifyActLabel caps length at 24", () => {
  assert.equal(slugifyActLabel("abcdefghijklmnopqrstuvwxyz").length, 24);
  assert.equal(slugifyActLabel("abcdefghijklmnopqrstuvwxyz"), "abcdefghijklmnopqrstuvwx");
  // A cap landing on a punctuation run still strips the trailing dash.
  const capped = slugifyActLabel("a!".repeat(24));
  assert.ok(capped.length <= 24);
  assert.ok(!capped.startsWith("-") && !capped.endsWith("-"));
});

test("slugifyActLabel returns empty for empty or meaningless text", () => {
  assert.equal(slugifyActLabel(""), "");
  assert.equal(slugifyActLabel("   "), "");
  assert.equal(slugifyActLabel("!!!"), "");
  assert.equal(slugifyActLabel(" —— "), "");
});

test("splitOpenuiErrors: excess-args folds to warnings, fatal stays red", () => {
  const errors = [
    { code: "excess-args", message: "Column takes 4 arg(s), got 5 (1 excess dropped)" },
    { code: "excess-args", message: "Card takes 3 arg(s), got 4 (1 excess dropped)" },
    { code: "parse-failed", message: "unexpected token" },
  ];
  const { fatal, warnings } = splitOpenuiErrors(errors);
  assert.equal(warnings.length, 2);
  assert.equal(fatal.length, 1);
  assert.equal(fatal[0].code, "parse-failed");
  assert.equal(splitOpenuiErrors([]).warnings.length, 0);
  assert.equal(
    splitOpenuiErrors([{ message: "Column takes 4 arg(s), got 6 (2 excess dropped)" }]).warnings.length,
    1,
    "message-based catch for untyped notices"
  );
});
