/**
 * DesignPreview — renders a .dd (OrcaDesign) document in an iframe.
 *
 * Parses the .dd YAML front-matter + HTML body, compiles to a self-contained
 * HTML string with design tokens + seed CSS + inlined Tailwind JIT, and
 * displays it in a sandboxed iframe via srcDoc.
 *
 * This is the DeepDesign equivalent of PrototypePanel (which handles A2UI /
 * OpenUI Lang prototypes). Used when the preview panel is in "design" mode.
 */

import { useMemo, type JSX } from "react";
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
};

export function DesignPreview({ ddContent }: Props): JSX.Element {
  const html = useMemo(() => {
    try {
      const doc = parseDdFile(ddContent);
      return compileDdToHtml(doc, tailwindScript || undefined);
    } catch {
      // If parsing fails, show the raw content in a <pre>.
      return `<!doctype html><html><body><pre style="padding:16px;font-family:monospace;font-size:12px;color:#f87171;white-space:pre-wrap;">Failed to parse .dd file:\n\n${ddContent.replace(/</g, "&lt;")}</pre></body></html>`;
    }
  }, [ddContent]);

  return (
    <div className="ui-design-preview" style={{ height: "100%", width: "100%" }}>
      <iframe
        srcDoc={html}
        title="DeepDesign Preview"
        sandbox="allow-scripts"
        style={{ width: "100%", height: "100%", border: "none", background: "#fff" }}
      />
    </div>
  );
}
