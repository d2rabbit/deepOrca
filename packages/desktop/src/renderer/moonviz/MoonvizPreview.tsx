import { useMemo } from "react";
import { useI18n } from "../i18n";

/**
 * MoonViz prototype preview (specs/moonviz-engine-replacement T2.2) — the
 * exported interactive HTML (engine `export_html`) in a sandboxed iframe.
 *
 * Sandbox discipline (按不受信内容对待): `allow-scripts allow-modals` WITHOUT
 * `allow-same-origin` — the preview gets a unique opaque origin, so even a
 * hostile document cannot touch app storage or the parent DOM. External
 * network references are already excluded by the export (P0 battery T0.9).
 *
 * The canonical `.mbt.md` document is the authority; when the preview cache
 * is missing (engine unavailable at save time), the fallback states exactly
 * that instead of pretending.
 */

export interface MoonvizPreviewProps {
  /** Cached interactive HTML (suite dir `prototype.html`). */
  previewHtml?: string | null;
  /** Canonical document — the authority the preview was exported from. */
  moonvizDoc?: string | null;
  title?: string;
}

function artboardCount(doc: string): number {
  return doc.split("moonviz:artboard").length - 1;
}

export function MoonvizPreview({ previewHtml, moonvizDoc, title }: MoonvizPreviewProps) {
  const { t } = useI18n();
  const doc = moonvizDoc ?? "";
  const boards = useMemo(() => artboardCount(doc), [doc]);
  const hasPreview = Boolean(previewHtml && previewHtml.trim());

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="moonviz-preview">
      <div className="flex items-center justify-between px-3 py-1.5 text-xs opacity-70">
        <span className="truncate">{title ?? "MoonViz"}</span>
        <span>
          {boards} {t("moonvizPreview.artboards")}
        </span>
      </div>
      {hasPreview ? (
        <iframe
          className="min-h-0 w-full flex-1 border-0 bg-white"
          srcDoc={previewHtml!}
          sandbox="allow-scripts allow-modals"
          title={title ?? "MoonViz preview"}
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center opacity-80">
          <p className="text-[13px] font-medium">{t("moonvizPreview.missing")}</p>
          <p className="max-w-[420px] text-[11px] leading-5">{t("moonvizPreview.missingHint")}</p>
          {doc ? (
            <pre className="mt-2 max-h-[40%] max-w-[560px] overflow-auto rounded-lg border p-3 text-left text-[11px] leading-5">
              {doc.slice(0, 2000)}
              {doc.length > 2000 ? "\n…" : ""}
            </pre>
          ) : null}
        </div>
      )}
    </div>
  );
}
