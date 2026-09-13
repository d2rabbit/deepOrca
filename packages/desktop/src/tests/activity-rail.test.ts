import { test } from "node:test";
import assert from "node:assert/strict";
import type { SessionMessage } from "../shared/ipc";
import { createApiStub, installDom } from "./dom-harness";

test("activity timer runs only for a visible thinking card and retains hidden elapsed time", async () => {
  const dom = installDom();
  window.deeporca = createApiStub().api as Window["deeporca"];
  const React = await import("react");
  const rtl = await import("@testing-library/react");
  const { I18nProvider } = await import("../renderer/i18n");
  const { ActivityRail } = await import("../renderer/components/ActivityRail");
  const originalInterval = globalThis.setInterval;
  const originalClear = globalThis.clearInterval;
  const originalNow = Date.now;
  const callbacks = new Map<number, () => void>();
  let clock = 1000;
  let id = 0;
  globalThis.setInterval = ((callback: () => void) => {
    callbacks.set(++id, callback);
    return id;
  }) as unknown as typeof setInterval;
  globalThis.clearInterval = ((timer: number) => {
    callbacks.delete(timer);
  }) as unknown as typeof clearInterval;
  Date.now = () => clock;
  const messages = [
    { id: "thinking", role: "assistant", content: "Working", meta: { asThinking: true } },
  ] as SessionMessage[];
  const panel = (busy: boolean, collapsed: boolean, thinking = true) =>
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ActivityRail, { messages: thinking ? messages : [], busy, collapsed })
    );
  try {
    const out = rtl.render(panel(true, true));
    assert.equal(callbacks.size, 0, "collapsed rail has no elapsed timer");
    clock += 5000;
    out.rerender(panel(true, false));
    assert.equal(callbacks.size, 1);
    assert.ok(out.container.querySelector(".cnt")?.textContent?.includes("5.0s"));
    clock += 100;
    rtl.act(() => {
      for (const callback of callbacks.values()) callback();
    });
    assert.ok(out.container.querySelector(".cnt")?.textContent?.includes("5.1s"));
    out.rerender(panel(true, false, false));
    assert.equal(callbacks.size, 0, "no thinking text means no elapsed timer");
    out.rerender(panel(false, false));
    clock += 1000;
    out.rerender(panel(true, false));
    assert.ok(out.container.querySelector(".cnt")?.textContent?.includes("0.0s"));
    assert.equal(callbacks.size, 1);
    out.unmount();
    assert.equal(callbacks.size, 0, "unmount cleans up the timer");
  } finally {
    rtl.cleanup();
    globalThis.setInterval = originalInterval;
    globalThis.clearInterval = originalClear;
    Date.now = originalNow;
    dom.cleanup();
  }
});

test("activity rail only parses the newest 15 named tools", async () => {
  const dom = installDom();
  window.deeporca = createApiStub().api as Window["deeporca"];
  const React = await import("react");
  const rtl = await import("@testing-library/react");
  const { I18nProvider } = await import("../renderer/i18n");
  const { ActivityRail } = await import("../renderer/components/ActivityRail");
  let discardedReads = 0;
  const messages = Array.from({ length: 20 }, (_, index) => {
    const message = { id: `tool-${index}`, role: "tool", meta: { paramsMd: `target-${index}` } } as SessionMessage;
    Object.defineProperty(message, "content", {
      get() {
        if (index < 5) discardedReads += 1;
        return JSON.stringify({ name: `tool-${index}` });
      },
    });
    return message;
  });
  try {
    const out = rtl.render(
      React.createElement(
        I18nProvider,
        null,
        React.createElement(ActivityRail, { messages, busy: false, collapsed: false })
      )
    );
    assert.equal(discardedReads, 0);
    rtl.fireEvent.click(out.container.querySelector(".cap") as HTMLElement);
    const rows = Array.from(out.container.querySelectorAll(".lr .tt")).map((row) => row.textContent);
    assert.deepEqual(
      rows,
      Array.from({ length: 15 }, (_, offset) => `tool-${19 - offset} · target-${19 - offset}`)
    );
  } finally {
    rtl.cleanup();
    dom.cleanup();
  }
});
