import { useMemo, type JSX } from "react";
import type { PlanImplementationChoice } from "../lib/plan";
import { extractPlanSteps } from "../lib/plan";
import { useI18n, type MessageKey } from "../i18n";
import { Card, CardHeader } from "../ui/index";

type Props = {
  onSelect: (choice: PlanImplementationChoice) => void;
  planText?: string | null;
};

const CHOICES: Array<{ value: PlanImplementationChoice; labelKey: MessageKey; descKey: MessageKey }> = [
  { value: "implement", labelKey: "plan.implement.label", descKey: "plan.implement.desc" },
  { value: "stay", labelKey: "plan.stay.label", descKey: "plan.stay.desc" },
  { value: "default", labelKey: "plan.default.label", descKey: "plan.default.desc" },
];

/** Shown once the assistant emits a complete <proposed_plan> while in Plan mode. */
export function PlanCard({ onSelect, planText }: Props): JSX.Element {
  const { t } = useI18n();
  const steps = useMemo(() => (planText ? extractPlanSteps(planText) : []), [planText]);
  const topLevelCount = steps.filter((s) => s.level === 0).length;

  return (
    <Card warn>
      <CardHeader>
        {t("plan.ready")}
        {topLevelCount > 0 ? (
          <span className="ui-plan-card-count">{t("plan.stepsCount", { count: topLevelCount })}</span>
        ) : null}
      </CardHeader>
      {/* Plan step preview — top-level numbering is its own counter so
          interleaved sub-steps don't create gaps (1, ·, 3 …). */}
      {steps.length > 0 ? (
        <div className="ui-plan-card-steps">
          {(() => {
            let topLevelIndex = 0;
            return steps.map((step, i) => {
              if (step.level === 0) topLevelIndex += 1;
              return (
                <div key={i} className={`ui-plan-card-step${step.level > 0 ? " sub" : ""}`}>
                  <span className="ui-plan-card-step-num">{step.level === 0 ? topLevelIndex : "·"}</span>
                  <span className="ui-plan-card-step-text">{step.text}</span>
                </div>
              );
            });
          })()}
        </div>
      ) : planText ? (
        <div className="ui-plan-card-raw">
          {planText.slice(0, 500)}
          {planText.length > 500 ? "…" : ""}
        </div>
      ) : null}
      <div style={{ color: "var(--ui-text-dim)", fontSize: 12.5 }}>{t("plan.chooseNext")}</div>
      <div className="ui-opt-row">
        {CHOICES.map((choice) => (
          <button key={choice.value} className="ui-opt" onClick={() => onSelect(choice.value)}>
            {t(choice.labelKey)}
            <span className="ui-opt-desc">{t(choice.descKey)}</span>
          </button>
        ))}
      </div>
    </Card>
  );
}
