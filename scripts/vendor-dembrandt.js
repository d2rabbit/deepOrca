// Vendor dembrandt (https://dembrandt.com, npm package `dembrandt`) into the
// desktop app — OFFLINE-FIRST runtime (E1e).
//
// dembrandt is a website design-token extraction engine whose runtime until now
// was `npx -y --package dembrandt@0.28.0 …`, i.e. a registry fetch on every
// cold machine. This script installs the pinned package ONCE at build time into
// packages/desktop/vendor/dembrandt (isolated node_modules), so the packaged
// app spawns the vendored CLI with zero network.
//
// What is deliberately NOT vendored: any browser binary. dembrandt drives
// browsers through playwright-core (a plain dependency, no browser download);
// when no browser is provisioned, extraction fails fast with dembrandt's own
// "browser engine not available" error — it never downloads at runtime
// (verified in dist/lib/browser.js + install-browser.js of dembrandt@0.28.0:
// the only downloader is the explicit `dembrandt install-browser` subcommand,
// which DeepOrca never invokes). See common/dembrandt.ts for how the browser
// cache is pointed at an offline-provisioned directory.
//
// Install flags (all load-bearing):
//   --omit=dev        no devDependencies (playwright, tailwindcss, …)
//   --omit=optional   skips onnxruntime-node (~30MB native, optionalDependencies —
//                     only used by the experimental `--ai` flag, degrades gracefully)
//   --ignore-scripts  no dependency lifecycle script runs at install time — no
//                     postinstall of any kind can download anything
//   --no-save --no-package-lock --no-audit --no-fund  isolated throwaway install
// The optional `playwright` peer is NOT auto-installed (peerDependenciesMeta
// marks it optional), so no full playwright tree — and playwright 1.61.1 ships
// no install scripts anyway. Measured installed tree (113 packages): ~29.5MB
// raw, ~26.5MB after pruning sourcemaps + dembrandt's bundled test files.
//
// Usage:
//   node scripts/vendor-dembrandt.js            # install/refresh
//   node scripts/vendor-dembrandt.js --force    # force reinstall
//
// Env overrides:
//   DEMBRANDT_VERSION  (default: pinned 0.28.0)

import { execFileSync } from "node:child_process";
import { assertSafeVersion } from "./vendor-download.js";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { withAtomicSwap } from "./vendor-fs.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const targetDir = join(repoRoot, "packages", "desktop", "vendor", "dembrandt");
const versionFile = join(targetDir, ".vendored-dembrandt-version");
const force = process.argv.includes("--force");

// Pinned version — same pin the npx fallback in common/dembrandt.ts uses.
const DEMBRANDT_VERSION = "0.28.0";

function log(message) {
  console.log(`[vendor-dembrandt] ${message}`);
}

/**
 * Resolve the npm CLI as a JS entry (argv-form `node <npm-cli.js> …`), never a
 * shell string and never `npm`/`npm.cmd` via PATH (execFileSync cannot spawn
 * .cmd without a shell on Windows — and a PATH lookup is an externally
 * influenceable dynamic value).
 *
 * Candidates, in order:
 * 1. `npm_execpath` — set whenever we run under an npm lifecycle script.
 * 2. `<dirname(process.execPath)>/node_modules/npm/bin/npm-cli.js` — the
 *    standard Node (and nvm-windows) install layout.
 * 3. null → caller falls back to a plain "npm" argv (POSIX hosts).
 */
function resolveNpmCli() {
  const candidates = [];
  if (process.env.npm_execpath) candidates.push(process.env.npm_execpath);
  candidates.push(join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"));
  for (const candidate of candidates) {
    // SECURITY (same sink-validation rule as assertSafeVersion): the value may
    // come from the environment, so verify it before handing it to execFileSync
    // — absolute, no traversal segments, exactly the npm CLI entry, on disk.
    if (
      typeof candidate === "string" &&
      candidate.length > 0 &&
      isAbsolute(candidate) &&
      candidate.endsWith("npm-cli.js") &&
      !candidate.split(/[\\/]/).includes("..")
    ) {
      try {
        if (statSync(candidate).isFile()) return candidate;
      } catch {
        // Candidate doesn't exist — try the next.
      }
    }
  }
  return null;
}

/** Run npm with argv form (no shell). Throws on non-zero exit. */
function runNpm(args, opts) {
  const npmCli = resolveNpmCli();
  if (npmCli) {
    // SECURITY: argv form, never a shell string; args are static flags + the
    // assertSafeVersion-validated package spec.
    execFileSync(process.execPath, [npmCli, ...args], opts);
    return;
  }
  // POSIX fallback: bare `npm` resolves on PATH without a shell there.
  execFileSync("npm", args, opts);
}

/** Total size (bytes) of a directory tree, excluding symlink double-counting. */
function dirSize(dir) {
  let total = 0;
  let stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const p = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(p);
      } else if (entry.isFile()) {
        total += statSync(p).size;
      }
    }
  }
  return total;
}

function mb(bytes) {
  return `${(bytes / 1048576).toFixed(1)}MB`;
}

/**
 * Prune what the runtime never reads, keeping the installer delta small:
 *  - `*.map` sourcemaps (every package ships them; nothing imports them at
 *    runtime — stack traces still render, just unminified-positioned),
 *  - dembrandt's own bundled test suite + fixtures (dist/test/** — shipped in
 *    the tarball, executed only by upstream's `npm test`).
 */
function pruneTree(nodeModulesDir) {
  let removedFiles = 0;
  let removedBytes = 0;
  const pruneDir = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) {
        pruneDir(p);
      } else if (entry.isFile() && entry.name.endsWith(".map")) {
        removedBytes += statSync(p).size;
        removedFiles += 1;
        rmSync(p);
      }
    }
  };
  pruneDir(nodeModulesDir);
  const distTest = join(nodeModulesDir, "dembrandt", "dist", "test");
  if (existsSync(distTest)) {
    const before = dirSize(distTest);
    rmSync(distTest, { recursive: true, force: true });
    removedBytes += before;
    removedFiles += 1; // Counted as one unit for the log line.
  }
  return { removedFiles, removedBytes };
}

async function main() {
  const version = assertSafeVersion(process.env.DEMBRANDT_VERSION ?? DEMBRANDT_VERSION, "DEMBRANDT_VERSION");
  const previousVersion = existsSync(versionFile) ? readFileSync(versionFile, "utf8").trim() : null;
  // Bin targets inside the install (dembrandt's package.json bin map:
  // dembrandt → dist/index.js, dembrandt-mcp → dist/mcp-server.js). The core
  // resolver (common/dembrandt.ts) spawns these via a node runner — argv form.
  const cliEntry = join("node_modules", "dembrandt", "dist", "index.js");
  const mcpEntry = join("node_modules", "dembrandt", "dist", "mcp-server.js");

  // Vendor integrity includes the build-time system-browser patch. A marker
  // alone is insufficient: an older unpatched tree would still force a browser
  // download at runtime. Force one atomic rebuild when the patch marker is absent.
  const browserPatchMarker = join(targetDir, ".deeporca-system-browser-patch");
  if (
    version === previousVersion &&
    existsSync(join(targetDir, cliEntry)) &&
    existsSync(join(targetDir, mcpEntry)) &&
    existsSync(browserPatchMarker) &&
    !force
  ) {
    log(`up-to-date (v${version}) — skipping install.`);
    log(`vendored tree size: ${mb(dirSize(targetDir))} (${targetDir})`);
    return;
  }

  log(`installing dembrandt@${version} (prev: ${previousVersion ?? "none"}) …`);

  // Atomic swap: install into a staging dir, swap into place only when both bin
  // entries exist (withAtomicSwap keeps a known-good previous copy on failure).
  await withAtomicSwap(targetDir, {
    log,
    tag: "dembrandt",
    build: async (staging) => {
      const tempInstall = join(staging, "_npm_install");
      mkdirSync(tempInstall, { recursive: true });
      // Dummy package.json so npm doesn't traverse up to the workspace root.
      writeFileSync(join(tempInstall, "package.json"), '{"name":"_dembrandt_vendor","private":true}');
      runNpm(
        [
          "install",
          "--no-save",
          "--no-package-lock",
          "--no-audit",
          "--no-fund",
          "--omit=dev",
          "--omit=optional",
          "--ignore-scripts",
          `dembrandt@${version}`,
        ],
        { cwd: tempInstall, stdio: "inherit" }
      );

      // Keep npm's natural layout: <vendor>/node_modules/dembrandt/... — the
      // core resolver expects the bin js under node_modules/dembrandt/dist.
      const tempNodeModules = join(tempInstall, "node_modules");
      const npmPkgDir = join(tempNodeModules, "dembrandt");
      if (!existsSync(join(npmPkgDir, "dist", "index.js")) || !existsSync(join(npmPkgDir, "dist", "mcp-server.js"))) {
        throw new Error(
          `install succeeded but dembrandt bin entries missing under ${npmPkgDir} — refusing to write a broken vendor marker`
        );
      }
      if (!existsSync(join(tempNodeModules, "playwright-core", "package.json"))) {
        throw new Error("install succeeded but playwright-core missing — dembrandt cannot launch a browser without it");
      }
      if (existsSync(join(tempNodeModules, "onnxruntime-node"))) {
        throw new Error(
          "onnxruntime-node installed despite --omit=optional — refusing to vendor the native optional dep"
        );
      }

      // Patch the upstream Playwright launch sites to prefer a CDP endpoint
      // (DEMBRANDT_CDP_ENDPOINT) before falling back to a plain launch.
      // dembrandt 0.28.0 only honors BROWSER_CDP_ENDPOINT on the CLI surface —
      // the MCP server and PDF renderer have no CDP path at all — and none of
      // them expose a system-browser channel/executablePath option. DeepOrca
      // serves the browser from Electron's built-in Chromium over CDP
      // (main/tools/dembrandt-browser.ts), so all three launch sites must take
      // the endpoint. Version-pinned and fail-closed: an upstream shape change
      // aborts vendoring rather than silently reintroducing a browser download.
      const cdpBranch =
        "\n    const __deeporcaCdp = process.env.DEMBRANDT_CDP_ENDPOINT || process.env.BROWSER_CDP_ENDPOINT || null;\n";
      const launchFiles = [
        // CLI: upstream already connects over CDP when BROWSER_CDP_ENDPOINT is
        // set (index.js); we widen it to also honor DEMBRANDT_CDP_ENDPOINT by
        // aliasing it into the env var the upstream check reads.
        [
          join(npmPkgDir, "dist", "index.js"),
          "if (process.env.BROWSER_CDP_ENDPOINT) {",
          "if (!process.env.BROWSER_CDP_ENDPOINT && process.env.DEMBRANDT_CDP_ENDPOINT) { process.env.BROWSER_CDP_ENDPOINT = process.env.DEMBRANDT_CDP_ENDPOINT; }\n            if (process.env.BROWSER_CDP_ENDPOINT) {",
        ],
        // MCP server: replace the whole plain-launch statement with a
        // CDP-first branch (complete statement swap — balanced by construction).
        [
          join(npmPkgDir, "dist", "mcp-server.js"),
          'browser = await chromium.launch({\n            headless: true,\n            args: ["--disable-blink-features=AutomationControlled"],\n        });',
          cdpBranch +
            '    browser = __deeporcaCdp\n        ? await chromium.connectOverCDP(__deeporcaCdp)\n        : await chromium.launch({ headless: true, args: ["--disable-blink-features=AutomationControlled"] });',
        ],
        // PDF formatter: same CDP-first branch (complete statement swap).
        [
          join(npmPkgDir, "dist", "lib", "formatters", "pdf.js"),
          "browser = await chromium.launch({ headless: true });",
          "const __deeporcaCdp = process.env.DEMBRANDT_CDP_ENDPOINT || process.env.BROWSER_CDP_ENDPOINT || null;\n        browser = __deeporcaCdp ? await chromium.connectOverCDP(__deeporcaCdp) : await chromium.launch({ headless: true });",
        ],
      ];
      for (const [file, needle, replacement] of launchFiles) {
        const source = readFileSync(file, "utf8");
        const occurrences = source.split(needle).length - 1;
        if (occurrences !== 1) {
          throw new Error(`dembrandt CDP patch expected exactly one match in ${file}, found ${occurrences}`);
        }
        writeFileSync(file, source.replace(needle, replacement), "utf8");
      }

      // Move the patched isolated node_modules to the staging root.
      const { renameSync } = await import("node:fs");
      renameSync(tempNodeModules, join(staging, "node_modules"));
      rmSync(tempInstall, { recursive: true, force: true });

      const rawSize = dirSize(join(staging, "node_modules"));
      const { removedBytes } = pruneTree(join(staging, "node_modules"));
      log(`pruned ${mb(removedBytes)} of sourcemaps + upstream test files`);

      // Write the version + patch markers atomically with the swap.
      writeFileSync(join(staging, ".vendored-dembrandt-version"), version);
      writeFileSync(join(staging, ".deeporca-system-browser-patch"), "1\n");
      log(`installed tree: ${mb(rawSize)} raw → ${mb(dirSize(join(staging, "node_modules")))} pruned`);
    },
    verify: (staging) =>
      existsSync(join(staging, cliEntry)) &&
      existsSync(join(staging, mcpEntry)) &&
      existsSync(join(staging, ".deeporca-system-browser-patch")),
  });

  log(`done → ${targetDir} (dembrandt v${version})`);
  log(
    `vendored tree size: ${mb(dirSize(targetDir))} — no browser binary included (see common/dembrandt.ts for offline provisioning)`
  );
}

try {
  await main();
} catch (error) {
  console.error(`[vendor-dembrandt] failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
