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
import type { SpecGraph, SpecIssue, SpecNode } from "@deeporca/core";

let dom: DomHandle;
let stub: ApiStub;
let rtl: typeof RTL;
let ReactPkg: typeof React;
let I18nProvider: typeof I18nProviderComponent;
let SpecsPanel: typeof SpecsPanelComponent;

let graphFixture: SpecGraph & { issues?: SpecIssue[] };
let openedPaths: string[];
let openResult: { ok: boolean; error?: string };

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
  openResult = { ok: true };
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
      return openResult;
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

test("ok-state findings draw no badge and never mask real drift", async () => {
  // 2026-09 swarm review regression: core emits state:"ok" findings for
  // healthy gates; the worst-slot sort used to rank "ok" FIRST (indexOf -1),
  // drawing a bogus empty badge on healthy nodes and masking real drift on
  // mixed ones.
  graphFixture = {
    root: "/ws",
    nodes: [
      node({
        id: "healthy",
        type: "architecture",
        title: "健康架构",
        relPath: ".deeporca/specs/healthy/architecture.md",
        drift: [
          { gate: "chain", state: "ok" },
          { gate: "implementation", state: "ok" },
        ],
      }),
      node({
        id: "mixed",
        type: "architecture",
        title: "混合架构",
        relPath: ".deeporca/specs/mixed/architecture.md",
        drift: [
          { gate: "chain", state: "ok" },
          { gate: "implementation", state: "unimplemented", count: 2 },
        ],
      }),
    ],
  };
  const out = renderPanel();
  await rtl.act(async () => {
    await Promise.resolve();
  });
  const rows = out.querySelectorAll(".ui-specs-node");
  assert.equal(rows.length, 2, `rows: ${out.innerHTML}`);
  assert.ok(rows[0].textContent?.includes("健康架构"));
  // NB: assert on the boolean, never put a jsdom Element into assert's actual
  // slot — node:test's failure formatting hangs on Element inspection.
  assert.ok(rows[0].querySelector(".ui-specs-drift") === null, "healthy node must not draw a drift badge");
  const badge = rows[1].querySelector(".ui-specs-drift");
  assert.ok(badge, "mixed node badge missing");
  assert.ok(badge.classList.contains("ui-specs-drift-unimplemented"), `class wrong: ${badge.className}`);
  assert.ok(!badge.classList.contains("ui-specs-drift-ok"), `class wrong: ${badge.className}`);
  assert.ok(badge.textContent?.includes("未实施"), `badge text: ${badge.textContent}`);
  // Tooltip lists only non-ok findings — no leading empty segment.
  const tooltip = badge.getAttribute("title") ?? "";
  assert.ok(tooltip.startsWith("未实施"), `tooltip: ${tooltip}`);
});

test("a failed specsOpen surfaces an error line instead of a silent no-op", async () => {
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
  assert.ok(out.querySelector(".ui-specs-open-error") === null, "no error line before any click");
  openResult = { ok: false, error: "unregistered workspace" };
  const row = out.querySelector<HTMLElement>(".ui-specs-node");
  assert.ok(row, "node row missing");
  await rtl.act(async () => {
    row.dispatchEvent(new window.Event("click", { bubbles: true }));
    await Promise.resolve();
  });
  const error = out.querySelector(".ui-specs-open-error");
  assert.ok(error, "error line missing after failed open");
  assert.ok(error.textContent?.includes("打开 spec 文档失败"), `error text: ${error.textContent}`);
  assert.ok(error.textContent?.includes("unregistered workspace"), `error detail: ${error.textContent}`);
});

test("structure-check issues render localized with interpolated params", async () => {
  // M1 closure (2026-09 swarm review): the panel surfaces validateSpecs
  // detail — localized from structured `data`, never from core's dev prose.
  graphFixture = {
    root: "/ws",
    nodes: [
      node({ id: "solo", type: "architecture", title: "独立架构", relPath: ".deeporca/specs/solo/architecture.md" }),
    ],
    issues: [
      {
        severity: "error",
        code: "dangling-link",
        path: ".deeporca/specs/solo/architecture.md",
        message: "developer-facing prose parent → ghost",
        data: { kind: "parent", id: "ghost" },
      },
      {
        severity: "warn",
        code: "artifact-escapes-root",
        path: ".deeporca/specs/solo/architecture.md",
        message: "developer-facing prose escapes",
        data: { artifact: "../outside.png" },
      },
      {
        severity: "error",
        code: "duplicate-id",
        path: ".deeporca/specs/solo/architecture.md",
        message: "developer-facing prose dup",
        // $-patterns in a param value must render literally — t() uses a
        // replacement function, not a string replacement (iter-2 review).
        data: { id: "a$&b", other: "x.md" },
      },
    ],
  };
  const out = renderPanel();
  await rtl.act(async () => {
    await Promise.resolve();
  });
  assert.ok(out.textContent?.includes("结构校验"), `section header missing: ${out.innerHTML}`);
  const rows = out.querySelectorAll(".ui-specs-issue");
  assert.equal(rows.length, 3, `issue rows: ${out.innerHTML}`);
  assert.ok(rows[0].classList.contains("ui-specs-issue-error"), `severity class: ${rows[0].className}`);
  assert.ok(rows[0].textContent?.includes("指向不存在的节点"), `localized text: ${rows[0].textContent}`);
  assert.ok(rows[0].textContent?.includes("ghost"), `param interpolation: ${rows[0].textContent}`);
  assert.ok(rows[1].classList.contains("ui-specs-issue-warn"), `severity class: ${rows[1].className}`);
  assert.ok(rows[1].textContent?.includes("逃逸出工作区根"), `localized text: ${rows[1].textContent}`);
  assert.ok(rows[1].textContent?.includes("../outside.png"), `param interpolation: ${rows[1].textContent}`);
  // $& in a param value renders literally (replacement-function interpolation).
  assert.ok(rows[2].textContent?.includes("a$&b"), `dollar-ampersand param: ${rows[2].textContent}`);
  // Core's developer prose must never reach the UI.
  assert.ok(!out.textContent?.includes("developer-facing prose"), `core message leaked: ${out.textContent}`);
});

test("a loose-file-only tree (zero nodes, issues present) still shows structure checks", async () => {
  // Iter-2 review: the issues block used to live inside the populated-nodes
  // branch — the bootstrap signal "add frontmatter to register" was invisible
  // in exactly its canonical scenario.
  graphFixture = {
    root: "/ws",
    nodes: [],
    issues: [
      {
        severity: "info",
        code: "loose-file",
        path: ".deeporca/specs/note.md",
        message: "developer-facing prose loose",
      },
    ],
  };
  const out = renderPanel();
  await rtl.act(async () => {
    await Promise.resolve();
  });
  assert.ok(out.textContent?.includes("尚无 spec 图"), `empty state missing: ${out.innerHTML}`);
  assert.ok(out.textContent?.includes("结构校验"), `issues section missing: ${out.innerHTML}`);
  const row = out.querySelector(".ui-specs-issue");
  assert.ok(row, "issue row missing");
  assert.ok(row.classList.contains("ui-specs-issue-info"), `severity class: ${row.className}`);
  assert.ok(row.textContent?.includes("未注册为图节点"), `localized text: ${row.textContent}`);
  assert.ok(row.textContent?.includes(".deeporca/specs/note.md"), `path: ${row.textContent}`);
});

test("no issues → no structure-check section", async () => {
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
  assert.ok(out.querySelector(".ui-specs-issue") === null, "issue rows must not render");
  assert.ok(!out.textContent?.includes("结构校验"), "section header must not render");
});
