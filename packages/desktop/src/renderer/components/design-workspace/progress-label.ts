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
  "prototype.pddesign.generating": "prototypeWorkspace.progressPdDesign",
  "prototype.pddesign.saved": "prototypeWorkspace.progressPdDesignSaved",
  "prototype.pddesign.repairing": "prototypeWorkspace.progressRepair",
  "design.uidesign.generating": "designWorkspace.progressUiDesign",
  "design.uidesign.saved": "designWorkspace.progressUiDesignSaved",
  "prototype.materialize.generating": "prototypeWorkspace.progressMaterialize",
  "prototype.materialize.saved": "prototypeWorkspace.progressMaterializeSaved",
  "prototype.arch.generating": "prototypeWorkspace.progressArch",
  "prototype.arch.saved": "prototypeWorkspace.progressArchSaved",
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

/** Localized `${percent}% — label` for a progress event (raw message fallback). */
export function progressLabel(event: ProgressEventLike, translate: (key: MessageKey) => string): string {
  const code =
    typeof event.data === "object" && event.data !== null && "code" in event.data
      ? (event.data as { code?: unknown }).code
      : undefined;
  const key = typeof code === "string" ? PROGRESS_KEYS[code] : undefined;
  const label = key ? translate(key) : event.message;
  return event.percent != null ? `${event.percent}% — ${label}` : label;
}
