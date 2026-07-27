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
import { execFileSync } from "node:child_process";
import { cp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
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
  },
};

/** Main process: ESM, keep node deps + core external for runtime resolution. */
const mainConfig = {
  ...shared,
  entryPoints: [resolve(__dirname, "src/main/index.ts")],
  outfile: resolve(outdir, "main.js"),
  platform: "node",
  format: "esm",
  target: "node22",
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
  target: "node22",
  external: ["electron"],
};

/** Renderer: browser bundle, everything bundled in. */
const rendererConfig = {
  ...shared,
  entryPoints: [resolve(__dirname, "src/renderer/main.tsx")],
  outfile: resolve(outdir, "renderer/renderer.js"),
  platform: "browser",
  format: "esm",
  target: "chrome124",
  jsx: "automatic",
  loader: { ".png": "dataurl", ".svg": "dataurl" },
};

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

// Ensure @deeporca/core is freshly built before bundling.
// The desktop main bundle keeps core `external` (resolved from node_modules at
// runtime), so a stale core/dist/ (e.g. after a `git pull` that changed core
// source but not its gitignored dist) makes Electron fail to import new
// exports. Rebuild core + rewrite ESM imports so dist/ always matches src.
//
// Core uses `composite: true` (incremental builds via .tsbuildinfo). When only
// dist/ is removed (or source changed after a pull), a stale buildinfo can make
// `tsc` think nothing needs emitting. We delete the buildinfo first so the next
// `tsc -p` does a full emit, then rewrite ESM imports to add ".js" extensions.
async function ensureCoreBuilt() {
  const root = resolve(__dirname, "..", "..");
  const corePkg = resolve(root, "packages", "core");
  const buildinfo = resolve(corePkg, "tsconfig.tsbuildinfo");
  const rewriteScript = resolve(root, "scripts", "rewrite-esm-imports.js");
  if (existsSync(buildinfo)) {
    await rm(buildinfo, { force: true });
  }
  console.log("[desktop] building @deeporca/core …");
  execFileSync("npm", ["run", "build", "--workspace=@deeporca/core"], {
    stdio: "inherit",
    cwd: root,
    shell: true,
  });
  execFileSync(process.execPath, [rewriteScript], { stdio: "inherit", cwd: root });
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
  ensureVendored("codegraph", ["dist", "bin", "codegraph.js"], "npx @colbymchenry/codegraph");
  ensureVendored("openwiki", ["dist", "cli.js"], "npx openwiki");
  if (isDev) {
    const contexts = await Promise.all([context(mainConfig), context(preloadConfig), context(rendererConfig)]);
    await Promise.all(contexts.map((ctx) => ctx.watch()));
    await copyStaticAssets();
    console.log("[desktop] watching for changes… (run `npm run start` in another terminal)");
    return;
  }

  await Promise.all([build(mainConfig), build(preloadConfig), build(rendererConfig)]);
  await copyStaticAssets();
  console.log("[desktop] build complete → dist/");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
