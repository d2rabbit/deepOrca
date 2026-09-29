/**
 * MoonViz engine worker (specs/moonviz-engine-replacement T1.2) — the
 * worker_thread that owns the wasm-gc engine instance.
 *
 * Why a worker: V8 has no wasm execution interruption primitive — a hung
 * engine call on the main process would freeze the event loop. Every call
 * here executes synchronously inside the worker; the MAIN-side host
 * (moonviz-engine-host.ts) runs the callTimeout watchdog and answers a hang
 * with worker.terminate() + rebuild. Canonical docs live on the caller side,
 * so a rebuild loses zero semantics.
 *
 * deepDesign production protocol (wasmtime_host.rs port, v5.2 §2.1):
 *  - canonical-keyed session cache: exact `.mbt.md` bytes are the key; a hit
 *    reuses the live handle (refcounted across concurrent `withSession`
 *    entries on the same doc), a miss opens fresh. Mutating envelopes echo
 *    the new canonical — the cache key MOVES FORWARD with it (upstream #19:
 *    every mutating envelope carries canonical, so no op-class evictions).
 *  - dirty-cache eviction: a failed op, a corrupt read, or a wasm trap drops
 *    the cache entry — a dirty cache would land retries on ghost commits.
 *  - memory ratchet: V8's wasm managed heap lives inside the JS heap and is
 *    only observable as heapUsed drift, so the ratchet watches
 *    `process.memoryUsage().heapUsed` above the init baseline (default
 *    192MB, deepDesign's threshold) plus a deterministic mutating-op valve
 *    (default 2400, ≈ deepDesign's ~200op≈+37MB linear-memory curve scaled
 *    with margin). Rebuild happens only at a refcount-0 boundary and
 *    re-opens cached sessions from their canonical keys.
 *  - `session_open("")` must return -1 and closing must decrement
 *    `session_count` — the engine leak contract this host leans on.
 *
 * Single-target discipline: wasm-gc ONLY (js-string builtins). A host
 * without WasmGC fails `init` with a diagnostic — there is no classic
 * fallback anywhere in this file.
 */

import { parentPort } from "node:worker_threads";

// ── engine instance ──────────────────────────────────────────────────────────

interface EngineExports {
  render_mbt(mbt: string): string;
  validate_mbt(mbt: string): string;
  apply_agent_op(mbt: string, op: string): string;
  apply_human_op(mbt: string, op: string): string;
  export_html(mbt: string): string;
  list_templates(): string;
  list_components(): string;
  list_themes(): string;
  list_tokens(): string;
  list_ops(): string;
  version_info(): string;
  session_open(mbt: string): number;
  session_close(handle: number): number;
  session_count(): number;
  session_open_project_json(json: string): number;
  session_apply_agent(handle: number, op: string): string;
  session_apply_human(handle: number, op: string): string;
  session_export_svg(handle: number, artboard: string): string;
  session_lint(handle: number, artboard: string): string;
  session_critique(handle: number, artboard: string): string;
  session_auto_fix(handle: number, artboard: string): string;
  session_query_nodes(handle: number, artboard: string): string;
  session_list_artboards(handle: number): string;
  session_flows(handle: number): string;
  session_interactions(handle: number, artboard: string): string;
  session_states(handle: number, artboard: string): string;
  session_spec(handle: number, artboard: string): string;
  session_constrain(handle: number, artboard: string, intent: string): string;
  session_tap(handle: number, artboard: string, x: number, y: number): string;
  session_history(handle: number, line: string): string;
  session_infer_page_type(handle: number, artboard: string): string;
  session_infer_missing(handle: number, artboard: string): string;
  session_extract_design_system(handle: number, artboard: string): string;
  session_generate_responsive(handle: number, artboard: string): string;
  session_benchmark(handle: number): string;
  session_component_compile_b64(handle: number, declB64: string): string;
  session_library_snapshot(handle: number): string;
  session_save(handle: number): string;
}

let X: EngineExports | null = null;
let engineBytes: ArrayBuffer | null = null;
let expectedVersion = "";
let heapBaseline = 0;
let allowTestHooks = false;

// ── ratchet thresholds (init-overridable for deterministic tests) ────────────
let ratchetHeapBytes = 192 * 1024 * 1024;
let maxMutatingOps = 2400;

// ── stats + cache bookkeeping ────────────────────────────────────────────────
let cacheHits = 0;
let cacheMisses = 0;
let mutatingOps = 0;
let rebuilds = 0;

interface CacheEntry {
  canonical: string;
  handle: number;
  refs: number;
}
/** Canonical-keyed live handles, insertion-ordered; cap = CACHE_CAP entries
 *  (evict-close the oldest refcount-0 entry on overflow). */
const CACHE_CAP = 4;
const sessionCache = new Map<string, CacheEntry>();

function statsPayload() {
  return {
    cacheHits,
    cacheMisses,
    mutatingOps,
    rebuilds,
    liveSessions: X ? X.session_count() : 0,
    cachedCanonical: sessionCache.size > 0,
  };
}

// ── instantiation + ratchet rebuild ─────────────────────────────────────────

function instantiateEngine(): EngineExports {
  if (!engineBytes) throw new Error("engine bytes not initialized");
  const module = new WebAssembly.Module(engineBytes, {
    builtins: ["js-string"],
    importedStringConstants: "_",
  });
  return new WebAssembly.Instance(module, {}).exports as unknown as EngineExports;
}

/** Drop every cached handle and re-open sessions from their canonical keys.
 *  Callers guarantee refcount-0 (no in-flight session work), so handle
 *  replacement cannot race a live `withSession`. */
function rebuildEngine(): void {
  const keys = [...sessionCache.keys()];
  try {
    for (const entry of sessionCache.values()) {
      try {
        X?.session_close(entry.handle);
      } catch {
        /* the instance being replaced — close is best-effort */
      }
    }
  } finally {
    X = instantiateEngine();
    heapBaseline = process.memoryUsage().heapUsed;
    mutatingOps = 0;
    sessionCache.clear();
    rebuilds += 1;
  }
  for (const key of keys) {
    const handle = X.session_open(key);
    if (handle >= 0) sessionCache.set(key, { canonical: key, handle, refs: 0 });
  }
}

/** Ratchet check at an op boundary. Deferred while any session has live
 *  refs (an active withSession would see its handle swap underneath it). */
function maybeRatchet(): void {
  if (!X) return;
  const overOps = mutatingOps >= maxMutatingOps;
  const overHeap = process.memoryUsage().heapUsed - heapBaseline >= ratchetHeapBytes;
  if (!overOps && !overHeap) return;
  if ([...sessionCache.values()].some((entry) => entry.refs > 0)) return;
  rebuildEngine();
}

// ── cache-aware session helpers ──────────────────────────────────────────────

function evictEntry(entry: CacheEntry, reason: string): void {
  if (sessionCache.get(entry.canonical) === entry) sessionCache.delete(entry.canonical);
  try {
    X?.session_close(entry.handle);
  } catch {
    // A close failure after a trap means the instance itself is sick —
    // rebuild rather than leave a poisoned engine behind.
    if (reason !== "close") rebuildEngine();
  }
}

/** Canonical-keyed open: hit → refcount++ (same handle); miss → fresh open.
 *  Over cap → evict-close the oldest refcount-0 entry. */
function cacheOpen(canonical: string): number {
  const hit = sessionCache.get(canonical);
  if (hit) {
    cacheHits += 1;
    hit.refs += 1;
    // Refresh insertion order (LRU).
    sessionCache.delete(canonical);
    sessionCache.set(canonical, hit);
    return hit.handle;
  }
  cacheMisses += 1;
  if (!X) throw new Error("engine not initialized");
  if (sessionCache.size >= CACHE_CAP) {
    for (const entry of sessionCache.values()) {
      if (entry.refs === 0) {
        evictEntry(entry, "cap");
        break;
      }
    }
  }
  const handle = X.session_open(canonical);
  if (handle < 0) return handle; // engine rejected the doc — surface -1 contract
  const entry: CacheEntry = { canonical, handle, refs: 1 };
  sessionCache.set(canonical, entry);
  return handle;
}

/** Map a live handle back to its cache entry (mutating ops rekey it). */
function entryByHandle(handle: number): CacheEntry | null {
  for (const entry of sessionCache.values()) if (entry.handle === handle) return entry;
  return null;
}

function cacheRelease(handle: number): void {
  const entry = entryByHandle(handle);
  if (!entry) return; // uncached handle (should not happen) — engine-side close below
  entry.refs = Math.max(0, entry.refs - 1);
}

/** Forward the cache key after a successful mutating op (canonical moved). */
function cacheRekey(handle: number, nextCanonical: string): void {
  const entry = entryByHandle(handle);
  if (!entry || entry.canonical === nextCanonical) return;
  sessionCache.delete(entry.canonical);
  entry.canonical = nextCanonical;
  sessionCache.set(nextCanonical, entry);
}

function cacheEvictByHandle(handle: number): void {
  const entry = entryByHandle(handle);
  if (entry) evictEntry(entry, "dirty");
}

// ── request handling ─────────────────────────────────────────────────────────

interface WorkerRequest {
  id: number;
  method: string;
  params: Record<string, unknown>;
}

function respond(id: number, payload: { ok: true; result?: unknown } | { ok: false; error: string }): void {
  parentPort?.postMessage({ id, ...payload });
}

type Handler = (params: Record<string, unknown>) => unknown;

/** Every session call funnels through here: dirty-cache eviction on failure,
 *  canonical rekey on mutating success, ratchet at the boundary. */
function sessionStringCall(
  handle: number,
  opDesc: string,
  invoke: (engine: EngineExports) => string,
  opts?: { mutating?: boolean; nextCanonicalFrom?: (parsed: { ok: boolean; mbt?: string }) => string | undefined }
): string {
  if (!X) throw new Error("engine not initialized");
  try {
    const raw = invoke(X);
    let parsed: { ok: boolean; mbt?: string; error?: string } | null = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null; // corrupt read → dirty
    }
    if (parsed && !parsed.ok) {
      cacheEvictByHandle(handle);
    } else if (opts?.mutating && parsed?.ok) {
      mutatingOps += 1;
      const next = opts.nextCanonicalFrom?.(parsed);
      if (typeof next === "string" && next.length > 0) cacheRekey(handle, next);
    } else if (!parsed) {
      cacheEvictByHandle(handle);
    }
    maybeRatchet();
    return raw;
  } catch (error) {
    // Wasm trap → the session state is untrustworthy: drop it, keep the worker.
    cacheEvictByHandle(handle);
    throw new Error(`moonviz session call failed (${opDesc}): ${String(error).slice(0, 200)}`);
  }
}

const handlers: Record<string, Handler> = {
  init(params) {
    const bytes = params.bytes as ArrayBuffer;
    if (!(bytes instanceof ArrayBuffer) || bytes.byteLength === 0) {
      throw new Error("init requires non-empty wasm bytes");
    }
    engineBytes = bytes.slice(0);
    expectedVersion = typeof params.expectedVersion === "string" ? params.expectedVersion : "";
    allowTestHooks = params.allowTestHooks === true;
    if (typeof params.ratchetHeapBytes === "number" && params.ratchetHeapBytes > 0) {
      ratchetHeapBytes = params.ratchetHeapBytes;
    }
    if (typeof params.maxMutatingOps === "number" && params.maxMutatingOps > 0) {
      maxMutatingOps = params.maxMutatingOps;
    }
    let engine: EngineExports;
    try {
      engine = instantiateEngine();
    } catch (error) {
      engineBytes = null;
      throw new Error(
        `wasm-gc instantiation failed — this runtime lacks WasmGC/js-string builtins ` +
          `(Node >= 24 / Electron main required): ${String(error).slice(0, 200)}`
      );
    }
    X = engine;
    heapBaseline = process.memoryUsage().heapUsed;
    const versionRaw = JSON.parse(engine.version_info()) as { version?: string };
    if (expectedVersion && versionRaw.version !== expectedVersion) {
      const found = versionRaw.version;
      X = null;
      engineBytes = null;
      throw new Error(`engine version mismatch: instance ${found} != anchor ${expectedVersion}`);
    }
    return { version: versionRaw.version, componentCount: JSON.parse(engine.list_components()).length };
  },
  versionInfo() {
    requireEngine();
    return X!.version_info();
  },
  renderMbt(params) {
    requireEngine();
    return X!.render_mbt(params.mbt as string);
  },
  validateMbt(params) {
    requireEngine();
    return X!.validate_mbt(params.mbt as string);
  },
  applyAgentOp(params) {
    requireEngine();
    const raw = X!.apply_agent_op(params.mbt as string, params.op as string);
    maybeRatchet();
    return raw;
  },
  applyHumanOp(params) {
    requireEngine();
    const raw = X!.apply_human_op(params.mbt as string, params.op as string);
    maybeRatchet();
    return raw;
  },
  exportHtml(params) {
    requireEngine();
    return X!.export_html(params.mbt as string);
  },
  listTemplates() {
    requireEngine();
    return X!.list_templates();
  },
  listComponents() {
    requireEngine();
    return X!.list_components();
  },
  listThemes() {
    requireEngine();
    return X!.list_themes();
  },
  listTokens() {
    requireEngine();
    return X!.list_tokens();
  },
  listOps() {
    requireEngine();
    return X!.list_ops();
  },
  sessionOpen(params) {
    requireEngine();
    return cacheOpen(params.mbt as string);
  },
  sessionClose(params) {
    const handle = params.handle as number;
    cacheRelease(handle);
    // Ratchet boundary: refs just hit 0 for this entry — the one moment a
    // rebuild cannot hurt an active withSession. Deferred checks at op
    // boundaries always see refs >= 1 (the session is open mid-call).
    maybeRatchet();
    const entry = entryByHandle(handle);
    // Canonical-keyed warmth: a refcount-0 entry STAYS cached (exact-bytes
    // key = zero semantic risk; deepDesign's acceleration layer). It leaves
    // only under LRU pressure, dirty eviction, or the ratchet.
    if (!entry) {
      // Uncached handle — plain engine close keeps the leak contract honest.
      return X!.session_close(handle);
    }
    return 1;
  },
  sessionCount() {
    requireEngine();
    return X!.session_count();
  },
  sessionOpenProjectJson(params) {
    requireEngine();
    return X!.session_open_project_json(params.json as string);
  },
  sessionSave(params) {
    return sessionStringCall(params.handle as number, "save", (engine) => engine.session_save(params.handle as number));
  },
  sessionApplyAgent(params) {
    return sessionStringCall(
      params.handle as number,
      params.op as string,
      (engine) => engine.session_apply_agent(params.handle as number, params.op as string),
      {
        mutating: true,
        nextCanonicalFrom: (parsed) => parsed.mbt,
      }
    );
  },
  sessionApplyHuman(params) {
    return sessionStringCall(
      params.handle as number,
      params.op as string,
      (engine) => engine.session_apply_human(params.handle as number, params.op as string),
      {
        mutating: true,
        nextCanonicalFrom: (parsed) => parsed.mbt,
      }
    );
  },
  sessionAutoFix(params) {
    return sessionStringCall(
      params.handle as number,
      `auto_fix:${params.artboard as string}`,
      (engine) => engine.session_auto_fix(params.handle as number, params.artboard as string),
      { mutating: true, nextCanonicalFrom: (parsed) => parsed.mbt }
    );
  },
  sessionConstrain(params) {
    return sessionStringCall(
      params.handle as number,
      `constrain:${params.artboard as string}`,
      (engine) => engine.session_constrain(params.handle as number, params.artboard as string, params.intent as string),
      { mutating: true, nextCanonicalFrom: (parsed) => parsed.mbt }
    );
  },
  sessionTap(params) {
    return sessionStringCall(
      params.handle as number,
      `tap:${params.artboard as string}`,
      (engine) =>
        engine.session_tap(params.handle as number, params.artboard as string, params.x as number, params.y as number),
      { mutating: true, nextCanonicalFrom: (parsed) => parsed.mbt }
    );
  },
  sessionGenerateResponsive(params) {
    return sessionStringCall(
      params.handle as number,
      `responsive:${params.artboard as string}`,
      (engine) => engine.session_generate_responsive(params.handle as number, params.artboard as string),
      { mutating: true, nextCanonicalFrom: (parsed) => parsed.mbt }
    );
  },
  sessionComponentCompileB64(params) {
    return sessionStringCall(
      params.handle as number,
      "component_compile_b64",
      (engine) => engine.session_component_compile_b64(params.handle as number, params.declB64 as string),
      { mutating: true, nextCanonicalFrom: (parsed) => parsed.mbt }
    );
  },
  sessionHistory(params) {
    return sessionStringCall(
      params.handle as number,
      `history:${params.line as string}`,
      (engine) => engine.session_history(params.handle as number, params.line as string),
      { mutating: true, nextCanonicalFrom: (parsed) => parsed.mbt }
    );
  },
  sessionExportSvg(params) {
    return sessionStringCall(params.handle as number, `svg:${params.artboard as string}`, (engine) =>
      engine.session_export_svg(params.handle as number, params.artboard as string)
    );
  },
  sessionLint(params) {
    return sessionStringCall(params.handle as number, `lint:${params.artboard as string}`, (engine) =>
      engine.session_lint(params.handle as number, params.artboard as string)
    );
  },
  sessionCritique(params) {
    return sessionStringCall(params.handle as number, `critique:${params.artboard as string}`, (engine) =>
      engine.session_critique(params.handle as number, params.artboard as string)
    );
  },
  sessionQueryNodes(params) {
    return sessionStringCall(params.handle as number, `nodes:${params.artboard as string}`, (engine) =>
      engine.session_query_nodes(params.handle as number, params.artboard as string)
    );
  },
  sessionListArtboards(params) {
    return sessionStringCall(params.handle as number, "artboards", (engine) =>
      engine.session_list_artboards(params.handle as number)
    );
  },
  sessionFlows(params) {
    return sessionStringCall(params.handle as number, "flows", (engine) =>
      engine.session_flows(params.handle as number)
    );
  },
  sessionInteractions(params) {
    return sessionStringCall(params.handle as number, `interactions:${params.artboard as string}`, (engine) =>
      engine.session_interactions(params.handle as number, params.artboard as string)
    );
  },
  sessionStates(params) {
    return sessionStringCall(params.handle as number, `states:${params.artboard as string}`, (engine) =>
      engine.session_states(params.handle as number, params.artboard as string)
    );
  },
  sessionSpec(params) {
    return sessionStringCall(params.handle as number, `spec:${params.artboard as string}`, (engine) =>
      engine.session_spec(params.handle as number, params.artboard as string)
    );
  },
  sessionInferPageType(params) {
    return sessionStringCall(params.handle as number, `infer_page_type:${params.artboard as string}`, (engine) =>
      engine.session_infer_page_type(params.handle as number, params.artboard as string)
    );
  },
  sessionInferMissing(params) {
    return sessionStringCall(params.handle as number, `infer_missing:${params.artboard as string}`, (engine) =>
      engine.session_infer_missing(params.handle as number, params.artboard as string)
    );
  },
  sessionExtractDesignSystem(params) {
    return sessionStringCall(params.handle as number, `extract_ds:${params.artboard as string}`, (engine) =>
      engine.session_extract_design_system(params.handle as number, params.artboard as string)
    );
  },
  sessionBenchmark(params) {
    return sessionStringCall(params.handle as number, "benchmark", (engine) =>
      engine.session_benchmark(params.handle as number)
    );
  },
  sessionLibrarySnapshot(params) {
    return sessionStringCall(params.handle as number, "library_snapshot", (engine) =>
      engine.session_library_snapshot(params.handle as number)
    );
  },
  stats() {
    return statsPayload();
  },
};

function requireEngine(): EngineExports {
  if (!X) throw new Error("engine not initialized — send init first");
  return X;
}

parentPort?.on("message", (message: WorkerRequest) => {
  const { id, method, params } = message ?? ({} as WorkerRequest);
  if (typeof id !== "number" || typeof method !== "string") return;
  if (method === "hang") {
    if (allowTestHooks) return; // never responds — watchdog bait
    respond(id, { ok: false, error: "hang is a test-only hook (init allowTestHooks)" });
    return;
  }
  const handler = handlers[method];
  if (!handler) {
    respond(id, { ok: false, error: `unknown method: ${method}` });
    return;
  }
  try {
    respond(id, { ok: true, result: handler(params ?? {}) });
  } catch (error) {
    respond(id, { ok: false, error: String((error as Error)?.message ?? error) });
  }
});
