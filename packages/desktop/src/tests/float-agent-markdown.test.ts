/**
 * Floating-agent reply rendering — both floating surfaces must render agent
 * replies through the shared Streamdown markdown pipeline instead of raw
 * source text (2026-09-10 user ask: markdown/HTML showed as literal source):
 *   - ExplainCard (editor 「解释」 card): content is LLM prose — headings,
 *     emphasis, fences and sanitized HTML must render as elements.
 *   - FloatingDesignAgent (design workspace): agent bubbles render markdown;
 *     user bubbles stay plain pre-wrapped text (no markdown interpretation
 *     of what the user typed).
 *
 * Harness: dom-harness + createApiStub before the component imports (api.ts
 * binds window.deeporca at module load). Both components portal/mount under
 * I18nProvider.
 */

import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";

import { installDom, createApiStub, type DomHandle, type ApiStub } from "./dom-harness";
// Type-only imports: erased at compile time (verbatimModuleSyntax) — the
// runtime imports happen in before(), after the DOM + stub exist.
import type * as RTL from "@testing-library/react";
import type * as React from "react";
import type { I18nProvider as I18nProviderComponent } from "../renderer/i18n";
import type { ExplainCard as ExplainCardComponent } from "../renderer/components/editor/ExplainCard";
import type { FloatingDesignAgent as FloatingDesignAgentComponent } from "../renderer/components/design-workspace/FloatingDesignAgent";
import type { PairExplainState } from "../renderer/hooks/use-pair-lane";

let dom: DomHandle;
let stub: ApiStub;
let rtl: typeof RTL;
let ReactPkg: typeof React;
let I18nProvider: typeof I18nProviderComponent;
let ExplainCard: typeof ExplainCardComponent;
let FloatingDesignAgent: typeof FloatingDesignAgentComponent;

const MARKDOWN_REPLY = [
  "## 结论",
  "",
  "这段代码 **加粗要点** 负责状态同步：",
  "",
  "- 要点一",
  "- 要点二",
  "",
  "```ts",
  "const ready = true;",
  "```",
].join("\n");

before(async () => {
  dom = installDom();
  const g = globalThis as unknown as { localStorage: Storage };
  g.localStorage = window.localStorage;
  localStorage.setItem("deeporca.locale", "zh");
  stub = createApiStub();
  (globalThis as unknown as { window: { deeporca: unknown } }).window.deeporca = stub.api;
  rtl = await import("@testing-library/react");
  ReactPkg = await import("react");
  ({ I18nProvider } = await import("../renderer/i18n"));
  ({ ExplainCard } = await import("../renderer/components/editor/ExplainCard"));
  ({ FloatingDesignAgent } = await import("../renderer/components/design-workspace/FloatingDesignAgent"));
});

after(() => {
  delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
  dom.cleanup();
});
afterEach(() => rtl.cleanup());

test("ExplainCard: markdown reply renders as elements, not raw source", async () => {
  const explain: NonNullable<PairExplainState> = { busy: false, content: MARKDOWN_REPLY, error: null };
  rtl.render(
    ReactPkg.createElement(
      I18nProvider,
      null,
      ReactPkg.createElement(ExplainCard, { explain, file: "/tmp/demo/App.tsx", onDismiss: () => {} })
    )
  );
  // Portal target is document.body, not the testing-library container.
  const card = await rtl.waitFor(() => {
    const el = document.body.querySelector(".ui-edexplain");
    assert.ok(el, "explain card missing");
    return el;
  });
  // StreamdownView composes "ui-streamdown ui-md" onto ONE div (same as the
  // chat surface) — sibling classes, not a parent/child chain. Streamdown maps
  // mdast nodes to data-streamdown elements (strong → span, not <strong>).
  const md = card.querySelector(".ui-streamdown.ui-md");
  assert.ok(md, "reply must render inside the shared .ui-md streamdown pipeline");
  assert.ok(card.querySelector("h2"), "heading not rendered");
  assert.ok(card.querySelector('[data-streamdown="strong"]'), "emphasis not rendered");
  assert.ok(card.querySelector('[data-streamdown="unordered-list"] li'), "list not rendered");
  assert.ok(card.querySelector("pre code"), "code fence not rendered");
  const text = card.textContent ?? "";
  assert.ok(!text.includes("**"), "raw ** marker leaked as source");
  assert.ok(!text.includes("```"), "raw fence leaked as source");
  assert.ok(!text.startsWith("##"), "raw heading marker leaked as source");
});

test("ExplainCard: busy spinner and error branches stay plain", () => {
  const busy: NonNullable<PairExplainState> = { busy: true, content: null, error: null };
  const utils = rtl.render(
    ReactPkg.createElement(
      I18nProvider,
      null,
      ReactPkg.createElement(ExplainCard, { explain: busy, file: null, onDismiss: () => {} })
    )
  );
  assert.ok(document.body.querySelector(".ui-edexplain .busy"), "busy branch missing");
  assert.equal(document.body.querySelector(".ui-edexplain .ui-md"), null, "busy branch must not render markdown");
  utils.unmount();

  const failed: NonNullable<PairExplainState> = { busy: false, content: null, error: "boom" };
  rtl.render(
    ReactPkg.createElement(
      I18nProvider,
      null,
      ReactPkg.createElement(ExplainCard, { explain: failed, file: null, onDismiss: () => {} })
    )
  );
  assert.ok(document.body.querySelector(".ui-edexplain .ui-error"), "error branch missing");
  assert.equal(document.body.querySelector(".ui-edexplain .ui-md"), null, "error branch must not render markdown");
});

test("FloatingDesignAgent: agent bubbles go through markdown, user bubbles stay plain", async () => {
  const utils = rtl.render(
    ReactPkg.createElement(
      I18nProvider,
      null,
      ReactPkg.createElement(FloatingDesignAgent, {
        tabLabel: "布局",
        quickItems: [],
        onSubmit: async () => true,
      })
    )
  );
  // Welcome bubble renders on expand through the markdown pipeline.
  await rtl.waitFor(() => {
    assert.ok(
      utils.container.querySelector(".ui-floating-design-agent-msg.agent .ui-streamdown.ui-md"),
      "welcome bubble must render through the markdown pipeline"
    );
  });

  // Submit an instruction → user bubble plain, agent reply markdown.
  const input = utils.container.querySelector(".ui-floating-design-agent-input input");
  assert.ok(input, "input missing");
  rtl.fireEvent.change(input, { target: { value: "把标题改成 **重点**" } });
  const submit = utils.container.querySelector(".ui-floating-design-agent-input button");
  assert.ok(submit, "submit button missing");
  await rtl.act(async () => {
    rtl.fireEvent.click(submit);
    await Promise.resolve();
  });
  await rtl.waitFor(() => {
    const agentMsgs = utils.container.querySelectorAll(".ui-floating-design-agent-msg.agent");
    assert.ok(agentMsgs.length >= 2, `agent reply missing: ${utils.container.innerHTML}`);
  });
  const userMsg = utils.container.querySelector(".ui-floating-design-agent-msg.user");
  assert.ok(userMsg, "user bubble missing");
  assert.equal(userMsg.querySelector(".ui-md"), null, "user bubble must stay plain text");
  assert.ok((userMsg.textContent ?? "").includes("把标题改成"), "user text lost");
  const replies = utils.container.querySelectorAll(".ui-floating-design-agent-msg.agent .ui-streamdown.ui-md");
  assert.ok(replies.length >= 2, "agent reply must render through the markdown pipeline");
});
