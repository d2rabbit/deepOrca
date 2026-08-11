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
import { cp, mkdir, rm } from "node:fs/promises";
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

/**
 * Renderer: browser bundle with code splitting.
 * Splitting enables React.lazy() and dynamic import() to produce separate
 * chunk files, so heavy dependencies (Monaco ~5MB, Mermaid ~3MB) are only
 * loaded when the user actually opens the editor or renders a diagram.
 * Requires outdir (not outfile) + format: "esm" (already set).
 */
const rendererOutdir = resolve(outdir, "renderer");

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
  loader: { ".png": "dataurl", ".svg": "dataurl", ".ttf": "dataurl", ".woff": "dataurl", ".woff2": "dataurl" },
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

async function copyStaticAssets() {
  await mkdir(resolve(outdir, "renderer"), { recursive: true });
  await cp(resolve(__dirname, "src/renderer/index.html"), resolve(outdir, "renderer/index.html"));
  await cp(resolve(__dirname, "src/renderer/ui.css"), resolve(outdir, "renderer/ui.css"));
  await cp(resolve(__dirname, "src/renderer/styles.css"), resolve(outdir, "renderer/styles.css"));
  // Brand icon (orca): main process rasterizes dist/orca-icon.svg; renderer uses it as favicon.
  const orcaSvg = resolve(__dirname, "src/assets/orca-icon.svg");
  if (existsSync(orcaSvg)) {
    await cp(orcaSvg, resolve(outdir, "orca-icon.svg"));
    await cp(orcaSvg, resolve(outdir, "renderer/orca-icon.svg"));
  }
  // styles-metro.css / styles-glass.css 为新建文件,构建时若不存在则跳过(不报错)
  const metroCss = resolve(__dirname, "src/renderer/styles-metro.css");
  if (existsSync(metroCss)) {
    await cp(metroCss, resolve(outdir, "renderer/styles-metro.css"));
  }
  const glassCss = resolve(__dirname, "src/renderer/styles-glass.css");
  if (existsSync(glassCss)) {
    await cp(glassCss, resolve(outdir, "renderer/styles-glass.css"));
  }
  const fusionCss = resolve(__dirname, "src/renderer/styles-fusion.css");
  if (existsSync(fusionCss)) {
    await cp(fusionCss, resolve(outdir, "renderer/styles-fusion.css"));
  }
  const lineCss = resolve(__dirname, "src/renderer/styles-line.css");
  if (existsSync(lineCss)) {
    await cp(lineCss, resolve(outdir, "renderer/styles-line.css"));
  }
  const orcaCss = resolve(__dirname, "src/renderer/styles-orca.css");
  if (existsSync(orcaCss)) {
    await cp(orcaCss, resolve(outdir, "renderer/styles-orca.css"));
  }
}

async function run() {
  await ensureCoreBuilt();
  // CodeGraph: installed as npm dependency (@colbymchenry/codegraph) — no vendor script needed.
  // The npm-shim.js auto-selects the platform binary from optionalDependencies.
  ensureVendored("openwiki", [".vendored-openwiki-version"], "npx openwiki");
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
  if (isDev) {
    await cleanRendererChunks();
    const contexts = await Promise.all([
      context(mainConfig),
      context(preloadConfig),
      context(prototypePreloadConfig),
      context(rendererConfig),
    ]);
    await Promise.all(contexts.map((ctx) => ctx.watch()));
    await copyStaticAssets();
    console.log("[desktop] watching for changes… (run `npm run start` in another terminal)");
    return;
  }

  await cleanRendererChunks();
  await Promise.all([build(mainConfig), build(preloadConfig), build(prototypePreloadConfig), build(rendererConfig)]);
  await aliasChunkCss();
  await copyStaticAssets();
  console.log("[desktop] build complete → dist/");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
