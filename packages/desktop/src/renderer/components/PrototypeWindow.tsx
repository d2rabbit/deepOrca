/**
 * PrototypeWindow — standalone renderer for popout prototype windows.
 *
 * When the user clicks "⧉ Window" in PrototypePanel, the main process
 * opens a new BrowserWindow with ?view=prototype. This component:
 * 1. Listens for the `event:a2uiWindowPayload` IPC event (sent on load)
 * 2. Renders the A2UI Surface full-screen
 * 3. Shows the surface title in a minimal header
 */

import { useEffect, useState, type JSX } from "react";
import { A2uiSurface } from "../a2ui/A2uiSurface";
import { processA2uiMessages, getSurfaces } from "../a2ui/processor";

export function PrototypeWindow(): JSX.Element {
  const [loaded, setLoaded] = useState(false);
  const [title, setTitle] = useState("Prototype");

  useEffect(() => {
    // Listen for the payload sent by main process on did-finish-load.
    const handler = (_event: unknown, data: { a2uiJson: string; title: string }) => {
      processA2uiMessages(data.a2uiJson);
      setTitle(data.title || "Prototype");
      setLoaded(true);
    };
    // The preload's subscribe helper isn't available for this one-off event,
    // so we use the raw ipcRenderer via window.deeporca if available.
    // Fallback: check if payload was already sent (race condition guard).
    const checkInterval = setInterval(() => {
      const surfaces = getSurfaces();
      if (surfaces.length > 0) {
        setTitle(surfaces[0]!.title);
        setLoaded(true);
        clearInterval(checkInterval);
      }
    }, 200);
    // Timeout after 10 seconds.
    const timeout = setTimeout(() => clearInterval(checkInterval), 10000);

    return () => {
      clearInterval(checkInterval);
      clearTimeout(timeout);
    };
  }, []);

  const surfaces = getSurfaces();

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
        {loaded && surfaces.length > 0 ? (
          <A2uiSurface messagesJson={JSON.stringify([])} />
        ) : (
          <div style={{ color: "#888", textAlign: "center", paddingTop: 40 }}>
            {loaded ? "No surfaces found." : "Waiting for prototype data…"}
          </div>
        )}
      </div>
    </div>
  );
}
