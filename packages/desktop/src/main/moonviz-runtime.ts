/**
 * MoonViz engine runtime wiring (specs/moonviz-engine-replacement T1.2) —
 * the ONLY place in the app that derives vendor paths. Everything downstream
 * (core seam, a2ui tools) sees an injected seam; core never learns a path.
 *
 * Lazy by design: the worker + wasm-gc instance are created on the FIRST
 * engine call (the prototype actions), not at app boot. The exported seam
 * object is stable — its methods await initialization internally — so
 * `configureMoonvizEngine` can bind it once at boot.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  configureMoonvizEngine,
  type MoonvizComponentInfo,
  type MoonvizEngineSeam,
  type MoonvizRequestMethod,
  type MoonvizWorkerStats,
} from "@deeporca/core/moonviz-engine";
import type { MoonvizEngineHost } from "./moonviz-engine-host.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const MOONVIZ_VENDOR_DIR = join(__dirname, "..", "vendor", "moonviz");
const MOONVIZ_WASM = join(MOONVIZ_VENDOR_DIR, "moonviz.wasm");
const MOONVIZ_MANIFEST = join(MOONVIZ_VENDOR_DIR, "manifest.json");
const MOONVIZ_COMPONENTS = join(MOONVIZ_VENDOR_DIR, "components.json");
const MOONVIZ_WORKER = join(__dirname, "moonviz-engine-worker.cjs");

let hostPromise: Promise<MoonvizEngineHost> | null = null;
let hostFailed = false;

function anchorVersion(): string | null {
  try {
    const manifest = JSON.parse(readFileSync(MOONVIZ_MANIFEST, "utf8")) as { engineVersion?: string };
    return typeof manifest.engineVersion === "string" ? manifest.engineVersion : null;
  } catch {
    return null;
  }
}

function componentVocabulary(): MoonvizComponentInfo[] {
  try {
    const snapshot = JSON.parse(readFileSync(MOONVIZ_COMPONENTS, "utf8")) as {
      components?: MoonvizComponentInfo[];
    };
    return Array.isArray(snapshot.components) ? snapshot.components : [];
  } catch {
    return [];
  }
}

async function ensureHost(): Promise<MoonvizEngineHost> {
  if (hostPromise) return hostPromise;
  hostPromise = (async () => {
    if (!existsSync(MOONVIZ_WASM) || !existsSync(MOONVIZ_WORKER)) {
      throw new Error(
        "MoonViz engine assets missing — run `node scripts/vendor-moonviz.js` and rebuild the desktop bundle " +
          `(looked for ${MOONVIZ_WASM} and ${MOONVIZ_WORKER})`
      );
    }
    const version = anchorVersion();
    if (!version) throw new Error(`MoonViz engine manifest unreadable: ${MOONVIZ_MANIFEST}`);
    const { createMoonvizEngineHost } = await import("./moonviz-engine-host.js");
    const host = await createMoonvizEngineHost({
      wasmPath: MOONVIZ_WASM,
      workerPath: MOONVIZ_WORKER,
      expectedVersion: version,
      componentVocabulary: componentVocabulary(),
    });
    return host;
  })();
  // A failed lazy init must not stick (deepDesign issue #1-B): reset so the
  // next action retries after the operator fixes the environment.
  hostPromise = hostPromise.catch((error) => {
    hostFailed = true;
    hostPromise = null;
    throw error;
  });
  return hostPromise;
}

/** Stable seam bound into core at boot; lazily boots the host per call. */
const lazySeam: MoonvizEngineSeam = {
  async call(method: MoonvizRequestMethod, params: Record<string, unknown>): Promise<unknown> {
    const host = await ensureHost();
    return host.call(method, params);
  },
  async stats(): Promise<MoonvizWorkerStats | null> {
    if (hostFailed && !hostPromise) return null;
    try {
      const host = await ensureHost();
      return host.stats();
    } catch {
      return null;
    }
  },
};

// Bind once at boot: engineVersion/vocabulary may be null when the vendor
// tree is missing — the seam surfaces the diagnostic on first call instead.
{
  const version = anchorVersion();
  configureMoonvizEngine({
    seam: lazySeam,
    ...(version ? { version } : {}),
    ...(existsSync(MOONVIZ_COMPONENTS) ? { componentVocabulary: componentVocabulary() } : {}),
  });
}

/** App teardown: terminate the worker (no-op when it never booted). */
export async function disposeMoonvizEngine(): Promise<void> {
  if (!hostPromise) return;
  try {
    const host = await hostPromise;
    await host.dispose();
  } catch {
    /* never booted */
  }
}
