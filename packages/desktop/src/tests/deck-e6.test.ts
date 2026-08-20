/**
 * E6 guard tests (experiment-plan.md): form-factor alignment with the design
 * demo — edge-docked drawers, the card-wall workshop, the knowledge-source
 * detail page, first-run onboarding, and the resident control center.
 *
 *   - drawers dock to the screen edges (no scrim) and are mutually exclusive
 *   - the workshop wall renders session cards with status tags
 *   - knowledge sources drill list → detail with real stats + rebuild action
 *   - onboarding shows exactly once and persists dismissal
 *   - the control center is a resident pane; collapse persists, ⌘⇧O toggles,
 *     the collapsed tab carries the unread badge and pulses while a
 *     permission ask is pending
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

function defaultFixture(): Record<string, unknown> {
  return {
    getActiveSession: async () => null,
    getSession: async () => null,
    listSessions: async () => [],
    editorListFiles: async () => ({ ok: true, entries: [] }),
    // Dismiss onboarding by default so it never interferes with other cases.
    knowledgeStatus: async () => ({
      codegraph: { state: "indexed", count: 3, unit: "k" },
      openwiki: { state: "empty" },
    }),
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

describe("Deck E6 form-factor alignment", () => {
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

  function press(key: string, opts: { meta?: boolean; shift?: boolean } = {}): Promise<void> {
    return act(async () => {
      fireEvent.keyDown(window, { key, metaKey: opts.meta ?? false, shiftKey: opts.shift ?? false });
    });
  }

  test("drawers dock to the edges with no scrim and are mutually exclusive", async () => {
    mounted = await mountDeck();
    await press("e", { meta: true }); // files → left drawer

    const files = mounted.container.querySelector('[data-layer="files"]');
    assert.ok(files, "files drawer missing");
    assert.ok(files.classList.contains("deck-drawer"), "files should render in a DrawerShell");
    assert.ok(files.classList.contains("left"), "files docks left");
    assert.equal(files.closest(".deck-overlay-scrim"), null, "drawers must not sit under a scrim");

    await press("p", { meta: true, shift: true }); // processes → right drawer
    const procs = mounted.container.querySelector('[data-layer="processes"]');
    assert.ok(procs?.classList.contains("right"), "processes docks right");
    assert.equal(
      mounted.container.querySelector('[data-layer="files"]'),
      null,
      "docking one drawer must undock the other"
    );

    // Esc closes the top layer — with only drawers left, Esc retires them too.
    await press("Escape");
    assert.equal(mounted.container.querySelector('[data-layer="processes"]'), null);
  });

  test("workshop wall renders session cards with status tags", async () => {
    fixture.listWorkspaceSessions = async () => ({
      workspaces: [
        {
          root: "/repo",
          label: "repo",
          sessions: [
            {
              id: "sess-a",
              summary: "权限改批量审批",
              status: "processing",
              updateTime: "2026-08-20T14:04:00Z",
            },
            {
              id: "sess-b",
              summary: "导出压缩包",
              status: "completed",
              updateTime: "2026-08-20T10:00:00Z",
            },
          ],
        },
      ],
    });
    fixture.getActiveSession = async () => "sess-a";
    fixture.getSession = async () => ({ summary: "权限改批量审批", status: "processing" });

    mounted = await mountDeck();
    const floor = mounted.container.querySelector('[data-overlay="floor"]');
    await act(async () => {
      fireEvent.click(floor!);
    });

    const cards = mounted.container.querySelectorAll(".deck-wo-card");
    assert.equal(cards.length, 2, `expected 2 work-order cards, saw ${cards.length}`);
    assert.ok(cards[0].classList.contains("active"), "the active session card should be outlined");
    assert.ok(cards[0].querySelector(".deck-wo-tag.b"), "processing status should carry the accent tag");
    assert.ok(cards[1].querySelector(".deck-wo-tag.g"), "completed status should carry the ok tag");
  });

  test("knowledge sources drill list → detail with stats and a rebuild action", async () => {
    fixture.codegraphList = async () => [{ root: "/repo", label: "repo", initialized: true }];
    mounted = await mountDeck();

    const db = mounted.container.querySelector('[data-overlay="sources"]');
    await act(async () => {
      fireEvent.click(db!);
    });
    const codegraphRow = [...mounted.container.querySelectorAll('[data-layer="sources"] .deck-row')].find((r) =>
      r.textContent?.includes("codegraph")
    );
    assert.ok(codegraphRow, "codegraph row missing from the sources list");
    await act(async () => {
      fireEvent.click(codegraphRow!);
    });

    const detail = mounted.container.querySelector('[data-layer="sources"]');
    assert.ok(detail, "the detail view did not open");
    assert.ok(detail.textContent?.includes("3k"), "the detail view should show the real count");
    assert.ok(detail.querySelector(".deck-sub-back"), "detail should offer a way back");
    const rebuild = [...detail.querySelectorAll("button")].find((b) => b.textContent === "Rebuild index");
    assert.ok(rebuild, "codegraph detail should offer a rebuild action");

    await act(async () => {
      fireEvent.click(rebuild!);
    });
    const back = detail.querySelector(".deck-sub-back")!;
    await act(async () => {
      fireEvent.click(back);
    });
    assert.ok(
      [...mounted.container.querySelectorAll('[data-layer="sources"] .deck-row')].some((r) =>
        r.textContent?.includes("openwiki")
      ),
      "going back should restore the source list"
    );
  });

  test("onboarding shows exactly once and persists dismissal", async () => {
    localStorage.removeItem("deeporca.deck.onboarded");
    mounted = await mountDeck();
    const modal = mounted.container.querySelector('[data-layer="onboarding"]');
    assert.ok(modal, "first run should show the onboarding modal");
    assert.ok(modal!.textContent?.includes("⌘K"), "onboarding should teach the command layer");
    assert.ok(modal!.textContent?.includes("Space"), "onboarding should teach the brake");

    await act(async () => {
      fireEvent.click([...modal!.querySelectorAll("button")].find((b) => b.textContent === "Start")!);
    });
    assert.equal(mounted.container.querySelector('[data-layer="onboarding"]'), null, "dismissal closes the modal");
    assert.equal(localStorage.getItem("deeporca.deck.onboarded"), "1");
  });

  test("control center is resident; collapse persists and ⌘⇧O toggles", async () => {
    mounted = await mountDeck();
    assert.ok(mounted.container.querySelector(".deck-cc-dock"), "the control center should be resident by default");
    assert.ok(
      mounted.container.textContent?.includes("Status Stream"),
      "resident pane should carry the observation stream"
    );

    const collapse = mounted.container.querySelector(".deck-cc-dock-head .deck-overlay-close");
    await act(async () => {
      fireEvent.click(collapse!);
    });
    assert.ok(mounted.container.querySelector(".deck-cc-tab"), "collapsing should leave the pull tab");
    assert.equal(localStorage.getItem("deeporca.deck.cc"), "1", "collapse state must persist");

    await press("o", { meta: true, shift: true });
    assert.ok(mounted.container.querySelector(".deck-cc-dock"), "⌘⇧O should reopen the resident pane");
  });

  test("collapsed control-center tab pulses while a permission ask is pending", async () => {
    fixture.getActiveSession = async () => "sess-1";
    fixture.getSession = async () => ({
      summary: "goal",
      status: "ask_permission",
      askPermissions: [{ toolCallId: "tc1", name: "bash", command: "rm -rf x", scopes: ["delete-in-cwd"] }],
    });
    mounted = await mountDeck();

    const collapse = mounted.container.querySelector(".deck-cc-dock-head .deck-overlay-close");
    await act(async () => {
      fireEvent.click(collapse!);
    });
    const tab = mounted.container.querySelector(".deck-cc-tab");
    assert.ok(tab?.classList.contains("urgent"), "a pending permission ask must pulse the tab");
  });
});
