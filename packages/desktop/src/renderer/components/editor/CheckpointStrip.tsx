import { useCallback, useEffect, useState, type JSX } from "react";

import { useI18n } from "../../i18n";
import type { PairCheckpoint } from "../../hooks/use-pair-lane";

type Props = {
  checkpoints: PairCheckpoint[];
  /** Last MANUAL save time — the baseline node's label (visual draft:
   *  「基线 · 你最后一次手动保存 12:02」). */
  baselineAt?: string | null;
  /** D10 rollback: restore the clicked checkpoint's post-apply snapshot. */
  onRollback?: (checkpoint: PairCheckpoint) => void;
};

/** Checkpoint strip (specs/editor-copilot B4/D10): one node per applied AI
 *  run. Clicking a past node rolls the buffer back to that snapshot (the
 *  restore is AI-annotated, so ⌘Z can roll it forward again); ⌘Z remains
 *  the step-wise rollback. */
export function CheckpointStrip({ checkpoints, baselineAt, onRollback }: Props): JSX.Element {
  const { t } = useI18n();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    // Only tick while there are nodes with relative timestamps to refresh —
    // an empty strip does not need a 30s re-render.
    if (checkpoints.length === 0) return;
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, [checkpoints.length]);

  const fmt = useCallback(
    (iso: string): string => {
      const d = new Date(iso);
      const mins = Math.max(0, Math.round((now.getTime() - d.getTime()) / 60_000));
      if (mins < 1) return t("editor.pair.cp.justNow");
      if (mins < 60) return t("editor.pair.cp.minAgo", { n: String(mins) });
      return t("editor.pair.cp.time", {
        h: String(d.getHours()).padStart(2, "0"),
        m: String(d.getMinutes()).padStart(2, "0"),
      });
    },
    [now, t]
  );

  return (
    <div className="ui-edpair-cps" role="list" aria-label={t("editor.pair.cp.title")}>
      <span className="h">{t("editor.pair.cp.title")}</span>
      {/* Baseline node (visual draft): 「基线 · 你最后一次手动保存 HH:MM」 —
          the manual-save anchor every AI checkpoint is measured against. */}
      <span className="ui-edpair-cp baseline">
        <span className="nd" />
        {t("editor.pair.cp.baseline")}
        {baselineAt
          ? ` · ${t("editor.pair.cp.lastSave")} ${String(new Date(baselineAt).getHours()).padStart(2, "0")}:${String(
              new Date(baselineAt).getMinutes()
            ).padStart(2, "0")}`
          : ""}
      </span>
      {checkpoints.length === 0 ? (
        <span className="ui-edpair-cps-empty">{t("editor.pair.cp.empty")}</span>
      ) : (
        checkpoints.map((cp, i) => {
          const current = i === checkpoints.length - 1;
          const older = Boolean(onRollback) && !current;
          return (
            <button
              key={cp.atIso + i}
              type="button"
              className={`ui-edpair-cp${current ? " cur" : ""}${older ? " click" : ""}`}
              role="listitem"
              disabled={!older}
              title={older ? t("editor.pair.cp.rollbackTo", { label: cp.label }) : undefined}
              onClick={() => (older ? onRollback?.(cp) : undefined)}
            >
              <span className="nd" />
              {cp.label}
              <span className="tm mono">{fmt(cp.atIso)}</span>
            </button>
          );
        })
      )}
      <span className="hint">{t("editor.pair.cp.hint")}</span>
    </div>
  );
}
