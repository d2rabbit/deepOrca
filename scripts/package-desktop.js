// Stage the DeepOrca desktop app for electron-builder packaging.
//
// electron-builder wants a self-contained app directory (package.json +
// node_modules + built output). Our workspace layout doesn't map onto that
// directly (hoisted node_modules, file:../core dependency), so this script
// assembles a clean staging dir at `packages/desktop/out/app`:
//
//   out/app/
//     package.json        (generated: main=dist/main.js, deps=core runtime deps)
//     dist/               (esbuild output: main.js / preload.cjs / renderer/)
//     vendor/             (vendored CodeGraph + OpenWiki runtimes)
//     node_modules/       (npm install --omit=dev + @deeporca/core copied in)
//
// The desktop main bundle keeps `@deeporca/core` external, so the staging dir
// installs core's runtime deps from the registry and then copies the locally
// built core package (dist/ + templates/) into node_modules/@deeporca/core —
// no `npm pack` involved, so the ESM import rewrite done by the desktop build
// is preserved as-is.
//
// Usage:
//   node scripts/package-desktop.js               # stage only (desktop:build must have run)
//   node scripts/package-desktop.js --with-build  # run desktop:build first

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const desktopDir = join(repoRoot, "packages", "desktop");
const coreDir = join(repoRoot, "packages", "core");
const stagingDir = join(desktopDir, "out", "app");
const isWindows = process.platform === "win32";

function log(message) {
  console.log(`[package-desktop] ${message}`);
}

function run(command, args, cwd, options = {}) {
  const needsShell = isWindows && command === "npm";
  execFileSync(command, args, { cwd, stdio: "inherit", shell: needsShell, ...options });
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function main() {
  if (process.argv.includes("--with-build")) {
    log("running desktop build first …");
    run("npm", ["run", "desktop:build"], repoRoot);
  }

  const distMain = join(desktopDir, "dist", "main.js");
  if (!existsSync(distMain)) {
    throw new Error("packages/desktop/dist/main.js not found — run `npm run desktop:build` first.");
  }

  const rootPkg = readJson(join(repoRoot, "package.json"));
  const desktopPkg = readJson(join(desktopDir, "package.json"));
  const corePkg = readJson(join(coreDir, "package.json"));
  const memoryPkg = readJson(join(repoRoot, "packages", "memory", "package.json"));
  const embeddingPkg = readJson(join(repoRoot, "packages", "embedding", "package.json"));
  const embeddingDir = join(repoRoot, "packages", "embedding");
  const electronVersion = readJson(join(repoRoot, "node_modules", "electron", "package.json")).version;

  // ── Step 1: fresh staging dir with a generated standalone package.json ──
  log(`staging → ${stagingDir}`);
  rmSync(stagingDir, { recursive: true, force: true });
  mkdirSync(stagingDir, { recursive: true });

  // Merge the runtime dependencies of every @deeporca/* package the desktop
  // app ships, then STRIP every `@deeporca/*` entry. The staging dir is a
  // standalone app — a leftover `file:../embedding` would point at
  // `packages/desktop/out/embedding` (which does not exist), breaking
  // `npm install` and leaving embedding unresolvable at runtime. We copy the
  // locally-built internal packages into node_modules ourselves below.
  const mergedDeps = {
    ...corePkg.dependencies,
    ...memoryPkg.dependencies,
    ...embeddingPkg.dependencies,
    "@alibaba-group/open-code-review": desktopPkg.dependencies["@alibaba-group/open-code-review"],
    "@colbymchenry/codegraph": desktopPkg.dependencies["@colbymchenry/codegraph"],
  };
  const stagingDeps = {};
  for (const [name, version] of Object.entries(mergedDeps)) {
    if (name.startsWith("@deeporca/")) continue;
    stagingDeps[name] = version;
  }

  const stagingPkg = {
    name: "deeporca",
    productName: "DeepOrca",
    version: rootPkg.version,
    description: desktopPkg.description,
    license: rootPkg.license,
    author: "DeepOrca Team",
    repository: rootPkg.repository,
    type: "module",
    main: "dist/main.js",
    // Core + Memory + Embedding stay external in the main bundle → ship their
    // runtime deps. The @deeporca/* packages themselves are copied in below
    // (built dist/), so they are intentionally absent from this dependencies
    // map. ocr (Open Code Review) ships as an npm dep so the app runs the
    // vendored binary without requiring a global install. CodeGraph's
    // npm-shim.js is resolved via require.resolve at runtime
    // (core/common/codegraph.ts) → stage the npm package + its platform
    // optionalDependency so the shim can launch the platform binary offline.
    dependencies: stagingDeps,
    // Lets electron-builder resolve the Electron version for this app dir.
    devDependencies: { electron: electronVersion },
  };
  writeFileSync(join(stagingDir, "package.json"), JSON.stringify(stagingPkg, null, 2) + "\n");

  // ── Step 2: install runtime deps, then drop the locally built core in ──
  log("installing runtime dependencies (--omit=dev) …");
  run("npm", ["install", "--omit=dev", "--no-audit", "--no-fund", "--ignore-scripts", "--no-package-lock"], stagingDir);

  log("copying @deeporca/core (built) into node_modules …");
  const coreTarget = join(stagingDir, "node_modules", "@deeporca", "core");
  mkdirSync(coreTarget, { recursive: true });
  for (const name of ["package.json", "dist", "templates"]) {
    const src = join(coreDir, name);
    if (!existsSync(src)) {
      throw new Error(`packages/core/${name} missing — run the desktop build first.`);
    }
    cpSync(src, join(coreTarget, name), { recursive: true });
  }
  // tsc emits extensionless relative imports (moduleResolution:"bundler"); Node
  // ESM needs ".js". The dev build runs scripts/rewrite-esm-imports.js, but the
  // core dist copied here may have been regenerated by a later `tsc` (e.g. a
  // typecheck) and lost its rewrites. Run the rewriter on the staged copy so
  // the packaged app imports resolve. Idempotent — safe to run unconditionally.
  const stagedCoreDist = join(coreTarget, "dist");
  if (existsSync(stagedCoreDist)) {
    log("rewriting ESM imports in staged @deeporca/core …");
    run(process.execPath, [join(repoRoot, "scripts", "rewrite-esm-imports.js")], stagingDir, {
      env: { ...process.env, DIST_DIR: stagedCoreDist },
    });
  }

  // Copy the locally built @deeporca/memory over whatever npm installed. The
  // main bundle imports it dynamically at runtime; without the built dist/ here
  // the import resolves to a stub and memory features fail silently.
  log("copying @deeporca/memory (built) into node_modules …");
  const memoryDir = join(repoRoot, "packages", "memory");
  const memoryTarget = join(stagingDir, "node_modules", "@deeporca", "memory");
  mkdirSync(memoryTarget, { recursive: true });
  for (const name of ["package.json", "dist"]) {
    const src = join(memoryDir, name);
    if (!existsSync(src)) {
      throw new Error(`packages/memory/${name} missing — run the desktop build first.`);
    }
    cpSync(src, join(memoryTarget, name), { recursive: true });
  }

  // Copy the locally built @deeporca/embedding. core's routing loader and
  // memory's store factory both `import("@deeporca/embedding")` at runtime; if
  // this package is missing from staging, semantic routing silently fails open
  // and local vector recall degrades to keyword-only — with no diagnostic
  // because the dynamic import rejection is swallowed. Previously the staging
  // package.json leaked a `file:../embedding` dep that npm could not resolve,
  // so the package was never installed AND never copied in.
  log("copying @deeporca/embedding (built) into node_modules …");
  const embeddingTarget = join(stagingDir, "node_modules", "@deeporca", "embedding");
  mkdirSync(embeddingTarget, { recursive: true });
  for (const name of ["package.json", "dist"]) {
    const src = join(embeddingDir, name);
    if (!existsSync(src)) {
      throw new Error(`packages/embedding/${name} missing — run the desktop build first.`);
    }
    cpSync(src, join(embeddingTarget, name), { recursive: true });
  }

  // ── Step 3: copy built app output ──
  // (vendor/ is NOT staged here: electron-builder's app-files copier strips
  // nested node_modules. It ships via `extraResources` in electron-builder.yml,
  // copied verbatim from packages/desktop/vendor into Resources/app/vendor.)
  log("copying dist/ …");
  cpSync(join(desktopDir, "dist"), join(stagingDir, "dist"), { recursive: true });

  // ── Vendor validation ──────────────────────────────────────────────────
  // In dev/best-effort mode we only warn when a vendor dir is missing (the
  // packaged app falls back to npx/system binaries). In release mode
  // (--required or CI_RELEASE=1) we hard-fail unless each vendor's real entry
  // file exists — this prevents shipping a release with a structurally
  // invalid/empty vendor tree that earlier code only warned about.
  const isRelease = process.argv.includes("--required") || process.env.CI_RELEASE === "1";
  const hostUvTarget =
    process.platform === "darwin"
      ? `${process.arch === "arm64" ? "aarch64" : "x86_64"}-apple-darwin`
      : process.platform === "linux"
        ? `${process.arch === "arm64" ? "aarch64" : "x86_64"}-unknown-linux-gnu`
        : `${process.arch === "arm64" ? "aarch64" : "x86_64"}-pc-windows-msvc`;
  /** Entry file each vendor component must expose for the app to use it offline. */
  const vendorEntries = {
    // CodeGraph: installed via npm (@colbymchenry/codegraph) — no vendor dir needed.
    // Validated separately below by checking the npm package resolves.
    // openwiki moved its entry between versions (0.2.x: dist/cli.js → 0.3.x:
    // dist/cli/cli.js) — the runtime accepts both (main/index.ts), so the
    // gate accepts both too; pinning the gate to one layout false-alarms the
    // other (dev warning every package, release hard-fail on a healthy tree).
    openwiki: [join("openwiki", "dist", "cli.js"), join("openwiki", "dist", "cli", "cli.js")],
    // archify has NO runtime fallback (build.mjs: "no fallback (architecture
    // maps unavailable)") — a missing vendored bin means the packaged app can
    // never author/render architecture maps, so it belongs in this gate.
    archify: join("archify", "bin", "archify.mjs"),
    uv: join("uv", hostUvTarget),
    skillspector: join("skillspector", ".vendored-skillspector-version"),
    "browser-skill": join("browser-skill", process.platform === "win32" ? "bsk.exe" : "bsk"),
    tailwind: join("tailwind", "tailwind.js"),
    "granite-embedding": join(
      "granite-embedding",
      "ibm-granite",
      "granite-embedding-97m-multilingual-r2",
      "onnx",
      "model_quantized.onnx"
    ),
    bento: join(
      "..",
      "..",
      "core",
      "templates",
      "plugins",
      "work",
      "skills",
      "bento-slides",
      "references",
      "bento-template.bento.html"
    ),
  };
  for (const [name, rel] of Object.entries(vendorEntries)) {
    const candidates = Array.isArray(rel) ? rel : [rel];
    if (candidates.some((c) => existsSync(join(desktopDir, "vendor", c)))) continue;
    const relNote = candidates.join(" or ");
    const fallback =
      name === "uv"
        ? "system uv on PATH"
        : name === "skillspector"
          ? "uv tool install from git"
          : name === "archify"
            ? "NOTHING — architecture maps unavailable (archify has no runtime fallback)"
            : "npx";
    const msg = `vendor/${name} entry missing (${relNote}) — packaged app will fall back to ${fallback} at runtime.`;
    if (isRelease) {
      throw new Error(`[release] vendor/${name} incomplete: ${relNote} missing. Run 'npm run desktop:build' first.`);
    }
    log(msg);
  }

  // CodeGraph npm package validation (replaces the old vendor/codegraph dir check).
  // The package provides platform-specific binaries via optionalDependencies.
  {
    const cgPkg = join(desktopDir, "node_modules", "@colbymchenry", "codegraph", "package.json");
    if (!existsSync(cgPkg)) {
      const msg =
        "@colbymchenry/codegraph npm package not found in staging — MCP tools will fall back to npx at runtime.";
      if (isRelease) {
        throw new Error(`[release] @colbymchenry/codegraph missing in staging. Run 'npm install' first.`);
      }
      log(msg);
    }
  }

  // Third-party notice: generate always (cheap), and verify in release mode.
  run(process.execPath, [join(repoRoot, "scripts", "vendor-notice.js"), ...(isRelease ? ["--check"] : [])], repoRoot);

  log("staging complete — run electron-builder next (npm run package --workspace @deeporca/desktop).");

  // ── Optional smoke check ──────────────────────────────────────────────
  // `--smoke` resolves @deeporca/memory and @deeporca/core from the STAGED
  // node_modules (the same graph the packaged app will use), then inits the
  // memory pipeline against a throwaway data dir. This catches the class of
  // bug where a dep (memory, sqlite-vec, jieba, …) is missing or uninstallable
  // in the staged app even though it resolves fine in the dev monorepo.
  //
  // Run as plain Node — Electron's main process uses ELECTRON_RUN_AS_NODE for
  // the same effect, so a Node resolution smoke is a faithful proxy for the
  // packaged app's import path without needing to launch the full GUI.
  if (process.argv.includes("--smoke")) {
    log("running staged-app smoke check …");
    const smokeSrc = `
      const path = require("path");
      const os = require("os");
      const fs = require("fs");
      const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "deeporca-smoke-"));
      (async () => {
        // Resolve the internal packages from the STAGED node_modules (the same
        // graph the packaged app uses), not the dev monorepo. Each must export
        // its public surface AND its runtime deps must be installable here.
        const { MemoryManager } = await import("@deeporca/memory");
        const { SessionManager } = await import("@deeporca/core");
        const embedding = await import("@deeporca/embedding");
        if (typeof MemoryManager !== "function") throw new Error("MemoryManager export missing");
        if (typeof SessionManager !== "function") throw new Error("SessionManager export missing");
        if (typeof embedding.TransformersEmbeddingService !== "function") {
          throw new Error("@deeporca/embedding TransformersEmbeddingService export missing");
        }
        // embedding's transitive runtime deps must resolve from staging too —
        // a missing onnxruntime-node or @huggingface/transformers would only
        // surface at warmup time in the packaged app.
        require.resolve("@huggingface/transformers");
        require.resolve("onnxruntime-node");
        const mgr = new MemoryManager({
          baseUrl: "http://localhost:0", apiKey: "smoke", model: "smoke", dataDir,
        });
        await mgr.init();
        if (!mgr.isAvailable()) throw new Error("memory manager not available after init");
        await mgr.destroy();
        fs.rmSync(dataDir, { recursive: true, force: true });
        console.log("[smoke] OK: @deeporca/core + memory + embedding + transformers + onnxruntime resolve from staged node_modules");
      })().catch((e) => { console.error("[smoke] FAIL:", e.message); process.exit(1); });
    `;
    const smokeFile = join(stagingDir, "_smoke.cjs");
    writeFileSync(smokeFile, smokeSrc);
    try {
      run(process.execPath, ["_smoke.cjs"], stagingDir);
    } finally {
      try {
        rmSync(smokeFile, { force: true });
      } catch {
        /* ignore */
      }
    }
    log("smoke check passed");
  }
}

try {
  main();
} catch (error) {
  console.error(`[package-desktop] failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
