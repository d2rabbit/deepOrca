import { useEffect, useState, type JSX } from "react";
import type { WorkspaceTokenSummary } from "../../shared/ipc";
import { api } from "../api";
import { useI18n } from "../i18n";
import { formatExact, formatTokens, formatUsd } from "../lib/token-usage";

type Props = {
  /** Registered workspace root the summary is scoped to. */
  root: string;
  /** Bump to refetch (e.g. when the session list changes). */
  refreshKey?: string | number;
};

/**
 * Inline left-panel token analytics (item 4). P2 (2026-09): consumes the
 * whole-workspace summary IPC instead of aggregating session entries in the
 * renderer — one source for every surface, exact ledger-based time windows,
 * estimated cost. All numbers are LOCAL counts (the engine's accounting
 * source since the local-accounting rework), so they carry a "≈" character.
 */
export function TokenStatsPanel({ root, refreshKey }: Props): JSX.Element {
  const { t } = useI18n();
  const [summary, setSummary] = useState<WorkspaceTokenSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .tokensSummary(root)
      .then((next) => {
        if (!cancelled) setSummary(next);
      })
      .catch(() => {
        // unreadable store — keep the previous snapshot
      });
    return () => {
      cancelled = true;
    };
  }, [root, refreshKey]);

  if (!summary) {
    return (
      <div className="ui-side-panel">
        <div className="ui-side-panel-head">
          <span>{t("tokens.title")}</span>
        </div>
        <div className="ui-side-panel-body">
          <div className="ui-side-panel-empty">{t("common.loading")}</div>
        </div>
      </div>
    );
  }

  const modelMax = Math.max(1, ...Object.values(summary.perModel).map((m) => m.total));
  const timeMax = Math.max(
    1,
    summary.windows.last5h.total,
    summary.windows.today.total,
    summary.windows.thisWeek.total
  );
  // Cache split is provider-side knowledge; local counting cannot see it.
  // Legacy (pre-rework) entries still carry cache fields, so show it when the
  // data has any and "—" otherwise.
  const cacheKnown = summary.cacheReadTokens > 0 && summary.promptTokens > 0;
  const cachePct = cacheKnown ? Math.round((summary.cacheReadTokens / summary.promptTokens) * 100) : null;

  const timeRows = [
    { label: t("tokens.last5h"), value: summary.windows.last5h.total },
    { label: t("tokens.today"), value: summary.windows.today.total },
    { label: t("tokens.thisWeek"), value: summary.windows.thisWeek.total },
  ];

  return (
    <div className="ui-side-panel">
      <div className="ui-side-panel-head">
        <span>{t("tokens.title")}</span>
      </div>
      <div className="ui-side-panel-body ui-token-stats">
        <div className="ui-token-hero">
          <div className="ui-token-hero-value" title={formatExact(summary.totalTokens)}>
            ≈ {formatTokens(summary.totalTokens)}
          </div>
          <div className="ui-token-hero-label">{t("tokens.currentWorkspace")}</div>
          <div className="ui-token-hero-sub">
            {t("tokens.sessionsCounted", { n: summary.sessions })} ·{" "}
            {cachePct != null ? t("tokens.cacheHitRate", { n: cachePct }) : t("tokens.cacheUnavailable")}
          </div>
          {summary.costUsd != null && (
            <div className="ui-token-hero-sub">
              {t("tokens.costEstimate")} ≈ {formatUsd(summary.costUsd)}
            </div>
          )}
        </div>

        <div className="ui-token-metrics">
          <div className="ui-token-metric">
            <span title={formatExact(summary.promptTokens)}>{formatTokens(summary.promptTokens)}</span>
            <label>{t("tokens.prompt")}</label>
          </div>
          <div className="ui-token-metric">
            <span title={formatExact(summary.completionTokens)}>{formatTokens(summary.completionTokens)}</span>
            <label>{t("tokens.completion")}</label>
          </div>
          <div className="ui-token-metric">
            <span title={formatExact(summary.requests)}>{summary.requests}</span>
            <label>{t("tokens.requests")}</label>
          </div>
        </div>

        <div className="ui-usage-section-title">
          {t("tokens.byTime")}
          {summary.windowsApproximate ? " ≈" : ""}
        </div>
        <div className="ui-token-bars">
          {timeRows.map((row) => (
            <div key={row.label} className="ui-token-bar-row">
              <span className="ui-token-bar-label">{row.label}</span>
              <span className="ui-token-bar-track">
                <span className="ui-token-bar-fill" style={{ width: `${(row.value / timeMax) * 100}%` }} />
              </span>
              <span className="ui-token-bar-value">{formatTokens(row.value)}</span>
            </div>
          ))}
        </div>

        <div className="ui-usage-section-title">{t("tokens.perModel")}</div>
        {Object.keys(summary.perModel).length === 0 ? (
          <div className="ui-side-panel-empty">{t("tokens.emptyHint")}</div>
        ) : (
          <div className="ui-token-bars">
            {Object.entries(summary.perModel).map(([model, m]) => (
              <div key={model} className="ui-token-bar-row" title={formatExact(m.total)}>
                <span className="ui-token-bar-label" title={model}>
                  {model}
                </span>
                <span className="ui-token-bar-track">
                  <span className="ui-token-bar-fill model" style={{ width: `${(m.total / modelMax) * 100}%` }} />
                </span>
                <span className="ui-token-bar-value">{formatTokens(m.total)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
