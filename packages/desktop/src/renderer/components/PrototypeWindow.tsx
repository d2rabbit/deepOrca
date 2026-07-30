/**
 * PrototypeWindow — standalone renderer for popout prototype windows.
 *
 * When the user clicks "⧉ Window" in PrototypePanel, the main process
 * opens a new BrowserWindow with ?view=prototype. This component:
 * 1. Listens for the `event:a2uiWindowPayload` IPC event (sent on load)
 * 2. Renders the A2UI Surface full-screen from the received payload
 */

import { useEffect, useState, type JSX } from "react";
import { ipcRenderer } from "electron";
import { A2uiSurface } from "../a2ui/A2uiSurface";
import { processA2uiMessages } from "../a2ui/processor";

export function PrototypeWindow(): JSX.Element {
  const [a2uiJson, setA2uiJson] = useState<string | null>(null);
  const [title, setTitle] = useState("Prototype");

  useEffect(() => {
    // Listen for the payload sent by main process on did-finish-load.
    const handler = (_event: unknown, data: { a2uiJson: string; title: string }) => {
      processA2uiMessages(data.a2uiJson);
      setTitle(data.title || "Prototype");
      setA2uiJson(data.a2uiJson);
    };
    ipcRenderer.on("event:a2uiWindowPayload", handler as never);
    return () => {
      ipcRenderer.removeListener("event:a2uiWindowPayload", handler as never);
    };
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
          <A2uiSurface messagesJson={a2uiJson} />
        ) : (
          <div style={{ color: "#888", textAlign: "center", paddingTop: 40 }}>Waiting for prototype data…</div>
        )}
      </div>
    </div>
  );
}
