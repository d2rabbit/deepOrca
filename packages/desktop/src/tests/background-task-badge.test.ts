/**
 * Tests for BackgroundTaskBadge — the compact bottom-right circular presence
 * for background work (real-machine feedback: the 460px build console used to
 * auto-open over the chat view; the badge replaces it, ring progress + module
 * icon: ◈ knowledge build / ⚖ code review). Pins:
 *   - nothing renders when no task runs,
 *   - knowledge jobs surface via the index.build-all event's job snapshot,
 *   - review runs appear on review.* progress and CLEAR on the terminal
 *     data.done event (the stuck-badge class we just spent a whole round
 *     killing),
 *   - click dispatches the module routing callback.
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
  BackgroundTaskBadge as BackgroundTaskBadgeComponent,
  BadgeTaskKind,
} from "../renderer/components/BackgroundTaskBadge";
import type { KnowledgeBuildJobSnapshot } from "../shared/ipc";

let dom: DomHandle;
let stub: ApiStub;
let rtl: typeof RTL;
let ReactPkg: typeof React;
let I18nProvider: typeof I18nProviderComponent;
let BackgroundTaskBadge: typeof BackgroundTaskBadgeComponent;

function runningKnowledgeJob(): KnowledgeBuildJobSnapshot {
  return {
    root: "/tmp/demo",
    mode: "update",
    stage: "[2/3] wiki update 运行中 60s",
    percent: 45,
    error: null,
    startedAt: new Date(Date.now() - 90_000).toISOString(),
    updatedAt: new Date().toISOString(),
    running: true,
    stages: [
      {
        id: "codegraph",
        labelKey: "codegraph",
        status: "done",
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
      },
      { id: "wiki", labelKey: "wiki", status: "running", startedAt: new Date().toISOString() },
    ],
    logs: [],
  };
}

/** Render the badge under the zh locale; returns [container, onOpen spy]. */
function renderBadge(): [HTMLElement, Array<BadgeTaskKind>] {
  const opened: BadgeTaskKind[] = [];
  const utils = rtl.render(
    ReactPkg.createElement(
      I18nProvider,
      null,
      ReactPkg.createElement(BackgroundTaskBadge, { onOpen: (k) => opened.push(k) })
    )
  );
  return [utils.container, opened];
}

before(async () => {
  dom = installDom();
  const g = globalThis as unknown as { localStorage: Storage };
  g.localStorage = window.localStorage;
  localStorage.setItem("deeporca.locale", "zh");
  stub = createApiStub({ knowledgeBuildStatus: async () => [] as KnowledgeBuildJobSnapshot[] });
  (globalThis as unknown as { window: { deeporca: unknown } }).window.deeporca = stub.api;
  rtl = await import("@testing-library/react");
  ReactPkg = await import("react");
  ({ I18nProvider } = await import("../renderer/i18n"));
  ({ BackgroundTaskBadge } = await import("../renderer/components/BackgroundTaskBadge"));
});

after(() => {
  delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
  dom.cleanup();
});
afterEach(() => rtl.cleanup());

test("no running task → nothing rendered", async () => {
  const [out] = renderBadge();
  assert.equal(out.querySelector(".ui-task-badge"), null);
});

test("knowledge build event → ◈ ring with progress arc; click routes to knowledge", async () => {
  const [out, opened] = renderBadge();
  // Let the mount-time status poll settle before driving events (its stale
  // [] response would otherwise race the event snapshot — the hook now guards
  // this, but the test stays deterministic).
  await rtl.act(async () => {
    await Promise.resolve();
  });
  await rtl.act(async () => {
    stub.emit("onActionProgress", {
      actionId: "index.build-all",
      message: "[2/3] wiki update 运行中 60s",
      percent: 45,
      data: { root: "/tmp/demo", job: runningKnowledgeJob() },
    });
  });
  const badge = out.querySelector(".ui-task-badge");
  assert.ok(badge, `badge missing: ${out.innerHTML}`);
  assert.ok(badge.classList.contains("kind-knowledge"), `kind class missing: ${badge.className}`);
  assert.ok(badge.textContent?.includes("◈"), `knowledge icon missing: ${badge.textContent}`);
  assert.ok(!badge.classList.contains("indeterminate"), `known percent must not be indeterminate`);
  const arc = badge.querySelector(".ui-task-badge-arc");
  assert.ok(arc, "progress arc missing");
  assert.ok(arc.getAttribute("stroke-dashoffset"), "progress arc carries no offset");
  // Tooltip carries the stage verb + hint.
  assert.ok(badge.getAttribute("title")?.includes("正在构建 Wiki"), `title: ${badge.getAttribute("title")}`);
  assert.ok(badge.getAttribute("title")?.includes("点击查看详情"));
  badge.dispatchEvent(new window.Event("click", { bubbles: true }));
  assert.deepEqual(opened, ["knowledge"]);
});

test("review run appears on review.* progress and clears on terminal data.done", async () => {
  const [out, opened] = renderBadge();
  // Let the mount-time status poll settle before driving events (its stale
  // [] response would otherwise race the event snapshot — the hook now guards
  // this, but the test stays deterministic).
  await rtl.act(async () => {
    await Promise.resolve();
  });
  await rtl.act(async () => {
    stub.emit("onActionProgress", {
      actionId: "review.full",
      message: "ocr 运行中 20s（LLM 审查阶段通常无进度流）",
      percent: 15,
    });
  });
  const badge = out.querySelector(".ui-task-badge");
  assert.ok(badge, `review badge missing: ${out.innerHTML}`);
  assert.ok(badge.classList.contains("kind-review"), `kind class missing: ${badge.className}`);
  assert.ok(badge.textContent?.includes("⚖"), `review icon missing: ${badge.textContent}`);
  assert.ok(badge.getAttribute("title")?.includes("代码审查进行中"), `title: ${badge.getAttribute("title")}`);
  badge.dispatchEvent(new window.Event("click", { bubbles: true }));
  assert.deepEqual(opened, ["review"]);

  // Terminal event must clear the badge — a stuck "running" indicator is the
  // exact failure class this round eliminated everywhere else.
  await rtl.act(async () => {
    stub.emit("onActionProgress", {
      actionId: "review.full",
      message: "done",
      percent: 100,
      data: { done: true },
    });
  });
  assert.equal(out.querySelector(".ui-task-badge"), null, "badge survived the terminal event");
});

test("job with null percent renders the indeterminate sweep", async () => {
  const [out] = renderBadge();
  // Let the mount-time status poll settle before driving events (its stale
  // [] response would otherwise race the event snapshot — the hook now guards
  // this, but the test stays deterministic).
  await rtl.act(async () => {
    await Promise.resolve();
  });
  const job = runningKnowledgeJob();
  job.percent = null;
  await rtl.act(async () => {
    stub.emit("onActionProgress", {
      actionId: "index.build-all",
      message: "…",
      data: { root: "/tmp/demo", job },
    });
  });
  const badge = out.querySelector(".ui-task-badge");
  assert.ok(badge, "badge missing");
  assert.ok(badge.classList.contains("indeterminate"), "null percent must render indeterminate");
  assert.ok(badge.querySelector(".ui-task-badge-sweep"), "rotating sweep arc missing");
});
