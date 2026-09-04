/**
 * LaneBadge — the read-only depth-lane mark on a session card (specs/depth-lane
 * X.1): express ⚡ (cool cyan) / deep ▤ (warm amber). Pure presentation of
 * `SessionEntry.lane`; it never participates in routing decisions.
 *
 * Design provenance: mmx design round 2026-09-04 (specs/depth-lane/designs/
 * lane-badge-reference.jpg) — solid fills, no frames, ≥1px features at 12px,
 * cool/warm pairing.
 */
import type { JSX } from "react";
import { useI18n } from "../i18n";
import { IconLaneDeep, IconLaneExpress } from "../ui/icons";

export function LaneBadge({ lane }: { lane?: "express" | "deep" }): JSX.Element | null {
  const { t } = useI18n();
  if (lane !== "express" && lane !== "deep") return null;
  const isDeep = lane === "deep";
  return (
    <span
      className={`ui-lane-badge ui-lane-badge--${lane}`}
      data-tip={t(isDeep ? "sidebar.laneDeepTip" : "sidebar.laneExpressTip")}
    >
      {isDeep ? <IconLaneDeep /> : <IconLaneExpress />}
      {t(isDeep ? "sidebar.laneDeep" : "sidebar.laneExpress")}
    </span>
  );
}
