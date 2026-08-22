/**
 * Guard tests for the Orca Deck experimental layout (experiment-plan v3, E0).
 *
 * Pins the behaviour the E0 acceptance criteria depend on:
 *   - layout switch persistence and its classic-first defaults (lib/layout.ts)
 *   - DeckApp renders the goal band, the 18-entry module dock, and the
 *     always-reachable "back to classic" escape hatch
 *   - the goal band reflects the active session summary when one exists
 *   - clicking the escape hatch persists classic (the reload itself is a
 *     jsdom no-op — what matters is the persisted fallback state)
 *
 * The chunk-404 fallback in main.tsx is not exercised here (main.tsx runs its
 * bootstrap at import time and cannot be mounted in jsdom); it is covered by
 * code review plus these lib-level guarantees that the persisted state always
 * resolves to a bootable layout.
 */

import { test, describe, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { installDom, createApiStub, type DomHandle, type ApiStub } from "./dom-harness";
// Type-only imports (erased at compile time) — runtime imports happen in
// before(), after the DOM and the api stub exist.
import type * as RTL from "@testing-library/react";
import type * as React from "react";
import type { DeckApp as DeckAppComponent } from "../renderer/deck/deck-app";
import type { I18nProvider as I18nProviderComponent } from "../renderer/i18n";
import type * as Layout from "../renderer/lib/layout";

let dom: DomHandle;
let stub: ApiStub;
let fixture: Record<string, unknown>;
let render: typeof RTL.render;
let act: typeof RTL.act;
let fireEvent: typeof RTL.fireEvent;
let createElement: typeof React.createElement;
let StrictMode: typeof React.StrictMode;
let layout: typeof Layout;
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
  // lib/layout.ts reads the bare `localStorage` global; the harness only
  // installs window, so bridge jsdom's storage onto globalThis.
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
  layout = await import("../renderer/lib/layout");
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

describe("layout switch (lib/layout.ts)", () => {
  test("defaults to classic when unset or holding an invalid value", () => {
    assert.equal(layout.resolveLayout(), "classic");
    localStorage.setItem("deeporca.layout", "garbage");
    assert.equal(layout.resolveLayout(), "classic");
  });

  test("switchLayout persists the choice and resolves it back", () => {
    layout.switchLayout("deck"); // window.location.reload is a jsdom no-op
    assert.equal(localStorage.getItem("deeporca.layout"), "deck");
    assert.equal(layout.resolveLayout(), "deck");
  });

  test("resetLayoutToClassic persists classic without a reload", () => {
    localStorage.setItem("deeporca.layout", "deck");
    layout.resetLayoutToClassic();
    assert.equal(localStorage.getItem("deeporca.layout"), "classic");
    assert.equal(layout.resolveLayout(), "classic");
  });
});

describe("DeckApp skeleton", () => {
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

  test("renders the goal band, 19 dock entries and the escape hatch", async () => {
    mounted = await mountDeck();

    assert.ok(
      mounted.container.querySelector('.deck-app[data-deck-theme="liquid"]'),
      "expected the liquid theme scope on the deck root"
    );
    assert.ok(mounted.container.querySelector(".deck-ribbon"), "goal band missing");

    const dockButtons = mounted.container.querySelectorAll(".deck-dock button.deck-dicon");
    assert.equal(
      dockButtons.length,
      19,
      `expected the 19 dock entries (design demo 18 + Studio, E9), saw ${dockButtons.length}`
    );

    assert.ok(mounted.container.querySelector(".deck-back"), "the back-to-classic escape hatch must always be present");
  });

  test("goal band shows the active session summary when one exists", async () => {
    fixture.getActiveSession = async () => "sess-1";
    fixture.getSession = async () => ({ summary: "修复登录页白屏" });

    mounted = await mountDeck();
    assert.ok(
      mounted.container.textContent?.includes("修复登录页白屏"),
      `expected the goal band to show the session summary, saw: ${mounted.container.textContent}`
    );
  });

  test("clicking the escape hatch persists classic", async () => {
    localStorage.setItem("deeporca.layout", "deck");
    mounted = await mountDeck();

    const back = mounted.container.querySelector(".deck-back");
    assert.ok(back, "escape hatch missing");
    await act(async () => {
      back.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    assert.equal(localStorage.getItem("deeporca.layout"), "classic");
    assert.equal(layout.resolveLayout(), "classic");
  });
});

/** Build a minimal SessionMessage for fixtures. */
function msg(overrides: Record<string, unknown>): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    id: `m-${Math.random().toString(36).slice(2, 8)}`,
    sessionId: "sess-1",
    role: "assistant",
    content: "",
    contentParams: null,
    messageParams: null,
    compacted: false,
    visible: true,
    createTime: now,
    updateTime: now,
    ...overrides,
  };
}

describe("Deck E1 core loop", () => {
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

  test("command input sends the prompt through sendPrompt", async () => {
    fixture.sendPrompt = async () => ({ ok: true });
    mounted = await mountDeck();

    // 设计稿形态：主区没有聊天框，下达指令走控制中心的指令输入。
    const input = mounted.container.querySelector(".deck-cc-input input");
    assert.ok(input, "control-center directive input missing");
    await act(async () => {
      fireEvent.change(input!, { target: { value: "修复登录页" } });
    });
    const send = mounted.container.querySelector(".deck-cc-send");
    assert.ok(send, "directive send button missing");
    await act(async () => {
      fireEvent.click(send!);
    });

    const calls = stub.calls.filter((c) => c.method === "sendPrompt");
    assert.equal(calls.length, 1, `expected one sendPrompt call, saw ${JSON.stringify(stub.calls)}`);
    assert.deepEqual(calls[0].args[0], { text: "修复登录页" });
  });

  test("pending card approves via /continue carrying the decision payload", async () => {
    fixture.getActiveSession = async () => "sess-1";
    fixture.getSession = async () => ({
      summary: "goal",
      status: "ask_permission",
      askPermissions: [{ toolCallId: "tc1", name: "bash", command: "rm -rf x", scopes: ["delete-in-cwd"] }],
    });
    fixture.sendPrompt = async () => ({ ok: true });
    mounted = await mountDeck();

    assert.ok(mounted.container.querySelector(".deck-pending"), "pending card missing");

    const allow = mounted.container.querySelector(".deck-op.allow");
    await act(async () => {
      fireEvent.click(allow!);
    });
    const submit = mounted.container.querySelector(".deck-pending-submit .deck-op.primary");
    await act(async () => {
      fireEvent.click(submit!);
    });

    const calls = stub.calls.filter((c) => c.method === "sendPrompt");
    assert.equal(calls.length, 1);
    const payload = calls[0].args[0] as Record<string, unknown>;
    assert.equal(payload.text, "/continue");
    assert.deepEqual(payload.permissions, [{ toolCallId: "tc1", permission: "allow" }]);
  });

  test("pending card deny route calls denyPermission", async () => {
    fixture.getActiveSession = async () => "sess-1";
    fixture.getSession = async () => ({
      summary: "goal",
      status: "ask_permission",
      askPermissions: [{ toolCallId: "tc1", name: "bash", command: "rm -rf x", scopes: ["delete-in-cwd"] }],
    });
    mounted = await mountDeck();

    const deny = mounted.container.querySelector(".deck-op.deny");
    const submit = mounted.container.querySelector(".deck-pending-submit .deck-op.primary");
    await act(async () => {
      fireEvent.click(deny!);
    });
    await act(async () => {
      fireEvent.click(submit!);
    });

    const calls = stub.calls.filter((c) => c.method === "denyPermission");
    assert.equal(calls.length, 1, `expected denyPermission, saw ${JSON.stringify(stub.calls)}`);
    assert.equal(stub.calls.filter((c) => c.method === "sendPrompt").length, 0);
  });

  test("step board renders the UpdatePlan checklist and goal-band progress dots", async () => {
    fixture.getActiveSession = async () => "sess-1";
    fixture.getSession = async () => ({ summary: "goal", status: "completed" });
    fixture.listMessages = async () => [
      msg({
        role: "tool",
        content: JSON.stringify({
          name: "UpdatePlan",
          ok: true,
          metadata: { plan: "- [ ] 任务A\n- [x] 任务B" },
        }),
      }),
    ];
    mounted = await mountDeck();

    const items = mounted.container.querySelectorAll(".deck-stepboard .deck-schip");
    assert.equal(items.length, 2, `expected 2 plan steps, saw ${items.length}`);
    assert.equal(mounted.container.querySelectorAll(".deck-stepboard .deck-schip.done").length, 1);
    assert.ok(mounted.container.querySelector(".deck-mini-steps .mn.done"), "goal band progress dots missing");
    assert.ok(
      mounted.container.querySelector(".deck-mini-steps .mn.live"),
      "the first not-done step should read as the live dot"
    );
  });

  test("tape overlay streams real messages through the markdown pipeline", async () => {
    fixture.getActiveSession = async () => "sess-1";
    fixture.getSession = async () => ({ summary: "goal", status: "completed" });
    fixture.listMessages = async () => [
      msg({ role: "user", content: "你好" }),
      msg({ role: "assistant", content: "**加粗** 回复" }),
    ];
    mounted = await mountDeck();

    // Open Tape via the dock's second entry.
    const tapeButton = mounted.container.querySelectorAll(".deck-dock button.deck-dicon")[1];
    await act(async () => {
      fireEvent.click(tapeButton);
    });

    const tape = mounted.container.querySelector(".deck-tape");
    assert.ok(tape, "tape overlay did not open");
    assert.ok(tape!.textContent?.includes("你好"), "user message missing from tape");
    assert.ok(tape!.querySelector(".deck-md strong"), "assistant markdown was not rendered");
  });
});
