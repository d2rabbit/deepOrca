/**
 * DesignPreview — renders a .dd (OrcaDesign) document in an iframe.
 *
 * Parses the .dd YAML front-matter + HTML body, compiles to a self-contained
 * HTML string with design tokens + seed CSS + inlined Tailwind JIT, and
 * displays it in a sandboxed iframe via srcDoc.
 *
 * This is the UI-Design counterpart of PrototypePanel (which handles PM-Design
 * OpenUI Lang prototypes). Used when the preview panel is in "design" mode.
 * Includes an inline iteration composer + PDF export button.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";
import { parseDdFile } from "../dd/parser";
import { compileDdToHtml } from "../dd/compiler";
import { useI18n } from "../i18n";
// The vendored Tailwind JIT script — generated at build time by build.mjs
// under src/generated/ (gitignored) as a TypeScript source file exporting the
// raw script string. If the vendor file is missing (offline), this is an empty
// string — designs still render with seed CSS, just without Tailwind utility
// classes. Run `npm run desktop:build` (or `node packages/desktop/build.mjs`)
// to regenerate before typechecking a clean checkout.
import tailwindScript from "../../generated/tailwind-script";

export type DesignPreviewSelection = {
  nodePath: string;
  bounds: { x: number; y: number; width: number; height: number };
};

type Props = {
  /** The raw .dd file content (YAML front-matter + HTML body). */
  ddContent: string;
  /** Optional: called when the user submits an iteration prompt from the composer. */
  onIterate?: (prompt: string) => void;
  /** Optional: iframe title for a11y. */
  title?: string;
  onSelectionChange?: (selection: DesignPreviewSelection | null) => void;
  selectionEnabled?: boolean;
  hideToolbar?: boolean;
  focusNodePath?: string;
};

type SelectionBridgeMessage =
  | { source: "deeporca-dd-selection"; type: "clear" }
  | {
      source: "deeporca-dd-selection";
      type: "select";
      nodePath: string;
      bounds: { x: number; y: number; width: number; height: number };
    };

const SELECTION_BRIDGE = `<script>(()=>{const S="deeporca-dd-selection";let selected=null;const pathOf=(el)=>{const id=el.getAttribute("data-dd-id");if(id)return '//section[@data-dd-id="'+id+'"]';const nodes=[];for(let cur=el;cur&&cur!==document.body;cur=cur.parentElement){const tag=cur.tagName.toLowerCase();const peers=cur.parentElement?[...cur.parentElement.children].filter(x=>x.tagName===cur.tagName):[];nodes.unshift(tag+'['+(peers.indexOf(cur)+1)+']')}return '//'+nodes.join('/')};const emit=()=>{if(!selected)return;const r=selected.getBoundingClientRect();parent.postMessage({source:S,type:"select",nodePath:pathOf(selected),bounds:{x:r.left,y:r.top,width:r.width,height:r.height}},"*")};document.addEventListener("click",e=>{const el=e.target.closest("[data-dd-id]");if(!el){selected=null;parent.postMessage({source:S,type:"clear"},"*");return}e.preventDefault();e.stopPropagation();selected=el;emit()},true);document.addEventListener("keydown",e=>{if(e.key==="Escape"){selected=null;parent.postMessage({source:S,type:"clear"},"*")}});addEventListener("scroll",emit,true);addEventListener("message",e=>{const d=e.data;if(!d||d.source!==S||d.type!=="focus"||typeof d.nodePath!=="string")return;const m=/data-dd-id=\\?"([^"\\]+)\\?"/.exec(d.nodePath);if(!m)return;const el=[...document.querySelectorAll("[data-dd-id]")].find(x=>x.getAttribute("data-dd-id")===m[1]);if(!el)return;el.scrollIntoView({block:"center"});el.animate([{outline:"3px solid currentColor"},{outline:"0 solid transparent"}],{duration:1400})})})();</script>`;

function withSelectionBridge(html: string, enabled: boolean): string {
  if (!enabled) return html;
  const index = html.toLowerCase().lastIndexOf("</body>");
  return index >= 0 ? `${html.slice(0, index)}${SELECTION_BRIDGE}${html.slice(index)}` : `${html}${SELECTION_BRIDGE}`;
}

function isSelectionBridgeMessage(value: unknown): value is SelectionBridgeMessage {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SelectionBridgeMessage>;
  if (candidate.source !== "deeporca-dd-selection") return false;
  if (candidate.type === "clear") return true;
  if (candidate.type !== "select" || typeof candidate.nodePath !== "string") return false;
  const bounds = candidate.bounds;
  return Boolean(
    bounds &&
    typeof bounds.x === "number" &&
    typeof bounds.y === "number" &&
    typeof bounds.width === "number" &&
    typeof bounds.height === "number"
  );
}

export function DesignPreview({
  ddContent,
  onIterate,
  title,
  onSelectionChange,
  selectionEnabled = false,
  hideToolbar = false,
  focusNodePath,
}: Props): JSX.Element {
  const { t } = useI18n();
  const [iteration, setIteration] = useState("");
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const html = useMemo(() => {
    try {
      const doc = parseDdFile(ddContent);
      return withSelectionBridge(compileDdToHtml(doc, tailwindScript || undefined), selectionEnabled);
    } catch {
      // If parsing fails, show the raw content in a <pre>.
      return `<!doctype html><html><body><pre style="padding:16px;font-family:monospace;font-size:12px;color:#f87171;white-space:pre-wrap;">Failed to parse .dd file:\n\n${ddContent.replace(/</g, "&lt;")}</pre></body></html>`;
    }
  }, [ddContent, selectionEnabled]);

  const handleBridgeMessage = useCallback(
    (event: MessageEvent<unknown>) => {
      const frameWindow = iframeRef.current?.contentWindow;
      if (!selectionEnabled || !frameWindow || event.source !== frameWindow || !isSelectionBridgeMessage(event.data))
        return;
      if (event.data.type === "clear") {
        onSelectionChange?.(null);
        return;
      }
      const frameBounds = iframeRef.current?.getBoundingClientRect();
      onSelectionChange?.({
        nodePath: event.data.nodePath,
        bounds: {
          x: (frameBounds?.left ?? 0) + event.data.bounds.x,
          y: (frameBounds?.top ?? 0) + event.data.bounds.y,
          width: event.data.bounds.width,
          height: event.data.bounds.height,
        },
      });
    },
    [onSelectionChange, selectionEnabled]
  );

  useEffect(() => {
    window.addEventListener("message", handleBridgeMessage);
    return () => window.removeEventListener("message", handleBridgeMessage);
  }, [handleBridgeMessage]);

  useEffect(() => {
    if (!focusNodePath || !iframeRef.current?.contentWindow) return;
    iframeRef.current.contentWindow.postMessage(
      { source: "deeporca-dd-selection", type: "focus", nodePath: focusNodePath },
      "*"
    );
  }, [focusNodePath]);

  const handleIterate = () => {
    const prompt = iteration.trim();
    if (!prompt || !onIterate) return;
    onIterate(
      `Update the current .dd design: ${prompt}. Use the update_design tool with section-level patches (send only the changed sections) when possible.`
    );
    setIteration("");
  };

  const handleExportPdf = () => {
    try {
      iframeRef.current?.contentWindow?.print();
    } catch {
      // Cross-origin or not loaded — ignore.
    }
  };

  return (
    <div
      className="ui-design-preview"
      style={{ height: "100%", width: "100%", display: "flex", flexDirection: "column" }}
    >
      <iframe
        ref={iframeRef}
        srcDoc={html}
        title={title ?? t("designWorkspace.previewTitle")}
        sandbox="allow-scripts allow-modals"
        style={{ width: "100%", flex: 1, border: "none", background: "#fff" }}
      />
      {!hideToolbar ? (
        <div className="ui-design-preview-toolbar">
          {onIterate ? (
            <>
              <input
                type="text"
                value={iteration}
                placeholder={t("designWorkspace.agentPrompt")}
                onChange={(e) => setIteration(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleIterate();
                }}
              />
              <button type="button" onClick={handleIterate} disabled={!iteration.trim()}>
                {t("common.apply")}
              </button>
            </>
          ) : (
            <div className="ui-design-preview-spacer" />
          )}
          <button type="button" onClick={handleExportPdf} title={t("designWorkspace.exportPdf")}>
            {t("designWorkspace.exportPdf")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
