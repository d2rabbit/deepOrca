import { useEffect, useRef, useState, type JSX } from "react";
// Engine TYPES only (erased at build) — the runtime module is imported
// lazily in the lifecycle effect. leafer-editor's module init references
// canvas globals that do not exist outside a real browser surface (jsdom,
// GPU-less windows), so the dynamic import itself is part of the guarded
// failure path. It also keeps the ~300KB engine out of the initial renderer
// chunk (splitting discipline).
import type { Editor, Leafer } from "leafer-editor";
import { useI18n } from "../../i18n";
import { createLeaferCommitScheduler, type LeaferCommitScheduler } from "./leafer-commit-scheduler";

/**
 * LeaferPreview (specs/leafer-ui-engine WP1.2) — the UI-Design canvas:
 * renders the suite version's Leafer JSON scene tree with the bundled
 * Figma-style editor (select/move/scale when `editable`). Canvas edits are
 * debounced (2s, formState-throttle precedent) and surfaced through
 * `onCommit` as a serialized full-tree JSON string; the parent owns
 * persistence (version snapshot via the design-store append channel).
 *
 * Error state is LOCAL to this component (WP3.4 lesson): an engine that
 * cannot initialize (jsdom, GPU-less surface) never writes a workspace-level
 * error — the rest of the workspace stays usable.
 */

/** How long a locate flash stays on the target node (matches the DOM
 *  `.ui-design-flash` cadence used by the legacy OpenUI locate). */
const LOCATE_FLASH_MS = 1600;

/**
 * `document.children[2].children[0]` → `[2, 0]`. The root of a stored Leafer
 * document IS the Leafer instance, so indices walk `instance.children`.
 * Returns null for any path shape the deterministic lint cannot produce.
 */
export function parseLeaferNodePath(nodePath: string): number[] | null {
  if (!nodePath.startsWith("document")) return null;
  const rest = nodePath.slice("document".length);
  const indices: number[] = [];
  let consumed = 0;
  for (const match of rest.matchAll(/\.children\[(\d+)\]/g)) {
    if (match.index !== consumed) return null;
    consumed = match.index + match[0].length;
    indices.push(Number(match[1]));
  }
  return consumed === rest.length && indices.length > 0 ? indices : null;
}

type LeaferPreviewProps = {
  /** The suite version's stored `content.leafer` JSON document. */
  leaferJson: string;
  /** Head version in a writable workspace — enables the editor plugin. */
  editable: boolean;
  /**
   * Debounced commit after user edits (serialized toJSON output). Must
   * resolve `true` = persisted or `false` = refused — a refused snapshot is
   * retried by the commit scheduler instead of being silently dropped, so a
   * `false` return must only ever mean "not persisted yet", never "ignore".
   */
  onCommit?: (leaferJson: string) => boolean | Promise<boolean>;
  /**
   * Quality-tab locate signal: `seq` increments per Locate click on a leafer
   * lint finding; `path` is the finding's `document.children[N]` address.
   */
  locate?: { path: string; seq: number } | null;
};

export function LeaferPreview({ leaferJson, editable, onCommit, locate }: LeaferPreviewProps): JSX.Element {
  const { t } = useI18n();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const leaferRef = useRef<Leafer | null>(null);
  const editorRef = useRef<Editor | null>(null);
  // Guards re-entrant events: programmatic tree.set() during imports fires
  // PropertyEvent.CHANGED and must never schedule a commit.
  const importingRef = useRef(false);
  // The commit callback lives in a ref so a parent re-render (suite/version
  // state updates) never tears down the canvas — the lifecycle depends only
  // on `editable`.
  const onCommitRef = useRef(onCommit);
  useEffect(() => {
    onCommitRef.current = onCommit;
  }, [onCommit]);
  // The retry gate mirrors `editable` without re-keying the lifecycle.
  const editableRef = useRef(editable);
  useEffect(() => {
    editableRef.current = editable;
  }, [editable]);
  const schedulerRef = useRef<LeaferCommitScheduler | null>(null);
  const [failed, setFailed] = useState(false);
  // Bumped whenever a fresh canvas instance exists — re-imports the current
  // JSON even when `leaferJson` itself did not change (e.g. an `editable`
  // flip rebuilt the canvas).
  const [canvasSeq, setCanvasSeq] = useState(0);
  // Last locate signal already flashed — canvas rebuilds (canvasSeq) must not
  // re-flash a stale locate.
  const flashedSeqRef = useRef(0);

  // ── Lifecycle: load the engine, create leafer + editor, destroy on unmount ──
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let instance: Leafer | null = null;
    let listener: (() => void) | null = null;
    let changedEventName: string | null = null;
    const asyncInit = async (): Promise<void> => {
      const engine = await import("leafer-editor").catch(() => null);
      if (!engine) {
        if (!disposed) setFailed(true);
        return;
      }
      if (disposed) return;
      // Flow layout plugin (@leafer-in/flow) — LEAFER_CREATE_CONTRACT composes
      // rows/columns with flow/gap/padding, and the plugin registers by import
      // side effect onto the shared @leafer-ui/draw singletons. A failed
      // import degrades to plain absolute layout; the canvas still renders.
      await import("@leafer-in/flow").catch(() => null);
      if (disposed) return;
      try {
        instance = new engine.Leafer({ view: host, fill: "#ffffff" });
        if (editable) {
          const editor = new engine.Editor();
          instance.add(editor);
          editorRef.current = editor;
        }
      } catch {
        if (!disposed) setFailed(true);
        return;
      }
      leaferRef.current = instance;
      const scheduler = createLeaferCommitScheduler({
        serialize: () => {
          const active = leaferRef.current;
          if (!active) return null;
          try {
            return JSON.stringify(active.toJSON());
          } catch {
            // A failed serialization must never crash the canvas; the next
            // edit re-schedules a fresh commit.
            return null;
          }
        },
        commit: (json) => {
          const commit = onCommitRef.current;
          if (!commit) return true;
          return Promise.resolve(commit(json));
        },
        debounceMs: COMMIT_DEBOUNCE_MS,
        trailingMs: COMMIT_TRAILING_MS,
        retryMs: COMMIT_RETRY_MS,
        canRetry: () => editableRef.current && onCommitRef.current !== undefined,
      });
      schedulerRef.current = scheduler;
      const onChanged = (): void => {
        if (importingRef.current) return;
        scheduler.requestCommit();
      };
      listener = onChanged;
      changedEventName = engine.PropertyEvent.CHANGE;
      instance.on(engine.PropertyEvent.CHANGE, onChanged);
      setCanvasSeq((seq) => seq + 1);
    };
    void asyncInit();
    return () => {
      disposed = true;
      importingRef.current = true;
      schedulerRef.current?.dispose();
      schedulerRef.current = null;
      try {
        if (instance && changedEventName && listener) instance.off(changedEventName, listener);
      } catch {
        // Event teardown is best-effort.
      }
      try {
        instance?.destroy();
      } catch {
        // Destroy races (upstream #865-class bugs) are contained here.
      }
      leaferRef.current = null;
      editorRef.current = null;
    };
  }, [editable]);

  // ── Data import: re-set the tree whenever the version's JSON changes ──
  useEffect(() => {
    const instance = leaferRef.current;
    if (!instance || failed) return;
    // An authoritative version landed — any pending retry of an older canvas
    // snapshot is superseded (e.g. a revise landed its own tree).
    schedulerRef.current?.cancelRetry();
    importingRef.current = true;
    try {
      const parsed: unknown = JSON.parse(leaferJson);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        instance.set(parsed as Record<string, unknown>);
        // Best-effort fit-to-view for large mockup canvases; the runtime
        // ships the mode but the shipped types omit it (guarded call).
        const fittable = editorRef.current as (Editor & { zoom?: (mode: string) => void }) | null;
        if (fittable && typeof fittable.zoom === "function") {
          try {
            fittable.zoom("fit");
          } catch {
            // View fit is cosmetic — never a canvas failure.
          }
        }
      }
    } catch {
      // Invalid JSON: leave the previous tree on canvas; the action layer
      // gates persistence, so this only renders for hand-edited content.
    } finally {
      importingRef.current = false;
    }
  }, [leaferJson, failed, canvasSeq]);

  // ── Locate: highlight the node a quality-tab lint finding addresses ──
  const locateSeq = locate?.seq ?? 0;
  const locatePath = locate?.path ?? "";
  useEffect(() => {
    if (locateSeq <= 0 || flashedSeqRef.current >= locateSeq) return;
    flashedSeqRef.current = locateSeq;
    const instance = leaferRef.current;
    if (!instance || failed) return;
    const indices = parseLeaferNodePath(locatePath);
    if (!indices) return;
    let target: unknown = instance;
    for (const index of indices) {
      const children = (target as { children?: unknown[] }).children;
      if (!Array.isArray(children) || index < 0 || index >= children.length) return;
      target = children[index];
    }
    if (!target || typeof target !== "object") return;
    const node = target as {
      getBounds?: () => { x: number; y: number; width: number; height: number };
      x?: unknown;
      y?: unknown;
      width?: unknown;
      height?: unknown;
      stroke?: unknown;
      strokeWidth?: unknown;
    };
    // Preferred: editor selection — highlights without touching the tree, so
    // a commit serialized during the flash never captures a highlight.
    const editor = editorRef.current;
    if (editor) {
      try {
        editor.select(node as never);
        return;
      } catch {
        // Selection is cosmetic — fall through to the stroke flash.
      }
    }
    // Read-only fallback: brief stroke flash on the node itself, restored
    // afterwards — never a highlight node left inside the serialized tree.
    const restore = { stroke: node.stroke, strokeWidth: node.strokeWidth };
    const flashOn = (): void => {
      importingRef.current = true;
      try {
        node.stroke = "#e5484d";
        node.strokeWidth = 3;
      } finally {
        importingRef.current = false;
      }
    };
    const flashOff = (): void => {
      importingRef.current = true;
      try {
        node.stroke = restore.stroke;
        node.strokeWidth = restore.strokeWidth;
      } catch {
        // The canvas may already be torn down — nothing to restore.
      } finally {
        importingRef.current = false;
      }
    };
    flashOn();
    const timer = window.setTimeout(flashOff, LOCATE_FLASH_MS);
    return () => {
      window.clearTimeout(timer);
      flashOff();
    };
  }, [locateSeq, locatePath, canvasSeq, failed]);

  if (failed) {
    return (
      <div className="ui-design-device-empty">
        <p>{t("designWorkspace.leaferCanvasError")}</p>
      </div>
    );
  }
  return <div className="ui-design-leafer-stage" ref={hostRef} />;
}

const COMMIT_DEBOUNCE_MS = 2000;
/** Trailing commit right after an in-flight one settles (edits made while
 *  the previous append was running must not wait another full debounce). */
const COMMIT_TRAILING_MS = 200;
/** Retry cadence for a refused snapshot (busy gate / transient IPC error). */
const COMMIT_RETRY_MS = 3000;

export default LeaferPreview;
