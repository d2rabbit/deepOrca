/**
 * PrototypeWorkspace brief injection (specs/artifact-landing 链路 C15) —
 * regression: the spec tab's 「注入实现会话」 button must actually reach the
 * composer callback. It shipped unwired (onQuoteToChat never reached
 * PrototypeWorkspace through DesignWorkspaceSurface), so the button always
 * toasted "unavailable" — this test renders the workspace through the dom
 * harness, generates the brief and clicks inject with the App-side callback
 * attached. api.ts binds window.deeporca at module load, so the stub installs
 * before the component import.
 */

import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";

import { installDom, createApiStub, type DomHandle, type ApiStub } from "./dom-harness";
import { messages } from "../renderer/i18n/messages";
import type * as RTL from "@testing-library/react";
import type * as React from "react";
import type { I18nProvider as I18nProviderComponent } from "../renderer/i18n";
import type { DesignWorkspaceSurface as DesignWorkspaceSurfaceComponent } from "../renderer/components/design-workspace/DesignWorkspaceSurface";

let dom: DomHandle;
let stub: ApiStub;
let rtl: typeof RTL;
let ReactPkg: typeof React;
let I18nProvider: typeof I18nProviderComponent;
let DesignWorkspaceSurface: typeof DesignWorkspaceSurfaceComponent;

const SUITE = {
  schemaVersion: 2 as const,
  id: "s1",
  title: "登录重设计",
  kind: "prototype" as const,
  status: "draft" as const,
  createdAt: "2026-09-08T00:00:00.000Z",
  updatedAt: "2026-09-08T00:00:00.000Z",
  currentVersionId: "v1",
  versions: [
    {
      versionId: "v1",
      savedAt: "2026-09-08T00:00:00.000Z",
      status: "draft" as const,
      content: { spec: "## 登录页\n\n- 账号密码输入\n" },
    },
  ],
  currentVersion: {
    versionId: "v1",
    savedAt: "2026-09-08T00:00:00.000Z",
    status: "draft" as const,
    content: { spec: "## 登录页\n\n- 账号密码输入\n" },
  },
  currentContent: { spec: "## 登录页\n\n- 账号密码输入\n" },
};

const BRIEF_MD = "# 登录模块 落地简报\n\n按简报实现。";
/** injectBrief composes its own lead-in (App's bridge is a dumb pipe so
 *  quality/verification quotes don't get brief wording). */
const BRIEF_LEAD = messages.zh["prototypeWorkspace.briefInjectPrompt"];
const quotes: string[] = [];

before(async () => {
  dom = installDom();
  const g = globalThis as unknown as { localStorage: Storage };
  g.localStorage = window.localStorage;
  localStorage.setItem("deeporca.locale", "zh");
  stub = createApiStub({
    designSuiteList: async () => [SUITE],
    designSuiteRead: async () => SUITE,
    prototypeSpecSlides: async () => ({
      ok: true,
      html: "<section>slide</section>",
      css: "section{color:#000}",
      pages: 1,
      remoteImages: 0,
    }),
    prototypeBuildBrief: async () => ({ ok: true, briefMd: BRIEF_MD, path: "/x/brief.md" }),
  });
  (globalThis as unknown as { window: { deeporca: unknown } }).window.deeporca = stub.api;
  rtl = await import("@testing-library/react");
  ReactPkg = await import("react");
  ({ I18nProvider } = await import("../renderer/i18n"));
  ({ DesignWorkspaceSurface } = await import("../renderer/components/design-workspace/DesignWorkspaceSurface"));
});

after(() => {
  delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
  dom.cleanup();
});
afterEach(() => {
  quotes.length = 0;
  rtl.cleanup();
});

test("brief inject (C15): 生成落地简报 → 注入实现会话 reaches the composer callback", async () => {
  // Render through the Surface — the shipped bug was exactly this hop never
  // forwarding onQuoteToChat (App → Surface → workspace), so the test must
  // pin the full chain, not PrototypeWorkspace in isolation.
  const utils = rtl.render(
    ReactPkg.createElement(
      I18nProvider,
      null,
      ReactPkg.createElement(DesignWorkspaceSurface, {
        tab: { kind: "prototype", root: "/ws" },
        onClose: () => {},
        onQuoteToChat: (quote: string) => quotes.push(quote),
      })
    )
  );
  // React.lazy + suite load resolve asynchronously — poll through waitFor.
  // Doc view is the default; the toggle click below is a defensive no-op so
  // the suite still has a spec; switch via the exact-text seg toggle (the
  // 需求文档 tab also contains 文档).
  const findButton = (label: string): HTMLButtonElement | undefined =>
    [...utils.container.querySelectorAll("button")].find((b) => b.textContent?.includes(label));
  const findExactButton = (label: string): HTMLButtonElement | undefined =>
    [...utils.container.querySelectorAll("button")].find((b) => b.textContent?.trim() === label);
  await rtl.waitFor(
    () => {
      if (!findExactButton("文档")) throw new Error("view toggle not mounted yet");
    },
    { timeout: 10000 }
  );
  await rtl.act(async () => {
    findExactButton("文档")!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
  const generate = await rtl.waitFor(
    () => {
      const btn = findButton("生成落地简报");
      if (!btn) throw new Error("generate-brief button not mounted yet");
      return btn;
    },
    { timeout: 10000 }
  );
  assert.equal(generate.disabled, false, "generate-brief button disabled");
  await rtl.act(async () => {
    generate!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
  const inject = await rtl.waitFor(
    () => {
      const btn = findButton("注入实现会话");
      if (!btn) throw new Error("inject button not mounted yet");
      return btn;
    },
    { timeout: 10000 }
  );
  await rtl.act(async () => {
    inject.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
  assert.deepEqual(quotes, [`${BRIEF_LEAD}\n${BRIEF_MD}`]);
});
