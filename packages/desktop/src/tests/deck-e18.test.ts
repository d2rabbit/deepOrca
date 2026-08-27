/**
 * Tests for the E18 knowledge-depth additions and the loud-op archive relay:
 *   - SourcesDashboard agents detail reads AGENTS.md inline via
 *     knowledgeReadAgents (root = first initialized workspace);
 *   - codegraph detail gains a debounced symbol search over
 *     knowledgeListSymbols, rendering kind/name/file:line rows;
 *   - useDeckNotifications.archive() manually archives loud operations into
 *     the drawer ring buffer and fires the toast-twin callback — the
 *     "missed ≠ lost" guarantee extended to user-initiated actions.
 */

import { test, describe, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";

import { installDom, createApiStub, type DomHandle, type ApiStub } from "./dom-harness";
// Type-only imports — runtime imports happen in before(), after the DOM and
// the api stub exist.
import type * as RTL from "@testing-library/react";
import type * as React from "react";
import type { JSX } from "react";
import type { I18nProvider as I18nProviderComponent } from "../renderer/i18n";
import type { SourcesDashboard as SourcesDashboardComponent } from "../renderer/deck/components/sources-dashboard";

let dom: DomHandle;
let stub: ApiStub;
let fixture: Record<string, unknown>;
let render: typeof RTL.render;
let act: typeof RTL.act;
let fireEvent: typeof RTL.fireEvent;
let createElement: typeof React.createElement;
let StrictMode: typeof React.StrictMode;
let I18nProvider: typeof I18nProviderComponent;
let SourcesDashboard: typeof SourcesDashboardComponent;
let ReactRT: typeof import("react");

function defaultFixture(): Record<string, unknown> {
  return {
    getActiveSession: async () => null,
    getSession: async () => null,
    knowledgeStatus: async () => ({
      codegraph: { state: "indexed" },
      openwiki: { state: "indexed" },
      agents: { state: "indexed" },
      archmaps: { state: "empty" },
    }),
    memoryRoutingStatus: async () => ({
      memory: { state: "empty" },
      routing: { state: "empty" },
      serena: { state: "empty" },
    }),
    crgList: async () => [],
    codegraphList: async () => [{ root: "/tmp/demo", label: "demo", initialized: true }],
    knowledgeReadAgents: async () => ({ ok: true, content: "# workspace rules\nbe nice" }),
    knowledgeListSymbols: async () => [],
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
  ReactRT = ReactPkg;
  createElement = ReactPkg.createElement;
  StrictMode = ReactPkg.StrictMode;
  I18nProvider = (await import("../renderer/i18n")).I18nProvider;
  SourcesDashboard = (await import("../renderer/deck/components/sources-dashboard")).SourcesDashboard;
});

after(() => dom.cleanup());
afterEach(() => {
  Object.assign(fixture, defaultFixture());
});

describe("deck E18 knowledge depth + notify archive", () => {
  async function mountSources() {
    let mounted!: { unmount(): void; container: HTMLElement };
    await act(async () => {
      mounted = render(
        createElement(StrictMode, null, createElement(I18nProvider, null, createElement(SourcesDashboard)))
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    return mounted;
  }

  const clickCard = async (mounted: { container: HTMLElement }, label: string) => {
    const card = [...mounted.container.querySelectorAll<HTMLButtonElement>(".deck-src-card")].find((b) =>
      b.textContent?.includes(label)
    );
    assert.ok(card, `${label} card missing`);
    await act(async () => {
      fireEvent.click(card);
    });
  };

  test("agents detail renders AGENTS.md content in place", async () => {
    const mounted = await mountSources();
    try {
      await clickCard(mounted, "AGENTS.md");
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      const readCall = stub.calls.filter((c) => c.method === "knowledgeReadAgents").at(-1);
      assert.ok(readCall, "knowledgeReadAgents not called");
      assert.deepEqual(readCall.args, ["/tmp/demo"]);

      const pre = mounted.container.querySelector("pre.deck-srcpage");
      assert.ok(pre?.textContent?.includes("# workspace rules"), `doc missing: ${mounted.container.innerHTML}`);
    } finally {
      mounted.unmount();
    }
  });

  test("symbol search debounces into knowledgeListSymbols and lists kind/name/file:line", async () => {
    fixture.knowledgeListSymbols = async () => [
      { name: "parseConfig", kind: "function", filePath: "src/config.ts", startLine: 42 },
    ];

    const mounted = await mountSources();
    try {
      await clickCard(mounted, "CodeGraph");
      const input = mounted.container.querySelector<HTMLInputElement>(".deck-sym-input");
      assert.ok(input, "symbol search input missing");

      await act(async () => {
        fireEvent.change(input, { target: { value: "parse" } });
        // Debounce is 250ms — flush past it inside one act.
        await new Promise((resolve) => setTimeout(resolve, 320));
      });

      const call = stub.calls.filter((c) => c.method === "knowledgeListSymbols").at(-1);
      assert.ok(call, "knowledgeListSymbols not called");
      assert.deepEqual(call.args, ["/tmp/demo", "parse"]);

      const row = [...mounted.container.querySelectorAll(".deck-row")].find((r) =>
        r.textContent?.includes("parseConfig")
      );
      assert.ok(row, "result row missing");
      assert.ok(row.textContent?.includes("function"), "kind chip missing");
      assert.ok(row.textContent?.includes("src/config.ts:42"), "file:line meta missing");
    } finally {
      mounted.unmount();
    }
  });
});

describe("deck notifications manual archive", () => {
  test("archive() lands the entry and fires the toast twin", async () => {
    const pushes: Array<{ text: string; level: string }> = [];
    const { useDeckNotifications } = await import("../renderer/deck/hooks/use-deck-notifications");

    // Probe mounts the real hook; archive() fires once on mount, and we
    // snapshot the returned store each render for assertions.
    let seen: Array<{ id: number; text: string }> = [];
    function Probe(): JSX.Element {
      const n = useDeckNotifications((notification) =>
        pushes.push({ text: notification.text, level: notification.level })
      );
      ReactRT.useEffect(() => {
        n.archive("ok", "exported to /tmp/x");
      }, []);
      seen = n.items.map((it) => ({ id: it.id, text: it.text }));
      return createElement("div");
    }

    let mounted!: { unmount(): void };
    await act(async () => {
      mounted = render(createElement(StrictMode, null, createElement(I18nProvider, null, createElement(Probe))));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    assert.ok(
      pushes.some((p) => p.level === "ok" && p.text.includes("/tmp/x")),
      `toast twin not fired: ${JSON.stringify(pushes)}`
    );
    assert.ok(
      seen.some((it) => it.text.includes("exported to /tmp/x")),
      `archived item missing from drawer buffer: ${JSON.stringify(seen)}`
    );
    mounted.unmount();
  });
});
