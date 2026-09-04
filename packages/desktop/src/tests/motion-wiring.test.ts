/**
 * Motion wiring (docs/research/2026-09-03-motion-react-animation-prestudy P0
 * acceptance): AnimatePresence exit orchestration fires onExitComplete when a
 * conditional m-child is removed — the contract every migrated surface
 * (sheets / toasts / quickdock / settings) leans on. Uses forced-reduced-
 * motion semantics via a near-zero-duration transition so the assertion is
 * deterministic in jsdom.
 */
import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";

import { installDom, createApiStub, type DomHandle, type ApiStub } from "./dom-harness";
import type * as RTL from "@testing-library/react";
import type * as React from "react";
import type { I18nProvider as I18nProviderComponent } from "../renderer/i18n";
import type * as MotionModule from "../renderer/ui/motion";

let dom: DomHandle;
let stub: ApiStub;
let rtl: typeof RTL;
let ReactPkg: typeof React;
let I18nProvider: typeof I18nProviderComponent;
let motionMod: typeof MotionModule;

before(async () => {
  dom = installDom();
  const g = globalThis as unknown as { localStorage: Storage };
  g.localStorage = window.localStorage;
  localStorage.setItem("deeporca.locale", "zh");
  stub = createApiStub({});
  (globalThis as unknown as { window: { deeporca: unknown } }).window.deeporca = stub.api;
  rtl = await import("@testing-library/react");
  ReactPkg = await import("react");
  ({ I18nProvider } = await import("../renderer/i18n"));
  motionMod = await import("../renderer/ui/motion");
});

after(() => {
  delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
  dom.cleanup();
});
afterEach(() => rtl.cleanup());

test("AnimatePresence fires onExitComplete when a conditional m-child is removed", async () => {
  const { AnimatePresence, m, MotionProvider } = motionMod;
  let exited = 0;

  function Probe({ show }: { show: boolean }) {
    return ReactPkg.createElement(
      MotionProvider,
      null,
      ReactPkg.createElement(
        AnimatePresence,
        { onExitComplete: () => (exited += 1) },
        show
          ? ReactPkg.createElement(
              m.div,
              { key: "probe", exit: { opacity: 0 }, transition: { duration: 0.01 } },
              "probe content"
            )
          : null
      )
    );
  }

  const utils = rtl.render(ReactPkg.createElement(Probe, { show: true }));
  // RTL v16: rerender lives on the root returned by render — same object here.
  assert.ok(utils.container.textContent?.includes("probe content"));

  utils.rerender(ReactPkg.createElement(Probe, { show: false }));
  // Content stays mounted while exiting, then unmounts and fires the callback.
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.ok(exited >= 1, "onExitComplete must fire");
  assert.ok(!utils.container.textContent?.includes("probe content"), "exiting child unmounted");
});

test("ui/motion exports the strict-mode surface (m / AnimatePresence / MotionProvider)", () => {
  assert.ok(motionMod.m);
  assert.ok(motionMod.AnimatePresence);
  assert.ok(motionMod.MotionProvider);
  assert.ok(motionMod.springToken);
});
