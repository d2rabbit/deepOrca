/**
 * OpenuiRenderer — wraps @openuidev/react-lang's <Renderer> with the official
 * @openuidev/react-ui component library (openuiLibrary, imported from the
 * lean genui-lib entry) and DeepOrca's error handling.
 *
 * This is the OpenUI Lang equivalent of A2uiSurface. It takes raw OpenUI Lang
 * code and renders it into the official components; DeepOrca's `--openui-*`
 * token bridge (ui-css/openui-bridge.css) re-tints them to the active theme.
 *
 * Used exclusively by Designer (PM-Design pipeline) when mode === "openui".
 */

import { type JSX, useEffect, useMemo, useRef, useState } from "react";
import { Renderer, type ActionEvent } from "@openuidev/react-lang";
import { openuiLibrary } from "@openuidev/react-ui/genui-lib";
import { useI18n } from "../i18n";
import { deeporcaLibrary } from "./library";
import { resolveLibraryMode, type OpenuiLibraryMode } from "./library-route";
import { auditButtonActions } from "./action-audit";
import { createDesignerToolProvider } from "./tool-provider";
import { annotateActTags } from "./act-annotation";
import { splitOpenuiErrors, type RendererErrorLike } from "./correction";

/**
 * Route code to its rendering library.
 *
 * New prototypes are authored against the OFFICIAL openuiLibrary (see
 * pm-designer-openui SKILL.md, generated from openuiLibrary.prompt()). Suites
 * generated before the switch use DeepOrca's first-party component names —
 * the classification itself lives in library-route.ts (pure, unit-tested);
 * official-exclusive component names take priority over legacy markers so a
 * quoted `Row(` in a string literal can't misroute official code.
 */

type Props = {
  /** Raw OpenUI Lang code from the agent's tool output. */
  code: string;
  /** Which library authored this suite (meta stamp). Wins over the
   *  component-name heuristic; absent → heuristic fallback. */
  authoringLibrary?: OpenuiLibraryMode | null;
  /** Called when a component triggers an action (e.g. Button click). */
  onAction?: (event: ActionEvent) => void;
  /** Enable the designer tool provider — prototypes can Query() local data. */
  enableTools?: boolean;
  /** Form-state changes (caller throttles persistence). */
  onStateUpdate?: (state: Record<string, unknown>) => void;
  /** Hydrate form fields from a persisted state. */
  initialState?: Record<string, unknown>;
  /** Render errors surfaced (correction-loop input; see openui/correction.ts).
   *  Includes DeepOrca's own audit findings (bare-string Button actions). */
  onErrors?: (errors: RendererErrorLike[]) => void;
};

export function OpenuiRenderer({
  code,
  authoringLibrary,
  onAction,
  enableTools = true,
  onStateUpdate,
  initialState,
  onErrors,
}: Props): JSX.Element {
  const { t } = useI18n();
  const [sdkErrors, setSdkErrors] = useState<RendererErrorLike[]>([]);
  // Declared library wins; the name heuristic only runs for unstamped suites
  // (pre-field metas, legacy artifacts).
  const libraryMode = useMemo(() => resolveLibraryMode(code, authoringLibrary), [code, authoringLibrary]);
  // Official library for new code; legacy fallback for pre-switch suites.
  const library = libraryMode === "legacy" ? deeporcaLibrary : openuiLibrary;
  // M3: a bare-string Button action compiles (upstream z.any()) but throws at
  // click time with zero surface feedback — surface it as a non-fatal warning
  // riding the same correction loop as excess-args. Official code only:
  // legacy Button treats a string action as a message.
  const auditFindings = useMemo(
    () => (libraryMode === "official" ? auditButtonActions(code) : []),
    [code, libraryMode]
  );
  const allErrors = useMemo<RendererErrorLike[]>(() => [...sdkErrors, ...auditFindings], [sdkErrors, auditFindings]);
  // Non-fatal notices (excess-args, dead-button-action: render continues)
  // fold into one amber warning; only fatal errors get the red wall.
  const { fatal: fatalErrors, warnings } = useMemo(() => splitOpenuiErrors(allErrors), [allErrors]);

  // Create the tool provider once (stable reference for the SDK).
  const toolProvider = useMemo(() => (enableTools ? createDesignerToolProvider() : undefined), [enableTools]);

  // F6: Clear errors when code becomes empty (SDK's onError([]) doesn't fire
  // for empty response — see react-lang useOpenUIState early return).
  useEffect(() => {
    if (!code) setSdkErrors([]);
  }, [code]);

  // Correction-loop feed: SDK errors arrive via onError below, audit findings
  // change with code — both funnel through the merged array so the host sees
  // one complete picture (handleErrors debounces and de-dupes).
  useEffect(() => {
    onErrors?.(allErrors);
  }, [allErrors, onErrors]);

  // Act-tag producer (openui/act-annotation.ts): stamps `data-act` on the
  // rendered buttons/forms/anchors so the design workspace's selection popover
  // can show its `执行 {action}` chip, and act-tag hover labels can be styled
  // by CSS. Runs once per code change, and a MutationObserver re-runs the same
  // rAF-throttled pass so dynamically mounted controls get stamped too.
  const containerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        annotateActTags(container);
      });
    };
    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(container, { childList: true, subtree: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      observer.disconnect();
    };
  }, [code]);

  return (
    <div ref={containerRef} className="ui-openui-renderer" style={{ minHeight: "100%" }}>
      {fatalErrors.length > 0 ? (
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
          {fatalErrors.map((e, i) => (
            <div key={i}>
              <strong>{e.code}</strong>: {e.message}
            </div>
          ))}
        </div>
      ) : null}
      {warnings.length > 0 ? (
        <details
          style={{
            marginBottom: 8,
            borderRadius: "var(--ui-radius, 8px)",
            background: "rgba(240, 180, 40, 0.08)",
            border: "1px solid rgba(240, 180, 40, 0.35)",
            padding: "8px 12px",
            fontSize: 12,
            color: "var(--ui-text-dim, #b08c00)",
          }}
        >
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>
            ⚠ {t("openui.warningSummary", { count: warnings.length })}
          </summary>
          <div style={{ marginTop: 6 }}>
            {warnings.map((e, i) => (
              <div key={i}>
                <strong>{e.code}</strong>: {e.message}
              </div>
            ))}
          </div>
        </details>
      ) : null}
      <Renderer
        response={code}
        library={library}
        isStreaming={false}
        onAction={onAction}
        onError={(errs) => setSdkErrors(errs)}
        toolProvider={toolProvider}
        onStateUpdate={onStateUpdate}
        initialState={initialState}
      />
      {allErrors.length > 0 ? (
        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--ui-text-faint, var(--ui-text-dim))" }}>
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
