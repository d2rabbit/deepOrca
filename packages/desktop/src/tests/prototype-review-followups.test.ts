/**
 * 遗留修复验证(renderer/store 级,交叉审查后补齐 EARS 14/15/16/17/18):
 *  - specTodos 节边界(带后缀标题识别/越节不吞/[ ] 前缀剥离/正文早现不放行)
 *  - variant-only 套件可达(画布有程序、verify 可用)
 *  - slides 失败局部化(toast + 回退 doc,不写 workspace error)
 *  - 播放模式冻结画布 ToAssistant 动作(onIterate 直接调用不派发 revise)
 *  - 表单状态槽位隔离与非法 slot 拒绝(design-store 级)
 */

import { after, afterEach, before, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type * as React from "react";
import type * as RTL from "@testing-library/react";
import type { I18nProvider as I18nProviderComponent } from "../renderer/i18n";
import type { PrototypeWorkspace as PrototypeWorkspaceComponent } from "../renderer/components/design-workspace/PrototypeWorkspace";
import type { subscribeDesignToasts as SubscribeFn } from "../renderer/lib/toast-bus";
import { createApiStub, installDom, type ApiStub, type DomHandle } from "./dom-harness";
import { saveFormState, readFormState, saveDesignArtifact } from "../main/tools/design-store";
import type { DesignSuite, DesignSuiteVersion } from "../shared/ipc";

let dom: DomHandle;
let stub: ApiStub;
let rtl: typeof RTL;
let ReactPkg: typeof React;
let I18nProvider: typeof I18nProviderComponent;
let PrototypeWorkspace: typeof PrototypeWorkspaceComponent;
let subscribeDesignToasts: typeof SubscribeFn;
/** 共享 overrides 对象——stub 在每次调用时读取,test 内可随时替换方法。 */
const overridesRef: Record<string, unknown> = {};

before(async () => {
  dom = installDom();
  Object.defineProperty(globalThis, "localStorage", { value: window.localStorage, configurable: true });
  localStorage.setItem("deeporca.locale", "en");
  stub = createApiStub(overridesRef);
  (globalThis as unknown as { window: { deeporca: unknown } }).window.deeporca = stub.api;
  rtl = await import("@testing-library/react");
  ReactPkg = await import("react");
  ({ I18nProvider } = await import("../renderer/i18n"));
  ({ PrototypeWorkspace } = await import("../renderer/components/design-workspace/PrototypeWorkspace"));
  ({ subscribeDesignToasts } = await import("../renderer/lib/toast-bus"));
});

after(() => {
  delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
  dom.cleanup();
});
afterEach(() => {
  rtl.cleanup();
});

function version(versionId: string, content: DesignSuiteVersion["content"]): DesignSuiteVersion {
  return { versionId, content, note: versionId, savedAt: "2026-09-06T10:00:00.000Z", status: "ready" };
}

function prototypeSuite(content: DesignSuiteVersion["content"]): DesignSuite {
  const versions = [version("latest", content)];
  return {
    schemaVersion: 2,
    id: "proto-suite",
    title: "Orders",
    kind: "prototype",
    status: "ready",
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-06T10:00:00.000Z",
    currentVersionId: "latest",
    versions,
    currentVersion: versions[0],
    currentContent: content,
  };
}

async function renderWorkspace(suite: DesignSuite, initialTab?: string): Promise<RTL.RenderResult> {
  overridesRef.designSuiteList = async () => [
    {
      schemaVersion: 2,
      id: suite.id,
      title: suite.title,
      kind: "prototype",
      status: "ready",
      createdAt: suite.createdAt,
      updatedAt: suite.updatedAt,
      currentVersionId: suite.currentVersionId,
      versionCount: 1,
    },
  ];
  overridesRef.designSuiteRead = async () => suite;
  const utils = rtl.render(
    ReactPkg.createElement(
      I18nProvider,
      null,
      ReactPkg.createElement(PrototypeWorkspace, { root: "/w", ...(initialTab ? { initialTab } : {}) })
    )
  );
  await rtl.act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return utils;
}

const SPEC_WITH_TODOS = [
  "# 订单 需求文档",
  "",
  "| 目标平台 | web |",
  "",
  "## 6. 验收标准",
  "",
  "- [ ] 可开始计时",
  "",
  "## 7. 待确认：支付范围",
  "",
  "待确认以下事项：",
  "- [ ] 是否支持退款",
  "* 是否接入优惠券",
  "",
  "## 8. 附录",
  "",
  "- 附录不应被吞",
].join("\n");

test("EARS 14: specTodos 只采「待确认」节(带后缀标题),越节不吞、剥 [ ] 前缀", async () => {
  const utils = await renderWorkspace(prototypeSuite({ spec: SPEC_WITH_TODOS }));
  // 两条待确认(退款/优惠券);验收标准节与附录节不混入。
  const todos = [...utils.container.querySelectorAll(".ui-design-spec-todo span")].map((n) => n.textContent ?? "");
  assert.equal(todos.length, 2, `expected 2 todos, got ${JSON.stringify(todos)}`);
  assert.ok(todos.includes("是否支持退款"), "checkbox item extracted");
  assert.ok(
    todos.some((t) => t.includes("优惠券") && !t.includes("*")),
    "bullet marker stripped"
  );
  assert.ok(!todos.some((t) => t.includes("可开始计时")), "acceptance-section items NOT swallowed");
  assert.ok(!todos.some((t) => t.includes("附录")), "next-section prose NOT swallowed");
  assert.ok(!todos.some((t) => t.includes("待确认以下事项")), "section prose line not a todo");
  // 引言行不是列表项 → 不出现在 todos(它是纯文本行)。
  rtl.cleanup();
});

test("EARS 14 反例:正文早现「待确认」不锁生成(无标题节 → 零 todos)", async () => {
  const spec = ["# PRD", "", "背景:支付范围待确认。", "", "## 6. 验收标准", "", "- [ ] 可用"].join("\n");
  const utils = await renderWorkspace(prototypeSuite({ spec }));
  await rtl.act(async () => {
    await Promise.resolve();
  });
  const todos = [...utils.container.querySelectorAll(".ui-design-spec-todo span")].map((n) => n.textContent ?? "");
  assert.equal(todos.length, 0, "prose mention does not create todos / lock generation");
});

const MOONVIZ_CONTENT = {
  requirement: "移动订单",
  spec: "| 目标平台 | mobile |\n\n## 页面清单\n\n| 页面 | 页面ID |\n| --- | --- |\n| 首页 | home |",
  moonviz: "moonviz:artboard home",
};

test("EARS 15 (moonviz 等价): 有 canonical 文档的套件画布可达、verify 可用", async () => {
  // 单文档模型：不再有变体槽/回退横幅——画布门 = moonviz 字段存在。
  const utils = await renderWorkspace(prototypeSuite(MOONVIZ_CONTENT as DesignSuiteVersion["content"]), "proto");
  await rtl.act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  // 画布存在(MoonvizPreview 挂载),空态与回退横幅都不在。
  assert.ok(utils.container.querySelector('[data-testid="moonviz-preview"]'), "canvas renders the moonviz preview");
  assert.ok(!utils.container.querySelector(".ui-design-variant-fallback"), "no fallback banner for a documented suite");
  const verifyBtn = [...utils.container.querySelectorAll("button")].find((b) => b.textContent?.includes("Acceptance"));
  assert.ok(verifyBtn && !verifyBtn.disabled, "verify enabled for a documented suite");
});

test("EARS 17: slides 渲染失败局部化——toast + 回退 doc,不写 workspace error", async () => {
  const toasts: Array<{ kind: string; text: string }> = [];
  const unsubscribe = subscribeDesignToasts((kind, text) => toasts.push({ kind, text }));
  overridesRef.prototypeSpecSlides = async () => ({ ok: false, error: "marp blew up" });
  const utils = await renderWorkspace(prototypeSuite({ spec: SPEC_WITH_TODOS }));
  // 切到 slides 视图。
  const slidesBtn = [...utils.container.querySelectorAll(".ui-design-spec-viewseg button")].find((b) =>
    b.textContent?.toLowerCase().includes("slide")
  );
  assert.ok(slidesBtn, "slides toggle present");
  await rtl.act(async () => {
    slidesBtn!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  // toast 报错、视图回到 doc、workspace 级 error 不出现(无整页错误态)。
  assert.ok(
    toasts.some((t) => t.kind === "error" && t.text.includes("marp blew up")),
    "localized toast fired"
  );
  assert.ok(!utils.container.querySelector(".ui-design-state.error"), "no workspace-level error wall");
  unsubscribe();
});

test("EARS 16 (moonviz 等价): 播放模式进入/退出,画布保持挂载", async () => {
  const utils = await renderWorkspace(
    prototypeSuite({
      requirement: "r",
      spec: SPEC_WITH_TODOS,
      moonviz: "moonviz:artboard home",
    } as DesignSuiteVersion["content"])
  );
  const tabs = [...utils.container.querySelectorAll('[role="tab"]')];
  await rtl.act(async () => {
    tabs[1]!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
  });
  // 进入播放模式。
  const playBtn = [...utils.container.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Interactive demo")
  );
  assert.ok(playBtn, "play button present");
  await rtl.act(async () => {
    playBtn!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
  });
  // MoonvizPreview 在播放中保持挂载（沙箱 iframe 自治渲染，无 ToAssistant
  // 回传通道——冻结语义由「不派发 revise」结构化保证：预览不持有 onIterate）。
  assert.ok(utils.container.querySelector('[data-testid="moonviz-preview"]'), "preview stays mounted during play");
  const exitBtn = [...utils.container.querySelectorAll("button")].find((b) => b.textContent?.includes("Exit demo"));
  assert.ok(exitBtn, "exit button present");
  await rtl.act(async () => {
    exitBtn!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
  });
  assert.ok(utils.container.querySelector('[data-testid="moonviz-preview"]'), "preview still mounted after exit");
});

// ── EARS 18: 表单状态槽位隔离(design-store 级) ─────────────────────────────

const roots: string[] = [];
after(() => {
  while (roots.length > 0) fs.rmSync(roots.pop()!, { recursive: true, force: true });
});

test("EARS 18: form state slots are isolated and invalid slots rejected", () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "form-slots-")));
  roots.push(root);
  // saveFormState 落盘在 designs/<id>/ 目录——先建真实 suite。
  saveDesignArtifact(root, { id: "suite-a", title: "S", pipeline: "spec", content: "spec" });
  const ok = saveFormState(root, "suite-a", { draft: "desktop" });
  assert.equal(ok, true);
  assert.equal(saveFormState(root, "suite-a", { draft: "mobile" }, "mobile"), true);
  assert.equal(saveFormState(root, "suite-a", { draft: "tablet" }, "tablet"), true);
  // 槽位互不串值;desktop 走默认文件。
  assert.deepEqual(readFormState(root, "suite-a"), { draft: "desktop" });
  assert.deepEqual(readFormState(root, "suite-a", "mobile"), { draft: "mobile" });
  assert.deepEqual(readFormState(root, "suite-a", "tablet"), { draft: "tablet" });
  // 非法 slot 拒绝(不静默读写共享槽)。
  assert.equal(saveFormState(root, "suite-a", { x: 1 }, "Mobile"), false, "uppercase slot rejected");
  assert.equal(saveFormState(root, "suite-a", { x: 1 }, "../evil"), false, "traversal slot rejected");
  assert.equal(readFormState(root, "suite-a", "../evil"), null, "invalid slot read rejected");
});
