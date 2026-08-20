/**
 * E4 guard tests for the Orca Deck experimental layout (experiment-plan v3).
 *
 * Pins the proposal-increment deliverables (orca-deck-v3_change.html):
 *   - the .gi semantic icon class replaces every emoji in deck panels
 *     (notification kinds, asset types) and knowledge-source states become
 *     semantic CSS dots
 *   - the pending-approval card is a decision point: amber static anchor by
 *     default, red breathing anchor (anchor-high) for destructive /
 *     git-mutating scopes
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
});

describe("Deck E4 proposal increments", () => {
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

  async function openDockOverlay(container: HTMLElement, overlay: string): Promise<HTMLElement> {
    const button = container.querySelector(`[data-overlay="${overlay}"]`);
    assert.ok(button, `dock entry ${overlay} missing`);
    await act(async () => {
      fireEvent.click(button);
    });
    const layer = container.querySelector(`[data-layer="${overlay}"]`);
    assert.ok(layer, `overlay ${overlay} did not open`);
    return layer as HTMLElement;
  }

  test("notification rows use .gi semantic icons, not emoji", async () => {
    mounted = await mountDeck();
    await act(async () => {
      stub.emit("onSessionEntryUpdated", { id: "sess-abcdef12", status: "completed" });
    });
    const drawer = await openDockOverlay(mounted.container, "notifications");

    assert.ok(drawer.querySelector("svg.gi"), "notification kind icon should be a .gi SVG");
    assert.ok(!drawer.textContent?.includes("◍"), "notification rows must not fall back to emoji");
  });

  test("asset rows swap emoji for .gi target/ruler icons", async () => {
    fixture.designList = async () => [
      { id: "a1", pipeline: "openui", title: "Login Proto", updatedAt: "2026-08-20T10:00:00Z" },
      { id: "a2", pipeline: "design", title: "Tokens Doc", updatedAt: "2026-08-20T11:00:00Z" },
    ];
    mounted = await mountDeck();
    const panel = await openDockOverlay(mounted.container, "assets");

    assert.equal(panel.querySelectorAll("svg.gi").length, 2, "each asset row should carry a .gi icon");
    assert.ok(!panel.textContent?.includes("🎯"), "asset rows must not use emoji");
  });

  test("knowledge-source states render as semantic CSS dots", async () => {
    fixture.knowledgeStatus = async () => ({
      codegraph: { state: "indexed", count: 3 },
      memory: { state: "stale" },
    });
    mounted = await mountDeck();
    const panel = await openDockOverlay(mounted.container, "sources");

    assert.ok(panel.querySelector(".deck-sdot.ok"), "indexed state should be a green dot");
    assert.ok(panel.querySelector(".deck-sdot.warn"), "stale state should be a warning dot");
    assert.ok(!panel.textContent?.includes("🟢"), "knowledge states must not use emoji");
  });

  test("high-risk pending card gets the red breathing anchor", async () => {
    fixture.getActiveSession = async () => "sess-1";
    fixture.getSession = async () => ({
      summary: "goal",
      status: "ask_permission",
      askPermissions: [{ toolCallId: "tc1", name: "bash", command: "rm -rf x", scopes: ["delete-in-cwd"] }],
    });
    mounted = await mountDeck();

    const card = mounted.container.querySelector(".deck-pending");
    assert.ok(card, "pending card missing");
    assert.ok(
      card.classList.contains("anchor-high"),
      "destructive scopes must mark the card anchor-high (red breathing border)"
    );
    assert.ok(card.querySelector("svg.gi-lg"), "pending title should carry the .gi alert icon");
  });

  test("ordinary pending card anchors amber without the breathing pulse", async () => {
    fixture.getActiveSession = async () => "sess-1";
    fixture.getSession = async () => ({
      summary: "goal",
      status: "ask_permission",
      askPermissions: [{ toolCallId: "tc1", name: "write", command: "echo hi > f", scopes: ["write-in-cwd"] }],
    });
    mounted = await mountDeck();

    const card = mounted.container.querySelector(".deck-pending");
    assert.ok(card, "pending card missing");
    assert.ok(card.classList.contains("anchor"), "every pending card is a decision point anchor");
    assert.ok(!card.classList.contains("anchor-high"), "non-destructive scopes must not breathe red");
  });
});
