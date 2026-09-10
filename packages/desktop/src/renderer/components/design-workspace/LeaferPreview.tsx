import { useEffect, useRef, useState, type JSX } from "react";
// Engine TYPES only (erased at build) — the runtime module is imported
// lazily in the lifecycle effect. leafer-editor's module init references
// canvas globals that do not exist outside a real browser surface (jsdom,
// GPU-less windows), so the dynamic import itself is part of the guarded
// failure path. It also keeps the ~300KB engine out of the initial renderer
// chunk (splitting discipline).
import type { Editor, Leafer } from "leafer-editor";
import { useI18n } from "../../i18n";

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

type LeaferPreviewProps = {
  /** The suite version's stored `content.leafer` JSON document. */
  leaferJson: string;
  /** Head version in a writable workspace — enables the editor plugin. */
  editable: boolean;
  /** Debounced commit after user edits (serialized toJSON output). */
  onCommit?: (leaferJson: string) => void;
};

const COMMIT_DEBOUNCE_MS = 2000;

export function LeaferPreview({ leaferJson, editable, onCommit }: LeaferPreviewProps): JSX.Element {
  const { t } = useI18n();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const leaferRef = useRef<Leafer | null>(null);
  const editorRef = useRef<Editor | null>(null);
  // Guards re-entrant events: programmatic tree.set() during imports fires
  // PropertyEvent.CHANGED and must never schedule a commit.
  const importingRef = useRef(false);
  const commitTimerRef = useRef<number | null>(null);
  const lastCommittedRef = useRef<string | null>(null);
  // The commit callback lives in a ref so a parent re-render (suite/version
  // state updates) never tears down the canvas — the lifecycle depends only
  // on `editable`.
  const onCommitRef = useRef(onCommit);
  useEffect(() => {
    onCommitRef.current = onCommit;
  }, [onCommit]);
  const [failed, setFailed] = useState(false);
  // Bumped whenever a fresh canvas instance exists — re-imports the current
  // JSON even when `leaferJson` itself did not change (e.g. an `editable`
  // flip rebuilt the canvas).
  const [canvasSeq, setCanvasSeq] = useState(0);

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
      const onChanged = (): void => {
        if (importingRef.current) return;
        if (commitTimerRef.current !== null) window.clearTimeout(commitTimerRef.current);
        commitTimerRef.current = window.setTimeout(() => {
          commitTimerRef.current = null;
          const active = leaferRef.current;
          const commit = onCommitRef.current;
          if (!active || !commit) return;
          try {
            const next = JSON.stringify(active.toJSON());
            if (next && next !== lastCommittedRef.current) {
              lastCommittedRef.current = next;
              commit(next);
            }
          } catch {
            // A failed serialization must never crash the canvas; the next
            // edit re-schedules a fresh commit.
          }
        }, COMMIT_DEBOUNCE_MS);
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
      if (commitTimerRef.current !== null) {
        window.clearTimeout(commitTimerRef.current);
        commitTimerRef.current = null;
      }
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

  if (failed) {
    return (
      <div className="ui-design-device-empty">
        <p>{t("designWorkspace.leaferCanvasError")}</p>
      </div>
    );
  }
  return <div className="ui-design-leafer-stage" ref={hostRef} />;
}

export default LeaferPreview;
