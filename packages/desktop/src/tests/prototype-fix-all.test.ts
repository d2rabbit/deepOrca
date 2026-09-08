/**
 * fixAllFailed head-threading regression (user ask 2026-09-08, GVGL): each
 * revision moves the suite head; round two used to re-send the captured
 * selectedVersion and tripped the store's "suite head has moved" guard
 * (a2ui-mcp M2). The loop must build each round on the version the previous
 * one returned. api.ts binds window.deeporca at module load, so the stub
 * installs before the component import.
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

const content = (versionId: string) => ({
  requirement: "订单管理",
  spec: "## 页面清单\n\n- 订单页\n",
  openui: 'root = Text("订单")',
  verification: {
    status: "failed",
    checks: [
      { id: "c1", label: "订单页可打开", status: "failed", observation: "订单页按钮无响应" },
      { id: "c2", label: "设置页可打开", status: "failed", observation: "设置页按钮无响应" },
    ],
    generatedAt: "2026-09-08T00:00:00.000Z",
    healingRounds: 0,
  },
  versionId,
});

const suiteFor = (head: string) => ({
  schemaVersion: 2 as const,
  id: "s1",
  title: "轻订单管理",
  kind: "prototype" as const,
  status: "ready" as const,
  createdAt: "2026-09-08T00:00:00.000Z",
  updatedAt: "2026-09-08T00:00:00.000Z",
  currentVersionId: head,
  versions: [
    { versionId: head, savedAt: "2026-09-08T00:00:00.000Z", status: "ready" as const, content: content(head) },
  ],
  currentVersion: {
    versionId: head,
    savedAt: "2026-09-08T00:00:00.000Z",
    status: "ready" as const,
    content: content(head),
  },
  currentContent: content(head),
});

let reviseBases: Array<string | undefined>;
let head: string;

before(async () => {
  dom = installDom();
  const g = globalThis as unknown as { localStorage: Storage };
  g.localStorage = window.localStorage;
  localStorage.setItem("deeporca.locale", "zh");
  head = "v1";
  reviseBases = [];
  stub = createApiStub({
    designSuiteList: async () => [suiteFor(head)],
    designSuiteRead: async () => suiteFor(head),
    designSuiteReadVersion: async (_root: string, _id: string, versionId: string) => ({
      versionId,
      savedAt: "2026-09-08T00:00:00.000Z",
      status: "ready" as const,
      content: content(versionId),
    }),
    // Each revision advances the head v1 → v2 → v3, exactly like the real
    // appendDesignSuiteVersion the guard protects. Report tab revises the
    // verification part.
    actionRun: async (_id: string, input: Record<string, unknown>) => {
      assert.equal(input.part, "verification");
      reviseBases.push(input.versionId as string);
      const next = head === "v1" ? "v2" : "v3";
      head = next;
      return { ok: true, output: { artifactRef: { suiteId: "s1", versionId: next, kind: "prototype" } } };
    },
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
  reviseBases = [];
  rtl.cleanup();
});

test("fix-all threads the head forward — round two builds on round one's new version", async () => {
  const utils = rtl.render(
    ReactPkg.createElement(
      I18nProvider,
      null,
      ReactPkg.createElement(PrototypeWorkspace, { root: "/ws", initialTab: "report" })
    )
  );
  const findButton = (label: string): HTMLButtonElement | undefined =>
    [...utils.container.querySelectorAll("button")].find((b) => b.textContent?.includes(label));
  const fixAll = await rtl.waitFor(
    () => {
      const btn = findButton("一键修复全部未过项");
      if (!btn) throw new Error("fix-all button not mounted yet");
      return btn;
    },
    { timeout: 10000 }
  );
  await rtl.act(async () => {
    fixAll.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
  });
  assert.deepEqual(reviseBases, ["v1", "v2"], "round two must build on round one's returned version");
});
