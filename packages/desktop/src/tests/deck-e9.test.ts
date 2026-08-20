/**
 * E9 guard tests (experiment-plan.md): the Studio sample — every non-agent
 * core capability surfaces through the ActionRegistry catalog.
 *
 *   - the dock entry opens a catalog grouped by category with ids, real
 *     descriptions and side-effect tags; search filters it
 *   - the runner builds its form from the action's JSON schema (text / enum /
 *     boolean), gates on required fields, and dispatches actionRun with the
 *     assembled input
 *   - results render structured; failures show code + error
 *   - the full (stage-tab) variant keeps a session-local run history that
 *     jumps back to the originating action
 */

import { test, describe, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { installDom, createApiStub, type DomHandle, type ApiStub } from "./dom-harness";
import type * as RTL from "@testing-library/react";
import type * as React from "react";
import type { DeckApp as DeckAppComponent } from "../renderer/deck/deck-app";
import type { I18nProvider as I18nProviderComponent } from "../renderer/i18n";

let dom: DomHandle;
let stub: ApiStub;
let fixture: Record<string, unknown>;
let render: typeof RTL.render;
let act: typeof RTL.act;
let fireEvent: typeof RTL.fireEvent;
let createElement: typeof React.createElement;
let StrictMode: typeof React.StrictMode;
let DeckApp: typeof DeckAppComponent;
let I18nProvider: typeof I18nProviderComponent;

const ACTIONS = [
  {
    id: "system.ping",
    description: "Health check",
    category: "system",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    id: "review.run",
    description: "Run AI code review",
    category: "review",
    parameters: {
      type: "object",
      properties: {
        background: { type: "string", description: "Business context" },
        commit: { type: "string", description: "Commit SHA" },
        strict: { type: "boolean", description: "Strict mode" },
      },
      required: ["commit"],
      additionalProperties: false,
    },
    sideEffects: ["spawn-subprocess", "read-in-cwd"],
  },
  {
    id: "wiki.update",
    description: "Regenerate wiki pages",
    category: "index",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    sideEffects: ["spawn-subprocess"],
  },
  {
    id: "design.drift",
    description: "Brand drift gate",
    category: "design",
    parameters: {
      type: "object",
      properties: {
        baseline: { type: "string" },
        mode: { type: "string", enum: ["fast", "full"] },
      },
      required: ["baseline", "mode"],
      additionalProperties: false,
    },
  },
];

function defaultFixture(): Record<string, unknown> {
  return {
    getActiveSession: async () => null,
    getSession: async () => null,
    listSessions: async () => [],
    editorListFiles: async () => ({ ok: true, entries: [] }),
    sendPrompt: async () => ({ ok: true }),
    actionList: async () => ACTIONS,
    actionRun: async (id: string) => ({ ok: true, output: { pong: true, id } }),
    knowledgeStatus: async () => ({}),
  };
}

before(async () => {
  dom = installDom();
  const win = (globalThis as unknown as { window: Window }).window;
  Object.defineProperty(globalThis, "localStorage", { value: win.localStorage, configurable: true });

  fixture = defaultFixture();
  stub = createApiStub(fixture);
  (globalThis as unknown as { window: { deeporca: unknown } }).window.deeporca = stub.api;

  const rtl = await import("@testing-library/react");
  const react = await import("react");
  render = rtl.render;
  act = rtl.act;
  fireEvent = rtl.fireEvent;
  createElement = react.createElement;
  StrictMode = react.StrictMode;
  DeckApp = (await import("../renderer/deck/deck-app")).DeckApp;
  I18nProvider = (await import("../renderer/i18n")).I18nProvider;
});

after(() => {
  dom?.cleanup();
});

beforeEach(() => {
  Object.assign(fixture, defaultFixture());
  stub.reset();
  localStorage.clear();
  localStorage.setItem("deeporca.deck.onboarded", "1");
});

describe("Deck E9 Studio action catalog", () => {
  let mounted: { unmount(): void; container: HTMLElement } | null = null;

  afterEach(() => {
    mounted?.unmount();
    mounted = null;
  });

  async function mountDeck(): Promise<{ unmount(): void; container: HTMLElement }> {
    let result!: ReturnType<typeof render>;
    await act(async () => {
      result = render(createElement(StrictMode, null, createElement(I18nProvider, null, createElement(DeckApp))));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    return { unmount: () => result.unmount(), container: result.container };
  }

  async function openStudio(container: HTMLElement): Promise<void> {
    const entry = container.querySelector('[data-overlay="studio"]');
    assert.ok(entry, "studio dock entry missing");
    await act(async () => {
      fireEvent.click(entry);
    });
  }

  async function expandAction(container: HTMLElement, id: string): Promise<Element> {
    const head = [...container.querySelectorAll(".deck-studio-action-head")].find((h) => h.textContent?.includes(id));
    assert.ok(head, `action ${id} missing from the catalog`);
    await act(async () => {
      fireEvent.click(head!);
    });
    return head!.closest(".deck-studio-action")!;
  }

  test("catalog groups actions by category with ids and side-effect tags; search filters", async () => {
    mounted = await mountDeck();
    await openStudio(mounted.container);
    const overlay = mounted.container.querySelector('[data-layer="studio"]')!;

    const cats = [...overlay.querySelectorAll(".deck-panel-group-title")].map((c) => c.textContent);
    assert.ok(cats.includes("Review"), "review category renders");
    assert.ok(cats.includes("Index & Knowledge"), "index category renders");
    assert.ok(
      cats.indexOf("Review") < cats.indexOf("Design") && cats.indexOf("Design") < cats.indexOf("System"),
      "categories follow the canonical order"
    );
    assert.ok(overlay.textContent?.includes("review.run"), "action ids render");
    assert.ok(overlay.textContent?.includes("spawn-subprocess"), "side-effect tags render");

    const search = overlay.querySelector(".deck-studio-search")!;
    await act(async () => {
      fireEvent.change(search, { target: { value: "wiki" } });
    });
    const visible = [...overlay.querySelectorAll(".deck-studio-id")].map((el) => el.textContent);
    assert.deepEqual(visible, ["wiki.update"], `search should narrow to wiki.update, saw ${visible.join(",")}`);
  });

  test("runner builds the form from the JSON schema and gates required fields", async () => {
    mounted = await mountDeck();
    await openStudio(mounted.container);
    const runner = await expandAction(mounted.container, "review.run");

    const runBtn = [...runner.querySelectorAll(".deck-op")].find((b) => b.textContent === "Run")!;
    assert.ok((runBtn as HTMLButtonElement).disabled, "required commit missing — run must be gated");

    const commitInput = [...runner.querySelectorAll("input")].find(
      (i) => (i as HTMLInputElement).placeholder === "Commit SHA"
    )!;
    await act(async () => {
      fireEvent.change(commitInput, { target: { value: "abc123" } });
    });
    assert.ok(!(runBtn as HTMLButtonElement).disabled, "required filled — run enabled");

    const checkbox = runner.querySelector('input[type="checkbox"]')!;
    await act(async () => {
      fireEvent.click(checkbox);
    });
    await act(async () => {
      fireEvent.click(runBtn);
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    const call = stub.calls.find((c) => c.method === "actionRun" && c.args[0] === "review.run");
    assert.ok(call, "actionRun should fire");
    const input = call!.args[1] as Record<string, unknown>;
    assert.equal(input.commit, "abc123");
    assert.equal(input.strict, true, "checkbox assembles a boolean");
    assert.equal(input.background, undefined, "empty optional fields drop out");

    assert.ok(runner.textContent?.includes("pong"), "ok output renders under the runner");
  });

  test("enum param renders a select; failures show code + error", async () => {
    fixture.actionRun = async () => ({ ok: false, code: "ACTION_FAILED", error: "baseline missing on disk" });
    mounted = await mountDeck();
    await openStudio(mounted.container);
    const runner = await expandAction(mounted.container, "design.drift");

    const select = runner.querySelector("select");
    assert.ok(select, "enum param should render a select");

    const baseline = [...runner.querySelectorAll("input")].find(
      (i) => (i as HTMLInputElement).placeholder === "baseline"
    )!;
    await act(async () => {
      fireEvent.change(baseline, { target: { value: ".deeporca/design-baseline.json" } });
      fireEvent.change(select!, { target: { value: "full" } });
    });
    const runBtn = [...runner.querySelectorAll(".deck-op")].find((b) => b.textContent === "Run")!;
    await act(async () => {
      fireEvent.click(runBtn);
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    const call = stub.calls.find((c) => c.method === "actionRun" && c.args[0] === "design.drift");
    assert.deepEqual(
      call!.args[1],
      { baseline: ".deeporca/design-baseline.json", mode: "full" },
      "enum value assembles as its string"
    );
    assert.ok(runner.textContent?.includes("ACTION_FAILED"), "failure code renders");
    assert.ok(runner.textContent?.includes("baseline missing on disk"), "failure error renders");
  });

  test("full variant keeps a session-local run history that jumps to the action", async () => {
    mounted = await mountDeck();
    // Open as a stage tab via the overlay expand affordance.
    await openStudio(mounted.container);
    const expand = mounted.container.querySelector('[data-layer="studio"] .deck-overlay-expand');
    assert.ok(expand, "studio overlay should offer expand-to-tab");
    await act(async () => {
      fireEvent.click(expand!);
    });
    assert.ok(mounted.container.querySelector(".deck-tabpage"), "studio loads into the stage tab");

    const pingRunner = await expandAction(mounted.container, "system.ping");
    const runBtn = [...pingRunner.querySelectorAll(".deck-op")].find((b) => b.textContent === "Run")!;
    await act(async () => {
      fireEvent.click(runBtn);
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    const wikiRunner = await expandAction(mounted.container, "wiki.update");
    const runBtn2 = [...wikiRunner.querySelectorAll(".deck-op")].find((b) => b.textContent === "Run")!;
    await act(async () => {
      fireEvent.click(runBtn2);
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    const rows = mounted.container.querySelectorAll(".deck-review-runs .deck-row");
    assert.equal(rows.length, 2, `expected 2 history rows, saw ${rows.length}`);
    assert.ok(rows[0].textContent?.includes("wiki.update"), "newest run first");

    await act(async () => {
      fireEvent.click(rows[1]);
    });
    const openHead = mounted.container.querySelector(".deck-studio-action.open .deck-studio-id");
    assert.equal(openHead?.textContent, "system.ping", "history click re-opens the originating action");
  });
});
