import { useEffect, useRef, type JSX } from "react";
import { createPortal } from "react-dom";

import { useI18n } from "../../i18n";
import type { DiffGroup } from "./cm6-diff";

type Props = {
  groups: DiffGroup[] | null;
  currentHunk: number;
  onClose(): void;
};

/**
 * 预览差异 (2026-09-06 user ask, visual draft): unified diff of the pending
 * review — context lines dimmed, removed lines red, added lines green; the
 * current hunk auto-scrolls into view. Read-only portal at the canvas's
 * top-right (mirrors the ExplainCard placement).
 */
export function EditorReviewPreview({ groups, currentHunk, onClose }: Props): JSX.Element {
  const { t } = useI18n();
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const hunkRefs = useRef<Array<HTMLDivElement | null>>([]);

  useEffect(() => {
    hunkRefs.current[currentHunk]?.scrollIntoView({ block: "nearest" });
  }, [currentHunk]);

  if (!groups || groups.length === 0) return <></>;
  const changeHunks = groups.filter((g) => g.type === "change");
  let hi = -1;

  return createPortal(
    <div className="ui-edpreview" role="dialog" aria-label={t("editor.pair.review.preview")}>
      <div className="ui-edpreview-head">
        <span className="t">
          ⊞ {t("editor.pair.review.preview")}
          <span className="mono">
            {" "}
            {changeHunks.length} hunk{changeHunks.length === 1 ? "" : "s"}
          </span>
        </span>
        <button type="button" className="x" onClick={onClose} aria-label={t("common.close")}>
          ✕
        </button>
      </div>
      <div className="ui-edpreview-body" ref={bodyRef}>
        {groups.map((g, gi) => {
          if (g.type === "same") {
            // Context: show at most the first 3 unchanged lines between hunks.
            return (
              <div key={gi} className="ctx">
                {g.origLines.slice(0, 3).map((l, li) => (
                  <div key={li} className="line ctx-line">
                    {l || " "}
                  </div>
                ))}
                {g.origLines.length > 3 ? <div className="line ctx-line ellip">⋯</div> : null}
              </div>
            );
          }
          hi += 1;
          const isCur = hi === currentHunk;
          return (
            <div
              key={gi}
              ref={(el) => {
                hunkRefs.current[hi] = el;
              }}
              className={`hunk${isCur ? " cur" : ""}`}
            >
              <div className="hunk-label">
                hunk {hi + 1} · −{g.origLines.length} +{g.newLines.length}
              </div>
              {g.origLines.map((l, li) => (
                <div key={`d${li}`} className="line del">
                  − {l || " "}
                </div>
              ))}
              {g.newLines.map((l, li) => (
                <div key={`a${li}`} className="line add">
                  + {l || " "}
                </div>
              ))}
            </div>
          );
        })}
      </div>
      <div className="ui-edpreview-foot">{t("editor.pair.review.previewHint")}</div>
    </div>,
    document.body
  );
}
