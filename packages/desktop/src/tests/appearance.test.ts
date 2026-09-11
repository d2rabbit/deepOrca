/**
 * Skin registry invariants.
 *
 * The style-skin family (neumorph / raw / neobrutal / minimal / clay /
 * geocities / y2k / skeuo, added 2026-09-11) pushed the "add a skin" checklist to
 * six touchpoints, and every one of them fails silently if forgotten: a typo in
 * the stylesheet path boots an unstyled window, a missing locale key renders the
 * raw id in the picker, a missing palette entry makes the skin unreachable from
 * the command palette, and a skin with only one tone block makes the appearance
 * toggle a no-op. This file turns that checklist into an enforced invariant.
 *
 * Pure module + filesystem reads; localStorage is stubbed per test (appearance.ts
 * only touches it inside getters that swallow failures, so no DOM is needed).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  availableThemes,
  defaultAppearance,
  getStoredTheme,
  themeStylesheet,
  THEME_IDS,
  type Theme,
} from "../renderer/lib/appearance";

const here = dirname(fileURLToPath(import.meta.url));
const rendererDir = join(here, "..", "renderer");
const locales = ["en", "zh", "zh-tw", "zh-hk", "ja", "ko"] as const;
const platforms = ["win32", "darwin", "linux"] as const;

/** Skins that deliberately ship ONE tone (their palette ignores the switch). */
const SINGLE_TONE = new Set<Theme>(["orca"]);

function cssFor(theme: Theme): string {
  return readFileSync(join(rendererDir, themeStylesheet(theme).replace("./", "")), "utf8");
}

function withStoredTheme<T>(value: string | null, run: () => T): T {
  const store = new Map<string, string>();
  if (value !== null) store.set("deeporca.theme", value);
  const globals = globalThis as unknown as { localStorage?: unknown };
  const previous = globals.localStorage;
  globals.localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, next: string) => void store.set(key, next),
  };
  try {
    return run();
  } finally {
    globals.localStorage = previous;
  }
}

test("every registered theme resolves to a stylesheet that exists on disk", () => {
  for (const theme of THEME_IDS) {
    const css = cssFor(theme);
    assert.ok(css.length > 200, `${theme}: stylesheet looks empty`);
  }
});

test("desktop build discovers every source theme stylesheet", () => {
  // Build must not keep a second manual theme list: it discovers styles-*.css.
  // This verifies the discovery mechanism itself and that the registry has no
  // stale/missing source file. A full desktop build is covered by the release
  // gate; this cheap test makes registry/build drift fail in the normal suite.
  const build = readFileSync(join(rendererDir, "..", "..", "build.mjs"), "utf8");
  assert.match(build, /readdir\(resolve\(__dirname, "src\/renderer"\)\)/, "build must discover renderer styles");
  assert.match(build, /\/\^styles-\.\+\\\.css\$\//, "build must filter styles-*.css");

  const discovered = readdirSync(rendererDir)
    .filter((name) => /^styles-.+\.css$/.test(name))
    .sort();
  const registered = THEME_IDS.map((theme) => themeStylesheet(theme).replace("./", "")).filter(
    (name) => name !== "styles.css"
  );
  assert.deepEqual(discovered, [...registered].sort(), "every discovered skin must be registered, and vice versa");
});

test("every skin binds the core token vocabulary", () => {
  // A skin that skips these renders with tokens.css fallbacks — i.e. it looks
  // like Aqua with the wrong palette instead of like itself.
  const required = [
    "--ui-bg:",
    "--ui-surface:",
    "--ui-text:",
    "--ui-text-dim:",
    "--ui-accent:",
    "--ui-accent-fill:",
    "--ui-text-on-accent:",
    "--ui-border:",
    "--ui-focus-ring:",
    "--ui-radius-md:",
    "--ui-shadow-card:",
    "--ui-font-sans:",
  ];
  for (const theme of THEME_IDS) {
    const css = cssFor(theme);
    for (const token of required) {
      assert.ok(css.includes(token), `${theme}: missing ${token} binding`);
    }
  }
});

test("skins ship both tones (so the appearance toggle always does something)", () => {
  for (const theme of THEME_IDS) {
    if (SINGLE_TONE.has(theme)) continue;
    const css = cssFor(theme);
    assert.match(css, /:root\[data-appearance="(light|dark)"\]/, `${theme}: no appearance block`);
  }
});

test("no skin re-binds the code well (hard product rule 2026-08-31)", () => {
  // tokens.css: the fenced-code well is a fixed light-gray/dark-gray pair so
  // token colors stay readable — no theme may override it.
  for (const theme of THEME_IDS) {
    const css = cssFor(theme);
    assert.ok(
      !/--ui-code-well(-border)?\s*:/.test(css),
      `${theme}: must not re-bind --ui-code-well (see tokens.css hard rule)`
    );
  }
});

test("every theme carries a label in all six locale catalogs", () => {
  for (const locale of locales) {
    const catalog = readFileSync(join(rendererDir, "i18n", "locales", `${locale}.ts`), "utf8");
    for (const theme of THEME_IDS) {
      assert.ok(catalog.includes(`"theme.${theme}":`), `${locale}: missing "theme.${theme}"`);
    }
  }
});

test("every theme is reachable: settings picker + command palette", () => {
  const offered = new Set(platforms.flatMap((platform) => availableThemes(platform)));
  const commands = readFileSync(join(rendererDir, "hooks", "use-command-items.ts"), "utf8");
  // The palette derives its entries from THEME_IDS rather than keeping a second
  // hand-written list, so the invariant is the derivation + the per-theme label
  // (a new skin therefore needs no palette edit at all).
  assert.match(commands, /\.\.\.THEME_IDS\.map\(/, "palette must derive theme entries from THEME_IDS");
  assert.match(commands, /label: t\(`theme\.\$\{id\}`\)/, "palette must label each entry from its own theme key");
  assert.match(commands, /run: \(\) => handleSelectTheme\(id\)/, "palette must route through the shared handler");
  for (const theme of THEME_IDS) {
    assert.ok(offered.has(theme), `${theme}: offered on no platform`);
  }
  // The style skins are look-alikes with no platform tie, so they exist
  // everywhere — otherwise a macOS user could never see the Windows-only ones.
  for (const skin of ["neumorph", "raw", "neobrutal", "minimal", "clay", "geocities", "y2k", "skeuo"] as Theme[]) {
    for (const platform of platforms) {
      assert.ok(availableThemes(platform).includes(skin), `${skin}: missing from ${platform}`);
    }
  }
});

test("defaultAppearance starts each skin on the tone its palette is built for", () => {
  const darkFirst: Theme[] = ["glass", "line", "orca", "geocities", "y2k"];
  const lightFirst: Theme[] = ["neumorph", "raw", "neobrutal", "minimal", "clay", "skeuo"];
  for (const theme of darkFirst) {
    assert.equal(defaultAppearance("darwin", theme), "dark", `${theme} should default dark`);
  }
  for (const theme of lightFirst) {
    assert.equal(defaultAppearance("darwin", theme), "light", `${theme} should default light`);
  }
  // Platform-native skins keep following the platform.
  assert.equal(defaultAppearance("win32", "metro"), "dark");
  assert.equal(defaultAppearance("darwin", "aqua"), "light");
});

test("getStoredTheme accepts every registered id and rejects unknown values", () => {
  for (const theme of THEME_IDS) {
    assert.equal(withStoredTheme(theme, getStoredTheme), theme);
  }
  assert.equal(withStoredTheme("neon-nonsense", getStoredTheme), null);
  assert.equal(withStoredTheme("", getStoredTheme), null);
  assert.equal(withStoredTheme(null, getStoredTheme), null);
});
