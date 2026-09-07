// Pair-lane + pair surfaces regression tests (specs/editor-copilot B6).
// Covers the lane state projection (phase/stage/stats/checkpoints) via
// renderHook, and the status-bar / checkpoint-strip / review-bar rendering.

import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom, createApiStub, type DomHandle, type ApiStub } from "./dom-harness";

let dom: DomHandle | undefined;
let stub: ApiStub | undefined;
type RTL = typeof import("@testing-library/react");
let rtl: RTL | undefined;
type ReactPkg = typeof import("react");
let ReactPkg: ReactPkg | undefined;
type I18n = typeof import("../renderer/i18n");
let i18n: I18n | undefined;
type HookMod = typeof import("../renderer/hooks/use-pair-lane");
let hookMod: HookMod | undefined;
type StatusMod = typeof import("../renderer/components/editor/EditorStatusBar");
let statusMod: StatusMod | undefined;
type StripMod = typeof import("../renderer/components/editor/CheckpointStrip");
let stripMod: StripMod | undefined;
type ReviewMod = typeof import("../renderer/components/editor/EditorReviewBar");
let reviewMod: ReviewMod | undefined;

before(async () => {
  dom = installDom();
  const g = globalThis as unknown as { localStorage: Storage };
  g.localStorage = window.localStorage;
  localStorage.setItem("deeporca.locale", "zh");
  stub = createApiStub({});
  (globalThis as unknown as { window: { deeporca: unknown } }).window.deeporca = stub.api;
  rtl = await import("@testing-library/react");
  ReactPkg = await import("react");
  i18n = await import("../renderer/i18n");
  hookMod = await import("../renderer/hooks/use-pair-lane");
  statusMod = await import("../renderer/components/editor/EditorStatusBar");
  stripMod = await import("../renderer/components/editor/CheckpointStrip");
  reviewMod = await import("../renderer/components/editor/EditorReviewBar");
});

after(() => {
  delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
  dom?.cleanup();
});

afterEach(() => rtl?.cleanup());

test("lane events project phase/stage/stats and append checkpoints", async () => {
  assert.ok(rtl && hookMod && ReactPkg);
  const { renderHook, act } = rtl;
  const { usePairLane } = hookMod;
  const rendered = renderHook(() => usePairLane());
  const { result } = rendered;

  assert.equal(result.current.state.phase, "idle");

  await act(async () => {
    result.current.events.onPhase("streaming");
    result.current.events.onStage({ step: 1, written: 0, total: 4 });
    result.current.events.onStats({ added: 0, removed: 3 });
  });
  assert.equal(result.current.state.phase, "streaming");
  assert.equal(result.current.state.stage.step, 1);
  assert.deepEqual(result.current.state.stats, { added: 0, removed: 3 });

  await act(async () => {
    result.current.events.onPhase("review");
  });
  assert.equal(result.current.state.phase, "review");

  await act(async () => {
    result.current.events.onPhase("applied");
    result.current.events.onCheckpoint("2026-09-05T10:00:00.000Z", "snapshot", "a.ts");
  });
  assert.equal(result.current.state.phase, "applied");
  assert.equal(result.current.state.checkpoints.length, 1);
  assert.equal(result.current.state.checkpoints[0]?.label, "v1");

  // Error path: settles idle with the message surfaced.
  await act(async () => {
    result.current.events.onPhase("idle", { error: "boom" });
  });
  assert.equal(result.current.state.phase, "idle");
  assert.equal(result.current.state.error, "boom");
  await act(async () => {
    result.current.dismissError();
  });
  assert.equal(result.current.state.error, null);

  // Clarify path carries the a2ui payload.
  await act(async () => {
    result.current.events.onPhase("idle", { clarify: "```a2ui payload" });
  });
  assert.equal(result.current.state.clarify, "```a2ui payload");
  await act(async () => {
    result.current.dismissClarify();
  });
  assert.equal(result.current.state.clarify, null);

  rendered.unmount();
});

test("status bar renders three-state pill from lane phase", async () => {
  assert.ok(rtl && i18n && statusMod && ReactPkg);
  const { I18nProvider } = i18n;
  const h = (lane: import("../renderer/hooks/use-pair-lane").PairLaneState) =>
    rtl!.render(
      ReactPkg!.createElement(
        I18nProvider,
        null,
        ReactPkg!.createElement(statusMod!.EditorStatusBar, { lane, file: "a.ts" })
      )
    );

  const idle = h(makeLane({ phase: "idle" }));
  assert.match(idle.container.querySelector(".ui-edpair-status .ai-pill")?.textContent ?? "", /结对待命/);

  const streaming = h(makeLane({ phase: "streaming" }));
  assert.ok(
    streaming.container.querySelector(".ui-edpair-status .ai-pill")?.classList.contains("live"),
    "streaming pill should be live"
  );

  const review = h(makeLane({ phase: "review", stats: { added: 8, removed: 2 } }));
  assert.ok(review.container.querySelector(".ai-pill")?.classList.contains("wait"));
  assert.match(review.container.textContent ?? "", /\+8/);
  assert.match(review.container.textContent ?? "", /−2/);
});

test("checkpoint strip lists applies and marks the newest current", async () => {
  assert.ok(rtl && i18n && stripMod && ReactPkg);
  const { I18nProvider } = i18n;
  const out = rtl.render(
    ReactPkg.createElement(
      I18nProvider,
      null,
      ReactPkg.createElement(stripMod.CheckpointStrip, {
        // 2026-09-06: the strip also renders a non-button BASELINE node
        // (「基线 · 你最后一次手动保存」) before the AI checkpoints.
        baselineAt: new Date(Date.now() - 300_000).toISOString(),
        checkpoints: [
          { atIso: new Date(Date.now() - 120_000).toISOString(), label: "v1", content: "a", file: "a.ts" },
          { atIso: new Date().toISOString(), label: "v2", content: "b", file: "a.ts" },
        ],
      })
    )
  );
  const nodes = out.container.querySelectorAll(".ui-edpair-cp");
  assert.equal(nodes.length, 3, "baseline node + 2 checkpoints");
  assert.ok(nodes[0]!.classList.contains("baseline"), "first node is the baseline");
  const checkpointNodes = out.container.querySelectorAll("button.ui-edpair-cp");
  assert.equal(checkpointNodes.length, 2);
  assert.ok(checkpointNodes[1]!.classList.contains("cur"), "last checkpoint is current");
});

test("review bar wires apply/discard callbacks", async () => {
  assert.ok(rtl && i18n && reviewMod && ReactPkg);
  const { I18nProvider } = i18n;
  let applied = 0;
  let discarded = 0;
  const out = rtl.render(
    ReactPkg.createElement(
      I18nProvider,
      null,
      ReactPkg.createElement(reviewMod.EditorReviewBar, {
        added: 5,
        removed: 3,
        onApply: () => {
          applied += 1;
        },
        onDiscard: () => {
          discarded += 1;
        },
      })
    )
  );
  assert.match(out.container.textContent ?? "", /\+5/);
  (out.container.querySelector(".ui-edpair-rbtn.primary") as HTMLElement).click();
  (out.container.querySelector(".ui-edpair-rbtn.danger") as HTMLElement).click();
  assert.equal(applied, 1);
  assert.equal(discarded, 1);
});

/* helpers */

function makeLane(overrides: {
  phase?: "idle" | "streaming" | "review" | "applied";
  stats?: { added: number; removed: number };
}): import("../renderer/hooks/use-pair-lane").PairLaneState {
  return {
    phase: overrides.phase ?? "idle",
    stage: { step: -1, written: 0, total: 0 },
    stats: overrides.stats ?? { added: 0, removed: 0 },
    error: null,
    clarify: null,
    lastResult: null,
    checkpoints: [],
    instruction: "",
    explain: null,
    hunks: null,
  };
}
