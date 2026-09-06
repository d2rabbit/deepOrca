// CM6 language mapping for the editor workspace (specs/editor-copilot A2).
// Replaces monaco-loader's `languageForFile` for the CodeMirror 6 kernel:
// extensions with an installed @codemirror/lang-* package get a full Lezer
// grammar; the rest fall back to @codemirror/legacy-modes StreamLanguage
// tokenizers (visual draft parity — Monaco shipped basic tokenizers for
// swift/kotlin/c-family/go/rust and losing them made those files monochrome).
// Everything unknown degrades to plain text (fail-open — the LSP relay in
// specs/editor-copilot §4 supplies language INTELLIGENCE independently of
// highlighting).

import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { StreamLanguage } from "@codemirror/language";
import { c, cpp, csharp, java, kotlin } from "@codemirror/legacy-modes/mode/clike";
import { go } from "@codemirror/legacy-modes/mode/go";
import { lua } from "@codemirror/legacy-modes/mode/lua";
import { python } from "@codemirror/legacy-modes/mode/python";
import { ruby } from "@codemirror/legacy-modes/mode/ruby";
import { rust } from "@codemirror/legacy-modes/mode/rust";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { standardSQL } from "@codemirror/legacy-modes/mode/sql";
import { swift } from "@codemirror/legacy-modes/mode/swift";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { yaml } from "@codemirror/legacy-modes/mode/yaml";
import type { Extension } from "@codemirror/state";

/** CM6 syntax extension for a file path, or null for plain text. */
export function cm6LanguageForFile(file: string): Extension | null {
  const ext = (file.split(".").pop() ?? "").toLowerCase();
  switch (ext) {
    case "ts":
    case "mts":
    case "cts":
      return javascript({ typescript: true });
    case "tsx":
      return javascript({ typescript: true, jsx: true });
    case "js":
    case "mjs":
    case "cjs":
      return javascript();
    case "jsx":
      return javascript({ jsx: true });
    case "json":
      return json();
    case "css":
      return css();
    case "scss":
    case "less":
      // No dedicated SCSS/LESS parser installed — base CSS highlighting is a
      // close superset for our purposes (P2 can add @codemirror/lang-sass).
      return css();
    case "html":
    case "htm":
    case "vue":
      return html();
    case "svg":
    case "xml":
      return html();
    case "md":
    case "markdown":
      return markdown();
    // ── StreamLanguage fallbacks (legacy tokenizers, highlighting only) ──
    case "swift":
      return StreamLanguage.define(swift);
    case "kt":
    case "kts":
      return StreamLanguage.define(kotlin);
    case "java":
      return StreamLanguage.define(java);
    case "c":
    case "h":
      return StreamLanguage.define(c);
    case "cc":
    case "cpp":
    case "cxx":
    case "hpp":
      return StreamLanguage.define(cpp);
    case "cs":
      return StreamLanguage.define(csharp);
    case "go":
      return StreamLanguage.define(go);
    case "rs":
      return StreamLanguage.define(rust);
    case "py":
    case "pyi":
      return StreamLanguage.define(python);
    case "rb":
      return StreamLanguage.define(ruby);
    case "sh":
    case "bash":
    case "zsh":
      return StreamLanguage.define(shell);
    case "yml":
    case "yaml":
      return StreamLanguage.define(yaml);
    case "toml":
      return StreamLanguage.define(toml);
    case "sql":
      return StreamLanguage.define(standardSQL);
    case "lua":
      return StreamLanguage.define(lua);
    default:
      return null;
  }
}

/**
 * Language id for prompts/IPC (editor:agentRun's `lang` field — it only ever
 * lands in the prompt text, so any stable id works). Same shape as the old
 * Monaco map so agent behaviour is unchanged across the kernel swap.
 */
export function languageIdForFile(file: string): string {
  const ext = (file.split(".").pop() ?? "").toLowerCase();
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    mts: "typescript",
    cts: "typescript",
    js: "javascript",
    jsx: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    json: "json",
    css: "css",
    scss: "scss",
    less: "less",
    html: "html",
    htm: "html",
    xml: "xml",
    svg: "xml",
    vue: "html",
    md: "markdown",
    markdown: "markdown",
    py: "python",
    rs: "rust",
    go: "go",
    java: "java",
    kt: "kotlin",
    swift: "swift",
    c: "c",
    h: "c",
    cc: "cpp",
    cpp: "cpp",
    cxx: "cpp",
    hpp: "cpp",
    cs: "csharp",
    rb: "ruby",
    php: "php",
    sh: "shell",
    bash: "shell",
    zsh: "shell",
    yml: "yaml",
    yaml: "yaml",
    toml: "ini",
    ini: "ini",
    sql: "sql",
    lua: "lua",
    graphql: "graphql",
    gql: "graphql",
  };
  return map[ext] ?? "plaintext";
}
