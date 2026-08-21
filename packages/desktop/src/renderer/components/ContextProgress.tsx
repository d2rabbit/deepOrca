import { memo, type JSX } from "react";
import { useI18n } from "../i18n";
import { compactTokenThreshold, formatTokens } from "../lib/token-usage";

type Props = {
  /** Active session context tokens (the size that triggers compaction). */
  activeTokens: number;
  /** Current model — decides the compaction threshold. */
  model: string;
  /** User settings override for the threshold (tokens); undefined = model default. */
  thresholdOverride?: number;
  /** Whether the session is currently compacting. */
  compacting?: boolean;
};

/**
 * Animated gauge under the composer showing how full the active context is
 * relative to the model's automatic-compaction threshold. Plays a toylike
 * shimmer/flow effect while there's room, and escalates to a pulsing alert as
 * it nears the compaction threshold. Percentage keeps two decimals so the user
 * can watch it tick up smoothly rather than jumping in whole-point steps.
 */
export const ContextProgress = memo(function ContextProgress({
  activeTokens,
  model,
  thresholdOverride,
  compacting = false,
}: Props): JSX.Element | null {
  const { t } = useI18n();
  if (activeTokens <= 0 && !compacting) return null;

  const threshold = compactTokenThreshold(model, thresholdOverride);
  // Two-decimal precision — the bar creeps up visibly instead of lurching in
  // whole-percent jumps. Clamped for the fill width; the numeric readout can
  // exceed 100% so the user sees by how much they're over budget.
  const ratio = activeTokens / threshold;
  const pctRaw = ratio * 100;
  const pct = Math.min(100, pctRaw);
  const near = pctRaw >= 80;
  const critical = pctRaw >= 100;

  return (
    <div
      className={`ui-context-progress${critical ? " critical" : near ? " near" : ""}${compacting ? " compacting" : ""}`}
      title={`${formatTokens(activeTokens)} / ${formatTokens(threshold)}`}
    >
      <div className="ui-context-progress-head">
        <span className="ui-context-progress-label">
          {compacting ? t("context.compacting") : t("context.compaction")}
        </span>
        <span className="ui-context-progress-value">{pctRaw.toFixed(2)}%</span>
      </div>
      <div className="ui-context-progress-track">
        {/* 80% threshold tick — a faint marker where "near compaction" begins. */}
        <span className="ui-context-progress-tick" style={{ left: "80%" }} />
        <div
          className={`ui-context-progress-fill${critical ? " critical" : near ? " near" : ""}`}
          style={{ width: `${pct}%` }}
        >
          <span className="ui-context-progress-shine" />
        </div>
      </div>
    </div>
  );
});
