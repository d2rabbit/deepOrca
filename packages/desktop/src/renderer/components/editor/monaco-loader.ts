// Monaco bootstrap shared by the editor workspace (moved verbatim from the
// retired single-file EditorOverlay — B-line E3). Monaco is dynamically
// imported so its ~5MB only loads when the user actually opens the editor;
// React.lazy() in App.tsx + esbuild splitting keep it fully deferred.

let monacoInitialized = false;

/**
 * Load this chunk's CSS. esbuild splits lazily-imported chunk CSS into a
 * sibling file but never injects it at runtime — Monaco's layout rules
 * (including the one that hides the IME textarea, which otherwise shows up
 * as a white UA-styled box) live in that file. build.mjs republishes each
 * chunk's CSS under a stable hash-free name so it can be linked here.
 */
function ensureEditorChunkCss(): void {
  const href = "./chunks/EditorWorkspace.css";
  if (document.querySelector(`link[href="${href}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
}

export async function ensureMonacoLoaded(): Promise<void> {
  if (monacoInitialized) return;
  monacoInitialized = true;
  ensureEditorChunkCss();
  const [{ loader: monacoLoader }, monacoEditor] = await Promise.all([
    import("@monaco-editor/react"),
    import("monaco-editor"),
  ]);
  const monaco = monacoEditor.default ?? monacoEditor;
  // Use the locally bundled monaco-editor package instead of CDN.
  monacoLoader.config({ monaco });

  // TS/JSX language service (user ask 2026-09-03 十三轮 B3c-2): without
  // compiler options the ts.worker treats tsx as plain ts and flags JSX —
  // configure the project the way this repo actually compiles + eager model
  // sync so diagnostics/completions cover every open file. The monaco type
  // stub marks languages.typescript deprecated (narrowed to {deprecated}),
  // so the runtime object goes through a structural cast.
  type TsLang = {
    typescriptDefaults: {
      setCompilerOptions(o: Record<string, unknown>): void;
      setEagerModelSync(v: boolean): void;
    };
    javascriptDefaults: { setCompilerOptions(o: Record<string, unknown>): void };
    ScriptTarget: Record<string, number>;
    ModuleKind: Record<string, number>;
    ModuleResolutionKind: Record<string, number>;
    JsxEmit: Record<string, number>;
  };
  const ts = (monaco.languages as unknown as { typescript: TsLang }).typescript;
  const tsDefaults = ts.typescriptDefaults;
  tsDefaults.setCompilerOptions({
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    jsx: ts.JsxEmit.React,
    allowNonTsExtensions: true,
    allowJs: true,
    checkJs: false,
    esModuleInterop: true,
    skipLibCheck: true,
  });
  tsDefaults.setEagerModelSync(true);
  ts.javascriptDefaults.setCompilerOptions({
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    allowNonTsExtensions: true,
    allowJs: true,
    checkJs: false,
    esModuleInterop: true,
  });

  // Web Workers for language features (TS IntelliSense, JSON, etc.).
  // Workers are loaded from the bundled monaco-editor package via import.meta.url.
  self.MonacoEnvironment = {
    getWorker(_workerId: string, label: string): Worker {
      switch (label) {
        case "json":
          return new Worker(new URL("monaco-editor/esm/vs/language/json/json.worker.js", import.meta.url), {
            type: "module",
          });
        case "css":
        case "scss":
        case "less":
          return new Worker(new URL("monaco-editor/esm/vs/language/css/css.worker.js", import.meta.url), {
            type: "module",
          });
        case "html":
        case "handlebars":
        case "razor":
          return new Worker(new URL("monaco-editor/esm/vs/language/html/html.worker.js", import.meta.url), {
            type: "module",
          });
        case "typescript":
        case "javascript":
          return new Worker(new URL("monaco-editor/esm/vs/language/typescript/ts.worker.js", import.meta.url), {
            type: "module",
          });
        default:
          return new Worker(new URL("monaco-editor/esm/vs/editor/editor.worker.js", import.meta.url), {
            type: "module",
          });
      }
    },
  };
}

/** Map a file path to a Monaco language id. */
export function languageForFile(file: string): string {
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
    r: "r",
    pl: "perl",
    mk: "makefile",
    dockerfile: "dockerfile",
    graphql: "graphql",
    gql: "graphql",
  };
  return map[ext] ?? "plaintext";
}
