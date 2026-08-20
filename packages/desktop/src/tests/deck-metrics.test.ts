/**
 * §6 metrics guard tests (experiment-plan.md): the core-path funnel and
 * switch/boot bookkeeping that review points #1/#2 decide from.
 *
 *   - the api proxy is transparent: delegation and return values untouched
 *   - funnel state machine: prompt → approval (granted/denied) → diff, with
 *     click counts and layout attribution; a superseded prompt records an
 *     incomplete run
 *   - boot + layout-switch events land in the ring-capped store
 *   - summary math over stored runs
 *   - the E0 hard acceptance pin: ten layout switches keep the persisted
 *     choice always valid and bootable
 *   - fail-open: a broken localStorage never breaks the app
 */

import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { installDom, type DomHandle } from "./dom-harness";
import type * as Metrics from "../renderer/lib/core-path-metrics";
import type * as Layout from "../renderer/lib/layout";
import type { DesktopApi } from "../shared/ipc";

let dom: DomHandle;
let metrics: typeof Metrics;
let layout: typeof Layout;

before(async () => {
  dom = installDom();
  const win = (globalThis as unknown as { window: Window }).window;
  Object.defineProperty(globalThis, "localStorage", { value: win.localStorage, configurable: true });
  metrics = await import("../renderer/lib/core-path-metrics");
  layout = await import("../renderer/lib/layout");
});

after(() => {
  dom?.cleanup();
});

beforeEach(() => {
  metrics.__resetCorePathMetricsForTest();
  localStorage.clear();
});

/** Minimal fake preload api — only what the funnel watches needs to exist. */
function fakeApi(): DesktopApi {
  const impl = {
    sendPrompt: async () => ({ ok: true }),
    denyPermission: async () => undefined,
    gitDiff: async () => ({ files: [] }),
    gitCommitDiff: async () => ({ files: [] }),
    agentChangesDiff: async () => ({ files: [] }),
    interrupt: async () => undefined,
  };
  return impl as unknown as DesktopApi;
}

describe("core-path metrics (lib/core-path-metrics.ts)", () => {
  test("instrumentCorePath delegates transparently and returns the wrapped value", async () => {
    const api = metrics.instrumentCorePath(fakeApi());
    const result = await api.sendPrompt({ text: "hello" });
    assert.deepEqual(result, { ok: true });
  });

  test("boot bookkeeping attributes the current layout", () => {
    metrics.__resetCorePathMetricsForTest();
    localStorage.setItem("deeporca.layout", "deck");
    metrics.instrumentCorePath(fakeApi());

    const summary = metrics.readCorePathMetrics();
    assert.equal(summary.boots.deck, 1);
    assert.equal(summary.boots.classic, 0);
  });

  test("full funnel: prompt → granted approval → diff, with clicks and layout", async () => {
    localStorage.setItem("deeporca.layout", "deck");
    const api = metrics.instrumentCorePath(fakeApi());

    await api.sendPrompt({ text: "修复登录页" });
    assert.ok(metrics.getActiveCorePathRun(), "a fresh prompt must open the funnel");

    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await api.sendPrompt({ text: "/continue", permissions: [{ toolCallId: "t1", permission: "allow" }] });
    await api.gitDiff("a.ts", false);

    assert.equal(metrics.getActiveCorePathRun(), null, "diff must close the funnel");
    const summary = metrics.readCorePathMetrics();
    assert.ok(summary.runs.deck, "deck run missing");
    assert.equal(summary.runs.deck!.completed, 1);
    assert.equal(summary.runs.deck!.avgClicks, 2);
    const stored = JSON.parse(localStorage.getItem("deeporca.experiment.metrics") ?? "{}");
    assert.equal(stored.runs.length, 1);
    assert.equal(stored.runs[0].approval, "granted");
    assert.equal(stored.runs[0].layout, "deck");
  });

  test("deny path records a denied-approval run", async () => {
    const api = metrics.instrumentCorePath(fakeApi());
    await api.sendPrompt({ text: "做点什么都行" });
    await api.denyPermission();
    await api.agentChangesDiff("sess-1", "a.ts");

    const stored = JSON.parse(localStorage.getItem("deeporca.experiment.metrics") ?? "{}");
    assert.equal(stored.runs.length, 1);
    assert.equal(stored.runs[0].approval, "denied");
    assert.equal(stored.runs[0].completed, true);
  });

  test("a superseding prompt closes the previous run as incomplete", async () => {
    const api = metrics.instrumentCorePath(fakeApi());
    await api.sendPrompt({ text: "第一个问题" });
    await api.sendPrompt({ text: "第二个问题" });
    await api.gitDiff("a.ts", false);

    const summary = metrics.readCorePathMetrics();
    assert.equal(summary.runs.classic?.runs, 2);
    assert.equal(summary.runs.classic?.completed, 1, "only the second run reached diff");
  });

  test("switchLayout records the switch with its pre-flip origin", () => {
    localStorage.setItem("deeporca.layout", "deck");
    layout.switchLayout("classic"); // reload is a jsdom no-op
    layout.switchLayout("deck");

    const summary = metrics.readCorePathMetrics();
    assert.equal(summary.switches.toClassic, 1);
    assert.equal(summary.switches.toDeck, 1);
  });

  test("runs ring-cap at 200 entries", async () => {
    const api = metrics.instrumentCorePath(fakeApi());
    for (let i = 0; i < 205; i++) {
      await api.sendPrompt({ text: `q${i}` });
      await api.gitDiff("a.ts", false);
    }
    const stored = JSON.parse(localStorage.getItem("deeporca.experiment.metrics") ?? "{}");
    assert.equal(stored.runs.length, 200);
    assert.ok(stored.runs[0].clicks !== undefined, "ring-cap must keep well-formed runs");
  });

  test("summary averages clicks and latency over completed runs", async () => {
    const api = metrics.instrumentCorePath(fakeApi());
    // Two completed classic runs: 2 clicks each — avg must be 2.
    for (let i = 0; i < 2; i++) {
      await api.sendPrompt({ text: `q${i}` });
      document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await api.gitDiff("a.ts", false);
    }
    const summary = metrics.readCorePathMetrics();
    assert.equal(summary.runs.classic?.completed, 2);
    assert.equal(summary.runs.classic?.avgClicks, 2);
    assert.ok(summary.runs.classic!.avgMs >= 0);
  });

  test("E0 hard pin: ten layout switches keep the persisted choice valid", () => {
    for (let i = 0; i < 10; i++) {
      layout.switchLayout(i % 2 === 0 ? "deck" : "classic");
      const current = layout.resolveLayout();
      assert.ok(current === "classic" || current === "deck", `switch ${i + 1} left an invalid layout`);
      assert.equal(localStorage.getItem("deeporca.layout"), current);
    }
  });

  test("fail-open: a throwing localStorage never breaks recording or calls", async () => {
    const realStorage = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      value: {
        getItem: () => {
          throw new Error("storage broken");
        },
        setItem: () => {
          throw new Error("storage broken");
        },
      },
      configurable: true,
    });
    try {
      metrics.__resetCorePathMetricsForTest();
      metrics.recordBoot();
      metrics.recordLayoutSwitch("classic", "deck");
      const api = metrics.instrumentCorePath(fakeApi());
      const result = await api.sendPrompt({ text: "still works" });
      assert.deepEqual(result, { ok: true }, "the wrapped call must succeed regardless");
    } finally {
      Object.defineProperty(globalThis, "localStorage", { value: realStorage, configurable: true });
    }
  });
});
