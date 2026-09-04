/**
 * CodeReviewPanel regression tests — the on-demand review redesign (scope
 * controls on EVERY row, run-any-row) once keyed scope edits by the ACTIVE
 * root, so editing row B's dropdown corrupted the active workspace A's
 * remembered scope while B's own selection was silently dropped. Pins:
 *   - a scope edit on row B keys scopes[/w/b]: B's select reflects the change
 *     AND the active row A's select stays untouched,
 *   - the run button dispatches review.full with the ROW's root (审查与活动区
 *     无关), never the active workspace's.
 *
 * Harness: dom-harness + createApiStub; api.ts binds window.deeporca at module
 * load, so the stub is installed before the component import.
 */

import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";

import { installDom, createApiStub, type DomHandle, type ApiStub } from "./dom-harness";
// Type-only imports: erased at compile time (verbatimModuleSyntax) — the
// runtime imports happen in before(), after the DOM + stub exist.
import type * as RTL from "@testing-library/react";
import type * as React from "react";
import type { I18nProvider as I18nProviderComponent } from "../renderer/i18n";
import type { CodeReviewPanel as CodeReviewPanelComponent } from "../renderer/components/CodeReviewPanel";
import type { WorkspaceGroup, WorkspaceSessions } from "../shared/ipc";

let dom: DomHandle;
let stub: ApiStub;
let rtl: typeof RTL;
let ReactPkg: typeof React;
let I18nProvider: typeof I18nProviderComponent;
let CodeReviewPanel: typeof CodeReviewPanelComponent;

const WORKSPACES: WorkspaceGroup[] = [
  { root: "/w/a", label: "Workspace A", projectCode: "a", sessions: [] },
  { root: "/w/b", label: "Workspace B", projectCode: "b", sessions: [] },
];

function renderPanel(): HTMLElement {
  const utils = rtl.render(
    ReactPkg.createElement(
      I18nProvider,
      null,
      ReactPkg.createElement(CodeReviewPanel, {
        onOpenReviewTab: () => {},
        onOneClickFix: () => {},
      })
    )
  );
  return utils.container;
}

/** Mount-settle: let the workspace/git-refs loads resolve before asserting. */
async function settle(): Promise<void> {
  await rtl.act(async () => {
    await Promise.resolve();
  });
  await rtl.act(async () => {
    await Promise.resolve();
  });
}

before(async () => {
  dom = installDom();
  const g = globalThis as unknown as { localStorage: Storage };
  g.localStorage = window.localStorage;
  localStorage.setItem("deeporca.locale", "zh");
  stub = createApiStub({
    listWorkspaceSessions: async (): Promise<WorkspaceSessions> => ({
      workspaces: WORKSPACES,
      archived: [],
    }),
    getProjectRoot: async () => "/w/a",
    crgList: async () => [],
    reviewListReports: async () => [],
    gitListBranches: async () => ["main"],
    gitLog: async () => [],
    actionRun: async () => ({ ok: true, output: {} }),
  });
  (globalThis as unknown as { window: { deeporca: unknown } }).window.deeporca = stub.api;
  rtl = await import("@testing-library/react");
  ReactPkg = await import("react");
  ({ I18nProvider } = await import("../renderer/i18n"));
  ({ CodeReviewPanel } = await import("../renderer/components/CodeReviewPanel"));
});

after(() => {
  delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
  dom.cleanup();
});
afterEach(() => {
  stub.reset();
  rtl.cleanup();
});

test("scope edit on row B keys by B's root — B updates, active row A stays untouched", async () => {
  const out = renderPanel();
  await settle();

  // Two-row card (2026-09-03): row 1 = workspace identity, row 2 = ops strip
  // (scope + run). The wrap is the query unit — selects live in the ops strip.
  const rows = out.querySelectorAll(".ui-ik-rowwrap");
  assert.equal(rows.length, 2, `expected two workspace rows: ${out.innerHTML}`);
  const modeOf = (row: Element): string => (row.querySelector("select") as HTMLSelectElement).value;
  assert.equal(modeOf(rows[0]), "workspace");
  assert.equal(modeOf(rows[1]), "workspace");

  // Change ROW B's mode to commit. Before the fix this wrote scopes[/w/a]:
  // B's controlled select snapped back to "workspace" while A's remembered
  // scope was silently replaced.
  const selB = rows[1].querySelector("select");
  assert.ok(selB, "row B mode select missing");
  rtl.fireEvent.change(selB, { target: { value: "commit" } });

  assert.equal(modeOf(rows[1]), "commit", "row B's scope edit did not stick");
  assert.equal(modeOf(rows[0]), "workspace", "row B's edit corrupted the active row A's scope");

  // Commit mode adds a ref picker after the mode picker — the scope line's
  // CSS contract (first-child = mode, later children = ref pickers) and the
  // has-refs class the second-line layout keys on both depend on this order.
  const scopeLine = rows[1].querySelector(".ui-review-row-scope");
  assert.ok(scopeLine?.classList.contains("has-refs"), "commit mode must flag the scope line has-refs");
  const bSelects = [...rows[1].querySelectorAll("select")];
  assert.equal(bSelects.length, 2, `row B should render mode + commit pickers: ${rows[1].innerHTML}`);
  assert.ok(
    [...bSelects[1].options].some((o) => o.value === "HEAD"),
    "commit picker must offer the HEAD fallback"
  );
});

test("run button on row B dispatches review.full with B's root — no workspace switch", async () => {
  const out = renderPanel();
  await settle();

  const rows = out.querySelectorAll(".ui-ik-rowwrap");
  const runB = rows[1].querySelector(".ui-ik-runbtn");
  assert.ok(runB, "run button missing on row B");
  assert.equal((runB as HTMLButtonElement).disabled, false, "row B's run button should be enabled");
  rtl.fireEvent.click(runB);
  await settle();

  const run = stub.calls.find((c) => c.method === "actionRun");
  assert.ok(run, "review.full was not dispatched");
  assert.equal(run.args[0], "review.full");
  assert.deepEqual(run.args[1], { root: "/w/b" });
});
