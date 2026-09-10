import { useEffect, useRef, type JSX } from "react";
import { createPortal } from "react-dom";

import { useI18n } from "../../i18n";
import type { PairExplainState } from "../../hooks/use-pair-lane";
import { fileBaseName } from "../../ui/path-utils";
import { StreamdownView } from "../StreamdownView";

type Props = {
  explain: PairExplainState;
  file: string | null;
  onDismiss(): void;
};

/**
 * Floating EXPLAIN card (2026-09-06 user ask): 「解释」 must never rewrite the
 * buffer — the agent's prose answer floats above the canvas instead. Portal
 * to body, fixed at the canvas's top-right (clear of the lane rail); content
 * renders through the shared Streamdown pipeline (markdown/HTML sanitize +
 * shiki code) instead of raw source text.
 */
export function ExplainCard({ explain, file, onDismiss }: Props): JSX.Element {
  const { t } = useI18n();
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // Keep the latest answer in view while streaming in long prose. jsdom has no
  // Element.scrollTo, so guard on the capability (same as FloatingDesignAgent).
  useEffect(() => {
    const body = bodyRef.current;
    if (explain?.busy && body && typeof body.scrollTo === "function") body.scrollTo({ top: 0 });
  }, [explain?.busy]);

  if (!explain) return <></>;
  const fileName = file ? fileBaseName(file) : "";

  return createPortal(
    <div className="ui-edexplain" role="dialog" aria-label={t("editor.pair.explain.title")}>
      <div className="ui-edexplain-head">
        <span className="t">
          ✦ {t("editor.pair.explain.title")} <span className="mono">{fileName}</span>
        </span>
        <button type="button" className="x" onClick={onDismiss} aria-label={t("common.close")}>
          ✕
        </button>
      </div>
      <div className="ui-edexplain-body" ref={bodyRef}>
        {explain.busy ? (
          <div className="busy">
            <span className="ui-spinner" /> {t("editor.pair.explain.running")}
          </div>
        ) : explain.error ? (
          <div className="ui-error">{explain.error}</div>
        ) : explain.content ? (
          <StreamdownView className="ui-md" markdown={explain.content} />
        ) : null}
      </div>
      <div className="ui-edexplain-foot">{t("editor.pair.explain.hint")}</div>
    </div>,
    document.body
  );
}
