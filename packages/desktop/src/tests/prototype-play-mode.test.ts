/**
 * 交互播放模式(user ask 2026-09-09):点击「交互演示」后整个工作区进入
 * 可交互播放——工具栏/版本轨/tab 冻结,元素选取与 AI 悬浮窗不可用;
 * Esc 或退出按钮返回,且退出后一切原样还原(播放只切换状态,不卸载,
 * AI 聊天记录保留)。api.ts binds window.deeporca at module load, so the
 * stub installs before the component import.
 */

import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";

import { installDom, createApiStub, type DomHandle, type ApiStub } from "./dom-harness";
import type * as RTL from "@testing-library/react";
import type * as React from "react";
import type { I18nProvider as I18nProviderComponent } from "../renderer/i18n";
import type { PrototypeWorkspace as PrototypeWorkspaceComponent } from "../renderer/components/design-workspace/PrototypeWorkspace";

let dom: DomHandle;
let stub: ApiStub;
let rtl: typeof RTL;
let ReactPkg: typeof React;
let I18nProvider: typeof I18nProviderComponent;
let PrototypeWorkspace: typeof PrototypeWorkspaceComponent;

const openuiContent = {
  requirement: "订单管理",
  spec: "## 页面清单\n\n- 订单页\n",
  openui: 'root = Text("订单")',
};

const suiteWithOpenui = {
  schemaVersion: 2 as const,
  id: "s1",
  title: "轻订单管理",
  kind: "prototype" as const,
  status: "ready" as const,
  createdAt: "2026-09-09T00:00:00.000Z",
  updatedAt: "2026-09-09T00:00:00.000Z",
  currentVersionId: "v1",
  versions: [
    { versionId: "v1", savedAt: "2026-09-09T00:00:00.000Z", status: "ready" as const, content: openuiContent },
  ],
  currentVersion: {
    versionId: "v1",
    savedAt: "2026-09-09T00:00:00.000Z",
    status: "ready" as const,
    content: openuiContent,
  },
  currentContent: openuiContent,
};

before(async () => {
  dom = installDom();
  const g = globalThis as unknown as { localStorage: Storage };
  g.localStorage = window.localStorage;
  localStorage.setItem("deeporca.locale", "zh");
  stub = createApiStub({
    designSuiteList: async () => [suiteWithOpenui],
    designSuiteRead: async () => suiteWithOpenui,
  });
  (globalThis as unknown as { window: { deeporca: unknown } }).window.deeporca = stub.api;
  rtl = await import("@testing-library/react");
  ReactPkg = await import("react");
  ({ I18nProvider } = await import("../renderer/i18n"));
  ({ PrototypeWorkspace } = await import("../renderer/components/design-workspace/PrototypeWorkspace"));
});

after(() => {
  delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
  dom.cleanup();
});
afterEach(() => {
  rtl.cleanup();
});

async function renderProtoTab() {
  const utils = rtl.render(
    ReactPkg.createElement(
      I18nProvider,
      null,
      ReactPkg.createElement(PrototypeWorkspace, { root: "/ws", initialTab: "proto" })
    )
  );
  const findButton = (label: string): HTMLButtonElement | undefined =>
    [...utils.container.querySelectorAll("button")].find((b) => b.textContent?.includes(label));
  const click = async (button: HTMLButtonElement) => {
    await rtl.act(async () => {
      button.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
  };
  await rtl.waitFor(
    () => {
      if (!findButton("交互演示")) throw new Error("play button not mounted yet");
    },
    { timeout: 10000 }
  );
  return { utils, findButton, click };
}

test("entering play mode freezes the workspace; exiting restores every surface", async () => {
  const { utils, findButton, click } = await renderProtoTab();
  const workspace = utils.container.querySelector(".ui-design-workspace");
  assert.ok(workspace, "workspace frame mounted");

  // 编辑入口在播放前全部可见
  assert.ok(findButton("生成原型"), "materialize visible before play");
  assert.ok(findButton("导出此版本"), "export visible before play");
  assert.ok(!utils.container.querySelector(".ui-design-playing-bar"), "no playing bar before play");
  assert.ok(!utils.container.querySelector(".ui-design-agent-slot[data-hidden]"), "AI agent visible before play");
  assert.ok(!workspace.hasAttribute("data-locked"), "frame unlocked before play");

  await click(findButton("交互演示")!);

  // 播放态:编辑按钮让位、frame 冻结、AI 悬浮窗隐藏
  assert.ok(utils.container.querySelector(".ui-design-playing-bar"), "playing bar replaces the toolbar");
  assert.ok(!findButton("生成原型"), "materialize hidden during play");
  assert.ok(!findButton("导出此版本"), "export hidden during play");
  assert.ok(workspace.hasAttribute("data-locked"), "frame locked during play");
  assert.ok(utils.container.querySelector(".ui-design-agent-slot[data-hidden]"), "AI agent hidden during play");

  await click(findButton("退出演示")!);

  // 退出后原样还原
  assert.ok(!utils.container.querySelector(".ui-design-playing-bar"), "playing bar gone after exit");
  assert.ok(findButton("生成原型"), "materialize back after exit");
  assert.ok(findButton("交互演示"), "play button back after exit");
  assert.ok(!workspace.hasAttribute("data-locked"), "frame unlocked after exit");
  assert.ok(!utils.container.querySelector(".ui-design-agent-slot[data-hidden]"), "AI agent visible after exit");
});

test("Escape exits play mode", async () => {
  const { utils, findButton, click } = await renderProtoTab();
  await click(findButton("交互演示")!);
  assert.ok(utils.container.querySelector(".ui-design-playing-bar"), "entered play mode");

  await rtl.act(async () => {
    window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape" }));
    await Promise.resolve();
    await Promise.resolve();
  });

  assert.ok(!utils.container.querySelector(".ui-design-playing-bar"), "Esc exited play mode");
  assert.ok(findButton("交互演示"), "play button available again");
});
