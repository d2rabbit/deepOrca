/**
 * PrototypePanel — full-screen preview for A2UI Surfaces (the original
 * pipeline). The retired OpenUI Lang mode was replaced by the MoonViz
 * prototype preview (specs/moonviz-engine-replacement): App.tsx and the
 * design workspaces render MoonvizPreview directly for `moonviz` content.
 *
 * When the agent calls render_prototype / render_surface, App.tsx opens this
 * panel in "a2ui" mode. A mini composer at the bottom lets the PM iterate
 * without going back to the chat view.
 */

import { useCallback, useEffect, useState, type JSX } from "react";
import { api } from "../api";
import { useI18n } from "../i18n";
import { IconExternal } from "../ui/index";
import { A2uiSurface } from "../a2ui/A2uiSurface";
import { processA2uiMessages, extractSurfaceId } from "../a2ui/processor";

type Props = {
  /** A2UI JSON messages. */
  a2uiJson: string;
  /** Send an iteration prompt to the agent (from the mini composer). */
  onIterate: (text: string) => void;
  hideComposer?: boolean;
};

export function PrototypePanel({ a2uiJson: initialJson, onIterate, hideComposer = false }: Props): JSX.Element {
  const { t } = useI18n();
  const [draft, setDraft] = useState("");
  const [liveJson, setLiveJson] = useState(initialJson);
  const [refreshKey, setRefreshKey] = useState(0);

  // Extract surfaceId to scope update subscriptions.
  const scopedSurfaceId = extractSurfaceId(initialJson);

  // Subscribe to real-time surface updates pushed by main process
  // after a2ui_action mutations (e.g. navigate: page switch).
  // C1 fix: only apply updates for our surface.
  useEffect(() => {
    const off = api.onA2uiSurfaceUpdate((event) => {
      if (scopedSurfaceId && event.surfaceId && event.surfaceId !== scopedSurfaceId) {
        return;
      }
      processA2uiMessages(event.a2uiJson);
      setLiveJson(event.a2uiJson);
      setRefreshKey((k) => k + 1);
    });
    return off;
  }, [scopedSurfaceId]);

  // Update liveJson when parent passes new data.
  useEffect(() => {
    setLiveJson(initialJson);
  }, [initialJson]);

  function handleSubmit(): void {
    const text = draft.trim();
    if (!text) return;
    onIterate(text);
    setDraft("");
  }

  // Forward A2UI button clicks to the agent (matches PrototypeWindow's handler).
  // Without this the buttons rendered in this panel were inert (A2uiSurface
  // calls onAction only when provided).
  const handleA2uiAction = useCallback((surfaceId: string, actionName: string, context: Record<string, unknown>) => {
    void api.a2uiAction(surfaceId, actionName, context);
  }, []);

  // Standalone popout (channel existed end-to-end with no UI): the opened
  // window replays the CURRENT live messages snapshot through the dedicated
  // prototype preload — it does NOT follow further surface updates.
  const openPopout = useCallback(() => {
    if (!liveJson.trim()) return;
    void api.a2uiOpenWindow(liveJson, t("proto.title")).catch(() => {});
  }, [liveJson, t]);

  return (
    <div className="ui-prototype-panel">
      {liveJson.trim() ? (
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
      <div className="ui-prototype-panel-body">
        <A2uiSurface
          key={refreshKey}
          messagesJson={liveJson}
          onAction={handleA2uiAction}
          surfaceId={scopedSurfaceId ?? undefined}
        />
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
