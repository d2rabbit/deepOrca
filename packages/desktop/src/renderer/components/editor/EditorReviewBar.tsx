import type { JSX } from "react";

import { useI18n } from "../../i18n";

export type ReviewHunkChip = {
  /** hunk index (change-group order). */
  index: number;
  accepted: boolean;
};

type Props = {
  added: number;
  removed: number;
  /** Per-change-hunk chips (2026-09-06 多 hunk): toggle + ↑↓ navigation. */
  hunks?: ReviewHunkChip[];
  currentHunk?: number;
  onPrevHunk?(): void;
  onNextHunk?(): void;
  onToggleHunk?(index: number, accepted: boolean): void;
  /** 预览差异 (visual draft): opens the hunk diff popover. */
  onPreview?(): void;
  onApply(): void;
  onDiscard(): void;
};

/** Review bar (specs/editor-copilot B4, visual draft D5): the canvas-bottom
 *  affordance while a run awaits review — per-hunk accept/reject with ↑↓
 *  navigation, 预览差异, apply-all (⌘⏎), discard (Esc), live ±N. */
export function EditorReviewBar({
  added,
  removed,
  hunks,
  currentHunk,
  onPrevHunk,
  onNextHunk,
  onToggleHunk,
  onPreview,
  onApply,
  onDiscard,
}: Props): JSX.Element {
  const { t } = useI18n();
  const count = hunks?.length ?? 0;
  return (
    <div className="ui-edpair-reviewbar" role="toolbar" aria-label={t("editor.pair.review.title")}>
      <span className="stat mono">
        <span className="add">+{added}</span> <span className="del">−{removed}</span>
      </span>
      {count > 0 ? (
        <span className="ui-edreview-hunks">
          <button
            type="button"
            className="ui-edreview-nav"
            onClick={onPrevHunk}
            disabled={currentHunk === undefined || currentHunk <= 0}
            title={t("editor.pair.review.prevHunk")}
            aria-label={t("editor.pair.review.prevHunk")}
          >
            ↑
          </button>
          {hunks!.map((h, i) => (
            <button
              key={h.index}
              type="button"
              className={`ui-edreview-hunk${i === currentHunk ? " cur" : ""}${h.accepted ? "" : " rejected"}`}
              title={h.accepted ? t("editor.pair.review.hunkAccept") : t("editor.pair.review.hunkReject")}
              onClick={() => onToggleHunk?.(h.index, !h.accepted)}
            >
              {h.accepted ? "✓" : "✕"} hunk {i + 1}
            </button>
          ))}
          <button
            type="button"
            className="ui-edreview-nav"
            onClick={onNextHunk}
            disabled={currentHunk === undefined || currentHunk >= count - 1}
            title={t("editor.pair.review.nextHunk")}
            aria-label={t("editor.pair.review.nextHunk")}
          >
            ↓
          </button>
        </span>
      ) : null}
      {onPreview ? (
        <button type="button" className="ui-edpair-rbtn subtle" onClick={onPreview}>
          {t("editor.pair.review.preview")}
        </button>
      ) : null}
      <span className="hint">{t("editor.pair.review.hint")}</span>
      <span className="grow" />
      <button type="button" className="ui-edpair-rbtn danger" onClick={onDiscard}>
        {t("editor.pair.review.discard")} <kbd>Esc</kbd>
      </button>
      <button type="button" className="ui-edpair-rbtn primary" onClick={onApply}>
        {t("editor.pair.review.apply")} <kbd>⌘⏎</kbd>
      </button>
    </div>
  );
}
