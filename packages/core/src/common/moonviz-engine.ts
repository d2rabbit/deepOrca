/**
 * MoonViz engine seam (specs/moonviz-engine-replacement) — the process-side
 * orchestration surface over the wasm-gc prototype engine.
 *
 * Layering (vendor path red line): core never derives vendor paths, never
 * touches worker_threads or Electron. The HOST (desktop main) builds the
 * execution seam — a worker_thread hosting the wasm-gc instance with the
 * deepDesign production protocol (canonical-keyed session cache, dirty-cache
 * eviction, memory ratchet, watchdog terminate+rebuild) — and injects it here
 * via `configureMoonvizEngine`. Everything above (actions, contract layer)
 * speaks only this module's API.
 *
 * Engine facts this seam encodes (docs/engine-integration-plan.md §0, engine
 * main @ 0.1.7, probe-verified):
 *  - `session_open(mbt) → Int`, empty/invalid source → -1.
 *  - Mutating session ops (`apply_agent/apply_human/auto_fix/constrain/tap/
 *    generate_responsive/component_compile_b64/history`) return an envelope
 *    whose successful form ECHOES THE CANONICAL `.mbt.md` in `mbt` — the
 *    single authority. `withSession` surfaces that as its `canonical` result;
 *    a successful mutating envelope without a non-empty `mbt` breaks loudly
 *    (MoonvizCanonicalError) instead of letting a stale doc silently persist.
 *  - `session_save` returns `{ok, data: projectJSON}` — the studio
 *    rehydration channel (`session_open_project_json`), NOT canonical text.
 *  - `session_close` → 1, `session_count` → plain Int.
 *  - Gate rejection = `mbt_gate_block:<artboard>:<predicate>:<node>` — a
 *    single-block four-segment string, parsed by `parseMoonvizGateBlock`.
 *
 * Orchestration discipline (deepDesign port): `withSession(doc, fn)` is the
 * ONLY entry to session lifecycle — `session_open/close/count/
 * open_project_json` are deliberately not on the public batch surface.
 */

// ── protocol types (shared shape with the desktop worker) ───────────────────

export type MoonvizRequestMethod =
  | "init"
  | "versionInfo"
  | "renderMbt"
  | "validateMbt"
  | "applyAgentOp"
  | "applyHumanOp"
  | "exportHtml"
  | "listTemplates"
  | "listComponents"
  | "listThemes"
  | "listTokens"
  | "listOps"
  | "sessionOpen"
  | "sessionClose"
  | "sessionCount"
  | "sessionOpenProjectJson"
  | "sessionSave"
  | "sessionApplyAgent"
  | "sessionApplyHuman"
  | "sessionExportSvg"
  | "sessionLint"
  | "sessionCritique"
  | "sessionAutoFix"
  | "sessionQueryNodes"
  | "sessionListArtboards"
  | "sessionFlows"
  | "sessionInteractions"
  | "sessionStates"
  | "sessionSpec"
  | "sessionConstrain"
  | "sessionTap"
  | "sessionHistory"
  | "sessionInferPageType"
  | "sessionInferMissing"
  | "sessionExtractDesignSystem"
  | "sessionGenerateResponsive"
  | "sessionBenchmark"
  | "sessionComponentCompileB64"
  | "sessionLibrarySnapshot"
  | "stats";

/** Host-supplied execution seam. The desktop worker host implements this over
 *  worker_threads; tests implement it over fixture streams (no wasm). */
export interface MoonvizEngineSeam {
  call(method: MoonvizRequestMethod, params: Record<string, unknown>): Promise<unknown>;
  /** Cache/ratchet counters from the worker, when the host exposes them. */
  stats?(): Promise<MoonvizWorkerStats | null>;
}

export interface MoonvizWorkerStats {
  cacheHits: number;
  cacheMisses: number;
  mutatingOps: number;
  rebuilds: number;
  liveSessions: number;
  cachedCanonical: boolean;
}

export interface MoonvizComponentInfo {
  id: string;
  name?: string;
  variants?: string[];
}

export interface MoonvizEngineConfig {
  seam: MoonvizEngineSeam;
  /** Engine self-reported version at handshake (host-verified). */
  version?: string;
  /** components.json snapshot (host-injected, vendor-path red line). */
  componentVocabulary?: MoonvizComponentInfo[];
}

// ── errors ───────────────────────────────────────────────────────────────────

export interface MoonvizGateBlock {
  artboard: string;
  predicate: string;
  node: string;
}

export class MoonvizEngineError extends Error {
  readonly code?: string;
  readonly gateBlock?: MoonvizGateBlock;
  readonly envelope?: unknown;

  constructor(message: string, opts?: { code?: string; gateBlock?: MoonvizGateBlock; envelope?: unknown }) {
    super(message);
    this.name = "MoonvizEngineError";
    this.code = opts?.code;
    this.gateBlock = opts?.gateBlock;
    this.envelope = opts?.envelope;
  }
}

/** A mutating envelope succeeded without echoing the canonical doc — the
 *  persistence contract is unfulfillable; never silently keep the stale doc. */
export class MoonvizCanonicalError extends MoonvizEngineError {
  constructor(message: string, envelope?: unknown) {
    super(message, { code: "moonviz_canonical_missing", envelope });
    this.name = "MoonvizCanonicalError";
  }
}

/** The worker was terminated (watchdog/timeout/ratchet) and rebuilt. The
 *  canonical docs live on the caller side, so retrying `withSession` from the
 *  same starting doc is safe and is what `withSession` does once. */
export class MoonvizResetError extends MoonvizEngineError {
  constructor(message: string) {
    super(message, { code: "moonviz_engine_reset" });
    this.name = "MoonvizResetError";
  }
}

/** `mbt_gate_block:<artboard>:<predicate>:<node>` — single-block four-segment
 *  string. Anything else is not a gate block. */
export function parseMoonvizGateBlock(error: unknown): MoonvizGateBlock | null {
  if (typeof error !== "string") return null;
  const match = error.match(/^mbt_gate_block:([^:]+):([^:]+):([^:]+)$/);
  if (!match) return null;
  return { artboard: match[1], predicate: match[2], node: match[3] };
}

// ── envelope shapes ──────────────────────────────────────────────────────────

export interface MoonvizMutatingEnvelope {
  ok: boolean;
  /** Canonical `.mbt.md` echo — present on success (the authority). */
  mbt?: string;
  error?: string;
  [key: string]: unknown;
}

export interface MoonvizArtboard {
  id: string;
  name?: string;
  width?: number;
  height?: number;
  svg?: string;
  nodes?: unknown[];
  [key: string]: unknown;
}

export interface MoonvizRenderResult {
  ok: boolean;
  entry?: string;
  flows?: Array<Record<string, unknown>>;
  artboards?: MoonvizArtboard[];
  error?: string;
  [key: string]: unknown;
}

function parseEnvelope<T>(raw: unknown, method: string): T {
  if (typeof raw !== "string") {
    // Hosts may hand back already-parsed values: objects/arrays, or the
    // scalar contract returns (session_open → Int, session_close → 1,
    // session_count → Int).
    if (raw && typeof raw === "object") return raw as T;
    if (typeof raw === "number" || typeof raw === "boolean" || raw === null || raw === undefined) {
      return raw as T;
    }
    throw new MoonvizEngineError(`${method} returned a non-string payload`, { envelope: raw });
  }
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    throw new MoonvizEngineError(`${method} returned unparsable JSON: ${String(error).slice(0, 120)}`, {
      envelope: String(raw).slice(0, 200),
    });
  }
}

async function seamCall<T>(method: MoonvizRequestMethod, params: Record<string, unknown>): Promise<T> {
  const cfg = requireConfig();
  const started = Date.now();
  try {
    const raw: unknown = await cfg.seam.call(method, params);
    return parseEnvelope<T>(raw, method);
  } finally {
    timingRing.push({ method, ms: Date.now() - started, at: new Date().toISOString() });
    if (timingRing.length > TIMING_RING_SIZE) timingRing.splice(0, timingRing.length - TIMING_RING_SIZE);
  }
}

function assertMutatingCanonical(envelope: MoonvizMutatingEnvelope, op: string): MoonvizMutatingEnvelope {
  if (envelope.ok && (typeof envelope.mbt !== "string" || envelope.mbt.length === 0)) {
    throw new MoonvizCanonicalError(
      `mutating op "${op}" succeeded without echoing the canonical .mbt.md — persistence contract violated`,
      envelope
    );
  }
  return envelope;
}

// ── configuration (host injection) ───────────────────────────────────────────

let config: MoonvizEngineConfig | null = null;

/** Inject the host-built seam. Idempotent by design: reconfiguration replaces
 *  the previous seam wholesale (host teardown/rebuild), never merges. */
export function configureMoonvizEngine(next: MoonvizEngineConfig): void {
  config = next;
}

export function resetMoonvizEngine(): void {
  config = null;
}

function requireConfig(): MoonvizEngineConfig {
  if (!config) {
    throw new MoonvizEngineError(
      "MoonViz engine is not configured — the host must call configureMoonvizEngine({ seam }) at boot"
    );
  }
  return config;
}

// ── diagnostics: timing ring + stats passthrough ────────────────────────────

const TIMING_RING_SIZE = 64;
const timingRing: Array<{ method: string; ms: number; at: string }> = [];

export interface MoonvizEngineDiagnostics extends Partial<MoonvizWorkerStats> {
  version?: string;
  recentCalls: Array<{ method: string; ms: number; at: string }>;
}

export async function moonvizEngineDiagnostics(): Promise<MoonvizEngineDiagnostics> {
  const cfg = requireConfig();
  const stats = cfg.seam.stats ? await cfg.seam.stats() : null;
  return {
    ...(cfg.version ? { version: cfg.version } : {}),
    ...(stats ?? {}),
    recentCalls: [...timingRing],
  };
}

export function moonvizComponentVocabulary(): MoonvizComponentInfo[] {
  return requireConfig().componentVocabulary ?? [];
}

// ── batch (stateless) surface ────────────────────────────────────────────────
// Only wrappers with production/battery consumers live here; the worker can
// answer the full protocol union but stateless batch coverage is demand-led.

export async function moonvizRenderMbt(mbt: string): Promise<MoonvizRenderResult> {
  return parseEnvelope(await seamCall<string>("renderMbt", { mbt }), "renderMbt");
}

export async function moonvizValidateMbt(mbt: string): Promise<{ ok: boolean; error?: string; [k: string]: unknown }> {
  return parseEnvelope(await seamCall<string>("validateMbt", { mbt }), "validateMbt");
}

export async function moonvizExportHtml(mbt: string): Promise<{ ok: boolean; html?: string; error?: string }> {
  return parseEnvelope(await seamCall<string>("exportHtml", { mbt }), "exportHtml");
}

export async function moonvizListComponents(): Promise<MoonvizComponentInfo[]> {
  const parsed = parseEnvelope<unknown>(await seamCall<string>("listComponents", {}), "listComponents");
  if (Array.isArray(parsed)) return parsed as MoonvizComponentInfo[];
  const record = parsed as { components?: MoonvizComponentInfo[] };
  return Array.isArray(record?.components) ? record.components : [];
}

/** Stateless single-op application (batch `apply_agent_op`). Session work
 *  MUST go through `withSession` — this is for one-shot校验/修复类 calls. */
export async function moonvizApplyAgentOp(mbt: string, op: string): Promise<MoonvizMutatingEnvelope> {
  return assertMutatingCanonical(
    parseEnvelope(await seamCall<string>("applyAgentOp", { mbt, op }), "applyAgentOp"),
    op
  );
}

// ── session orchestration: withSession is the ONLY entry ────────────────────

export interface MoonvizSession {
  /** Agent-gated mutation (`session_apply_agent`). */
  mutate(op: string): Promise<MoonvizMutatingEnvelope>;
  /** Human-gated mutation (`session_apply_human`) — never agent-facing. */
  human(op: string): Promise<MoonvizMutatingEnvelope>;
  lint(artboard: string): Promise<{ ok: boolean; data?: unknown; violations?: unknown; [k: string]: unknown }>;
  critique(artboard: string): Promise<{ ok: boolean; data?: unknown; [k: string]: unknown }>;
  autoFix(artboard: string): Promise<MoonvizMutatingEnvelope>;
  constrain(artboard: string, intent: string): Promise<MoonvizMutatingEnvelope>;
  tap(artboard: string, x: number, y: number): Promise<MoonvizMutatingEnvelope>;
  exportSvg(artboard: string): Promise<{ ok: boolean; svg?: string; data?: { svg?: string }; [k: string]: unknown }>;
  queryNodes(artboard: string): Promise<unknown>;
  listArtboards(): Promise<unknown>;
  flows(): Promise<unknown>;
  interactions(artboard: string): Promise<unknown>;
  states(artboard: string): Promise<unknown>;
  spec(artboard: string): Promise<unknown>;
  /** Studio project JSON snapshot (`{ok, data}`) — the rehydration channel,
   *  NOT the canonical authority (that is `withSession`'s `canonical`). */
  save(): Promise<{ ok: boolean; data?: string; [k: string]: unknown }>;
}

export interface MoonvizSessionResult<T> {
  result: T;
  /** Authoritative document after fn — the last mutating envelope's canonical
   *  echo, or the input doc when fn did not mutate. ACTIONS PERSIST THIS. */
  canonical: string;
  mutated: boolean;
}

async function openSession(doc: string): Promise<number> {
  const raw = await seamCall<unknown>("sessionOpen", { mbt: doc });
  const handle = typeof raw === "number" ? raw : (raw as { handle?: number })?.handle;
  if (typeof handle !== "number" || handle < 0) {
    throw new MoonvizEngineError(`session_open failed (${handle}) — document rejected by the engine`, {
      code: "moonviz_open_failed",
    });
  }
  return handle;
}

async function closeSession(handle: number): Promise<void> {
  await seamCall("sessionClose", { handle });
}

/**
 * Action-level session: open → fn → close, with one automatic retry when the
 * worker was terminated mid-session (watchdog/ratchet rebuild): the doc is
 * the authority, so replaying fn from the same starting doc is deterministic
 * and side-effect-free outside the engine.
 */
export async function withSession<T>(
  doc: string,
  fn: (session: MoonvizSession) => Promise<T>,
  opts?: { retries?: number }
): Promise<MoonvizSessionResult<T>> {
  const retries = opts?.retries ?? 1;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    let handle: number;
    try {
      handle = await openSession(doc);
    } catch (error) {
      // The worker may have been terminated between attempts (watchdog/
      // ratchet rebuild): replaying from the same doc is deterministic.
      lastError = error;
      if (error instanceof MoonvizResetError && attempt < retries) continue;
      throw error;
    }
    let canonical = doc;
    let mutated = false;
    const session: MoonvizSession = {
      async mutate(op) {
        const envelope = assertMutatingCanonical(
          parseEnvelope<MoonvizMutatingEnvelope>(
            await seamCall<string>("sessionApplyAgent", { handle, op }),
            "sessionApplyAgent"
          ),
          op
        );
        if (!envelope.ok) {
          const gate = parseMoonvizGateBlock(envelope.error);
          throw new MoonvizEngineError(envelope.error ?? `op rejected: ${op}`, {
            code: gate ? "mbt_gate_block" : "moonviz_op_rejected",
            gateBlock: gate ?? undefined,
            envelope,
          });
        }
        canonical = envelope.mbt!;
        mutated = true;
        return envelope;
      },
      async human(op) {
        const envelope = assertMutatingCanonical(
          parseEnvelope<MoonvizMutatingEnvelope>(
            await seamCall<string>("sessionApplyHuman", { handle, op }),
            "sessionApplyHuman"
          ),
          op
        );
        if (!envelope.ok) {
          const gate = parseMoonvizGateBlock(envelope.error);
          throw new MoonvizEngineError(envelope.error ?? `human op rejected: ${op}`, {
            code: gate ? "mbt_gate_block" : "moonviz_op_rejected",
            gateBlock: gate ?? undefined,
            envelope,
          });
        }
        canonical = envelope.mbt!;
        mutated = true;
        return envelope;
      },
      async lint(artboard) {
        return parseEnvelope(await seamCall<string>("sessionLint", { handle, artboard }), "sessionLint");
      },
      async critique(artboard) {
        return parseEnvelope(await seamCall<string>("sessionCritique", { handle, artboard }), "sessionCritique");
      },
      async autoFix(artboard) {
        const envelope = assertMutatingCanonical(
          parseEnvelope<MoonvizMutatingEnvelope>(
            await seamCall<string>("sessionAutoFix", { handle, artboard }),
            "sessionAutoFix"
          ),
          artboard
        );
        if (envelope.ok) {
          canonical = envelope.mbt!;
          mutated = true;
        }
        return envelope;
      },
      async constrain(artboard, intent) {
        const envelope = assertMutatingCanonical(
          parseEnvelope<MoonvizMutatingEnvelope>(
            await seamCall<string>("sessionConstrain", { handle, artboard, intent }),
            "sessionConstrain"
          ),
          intent
        );
        if (envelope.ok) {
          canonical = envelope.mbt!;
          mutated = true;
        }
        return envelope;
      },
      async tap(artboard, x, y) {
        const envelope = assertMutatingCanonical(
          parseEnvelope<MoonvizMutatingEnvelope>(
            await seamCall<string>("sessionTap", { handle, artboard, x, y }),
            "sessionTap"
          ),
          `tap ${artboard}`
        );
        if (envelope.ok) {
          canonical = envelope.mbt!;
          mutated = true;
        }
        return envelope;
      },
      async exportSvg(artboard) {
        return parseEnvelope(await seamCall<string>("sessionExportSvg", { handle, artboard }), "sessionExportSvg");
      },
      async queryNodes(artboard) {
        return parseEnvelope(await seamCall<string>("sessionQueryNodes", { handle, artboard }), "sessionQueryNodes");
      },
      async listArtboards() {
        return parseEnvelope(await seamCall<string>("sessionListArtboards", { handle }), "sessionListArtboards");
      },
      async flows() {
        return parseEnvelope(await seamCall<string>("sessionFlows", { handle }), "sessionFlows");
      },
      async interactions(artboard) {
        return parseEnvelope(
          await seamCall<string>("sessionInteractions", { handle, artboard }),
          "sessionInteractions"
        );
      },
      async states(artboard) {
        return parseEnvelope(await seamCall<string>("sessionStates", { handle, artboard }), "sessionStates");
      },
      async spec(artboard) {
        return parseEnvelope(await seamCall<string>("sessionSpec", { handle, artboard }), "sessionSpec");
      },
      async save() {
        return parseEnvelope(await seamCall<string>("sessionSave", { handle }), "sessionSave");
      },
    };
    try {
      const result = await fn(session);
      // Always close — a close failure (e.g. dirty eviction already closed
      // the handle) must not mask a successful fn result.
      try {
        await closeSession(handle);
      } catch {
        /* host may have evicted/rebuilt — the result stands */
      }
      return { result, canonical, mutated };
    } catch (error) {
      // Always close — even on failure (worker evicts dirty state itself; a
      // close error here must not mask the original failure).
      try {
        await closeSession(handle);
      } catch {
        /* the host may already have rebuilt the worker (reset) — ignore */
      }
      lastError = error;
      if (error instanceof MoonvizResetError && attempt < retries) continue;
      throw error;
    }
  }
  // Unreachable (loop always returns or throws) — kept for exhaustiveness.
  throw lastError instanceof Error ? lastError : new MoonvizEngineError(String(lastError));
}
