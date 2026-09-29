/**
 * Scripted MoonViz engine seam for action tests (specs/moonviz-engine-
 * replacement) — no wasm, no worker: a canned envelope machine that answers
 * the wire protocol deterministically. Configure is process-global, so each
 * test file (one process per file in the repo runner) installs it once.
 *
 * Canonical bookkeeping: every accepted op appends an `<!-- op: … -->` marker
 * to the session's canonical echo, so assertions can pin WHICH ops the action
 * applied — the moonviz analog of the old "render_openui received exactly
 * this program" pins.
 */

import { configureMoonvizEngine, type MoonvizComponentInfo, type MoonvizEngineSeam } from "../common/moonviz-engine";

export interface MoonvizFixtureOptions {
  artboards?: Array<Record<string, unknown>>;
  flows?: Array<Record<string, unknown>>;
  lint?: Array<Record<string, unknown>>;
  critique?: Array<Record<string, unknown>>;
  nodes?: Array<Record<string, unknown>>;
  /** Op substrings that trigger a gate rejection (four-segment string). */
  rejectOpSubstrings?: string[];
  tapOk?: boolean;
  failValidate?: boolean;
}

export const MOCK_MOONVIZ_DOC = `---
moonviz:
  format: visual-document
  revision: 1
  entry: home
---

# mock

<!-- moonviz:artboard home -->
\`\`\`mbt
fn visual_home() -> @decl.Prototype {
  let page = @decl.prototype(name="home", width=390.0, height=844.0)
  page
}
\`\`\`
`;

export function installMoonvizFixture(options: MoonvizFixtureOptions = {}): {
  canonicalOf: (handle: number) => string | undefined;
} {
  const artboards = options.artboards ?? [{ id: "home" }];
  const handleSeq = { next: 1 };
  const canonicalByHandle = new Map<number, string>();
  const seam: MoonvizEngineSeam = {
    async call(method, params) {
      switch (method) {
        case "sessionOpen": {
          const handle = handleSeq.next++;
          canonicalByHandle.set(handle, String(params.mbt ?? ""));
          return handle;
        }
        case "sessionClose":
          return 1;
        case "sessionCount":
          return canonicalByHandle.size;
        case "sessionOpenProjectJson":
          return handleSeq.next++;
        case "sessionApplyAgent":
        case "sessionApplyHuman": {
          const op = String(params.op ?? "");
          if ((options.rejectOpSubstrings ?? []).some((needle) => op.includes(needle))) {
            return JSON.stringify({ ok: false, error: "mbt_gate_block:login:no_sibling_overlap:oob" });
          }
          const canonical = (canonicalByHandle.get(Number(params.handle)) ?? "") + `\n<!-- op: ${op} -->`;
          canonicalByHandle.set(Number(params.handle), canonical);
          return JSON.stringify({ ok: true, mbt: canonical });
        }
        case "sessionListArtboards":
          return JSON.stringify({ ok: true, data: artboards });
        case "sessionFlows":
          return JSON.stringify({ ok: true, data: options.flows ?? [] });
        case "sessionLint":
          return JSON.stringify({ ok: true, data: options.lint ?? [] });
        case "sessionCritique":
          return JSON.stringify({ ok: true, data: options.critique ?? [] });
        case "sessionQueryNodes":
          return JSON.stringify({ ok: true, data: options.nodes ?? [] });
        case "sessionTap": {
          if (options.tapOk === false) {
            return JSON.stringify({ ok: false, error: "mbt_tap_miss:no_node" });
          }
          return JSON.stringify({ ok: true, mbt: canonicalByHandle.get(Number(params.handle)) });
        }
        case "sessionExportSvg":
          return JSON.stringify({
            ok: true,
            data: { svg: `<svg data-artboard="${String(params.artboard)}"></svg>` },
          });
        case "sessionSave":
          return JSON.stringify({
            ok: true,
            data: JSON.stringify({ studio: canonicalByHandle.get(Number(params.handle)) ?? "" }),
          });
        case "validateMbt":
          return options.failValidate
            ? JSON.stringify({ ok: false, error: "mbt_no_visual_blocks" })
            : JSON.stringify({ ok: true, revision: 1 });
        case "renderMbt":
          return JSON.stringify({
            ok: true,
            entry: artboards[0]?.id,
            flows: options.flows ?? [],
            artboards: artboards.map((board) => ({ ...board, svg: `<svg data-board="${board.id}"></svg>` })),
          });
        case "exportHtml":
          return JSON.stringify({ ok: true, html: "<!DOCTYPE html><html><body>preview</body></html>" });
        case "listTemplates":
          return JSON.stringify([{ id: "login" }, { id: "dashboard" }]);
        case "listComponents":
          return JSON.stringify([{ id: "button", name: "Button", variants: ["primary"] }]);
        default:
          throw new Error(`moonviz fixture: no responder for ${method}`);
      }
    },
  };
  const vocabulary: MoonvizComponentInfo[] = [{ id: "button", name: "Button", variants: ["primary"] }];
  configureMoonvizEngine({ seam, version: "0.1.7-test", componentVocabulary: vocabulary });
  return { canonicalOf: (handle: number) => canonicalByHandle.get(handle) };
}
