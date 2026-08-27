/**
 * Tests for the E15 control-center model/thinking capsules and the context
 * focus card's compaction-threshold override — the two post-merge alignment
 * points where the Deck must track the frozen line's engine contract:
 *   - setModel / setThinkingMode hot paths (same channels as the classic
 *     top bar) surface in the CC without leaving the experimental layout;
 *   - settings.compactTokenThreshold (user-configurable compaction trigger)
 *     overrides the model-family default in the context water level, exactly
 *     like the classic ContextProgress.
 *
 * Mounting: ControlCenter / ContextPanel render standalone under I18nProvider,
 * which keeps the DOM surface small; the shared getSettings snapshot hook is
 * what these tests exercise indirectly through both components in one file.
 */

import { test, describe, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";

import { installDom, createApiStub, type DomHandle, type ApiStub } from "./dom-harness";
// Type-only imports — runtime imports happen in before(), after the DOM and
// the api stub exist.
import type * as RTL from "@testing-library/react";
import type * as React from "react";
import type { I18nProvider as I18nProviderComponent } from "../renderer/i18n";
import type { ControlCenter as ControlCenterComponent } from "../renderer/deck/components/control-center";
import type { ContextPanel as ContextPanelComponent } from "../renderer/deck/components/session-panels";
import type { SettingsSummary } from "../shared/ipc";

let dom: DomHandle;
let stub: ApiStub;
let fixture: Record<string, unknown>;
let render: typeof RTL.render;
let act: typeof RTL.act;
let fireEvent: typeof RTL.fireEvent;
let createElement: typeof React.createElement;
let StrictMode: typeof React.StrictMode;
let I18nProvider: typeof I18nProviderComponent;
let ControlCenter: typeof ControlCenterComponent;
let ContextPanel: typeof ContextPanelComponent;

const SETTINGS: SettingsSummary = {
  model: "deepseek-v4-flash",
  baseURL: "https://api.deepseek.example",
  thinkingEnabled: true,
  reasoningEffort: "high",
  hasApiKey: true,
  statusSeparator: "",
  endpoints: [
    {
      id: "ep1",
      name: "Primary",
      baseURL: "https://api.deepseek.example",
      models: [
        { id: "deepseek-v4-pro", thinking: true },
        { id: "deepseek-v4-flash", thinking: true },
      ],
    },
  ],
  primaryEndpointId: "ep1",
  secondaryModel: "",
  secondaryEndpointId: "",
  visionModel: "",
  visionEndpointId: "",
  workspaceTrust: "trusted",
} as unknown as SettingsSummary;

function defaultFixture(): Record<string, unknown> {
  return {
    getActiveSession: async () => null,
    getSession: async () => null,
    getSettings: async () => SETTINGS,
    setModel: async () => SETTINGS,
    setThinkingMode: async () => SETTINGS,
  };
}

before(async () => {
  dom = installDom();
  const win = (globalThis as unknown as { window: Window }).window;
  Object.defineProperty(globalThis, "localStorage", { value: win.localStorage, configurable: true });

  fixture = defaultFixture();
  stub = createApiStub(fixture);
  // One stub for the whole file: renderer/api.ts captures window.deeporca at
  // module load, so per-test rebinding would go unseen — later tests mutate
  // `fixture` IN PLACE instead (the proxy reads overrides at call time).
  (globalThis as unknown as { window: { deeporca: unknown } }).window.deeporca = stub.api;

  const rtl = await import("@testing-library/react");
  render = rtl.render;
  act = rtl.act;
  fireEvent = rtl.fireEvent;
  const ReactPkg = await import("react");
  createElement = ReactPkg.createElement;
  StrictMode = ReactPkg.StrictMode;
  I18nProvider = (await import("../renderer/i18n")).I18nProvider;
  ControlCenter = (await import("../renderer/deck/components/control-center")).ControlCenter;
  ContextPanel = (await import("../renderer/deck/components/session-panels")).ContextPanel;
});

after(() => dom.cleanup());
afterEach(() => {
  // Reset the shared fixture in place (same identity, default members).
  Object.assign(fixture, defaultFixture());
});

describe("deck E15 model/thinking capsules + threshold override", () => {
  async function mountCC() {
    let mounted!: { unmount(): void; container: HTMLElement };
    await act(async () => {
      mounted = render(
        createElement(
          StrictMode,
          null,
          createElement(
            I18nProvider,
            null,
            createElement(ControlCenter, {
              entry: null,
              busy: false,
              commandLog: [],
              events: [],
            })
          )
        )
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    return mounted;
  }

  test("model capsule lists the endpoint registry and reflects the active model", async () => {
    const mounted = await mountCC();
    try {
      const model = mounted.container.querySelector<HTMLSelectElement>(".deck-cc-model");
      assert.ok(model, "model select missing");
      assert.equal(model.value, "ep1/deepseek-v4-flash", `unexpected active key: ${model.value}`);
      assert.equal(model.options.length, 2, "endpoint registry models missing");

      const think = mounted.container.querySelector<HTMLSelectElement>(".deck-cc-think");
      assert.ok(think, "thinking select missing");
      assert.ok(
        [...think.options].some((o) => o.value === "off"),
        "off tier missing"
      );
    } finally {
      mounted.unmount();
    }
  });

  test("switching the model routes through setModel with capability-aware thinking", async () => {
    const mounted = await mountCC();
    try {
      const model = mounted.container.querySelector<HTMLSelectElement>(".deck-cc-model")!;
      await act(async () => {
        fireEvent.change(model, { target: { value: "ep1/deepseek-v4-pro" } });
      });

      const call = stub.calls.filter((c) => c.method === "setModel").at(-1);
      assert.ok(call, "setModel not called");
      assert.deepEqual(call.args[0], {
        model: "deepseek-v4-pro",
        endpointId: "ep1",
        thinkingEnabled: true,
        reasoningEffort: "high",
      });
    } finally {
      mounted.unmount();
    }
  });

  test("thinking select hot-patches via setThinkingMode", async () => {
    const mounted = await mountCC();
    try {
      const think = mounted.container.querySelector<HTMLSelectElement>(".deck-cc-think")!;
      await act(async () => {
        fireEvent.change(think, { target: { value: "off" } });
      });

      const call = stub.calls.filter((c) => c.method === "setThinkingMode").at(-1);
      assert.ok(call, "setThinkingMode not called");
      assert.deepEqual(call.args[0], {
        thinkingEnabled: false,
        reasoningEffort: "high",
      });
    } finally {
      mounted.unmount();
    }
  });

  test("context panel honors the user's compactTokenThreshold override", async () => {
    fixture.getSettings = async () => ({ ...SETTINGS, compactTokenThreshold: 200000 }) as unknown as SettingsSummary;

    const engine = {
      entry: {
        id: "s1",
        sessionId: "s1",
        summary: "goal",
        status: "completed",
        createTime: new Date().toISOString(),
        updateTime: new Date().toISOString(),
        activeTokens: 100000,
        usagePerModel: { "deepseek-v4-pro": { total_tokens: 50 } },
      },
    };
    let mounted!: { unmount(): void; container: HTMLElement };
    await act(async () => {
      mounted = render(createElement(I18nProvider, null, createElement(ContextPanel, { engine: engine as never })));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    try {
      const thresholdKv = [...mounted.container.querySelectorAll(".deck-kv")].find((kv) =>
        kv.textContent?.includes("200.0k")
      );
      assert.ok(thresholdKv, `override threshold not rendered: ${mounted.container.innerHTML}`);
    } finally {
      mounted.unmount();
    }
  });

  test("CC context meter takes a water-level tone near the compaction threshold", async () => {
    // 194k active vs 200k override = 97% → "bad" (≥95%); 180k = 90% → "warn".
    fixture.getSettings = async () => ({ ...SETTINGS, compactTokenThreshold: 200000 }) as unknown as SettingsSummary;

    const entryBase = {
      id: "s1",
      sessionId: "s1",
      summary: "goal",
      status: "completed",
      createTime: new Date().toISOString(),
      updateTime: new Date().toISOString(),
      usagePerModel: { "deepseek-v4-pro": { total_tokens: 50 } },
    };
    let mounted!: { unmount(): void; container: HTMLElement };
    await act(async () => {
      mounted = render(
        createElement(
          I18nProvider,
          null,
          createElement(ControlCenter, {
            entry: {
              ...entryBase,
              activeTokens: 194000,
            } as never,
            busy: false,
            commandLog: [],
            events: [],
          })
        )
      );
    });
    try {
      const meter = mounted.container.querySelector<HTMLElement>(".deck-meter.bad");
      assert.ok(meter, `bad-tone context meter missing: ${mounted.container.innerHTML}`);
      assert.ok(meter.querySelector(".v")?.textContent?.includes("194.0k"));
    } finally {
      mounted.unmount();
    }

    await act(async () => {
      mounted = render(
        createElement(
          I18nProvider,
          null,
          createElement(ControlCenter, {
            entry: {
              ...entryBase,
              activeTokens: 180000,
            } as never,
            busy: false,
            commandLog: [],
            events: [],
          })
        )
      );
    });
    try {
      assert.ok(mounted.container.querySelector(".deck-meter.warn"), "warn tone missing at 90%");
      assert.equal(mounted.container.querySelector(".deck-meter.bad"), null, "no bad tone at 90%");
    } finally {
      mounted.unmount();
    }
  });
});
