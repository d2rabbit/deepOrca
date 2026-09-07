/**
 * Composer reference-highlight tests (user ask 2026-09-02: 输入框内的审查
 * 报告引用要有专属渲染标记). A plain textarea cannot draw chips, so the
 * composer stacks a transparent mirror layer above it; these tests pin the
 * DOM contract the CSS keys on:
 *   - a draft containing @…/.deeporca/reviews/… renders a COVER span in the
 *     mirror whose text is the FULL raw token (character-exact metrics with
 *     the textarea; its opaque fill hides the path the textarea paints),
 *   - the condensed chip label (icon + parsed timestamp/title) floats inside
 *     the cover and never contains the absolute path,
 *   - surrounding plain text is preserved segment-for-segment (the mirror's
 *     full text equals the draft),
 *   - the textarea keeps the complete raw value (the send path is untouched),
 *   - drafts without references render NO mirror at all.
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
import type { Composer as ComposerComponent } from "../renderer/components/Composer";

let dom: DomHandle;
let stub: ApiStub;
let rtl: typeof RTL;
let ReactPkg: typeof React;
let I18nProvider: typeof I18nProviderComponent;
let Composer: typeof ComposerComponent;

const REVIEW_REF = "@D:\\others\\excel-jvm\\.deeporca\\reviews\\review-2026-09-01T16-00-11-014.json";

// Mutable per-test stub overrides — createApiStub reads them at call time, so
// a test can stub wikiListPages/reviewListReports for the send-guard checks
// and afterEach restores the fail-open defaults.
const stubOverrides: Record<string, unknown> = {};

function renderComposer(
  value: string,
  opts?: { onSend?: () => void }
): {
  container: HTMLElement;
  onChange: (v: string) => void;
} {
  const onSend = opts?.onSend ?? (() => {});
  let current = value;
  const onChange = (v: string): void => {
    current = v;
    rerender(current);
  };
  const rerender = (v: string): void => {
    rtl.act(() => {
      rtl.render(
        ReactPkg.createElement(
          I18nProvider,
          null,
          ReactPkg.createElement(Composer, {
            root: "/tmp/demo",
            value: v,
            onChange,
            onSend,
            onStop: () => {},
            busy: false,
            disabled: false,
            planMode: false,
            onTogglePlan: () => {},
            skills: [],
            selectedSkills: [],
            onToggleSkill: () => {},
            statusText: null,
            errorText: null,
          })
        ),
        { container: out }
      );
    });
  };
  const utils = rtl.render(
    ReactPkg.createElement(
      I18nProvider,
      null,
      ReactPkg.createElement(Composer, {
        root: "/tmp/demo",
        value,
        onChange,
        onSend,
        onStop: () => {},
        busy: false,
        disabled: false,
        planMode: false,
        onTogglePlan: () => {},
        skills: [],
        selectedSkills: [],
        onToggleSkill: () => {},
        statusText: null,
        errorText: null,
      })
    )
  );
  const out = utils.container;
  return { container: out, onChange };
}

before(async () => {
  dom = installDom();
  const g = globalThis as unknown as { localStorage: Storage };
  g.localStorage = window.localStorage;
  localStorage.setItem("deeporca.locale", "zh");
  stub = createApiStub(stubOverrides);
  (globalThis as unknown as { window: { deeporca: unknown } }).window.deeporca = stub.api;
  rtl = await import("@testing-library/react");
  ReactPkg = await import("react");
  ({ I18nProvider } = await import("../renderer/i18n"));
  ({ Composer } = await import("../renderer/components/Composer"));
});

after(() => {
  delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
  dom.cleanup();
});
afterEach(() => {
  stub.reset();
  for (const key of Object.keys(stubOverrides)) delete stubOverrides[key];
  rtl.cleanup();
});

test("a review @reference renders a cover + CONDENSED review chip in the mirror", () => {
  const { container } = renderComposer(`请结合这份代码审查报告的内容： ${REVIEW_REF}`);
  const mirror = container.querySelector(".ui-prompt-mirror");
  assert.ok(mirror, `mirror layer missing: ${container.innerHTML}`);
  const cover = mirror.querySelector(".ui-prompt-ref-cover.review");
  assert.ok(cover, "review cover missing in the mirror");
  // The cover repeats the RAW token — character-exact metrics with the
  // textarea, and the surface its opaque fill hides the path under.
  assert.match(cover.textContent ?? "", /D:\\others\\excel-jvm\\.deeporca\\reviews\\/);
  const chip = cover.querySelector(".ui-prompt-ref-chip.review");
  assert.ok(chip, "review chip missing in the mirror");
  // Condensed label (user ask 2026-09-02: 缩略内容，不展示整个文件路径) —
  // the parsed report timestamp, NOT the absolute path (the icon is an SVG,
  // contributing no text).
  assert.equal(chip.textContent, "2026/09/01 16:00");
  assert.doesNotMatch(chip.textContent ?? "", /\.json|D:/);

  // The plain prefix is preserved as its own segment (the chip's condensed
  // label sits between prefix and raw token in text order).
  assert.match(mirror.textContent ?? "", /^请结合这份代码审查报告的内容： /);
});

test("the textarea keeps the complete raw value — highlighting is presentation only", () => {
  const { container } = renderComposer(`请结合这份代码审查报告的内容： ${REVIEW_REF}`);
  const textarea = container.querySelector("textarea");
  assert.ok(textarea);
  assert.equal((textarea as HTMLTextAreaElement).value, `请结合这份代码审查报告的内容： ${REVIEW_REF}`);
});

test("a wiki @reference renders the wiki chip; drafts without refs render no mirror", () => {
  const wikiRef = "@D:\\others\\excel-jvm\\.deeporca\\deepwiki\\架构总览.md";
  const { container } = renderComposer(`参考 ${wikiRef} 再动手`);
  const chip = container.querySelector(".ui-prompt-ref-chip.wiki");
  assert.ok(chip, "wiki chip missing");
  assert.equal(chip.textContent, "架构总览");
  assert.equal(container.querySelector(".ui-prompt-ref-chip.review"), null);

  const plain = renderComposer("普通提问，没有任何引用");
  assert.equal(plain.container.querySelector(".ui-prompt-mirror"), null, "mirror must not render without refs");
});

test("caret inside a token flips the chip into its editing highlight (stays whole)", () => {
  const { container } = renderComposer(`请结合这份代码审查报告的内容： ${REVIEW_REF}`);
  const chip = () => container.querySelector(".ui-prompt-ref-chip.review");
  assert.ok(!chip()?.classList.contains("editing"), "chip must start condensed (caret outside)");

  const ta = container.querySelector("textarea") as HTMLTextAreaElement;
  ta.focus();
  const mid = ta.value.indexOf(".json");
  ta.setSelectionRange(mid, mid);
  rtl.fireEvent.select(ta);
  assert.ok(chip()?.classList.contains("editing"), "caret inside the token must flip to editing");
  // Atomic chip (user report 2026-09-02: 点击后要还是一个整体) — the editing
  // state only adds the highlight class; the chip keeps rendering its label
  // and the cover keeps hiding the raw path.
  assert.match(chip()?.textContent ?? "", /2026\/09\/01 16:00/);
});

test("the screenshot's MIXED-separator wiki path still gets its pill", () => {
  // User report 2026-09-02: the quote bridge can produce mixed spellings —
  // `D:\others\excel-jvm` + `/.deeporca/deepwiki/index.md` — and both
  // separators must be recognized.
  const mixed = "@D:\\others\\excel-jvm/.deeporca/deepwiki/index.md";
  const { container } = renderComposer(`请结合 Wiki 页面《index.md》的内容： ${mixed}`);
  const chip = container.querySelector(".ui-prompt-mirror .ui-prompt-ref-chip.wiki");
  assert.ok(chip, `wiki chip missing for the mixed path: ${container.innerHTML}`);
  assert.equal(chip.textContent, "index");
});

test("a completed store reference does NOT open the file-mention menu", () => {
  const { container } = renderComposer(`请结合这份代码审查报告的内容： ${REVIEW_REF}`);
  const ta = container.querySelector("textarea") as HTMLTextAreaElement;
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
  rtl.fireEvent.select(ta);
  // Menu suppressed over a finished citation (the "没有匹配的文件" noise).
  assert.equal(container.querySelector(".ui-file-mention-menu"), null, "file menu must stay closed");

  // Contrast: a HALF-TYPED @path (caret right after it) still opens the menu.
  const partial = renderComposer("请在 @D:\\others\\excel-");
  const ta2 = partial.container.querySelector("textarea") as HTMLTextAreaElement;
  ta2.focus();
  ta2.setSelectionRange(ta2.value.length, ta2.value.length);
  rtl.fireEvent.select(ta2);
  assert.ok(partial.container.querySelector(".ui-file-mention-menu"), "partial @path should open the menu");
});

// ── 2026-09-06: quoted whitespace paths + send-side dangling guard ──────────

test("a QUOTED wiki path with spaces renders the wiki chip in the mirror", () => {
  const { container } = renderComposer('参考 @"My Drive/My Project/.deeporca/deepwiki/road map.md" 再动手');
  const chip = container.querySelector(".ui-prompt-mirror .ui-prompt-ref-chip.wiki");
  assert.ok(chip, `wiki chip missing for the quoted path: ${container.innerHTML}`);
  assert.equal(chip.textContent, "road map");
  // The textarea keeps the full quoted token — the send path is untouched.
  const ta = container.querySelector("textarea") as HTMLTextAreaElement;
  assert.match(ta.value, /@"My Drive\/My Project\/\.deeporca\/deepwiki\/road map\.md"/);
});

test("Enter over a dangling wiki ref BLOCKS the first send, the second force-sends", async () => {
  let sends = 0;
  const { container } = renderComposer("请结合 @/tmp/demo/.deeporca/deepwiki/roadmap.md 的内容", {
    onSend: () => {
      sends += 1;
    },
  });
  const ta = container.querySelector("textarea") as HTMLTextAreaElement;
  ta.focus();
  const pressEnter = async (): Promise<void> => {
    await rtl.act(async () => {
      rtl.fireEvent.keyDown(ta, { key: "Enter" });
      await new Promise((r) => setTimeout(r, 0));
    });
  };
  // Store lists default to [] via the api stub → the ref is dangling.
  await pressEnter();
  assert.equal(sends, 0, "first Enter must NOT send");
  const warning = container.querySelector(".ui-composer-dangling");
  assert.ok(warning, "dangling warning must render");
  assert.match(warning.textContent ?? "", /roadmap/);

  await pressEnter();
  assert.equal(sends, 1, "second Enter force-sends the draft as-is");
  assert.equal(container.querySelector(".ui-composer-dangling"), null, "warning clears after force-send");
});

test("Enter over a LIVE wiki ref sends on the first press (no warning)", async () => {
  let sends = 0;
  stubOverrides.wikiListPages = async () => [{ path: ".deeporca/deepwiki/roadmap.md", title: "路线图" }];
  const { container } = renderComposer("请结合 @.deeporca/deepwiki/roadmap.md 的内容", {
    onSend: () => {
      sends += 1;
    },
  });
  const ta = container.querySelector("textarea") as HTMLTextAreaElement;
  ta.focus();
  await rtl.act(async () => {
    rtl.fireEvent.keyDown(ta, { key: "Enter" });
    await new Promise((r) => setTimeout(r, 0));
  });
  assert.equal(sends, 1, "valid ref sends immediately");
  assert.equal(container.querySelector(".ui-composer-dangling"), null);
});

test("a failing store-list IPC fails OPEN — the send is not wedged", async () => {
  let sends = 0;
  stubOverrides.wikiListPages = async () => {
    throw new Error("ipc down");
  };
  const { container } = renderComposer("请结合 @.deeporca/deepwiki/roadmap.md 的内容", {
    onSend: () => {
      sends += 1;
    },
  });
  const ta = container.querySelector("textarea") as HTMLTextAreaElement;
  ta.focus();
  await rtl.act(async () => {
    rtl.fireEvent.keyDown(ta, { key: "Enter" });
    await new Promise((r) => setTimeout(r, 0));
  });
  assert.equal(sends, 1, "validation failure must never block the send");
  assert.equal(container.querySelector(".ui-composer-dangling"), null);
});

test("a HUNG store-list IPC cannot wedge the composer — the deadline fails open, validatingRef clears", async () => {
  let sends = 0;
  // Never resolves AND never rejects: the pre-fix code awaited it bare and
  // left validatingRef true forever (composer wedged silently).
  stubOverrides.wikiListPages = (): Promise<never> => new Promise(() => {});
  const { container } = renderComposer("请结合 @.deeporca/deepwiki/roadmap.md 的内容", {
    onSend: () => {
      sends += 1;
    },
  });
  const ta = container.querySelector("textarea") as HTMLTextAreaElement;
  ta.focus();
  const pressEnter = async (waitMs: number): Promise<void> => {
    await rtl.act(async () => {
      rtl.fireEvent.keyDown(ta, { key: "Enter" });
      await new Promise((r) => setTimeout(r, waitMs));
    });
  };
  await pressEnter(0);
  assert.equal(sends, 0, "validation is in flight (hung IPC) — no send yet");
  // Past the ~1500ms deadline the FIRST activation's race continuation
  // resolves to null → the fail-open doSend fires from the timer itself
  // (re-review L16: not the second Enter — that keydown early-returns on the
  // still-set validatingRef; the 1700ms sleep only lets the deadline land).
  await pressEnter(1700);
  assert.equal(sends, 1, "the validation deadline resolves to null and the send proceeds (fail-open)");
  assert.equal(container.querySelector(".ui-composer-dangling"), null, "fail-open shows no dangling warning");
  // validatingRef must be CLEARED: with the store list healthy again, the
  // next Enter re-validates instantly and sends — a stuck ref would swallow
  // it at the `if (validatingRef.current) return` guard (sends stays 1).
  stubOverrides.wikiListPages = async () => [{ path: ".deeporca/deepwiki/roadmap.md", title: "路线图" }];
  await pressEnter(50);
  assert.equal(sends, 2, "second send NOT blocked — validatingRef was cleared after the deadline");
});
