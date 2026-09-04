// CoordChainPane renderer test: jsdom + api stub — proves the pane renders
// real state/members/blocks/genealogy from the chain:* IPC surface (and that
// the renderer wiring is not a facade).

import { after, afterEach, before, test } from "node:test";
import assert from "node:assert/strict";
import type * as RTL from "@testing-library/react";
import type * as React from "react";
import { createApiStub, installDom, type ApiStub, type DomHandle } from "./dom-harness";
import type { I18nProvider as I18nProviderComponent } from "../renderer/i18n";
import type { ChainStatePayload } from "../shared/ipc";

let dom: DomHandle;
let stub: ApiStub;
let rtl: typeof RTL;
let ReactPkg: typeof React;
let I18nProvider: typeof I18nProviderComponent;
let CoordChainPane: React.FC;

const STATE: ChainStatePayload = {
  running: true,
  chainId: "orca1abcdefghijklmnop",
  theme: "git:github.com/zshipu/deeporca",
  themeId: "wt:0000000000000000",
  height: 5,
  memberCount: 2,
  peerCount: 1,
  pendingRecords: 0,
  port: 45678,
  anchorId: "did:1111222233334444",
  deviceName: "alpha",
  anchorBound: true,
  version: 3,
};

before(async () => {
  dom = installDom();
  const g = globalThis as unknown as { localStorage: Storage };
  g.localStorage = window.localStorage;
  localStorage.setItem("deeporca.locale", "zh");
  stub = createApiStub({
    chainGetState: async () => STATE,
    chainMembers: async () => [
      { keyId: "did:1111222233334444", deviceName: "alpha", joinedHeight: 0, leftHeight: null, current: true },
      { keyId: "did:aaaabbbbccccdddd", deviceName: "beta", joinedHeight: 1, leftHeight: null, current: false },
    ],
    chainBlocks: async () => [
      { height: 5, hash: "h5", proposer: "did:aaaa", ts: 1, recordCount: 2, approvedBy: ["did:alpha"] },
    ],
    chainGenealogy: async () => [
      { recordId: "r:a1", parentRecordId: null, title: "主任务", conclusion: "done", author: "did:alpha", ts: 1 },
      {
        recordId: "r:b1",
        parentRecordId: "r:a1",
        title: "fork passkey",
        conclusion: "done",
        author: "did:beta",
        ts: 2,
      },
    ],
  });
  (globalThis as unknown as { window: { deeporca: unknown } }).window.deeporca = stub.api;
  rtl = await import("@testing-library/react");
  ReactPkg = await import("react");
  ({ I18nProvider } = await import("../renderer/i18n"));
  ({ CoordChainPane } = await import("../renderer/components/CoordChainPane"));
});

after(() => {
  delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
  dom.cleanup();
});

afterEach(() => {
  dom.cleanup();
});

test("pane renders chain state, members, blocks and genealogy from the ipc surface", async () => {
  const utils = rtl.render(ReactPkg.createElement(I18nProvider, null, ReactPkg.createElement(CoordChainPane)));
  // Flush the mount effect so the api stub's state lands in the DOM.
  await rtl.act(async () => {
    await Promise.resolve();
  });
  const el = (selector: string) => utils.container.querySelector(selector);
  const text = (selector: string) => el(selector)?.textContent ?? "";

  assert.ok(utils.container.textContent?.includes("去中心化工作区"), "pane title (zh catalog)");
  assert.equal(text("[data-testid=chain-id]"), "orca1abcdefghijklmnop", "chain id rendered");
  assert.ok(text(".ui-chain-section").includes("alpha"), "member device name rendered");
  assert.ok(text("[data-testid=chain-genealogy]").includes("⑂ fork passkey"), "genealogy fork edge rendered");
  assert.ok(text("[data-testid=chain-blocks]").includes("#5 · did:aaaa · 2 条记录"), "block row with localized record count");
  assert.ok(text(".ui-chain-facts").includes("已绑定本机"), "anchor bound label");
});
