import type { MessageKey } from "../../i18n/messages";

/**
 * Progress i18n seam: core actions emit a stable machine code under
 * `data.code` (see core actions prototype.ts / design.ts); this maps the
 * known codes to localized labels and falls back to the raw English message
 * for anything unmapped. Keeps core UI-free while panels show native text.
 */
const PROGRESS_KEYS: Record<string, MessageKey> = {
  "prototype.spec.generating": "prototypeWorkspace.progressSpec",
  "prototype.spec.saved": "prototypeWorkspace.progressSpecSaved",
  // specs/prompt-doc-chain 交叉审查：PRD 深度门修复轮。
  "prototype.spec.repairing": "prototypeWorkspace.progressRepair",
  "prototype.materialize.repairing": "prototypeWorkspace.progressRepair",
  "prototype.revise.repairing": "prototypeWorkspace.progressRepair",
  // WP2.5:design 线也过修复环,同款进度文案。
  "design.materialize.repairing": "prototypeWorkspace.progressRepair",
  "design.revise.repairing": "prototypeWorkspace.progressRepair",
  // specs/prompt-doc-chain：提示词文档两级 stage。
  "prototype.pmdesign.generating": "prototypeWorkspace.progressPmDesign",
  "prototype.pmdesign.saved": "prototypeWorkspace.progressPmDesignSaved",
  "prototype.pmdesign.repairing": "prototypeWorkspace.progressRepair",
  "design.uidesign.generating": "designWorkspace.progressUiDesign",
  "design.uidesign.saved": "designWorkspace.progressUiDesignSaved",
  // specs/design-stage-gates：ui-design 修复轮 + arch 门修复轮 + 两级降级
  // （增强阶段 fail-open——OCR plan-failure 分层，降级也要让用户看见）。
  "design.uidesign.repairing": "prototypeWorkspace.progressRepair",
  "prototype.arch.repairing": "prototypeWorkspace.progressRepair",
  "prototype.materialize.degraded": "prototypeWorkspace.progressPmDesignDegraded",
  "design.uidesign.degraded": "designWorkspace.progressUiDesignDegraded",
  "prototype.materialize.generating": "prototypeWorkspace.progressMaterialize",
  "prototype.materialize.saved": "prototypeWorkspace.progressMaterializeSaved",
  "prototype.arch.generating": "prototypeWorkspace.progressArch",
  "prototype.arch.saved": "prototypeWorkspace.progressArchSaved",
  // Skip note rides the terminal saved line (writer no-clobber): label needs
  // the {file} param from event.data — see progressLabel's interpolation.
  "prototype.arch.anchorSkipped": "prototypeWorkspace.progressArchAnchorSkipped",
  "design.materialize.generating": "designWorkspace.progressGenerate",
  "design.materialize.saved": "designWorkspace.progressSaved",
  "design.tokens.extracting": "designWorkspace.progressTokensExtract",
  "design.tokens.rendering": "designWorkspace.progressTokensRender",
  "design.tokens.extracted": "designWorkspace.progressTokensDone",
  "design.drift.comparing": "designWorkspace.progressDriftCompare",
  "design.drift.detected": "designWorkspace.progressDriftDetected",
  "design.drift.clean": "designWorkspace.progressDriftDone",
};

export { PROGRESS_KEYS };

type ProgressEventLike = {
  message: string;
  percent?: number;
  data?: unknown;
};

/** True for the terminal marker the action runner stamps (raw "done"). */
export function isTerminalProgress(event: ProgressEventLike): boolean {
  return typeof event.data === "object" && event.data !== null && (event.data as { done?: unknown }).done === true;
}

/** Localized `${percent}% — label` for a progress event (raw message fallback).
 *
 * When the mapped label carries `{param}` placeholders (e.g. the anchor-skip
 * note's `{file}`), the event's string-valued `data` fields interpolate into
 * them — a plain-label registration can no longer silently drop the detail
 * a code was switched for (2026-09 iter-4 review F1). */
export function progressLabel(
  event: ProgressEventLike,
  translate: (key: MessageKey, params?: Record<string, string>) => string
): string {
  const data =
    typeof event.data === "object" && event.data !== null ? (event.data as Record<string, unknown>) : undefined;
  const code = typeof data?.code === "string" ? data.code : undefined;
  const key = typeof code === "string" ? PROGRESS_KEYS[code] : undefined;
  const params: Record<string, string> | undefined =
    key && data
      ? Object.fromEntries(
          Object.entries(data).filter((entry): entry is [string, string] => typeof entry[1] === "string")
        )
      : undefined;
  const label = key ? translate(key, params) : event.message;
  return event.percent != null ? `${event.percent}% — ${label}` : label;
}
