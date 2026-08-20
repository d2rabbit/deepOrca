/**
 * E8 guard tests (experiment-plan.md): adaptive work panel + stage tabs with
 * the three full-body module views.
 *
 *   - an overlay of a tab-capable module carries an expand affordance that
 *     loads its full-body view into a stage tab; tabs switch and close
 *   - the task-tree canvas renders real branch lanes with why-narratives and
 *     drives the real tree operations (switch / fork)
 *   - the sources dashboard renders the card wall + CRG index library, reads
 *     wiki pages, and rebuild-all fans out to every real rebuild channel
 *   - the review workbench uses the live action path (review.check-available /
 *     review.full — the legacy review:run IPC has no main handler), renders
 *     structured findings, keeps a session-local run history, and converts a
 *     finding into an engine intervention
 */

import { test, describe, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { installDom, createApiStub, type DomHandle, type ApiStub } from "./dom-harness";
import type * as RTL from "@testing-library/react";
import type * as React from "react";
import type { DeckApp as DeckAppComponent } from "../renderer/deck/deck-app";
import type { I18nProvider as I18nProviderComponent } from "../renderer/i18n";

let dom: DomHandle;
let stub: ApiStub;
let fixture: Record<string, unknown>;
let render: typeof RTL.render;
let act: typeof RTL.act;
let fireEvent: typeof RTL.fireEvent;
let createElement: typeof React.createElement;
let StrictMode: typeof React.StrictMode;
let DeckApp: typeof DeckAppComponent;
let I18nProvider: typeof I18nProviderComponent;

const TREE_INDEX = {
  version: 1 as const,
  id: "tree-1",
  rootId: "n-root",
  title: "批量权限改造",
  activeBranch: "main",
  createdAt: "2026-08-20T10:00:00Z",
  updatedAt: "2026-08-20T12:00:00Z",
  branches: {
    main: { name: "main", headId: "n-b", createdAt: "2026-08-20T10:00:00Z" },
    "try/popup": { name: "try/popup", headId: "n-c", createdAt: "2026-08-20T11:00:00Z", abandoned: true },
  },
};

const TREE_NODES = [
  {
    id: "n-root",
    treeId: "tree-1",
    parentId: null,
    kind: "root",
    title: "起点",
    why: "开工",
    artifactRefs: [],
    memoryRefs: [],
    status: "done",
    createdAt: "2026-08-20T10:00:00Z",
    meta: { createdBy: "user" },
  },
  {
    id: "n-a",
    treeId: "tree-1",
    parentId: "n-root",
    kind: "step",
    title: "读现状",
    why: "先摸清权限流",
    artifactRefs: ["a.ts"],
    memoryRefs: [],
    status: "done",
    createdAt: "2026-08-20T10:05:00Z",
    meta: { createdBy: "agent" },
  },
  {
    id: "n-b",
    treeId: "tree-1",
    parentId: "n-a",
    kind: "step",
    title: "队列设计",
    why: "批量队列方案",
    artifactRefs: ["b.ts", "c.ts"],
    memoryRefs: [],
    status: "running",
    createdAt: "2026-08-20T11:30:00Z",
    meta: { createdBy: "agent" },
  },
  {
    id: "n-c",
    treeId: "tree-1",
    parentId: "n-a",
    kind: "fork",
    title: "逐条弹卡",
    why: "打断太强，弃",
    artifactRefs: [],
    memoryRefs: [],
    status: "abandoned",
    createdAt: "2026-08-20T11:00:00Z",
    meta: { createdBy: "user" },
  },
];

const KNOWLEDGE = {
  codegraph: { state: "indexed", count: 3, unit: "k", lastSync: "2026-08-20T09:00:00Z" },
  openwiki: { state: "indexed", count: 64, unit: "页", lastSync: "2026-08-19T09:00:00Z" },
  serena: { state: "empty" },
  agents: { state: "indexed" },
  memory: { state: "indexed", count: 128, unit: "条", stats: { l0: 10, l1: 100, l2: 18, l3: true } },
  routing: { state: "stale" },
};

const REVIEW_OUTPUT = {
  review: {
    status: "success",
    summary: "整体风险低",
    comments: [
      { path: "src/a.ts", startLine: 10, content: "缺少超时兜底", suggestionCode: "withTimeout(fn, 5000)" },
      { path: "src/b.ts", startLine: 42, content: "命名建议提取常量" },
    ],
  },
  risk: { graphBuilt: true, changedNodes: [{}, {}] },
  statusNote: "active: 语义+结构双路",
};

function defaultFixture(): Record<string, unknown> {
  return {
    getActiveSession: async () => null,
    getSession: async () => null,
    listSessions: async () => [],
    editorListFiles: async () => ({ ok: true, entries: [] }),
    sendPrompt: async () => ({ ok: true }),
    knowledgeStatus: async () => KNOWLEDGE,
    crgList: async () => [{ root: "/repo", label: "repo", hasGraph: true }],
    taskTreeList: async () => [],
    taskTreeGet: async () => null,
    taskTreeReflog: async () => [],
    actionRun: async () => ({ ok: true, output: { available: false } }),
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

describe("Deck E8 stage tabs + full-body modules", () => {
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
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    return { unmount: () => result.unmount(), container: result.container };
  }

  async function openOverlay(container: HTMLElement, kind: string): Promise<void> {
    const entry = container.querySelector(`[data-overlay="${kind}"]`);
    assert.ok(entry, `dock entry for ${kind} missing`);
    await act(async () => {
      fireEvent.click(entry);
    });
  }

  async function expandToTab(container: HTMLElement, kind: string): Promise<void> {
    await openOverlay(container, kind);
    const expand = container.querySelector(`[data-layer="${kind}"] .deck-overlay-expand`);
    assert.ok(expand, `${kind} overlay should offer the expand-to-tab affordance`);
    await act(async () => {
      fireEvent.click(expand!);
    });
  }

  test("overlay expand loads the module into a stage tab; tabs switch and close", async () => {
    mounted = await mountDeck();
    assert.equal(mounted.container.querySelector(".deck-tabstrip"), null, "no tab strip before the first tab");

    await expandToTab(mounted.container, "tree");

    const strip = mounted.container.querySelector(".deck-tabstrip");
    assert.ok(strip, "tab strip should appear once a module tab exists");
    assert.equal(mounted.container.querySelector('[data-layer="tree"]'), null, "expand retires the overlay");
    assert.ok(mounted.container.querySelector(".deck-tabpage"), "stage should render the tab page");
    assert.ok(mounted.container.textContent?.includes("No task trees yet"), "the tree tab mounts the full-body canvas");

    const workOrderTab = [...strip!.querySelectorAll(".deck-tab")][0];
    const tabs = [...strip!.querySelectorAll(".deck-tab")];
    assert.equal(tabs.length, 2, `expected work-order + tree tabs, saw ${tabs.length}`);
    assert.ok(tabs[1].getAttribute("aria-selected") === "true", "the new tab starts active");

    await act(async () => {
      fireEvent.click(tabs[1].querySelector(".deck-tab-close")!);
    });
    assert.equal(
      mounted.container.querySelector(".deck-tabstrip"),
      null,
      "closing the last module tab hides the strip"
    );
    assert.equal(mounted.container.querySelector(".deck-tabpage"), null, "work-order stage is restored");
  });

  test("Esc with an empty overlay stack retires the module tab", async () => {
    mounted = await mountDeck();
    await expandToTab(mounted.container, "sources");
    assert.ok(mounted.container.querySelector(".deck-tabpage"));

    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    assert.equal(mounted.container.querySelector(".deck-tabpage"), null, "Esc returns to the work-order stage");
  });

  test("tree canvas renders branch lanes with why and drives switch/fork", async () => {
    fixture.taskTreeList = async () => [
      {
        id: "tree-1",
        title: "批量权限改造",
        activeBranch: "main",
        branchCount: 2,
        nodeCount: 4,
        updatedAt: "2026-08-20T12:00:00Z",
        sessionIds: [],
        archived: false,
      },
    ];
    fixture.taskTreeGet = async () => ({ index: TREE_INDEX, nodes: TREE_NODES });
    fixture.taskTreeReflog = async () => [{ at: "2026-08-20T11:00:00Z", op: "fork", branch: "try/popup" }];
    fixture.taskTreeSwitch = async () => ({ ok: true });
    fixture.taskTreeFork = async () => ({ nodeId: "n-d", branch: "try/new" });

    mounted = await mountDeck();
    await expandToTab(mounted.container, "tree");

    const treeRow = [...mounted.container.querySelectorAll(".deck-tree-side .deck-row")].find((r) =>
      r.textContent?.includes("批量权限改造")
    );
    assert.ok(treeRow, "tree list should show the real tree");
    await act(async () => {
      fireEvent.click(treeRow!);
    });

    const canvas = mounted.container.querySelector(".deck-tree-main");
    assert.ok(canvas, "canvas missing");
    assert.ok(canvas!.textContent?.includes("try/popup"), "the second branch lane should render");
    assert.ok(canvas!.textContent?.includes("打断太强，弃"), "the fork why must be visible");
    assert.equal(canvas!.querySelectorAll(".deck-tlane").length, 2, "main + one fork lane");

    // Switching the abandoned branch hits the real IPC.
    const lane = [...canvas!.querySelectorAll(".deck-tlane")].find((l) => l.textContent?.includes("try/popup"))!;
    await act(async () => {
      fireEvent.mouseOver(lane);
    });
    const switchBtn = [...lane.querySelectorAll(".deck-op")].find((b) => b.textContent === "Switch");
    assert.ok(switchBtn, "non-active lanes carry a switch action");
    await act(async () => {
      fireEvent.click(switchBtn!);
    });
    assert.ok(
      stub.calls.some((c) => c.method === "taskTreeSwitch" && c.args[0] === "tree-1" && c.args[1] === "try/popup"),
      "switch should call taskTreeSwitch with the branch"
    );

    // Node detail: click the queue-design node.
    const node = [...canvas!.querySelectorAll(".deck-tnode")].find((n) => n.getAttribute("aria-label") === "队列设计")!;
    await act(async () => {
      fireEvent.click(node);
    });
    const detail = canvas!.querySelector(".deck-tree-detail");
    assert.ok(detail?.textContent?.includes("批量队列方案"), "node detail shows the why narrative");

    // Fork requires a why and calls taskTreeFork.
    const input = canvas!.querySelector(".deck-tree-foot input")!;
    await act(async () => {
      fireEvent.change(input, { target: { value: "试试静默批准" } });
    });
    const forkBtn = [...canvas!.querySelectorAll(".deck-tree-foot .deck-op")].find((b) =>
      b.textContent?.includes("Fork")
    )!;
    await act(async () => {
      fireEvent.click(forkBtn);
    });
    assert.ok(
      stub.calls.some((c) => c.method === "taskTreeFork" && c.args[0] === "tree-1" && c.args[1] === "试试静默批准"),
      "fork should call taskTreeFork with the why"
    );
  });

  test("sources dashboard: card wall, CRG library, wiki reading, rebuild-all", async () => {
    fixture.wikiListPages = async () => [{ path: "arch/overview.md", title: "架构总览" }];
    fixture.wikiReadPage = async () => "# 架构总览\n内容";
    fixture.codegraphReindex = async () => ({ ok: true });
    fixture.wikiUpdate = async () => ({ ok: true });
    fixture.crgReindex = async () => ({ ok: true, action: "reset" });

    mounted = await mountDeck();
    await expandToTab(mounted.container, "sources");

    const cards = mounted.container.querySelectorAll(".deck-src-card");
    assert.equal(cards.length, 7, `6 sources + CRG card, saw ${cards.length}`);
    assert.ok(mounted.container.textContent?.includes("4/6"), "readiness tag reflects real states");

    // Rebuild-all fans out to every real channel.
    const rebuildAll = [...mounted.container.querySelectorAll(".deck-op")].find(
      (b) => b.textContent === "Rebuild all"
    )!;
    await act(async () => {
      fireEvent.click(rebuildAll);
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    for (const method of ["codegraphReindex", "wikiUpdate", "crgReindex"]) {
      assert.ok(
        stub.calls.some((c) => c.method === method),
        `rebuild-all should call ${method}`
      );
    }

    // CRG card → workspace library with the graph state.
    const crgCard = [...cards].find((c) => c.textContent?.includes("CRG"))!;
    await act(async () => {
      fireEvent.click(crgCard);
    });
    assert.ok(mounted.container.textContent?.includes("graph built"), "CRG detail shows the graph state");

    // Back → OpenWiki card → page list → read a page.
    const container = mounted.container;
    await act(async () => {
      fireEvent.click(container.querySelector(".deck-sub-back")!);
    });
    const wikiCard = [...container.querySelectorAll(".deck-src-card")].find((c) =>
      c.textContent?.includes("OpenWiki")
    )!;
    await act(async () => {
      fireEvent.click(wikiCard);
    });
    const pageRow = [...container.querySelectorAll(".deck-row.linked")].find((r) =>
      r.textContent?.includes("架构总览")
    );
    assert.ok(pageRow, "wiki pages should list");
    await act(async () => {
      fireEvent.click(pageRow!);
    });
    assert.ok(mounted.container.textContent?.includes("# 架构总览"), "wiki page content renders inline");
  });

  test("review workbench: live action path, structured findings, intervention, history", async () => {
    fixture.actionRun = async (id: string) => {
      if (id === "review.check-available") return { ok: true, output: { available: true } };
      if (id === "review.full") return { ok: true, output: REVIEW_OUTPUT };
      return { ok: false, code: "UNKNOWN", error: id };
    };

    mounted = await mountDeck();
    await expandToTab(mounted.container, "review");

    const head = mounted.container.querySelector(".deck-review-head");
    assert.ok(head?.textContent?.includes("risk graph built"), "head shows the real graph state");

    const run = [...mounted.container.querySelectorAll(".deck-op")].find((b) =>
      b.textContent?.includes("review.full")
    )!;
    await act(async () => {
      fireEvent.click(run);
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    const body = mounted.container.querySelector(".deck-review-result");
    assert.ok(body?.textContent?.includes("缺少超时兜底"), "finding content renders");
    assert.ok(body?.textContent?.includes("src/a.ts:10"), "finding carries path:line");
    assert.ok(body?.textContent?.includes("整体风险低"), "summary renders");
    assert.ok(body?.textContent?.includes("语义+结构双路"), "status note renders");

    // Intervention sends the finding into the engine as a user prompt.
    const intervene = [...body!.querySelectorAll(".deck-op")].find((b) => b.textContent === "Send as intervention")!;
    await act(async () => {
      fireEvent.click(intervene);
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    const sent = stub.calls.find((c) => c.method === "sendPrompt");
    assert.ok(sent, "intervention should send a prompt");
    assert.ok(
      String((sent!.args[0] as { text: string }).text).includes("src/a.ts:10"),
      "intervention text carries the location"
    );

    // A second run accumulates into the session-local history (full variant).
    await act(async () => {
      fireEvent.click(run);
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    const runs = mounted.container.querySelectorAll(".deck-review-runs .deck-row");
    assert.equal(runs.length, 2, `expected 2 history rows, saw ${runs.length}`);
  });

  test("compact overlay variant hides the run history sidebar", async () => {
    fixture.actionRun = async (id: string) => {
      if (id === "review.check-available") return { ok: true, output: { available: true } };
      if (id === "review.full") return { ok: true, output: REVIEW_OUTPUT };
      return { ok: false, code: "UNKNOWN", error: id };
    };

    mounted = await mountDeck();
    await openOverlay(mounted.container, "review");
    const overlay = mounted.container.querySelector('[data-layer="review"]');
    assert.ok(overlay, "review overlay missing");
    assert.equal(overlay!.querySelector(".deck-review-runs"), null, "overlay stays the thumbnail — no history rail");

    const run = [...overlay!.querySelectorAll(".deck-op")].find((b) => b.textContent?.includes("review.full"))!;
    await act(async () => {
      fireEvent.click(run);
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    assert.ok(overlay!.textContent?.includes("缺少超时兜底"), "the overlay still runs the live action path");
  });
});
