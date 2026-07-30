/**
 * A2uiMessage — renders an A2UI Surface inline in the conversation.
 *
 * When a tool result contains an A2UI EmbeddedResource (MIME
 * application/a2ui+json), the Message dispatcher renders this component
 * instead of a plain text tool card.
 */

import { type JSX } from "react";
import { A2uiSurface } from "./A2uiSurface";

type Props = {
  /** The raw A2UI JSON messages from the tool result's embedded resource. */
  a2uiJson: string;
  /** The text summary from the tool result (shown as a header). */
  summary?: string;
};

export function A2uiMessage({ a2uiJson, summary }: Props): JSX.Element {
  return (
    <div className="ui-a2ui-message">
      {summary ? <div className="ui-a2ui-message-summary">{summary}</div> : null}
      <A2uiSurface messagesJson={a2uiJson} />
    </div>
  );
}
