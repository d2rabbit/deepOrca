/**
 * Tests for KnowledgeBuildProgress — the stage checklist the knowledge tab
 * shows while a build runs (real-machine feedback: the old one-line banner
 * rendered "label · mm:ss", which read as a bare timer). These pin the
 * behavior the feedback asked for:
 *   - the pipeline 索引 → Wiki → 架构图 is visible as stages with state marks;
 *   - stage 1 wording is mode-aware (正在生成索引 vs 正在更新索引);
 *   - the running Wiki stage explains that it reads the symbol index;
 *   - the console tail surfaces the live log lines.
 *
 * Harness: node:test has no DOM, so dom-harness installs jsdom globals BEFORE
 * @testing-library/react and the components are imported. The locale is
 * pinned to zh via localStorage so assertions target the Chinese copy.
 */

import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";

import { installDom, type DomHandle } from "./dom-harness";
// Type-only imports: erased at compile time (verbatimModuleSyntax) — the
// runtime imports happen in before(), after the DOM exists.
import type * as RTL from "@testing-library/react";
import type * as React from "react";
import type { I18nProvider as I18nProviderComponent } from "../renderer/i18n";
import type { KnowledgeBuildProgress as KnowledgeBuildProgressComponent } from "../renderer/components/KnowledgeBuildProgress";
import type { KnowledgeBuildJobSnapshot } from "../shared/ipc";

let dom: DomHandle;
let rtl: typeof RTL;
let ReactPkg: typeof React;
let I18nProvider: typeof I18nProviderComponent;
let KnowledgeBuildProgress: typeof KnowledgeBuildProgressComponent;

function isoAgo(secs: number): string {
  return new Date(Date.now() - secs * 1000).toISOString();
}

/** An init-mode job mid-Wiki: index done, wiki running, arch pending. */
function midWikiJob(): KnowledgeBuildJobSnapshot {
  return {
    root: "/tmp/demo",
    mode: "init",
    stage: "[2/3] wiki init 运行中 60s",
    percent: 45,
    error: null,
    startedAt: isoAgo(90),
    updatedAt: isoAgo(20),
    running: true,
    stages: [
      { id: "codegraph", labelKey: "codegraph", status: "done", startedAt: isoAgo(90), endedAt: isoAgo(60) },
      {
        id: "wiki",
        labelKey: "wiki",
        status: "running",
        startedAt: isoAgo(60),
        detail: "wiki init 运行中 60s · 已生成 3 个页面",
      },
      { id: "arch-scan", labelKey: "arch", status: "pending" },
    ],
    logs: [
      "12:00:00 build init started",
      "12:00:30 [1/3] CodeGraph done",
      "12:01:00 [2/3] wiki init 运行中 60s · 读取符号索引加速生成",
    ],
  };
}

/** Render the panel under the zh locale and return the container. */
function renderPanel(job: KnowledgeBuildJobSnapshot, variant?: "full" | "compact"): HTMLElement {
  const utils = rtl.render(
    ReactPkg.createElement(I18nProvider, null, ReactPkg.createElement(KnowledgeBuildProgress, { job, variant }))
  );
  return utils.container;
}

before(async () => {
  dom = installDom();
  // i18n's detectLocale reads the bare `localStorage` global, which the DOM
  // harness does not install (jsdom keeps it on window) — expose it, then pin
  // the locale before the provider mounts.
  const g = globalThis as unknown as { localStorage: Storage };
  g.localStorage = window.localStorage;
  localStorage.setItem("deeporca.locale", "zh");
  rtl = await import("@testing-library/react");
  ReactPkg = await import("react");
  ({ I18nProvider } = await import("../renderer/i18n"));
  ({ KnowledgeBuildProgress } = await import("../renderer/components/KnowledgeBuildProgress"));
});

after(() => {
  delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
  dom.cleanup();
});
afterEach(() => rtl.cleanup());

test("mid-wiki job shows the full 索引 → Wiki → 架构图 pipeline with states", async () => {
  const out = renderPanel(midWikiJob());
  const text = out.textContent ?? "";
  // All three stage names present, in pipeline order.
  const iIdx = text.indexOf("索引");
  const wIdx = text.indexOf("Wiki");
  const aIdx = text.indexOf("架构图");
  assert.ok(iIdx >= 0 && wIdx > iIdx && aIdx > wIdx, `pipeline order broken: ${text}`);
  // Wiki is running with the index-acceleration hint (the feedback's point).
  assert.ok(text.includes("正在构建 Wiki"), `running wiki verb missing: ${text}`);
  assert.ok(text.includes("读取符号索引加速生成"), `index hint missing: ${text}`);
  // The running stage's live line carries the page-count heartbeat.
  assert.ok(text.includes("已生成 3 个页面"), `live heartbeat detail missing: ${text}`);
  // Completed stage 1 shows its verdict, pending arch shows 待开始.
  assert.ok(text.includes("完成"), `done verdict missing: ${text}`);
  assert.ok(text.includes("待开始"), `pending label missing: ${text}`);
  // Head carries mode + elapsed wording.
  assert.ok(text.includes("完整构建"), `mode label missing: ${text}`);
  assert.ok(text.includes("已运行"), `elapsed wording missing: ${text}`);
});

test("compact variant (left rail, under the row): stages + live line, no console tail", async () => {
  const out = renderPanel(midWikiJob(), "compact");
  const text = out.textContent ?? "";
  assert.ok(out.querySelector(".ui-knowledge-build.compact"), `compact class missing: ${text}`);
  assert.ok(text.includes("正在构建 Wiki"), `running wiki verb missing: ${text}`);
  // The live heartbeat replaces the console tail in the narrow rail panel.
  assert.ok(text.includes("已生成 3 个页面"), `live heartbeat detail missing: ${text}`);
  assert.ok(!text.includes("控制台输出"), `console tail leaked into compact variant: ${text}`);
});

test("stage-1 wording is mode-aware: 生成索引 vs 更新索引", async () => {
  const initJob = midWikiJob();
  initJob.stages = [
    { id: "codegraph", labelKey: "codegraph", status: "running", startedAt: isoAgo(5) },
    { id: "wiki", labelKey: "wiki", status: "pending" },
    { id: "arch-scan", labelKey: "arch", status: "pending" },
  ];
  const initOut = renderPanel(initJob);
  assert.ok((initOut.textContent ?? "").includes("正在生成索引"), `init verb missing: ${initOut.textContent}`);

  const updateJob: KnowledgeBuildJobSnapshot = {
    ...midWikiJob(),
    mode: "update",
    stages: [
      { id: "codegraph", labelKey: "codegraph", status: "running", startedAt: isoAgo(5) },
      { id: "wiki", labelKey: "wiki", status: "pending" },
    ],
  };
  const updateOut = renderPanel(updateJob);
  const updateText = updateOut.textContent ?? "";
  assert.ok(updateText.includes("正在更新索引"), `update verb missing: ${updateText}`);
  assert.ok(!updateText.includes("正在生成索引"), `init verb leaked into update mode: ${updateText}`);
  assert.ok(!updateText.includes("架构图"), `arch stage leaked into update mode: ${updateText}`);
});

test("failed stage surfaces its error; console tail shows the last log lines", async () => {
  const job = midWikiJob();
  job.running = false;
  job.error = "wiki: openwiki exited 1: boom";
  job.stages[1] = {
    id: "wiki",
    labelKey: "wiki",
    status: "failed",
    startedAt: isoAgo(60),
    endedAt: isoAgo(3),
    error: "openwiki exited 1: boom",
  };
  const out = renderPanel(job);
  const text = out.textContent ?? "";
  assert.ok(text.includes("失败"), `failed verdict missing: ${text}`);
  assert.ok(text.includes("openwiki exited 1: boom"), `stage error missing: ${text}`);
  assert.ok(text.includes("控制台输出"), `console title missing: ${text}`);
  assert.ok(text.includes("12:01:00"), `console tail missing newest line: ${text}`);
});
