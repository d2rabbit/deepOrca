/**
 * DepthLaneProgressStrip — the live stage indicator for a running deep lane
 * (specs/depth-lane X.3). Self-contained: subscribes to onDepthLaneProgress,
 * keeps the LATEST stage for the given sessionId, renders a slim strip above
 * the message list, and clears itself on `done` (or when the lane goes quiet
 * — the done event is best-effort, same as the core seam).
 *
 * Pure presentation: it never routes, never blocks, and renders NOTHING for
 * express-lane sessions (no events ever fire for them).
 */
import { useEffect, useState } from "react";
import type { JSX } from "react";
import { api } from "../api";
import { useI18n } from "../i18n";
import type { DepthLaneProgressEvent } from "../../shared/ipc";
import { IconLaneDeep } from "../ui/icons";

type StageKey = DepthLaneProgressEvent["stage"];

const STAGE_LABEL_KEY: Record<StageKey, string> = {
  s1: "depth.stageS1",
  "s1.5": "depth.stageS15",
  s2: "depth.stageS2",
  s3: "depth.stageS3",
  s4: "depth.stageS4",
  s5: "depth.stageS5",
  done: "depth.stageDone",
};

/** Auto-hide grace after done (ms) — lets the reader see the final blink. */
const DONE_LINGER_MS = 4000;

export function DepthLaneProgressStrip({ sessionId }: { sessionId: string | null }): JSX.Element | null {
  const { t } = useI18n();
  const [latest, setLatest] = useState<DepthLaneProgressEvent | null>(null);

  useEffect(() => {
    setLatest(null);
    if (!sessionId) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = api.onDepthLaneProgress((event) => {
      if (event.sessionId !== sessionId) return;
      setLatest(event);
      if (event.done) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => setLatest(null), DONE_LINGER_MS);
      }
    });
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  }, [sessionId]);

  if (!latest || latest.done) return null;
  const label = t(STAGE_LABEL_KEY[latest.stage] as never, {
    round: latest.round ?? 0,
    total: latest.totalRounds ?? 0,
  });
  const roundSuffix =
    latest.round && latest.totalRounds
      ? ` · ${latest.round}/${latest.totalRounds}`
      : latest.detail
        ? ` · ${latest.detail}`
        : "";
  return (
    <div className="ui-depth-progress" role="status">
      <span className="ui-lane-badge ui-lane-badge--deep">
        <IconLaneDeep />
        {t("sidebar.laneDeep")}
      </span>
      <span className="ui-depth-progress-stage">
        {label}
        {roundSuffix}
      </span>
    </div>
  );
}
