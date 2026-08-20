/**
 * E5 guard tests (experiment-plan.md): core-path completion + feedback layer.
 *
 *   - diff focus card: the changes drawer offers a per-file diff view wired
 *     to gitDiff — the third step of the review-point-#1 core path finally
 *     runs inside the Deck
 *   - brake (Space): freeze while running (pausePrompt), resume while paused
 *     (resumePrompt) — the scene-preserving channel, not interrupt
 *   - toasts: engine events mirror into the ephemeral toast layer, capped at 5
 *   - command layer: results grouped (goals/views/themes/actions) and the
 *     workspace sessions are searchable by title, Enter switches work orders
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

describe("Deck E5 core-path completion + feedback layer", () => {
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

  test("changes drawer opens a diff focus card wired to gitDiff", async () => {
    fixture.gitStatus = async () => ({
      isRepo: true,
      branch: "main",
      files: [{ path: "permissions.ts", index: "M", work: "M", staged: false }],
    });
    fixture.gitDiff = async () => ({
      file: "permissions.ts",
      diff: '@@ -106,7 +106,8 @@ computeRisk()\n-  const risk = "high";\n+  const risk = "medium";',
      binary: false,
    });

    mounted = await mountDeck();
    const changes = mounted.container.querySelector('[data-overlay="changes"]');
    await act(async () => {
      fireEvent.click(changes!);
    });

    const diffButton = mounted.container.querySelector('[data-layer="changes"] [data-diff="permissions.ts"]');
    assert.ok(diffButton, "per-file diff entry missing from the changes drawer");
    await act(async () => {
      fireEvent.click(diffButton!);
    });

    const card = mounted.container.querySelector('[data-layer="diff"]');
    assert.ok(card, "diff focus card did not open");
    assert.ok(card!.textContent?.includes("permissions.ts"), "the card title should carry the file name");
    assert.ok(card!.querySelector(".deck-diff-line.hunk"), "hunk header missing");
    assert.ok(card!.querySelector(".deck-diff-line.removed"), "removed line missing");
    assert.ok(card!.querySelector(".deck-diff-line.added"), "added line missing");
    const calls = stub.calls.filter((c) => c.method === "gitDiff");
    assert.deepEqual(calls[0]?.args, ["permissions.ts", false]);
  });

  test("Space brakes a running engine via pausePrompt", async () => {
    fixture.getActiveSession = async () => "sess-1";
    fixture.getSession = async () => ({ summary: "goal", status: "processing" });

    mounted = await mountDeck();
    const brakeButton = mounted.container.querySelector('[data-test-id="deck-brake"]');
    assert.ok(brakeButton, "brake button missing while the engine is running");

    await press(" ");
    const calls = stub.calls.filter((c) => c.method === "pausePrompt");
    assert.equal(calls.length, 1, `expected pausePrompt, saw ${JSON.stringify(stub.calls.map((c) => c.method))}`);
  });

  test("Space resumes a paused engine via resumePrompt", async () => {
    fixture.getActiveSession = async () => "sess-1";
    fixture.getSession = async () => ({ summary: "goal", status: "paused" });

    mounted = await mountDeck();
    await press(" ");
    const calls = stub.calls.filter((c) => c.method === "resumePrompt");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].args[0], "sess-1");
  });

  test("engine events mirror into toasts, capped at five", async () => {
    mounted = await mountDeck();
    for (let i = 0; i < 6; i++) {
      await act(async () => {
        stub.emit("onSessionEntryUpdated", { id: `sess-0000000${i}`, status: "completed" });
      });
    }

    const toasts = mounted.container.querySelectorAll(".deck-toast");
    assert.ok(toasts.length >= 1, "engine events should surface as toasts");
    assert.ok(toasts.length <= 5, `toast burst must cap at 5, saw ${toasts.length}`);
  });

  test("command layer groups results (goals/views/themes/actions)", async () => {
    mounted = await mountDeck();
    await press("k", { meta: true });

    const groups = [...mounted.container.querySelectorAll(".deck-cmd-group")].map((g) => g.textContent);
    assert.ok(groups.includes("Views"), `Views group missing, saw ${JSON.stringify(groups)}`);
    assert.ok(groups.includes("Themes"), `Themes group missing, saw ${JSON.stringify(groups)}`);
    assert.ok(groups.includes("Actions"), `Actions group missing, saw ${JSON.stringify(groups)}`);
  });

  test("sessions are searchable by title; Enter switches the work order", async () => {
    fixture.listSessions = async () => [
      {
        id: "sess-goal-1",
        summary: "修复登录白屏",
        status: "completed",
        createTime: "2026-08-20T10:00:00Z",
        updateTime: "2026-08-20T11:00:00Z",
      },
    ];
    mounted = await mountDeck();
    await press("k", { meta: true });

    const input = mounted.container.querySelector(".deck-cmd-input")!;
    await act(async () => {
      fireEvent.change(input, { target: { value: "登录白屏" } });
    });
    assert.ok(
      mounted.container.textContent?.includes("修复登录白屏"),
      "the session goal should be findable in the palette"
    );
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    const calls = stub.calls.filter((c) => c.method === "setActiveSession");
    assert.equal(calls.length, 1, `expected setActiveSession, saw ${JSON.stringify(stub.calls.map((c) => c.method))}`);
    assert.equal(calls[0].args[0], "sess-goal-1");
  });
});
