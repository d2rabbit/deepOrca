/**
 * PrototypePanel — full-screen A2UI Surface preview for the PM-Design module.
 *
 * When the agent calls render_prototype or render_surface, App.tsx auto-switches
 * to this panel. The Surface renders full-width (unlike the inline A2uiMessage
 * in chat). A mini composer at the bottom lets the PM iterate without going
 * back to the chat view.
 *
 * User interactions (button clicks) flow through the same a2uiAction IPC chain.
 */

import { useEffect, useState, type JSX } from "react";
import { api } from "../api";
import { A2uiSurface } from "../a2ui/A2uiSurface";
import { processA2uiMessages } from "../a2ui/processor";
import { useI18n } from "../i18n";

type Props = {
  /** A2UI JSON messages from the tool result's embedded resource. */
  a2uiJson: string;
  /** Close the panel and return to chat. */
  onClose: () => void;
  /** Send an iteration prompt to the agent (from the mini composer). */
  onIterate: (text: string) => void;
};

export function PrototypePanel({ a2uiJson: initialJson, onClose, onIterate }: Props): JSX.Element {
  const { t } = useI18n();
  const [draft, setDraft] = useState("");
  const [liveJson, setLiveJson] = useState(initialJson);
  const [refreshKey, setRefreshKey] = useState(0);

  // Subscribe to real-time surface updates pushed by main process
  // after a2ui_action mutations (e.g. navigate: page switch).
  useEffect(() => {
    const off = api.onA2uiSurfaceUpdate((event) => {
      processA2uiMessages(event.a2uiJson);
      setLiveJson(event.a2uiJson);
      setRefreshKey((k) => k + 1);
    });
    return off;
  }, []);

  // Update liveJson when parent passes new a2uiJson (e.g. update_surface from agent).
  useEffect(() => {
    setLiveJson(initialJson);
  }, [initialJson]);

  function handleSubmit(): void {
    const text = draft.trim();
    if (!text) return;
    onIterate(text);
    setDraft("");
  }

  return (
    <div className="ui-prototype-panel">
      <div className="ui-prototype-panel-body">
        <A2uiSurface key={refreshKey} messagesJson={liveJson} />
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
