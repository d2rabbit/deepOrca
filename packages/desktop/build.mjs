// Build script for the DeepOrca Desktop (Electron) client.
//
// Produces three bundles under dist/:
//   - main.js      (ESM, Electron main process — runs the DeepOrca core engine)
//   - preload.cjs  (CJS, Electron preload — exposes a typed bridge to the renderer)
//   - renderer/    (browser bundle + index.html + styles.css — the React GUI)
//
// The core engine and its native-ish node dependencies (openai, undici, ...) are
// left external so they resolve from node_modules at runtime, exactly like the CLI.

import { build, context } from "esbuild";
import { execFileSync, spawnSync } from "node:child_process";
import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const isDev = process.argv.includes("--dev");
const outdir = resolve(__dirname, "dist");

const shared = {
  bundle: true,
  sourcemap: true,
  logLevel: "info",
  define: {
    "process.env.NODE_ENV": JSON.stringify(isDev ? "development" : "production"),
    // Conditional compilation: debug-only code guarded by
    // `if (process.env.DEEPORCA_DEBUG) { ... }` is tree-shaken in production.
    "process.env.DEEPORCA_DEBUG": JSON.stringify(isDev ? "1" : "0"),
  },
  // Minify in production for smaller bundles and faster startup.
  // Dev keeps readable output for easier debugging.
  minify: !isDev,
  // Drop debugger statements and console.debug in production.
  // Keep console.log/error/warn for diagnostics.
  drop: isDev ? [] : ["debugger"],
  pure: ["console.debug"],
  legalComments: "eof",
};

/** Main process: ESM, keep node deps + core external for runtime resolution. */
const mainConfig = {
  ...shared,
  entryPoints: [resolve(__dirname, "src/main/index.ts")],
  outfile: resolve(outdir, "main.js"),
  platform: "node",
  format: "esm",
  target: "node24",
  packages: "external",
  banner: {
    // Provide CJS-style globals a few node deps expect, harmless for our own code.
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
};

/** Preload: CJS (required for sandboxed preload), electron external. */
const preloadConfig = {
  ...shared,
  entryPoints: [resolve(__dirname, "src/preload/index.ts")],
  outfile: resolve(outdir, "preload.cjs"),
  platform: "node",
  format: "cjs",
  target: "node24",
  external: ["electron"],
};

/** Prototype-window preload: minimal CJS bundle exposing only the A2UI surface
 *  + window-close surface (no file/settings/Git/MCP access). Used by the
 *  popout prototype BrowserWindow so a prototype surface cannot reach the
 *  privileged bridge even if it loads untrusted content. */
const prototypePreloadConfig = {
  ...shared,
  entryPoints: [resolve(__dirname, "src/preload/prototype.ts")],
  outfile: resolve(outdir, "prototype.cjs"),
  platform: "node",
  format: "cjs",
  target: "node24",
  external: ["electron"],
};

/** Dembrandt provider child: the isolated Electron process that owns the
 *  app's only remote-debugging Chromium (random port). CJS so the parent can
 *  spawn it as a plain script path; electron must resolve at runtime. */
const dembrandtProviderConfig = {
  ...shared,
  entryPoints: [resolve(__dirname, "src/main/tools/dembrandt-provider-child.ts")],
  outfile: resolve(outdir, "dembrandt-provider.cjs"),
  platform: "node",
  format: "cjs",
  target: "node24",
  packages: "external",
};

/** LSP diagnostics bridge server (specs/lsp-diagnostics): standalone CJS child
 *  spawned via Electron-as-Node per trusted+opted-in root — speaks MCP ndjson
 *  on stdio and hosts the language-server processes. Zero runtime deps. */
const lspBridgeServerConfig = {
  ...shared,
  entryPoints: [resolve(__dirname, "src/main/tools/lsp-bridge/server.ts")],
  outfile: resolve(outdir, "lsp-bridge-server.cjs"),
  platform: "node",
  format: "cjs",
  target: "node24",
};

/**
 * Renderer: browser bundle with code splitting.
 * Splitting enables React.lazy() and dynamic import() to produce separate
 * chunk files, so heavy dependencies (markdown renderers, mermaid) are only
 * loaded when the user actually navigates to those surfaces. The editor is
 * also lazy (CodeMirror 6 kernel — far lighter than the retired Monaco).
 * Requires outdir (not outfile) + format: "esm" (already set).
 */
const rendererOutdir = resolve(outdir, "renderer");

/**
 * specs/artifact-landing A6 — @open-file-viewer's single-file SDK statically
 * carries every plugin's dynamic-import statement, so unmounted format
 * engines (three/leaflet/hls.js/…) would still be emitted as dead chunks.
 * The mounted plugins never import them (import sites live inside unmounted
 * plugins' render paths), so every path of these packages resolves to one
 * empty module — the dead weight disappears and assertRendererGuards holds
 * the line. A build.mjs-local plugin is required because esbuild alias
 * cannot map package SUBPATHS (`three/examples/jsm/…`) to one file.
 */
function emptyShimPlugin() {
  const shim = resolve(__dirname, "src/renderer/shims/empty/empty.js");
  const packages = [
    "three",
    "hls\\.js",
    "leaflet",
    "topojson-client",
    "@mapbox/togeojson",
    "shpjs",
    "heic2any",
    "mpegts\\.js",
    "postal-mime",
    "@kenjiuno/msgreader",
    "ag-psd",
    "emf-converter",
    "hyparquet",
    "seek-bzip",
    "xz-decompress",
    "utif",
    "prismjs",
    // NOTE: `marked` and `mermaid` are NOT shimmed — existing product code
    // (streamdown / @codemirror/lsp-client / chat diagrams) imports them.
    "util",
    "buffer",
  ];
  const filter = new RegExp(`^(?:${packages.join("|")})(?:/|$)`);
  return {
    name: "empty-shim",
    setup(build) {
      build.onResolve({ filter }, () => ({ path: shim }));
    },
  };
}

const rendererConfig = {
  ...shared,
  // Use an object entry so the output is named `renderer.js` (matching the
  // <script src="./renderer.js"> in index.html). A plain array entry would
  // derive the name from the source file (`main.tsx` → `main.js`) and the
  // browser would 404 on the script tag → black screen.
  entryPoints: { renderer: resolve(__dirname, "src/renderer/main.tsx") },
  outdir: rendererOutdir,
  platform: "browser",
  format: "esm",
  target: "chrome150",
  jsx: "automatic",
  splitting: true,
  chunkNames: "chunks/[name]-[hash]",
  // Metafile feeds assertRendererGuards (specs/artifact-landing A6/B8).
  metafile: true,
  plugins: [emptyShimPlugin()],
  loader: { ".png": "dataurl", ".svg": "dataurl", ".ttf": "dataurl", ".woff": "dataurl", ".woff2": "dataurl" },
  alias: {
    // pdfjs-dist is nested under the workspace (version-conflict hoisting) and
    // invisible from @open-file-viewer's hoisted root location — pin the exact
    // copy the preview plugin documents (specs/artifact-landing A).
    "pdfjs-dist": resolve(__dirname, "node_modules/pdfjs-dist"),
  },
};

/**
 * Generate a TypeScript source file that exports the vendored Tailwind JIT
 * script as a string literal. This avoids esbuild plugin/loader complexity —
 * the generated .ts file is picked up by the normal bundler pipeline.
 * Called before the esbuild step. If the vendor file is missing (offline),
 * the generated file exports an empty string — designs still render with
 * seed CSS, just without Tailwind utility classes.
 *
 * The output lives under `src/generated/` (gitignored, cleaned by clean.js)
 * so a build never dirties the working tree. The previous location
 * (`src/renderer/dd/tailwind-script.ts`) was tracked, which meant every
 * desktop:build rewrote a tracked source file — leaving the tree dirty and
 * racing with parallel builds. `src/generated/` is also produced before
 * typecheck so a clean checkout can still resolve the import.
 */
function generateTailwindSource() {
  const vendorPath = resolve(__dirname, "vendor", "tailwind", "tailwind.js");
  const generatedDir = resolve(__dirname, "src", "generated");
  mkdirSync(generatedDir, { recursive: true });
  const outPath = resolve(generatedDir, "tailwind-script.ts");
  let content = "";
  try {
    content = readFileSync(vendorPath, "utf8");
    console.log(`[desktop] tailwind: vendored script inlined (${(content.length / 1024).toFixed(0)}KB)`);
  } catch {
    console.warn("[desktop] tailwind: vendored script not found — designs will use seed CSS only.");
  }
  writeFileSync(outPath, `// AUTO-GENERATED by build.mjs — do not edit.\nexport default ${JSON.stringify(content)};\n`);
}

// Vendor CodeGraph + OpenWiki (checked out + compiled) into vendor/<name>.
// Runs on EVERY build: the vendor scripts fetch the upstream repo first and only
// recompile when there are new commits, so an up-to-date checkout costs one
// `git fetch`. Best-effort: if vendoring fails (no network/git) an existing
// vendored copy keeps working, and the runtime falls back to npx otherwise —
// the build must not break because of it.
function ensureVendored(name, entryRel, fallbackHint) {
  const entry = resolve(__dirname, "vendor", name, ...entryRel);
  // Escape hatch for offline / fast iteration builds: vendoring checks the
  // upstream (network) every time, which can hang on a flaky connection.
  // With an existing vendored copy the build proceeds on it.
  if (process.env.DEEPORCA_SKIP_VENDORS) {
    if (existsSync(entry)) {
      console.log(`[desktop] vendoring ${name} skipped (DEEPORCA_SKIP_VENDORS) — using existing copy.`);
    } else {
      console.warn(`[desktop] vendoring ${name} skipped — runtime will fall back to \`${fallbackHint}\`.`);
    }
    return;
  }
  const script = resolve(__dirname, "..", "..", "scripts", `vendor-${name}.js`);
  try {
    console.log(`[desktop] vendoring ${name} (checking upstream) …`);
    execFileSync(process.execPath, [script], { stdio: "inherit" });
  } catch {
    if (existsSync(entry)) {
      console.warn(`[desktop] ${name} vendoring failed — keeping the existing vendored build.`);
    } else {
      console.warn(`[desktop] ${name} vendoring skipped — runtime will fall back to \`${fallbackHint}\`.`);
    }
  }
}

// Ensure the internal @deeporca/* packages are freshly built before bundling.
// The desktop main bundle keeps core/memory `external` (resolved from
// node_modules at runtime), so a stale dist/ (e.g. after a `git pull` that
// changed core source but not its gitignored dist) makes Electron fail to
// import new exports.
//
// We delegate to the root `npm run build` rather than re-implementing the
// build order here. The root scripts/build.js derives the workspace build
// order topologically (embedding → memory → core) and rewrites ESM imports;
// the previous inlined version hardcoded "memory → core" and silently forgot
// `@deeporca/embedding`, which broke clean builds because core/memory
// `import type` from embedding's declarations. Reusing the root script means
// adding a new internal workspace needs no change here.
async function ensureCoreBuilt() {
  const root = resolve(__dirname, "..", "..");
  console.log("[desktop] building @deeporca/* internal workspaces (topological) …");
  const result = spawnSync("npm", ["run", "build"], {
    stdio: "inherit",
    cwd: root,
    shell: true,
  });
  if (result.status !== 0) {
    throw new Error(`building @deeporca/* workspaces failed (exit ${result.status ?? "null"})`);
  }
}

/** Remove stale chunks from previous builds (hashed names accumulate). */
async function cleanRendererChunks() {
  await rm(resolve(rendererOutdir, "chunks"), { recursive: true, force: true });
}

/**
 * esbuild splits lazily-imported chunk CSS into `chunks/<name>-<hash>.css`
 * files but never injects them at runtime (no CSS loader for dynamic
 * imports). Republish each chunk's CSS under a stable hash-free alias
 * (`chunks/<name>.css`) so lazily loaded components can link their own
 * styles deterministically (see EditorOverlay's ensureEditorChunkCss).
 */
async function aliasChunkCss() {
  const chunksDir = resolve(rendererOutdir, "chunks");
  if (!existsSync(chunksDir)) return;
  const { readdir } = await import("node:fs/promises");
  for (const file of await readdir(chunksDir)) {
    const match = file.match(/^([A-Za-z0-9_-]+)-[A-Za-z0-9_-]+\.css$/);
    if (!match) continue;
    await cp(resolve(chunksDir, file), resolve(chunksDir, `${match[1]}.css`), { force: true });
  }
}

/**
 * specs/artifact-landing A6/B8 build guard: banned modules must never reach
 * the renderer graph. three/leaflet/hls.js are @open-file-viewer's unmounted
 * format engines (mounted-plugin tree-shaking must hold); @marp-team/marp is
 * main-process-only. Metafile-based — exact module paths, not heuristics.
 */
async function assertRendererGuards(metaPath) {
  if (!existsSync(metaPath)) {
    // A missing metafile must fail the build, not skip the guard — silently
    // passing would make A6/B8 bypassable by any metafile write failure.
    // Throw (not process.exit): run().catch is the single failure channel,
    // and an immediate exit can truncate piped stderr carrying this message.
    throw new Error("[desktop] GUARD FAIL — renderer metafile missing, A6/B8 bundle guard cannot run");
  }
  const meta = JSON.parse(readFileSync(metaPath, "utf8"));
  const banned = ["node_modules/three/", "node_modules/leaflet/", "node_modules/hls.js/", "node_modules/@marp-team/"];
  const offenders = Object.keys(meta.inputs ?? {})
    .map((k) => k.replaceAll("\\", "/"))
    .filter((k) => banned.some((b) => k.includes(b)));
  if (offenders.length > 0) {
    throw new Error(
      `[desktop] GUARD FAIL — banned modules in renderer bundle (A6/B8):\n  ${offenders.slice(0, 8).join("\n  ")}`
    );
  }
}

async function copyStaticAssets() {
  await mkdir(resolve(outdir, "renderer"), { recursive: true });
  await cp(resolve(__dirname, "src/renderer/index.html"), resolve(outdir, "renderer/index.html"));
  // ui.css is a thin @import index over the ui-css/ module dir (kept small:
  // every stylesheet stays under the 2500-line repo limit). The modules
  // resolve relative to this file, so the directory must ship next to it.
  await cp(resolve(__dirname, "src/renderer/ui.css"), resolve(outdir, "renderer/ui.css"));
  await cp(resolve(__dirname, "src/renderer/ui-css"), resolve(outdir, "renderer/ui-css"), {
    recursive: true,
  });
  // Official A2UI basic-catalog structural styles (R2). The package's
  // exports map exposes no css subpath, so the file is copied from its
  // installed location at build time — always in sync with the dependency.
  try {
    // The package may be hoisted to the repo root or nested in the workspace.
    const candidates = [
      resolve(__dirname, "../../node_modules/@a2ui/react/v0_9/index.css"),
      resolve(__dirname, "node_modules/@a2ui/react/v0_9/index.css"),
    ];
    const src = candidates.find((c) => existsSync(c));
    if (!src) throw new Error(`not found in ${candidates.join(" | ")}`);
    await cp(src, resolve(outdir, "renderer/a2ui-basic.css"));
  } catch (err) {
    console.warn(`[desktop] @a2ui/react v0_9 stylesheet missing — a2ui surfaces render unstyled (${err.message})`);
  }
  // pdf.js worker (specs/artifact-landing 链路 A): served next to index.html
  // so the preview plugin's workerSrc stays a same-dir relative URL — offline,
  // no CDN (A5). Missing worker degrades PDF preview to the fallback UI.
  try {
    const workerCandidates = [
      resolve(__dirname, "../../node_modules/pdfjs-dist/build/pdf.worker.min.mjs"),
      resolve(__dirname, "node_modules/pdfjs-dist/build/pdf.worker.min.mjs"),
    ];
    const workerSrc = workerCandidates.find((c) => existsSync(c));
    if (!workerSrc) throw new Error(`not found in ${workerCandidates.join(" | ")}`);
    await cp(workerSrc, resolve(rendererOutdir, "pdf.worker.min.mjs"));
  } catch (err) {
    console.warn(`[desktop] pdf.worker missing — PDF preview degrades to fallback (${err.message})`);
  }
  // @open-file-viewer core stylesheet — same build-time copy pattern as
  // @a2ui/react (the exports map's css subpath can't ride an esbuild chunk).
  try {
    const ofvCandidates = [
      resolve(__dirname, "../../node_modules/@open-file-viewer/core/dist/style.css"),
      resolve(__dirname, "node_modules/@open-file-viewer/core/dist/style.css"),
    ];
    const ofvCss = ofvCandidates.find((c) => existsSync(c));
    if (!ofvCss) throw new Error(`not found in ${ofvCandidates.join(" | ")}`);
    await cp(ofvCss, resolve(rendererOutdir, "ofv-core.css"));
  } catch (err) {
    console.warn(`[desktop] @open-file-viewer/core style.css missing — previews render unstyled (${err.message})`);
  }
  // Official OpenUI (react-ui) stylesheet — ONE unlayered copy carries both
  // the --openui-* token defaults and every component rule. In the installed
  // dist, components/index.css is byte-identical to styles/index.css, and
  // every rule of styles/openui-defaults.css is contained in it; the
  // layered/styles/index.css variant wraps the same rules in `@layer openui`
  // and can never beat unlayered ones, so copying those two would be dead
  // weight shipped in the installer and parsed per window. main.tsx injects
  // it BEFORE ui.css so ui-css/openui-bridge.css re-binding wins. Copied
  // from the installed dependency (same hoisting caveat as @a2ui).
  try {
    const openuiCandidates = [
      resolve(__dirname, "../../node_modules/@openuidev/react-ui/dist"),
      resolve(__dirname, "node_modules/@openuidev/react-ui/dist"),
    ];
    const openuiDist = openuiCandidates.find((c) => existsSync(c));
    if (!openuiDist) throw new Error(`not found in ${openuiCandidates.join(" | ")}`);
    await cp(resolve(openuiDist, "components/index.css"), resolve(outdir, "renderer/openui-components.css"));
  } catch (err) {
    console.warn(`[desktop] @openuidev/react-ui stylesheets missing — OpenUI canvas renders unstyled (${err.message})`);
  }
  // leafer-editor web runtime + @leafer-in/flow plugin (specs/leafer-ui-engine
  // WP3): the interactive .ddu export embeds both (design-ipc reads them back
  // from dist/ at export time; the flow build wires into the editor runtime's
  // global LeaferUI namespace and MUST load right after it). Copy targets
  // match dd-package's resolver constants exactly — dot spellings, not
  // hyphens. Copied from the installed dependency — same hoisting caveat as
  // @a2ui; a missing runtime disables the .ddu export.
  try {
    const leaferCandidates = [
      resolve(__dirname, "../../node_modules/leafer-editor/dist/web.min.js"),
      resolve(__dirname, "node_modules/leafer-editor/dist/web.min.js"),
    ];
    const flowCandidates = [
      resolve(__dirname, "../../node_modules/@leafer-in/flow/dist/flow.min.js"),
      resolve(__dirname, "node_modules/@leafer-in/flow/dist/flow.min.js"),
    ];
    const leaferSrc = leaferCandidates.find((c) => existsSync(c));
    if (!leaferSrc) throw new Error(`editor runtime not found in ${leaferCandidates.join(" | ")}`);
    await cp(leaferSrc, resolve(outdir, "leafer.web.min.js"));
    const flowSrc = flowCandidates.find((c) => existsSync(c));
    if (!flowSrc) throw new Error(`flow plugin not found in ${flowCandidates.join(" | ")}`);
    await cp(flowSrc, resolve(outdir, "leafer-flow.web.min.js"));
  } catch (err) {
    console.warn(`[desktop] leafer runtime missing — interactive .ddu export disabled (${err.message})`);
  }
  await cp(resolve(__dirname, "src/renderer/styles.css"), resolve(outdir, "renderer/styles.css"));
  // Brand icon (orca): main process rasterizes dist/orca-icon.svg; renderer uses it as favicon.
  const orcaSvg = resolve(__dirname, "src/assets/orca-icon.svg");
  if (existsSync(orcaSvg)) {
    await cp(orcaSvg, resolve(outdir, "orca-icon.svg"));
    await cp(orcaSvg, resolve(outdir, "renderer/orca-icon.svg"));
  }
  // Theme stylesheets are discovered rather than kept in a second manual list.
  // `appearance.test.ts` guarantees every registered Theme maps to an existing
  // source file; this loop guarantees every source `styles-*.css` reaches dist.
  // Together they make a registry/build drift impossible without a failing test.
  const themeStyles = (await readdir(resolve(__dirname, "src/renderer")))
    .filter((name) => /^styles-.+\.css$/.test(name))
    .sort();
  for (const filename of themeStyles) {
    await cp(resolve(__dirname, "src/renderer", filename), resolve(outdir, "renderer", filename));
  }
}

/**
 * The pm-designer-openui SKILL.md component table AND the main-process
 * validator schema (a2ui/openui-library-schema.ts) are generated artifacts of
 * the OFFICIAL @openuidev/react-ui openuiLibrary (via
 * scripts/generate-openui-prompt.mjs). Regenerate them before bundling and
 * fail when regeneration changes either file — i.e. when an upstream library
 * update was not followed by `npm run openui:prompt`. The check compares the
 * files before/after regeneration (not git state), so uncommitted-but-in-sync
 * files pass while genuine drift fails. (The legacy library-schema.ts is only
 * the pre-switch fallback renderer and is NOT these artifacts' source.)
 */
async function ensureOpenuiPromptInSync() {
  const script = resolve(__dirname, "..", "..", "scripts", "generate-openui-prompt.mjs");
  const skill = resolve(
    __dirname,
    "..",
    "..",
    "packages",
    "core",
    "templates",
    "plugins",
    "design",
    "skills",
    "pm-designer-openui",
    "SKILL.md"
  );
  const schema = resolve(__dirname, "src", "main", "tools", "a2ui", "openui-library-schema.ts");
  const before = [readFileSync(skill, "utf8"), readFileSync(schema, "utf8")];
  const gen = spawnSync(process.execPath, [script, "--write"], { encoding: "utf8" });
  if (gen.status !== 0) {
    throw new Error(`openui prompt generation failed:\n${gen.stderr}`);
  }
  const after = [readFileSync(skill, "utf8"), readFileSync(schema, "utf8")];
  if (before[0] !== after[0]) {
    throw new Error(
      "pm-designer-openui SKILL.md is out of sync with the official openuiLibrary prompt — run `npm run openui:prompt` and commit the result (source: scripts/generate-openui-prompt.mjs, NOT legacy library-schema.ts)."
    );
  }
  if (before[1] !== after[1]) {
    throw new Error(
      "a2ui/openui-library-schema.ts is out of sync with the official openuiLibrary schema — run `npm run openui:prompt` and commit the result."
    );
  }
}

async function run() {
  await ensureCoreBuilt();
  await ensureOpenuiPromptInSync();
  // CodeGraph: installed as npm dependency (@colbymchenry/codegraph) — no vendor script needed.
  // The npm-shim.js auto-selects the platform binary from optionalDependencies.
  ensureVendored("openwiki", [".vendored-openwiki-version"], "npx openwiki");
  // Archify: git-pinned skill package (typed JSON IR -> validated HTML diagrams).
  ensureVendored("archify", [".vendored-archify-ref"], "no fallback (architecture maps unavailable)");
  // Tailwind JIT script: downloaded as a single JS file for offline DeepDesign.
  ensureVendored("tailwind", ["tailwind.js"], "cdn.tailwindcss.com (online fallback)");
  // Generate tailwind-script.ts from the vendored file so esbuild can bundle it.
  generateTailwindSource();
  // uv: shared by CRG + Serena + SkillSpector. Binary download from GitHub Releases.
  ensureVendored("uv", [".vendored-uv-version"], "system uv on PATH");
  // BrowserSkill (bsk): prebuilt Rust CLI from GitHub Releases.
  ensureVendored("browser-skill", [".vendored-bsk-version"], "user-installed bsk on PATH");
  // Serena: version pin marker. Runtime installs via uv from PyPI with ==pin.
  ensureVendored("serena", [".vendored-serena-version"], "uvx serena-agent (unpinned)");
  // CRG: version pin marker. Runtime installs via uv from PyPI with ==pin.
  ensureVendored("crg", [".vendored-crg-version"], "uvx code-review-graph (unpinned)");
  // SkillSpector: version pin marker. Runtime installs wheel from GitHub Releases.
  ensureVendored("skillspector", [".vendored-skillspector-version"], "uv tool install from GitHub Releases");
  // Bento Slides: single-file HTML template from GitHub Releases.
  // Vendored into core templates (not desktop vendor/), so the existence
  // check below is just a no-op marker — the actual file lives at
  // packages/core/templates/plugins/work/skills/bento-slides/references/.
  ensureVendored("bento", [".vendored-bento-version"], "bundled template (offline)");
  // Granite Embedding 97M R2 (ONNX): local embedding model for memory recall.
  // Downloaded via hf-mirror fallback; powers @deeporca/embedding (transformers.js).
  ensureVendored("granite", [".vendored-granite-version"], "online model download (hf-mirror fallback)");
  // Dembrandt (design-token extraction engine): pinned npm install, isolated
  // node_modules under vendor/dembrandt — offline-first runtime (E1e). No
  // browser binary is vendored; core points PLAYWRIGHT_BROWSERS_PATH at an
  // offline-provisioned directory instead (see common/dembrandt.ts).
  ensureVendored("dembrandt", [".vendored-dembrandt-version"], "npx -y --package dembrandt@0.28.0 (online fallback)");
  // awesome-design-md (specs/design-md-collection): VoltAgent's DESIGN.md
  // collection (Google Stitch format, MIT) — 70+ brand design systems the
  // UI-design stack can pick as designSystemId. Markdown only, nothing executes.
  ensureVendored("design-md", [".vendored-head"], "bundled 9 design systems only (vendored brands unavailable)");
  if (isDev) {
    await cleanRendererChunks();
    const contexts = await Promise.all([
      context(mainConfig),
      context(preloadConfig),
      context(prototypePreloadConfig),
      context(dembrandtProviderConfig),
      context(lspBridgeServerConfig),
      context(rendererConfig),
    ]);
    await Promise.all(contexts.map((ctx) => ctx.watch()));
    await copyStaticAssets();
    console.log("[desktop] watching for changes… (run `npm run start` in another terminal)");
    return;
  }

  await cleanRendererChunks();
  const results = await Promise.all([
    build(mainConfig),
    build(preloadConfig),
    build(prototypePreloadConfig),
    build(dembrandtProviderConfig),
    build(lspBridgeServerConfig),
    build(rendererConfig),
  ]);
  // results[5] is the renderer build (position matches the build array above);
  // its metafile feeds assertRendererGuards — a missing metafile means
  // the renderer build broke, so fail here rather than guard-skip downstream.
  const rendererMetafile = results[5]?.metafile;
  if (!rendererMetafile) {
    throw new Error("[desktop] GUARD FAIL — renderer build produced no metafile");
  }
  await (
    await import("node:fs/promises")
  ).writeFile(resolve(rendererOutdir, "renderer-meta.json"), JSON.stringify(rendererMetafile));
  await aliasChunkCss();
  await copyStaticAssets();
  await assertRendererGuards(resolve(rendererOutdir, "renderer-meta.json"));
  console.log("[desktop] build complete → dist/");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
