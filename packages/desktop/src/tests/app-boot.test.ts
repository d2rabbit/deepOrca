/**
 * Guard tests for App.tsx.
 *
 * App.tsx is ~1.8k lines holding ~20 concerns in one component (53 useState, 53
 * useCallback, 9 useEffect). These tests pin the behaviour a decomposition into
 * per-domain hooks is most likely to break, so the refactor can be *shown* to be
 * behaviour-preserving rather than merely looking right:
 *
 *   - boot calls api.ready() and runs its whole chain through getActiveSession()
 *   - every event subscribed on mount is unsubscribed on unmount
 *   - a failing boot is reported instead of dying silently
 *
 * Structure note: the DOM and the api stub are installed **once per file**, not
 * per test. `renderer/api.ts` is `export const api = window.deeporca`, evaluated at
 * module load, so the component binds to whatever stub existed at first import —
 * rebuilding the stub per test would leave App talking to a stale one. The stub
 * therefore reads a mutable fixture and is reset between tests.
 */

import { test, describe, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { installDom, createApiStub, type DomHandle, type ApiStub } from "./dom-harness";
// Type-only imports: erased at compile time (verbatimModuleSyntax), so they do
// NOT load these modules — the runtime imports still happen inside before(),
// after the DOM and stub exist.
import type * as RTL from "@testing-library/react";
import type * as React from "react";
import type { App as AppComponent } from "../renderer/App";
import type { I18nProvider as I18nProviderComponent } from "../renderer/i18n";

const READY = { projectRoot: "/tmp/guard-project", platform: "darwin", homeDir: "/tmp/guard-home" };

/** Default clean-boot behaviour. Mutated in place by tests that need a variant. */
function defaultFixture(): Record<string, unknown> {
  return {
    ready: async () => READY,
    getActiveSession: async () => null,
    // Only object/scalar-returning members need listing — the stub defaults the
    // rest to []. These are here because a child consumes the shape directly
    // (Sidebar does `tree.workspaces` on listWorkspaceSessions()).
    listWorkspaceSessions: async () => ({ workspaces: [], archived: [] }),
    getSettings: async () => ({}),
    getEditableSettings: async () => ({}),
    gitStatus: async () => ({ branch: null, conflicted: [], stashes: [] }),
  };
}

let dom: DomHandle;
let stub: ApiStub;
let fixture: Record<string, unknown>;
let render: typeof RTL.render;
let act: typeof RTL.act;
let createElement: typeof React.createElement;
let StrictMode: typeof React.StrictMode;
let App: typeof AppComponent;
let I18nProvider: typeof I18nProviderComponent;
let mounted: { unmount(): void; container: HTMLElement } | null = null;

before(async () => {
  dom = installDom();
  fixture = defaultFixture();
  stub = createApiStub(fixture);
  (globalThis as unknown as { window: { deeporca: unknown } }).window.deeporca = stub.api;

  // Imported only after the DOM + stub exist (see file header).
  const rtl = await import("@testing-library/react");
  const react = await import("react");
  render = rtl.render;
  act = rtl.act;
  createElement = react.createElement;
  StrictMode = react.StrictMode;
  App = (await import("../renderer/App")).App;
  I18nProvider = (await import("../renderer/i18n")).I18nProvider;
});

after(() => {
  dom?.cleanup();
});

beforeEach(() => {
  Object.assign(fixture, defaultFixture());
  stub.reset();
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

async function mountApp(): Promise<{ unmount(): void; container: HTMLElement }> {
  let result!: ReturnType<typeof render>;
  await act(async () => {
    // Mirror main.tsx exactly: StrictMode > I18nProvider > App. StrictMode is
    // deliberate — it double-invokes effects, which is how a subscribe/unsubscribe
    // asymmetry shows up.
    result = render(createElement(StrictMode, null, createElement(I18nProvider, null, createElement(App))));
  });
  // Let the boot chain (ready → refresh* → getActiveSession) settle.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  return { unmount: () => result.unmount(), container: result.container };
}

describe("App boot contract", () => {
  test("renders and runs the full boot chain", async () => {
    mounted = await mountApp();
    const methods = stub.calls.map((call) => call.method);

    assert.ok(methods.includes("ready"), `expected api.ready() during boot, saw: ${methods.join(", ")}`);
    // Boot must reach the end of its chain, not stop at ready().
    assert.ok(
      methods.includes("getActiveSession"),
      `expected boot to reach getActiveSession(), saw: ${methods.join(", ")}`
    );
    assert.ok(mounted.container.querySelector("*"), "expected App to render some DOM");
  });

  test("unmount unsubscribes every event it subscribed on mount", async () => {
    mounted = await mountApp();

    const subscribed = stub.activeSubscriptions();
    assert.ok(subscribed.length > 0, "expected App to subscribe to main-process events");
    assert.ok(
      subscribed.includes("onAssistantMessage"),
      `expected an onAssistantMessage subscription, saw: ${subscribed.join(", ")}`
    );

    mounted.unmount();
    mounted = null;

    assert.deepEqual(
      stub.activeSubscriptions(),
      [],
      `unmount leaked event subscriptions: ${stub.activeSubscriptions().join(", ")}`
    );
  });

  test("a failing boot is reported instead of failing silently", async () => {
    fixture.ready = async () => {
      throw new Error("boot exploded");
    };

    const originalError = console.error;
    const logged: string[] = [];
    console.error = (...args: unknown[]) => logged.push(args.map((a) => String(a)).join(" "));
    try {
      mounted = await mountApp();
      // App.tsx catches boot failures and both logs and surfaces them; assert the
      // observable half plus that the tree still mounted rather than throwing.
      assert.ok(
        logged.some((line) => line.includes("boot exploded")),
        `expected the boot failure to be reported, saw: ${JSON.stringify(logged)}`
      );
      assert.ok(mounted.container.querySelector("*"), "App must still render after a failed boot");
    } finally {
      console.error = originalError;
    }
  });
});
