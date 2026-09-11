/**
 * Theme stylesheet failure recovery.
 *
 * Regression for review finding P1 (2026-09-11): the former loader appended an
 * Aqua fallback with the SAME `deeporca-theme-css` id after a selected theme
 * failed. `applyTheme()` then updated the first failed link, while the later
 * Aqua fallback remained last in the cascade and permanently won every later
 * theme switch. These DOM tests exercise that exact failure path.
 */

import { after, afterEach, before, test } from "node:test";
import assert from "node:assert/strict";

import { installDom, type DomHandle } from "./dom-harness";

let dom: DomHandle;
let injectStylesheet: typeof import("../renderer/lib/stylesheet-loader").injectStylesheet;
let applyTheme: typeof import("../renderer/lib/appearance").applyTheme;
let THEME_LINK_ID: typeof import("../renderer/lib/appearance").THEME_LINK_ID;
let themeLinkRequestSeq: typeof import("../renderer/lib/theme-link").themeLinkRequestSeq;

before(async () => {
  dom = installDom();
  ({ injectStylesheet } = await import("../renderer/lib/stylesheet-loader"));
  ({ applyTheme, THEME_LINK_ID } = await import("../renderer/lib/appearance"));
  ({ themeLinkRequestSeq } = await import("../renderer/lib/theme-link"));
});

async function triggerThemeFailure(href = "./styles-neumorph.css"): Promise<HTMLLinkElement> {
  const pending = injectStylesheet(href, THEME_LINK_ID);
  const link = document.getElementById(THEME_LINK_ID) as HTMLLinkElement | null;
  assert.ok(link, "theme link should be appended");
  link.dispatchEvent(new Event("error"));
  assert.match(link.href, /styles\.css$/, "failure retries Aqua through the same link");
  link.dispatchEvent(new Event("load"));
  await pending;
  return link;
}

test("failed theme retries Aqua in the same DOM link (never duplicate theme IDs)", async () => {
  const link = await triggerThemeFailure();
  assert.equal(document.querySelectorAll(`#${THEME_LINK_ID}`).length, 1, "fallback must not append a duplicate id");
  assert.match(link.href, /styles\.css$/, "same link now points to Aqua fallback");
});

test("a later theme switch replaces the Aqua fallback link", async () => {
  const link = await triggerThemeFailure();
  applyTheme("clay");
  assert.equal(document.querySelectorAll(`#${THEME_LINK_ID}`).length, 1);
  assert.strictEqual(document.getElementById(THEME_LINK_ID), link, "applyTheme updates the fallback link itself");
  assert.match(link.href, /styles-clay\.css$/, "later selection must dislodge Aqua fallback");
});

test("a stale theme event cannot repaint a later selection", async () => {
  const first = injectStylesheet("./styles-neumorph.css", THEME_LINK_ID);
  const staleLink = document.getElementById(THEME_LINK_ID) as HTMLLinkElement | null;
  assert.ok(staleLink);
  applyTheme("clay");
  const currentLink = document.getElementById(THEME_LINK_ID) as HTMLLinkElement | null;
  assert.ok(currentLink);
  assert.notStrictEqual(currentLink, staleLink, "in-flight selection should be isolated from the old link");
  assert.match(currentLink.href, /styles-clay\.css$/);

  // The old request's events arrive after the user selected Clay. They must not
  // trigger the Aqua fallback or change the current link.
  staleLink.dispatchEvent(new Event("error"));
  staleLink.dispatchEvent(new Event("load"));
  assert.strictEqual(document.getElementById(THEME_LINK_ID), currentLink);
  assert.match(currentLink.href, /styles-clay\.css$/);

  currentLink.dispatchEvent(new Event("load"));
  await first;
});

test("reselecting the current theme does not create another request", async () => {
  const link = await triggerThemeFailure();
  const originalHref = link.getAttribute("href");
  const originalSeq = themeLinkRequestSeq();
  applyTheme("aqua");
  assert.strictEqual(document.getElementById(THEME_LINK_ID), link);
  assert.equal(link.getAttribute("href"), originalHref);
  assert.equal(themeLinkRequestSeq(), originalSeq, "same theme should not advance the request sequence");
});

test("a failed Aqua fallback resolves without appending another link", async () => {
  const pending = injectStylesheet("./styles.css", THEME_LINK_ID);
  const link = document.getElementById(THEME_LINK_ID) as HTMLLinkElement | null;
  assert.ok(link);
  link.dispatchEvent(new Event("error"));
  await pending;
  assert.equal(document.querySelectorAll(`#${THEME_LINK_ID}`).length, 1);
});

afterEach(() => {
  document.head.replaceChildren();
});

after(() => dom.cleanup());
