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

import { lazy, Suspense, useCallback, useEffect, useState, type JSX } from "react";
import type { ActionEvent } from "@openuidev/lang-core";
import { api } from "../api";
import { A2uiSurface } from "../a2ui/A2uiSurface";
import { processA2uiMessages, extractSurfaceId } from "../a2ui/processor";

// Lazy-load the OpenUI renderer so it only adds to the bundle when used.
const OpenuiRenderer = lazy(() => import("../openui/OpenuiRenderer").then((m) => ({ default: m.OpenuiRenderer })));

type Props = {
  /** A2UI JSON messages (used when mode === "a2ui"). */
  a2uiJson: string;
  /** OpenUI Lang code (used when mode === "openui"). */
  openuiCode?: string;
  /** Rendering mode. Defaults to "a2ui". */
  mode?: "a2ui" | "openui";
  /** Send an iteration prompt to the agent (from the mini composer). */
  onIterate: (text: string) => void;
};

export function PrototypePanel({ a2uiJson: initialJson, openuiCode, mode = "a2ui", onIterate }: Props): JSX.Element {
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

  return (
    <div className="ui-prototype-panel">
      <div className="ui-prototype-panel-body">
        {mode === "openui" ? (
          <Suspense
            fallback={<div style={{ padding: 20, color: "var(--ui-text-muted)" }}>Loading OpenUI renderer…</div>}
          >
            <OpenuiRenderer code={liveOpenuiCode} onAction={handleOpenuiAction} />
          </Suspense>
        ) : (
          <A2uiSurface key={refreshKey} messagesJson={liveJson} surfaceId={scopedSurfaceId ?? undefined} />
        )}
      </div>
      <div className="ui-prototype-panel-composer">
        <input
          className="ui-prototype-panel-input"
          placeholder="Describe changes… (e.g. 'add a remember me checkbox')"
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
          →
        </button>
      </div>
    </div>
  );
}
