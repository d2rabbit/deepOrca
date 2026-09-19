/**
 * Tests for SpecsPanel (specs/spec-graph-adoption T2.5) — the read-only view
 * over `.deeporca/specs/`. Pins:
 *   - empty graph → honest empty state (never a fake tree),
 *   - design chains render parent → children; independent nodes stay
 *     separate (拍板⑦: independent nodes are legal first-class entries),
 *   - drift badges surface the worst finding with the detail tooltip,
 *   - clicking a node opens its file through the specsOpen channel.
 *
 * Harness: dom-harness + createApiStub; api.ts binds window.deeporca at
 * module load, so the stub is installed before the component import.
 */

import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";

import { installDom, createApiStub, type DomHandle, type ApiStub } from "./dom-harness";
// Type-only imports: erased at compile time — runtime imports in before().
import type * as RTL from "@testing-library/react";
import type * as React from "react";
import type { I18nProvider as I18nProviderComponent } from "../renderer/i18n";
import type { SpecsPanel as SpecsPanelComponent } from "../renderer/components/SpecsPanel";
import type { SpecGraph, SpecNode } from "@deeporca/core";

let dom: DomHandle;
let stub: ApiStub;
let rtl: typeof RTL;
let ReactPkg: typeof React;
let I18nProvider: typeof I18nProviderComponent;
let SpecsPanel: typeof SpecsPanelComponent;

let graphFixture: SpecGraph;
let openedPaths: string[];

function node(partial: Partial<SpecNode>): SpecNode {
  return {
    id: "node",
    type: "design",
    status: "active",
    title: "node",
    dir: "suite",
    relPath: ".deeporca/specs/suite/node.md",
    dependsOn: [],
    artifacts: [],
    tags: [],
    mtimeMs: 0,
    drift: [],
    ...partial,
  };
}

function renderPanel(): HTMLElement {
  return rtl.render(ReactPkg.createElement(I18nProvider, null, ReactPkg.createElement(SpecsPanel, { root: "/ws" })))
    .container;
}

before(async () => {
  dom = installDom();
  const g = globalThis as unknown as { localStorage: Storage };
  g.localStorage = window.localStorage;
  localStorage.setItem("deeporca.locale", "zh");
  openedPaths = [];
  graphFixture = {
    root: "/ws",
    nodes: [
      node({
        id: "suite-a",
        type: "product-design",
        title: "Suite A 产品设计",
        relPath: ".deeporca/specs/suite-a/product-design.md",
      }),
      node({
        id: "suite-a#architecture",
        type: "architecture",
        parent: "suite-a",
        title: "Suite A 技术架构",
        relPath: ".deeporca/specs/suite-a/architecture.md",
        drift: [{ gate: "chain", state: "stale" }],
      }),
      node({ id: "solo", type: "architecture", title: "独立架构", relPath: ".deeporca/specs/solo/architecture.md" }),
    ],
  };
  stub = createApiStub({
    specsGraph: async () => graphFixture,
    specsOpen: async (_root: string | undefined, relPath: string) => {
      openedPaths.push(relPath);
      return { ok: true };
    },
  } as unknown as Record<string, never>);
  (globalThis as unknown as { window: { deeporca: unknown } }).window.deeporca = stub.api;
  rtl = await import("@testing-library/react");
  ReactPkg = await import("react");
  ({ I18nProvider } = await import("../renderer/i18n"));
  ({ SpecsPanel } = await import("../renderer/components/SpecsPanel"));
});

after(() => {
  delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
  dom.cleanup();
});
afterEach(() => rtl.cleanup());

test("empty graph renders the honest empty state", async () => {
  graphFixture = { root: "/ws", nodes: [] };
  const out = renderPanel();
  await rtl.act(async () => {
    await Promise.resolve();
  });
  assert.ok(out.textContent?.includes("尚无 spec 图"), `empty state missing: ${out.innerHTML}`);
});

test("chains render parent→children; independent nodes stay separate; drift badge shows", async () => {
  graphFixture = {
    root: "/ws",
    nodes: [
      node({
        id: "suite-a",
        type: "product-design",
        title: "Suite A 产品设计",
        relPath: ".deeporca/specs/suite-a/product-design.md",
      }),
      node({
        id: "suite-a#architecture",
        type: "architecture",
        parent: "suite-a",
        title: "Suite A 技术架构",
        relPath: ".deeporca/specs/suite-a/architecture.md",
        drift: [{ gate: "chain", state: "stale" }],
      }),
      node({ id: "solo", type: "architecture", title: "独立架构", relPath: ".deeporca/specs/solo/architecture.md" }),
    ],
  };
  const out = renderPanel();
  await rtl.act(async () => {
    await Promise.resolve();
  });
  assert.ok(out.textContent?.includes("设计链"), "chain section missing");
  assert.ok(out.textContent?.includes("Suite A 产品设计"), "design node missing");
  assert.ok(out.textContent?.includes("Suite A 技术架构"), "architecture node missing");
  assert.ok(out.textContent?.includes("独立架构"), "independent node missing");
  assert.ok(out.textContent?.includes("独立节点"), "independent section missing");
  const drift = out.querySelector(".ui-specs-drift");
  assert.ok(drift, "drift badge missing");
  assert.ok(drift.classList.contains("ui-specs-drift-stale"), `drift class wrong: ${drift.className}`);
  // Tooltip is the LOCALIZED badge wording (core sends structured findings
  // only — no core-authored detail strings cross the wire).
  assert.ok(drift.getAttribute("title")?.includes("落后于上游"), `drift tooltip: ${drift.getAttribute("title")}`);
});

test("clicking a node opens its markdown through specsOpen", async () => {
  graphFixture = {
    root: "/ws",
    nodes: [
      node({ id: "solo", type: "architecture", title: "独立架构", relPath: ".deeporca/specs/solo/architecture.md" }),
    ],
  };
  const out = renderPanel();
  await rtl.act(async () => {
    await Promise.resolve();
  });
  const row = out.querySelector<HTMLElement>(".ui-specs-node");
  assert.ok(row, "node row missing");
  row.dispatchEvent(new window.Event("click", { bubbles: true }));
  assert.deepEqual(openedPaths, [".deeporca/specs/solo/architecture.md"]);
});
