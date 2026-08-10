/**
 * DOM harness for renderer tests.
 *
 * The repo runs tests on node:test + tsx (no vitest/jest), so there is no
 * automatic DOM environment — this installs one explicitly with jsdom and wires
 * the globals React and @testing-library/react expect.
 *
 * Two ordering constraints make this a module of its own rather than inline setup:
 *
 *   1. `renderer/api.ts` is `export const api = window.deeporca` — evaluated at
 *      *module load*. So `window.deeporca` must exist before anything imports the
 *      component under test. Call `installDom()` first, then `await import(...)`.
 *   2. @testing-library/react reads `global.document` when it loads, so it must
 *      also be imported after installDom().
 */

import { JSDOM } from "jsdom";

export type DomHandle = {
  /** Tear down globals so one test file cannot leak a document into the next. */
  cleanup(): void;
};

/** Keys we add to globalThis, tracked so cleanup can remove exactly those. */
const INSTALLED_KEYS = [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "SVGElement",
  "Element",
  "Node",
  "Event",
  "CustomEvent",
  "MouseEvent",
  "KeyboardEvent",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "IS_REACT_ACT_ENVIRONMENT",
  "ResizeObserver",
  "IntersectionObserver",
  "MutationObserver",
  "matchMedia",
] as const;

export function installDom(): DomHandle {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: "http://localhost/",
    pretendToBeVisual: true,
  });

  const win = dom.window as unknown as Window & typeof globalThis;
  const g = globalThis as unknown as Record<string, unknown>;

  // Assign via defineProperty, not `g.x = …`: Node ≥21 ships built-in globals of
  // its own (navigator, Event, CustomEvent, …) and some are getter-only, so a
  // plain assignment throws "Cannot set property navigator of #<Object>".
  const define = (key: string, value: unknown): void => {
    Object.defineProperty(g, key, { value, configurable: true, writable: true, enumerable: true });
  };

  define("window", win);
  define("document", win.document);
  define("navigator", win.navigator);
  define("HTMLElement", win.HTMLElement);
  define("SVGElement", win.SVGElement);
  define("Element", win.Element);
  define("Node", win.Node);
  define("Event", win.Event);
  define("CustomEvent", win.CustomEvent);
  define("MouseEvent", win.MouseEvent);
  define("KeyboardEvent", win.KeyboardEvent);
  define("getComputedStyle", win.getComputedStyle.bind(win));
  // pretendToBeVisual gives us rAF, but be explicit so React never falls back to
  // a timer-based scheduler (which would leave a pending handle at exit).
  define("requestAnimationFrame", win.requestAnimationFrame.bind(win));
  define("cancelAnimationFrame", win.cancelAnimationFrame.bind(win));
  // Tells React 19 it is inside act() — without it every state update warns.
  define("IS_REACT_ACT_ENVIRONMENT", true);

  // jsdom does not implement these observer/query APIs, and renderer components
  // use them in effects (App.tsx observes panel resizes). Stub them rather than
  // pulling in extra polyfill packages: tests here assert wiring and lifecycle,
  // not layout, so no-op observers are the honest minimum. If a test ever needs
  // real resize behaviour it should drive these stubs explicitly.
  class NoopObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): unknown[] {
      return [];
    }
  }
  define("ResizeObserver", NoopObserver);
  define("IntersectionObserver", NoopObserver);
  define("MutationObserver", win.MutationObserver ?? NoopObserver);
  if (!win.matchMedia) {
    define("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
    // Components read it off window, not just the global.
    Object.defineProperty(win, "matchMedia", {
      value: (globalThis as unknown as Record<string, unknown>).matchMedia,
      configurable: true,
      writable: true,
    });
  }
  // Same for the observers: effects may reference window.ResizeObserver.
  Object.defineProperty(win, "ResizeObserver", { value: NoopObserver, configurable: true, writable: true });
  Object.defineProperty(win, "IntersectionObserver", { value: NoopObserver, configurable: true, writable: true });

  return {
    cleanup() {
      dom.window.close();
      for (const key of INSTALLED_KEYS) {
        delete g[key];
      }
    },
  };
}

/**
 * A stub `window.deeporca` covering the whole DesktopApi surface.
 *
 * DesktopApi has ~85 members; enumerating them would rot on every new channel.
 * Instead every unknown property is synthesised:
 *   - `on*` → subscription registrar returning an unsubscribe function
 *   - anything else → async function resolving to `[]`
 *
 * `overrides` is read on **every** call, not captured once, so a test can change
 * a member's behaviour after the stub is installed. That matters because
 * `renderer/api.ts` is `export const api = window.deeporca` — evaluated at module
 * load — so `window.deeporca` can only be assigned once per process; swapping in a
 * fresh stub per test would leave the component bound to the first one.
 *
 * `calls` records every invocation (overrides included) and `reset()` clears
 * per-test state.
 */
export type ApiStub = {
  api: unknown;
  calls: Array<{ method: string; args: unknown[] }>;
  /** Fire a subscribed event, e.g. emit("onAssistantMessage", message). */
  emit(method: string, ...args: unknown[]): void;
  /** Method names with at least one live listener — lets a test assert that
   *  unmount unsubscribes everything it subscribed on mount. */
  activeSubscriptions(): string[];
  /** Total live listener count across all events. */
  listenerCount(): number;
  /** Clear recorded calls and listeners between tests. */
  reset(): void;
};

export function createApiStub(overrides: Record<string, unknown> = {}): ApiStub {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  const api = new Proxy(
    {},
    {
      get(_target, prop: string) {
        // Read overrides at call time so tests can mutate them in place.
        const override = overrides[prop];
        if (typeof override === "function") {
          // Wrap rather than return directly, so overridden members are recorded
          // too — otherwise asserting "boot called ready()" silently fails for
          // exactly the members a test bothered to stub.
          return (...args: unknown[]) => {
            calls.push({ method: prop, args });
            return (override as (...a: unknown[]) => unknown)(...args);
          };
        }
        if (override !== undefined) return override;

        if (prop.startsWith("on") && prop.length > 2 && prop[2] === prop[2]?.toUpperCase()) {
          return (cb: (...args: unknown[]) => void) => {
            calls.push({ method: prop, args: [] });
            const set = listeners.get(prop) ?? new Set();
            set.add(cb);
            listeners.set(prop, set);
            return () => set.delete(cb);
          };
        }
        return async (...args: unknown[]) => {
          calls.push({ method: prop, args });
          // Default to an empty array rather than undefined: most DesktopApi
          // members are `list*`/`get*` returning collections, and callers use the
          // result immediately (`.length`, `.map`) without a null check — an
          // `undefined` default turns a stub gap into a render crash three
          // components deep. Members returning an object or scalar must be given
          // an explicit override by the test.
          return [];
        };
      },
      has() {
        return true;
      },
    }
  );

  return {
    api,
    calls,
    emit(method: string, ...args: unknown[]) {
      for (const cb of listeners.get(method) ?? []) {
        cb(...args);
      }
    },
    activeSubscriptions() {
      return [...listeners.entries()].filter(([, set]) => set.size > 0).map(([method]) => method);
    },
    listenerCount() {
      let total = 0;
      for (const set of listeners.values()) total += set.size;
      return total;
    },
    reset() {
      calls.length = 0;
      listeners.clear();
    },
  };
}
