/**
 * PrototypeWindow — standalone renderer for popout prototype windows.
 *
 * When the user clicks "⧉ Window" in PrototypePanel, the main process
 * opens a new BrowserWindow with ?view=prototype. This component:
 * 1. Receives the initial surface payload via `api.onA2uiWindowPayload`
 *    (sent by main on did-finish-load).
 * 2. Subscribes to `api.onA2uiSurfaceUpdate` so live mutations from
 *    a2ui_action (e.g. navigate: page switch) keep the window in sync.
 * 3. Forwards user interactions (button clicks) back to the agent via
 *    `api.a2uiAction` → main process → MCP a2ui_action tool.
 *
 * Uses the preload's typed `window.deeporca` bridge exclusively — never
 * imports `electron` directly, so it bundles cleanly as a browser module.
 */

import { useCallback, useEffect, useState, type JSX } from "react";
import { A2uiSurface } from "../a2ui/A2uiSurface";
import { api } from "../api";
import { processA2uiMessages, extractSurfaceId } from "../a2ui/processor";

export function PrototypeWindow(): JSX.Element {
  const [a2uiJson, setA2uiJson] = useState<string | null>(null);
  const [title, setTitle] = useState("Prototype");
  const [refreshKey, setRefreshKey] = useState(0);

  // Extract surfaceId from whatever payload we currently hold, so we can
  // scope the update subscription to THIS surface only.
  const scopedSurfaceId = a2uiJson ? extractSurfaceId(a2uiJson) : null;

  // 1. Initial payload — pull by token on mount (race-free handshake). The
  //    earlier push-only path (did-finish-load) could fire before this effect
  //    subscribed, leaving the window on "Waiting for prototype data…".
  //    The push subscription below is kept as a back-compat fallback.
  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    if (token) {
      void (async () => {
        try {
          const payload = await api.getPrototypePayload(token);
          if (cancelled || !payload) return;
          processA2uiMessages(payload.a2uiJson);
          setTitle(payload.title || "Prototype");
          setA2uiJson(payload.a2uiJson);
          setRefreshKey((k) => k + 1);
        } catch {
          // Fall back to the push subscription below.
        }
      })();
    }
    const off = api.onA2uiWindowPayload((event) => {
      processA2uiMessages(event.a2uiJson);
      setTitle(event.title || "Prototype");
      setA2uiJson(event.a2uiJson);
      setRefreshKey((k) => k + 1);
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  // 2. Live surface updates pushed after a2ui_action mutations.
  //    Only apply updates matching this window's surfaceId (C1 scoping fix).
  useEffect(() => {
    if (!scopedSurfaceId) return;
    const off = api.onA2uiSurfaceUpdate((event) => {
      if (event.surfaceId && event.surfaceId !== scopedSurfaceId) {
        return;
      }
      processA2uiMessages(event.a2uiJson);
      setA2uiJson(event.a2uiJson);
      setRefreshKey((k) => k + 1);
    });
    return off;
  }, [scopedSurfaceId]);

  // 3. Forward user interactions (button clicks, etc.) to the agent.
  const handleAction = useCallback((surfaceId: string, actionName: string, context: Record<string, unknown>) => {
    void api.a2uiAction(surfaceId, actionName, context);
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "var(--ui-bg, #1a1a1a)" }}>
      <div
        style={{
          padding: "8px 16px",
          borderBottom: "1px solid var(--ui-border-soft, #333)",
          fontSize: 13,
          fontWeight: 600,
          color: "var(--ui-text-secondary, #ccc)",
          background: "var(--ui-surface-alt, rgba(0,0,0,0.1))",
        }}
      >
        ✦ {title}
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: 16 }}>
        {a2uiJson ? (
          <A2uiSurface
            key={refreshKey}
            messagesJson={a2uiJson}
            onAction={handleAction}
            surfaceId={scopedSurfaceId ?? undefined}
          />
        ) : (
          <div style={{ color: "#888", textAlign: "center", paddingTop: 40 }}>Waiting for prototype data…</div>
        )}
      </div>
    </div>
  );
}
