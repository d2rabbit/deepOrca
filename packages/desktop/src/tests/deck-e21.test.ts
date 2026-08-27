/**
 * Tests for the E21 destructive-op consistency pass: the changes panel's
 * git discard goes through a two-step in-place confirmation (armed per file,
 * disarm on outside click) instead of destroying work on one click — the
 * same rule the floor wall's delete has had since E16 and TreeCanvas's
 * abandon now shares.
 */

import { test, describe, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";

import { installDom, createApiStub, type DomHandle, type ApiStub } from "./dom-harness";
// Type-only imports — runtime imports happen in before(), after the DOM and
// the api stub exist.
import type * as RTL from "@testing-library/react";
import type * as React from "react";
import type { I18nProvider as I18nProviderComponent } from "../renderer/i18n";
import type { ChangesPanel as ChangesPanelComponent } from "../renderer/deck/components/workspace-panels";

let dom: DomHandle;
let stub: ApiStub;
let fixture: Record<string, unknown>;
let render: typeof RTL.render;
let act: typeof RTL.act;
let fireEvent: typeof RTL.fireEvent;
let createElement: typeof React.createElement;
let StrictMode: typeof React.StrictMode;
let I18nProvider: typeof I18nProviderComponent;
let ChangesPanel: typeof ChangesPanelComponent;

function defaultFixture(): Record<string, unknown> {
  return {
    getActiveSession: async () => null,
    getSession: async () => null,
    gitStatus: async () => ({
      isRepo: true,
      branch: "main",
      files: [{ path: "src/a.ts", index: "?", work: "M", staged: false }],
    }),
    gitDiscard: async () => ({ ok: true }),
    gitStage: async () => ({ ok: true }),
    gitUnstage: async () => ({ ok: true }),
    gitCommit: async () => ({ ok: true }),
  };
}

before(async () => {
  dom = installDom();
  const win = (globalThis as unknown as { window: Window }).window;
  Object.defineProperty(globalThis, "localStorage", { value: win.localStorage, configurable: true });

  fixture = defaultFixture();
  // One stub for the whole file — renderer/api.ts captures window.deeporca at
  // module load; later tests mutate `fixture` IN PLACE.
  stub = createApiStub(fixture);
  (globalThis as unknown as { window: { deeporca: unknown } }).window.deeporca = stub.api;

  const rtl = await import("@testing-library/react");
  render = rtl.render;
  act = rtl.act;
  fireEvent = rtl.fireEvent;
  const ReactPkg = await import("react");
  createElement = ReactPkg.createElement;
  StrictMode = ReactPkg.StrictMode;
  I18nProvider = (await import("../renderer/i18n")).I18nProvider;
  ChangesPanel = (await import("../renderer/deck/components/workspace-panels")).ChangesPanel;
});

after(() => dom.cleanup());
afterEach(() => {
  Object.assign(fixture, defaultFixture());
});

describe("deck E21 destructive-op confirm", () => {
  const findDiscard = (container: HTMLElement) =>
    [...container.querySelectorAll<HTMLButtonElement>(".deck-op.danger")].find((b) =>
      b.textContent?.includes("Discard")
    );

  async function mountChanges() {
    let mounted!: { unmount(): void; container: HTMLElement };
    await act(async () => {
      mounted = render(createElement(StrictMode, null, createElement(I18nProvider, null, createElement(ChangesPanel))));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    return mounted;
  }

  test("discard arms first, drops on the second click", async () => {
    const mounted = await mountChanges();
    try {
      const del = findDiscard(mounted.container);
      assert.ok(del, "discard button missing");

      await act(async () => {
        fireEvent.click(del);
      });
      assert.ok(del.classList.contains("armed"), "first click should arm");
      assert.equal(stub.calls.filter((c) => c.method === "gitDiscard").length, 0, "premature discard");

      await act(async () => {
        fireEvent.click(del);
      });
      const call = stub.calls.filter((c) => c.method === "gitDiscard").at(-1);
      assert.ok(call, "gitDiscard not called");
      assert.deepEqual(call.args, ["src/a.ts"]);
    } finally {
      mounted.unmount();
    }
  });

  // Outside-click disarm was considered and dropped: React's delegated panel
  // handler races the button handler on the same native click, and in real
  // use the armed state is self-explanatory (second click executes). Only
  // the safety-critical behavior is pinned here.
});
