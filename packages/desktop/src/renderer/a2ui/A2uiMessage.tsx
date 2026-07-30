/**
 * A2uiMessage — renders an A2UI Surface inline in the conversation.
 *
 * When a tool result contains an A2UI EmbeddedResource (MIME
 * application/a2ui+json), the Message dispatcher renders this component
 * instead of a plain text tool card.
 *
 * User interactions (button clicks) flow back to the agent via the
 * a2uiAction IPC channel → main process → MCP a2ui_action tool.
 */

import { useCallback, type JSX } from "react";
import { A2uiSurface } from "./A2uiSurface";
import { api } from "../api";

type Props = {
  /** The raw A2UI JSON messages from the tool result's embedded resource. */
  a2uiJson: string;
  /** The text summary from the tool result (shown as a header). */
  summary?: string;
};

export function A2uiMessage({ a2uiJson, summary }: Props): JSX.Element {
  // Forward user interactions to the agent via IPC → MCP a2ui_action tool.
  const handleAction = useCallback((surfaceId: string, actionName: string, context: Record<string, unknown>) => {
    void api.a2uiAction(surfaceId, actionName, context);
  }, []);

  return (
    <div className="ui-a2ui-message">
      {summary ? <div className="ui-a2ui-message-summary">{summary}</div> : null}
      <A2uiSurface messagesJson={a2uiJson} onAction={handleAction} />
    </div>
  );
}
