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
import type { ActionEvent } from "@openuidev/lang-core";
import { api } from "../api";
import { useI18n } from "../i18n";
import { IconExternal } from "../ui/index";
import { A2uiSurface } from "../a2ui/A2uiSurface";
import { processA2uiMessages, extractSurfaceId } from "../a2ui/processor";
import {
  buildCorrectionPrompt,
  correctionFingerprint,
  shouldRetry,
  type RendererErrorLike,
} from "../openui/correction";

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
  /** Which library authored openuiCode (suite meta stamp) — wins over the
   *  component-name routing heuristic. Absent → heuristic. */
  authoringLibrary?: "official" | "legacy" | null;
  /** Send an iteration prompt to the agent (from the mini composer). */
  onIterate: (text: string) => void;
  /** Optional host-side selection capture for design workspace correction. */
  onSelectionChange?: (selection: PrototypeSelection | null) => void;
  selectionEnabled?: boolean;
  hideComposer?: boolean;
  /** Host-owned selection nodePath — lets the panel drop its persistent
   *  outline when the workspace clears the selection externally. */
  selectionNodePath?: string | null;
  /** WP3.5 表单状态作用域:root+suite id(必填)+ device slot(可选)——
   *  有 suite 走 per-suite 槽位通道(formState.<device>.json),切设备/切
   *  suite 互不串值;缺省回落全局 "openui" 键(App 内嵌预览,行为不变)。 */
  formStateRoot?: string | null;
  formStateSuiteId?: string | null;
  formStateDeviceSlot?: string | null;
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
  authoringLibrary,
  onIterate,
  onSelectionChange,
  selectionEnabled = false,
  hideComposer = false,
  selectionNodePath,
  formStateRoot,
  formStateSuiteId,
  formStateDeviceSlot,
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

  // WP3.5:有 suite 时走 per-suite 槽位通道(桌面本体=无槽,变体=formState.<device>.json),
  // 否则回落全局键。latest refs 让 unmount flush 闭包拿到最新作用域与待存状态
  // (旧注释声称 flush,实现却丢弃——现在真 flush)。
  const pendingStateRef = useRef<Record<string, unknown> | null>(null);
  const scopeRef = useRef({ root: formStateRoot, suiteId: formStateSuiteId, slot: formStateDeviceSlot });
  scopeRef.current = { root: formStateRoot, suiteId: formStateSuiteId, slot: formStateDeviceSlot };

  const persist = useCallback((state: Record<string, unknown>): void => {
    const { root, suiteId, slot } = scopeRef.current;
    if (root && suiteId) {
      void api.designSuiteSaveFormState(root, suiteId, state, slot ?? undefined).catch(() => {});
      return;
    }
    void api.designSaveFormState("openui", state).catch(() => {});
  }, []);

  useEffect(() => {
    if (mode !== "openui") return;
    let cancelled = false;
    setHydratedFormState(undefined);
    const hydrate =
      formStateRoot && formStateSuiteId
        ? api.designSuiteReadFormState(formStateRoot, formStateSuiteId, formStateDeviceSlot ?? undefined)
        : api.designReadFormState("openui");
    hydrate
      .then((state) => {
        if (!cancelled && state && Object.keys(state).length > 0) setHydratedFormState(state);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [mode, liveOpenuiCode, formStateRoot, formStateSuiteId, formStateDeviceSlot]);

  const handleStateUpdate = useCallback(
    (state: Record<string, unknown>) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      pendingStateRef.current = state;
      const elapsed = Date.now() - lastSavedAt.current;
      // 交叉审查修正:flush 捕获「当次输入时」的作用域快照——若在节流窗口内
      // 切设备/套件,旧端状态仍写回旧端槽位,而不是 scopeRef 指向的新槽。
      const scopeAtUpdate = { ...scopeRef.current };
      const flush = () => {
        lastSavedAt.current = Date.now();
        saveTimer.current = null;
        const savedScope = scopeRef.current;
        scopeRef.current = scopeAtUpdate;
        try {
          persist(state);
        } finally {
          scopeRef.current = savedScope;
        }
      };
      saveTimer.current = setTimeout(
        flush,
        elapsed >= FORM_STATE_SAVE_INTERVAL_MS ? 0 : FORM_STATE_SAVE_INTERVAL_MS - elapsed
      );
    },
    [persist]
  );

  // Flush any pending form-state save when unmounting / switching modes —
  // the throttled tail (≤2s of input) must not be dropped.
  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
        const pending = pendingStateRef.current;
        if (pending) persist(pending);
      }
    };
  }, [persist]);

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
    (errors: RendererErrorLike[]) => {
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
  /** Last emitted selection bounds — scroll-follow dedupe (re-review M3). */
  const lastBoundsRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);

  // Persistent selection outline (mockup .dd-sec.pd-sel): stamped on the
  // element at select time, dropped on deselect/clear — including when the
  // WORKSPACE clears the selection externally (nodePath prop drift).
  const dropSelectionMark = useCallback((): void => {
    selectionRef.current?.element.classList.remove("ui-design-sel-outline");
  }, []);
  useEffect(() => {
    if (selectionRef.current && selectionRef.current.nodePath !== (selectionNodePath ?? null)) {
      dropSelectionMark();
      selectionRef.current = null;
      onSelectionChange?.(null);
    }
  }, [selectionNodePath, dropSelectionMark, onSelectionChange]);

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
        dropSelectionMark();
        selectionRef.current = null;
        lastBoundsRef.current = null;
        onSelectionChange(null);
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      dropSelectionMark();
      selectable.classList.add("ui-design-sel-outline");
      selectionRef.current = {
        element: selectable,
        nodePath: prototypeNodePath(selectable, root),
        action: selectable.dataset.action ?? selectable.getAttribute("data-act") ?? undefined,
      };
      const rect = selectable.getBoundingClientRect();
      const bounds = { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
      lastBoundsRef.current = bounds;
      onSelectionChange({
        nodePath: selectionRef.current.nodePath,
        ...(selectionRef.current.action ? { action: selectionRef.current.action } : {}),
        bounds,
      });
    },
    [mode, onSelectionChange, selectionEnabled, dropSelectionMark]
  );

  // Scroll-follow (mockup placePop): re-measure the selected element on any
  // scroll (capture phase catches every scrolling ancestor); the selection is
  // dropped only when the element itself left the DOM. Re-review M3: emit only
  // when the bounds actually moved — identical frames must not churn the
  // workspace re-render loop.
  useEffect(() => {
    if (!selectionEnabled || mode !== "openui" || !onSelectionChange) return;
    const remeasure = () => {
      const current = selectionRef.current;
      if (!current) return;
      if (!current.element.isConnected) {
        dropSelectionMark();
        selectionRef.current = null;
        lastBoundsRef.current = null;
        onSelectionChange(null);
        return;
      }
      const rect = current.element.getBoundingClientRect();
      const last = lastBoundsRef.current;
      if (
        last &&
        last.x === rect.left &&
        last.y === rect.top &&
        last.width === rect.width &&
        last.height === rect.height
      ) {
        return;
      }
      const bounds = { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
      lastBoundsRef.current = bounds;
      onSelectionChange({
        nodePath: current.nodePath,
        ...(current.action ? { action: current.action } : {}),
        bounds,
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
              authoringLibrary={authoringLibrary}
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
