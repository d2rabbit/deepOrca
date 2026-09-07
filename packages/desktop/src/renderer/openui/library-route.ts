/**
 * Authoring-library routing for the design workspace's OpenUI canvas.
 *
 * Pure string classification — no React, no SDK imports — so it can be unit
 * tested directly (see tests/openui-library-route.test.ts). OpenuiRenderer
 * maps the returned mode onto the actual library objects.
 *
 * New prototypes are authored against the OFFICIAL openuiLibrary (pm-designer-
 * openui SKILL.md, generated from openuiLibrary.prompt()); suites generated
 * before the 2026-09 switch use DeepOrca's first-party component names.
 */

/**
 * Names that exist ONLY in the legacy deeporcaLibrary. Their presence is a
 * reliable legacy marker — shared names (Stack/Card/Button/TextContent) never
 * trigger the fallback by themselves.
 */
export const LEGACY_COMPONENT_PATTERN = /\b(?:Column|Row|Metric|Badge|Divider|Spacer|TextField)\(/;

/**
 * Official-exclusive names take PRIORITY over legacy markers: official code
 * can quote `Row(`/`Column(` inside string literals (data.Row(, CodeBlock
 * codeString), which would otherwise misroute the whole prototype to the
 * legacy library (full unknown-component wall).
 */
export const OFFICIAL_COMPONENT_PATTERN =
  /\b(?:Table|Tabs|Modal|Form|Input|TextArea|Select|Col|CardHeader|Buttons|FormControl|Callout|Tag|Separator|CodeBlock|Steps)\(/;

export type OpenuiLibraryMode = "official" | "legacy";

export function resolveLibraryMode(code: string): OpenuiLibraryMode {
  if (OFFICIAL_COMPONENT_PATTERN.test(code)) return "official";
  return LEGACY_COMPONENT_PATTERN.test(code) ? "legacy" : "official";
}
