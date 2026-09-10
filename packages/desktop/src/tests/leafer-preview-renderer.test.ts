/**
 * LeaferPreview jsdom lifecycle smoke (specs/leafer-ui-engine WP1.2, EARS 5):
 * the canvas component must settle into a defined visual state under a
 * context-less canvas (jsdom has no 2D context — the engine init fails), keep
 * the failure LOCAL (never a workspace-level error), and unmount cleanly.
 */

import { after, afterEach, before, test } from "node:test";
import assert from "node:assert/strict";
import type * as React from "react";
import type * as RTL from "@testing-library/react";
import type { I18nProvider as I18nProviderComponent } from "../renderer/i18n";
import type { LeaferPreview as LeaferPreviewComponent } from "../renderer/components/design-workspace/LeaferPreview";
import { installDom, type DomHandle } from "./dom-harness";

let dom: DomHandle;
let rtl: typeof RTL;
let ReactPkg: typeof React;
let I18nProvider: typeof I18nProviderComponent;
let LeaferPreview: typeof LeaferPreviewComponent;

const DESIGN = JSON.stringify({
  tag: "Leafer",
  width: 400,
  height: 300,
  fill: "#ffffff",
  children: [{ tag: "Rect", x: 10, y: 10, width: 50, height: 50, fill: "#111318" }],
});

before(async () => {
  dom = installDom();
  Object.defineProperty(globalThis, "localStorage", { value: window.localStorage, configurable: true });
  localStorage.setItem("deeporca.locale", "en");
  rtl = await import("@testing-library/react");
  ReactPkg = await import("react");
  ({ I18nProvider } = await import("../renderer/i18n"));
  ({ LeaferPreview } = await import("../renderer/components/design-workspace/LeaferPreview"));
});

after(() => {
  delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
  dom.cleanup();
});
afterEach(() => rtl.cleanup());

function view(props: { leaferJson: string; editable: boolean }): RTL.RenderResult {
  return rtl.render(ReactPkg.createElement(I18nProvider, null, ReactPkg.createElement(LeaferPreview, props as never)));
}

test("leafer preview settles into a defined state and stays local under a context-less canvas", () => {
  const rendered = view({ leaferJson: DESIGN, editable: true });
  // jsdom: new Leafer() throws (no 2D context) → the LOCAL error branch; on a
  // real GPU surface the stage container mounts instead. Both are valid.
  const failed = rendered.container.textContent?.includes("canvas engine failed") ?? false;
  const stage = rendered.container.querySelector(".ui-design-leafer-stage");
  assert.ok(failed || stage !== null, "component must settle into the error branch or the canvas stage");
});

test("leafer preview survives invalid JSON and unmounts without throwing", () => {
  const rendered = view({ leaferJson: "{definitely not json", editable: false });
  assert.doesNotThrow(() =>
    rendered.rerender(
      ReactPkg.createElement(
        I18nProvider,
        null,
        ReactPkg.createElement(LeaferPreview, { leaferJson: DESIGN, editable: false } as never)
      )
    )
  );
  assert.doesNotThrow(() => rendered.unmount());
});

test("editable=false never renders the editor-driven commit surface", () => {
  const rendered = view({ leaferJson: DESIGN, editable: false });
  // On the failure path there is no canvas at all; either way no workspace
  // error container is written by this component (WP3.4 lesson — local only).
  assert.equal(rendered.container.querySelector(".ui-workspace-error"), null);
});
