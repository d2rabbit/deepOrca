/**
 * Knowledge panel — architecture tab runtime wiring (audit round 3, 2026-08-29:
 * the archify refactor had only typecheck coverage on the renderer; this pins
 * the ACTUAL tab flow):
 *   - the HERO artifact (delivered) auto-embeds INLINE as an iframe on tab
 *     open (一级直接展开 — no launcher, no external window);
 *   - an artifact WITHOUT htmlPath goes through api.knowledgeArchRender first
 *     and then embeds;
 *   - selecting a SUB-level artifact draws our dynamic map via
 *     api.knowledgeArchReadJson (symbol-graph style, per the 2026-08-29 board
 *     decision);
 *   - empty status shows the empty state.
 *
 * Harness: dom-harness jsdom + createApiStub (knowledgeStatus overridden —
 * the default stub's `[]` is the wrong shape for this surface).
 */

import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";

import { installDom, createApiStub } from "./dom-harness";
import type * as RTL from "@testing-library/react";
import type * as React from "react";
import type { I18nProvider as I18nProviderComponent } from "../renderer/i18n";
import type { KnowledgePanel as KnowledgePanelComponent } from "../renderer/components/KnowledgePanel";
import type { KnowledgeStatusResponse } from "../shared/ipc";

let rtl: typeof RTL;
let ReactPkg: typeof React;
let I18nProvider: typeof I18nProviderComponent;
let KnowledgePanel: typeof KnowledgePanelComponent;

/** Per-test overrides — the stub is installed ONCE (before any component
 *  import, per the dom-harness ordering rule) and reads this object at call
 *  time, so each test swaps its contents instead of the api identity. */
const holder: Record<string, unknown> = {};

const statusWith = (files: NonNullable<KnowledgeStatusResponse["archmaps"]["files"]>): KnowledgeStatusResponse => ({
  codegraph: { state: "indexed" },
  openwiki: { state: "indexed" },
  agents: { state: "indexed" },
  archmaps:
    files.length > 0 ? { state: "indexed", count: files.length, unit: "张", files } : { state: "empty", files: [] },
});

function mountPanel(): ReturnType<typeof rtl.render> {
  return rtl.render(
    ReactPkg.createElement(
      I18nProvider,
      null,
      ReactPkg.createElement(KnowledgePanel, {
        root: "/tmp/proj",
        onOpenFile: () => {},
        onQuoteToChat: () => {},
      })
    )
  );
}

before(async () => {
  installDom();
  // i18n's detectLocale reads the bare `localStorage` global, which the DOM
  // harness does not install (jsdom keeps it on window) — expose + pin zh.
  const g = globalThis as unknown as { localStorage: Storage };
  g.localStorage = window.localStorage;
  localStorage.setItem("deeporca.locale", "zh");
  // api.ts evaluates window.deeporca at import — the stub must exist BEFORE
  // the component graph loads (dom-harness ordering rule).
  (window as unknown as Record<string, unknown>).deeporca = createApiStub(holder).api;
  rtl = await import("@testing-library/react");
  ReactPkg = await import("react");
  ({ I18nProvider } = await import("../renderer/i18n"));
  ({ KnowledgePanel } = await import("../renderer/components/KnowledgePanel"));
});

afterEach(() => {
  // Unmount between tests — a still-mounted panel from the previous test
  // doubles every query target ("multiple elements found").
  rtl.cleanup();
});

after(() => {
  delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
});

test("hero artifact auto-embeds inline (iframe) on tab open", async () => {
  const calls: { method: string; args: unknown[] }[] = [];
  const htmlPath = "/tmp/proj/.deeporca/prototypes/arch-demo.architecture.html";
  const stubOverrides = {
    knowledgeStatus: async () =>
      statusWith([
        {
          name: "arch-demo.architecture",
          path: "/tmp/proj/.deeporca/prototypes/arch-demo.architecture.json",
          mtime: new Date().toISOString(),
          type: "architecture",
          htmlPath,
        },
      ]),
    wikiListPages: async () => [],
    knowledgeSymbols: async () => [],
    agentsRead: async () => "",
    knowledgeOpenArchHtml: async (p: string) => {
      calls.push({ method: "open", args: [p] });
      return { ok: true };
    },
    knowledgeArchRender: async (p: string) => {
      calls.push({ method: "render", args: [p] });
      return { ok: true, htmlPath };
    },
  };
  Object.assign(holder, stubOverrides);
  const view = mountPanel();
  // Switch to the architecture tab.
  const tab = await rtl.waitFor(() => {
    const el = view.getByText("架构图");
    return el;
  });
  rtl.fireEvent.click(tab);
  // 一级直接展开: the hero embeds INLINE — an iframe pointing at the
  // delivered file, no launcher button.
  await rtl.waitFor(() => {
    const frame = view.container.querySelector(".ui-arch-board-frame") as HTMLIFrameElement | null;
    assert.ok(frame, "inline embed iframe renders");
    assert.match(frame.getAttribute("src") ?? "", /arch-demo\.architecture\.html\?present=1$/);
  });
  assert.match(view.container.textContent ?? "", /architecture/);
  assert.equal(view.queryByText("打开交互架构图"), null, "launcher retired");
});

test("undelivered artifact routes through the render gate before embedding", async () => {
  const calls: { method: string; args: unknown[] }[] = [];
  const jsonPath = "/tmp/proj/.deeporca/prototypes/arch-flow.dataflow.json";
  const htmlPath = "/tmp/proj/.deeporca/prototypes/arch-flow.dataflow.html";
  Object.assign(holder, {
    knowledgeStatus: async () =>
      statusWith([{ name: "arch-flow.dataflow", path: jsonPath, mtime: new Date().toISOString(), type: "dataflow" }]),
    wikiListPages: async () => [],
    knowledgeSymbols: async () => [],
    agentsRead: async () => "",
    knowledgeArchRender: async (p: string) => {
      calls.push({ method: "render", args: [p] });
      return { ok: true, htmlPath };
    },
    knowledgeOpenArchHtml: async (p: string) => {
      calls.push({ method: "open", args: [p] });
      return { ok: true };
    },
  });
  const view = mountPanel();
  rtl.fireEvent.click(view.getByText("架构图"));
  await rtl.waitFor(() => {
    const frame = view.container.querySelector(".ui-arch-board-frame") as HTMLIFrameElement | null;
    assert.ok(frame, "embeds after the gate passes");
    assert.match(frame.getAttribute("src") ?? "", /arch-flow\.dataflow\.html\?present=1$/);
  });
  assert.deepEqual(
    calls.map((c) => c.method),
    ["render"],
    "render gate ran, no window open"
  );
});

test("empty archmaps state shows the empty hint, no launcher", async () => {
  Object.assign(holder, {
    knowledgeStatus: async () => statusWith([]),
    wikiListPages: async () => [],
    knowledgeSymbols: async () => [],
    agentsRead: async () => "",
  });
  const view = mountPanel();
  rtl.fireEvent.click(view.getByText("架构图"));
  await rtl.waitFor(() => {
    assert.ok(view.getByText("还没有架构图——请先构建"), "empty-state hint renders");
  });
  assert.equal(view.container.querySelector(".ui-arch-board-frame"), null, "no embed without artifacts");
});
