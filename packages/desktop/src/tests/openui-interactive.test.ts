// Regression tests for the interactive-prototype contract: clicking a Button
// that carries Action([@Set($page, "target")]) must swap the rendered view.
//
// react-lang's Renderer executes @Set/@Reset steps only when the evaluated
// action plan reaches triggerAction's THIRD parameter — ButtonComponent used
// to pass it as the first, so every click degraded to a ContinueConversation
// message and $page state never changed (prototypes rendered as dead screens).
// Mounted here through the real <Renderer> in jsdom, on BOTH libraries:
//   - official openuiLibrary (the pm-designer-openui pipeline since the
//     react-ui adoption), and
//   - deeporcaLibrary (the legacy fallback OpenuiRenderer still serves for
//     suites generated before the switch).

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { I18nProvider as I18nProviderComponent } from "../renderer/i18n";
import { installDom, createApiStub, type DomHandle, type ApiStub } from "./dom-harness";

let dom: DomHandle;
let stub: ApiStub;
let I18nProvider: typeof I18nProviderComponent;

before(async () => {
  dom = installDom();
  stub = createApiStub();
  (globalThis as unknown as { window: Record<string, unknown> }).window.deeporca = stub.api;
  ({ I18nProvider } = await import("../renderer/i18n"));
});

after(() => dom.cleanup());

const OFFICIAL_CODE = [
  '$page = "home"',
  'root = Stack([nav, $page == "home" ? homeView : ordersView])',
  'nav = Stack([Button("首页", Action([@Set($page, "home")])), Button("订单", Action([@Set($page, "orders")]))], "row")',
  'homeView = TextContent("首页视图内容", "large")',
  'ordersView = TextContent("订单视图内容", "large")',
].join("\n");

// Legacy names (Column/Row) route OpenuiRenderer to deeporcaLibrary.
const LEGACY_CODE = [
  '$page = "home"',
  'root = Column([nav, $page == "home" ? homeView : ordersView])',
  'nav = Row([Button("首页", Action([@Set($page, "home")])), Button("订单", Action([@Set($page, "orders")]))])',
  'homeView = TextContent("首页视图内容")',
  'ordersView = TextContent("订单视图内容")',
].join("\n");

async function mountAndClickThrough(code: string): Promise<void> {
  const ReactPkg = await import("react");
  const rtl = await import("@testing-library/react");
  const { OpenuiRenderer } = await import("../renderer/openui/OpenuiRenderer");

  rtl.render(ReactPkg.createElement(I18nProvider, null, ReactPkg.createElement(OpenuiRenderer, { code })));

  const bodyText = () => document.body.textContent ?? "";
  assert.match(bodyText(), /首页视图内容/, "home view should render initially");
  assert.doesNotMatch(bodyText(), /订单视图内容/, "orders view must stay hidden while $page is home");

  const ordersButton = rtl.screen.getByText("订单");
  await rtl.act(async () => {
    ordersButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await rtl.waitFor(() => assert.match(bodyText(), /订单视图内容/));
  assert.doesNotMatch(bodyText(), /首页视图内容/, "home view should be swapped out after navigation");

  // …and back.
  const homeButton = rtl.screen.getByText("首页");
  await rtl.act(async () => {
    homeButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await rtl.waitFor(() => assert.match(bodyText(), /首页视图内容/));

  rtl.cleanup();
}

test("official openuiLibrary: clicking an Action([@Set]) button switches the active view", async () => {
  await mountAndClickThrough(OFFICIAL_CODE);
});

test("legacy deeporcaLibrary fallback: clicking an Action([@Set]) button switches the active view", async () => {
  await mountAndClickThrough(LEGACY_CODE);
});
