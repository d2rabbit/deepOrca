/**
 * E7 guard tests (experiment-plan.md): the work-order policy layer — the
 * engine-red-line features reimplemented Deck-side above the untouched
 * engine loop.
 *
 *   - autonomy policy (pure): which scope batches each level auto-approves
 *   - auto-approve effect: a qualifying batch under 全自动 flows via the
 *     /continue protocol without showing the card; 关键确认 keeps the card
 *   - gates: a confirm-done gate brakes the engine when its step flips done
 *     (once — deduped), the confirm card resumes on 继续
 *   - draft: ⌘N opens the draft page; stamp dispatches a structured prompt
 *     carrying title + numbered checklist
 *   - strike: struck steps render struck-through; struck steps never hold
 */

import { test, describe, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { installDom, createApiStub, type DomHandle, type ApiStub } from "./dom-harness";
import type * as RTL from "@testing-library/react";
import type * as React from "react";
import type { DeckApp as DeckAppComponent } from "../renderer/deck/deck-app";
import type { I18nProvider as I18nProviderComponent } from "../renderer/i18n";
import type * as WorkOrder from "../renderer/deck/lib/work-order";
import type { PlanStep } from "../renderer/deck/components/step-board";

let dom: DomHandle;
let stub: ApiStub;
let fixture: Record<string, unknown>;
let render: typeof RTL.render;
let act: typeof RTL.act;
let fireEvent: typeof RTL.fireEvent;
let createElement: typeof React.createElement;
let StrictMode: typeof React.StrictMode;
let workOrder: typeof WorkOrder;
let DeckApp: typeof DeckAppComponent;
let I18nProvider: typeof I18nProviderComponent;

function msg(overrides: Record<string, unknown>): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    id: `m-${Math.random().toString(36).slice(2, 8)}`,
    sessionId: "sess-1",
    role: "tool",
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

function planMessage(plan: string): Record<string, unknown> {
  return msg({
    content: JSON.stringify({ name: "UpdatePlan", ok: true, metadata: { plan } }),
  });
}

function step(text: string, done: boolean): PlanStep {
  return { text, done, level: 0 };
}

function defaultFixture(): Record<string, unknown> {
  return {
    getActiveSession: async () => null,
    getSession: async () => null,
    listSessions: async () => [],
    editorListFiles: async () => ({ ok: true, entries: [] }),
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
  workOrder = await import("../renderer/deck/lib/work-order");
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

describe("work-order policy (lib/work-order.ts, pure)", () => {
  test("autonomy levels auto-approve exactly their scope classes", () => {
    // 全自动: everything except destructive/git-mutating flows.
    assert.equal(workOrder.shouldAutoApprove(0, ["write-in-cwd", "network"]), true);
    assert.equal(workOrder.shouldAutoApprove(0, ["write-in-cwd", "delete-in-cwd"]), false);
    assert.equal(workOrder.shouldAutoApprove(0, ["mutate-git-log"]), false);
    // 关键确认: reads/git queries flow; writes and network ask.
    assert.equal(workOrder.shouldAutoApprove(1, ["read-in-cwd", "query-git-log"]), true);
    assert.equal(workOrder.shouldAutoApprove(1, ["write-in-cwd"]), false);
    assert.equal(workOrder.shouldAutoApprove(1, ["network"]), false);
    // 每步确认: nothing flows.
    assert.equal(workOrder.shouldAutoApprove(2, ["read-in-cwd"]), false);
    assert.equal(workOrder.shouldAutoApprove(2, []), false);
  });

  test("gate detection fires on done-flip and current-entry, deduped; struck never holds", () => {
    const gates: Record<string, WorkOrder.StepGate> = { 验证: "confirm-done", 实施: "confirm-before" };
    const none = new Set<string>();

    // 完成时确认: !done → done flips the gate.
    let hold = workOrder.computeGateHold([step("验证", false)], [step("验证", true)], gates, [], none);
    assert.deepEqual(hold, { step: "验证", phase: "done" });

    // Deduped: the same transition with the fired key present stays silent.
    hold = workOrder.computeGateHold([step("验证", false)], [step("验证", true)], gates, [], new Set(["done:验证"]));
    assert.equal(hold, null);

    // 开工前确认: fires when the step BECOMES the current (first !done) one.
    hold = workOrder.computeGateHold(
      [step("设计", false), step("实施", false)],
      [step("设计", true), step("实施", false)],
      gates,
      [],
      none
    );
    assert.deepEqual(hold, { step: "实施", phase: "before" });

    // Struck steps never hold even with a gate set.
    hold = workOrder.computeGateHold([step("验证", false)], [step("验证", true)], gates, ["验证"], none);
    assert.equal(hold, null);
  });
});

describe("Deck E7 work-order layer (mounted)", () => {
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
      await new Promise((resolve) => setTimeout(resolve, 80));
    });
    return { unmount: () => result.unmount(), container: result.container };
  }

  function press(key: string, opts: { meta?: boolean; shift?: boolean; alt?: boolean } = {}): Promise<void> {
    return act(async () => {
      fireEvent.keyDown(window, {
        key,
        code: key === " " ? "Space" : /^[0-9]$/.test(key) ? `Digit${key}` : key,
        metaKey: opts.meta ?? false,
        shiftKey: opts.shift ?? false,
        altKey: opts.alt ?? false,
      });
    });
  }

  test("全自动 auto-approves a safe batch via /continue without the card", async () => {
    localStorage.setItem("deeporca.deck.autonomy", "0");
    fixture.getActiveSession = async () => "sess-1";
    // The ask batch is live until the /continue lands; afterwards the stub
    // mirrors a real engine by clearing the ask (the card must retire).
    let resumed = false;
    fixture.getSession = async () =>
      resumed
        ? { summary: "goal", status: "processing" }
        : {
            summary: "goal",
            status: "ask_permission",
            askPermissions: [{ toolCallId: "tc1", name: "write", command: "echo hi > f", scopes: ["write-in-cwd"] }],
          };
    fixture.sendPrompt = async () => {
      resumed = true;
      return { ok: true };
    };

    mounted = await mountDeck();
    assert.equal(
      Boolean(mounted.container.querySelector(".deck-pending")),
      false,
      "the card must not show on full auto"
    );

    const calls = stub.calls.filter((c) => c.method === "sendPrompt");
    const resume = calls.find((c) => (c.args[0] as { text?: string }).text === "/continue");
    assert.ok(resume, `expected an auto /continue, saw ${JSON.stringify(stub.calls.map((c) => c.method))}`);
    const payload = resume.args[0] as { permissions?: Array<{ toolCallId: string; permission: string }> };
    assert.deepEqual(payload.permissions, [{ toolCallId: "tc1", permission: "allow" }]);
  });

  test("关键确认 keeps the card for write scopes (default level)", async () => {
    fixture.getActiveSession = async () => "sess-1";
    fixture.getSession = async () => ({
      summary: "goal",
      status: "ask_permission",
      askPermissions: [{ toolCallId: "tc1", name: "write", command: "echo hi > f", scopes: ["write-in-cwd"] }],
    });

    mounted = await mountDeck();
    assert.equal(Boolean(mounted.container.querySelector(".deck-pending")), true, "the card must show on key-confirm");
    assert.equal(stub.calls.filter((c) => c.method === "sendPrompt").length, 0, "nothing may auto-flow on key-confirm");
  });

  test("⌥1/2/3 set the autonomy level and the dial persists it", async () => {
    mounted = await mountDeck();
    await press("1", { alt: true });
    assert.equal(localStorage.getItem("deeporca.deck.autonomy"), "0");
    const dial = mounted.container.querySelector('[data-test-id="deck-autonomy"]');
    assert.ok(dial?.textContent?.includes("Full auto"), `dial should read the level, saw ${dial?.textContent}`);
    await press("2", { alt: true });
    assert.equal(localStorage.getItem("deeporca.deck.autonomy"), "1");
  });

  test("a confirm-done gate brakes the engine once and 继续 resumes", async () => {
    fixture.getActiveSession = async () => "sess-1";
    fixture.getSession = async () => ({ summary: "goal", status: "processing" });
    fixture.listMessages = async () => [planMessage("- [ ] 验证\n- [ ] 交付")];

    mounted = await mountDeck();

    // Set a confirm-done gate on 验证 via the step board's gate button.
    const gateButtons = mounted.container.querySelectorAll(".deck-steps-list [data-gate-step]");
    assert.ok(gateButtons.length >= 2, "step gate buttons missing");
    await act(async () => {
      fireEvent.click(gateButtons[0]); // auto → confirm-before
    });
    await act(async () => {
      fireEvent.click(gateButtons[0]); // confirm-before → confirm-done
    });
    assert.ok(gateButtons[0].textContent?.includes("Confirm when done"), "gate should read confirm-done");

    // The step flips done mid-loop (streamed UpdatePlan).
    await act(async () => {
      stub.emit("onAssistantMessage", planMessage("- [x] 验证\n- [ ] 交付"));
    });

    const pauses = stub.calls.filter((c) => c.method === "pausePrompt");
    assert.equal(pauses.length, 1, `the gate must brake once, saw ${pauses.length}`);
    const card = mounted.container.querySelector('[data-test-id="deck-gate-card"]');
    assert.ok(card, "gate confirm card missing");
    assert.ok(card.textContent?.includes("验证"), "the card should name the gated step");

    const resumeButton = [...card.querySelectorAll("button")].find((b) => b.textContent === "Continue")!;
    await act(async () => {
      fireEvent.click(resumeButton);
    });
    const resumes = stub.calls.filter((c) => c.method === "resumePrompt");
    assert.equal(resumes.length, 1, "confirming must resume the engine");
  });

  test("⌘N opens the draft page; stamp dispatches the structured prompt", async () => {
    fixture.sendPrompt = async () => ({ ok: true });
    mounted = await mountDeck();
    await press("n", { meta: true });

    const panel = mounted.container.querySelector('[data-layer="draft"]');
    assert.ok(panel, "draft page missing on ⌘N");

    const title = panel.querySelector('[data-test-id="deck-draft-title"]')!;
    await act(async () => {
      fireEvent.change(title, { target: { value: "把任务树加星标过滤" } });
    });
    const stepInput = panel.querySelector(".deck-draft-step input")!;
    await act(async () => {
      fireEvent.change(stepInput, { target: { value: "读任务树模块" } });
    });
    const stamp = panel.querySelector('[data-test-id="deck-draft-stamp"]')!;
    await act(async () => {
      fireEvent.click(stamp);
    });

    const calls = stub.calls.filter((c) => c.method === "sendPrompt");
    assert.equal(calls.length, 1, `expected one dispatch, saw ${JSON.stringify(stub.calls.map((c) => c.method))}`);
    const text = (calls[0].args[0] as { text: string }).text;
    assert.ok(text.includes("把任务树加星标过滤"), "the prompt should carry the title");
    assert.ok(text.includes("1. [ ] 读任务树模块"), "the prompt should carry the numbered checklist");
    assert.ok(text.includes("UpdatePlan"), "the prompt should instruct plan tracking");
    assert.equal(mounted.container.querySelector('[data-layer="draft"]'), null, "stamping must close the draft");
  });

  test("striking renders struck-through and disables the gate", async () => {
    fixture.getActiveSession = async () => "sess-1";
    fixture.getSession = async () => ({ summary: "goal", status: "completed" });
    fixture.listMessages = async () => [planMessage("- [ ] 交付")];

    mounted = await mountDeck();
    const strikeButton = mounted.container.querySelector(".deck-steps-list .deck-op.strike")!;
    await act(async () => {
      fireEvent.click(strikeButton);
    });
    assert.ok(mounted.container.querySelector(".deck-steps-list li.struck"), "the step should render struck-through");

    // A done-flip on a struck step must NOT brake even with a gate armed.
    localStorage.setItem(
      "deeporca.deck.order",
      JSON.stringify({ "sess-1": { gates: { 交付: "confirm-done" }, struck: ["交付"] } })
    );
    mounted.unmount();
    mounted = await mountDeck();
    await act(async () => {
      stub.emit("onAssistantMessage", planMessage("- [x] 交付"));
    });
    assert.equal(stub.calls.filter((c) => c.method === "pausePrompt").length, 0, "struck steps never hold");
  });
});
