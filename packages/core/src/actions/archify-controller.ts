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

/**
 * Visual-readback verdict for ONE delivered artifact (specs/
 * arch-visual-readback — fireworks "evaluate, don't assert" absorption).
 * Per-gate status is "pass" | "fail" | "skipped"; skipped is ALWAYS honest
 * (layout-json unsupported type, Chrome unavailable, vision unconfigured…)
 * and never masquerades as a pass.
 */
export interface ArchVisualVerdict {
  /** Artifact file name (e.g. "arch-checkout.architecture"). */
  readonly artifact: string;
  readonly status: "pass" | "fail" | "skipped";
  readonly gates: {
    /** 门① layout contract (deterministic, architecture-only). */
    readonly layout: "pass" | "fail" | "skipped";
    /** 门② containment (upstream visual-check harness). */
    readonly containment: "pass" | "fail" | "skipped";
    /** 门③ perceptual vision readback (four-question contract). */
    readonly vision: "pass" | "fail" | "skipped";
  };
  /** Failure evidence lines (empty when clean). */
  readonly findings: readonly string[];
  /** Contact-sheet path for human review, when the harness produced one. */
  readonly contactSheet?: string;
}

/** Host-injected visual verification over a root's DELIVERED artifacts. */
export type ArchVisualVerifier = (root: string) => Promise<readonly ArchVisualVerdict[]>;

let paths: ArchifyPaths | null = null;
let renderer: ArchRenderer | null = null;
let visualVerifier: ArchVisualVerifier | null = null;
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

export function configureArchVisualVerifier(v: ArchVisualVerifier | null): void {
  visualVerifier = v;
}

export function getArchVisualVerifier(): ArchVisualVerifier | null {
  return visualVerifier;
}
