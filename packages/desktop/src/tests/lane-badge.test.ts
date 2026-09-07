/**
 * LaneBadge (specs/depth-lane X.1) — the read-only lane mark on session cards.
 * Design provenance: mmx design round 2026-09-04. Pins:
 *   - lane undefined / off-values → nothing rendered (pre-gate sessions);
 *   - express → cyan pill with localized label + tip;
 *   - deep → amber pill, different glyph and label;
 *   - label localization actually follows the catalog (zh).
 *
 * Harness: dom-harness + createApiStub; api.ts binds window.deeporca at module
 * load, so the stub is installed before the component import.
 */
import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";

import { installDom, createApiStub, type DomHandle, type ApiStub } from "./dom-harness";
import type * as RTL from "@testing-library/react";
import type * as React from "react";
import type { I18nProvider as I18nProviderComponent } from "../renderer/i18n";
import type { LaneBadge as LaneBadgeComponent } from "../renderer/components/LaneBadge";

let dom: DomHandle;
let stub: ApiStub;
let rtl: typeof RTL;
let ReactPkg: typeof React;
let I18nProvider: typeof I18nProviderComponent;
let LaneBadge: typeof LaneBadgeComponent;

function renderLane(lane?: "express" | "deep"): HTMLElement {
  const utils = rtl.render(ReactPkg.createElement(I18nProvider, null, ReactPkg.createElement(LaneBadge, { lane })));
  return utils.container;
}

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
  ({ LaneBadge } = await import("../renderer/components/LaneBadge"));
});

after(() => {
  delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
  dom.cleanup();
});
afterEach(() => rtl.cleanup());

test("lane undefined → nothing rendered (pre-gate sessions stay clean)", () => {
  assert.equal(renderLane(undefined).firstElementChild, null);
});

test("off-values degrade to nothing (defensive)", () => {
  // a future lane value the component doesn't know must not crash or render
  assert.equal(renderLane(undefined).firstElementChild, null);
  assert.equal(renderLane("turbo" as never).firstElementChild, null);
});

test("express lane → cyan pill with the localized label and tip", () => {
  const container = renderLane("express");
  const badge = container.querySelector(".ui-lane-badge");
  assert.ok(badge, "badge renders");
  assert.ok(badge!.classList.contains("ui-lane-badge--express"));
  assert.match(badge!.textContent ?? "", /快速/);
  assert.equal(badge!.getAttribute("data-tip"), "快速模式：基于当前上下文直接作答");
  assert.ok(badge!.querySelector("svg"), "glyph present");
});

test("deep lane → amber pill, different glyph class and label", () => {
  const container = renderLane("deep");
  const badge = container.querySelector(".ui-lane-badge");
  assert.ok(badge);
  assert.ok(badge!.classList.contains("ui-lane-badge--deep"));
  assert.match(badge!.textContent ?? "", /深度/);
  assert.equal(badge!.getAttribute("data-tip"), "深度模式：多路径推演后给出决策报告");
});
