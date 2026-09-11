/**
 * Skin contract — the invariants the 2026-09-11 review established.
 *
 * The registry test (appearance.test.ts) pins that a skin is REACHABLE. This
 * file pins that a skin is CORRECT, by encoding the five defects that review
 * found in the first pass, each of which failed silently:
 *
 *   1. State layer: the base app owns `:hover`/`:active` at (0,3,0)
 *      (primitives.css:270-325), so a single-class skin rule loses and a
 *      designed tint (or a hardcoded `#fff` ink on the dark tone's light pink)
 *      took over every hover. Measured: the danger hover read 2.2:1 on the
 *      dark tone before the state layer existed.
 *   2. Class-qualified fields: `.ui-input/.ui-textarea/.ui-select`
 *      (primitives.css:561-583) are class selectors with a (0,2,0) `:focus`
 *      that sets `outline: none` — bare-element rules never reached the
 *      settings fields, so 8 skins silently shipped unskinned form controls.
 *   3. `.ui-subwin` must keep its component `position: absolute`
 *      (activity-rail.css:592). One skin set `position: relative` on it and
 *      flattened the floating sub-window stack into the page flow.
 *   4. Coverage families: the editor surface and folder affordance are not
 *      bound by default, so the CodeMirror canvas stayed off-palette inside
 *      every skin (and `--dot-*` / `--line-fork` are intentionally left alone —
 *      the assertion below requires the exception to be DOCUMENTED, not silent).
 *   5. Reduced motion: every skin must guard its own animations.
 *
 * Reads the stylesheets as text: these are declarative invariants, and a CSS
 * parser is not worth a dependency here.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { themeStylesheet, THEME_IDS, type Theme } from "../renderer/lib/appearance";

const here = dirname(fileURLToPath(import.meta.url));
const rendererDir = join(here, "..", "renderer");

/** The 8 style skins this contract was written for (legacy themes predate it). */
const SKINS: Theme[] = ["neumorph", "raw", "neobrutal", "minimal", "clay", "geocities", "y2k", "skeuo"];

/** The base-app selector shapes a skin has to match to own its interactive states. */
const STATE_SELECTORS = [
  ".ui-btn:hover:not(:disabled)",
  ".ui-btn:active:not(:disabled)",
  ".ui-btn--primary:hover:not(:disabled)",
  ".ui-btn--danger:hover:not(:disabled)",
];

function skinCss(skin: Theme): string {
  return readFileSync(join(rendererDir, themeStylesheet(skin).replace("./", "")), "utf8");
}

test("every skin owns the interactive states the base app defines at (0,3,0)", () => {
  for (const skin of SKINS) {
    const css = skinCss(skin);
    for (const sel of STATE_SELECTORS) {
      assert.ok(css.includes(sel), `${skin}: missing \`${sel}\` — the base rule would win and repaint the state`);
    }
    assert.match(css, /\.ui-card:hover/, `${skin}: missing .ui-card:hover (base swaps the card shadow at (0,2,0))`);
  }
});

test("every skin styles the class-qualified form controls", () => {
  for (const skin of SKINS) {
    const css = skinCss(skin);
    for (const cls of [".ui-input", ".ui-textarea", ".ui-select"]) {
      assert.ok(css.includes(cls), `${skin}: missing ${cls} (bare-element rules never reach it)`);
    }
    assert.match(css, /\.ui-input:focus/, `${skin}: missing .ui-input:focus (base sets outline: none at (0,2,0))`);
  }
});

test("no skin sets `position` on .ui-subwin (the component floats it)", () => {
  // A bare `.ui-subwin { ... position: ... }` block beats the component's
  // `position: absolute` at equal specificity (the skin loads last) and turns the
  // floating sub-window into an in-flow element. Pseudo-element rules are fine —
  // only the element rule is a hazard.
  for (const skin of SKINS) {
    const css = skinCss(skin);
    const offenders = [...css.matchAll(/\.ui-subwin\s*\{[^}]*\bposition\s*:/g)].map((m) => m[0].slice(0, 60));
    assert.deepEqual(offenders, [], `${skin}: sets position on .ui-subwin — it must stay absolute`);
  }
});

test("every skin binds the coverage families, or documents why not", () => {
  for (const skin of SKINS) {
    const css = skinCss(skin);
    assert.match(css, /--ui-folder-icon:/, `${skin}: folder affordance left at the app default`);
    assert.match(css, /--editor-canvas-bg:/, `${skin}: editor canvas left at the app default`);
    // Tool/diagram hues: either bound, or the omission is stated in the file.
    const bindsTools = css.includes("--ui-tool-hue-think:");
    const bindsDiagrams = css.includes("--ui-diagram-hue-0:");
    const documented = /deliberately NOT re-bound|intentionally NOT re-bound/.test(css);
    assert.ok(
      (bindsTools && bindsDiagrams) || documented,
      `${skin}: tool/diagram hues are neither bound nor documented as an intentional boundary`
    );
  }
});

test("every skin guards reduced motion", () => {
  for (const skin of SKINS) {
    assert.match(skinCss(skin), /@media \(prefers-reduced-motion: reduce\)/, `${skin}: no reduced-motion guard`);
  }
});

test("skins keep layout gaps in the shared structure layer", () => {
  for (const skin of SKINS) {
    const css = skinCss(skin);
    assert.doesNotMatch(css, /\b(?:gap|row-gap|column-gap)\s*:/, `${skin}: gap belongs in ui-css, not the skin`);
    for (const token of ["--ui-surface-edge:", "--ui-gap-surface:", "--ui-gap-divider:"]) {
      assert.ok(css.includes(token), `${skin}: missing ${token} material binding`);
    }
  }
});

test("shared dividers consume the theme gap separator token", () => {
  const css = readFileSync(join(rendererDir, "ui-css", "primitives.css"), "utf8");
  assert.match(css, /\.ui-divider\s*\{[\s\S]*border-top:\s*1px solid var\(--ui-gap-divider\)/);
  assert.match(css, /\.ui-divider--vertical\s*\{[\s\S]*border-left:\s*1px solid var\(--ui-gap-divider\)/);
});

test("decorative background rotation leaves semantic card variants alone", () => {
  // A bare `.ui-card:nth-child(...)` rotation is (0,2,0) and out-ranks
  // `.ui-card--warn` (0,1,0), so warning cards silently lost their semantic
  // colour to a decorative pastel/flat. Both rotation skins must exclude it.
  for (const skin of SKINS) {
    const bare = [...skinCss(skin).matchAll(/\.ui-card:nth-child\(/g)].map((m) => m[0]);
    assert.deepEqual(bare, [], `${skin}: use .ui-card:not(.ui-card--warn):nth-child(...) instead`);
  }
});

test("the non-skin themes are untouched by this contract", () => {
  // Sanity: the contract above is about the 8 new skins; a legacy theme must not
  // be asserted against (they ship their own long-standing structure).
  for (const legacy of ["aqua", "metro", "glass", "fusion", "line", "orca"] as Theme[]) {
    assert.ok(THEME_IDS.includes(legacy));
    assert.ok(!SKINS.includes(legacy));
  }
});
