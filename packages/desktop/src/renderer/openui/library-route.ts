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

/**
 * Classify which library renders `code`. A suite's declared authoring library
 * (stamped into meta at creation — design-store's authoringLibrary) wins
 * outright; the component-name heuristic only runs for suites without the
 * stamp (pre-field suites, legacy artifacts), where shared-name-only code
 * still misroutes — the known limitation the stamp retires for everything
 * created after it landed.
 */
export function resolveLibraryMode(code: string, declared?: OpenuiLibraryMode | null): OpenuiLibraryMode {
  if (declared === "official" || declared === "legacy") return declared;
  if (OFFICIAL_COMPONENT_PATTERN.test(code)) return "official";
  return LEGACY_COMPONENT_PATTERN.test(code) ? "legacy" : "official";
}
