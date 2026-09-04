import { useState, type JSX } from "react";
import { useI18n } from "../i18n";
import { IconBolt, IconCheck, IconChevronDown } from "../ui/index";

type Props = {
  /** Current plan checklist lines (latest UpdatePlan state). */
  lines: string[];
  done: number;
  total: number;
};

/** 钉住计划条 — sticky execution progress for the live plan
 *  (designs/chat-redesign V4): 段点 + 进度 + N/M 步，点击展开完整清单。
 *  Sits above the conversation scroll inside the chat column. */
export function PinnedPlan({ lines, done, total }: Props): JSX.Element {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="ui-pinned-plan">
      <button type="button" className="bar" onClick={() => setOpen((v) => !v)}>
        <span className="ic">
          <IconBolt />
        </span>
        <span className="label">{t("plan.pinnedTitle")}</span>
        <span className="pbar">
          <i style={{ width: `${pct}%` }} />
        </span>
        <span className="pct">
          {done}/{total}
        </span>
        <span className={`chev${open ? " open" : ""}`}>
          <IconChevronDown />
        </span>
      </button>
      {open ? (
        <div className="panel">
          {lines.map((line, i) => {
            const checked = /^\s*[-*]\s*\[x\]/i.test(line);
            const text = line.replace(/^\s*[-*]\s*\[[ xX]\]\s*/, "");
            const sub = /^\s{2,}/.test(line);
            return (
              <div key={i} className={`pp-step${checked ? " done" : ""}${sub ? " sub" : ""}`}>
                <span className="box">{checked ? <IconCheck /> : null}</span>
                <span className="text">{text}</span>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
