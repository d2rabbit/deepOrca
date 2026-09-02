/**
 * TaskHubWorkspace regression tests — the task-hub popover's fork/switch once
 * dispatched through actionRun (the ACTIVE workspace's action registry), so a
 * foreign treeId always rejected as "tree missing" while the popover closed as
 * if it had succeeded, and 切换分支 never even passed its required branch.
 * Pins:
 *   - fork goes through the cross-workspace taskTreeFork channel with THIS
 *     tab's root, checked result, error surfaced inline on {error},
 *   - 切换分支 opens a picker of the tree's OTHER live branches and confirms
 *     through taskTreeSwitch with (treeId, branch, root),
 *   - a tree with no other branch shows the switchNone message instead of a
 *     silent no-op.
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
import type {
  TaskHubWorkspace as TaskHubWorkspaceComponent,
  TaskHubQuickView,
} from "../renderer/components/TaskHubWorkspace";
import type { WorkspaceTaskHub, WorkspaceTokenSummary } from "../shared/ipc";

let dom: DomHandle;
let stub: ApiStub;
let rtl: typeof RTL;
let ReactPkg: typeof React;
let I18nProvider: typeof I18nProviderComponent;
let TaskHubWorkspace: typeof TaskHubWorkspaceComponent;

const ROOT = "/w/b";
const TREE_ID = "tree-1";

const HUB: WorkspaceTaskHub = {
  root: ROOT,
  generatedAt: "2026-09-01T10:00:00.000Z",
  groups: [
    {
      domain: "session",
      nodes: [
        {
          id: TREE_ID,
          domain: "session",
          title: "主任务",
          status: "done",
          startedAt: "2026-09-01T10:00:00.000Z",
          endedAt: "2026-09-01T10:00:00.000Z",
          source: { kind: "session-tree", treeId: TREE_ID, branchCount: 2 },
          meta: { branchCount: 2, nodeCount: 3, sessionCount: 1, activeBranch: "main", gitHash: null },
        },
      ],
    },
    { domain: "index", nodes: [] },
    {
      domain: "review",
      nodes: [
        {
          id: "rev-1",
          domain: "review",
          title: "代码审查 · 全仓库",
          status: "done",
          startedAt: "2026-09-01T11:00:00.000Z",
          endedAt: "2026-09-01T11:00:00.000Z",
          source: { kind: "review-report", reportId: "review-2026-09-01T11-00-00-000" },
          meta: { comments: 3, scopeLabel: "全仓库（全域审查）" },
        },
      ],
    },
    { domain: "prototype", nodes: [] },
  ],
};

const TOKENS: WorkspaceTokenSummary = {
  root: ROOT,
  sessions: 1,
  silentSessions: 0,
  totalTokens: 1000,
  promptTokens: 600,
  completionTokens: 400,
  cacheReadTokens: 0,
  requests: 2,
  perModel: {},
  lastAt: null,
  windows: {
    last5h: { prompt: 0, completion: 0, total: 0, reqs: 0 },
    today: { prompt: 0, completion: 0, total: 0, reqs: 0 },
    thisWeek: { prompt: 0, completion: 0, total: 0, reqs: 0 },
  },
  windowsApproximate: false,
  costUsd: null,
};

const overrides: Record<string, unknown> = {};
/** Mutable per-test tree fixture — branches the switch picker should offer. */
let treeBranches: Record<string, { name: string; headId: string; createdAt: string; abandoned?: boolean }>;

function renderHub(): { container: HTMLElement; quicks: TaskHubQuickView[] } {
  const quicks: TaskHubQuickView[] = [];
  const utils = rtl.render(
    ReactPkg.createElement(
      I18nProvider,
      null,
      ReactPkg.createElement(TaskHubWorkspace, {
        root: ROOT,
        onOpenQuick: (q) => quicks.push(q),
        onOpenDesign: () => {},
        onOpenKnowledge: () => {},
      })
    )
  );
  return { container: utils.container, quicks };
}

async function settle(): Promise<void> {
  await rtl.act(async () => {
    await Promise.resolve();
  });
  await rtl.act(async () => {
    await Promise.resolve();
  });
}

/** Open the node popover (settle first — state must flush), then click
 *  popover action button #index and settle its state updates. */
async function openPopoverAndClickAction(actionIndex: number): Promise<void> {
  const card = document.querySelector(".ui-taskhub-card");
  assert.ok(card, `session card missing: ${document.body.innerHTML}`);
  rtl.fireEvent.click(card);
  await settle();
  const pop = document.querySelector(".ui-taskhub-pop");
  assert.ok(pop, `popover did not open on card click: ${document.body.innerHTML}`);
  const buttons = pop.querySelectorAll(".actions button");
  assert.ok(buttons.length > actionIndex, `action #${actionIndex} missing: ${pop.innerHTML}`);
  rtl.fireEvent.click(buttons[actionIndex]);
  await settle();
}

before(async () => {
  dom = installDom();
  const g = globalThis as unknown as { localStorage: Storage };
  g.localStorage = window.localStorage;
  localStorage.setItem("deeporca.locale", "zh");
  treeBranches = {
    main: { name: "main", headId: "n0", createdAt: "2026-09-01T09:00:00.000Z" },
    feature: { name: "feature", headId: "n1", createdAt: "2026-09-01T09:30:00.000Z" },
  };
  overrides.taskHubList = async () => HUB;
  overrides.tokensSummary = async () => TOKENS;
  overrides.taskHubTrace = async () => ({ treeId: TREE_ID, sessions: [] });
  overrides.taskTreeGet = async () => ({
    index: {
      version: 1 as const,
      id: TREE_ID,
      rootId: "n0",
      title: "主任务",
      branches: treeBranches,
      activeBranch: "main",
      createdAt: "2026-09-01T09:00:00.000Z",
      updatedAt: "2026-09-01T10:00:00.000Z",
    },
    nodes: [],
  });
  overrides.taskTreeFork = async () => ({ nodeId: "n9", branch: "fork-1" });
  overrides.taskTreeSwitch = async () => ({ ok: true });
  stub = createApiStub(overrides);
  (globalThis as unknown as { window: { deeporca: unknown } }).window.deeporca = stub.api;
  rtl = await import("@testing-library/react");
  ReactPkg = await import("react");
  ({ I18nProvider } = await import("../renderer/i18n"));
  ({ TaskHubWorkspace } = await import("../renderer/components/TaskHubWorkspace"));
});

after(() => {
  delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
  dom.cleanup();
});
afterEach(() => {
  stub.reset();
  rtl.cleanup();
});

test("fork goes through the cross-workspace channel with this tab's root, errors surfaced", async () => {
  const { container: out } = renderHub();
  await settle();
  await rtl.act(async () => {
    await openPopoverAndClickAction(1); // ⑂ fork
  });

  const inputs = document.querySelectorAll(".ui-taskhub-forkform input");
  assert.equal(inputs.length, 2, `fork form inputs missing: ${document.body.innerHTML}`);
  rtl.fireEvent.change(inputs[1], { target: { value: "需要实验方向" } });
  const go = document.querySelector(".ui-taskhub-forkform .forkform-actions button");
  assert.ok(go, "fork go button missing");
  rtl.fireEvent.click(go);
  await settle();

  const fork = stub.calls.find((c) => c.method === "taskTreeFork");
  assert.ok(fork, "taskTreeFork was not dispatched");
  assert.deepEqual(fork.args, [TREE_ID, "需要实验方向", { name: undefined }, ROOT]);
  assert.ok(!stub.calls.some((c) => c.method === "actionRun"), "fork must not dispatch through actionRun");
  // Success closes the popover and reloads the hub.
  assert.equal(document.querySelector(".ui-taskhub-pop"), null, "popover survived a successful fork");
  assert.ok(stub.calls.filter((c) => c.method === "taskHubList").length >= 2, "hub was not reloaded after fork");
});

test("fork failure {error} surfaces inline and keeps the popover open", async () => {
  overrides.taskTreeFork = async () => ({ error: "fork rejected (tree missing)" });
  const { container: out } = renderHub();
  await settle();
  await rtl.act(async () => {
    await openPopoverAndClickAction(1);
  });
  const inputs = document.querySelectorAll(".ui-taskhub-forkform input");
  rtl.fireEvent.change(inputs[1], { target: { value: "why" } });
  const go = document.querySelector(".ui-taskhub-forkform .forkform-actions button");
  assert.ok(go, "fork go button missing");
  rtl.fireEvent.click(go);
  await settle();

  const pop = document.querySelector(".ui-taskhub-pop");
  assert.ok(pop, "popover closed despite the fork error");
  const err = pop.querySelector(".ui-error");
  assert.ok(err, "fork error not surfaced");
  assert.match(err.textContent, /fork rejected/);
});

test("切换分支 lists the tree's OTHER live branches and confirms via taskTreeSwitch", async () => {
  const { container: out } = renderHub();
  await settle();
  await rtl.act(async () => {
    await openPopoverAndClickAction(2); // 切换分支
  });

  // Picker shows only feature — main is the active branch, excluded.
  const select = document.querySelector(".ui-taskhub-forkform select") as HTMLSelectElement | null;
  assert.ok(select, `switch picker missing: ${document.body.innerHTML}`);
  assert.deepEqual(
    [...select.options].map((o) => o.value),
    ["feature"]
  );
  assert.equal(select.value, "feature");

  const confirm = document.querySelector(".ui-taskhub-forkform .forkform-actions button");
  assert.ok(confirm, "switch confirm button missing");
  rtl.fireEvent.click(confirm);
  await settle();

  const sw = stub.calls.find((c) => c.method === "taskTreeSwitch");
  assert.ok(sw, "taskTreeSwitch was not dispatched");
  assert.deepEqual(sw.args, [TREE_ID, "feature", ROOT]);
  assert.equal(document.querySelector(".ui-taskhub-pop"), null, "popover survived a successful switch");
});

test("a tree with no other branch shows switchNone instead of a silent no-op", async () => {
  treeBranches = { main: { name: "main", headId: "n0", createdAt: "2026-09-01T09:00:00.000Z" } };
  const { container: out } = renderHub();
  await settle();
  await rtl.act(async () => {
    await openPopoverAndClickAction(2);
  });

  const err = document.querySelector(".ui-taskhub-pop .ui-error");
  assert.ok(err, "switchNone hint missing");
  assert.match(err.textContent, /没有其他分支可切换/);
  assert.ok(!stub.calls.some((c) => c.method === "taskTreeSwitch"), "switch must not fire with no target");
});

test("task cards carry an absolute timestamp precise to the second", async () => {
  const { container: out } = renderHub();
  await settle();
  // User ask 2026-09-02: relative "13m" alone cannot disambiguate runs — the
  // card meta must also show the local `YYYY-MM-DD HH:mm:ss` stamp (timezone
  // agnostic: pin the FORMAT, not a literal wall-clock value).
  const meta = out.querySelector(".ui-taskhub-card .meta");
  assert.ok(meta, `card meta missing: ${out.innerHTML}`);
  assert.match(
    meta.textContent ?? "",
    /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/,
    `no second-precision timestamp in: ${meta.textContent}`
  );
});

test("review report opens the RIGHT-SIDE quick sheet payload, not the main tab", async () => {
  const { quicks } = renderHub();
  await settle();
  const cards = [...document.querySelectorAll(".ui-taskhub-card")];
  const reviewCard = cards.find((c) => c.querySelector(".chip.tag-review"));
  assert.ok(reviewCard, `review card missing: ${document.body.innerHTML}`);
  await rtl.act(async () => {
    rtl.fireEvent.click(reviewCard);
    await Promise.resolve();
  });
  const pop = document.querySelector(".ui-taskhub-pop");
  assert.ok(pop, "popover did not open on the review card");
  const openBtn = pop.querySelector(".actions button");
  assert.ok(openBtn, "open-report action missing");
  await rtl.act(async () => {
    rtl.fireEvent.click(openBtn);
    await Promise.resolve();
  });
  assert.equal(quicks.length, 1, "onOpenQuick must fire exactly once");
  assert.deepEqual(quicks[0], {
    kind: "report",
    root: ROOT,
    reportId: "review-2026-09-01T11-00-00-000",
    title: "代码审查 · 全仓库",
  });
});
