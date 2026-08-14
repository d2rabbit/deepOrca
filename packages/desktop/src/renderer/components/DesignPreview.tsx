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

import { useMemo, useRef, useState, type JSX } from "react";
import { parseDdFile } from "../dd/parser";
import { compileDdToHtml } from "../dd/compiler";
// The vendored Tailwind JIT script — generated at build time by build.mjs
// under src/generated/ (gitignored) as a TypeScript source file exporting the
// raw script string. If the vendor file is missing (offline), this is an empty
// string — designs still render with seed CSS, just without Tailwind utility
// classes. Run `npm run desktop:build` (or `node packages/desktop/build.mjs`)
// to regenerate before typechecking a clean checkout.
import tailwindScript from "../../generated/tailwind-script";

type Props = {
  /** The raw .dd file content (YAML front-matter + HTML body). */
  ddContent: string;
  /** Optional: called when the user submits an iteration prompt from the composer. */
  onIterate?: (prompt: string) => void;
  /** Optional: iframe title for a11y. */
  title?: string;
};

export function DesignPreview({ ddContent, onIterate, title }: Props): JSX.Element {
  const [iteration, setIteration] = useState("");
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const html = useMemo(() => {
    try {
      const doc = parseDdFile(ddContent);
      return compileDdToHtml(doc, tailwindScript || undefined);
    } catch {
      // If parsing fails, show the raw content in a <pre>.
      return `<!doctype html><html><body><pre style="padding:16px;font-family:monospace;font-size:12px;color:#f87171;white-space:pre-wrap;">Failed to parse .dd file:\n\n${ddContent.replace(/</g, "&lt;")}</pre></body></html>`;
    }
  }, [ddContent]);

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
        title={title ?? "DeepDesign Preview"}
        sandbox="allow-scripts allow-modals"
        style={{ width: "100%", flex: 1, border: "none", background: "#fff" }}
      />
      <div style={{ display: "flex", gap: 8, padding: "8px 12px", borderTop: "1px solid var(--ui-border-soft, #333)" }}>
        {onIterate ? (
          <>
            <input
              type="text"
              value={iteration}
              placeholder="描述要修改的地方…"
              onChange={(e) => setIteration(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleIterate();
              }}
              style={{
                flex: 1,
                padding: "6px 10px",
                fontSize: 13,
                background: "var(--ui-input-bg, transparent)",
                color: "var(--ui-text, inherit)",
                border: "1px solid var(--ui-border-soft, #444)",
                borderRadius: 6,
                outline: "none",
              }}
            />
            <button
              type="button"
              onClick={handleIterate}
              disabled={!iteration.trim()}
              style={{
                padding: "6px 14px",
                fontSize: 13,
                background: "var(--ui-accent, #3b82f6)",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                cursor: iteration.trim() ? "pointer" : "default",
                opacity: iteration.trim() ? 1 : 0.5,
              }}
            >
              迭代
            </button>
          </>
        ) : (
          <div style={{ flex: 1 }} />
        )}
        <button
          type="button"
          onClick={handleExportPdf}
          title="导出 PDF"
          style={{
            padding: "6px 12px",
            fontSize: 13,
            background: "transparent",
            color: "var(--ui-text-dim, #888)",
            border: "1px solid var(--ui-border-soft, #444)",
            borderRadius: 6,
            cursor: "pointer",
          }}
        >
          ⤓ PDF
        </button>
      </div>
    </div>
  );
}
