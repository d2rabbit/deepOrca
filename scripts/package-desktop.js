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

function run(command, args, cwd) {
  const needsShell = isWindows && command === "npm";
  execFileSync(command, args, { cwd, stdio: "inherit", shell: needsShell });
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
  const electronVersion = readJson(join(repoRoot, "node_modules", "electron", "package.json")).version;

  // ── Step 1: fresh staging dir with a generated standalone package.json ──
  log(`staging → ${stagingDir}`);
  rmSync(stagingDir, { recursive: true, force: true });
  mkdirSync(stagingDir, { recursive: true });

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
    // Core stays external in the main bundle → ship its runtime deps.
    // ocr (Open Code Review) ships as an npm dep so the app runs the vendored
    // binary without requiring a global install (see resolveOcrCommand in main).
    dependencies: {
      ...corePkg.dependencies,
      "@alibaba-group/open-code-review": desktopPkg.dependencies["@alibaba-group/open-code-review"],
    },
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

  // ── Step 3: copy built app output ──
  // (vendor/ is NOT staged here: electron-builder's app-files copier strips
  // nested node_modules. It ships via `extraResources` in electron-builder.yml,
  // copied verbatim from packages/desktop/vendor into Resources/app/vendor.)
  log("copying dist/ …");
  cpSync(join(desktopDir, "dist"), join(stagingDir, "dist"), { recursive: true });

  for (const name of ["codegraph", "openwiki"]) {
    if (!existsSync(join(desktopDir, "vendor", name))) {
      log(`vendor/${name} missing — packaged app will fall back to npx at runtime.`);
    }
  }

  log("staging complete — run electron-builder next (npm run package --workspace @deeporca/desktop).");
}

try {
  main();
} catch (error) {
  console.error(`[package-desktop] failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
