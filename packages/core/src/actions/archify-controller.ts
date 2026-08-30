/**
 * Archify host-injection seams (same pattern as WikiController /
 * CodegraphController): core defines the interfaces, desktop injects the
 * concrete vendored-archify implementations at boot.
 *
 * Two seams:
 *  - `ArchifyPaths`: WHERE the vendored skill package lives (SKILL.md contract,
 *    schemas, examples, bin). Injected because only the host knows whether it
 *    runs from a repo checkout or a packaged app (Resources/app/vendor) —
 *    deriving vendor paths from __dirname inside core is how semantic routing
 *    once silently pointed at a nonexistent path (see AGENTS.md layer rules).
 *  - `ArchRenderer`: the deterministic deliver gate — validate + render the
 *    typed IR artifacts the background task authored. The archify CLI's
 *    delivery contract (schema/layout/render checks, atomic commit) is the
 *    architecture stage's post-run verification.
 */

/** Paths into the vendored archify skill package (host-resolved). */
export interface ArchifyPaths {
  /** Absolute path to the vendored archify/SKILL.md (authoring contract). */
  skillDoc: string;
  /** Directory of JSON schemas (architecture/workflow/sequence/dataflow/lifecycle). */
  schemasDir: string;
  /** Directory of example IR files the task prompt references. */
  examplesDir: string;
  /** Absolute path of the archify bin (archify.mjs). */
  bin: string;
}

/**
 * Deterministic render/deliver gate over a project root's typed IR artifacts
 * (`.deeporca/prototypes/arch-*.<type>.json`). Resolves with the number of
 * artifacts delivered; throws with archify's structured diagnostics on
 * failure — the caller turns that into a failed build stage.
 */
export type ArchRenderer = (root: string) => Promise<number>;

let paths: ArchifyPaths | null = null;
let renderer: ArchRenderer | null = null;
/** Reader-facing language for generated maps (BCP-47), host-synced from the
 *  app locale at boot and on change (same source as wiki's --language). */
let language: string | undefined;

export function configureArchifyLanguage(bcp47: string | undefined): void {
  language = bcp47;
}

export function getArchifyLanguage(): string | undefined {
  return language;
}

export function configureArchifyPaths(p: ArchifyPaths | null): void {
  paths = p;
}

export function getArchifyPaths(): ArchifyPaths | null {
  return paths;
}

export function configureArchRenderer(r: ArchRenderer | null): void {
  renderer = r;
}

export function getArchRenderer(): ArchRenderer | null {
  return renderer;
}
