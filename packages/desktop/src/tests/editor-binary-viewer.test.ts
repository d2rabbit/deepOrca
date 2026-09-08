/**
 * BinaryFileViewer (specs/artifact-landing 链路 A) — the fallback branch:
 * an unsupported extension never mounts the SDK chunk; the UI shows the
 * localized reason and the system-open escape hatch, and clicking it hands
 * the file to editorOpenSystem. api.ts binds window.deeporca at module load,
 * so the stub installs before the component import.
 */

import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";

import { installDom, createApiStub, type DomHandle, type ApiStub } from "./dom-harness";
import type * as RTL from "@testing-library/react";
import type * as React from "react";
import type { I18nProvider as I18nProviderComponent } from "../renderer/i18n";
import type { BinaryFileViewer as BinaryFileViewerComponent } from "../renderer/components/editor/BinaryFileViewer";

let dom: DomHandle;
let stub: ApiStub;
let rtl: typeof RTL;
let ReactPkg: typeof React;
let I18nProvider: typeof I18nProviderComponent;
let BinaryFileViewer: typeof BinaryFileViewerComponent;

const openSystemCalls: string[] = [];

before(async () => {
  dom = installDom();
  const g = globalThis as unknown as { localStorage: Storage };
  g.localStorage = window.localStorage;
  localStorage.setItem("deeporca.locale", "zh");
  stub = createApiStub({
    editorReadBinary: async () => ({ ok: false, reason: "extension-unsupported" }),
    editorOpenSystem: async (filePath: string) => {
      openSystemCalls.push(filePath);
      return { ok: true };
    },
  });
  (globalThis as unknown as { window: { deeporca: unknown } }).window.deeporca = stub.api;
  rtl = await import("@testing-library/react");
  ReactPkg = await import("react");
  ({ I18nProvider } = await import("../renderer/i18n"));
  ({ BinaryFileViewer } = await import("../renderer/components/editor/BinaryFileViewer"));
});

after(() => {
  delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
  dom.cleanup();
});
afterEach(() => rtl.cleanup());

test("unsupported binary → localized fallback UI, never the SDK; click hands off to the OS", async () => {
  const utils = rtl.render(
    ReactPkg.createElement(
      I18nProvider,
      null,
      ReactPkg.createElement(BinaryFileViewer, { file: "movie.mp4", appearance: "light" })
    )
  );
  await rtl.act(async () => {
    await Promise.resolve();
  });
  assert.ok(utils.container.textContent?.includes("该格式暂不支持内嵌预览"), `text: ${utils.container.innerHTML}`);
  const button = [...utils.container.querySelectorAll("button")].find((b) => b.textContent?.includes("在系统中打开"));
  assert.ok(button, "system-open button missing");
  await rtl.act(async () => {
    button.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  });
  assert.deepEqual(openSystemCalls, ["movie.mp4"]);
});
