// ThinkingRow click-to-expand regression (user report 2026-09-03 五轮:
// 思考行点不开). Renders the component in the DOM harness, clicks the
// toggle, and asserts the body mounts. Pure interaction pin — no api calls.
import { test } from "node:test";
import assert from "node:assert/strict";
import type * as RTL from "@testing-library/react";
import { installDom } from "./dom-harness.js";

await installDom();
// jsdom lacks scrollIntoView; polyfill so the test exercises the real expand
// path instead of crashing in the scroll effect (the crash itself is a real
// defect the component now guards with optional chaining).
{
  const proto = (globalThis as unknown as { Element?: { prototype: Record<string, unknown> } }).Element?.prototype;
  if (proto && typeof proto.scrollIntoView !== "function") proto.scrollIntoView = () => {};
}
const ReactPkg = await import("react");
const rtl: typeof RTL = await import("@testing-library/react");
const { I18nProvider } = await import("../renderer/i18n");
const { ThinkingBlock } = await import("../renderer/components/message/ThinkingRow");

test("thinking row: clicking the summary toggle mounts the body", async () => {
  const { container } = rtl.render(
    ReactPkg.createElement(
      I18nProvider,
      null,
      ReactPkg.createElement(ThinkingBlock, {
        content: "I should inspect the repository first before editing AGENTS.md.",
        messageParams: null,
        reasoningMode: "normal",
        isLatest: false,
        streaming: false,
      })
    )
  );
  const toggle = container.querySelector<HTMLButtonElement>(".ui-ev-think-toggle");
  assert.ok(toggle, "toggle button must render");
  assert.equal(container.querySelector(".think-body"), null, "body starts collapsed");
  await rtl.act(async () => {
    toggle.click();
  });
  assert.ok(container.querySelector(".think-body"), "body mounts after click");
  assert.match(container.querySelector(".think-body")!.textContent ?? "", /inspect the repository/);
});

test("thinking row: reasoningMode expanded renders the body initially", async () => {
  const { container } = rtl.render(
    ReactPkg.createElement(
      I18nProvider,
      null,
      ReactPkg.createElement(ThinkingBlock, {
        content: "plan the change set",
        messageParams: null,
        reasoningMode: "expanded",
        isLatest: false,
      })
    )
  );
  assert.ok(container.querySelector(".think-body"), "body is open in expanded mode");
});

test("thinking row: empty content falls back to messageParams.reasoning_content (StepFun shape)", async () => {
  const { container } = rtl.render(
    ReactPkg.createElement(
      I18nProvider,
      null,
      ReactPkg.createElement(ThinkingBlock, {
        content: "",
        messageParams: { reasoning_content: "inspect Package.swift before touching the build scripts" },
        reasoningMode: "normal",
        isLatest: false,
      })
    )
  );
  const toggle = container.querySelector<HTMLButtonElement>(".ui-ev-think-toggle");
  assert.ok(toggle, "toggle renders for params-only thinking");
  assert.ok(container.querySelector(".think-chars"), "char badge renders from the effective text");
  await rtl.act(async () => {
    toggle.click();
  });
  const body = container.querySelector(".think-body");
  assert.ok(body, "body mounts from reasoning_content");
  assert.match(body!.textContent ?? "", /Package\.swift/);
});
