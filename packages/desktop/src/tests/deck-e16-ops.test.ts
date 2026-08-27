/**
 * Tests for the E16 floor-wall session ops and the archmaps inline preview:
 *   - FloorPanel: hover op cluster per non-active card — rename (inline
 *     edit → renameSession), archive (existing ✕), delete with a two-step
 *     in-place confirmation (mirrors the classic confirm-on-delete rule);
 *     the active session never offers ops.
 *   - SourcesDashboard: archmap files are clickable and open an inline view —
 *     HTML boards land in a fully sandboxed iframe, failures render as an
 *     honest empty state.
 */

import { test, describe, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";

import { installDom, createApiStub, type DomHandle, type ApiStub } from "./dom-harness";
// Type-only imports — runtime imports happen in before(), after the DOM and
// the api stub exist.
import type * as RTL from "@testing-library/react";
import type * as React from "react";
import type { I18nProvider as I18nProviderComponent } from "../renderer/i18n";
import type { FloorPanel as FloorPanelComponent } from "../renderer/deck/components/session-panels";
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
let FloorPanel: typeof FloorPanelComponent;
let SourcesDashboard: typeof SourcesDashboardComponent;

function entry(id: string, summary: string): Record<string, unknown> {
  return {
    id,
    summary,
    status: "completed",
    createTime: "2026-08-27T08:00:00Z",
    updateTime: "2026-08-27T09:00:00Z",
  };
}

function defaultFixture(): Record<string, unknown> {
  return {
    getActiveSession: async () => null,
    getSession: async () => null,
    listWorkspaceSessions: async () => ({
      workspaces: [
        {
          root: "/tmp/demo",
          label: "demo",
          sessions: [entry("sess-1", "alpha"), entry("sess-2", "beta")],
        },
      ],
    }),
    renameSession: async () => true,
    deleteSession: async () => true,
    archiveSession: async () => undefined,
    exportSession: async () => ({ ok: true, path: "/tmp/exported.json" }),
    memoryRoutingStatus: async () => ({
      memory: { state: "indexed", count: 1 },
      routing: { state: "indexed" },
      serena: { state: "empty" },
    }),
    crgList: async () => [],
  };
}

before(async () => {
  dom = installDom();
  const win = (globalThis as unknown as { window: Window }).window;
  Object.defineProperty(globalThis, "localStorage", { value: win.localStorage, configurable: true });

  fixture = defaultFixture();
  // One stub for the whole file — renderer/api.ts captures window.deeporca at
  // module load, so later tests mutate `fixture` IN PLACE.
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
  FloorPanel = (await import("../renderer/deck/components/session-panels")).FloorPanel;
  SourcesDashboard = (await import("../renderer/deck/components/sources-dashboard")).SourcesDashboard;
});

after(() => dom.cleanup());
afterEach(() => {
  Object.assign(fixture, defaultFixture());
});

describe("deck E16 floor ops + archmap preview", () => {
  async function mount(ui: React.ReactElement) {
    let mounted!: { unmount(): void; container: HTMLElement };
    await act(async () => {
      mounted = render(createElement(StrictMode, null, createElement(I18nProvider, null, ui)));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    return mounted;
  }

  test("rename flows through the inline editor into renameSession", async () => {
    const mounted = await mount(createElement(FloorPanel, { engine: fakeEngine(), onClose: () => {} }));
    try {
      const pen = [...mounted.container.querySelectorAll<HTMLElement>(".deck-wo-op")].find(
        (el) => el.getAttribute("title") === "Rename"
      );
      assert.ok(pen, "rename op missing");
      await act(async () => {
        fireEvent.click(pen);
      });

      const input = mounted.container.querySelector<HTMLInputElement>(".deck-wo-rename input");
      assert.ok(input, "rename editor missing");
      assert.equal(input.value, "alpha");

      await act(async () => {
        fireEvent.change(input, { target: { value: "alpha v2" } });
        fireEvent.submit(input.closest("form")!);
      });

      const call = stub.calls.filter((c) => c.method === "renameSession").at(-1);
      assert.ok(call, "renameSession not called");
      assert.deepEqual(call.args, ["sess-1", "alpha v2"]);
    } finally {
      mounted.unmount();
    }
  });

  test("delete arms first, removes on the second click", async () => {
    const mounted = await mount(createElement(FloorPanel, { engine: fakeEngine(), onClose: () => {} }));
    try {
      const del = [...mounted.container.querySelectorAll<HTMLElement>(".deck-wo-op")].find(
        (el) => el.getAttribute("title") === "Delete"
      );
      assert.ok(del, "delete op missing");

      await act(async () => {
        fireEvent.click(del);
      });
      assert.ok(del.classList.contains("armed"), "first click should arm");
      assert.equal(stub.calls.filter((c) => c.method === "deleteSession").length, 0, "premature delete");

      await act(async () => {
        fireEvent.click(del);
      });
      const call = stub.calls.filter((c) => c.method === "deleteSession").at(-1);
      assert.ok(call, "deleteSession not called");
      assert.deepEqual(call.args, ["sess-1"]);
    } finally {
      mounted.unmount();
    }
  });

  test("export routes through exportSession and reports the destination via notify", async () => {
    const notifications: Array<{ text: string; kind: string }> = [];
    const mounted = await mount(
      createElement(FloorPanel, {
        engine: fakeEngine(),
        onClose: () => {},
        onNotify: (text, kind) => notifications.push({ text, kind }),
      })
    );
    try {
      fixture.exportSession = async () => ({ ok: true, path: "/tmp/alpha-session.json" });

      const exp = [...mounted.container.querySelectorAll<HTMLElement>(".deck-wo-op")].find(
        (el) => el.getAttribute("title") === "Export"
      );
      assert.ok(exp, "export op missing");
      await act(async () => {
        fireEvent.click(exp);
      });

      const call = stub.calls.filter((c) => c.method === "exportSession").at(-1);
      assert.ok(call, "exportSession not called");
      assert.deepEqual(call.args, ["sess-1"]);

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      assert.ok(
        notifications.some((n) => n.kind === "ok" && n.text.includes("/tmp/alpha-session.json")),
        `ok toast with path missing: ${JSON.stringify(notifications)}`
      );
    } finally {
      mounted.unmount();
    }
  });

  test("failed export surfaces a bad toast, cancel stays quiet", async () => {
    const notifications: Array<{ text: string; kind: string }> = [];
    const mounted = await mount(
      createElement(FloorPanel, {
        engine: fakeEngine(),
        onClose: () => {},
        onNotify: (text, kind) => notifications.push({ text, kind }),
      })
    );
    try {
      fixture.exportSession = async () => ({ ok: false, error: "denied" });

      const exp = [...mounted.container.querySelectorAll<HTMLElement>(".deck-wo-op")].find(
        (el) => el.getAttribute("title") === "Export"
      )!;
      await act(async () => {
        fireEvent.click(exp);
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      assert.ok(
        notifications.some((n) => n.kind === "bad" && n.text.includes("denied")),
        `bad toast missing: ${JSON.stringify(notifications)}`
      );

      // User cancels the save dialog: ok without a path is silence, not an error.
      notifications.length = 0;
      fixture.exportSession = async () => ({ ok: true });
      await act(async () => {
        fireEvent.click(exp);
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      assert.equal(notifications.length, 0, "cancel must not toast");
    } finally {
      mounted.unmount();
    }
  });

  test("archmap files open inline — html boards land in a sandboxed iframe", async () => {
    fixture.knowledgeStatus = async () =>
      ({
        codegraph: { state: "indexed" },
        openwiki: { state: "indexed" },
        agents: { state: "indexed" },
        archmaps: {
          state: "indexed",
          count: 1,
          files: [{ name: "overview.html", path: "/tmp/demo/archmaps/overview.html", mtime: "2026-08-27T08:00:00Z" }],
        },
      }) as never;
    fixture.knowledgeReadArchmap = async () => ({ ok: true, html: "<main>board</main>" });

    const mounted = await mount(createElement(SourcesDashboard));
    try {
      const card = [...mounted.container.querySelectorAll<HTMLButtonElement>(".deck-src-card")].find((b) =>
        b.textContent?.includes("ArchMaps")
      );
      assert.ok(card, "ArchMaps card missing");
      await act(async () => {
        fireEvent.click(card);
      });

      const row = mounted.container.querySelector<HTMLButtonElement>(".deck-row.linked");
      assert.ok(row, "archmap file row missing");
      await act(async () => {
        fireEvent.click(row);
      });

      const frame = mounted.container.querySelector<HTMLIFrameElement>("iframe.deck-archview-board");
      assert.ok(frame, "board iframe missing");
      assert.equal(frame.getAttribute("sandbox"), "", "iframe must be fully sandboxed");
      assert.ok(frame.getAttribute("srcdoc")?.includes("board"), "board markup missing from srcDoc");

      const readCall = stub.calls.filter((c) => c.method === "knowledgeReadArchmap").at(-1);
      assert.ok(readCall, "knowledgeReadArchmap not called");
      assert.deepEqual(readCall.args, ["/tmp/demo/archmaps/overview.html"]);
    } finally {
      mounted.unmount();
    }
  });
});

/** Minimal DeckEngine stand-in — FloorPanel only reads activeId/selectSession/onClose. */
function fakeEngine(): never {
  return {
    activeId: "active-0",
    selectSession: async () => {},
    onClose: () => {},
  } as never;
}
