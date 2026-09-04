/**
 * LaneObservationSection — the read-only lane-rate display in the settings
 * panel (specs/depth-lane P2.3 X-面收尾). Fetches `laneRates(root)` once on
 * mount (root-pinned IPC), renders express/deep session counts, the two
 * feedback rates and the autoTune preview. Pure observation — no controls,
 * nothing here can change the threshold.
 */
import { useEffect, useState } from "react";
import type { JSX } from "react";
import { api } from "../api";
import { useI18n } from "../i18n";
import type { LaneRatesReport } from "../../shared/ipc";

function pct(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}

export function LaneObservationSection({ root }: { root: string }): JSX.Element {
  const { t } = useI18n();
  const [report, setReport] = useState<LaneRatesReport | null | undefined>(undefined); // undefined = loading

  useEffect(() => {
    let alive = true;
    if (!root) return;
    void api
      .laneRates(root)
      .then((r) => {
        if (alive) setReport(r);
      })
      .catch(() => {
        if (alive) setReport(null);
      });
    return () => {
      alive = false;
    };
  }, [root]);

  const empty = report === null || (report && report.expressSessions + report.deepSessions === 0);

  return (
    <section className="ui-settings-section">
      <div className="ui-settings-section-title">{t("settings.lane.title")}</div>
      {report === undefined ? (
        <div className="ui-lane-obs-loading">{t("settings.lane.loading")}</div>
      ) : empty ? (
        <div className="ui-lane-obs-empty">{t("settings.lane.empty")}</div>
      ) : (
        <div className="ui-lane-obs-grid">
          <div>
            <span className="ui-lane-badge ui-lane-badge--express">{t("sidebar.laneExpress")}</span>
            <span className="ui-lane-obs-value">{report.expressSessions}</span>
            <span className="ui-lane-obs-sub">
              {t("settings.lane.followUp")} {pct(report.expressFollowUpRate)}（{report.samples.followUps}）
            </span>
          </div>
          <div>
            <span className="ui-lane-badge ui-lane-badge--deep">{t("sidebar.laneDeep")}</span>
            <span className="ui-lane-obs-value">{report.deepSessions}</span>
            <span className="ui-lane-obs-sub">
              {t("settings.lane.negative")} {pct(report.deepNegativeFeedbackRate)}（{report.samples.negatives}）
            </span>
          </div>
          <div className="ui-lane-obs-note">
            {t("settings.lane.note")}
            {report.retroProxied > 0 ? ` · L1×${report.retroProxied}` : ""}
          </div>
        </div>
      )}
    </section>
  );
}
