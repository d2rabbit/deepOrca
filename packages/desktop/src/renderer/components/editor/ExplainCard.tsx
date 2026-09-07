import { useEffect, useRef, type JSX } from "react";
import { createPortal } from "react-dom";

import { useI18n } from "../../i18n";
import type { PairExplainState } from "../../hooks/use-pair-lane";
import { fileBaseName } from "../../ui/path-utils";

type Props = {
  explain: PairExplainState;
  file: string | null;
  onDismiss(): void;
};

/**
 * Floating EXPLAIN card (2026-09-06 user ask): 「解释」 must never rewrite the
 * buffer — the agent's prose answer floats above the canvas instead. Portal
 * to body, fixed at the canvas's top-right (clear of the lane rail); content
 * renders as pre-wrapped text so the agent's line structure survives.
 */
export function ExplainCard({ explain, file, onDismiss }: Props): JSX.Element {
  const { t } = useI18n();
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // Keep the latest answer in view while streaming in long prose.
  useEffect(() => {
    if (explain?.busy) bodyRef.current?.scrollTo({ top: 0 });
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
        ) : (
          <div className="prose">{explain.content}</div>
        )}
      </div>
      <div className="ui-edexplain-foot">{t("editor.pair.explain.hint")}</div>
    </div>,
    document.body
  );
}
