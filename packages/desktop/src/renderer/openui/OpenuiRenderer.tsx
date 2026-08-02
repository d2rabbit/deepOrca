/**
 * OpenuiRenderer — wraps @openuidev/react-lang's <Renderer> with DeepOrca's
 * component library and error handling.
 *
 * This is the OpenUI Lang equivalent of A2uiSurface. It takes raw OpenUI Lang
 * code (the compact `root = Column([...])` syntax) and renders it into React
 * components styled with DeepOrca's --ui-* CSS variables.
 *
 * Used exclusively by PM-Designer when mode === "openui".
 */

import { type JSX, useEffect, useState } from "react";
import { Renderer, type ActionEvent } from "@openuidev/react-lang";
import type { OpenUIError } from "@openuidev/lang-core";
import { deeporcaLibrary } from "./library";

type Props = {
  /** Raw OpenUI Lang code from the agent's tool output. */
  code: string;
  /** Called when a component triggers an action (e.g. Button click). */
  onAction?: (event: ActionEvent) => void;
};

export function OpenuiRenderer({ code, onAction }: Props): JSX.Element {
  const [errors, setErrors] = useState<OpenUIError[]>([]);

  // F6: Clear errors when code becomes empty (SDK's onError([]) doesn't fire
  // for empty response — see react-lang useOpenUIState early return).
  useEffect(() => {
    if (!code) setErrors([]);
  }, [code]);

  return (
    <div className="ui-openui-renderer" style={{ minHeight: "100%" }}>
      {errors.length > 0 ? (
        <div
          style={{
            padding: 12,
            marginBottom: 8,
            borderRadius: "var(--ui-radius, 8px)",
            background: "rgba(239,68,68,0.1)",
            border: "1px solid rgba(239,68,68,0.3)",
            fontSize: 12,
            color: "#f87171",
          }}
        >
          {errors.map((e, i) => (
            <div key={i}>
              <strong>{e.code}</strong>: {e.message}
            </div>
          ))}
        </div>
      ) : null}
      <Renderer response={code} library={deeporcaLibrary} isStreaming={false} onAction={onAction} onError={setErrors} />
      {errors.length > 0 ? (
        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--ui-text-muted)" }}>
            Raw OpenUI Lang code
          </summary>
          <pre
            style={{
              marginTop: 8,
              padding: 12,
              borderRadius: "var(--ui-radius, 8px)",
              background: "var(--ui-code-bg, rgba(0,0,0,0.2))",
              color: "var(--ui-code-fg, #ccc)",
              fontSize: 12,
              overflow: "auto",
              whiteSpace: "pre-wrap",
            }}
          >
            {code}
          </pre>
        </details>
      ) : null}
    </div>
  );
}
