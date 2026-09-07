/**
 * PrototypePanel — full-screen preview for the PM-Design module.
 *
 * Supports two rendering modes:
 * - "a2ui" (default): A2UI JSON Surface via A2uiSurface (the original pipeline)
 * - "openui": OpenUI Lang code via OpenuiRenderer (the compact syntax pipeline)
 *
 * When the agent calls render_prototype / render_surface, App.tsx opens this
 * panel in "a2ui" mode. When the agent calls render_openui, App.tsx opens it
 * in "openui" mode. A mini composer at the bottom lets the PM iterate without
 * going back to the chat view.
 */

import { lazy, Suspense, useCallback, useEffect, useRef, useState, type JSX, type MouseEvent } from "react";
import type { ActionEvent, OpenUIError } from "@openuidev/lang-core";
import { api } from "../api";
import { useI18n } from "../i18n";
import { IconExternal } from "../ui/index";
import { A2uiSurface } from "../a2ui/A2uiSurface";
import { processA2uiMessages, extractSurfaceId } from "../a2ui/processor";
import { buildCorrectionPrompt, correctionFingerprint, shouldRetry } from "../openui/correction";

// Lazy-load the OpenUI renderer so it only adds to the bundle when used.
const OpenuiRenderer = lazy(() => import("../openui/OpenuiRenderer").then((m) => ({ default: m.OpenuiRenderer })));

/** Throttle window for persisting prototype form state (plan Batch 7: 2s). */
const FORM_STATE_SAVE_INTERVAL_MS = 2000;
/** Grace period before feeding render errors back — lets transient parses settle. */
const CORRECTION_DEBOUNCE_MS = 800;

export type PrototypeSelection = {
  nodePath: string;
  /** Viewport coordinates (getBoundingClientRect) so the popover can use position:fixed. */
  bounds: { x: number; y: number; width: number; height: number };
  action?: string;
};

type Props = {
  /** A2UI JSON messages (used when mode === "a2ui"). */
  a2uiJson: string;
  /** OpenUI Lang code (used when mode === "openui"). */
  openuiCode?: string;
  /** Rendering mode. Defaults to "a2ui". */
  mode?: "a2ui" | "openui";
  /** Send an iteration prompt to the agent (from the mini composer). */
  onIterate: (text: string) => void;
  /** Optional host-side selection capture for design workspace correction. */
  onSelectionChange?: (selection: PrototypeSelection | null) => void;
  selectionEnabled?: boolean;
  hideComposer?: boolean;
};

function prototypeNodePath(element: HTMLElement, root: HTMLElement): string {
  const semantic = element.dataset.sem ?? element.getAttribute("data-semantic-id") ?? element.id;
  if (semantic) return semantic.startsWith("view:") ? semantic : `view:root//${semantic}`;
  const segments: string[] = [];
  let current: HTMLElement | null = element;
  while (current && current !== root) {
    const siblings = current.parentElement
      ? Array.from(current.parentElement.children).filter((child) => child.tagName === current?.tagName)
      : [];
    segments.unshift(`${current.tagName.toLowerCase()}[${Math.max(1, siblings.indexOf(current) + 1)}]`);
    current = current.parentElement;
  }
  return `view:root//${segments.join("/")}`;
}

export function PrototypePanel({
  a2uiJson: initialJson,
  openuiCode,
  mode = "a2ui",
  onIterate,
  onSelectionChange,
  selectionEnabled = false,
  hideComposer = false,
}: Props): JSX.Element {
  const { t } = useI18n();
  const [draft, setDraft] = useState("");
  const [liveJson, setLiveJson] = useState(initialJson);
  const [liveOpenuiCode, setLiveOpenuiCode] = useState(openuiCode ?? "");
  const [refreshKey, setRefreshKey] = useState(0);

  // Extract surfaceId to scope update subscriptions (a2ui mode only).
  const scopedSurfaceId = extractSurfaceId(initialJson);

  // Subscribe to real-time surface updates pushed by main process
  // after a2ui_action mutations (e.g. navigate: page switch).
  // C1 fix: only apply updates for our surface.
  useEffect(() => {
    if (mode === "openui") return; // OpenUI mode doesn't use surface updates.
    const off = api.onA2uiSurfaceUpdate((event) => {
      if (scopedSurfaceId && event.surfaceId && event.surfaceId !== scopedSurfaceId) {
        return;
      }
      processA2uiMessages(event.a2uiJson);
      setLiveJson(event.a2uiJson);
      setRefreshKey((k) => k + 1);
    });
    return off;
  }, [scopedSurfaceId, mode]);

  // Update liveJson when parent passes new data.
  useEffect(() => {
    if (mode === "a2ui") setLiveJson(initialJson);
  }, [initialJson, mode]);

  useEffect(() => {
    if (mode === "openui" && openuiCode !== undefined) setLiveOpenuiCode(openuiCode);
  }, [openuiCode, mode]);

  function handleSubmit(): void {
    const text = draft.trim();
    if (!text) return;
    onIterate(text);
    setDraft("");
  }

  // Forward OpenUI actions to the agent as iteration prompts (similar to how
  // A2UI's a2ui_action routes button clicks back). The action event carries
  // formState and params which we serialize into a natural-language prompt.
  const handleOpenuiAction = useCallback(
    (event: ActionEvent) => {
      const msg = event.humanFriendlyMessage || `Action: ${event.type}`;
      const formSummary = event.formState ? `\nForm data: ${JSON.stringify(event.formState)}` : "";
      onIterate(`${msg}${formSummary}`);
    },
    [onIterate]
  );

  // Forward A2UI button clicks to the agent (matches PrototypeWindow's handler).
  // Without this the buttons rendered in this panel were inert (A2uiSurface
  // calls onAction only when provided).
  const handleA2uiAction = useCallback((surfaceId: string, actionName: string, context: Record<string, unknown>) => {
    void api.a2uiAction(surfaceId, actionName, context);
  }, []);

  // ── Form-state persistence (PM-Design) ─────────────────────────────────
  // Hydrate once per prototype code version; persist throttled. Main resolves
  // the target artifact (the pipeline's latest), so this layer stays id-free.
  const [hydratedFormState, setHydratedFormState] = useState<Record<string, unknown> | undefined>(undefined);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedAt = useRef(0);

  useEffect(() => {
    if (mode !== "openui") return;
    let cancelled = false;
    setHydratedFormState(undefined);
    api
      .designReadFormState("openui")
      .then((state) => {
        if (!cancelled && state && Object.keys(state).length > 0) setHydratedFormState(state);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [mode, liveOpenuiCode]);

  const handleStateUpdate = useCallback((state: Record<string, unknown>) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const elapsed = Date.now() - lastSavedAt.current;
    const flush = () => {
      lastSavedAt.current = Date.now();
      saveTimer.current = null;
      void api.designSaveFormState("openui", state).catch(() => {});
    };
    saveTimer.current = setTimeout(
      flush,
      elapsed >= FORM_STATE_SAVE_INTERVAL_MS ? 0 : FORM_STATE_SAVE_INTERVAL_MS - elapsed
    );
  }, []);

  // Flush any pending form-state save when unmounting / switching modes.
  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
    };
  }, []);

  // ── Correction loop (plan Batch 8, M5) ─────────────────────────────────
  // Feed structured render errors back to the agent once per prototype
  // version; the same code failing twice stops the loop (the local error
  // panel already shows details for the user).
  const lastFedRef = useRef<{ code: string; errorCodes: string } | null>(null);
  const correctionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (correctionTimer.current) clearTimeout(correctionTimer.current);
    };
  }, []);

  const handleErrors = useCallback(
    (errors: OpenUIError[]) => {
      if (correctionTimer.current) clearTimeout(correctionTimer.current);
      correctionTimer.current = setTimeout(() => {
        correctionTimer.current = null;
        if (!shouldRetry(errors, lastFedRef.current, liveOpenuiCode)) return;
        const prompt = buildCorrectionPrompt(errors, liveOpenuiCode);
        if (!prompt) return;
        lastFedRef.current = correctionFingerprint(errors, liveOpenuiCode);
        onIterate(prompt);
      }, CORRECTION_DEBOUNCE_MS);
    },
    [liveOpenuiCode, onIterate]
  );

  // Standalone popout (channel existed end-to-end with no UI): the opened
  // window replays the CURRENT live messages snapshot through the dedicated
  // prototype preload — it does NOT follow further surface updates.
  const openPopout = useCallback(() => {
    if (!liveJson.trim()) return;
    void api.a2uiOpenWindow(liveJson, t("proto.title")).catch(() => {});
  }, [liveJson, t]);

  /** Selected canvas element + metadata, kept for scroll-follow re-measure. */
  const selectionRef = useRef<{ element: HTMLElement; nodePath: string; action?: string } | null>(null);

  const handleSelectionCapture = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (!selectionEnabled || mode !== "openui" || !onSelectionChange) return;
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const root = event.currentTarget;
      const selectable = target.closest<HTMLElement>("button, input, select, textarea, [data-sem], [data-semantic-id]");
      // Blank-canvas click (no selectable ancestor) cancels the selection
      // instead of re-selecting the whole canvas root (mockup: 点空白取消).
      if (!selectable || !root.contains(selectable) || selectable === root) {
        selectionRef.current = null;
        onSelectionChange(null);
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      selectionRef.current = {
        element: selectable,
        nodePath: prototypeNodePath(selectable, root),
        action: selectable.dataset.action ?? selectable.getAttribute("data-act") ?? undefined,
      };
      const bounds = selectable.getBoundingClientRect();
      onSelectionChange({
        nodePath: selectionRef.current.nodePath,
        ...(selectionRef.current.action ? { action: selectionRef.current.action } : {}),
        bounds: { x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height },
      });
    },
    [mode, onSelectionChange, selectionEnabled]
  );

  // Scroll-follow (mockup placePop): re-measure the selected element on any
  // scroll (capture phase catches every scrolling ancestor); the selection is
  // dropped only when the element itself left the DOM.
  useEffect(() => {
    if (!selectionEnabled || mode !== "openui" || !onSelectionChange) return;
    const remeasure = () => {
      const current = selectionRef.current;
      if (!current) return;
      if (!current.element.isConnected) {
        selectionRef.current = null;
        onSelectionChange(null);
        return;
      }
      const bounds = current.element.getBoundingClientRect();
      onSelectionChange({
        nodePath: current.nodePath,
        ...(current.action ? { action: current.action } : {}),
        bounds: { x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height },
      });
    };
    document.addEventListener("scroll", remeasure, { capture: true, passive: true });
    return () => document.removeEventListener("scroll", remeasure, { capture: true });
  }, [mode, onSelectionChange, selectionEnabled]);

  return (
    <div className="ui-prototype-panel">
      {mode === "a2ui" && liveJson.trim() ? (
        <div className="ui-prototype-panel-toolbar">
          <button
            type="button"
            className="ui-prototype-panel-popout"
            title={t("proto.openWindow")}
            onClick={openPopout}
          >
            <IconExternal />
            {t("proto.openWindow")}
          </button>
        </div>
      ) : null}
      <div
        className={`ui-prototype-panel-body${selectionEnabled ? " selection-enabled" : ""}`}
        onClickCapture={handleSelectionCapture}
      >
        {mode === "openui" ? (
          <Suspense fallback={<div style={{ padding: 20, color: "var(--ui-text-muted)" }}>{t("common.loading")}</div>}>
            <OpenuiRenderer
              code={liveOpenuiCode}
              onAction={handleOpenuiAction}
              onStateUpdate={handleStateUpdate}
              initialState={hydratedFormState}
              onErrors={handleErrors}
            />
          </Suspense>
        ) : (
          <A2uiSurface
            key={refreshKey}
            messagesJson={liveJson}
            onAction={handleA2uiAction}
            surfaceId={scopedSurfaceId ?? undefined}
          />
        )}
      </div>
      {!hideComposer ? (
        <div className="ui-prototype-panel-composer">
          <input
            className="ui-prototype-panel-input"
            placeholder={t("prototypeWorkspace.agentPrompt")}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
          />
          <button className="ui-prototype-panel-send" onClick={handleSubmit} disabled={!draft.trim()}>
            {t("common.submit")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
