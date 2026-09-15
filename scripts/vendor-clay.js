// Vendor nicbarker/clay (https://github.com/nicbarker/clay) — the C layout
// engine behind the clay-ui-runtime spec (specs/clay-ui-runtime): UI-Design's
// parallel render/export runtime (specs/clay-ui-runtime/design.md §2).
//
// Pin discipline: upstream has NO semantic releases (checked 2026-09-15), so
// the pin is a commit SHA. The vendored artifact is NOT upstream's prebuilt
// renderers/web/clay.wasm — that artifact instantiates-fails (see §upstream-bug)
// — instead we compile from the pinned source with a one-line header patch.
//
// §upstream-bug (2026-09-15): clay.h attaches CLAY_WASM_EXPORT("Clay_SetLayoutDimensions")
// to BOTH Clay_SetLayoutDimensions (L4070) and Clay_GetLayoutDimensions (L4077)
// — a copy-paste slip. Under wasm every export_name must be unique, so
// WebAssembly.instantiate fails with "Duplicate export name". The vendor build
// rewrites the second occurrence to "Clay_GetLayoutDimensions" (see
// patchClayHeader below). If upstream fixes it, the patch no-ops automatically.
//
// CJK note (WP0 spike, D:\others\clay-spike\SPIKE-REPORT.md): Clay splits words
// on ' ' and '\n' only — CJK runs are single words and overflow. Line breaking
// for CJK is the COMPILER's job (WP2 compileLeaferToClayTree inserts '\n' via
// measure-driven greedy fill); it is NOT solved by this vendored wasm.
//
// Toolchain: the wasm build needs clang with wasm32 support (wasm-ld). Probe
// order: host `clang` → WSL distro (CLAY_WSL_DISTRO, default first `wsl -l -q`
// entry). Machines without a toolchain keep the committed artifacts (the wasm
// + fingerprint are committed to git — KB-scale, Zlib allows redistribution);
// building is only required when bumping the pin.
//
// Usage:
//   node scripts/vendor-clay.js            # install/refresh (no-op when pinned)
//   node scripts/vendor-clay.js --force    # force rebuild
//
// Env overrides:
//   CLAY_REF         (default: the pinned SHA; any ref for a one-off preview)
//   CLAY_SRC         (default: vendor-src/clay; path to an existing local clone)
//   CLAY_WSL_DISTRO  (default: first `wsl -l -q` entry; WSL clang fallback)

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { withAtomicSwap } from "./vendor-fs.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const cloneDir = join(repoRoot, "vendor-src", "clay");
const buildDir = join(repoRoot, "vendor-src", "clay-build");
const targetDir = join(repoRoot, "packages", "desktop", "vendor", "clay");
const headFile = join(targetDir, ".vendored-head");
const bindingsSource = join(__dirname, "vendor", "clay-bindings.c");
const force = process.argv.includes("--force");

const REPO_URL_HTTPS = "https://github.com/nicbarker/clay.git";
const REPO_URL_SSH = "git@github.com:nicbarker/clay.git";
/** Reviewed upstream commit — bump deliberately (see header). Upstream has no tags. */
const PINNED_SHA = "e6cc36941ab2af5d81107617039d6f527a1c660b";
/** clay.h patch: the misplaced duplicate export name (see §upstream-bug). */
const BAD_EXPORT = 'CLAY_WASM_EXPORT("Clay_SetLayoutDimensions")';
const GOOD_EXPORT = 'CLAY_WASM_EXPORT("Clay_GetLayoutDimensions")';
/** Matches build-wasm.sh upstream; generous initial memory for text arenas. */
const INITIAL_MEMORY_PAGES = "6553600";

function log(message) {
  console.log(`[vendor-clay] ${message}`);
}

function run(cmd, args) {
  return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}

function currentPinnedHead() {
  try {
    return readFileSync(headFile, "utf8").trim();
  } catch {
    return null;
  }
}

function toMntPath(windowsPath) {
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(windowsPath);
  if (!m) throw new Error(`cannot convert to a WSL path: ${windowsPath}`);
  return `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, "/")}`;
}

function ensureClone() {
  mkdirSync(join(repoRoot, "vendor-src"), { recursive: true });
  const localOverride = process.env.CLAY_SRC;
  if (localOverride) {
    if (!existsSync(join(localOverride, ".git"))) throw new Error(`CLAY_SRC points at a non-clone: ${localOverride}`);
    log(`using CLAY_SRC local clone: ${localOverride}`);
    return localOverride;
  }
  if (!existsSync(join(cloneDir, ".git"))) {
    log(`cloning ${REPO_URL_HTTPS} (shallow)…`);
    try {
      run("git", ["clone", "--depth", "1", REPO_URL_HTTPS, cloneDir]);
    } catch {
      log("https clone failed — retrying over SSH (git@github.com:443)…");
      run("git", ["clone", "--depth", "1", REPO_URL_SSH, cloneDir]);
    }
  }
  return cloneDir;
}

function checkoutPinned(clone) {
  const ref = process.env.CLAY_REF || PINNED_SHA;
  run("git", ["-C", clone, "fetch", "--force", "origin"]);
  run("git", ["-C", clone, "checkout", "--force", ref]);
  return run("git", ["-C", clone, "rev-parse", "HEAD"]).trim();
}

/** Patch the duplicate wasm export name (upstream bug) into a header copy. */
function writePatchedHeader(clone, staging) {
  const source = readFileSync(join(clone, "clay.h"), "utf8");
  const first = source.indexOf(BAD_EXPORT);
  const second = source.indexOf(BAD_EXPORT, first + 1);
  let patched = source;
  let patchApplied = false;
  if (second >= 0) {
    patched = source.slice(0, second) + GOOD_EXPORT + source.slice(second + BAD_EXPORT.length);
    patchApplied = true;
  } else if (first < 0) {
    throw new Error("upstream clay.h no longer exports Clay_SetLayoutDimensions — re-review the patch");
  }
  writeFileSync(join(staging, "clay-patched.h"), patched, "utf8");
  return patchApplied;
}

/** Toolchain probe: host clang → WSL distro clang. Returns {cmd, prefix, version} or null. */
function probeToolchain() {
  try {
    const version = run("clang", ["--version"]).split("\n")[0];
    return { cmd: "clang", prefix: [], version };
  } catch {
    /* host clang absent */
  }
  try {
    const raw = run("wsl", ["-l", "-q"]);
    const distros = raw
      .toString("utf16le")
      .split(/\r?\n/)
      .map((line) => line.replace(/\0/g, "").trim())
      .filter(Boolean);
    const distro = process.env.CLAY_WSL_DISTRO || distros[0];
    if (!distro) return null;
    const version = run("wsl", ["-d", distro, "--", "sh", "-c", "clang --version | head -1"]);
    return { cmd: "wsl", prefix: ["-d", distro, "--", "sh", "-c"], version: version.trim() };
  } catch {
    return null;
  }
}

/** Fingerprint the bindings source so stale committed artifacts announce themselves. */
function bindingsFingerprint() {
  return createHash("sha256").update(readFileSync(bindingsSource)).digest("hex").slice(0, 16);
}

/** Compile patched header + bindings shim into clay.wasm (single TU). WSL needs /mnt paths. */
function compileWasm(toolchain, clone, staging) {
  copyFileSync(bindingsSource, join(staging, "clay-bindings.c"));
  const bindings = readFileSync(join(staging, "clay-bindings.c"), "utf8");
  writeFileSync(
    join(staging, "clay-impl.c"),
    '#define CLAY_IMPLEMENTATION\n#include "clay-patched.h"\n' + bindings,
    "utf8"
  );
  const flags =
    "-Os -fno-builtin -DCLAY_WASM -mbulk-memory --target=wasm32 -nostdlib " +
    "-Wl,--strip-all -Wl,--export-dynamic -Wl,--no-entry -Wl,--export=__heap_base " +
    "-Wl,--export-memory -Wl,--initial-memory=6553600";
  const outPath = join(staging, "clay.wasm");
  if (toolchain.cmd === "clang") {
    const args = [...toolchain.prefix, ...flags.split(" "), "-I", staging, "-o", outPath, join(staging, "clay-impl.c")];
    run(toolchain.cmd, args);
  } else {
    const wslStaging = toMntPath(staging);
    const args = [...toolchain.prefix, `cd ${wslStaging} && clang ${flags} -I . -o clay.wasm clay-impl.c`];
    run(toolchain.cmd, args);
  }
  if (!existsSync(outPath)) throw new Error("clang produced no clay.wasm");
  return outPath;
}

async function main() {
  const requestedRef = process.env.CLAY_REF || PINNED_SHA;
  mkdirSync(join(repoRoot, "vendor-src"), { recursive: true });

  const clone = ensureClone();
  log(`fetching + checking out ${requestedRef}…`);
  const head = checkoutPinned(clone);

  if (!force && currentPinnedHead() === head && existsSync(join(targetDir, "clay.wasm"))) {
    // .vendored-head only tracks the upstream pin — a bindings-source edit does
    // NOT bump it. Fingerprint clay-bindings.c so a stale committed artifact
    // (wasm built before the source changed) announces itself loudly instead
    // of silently missing exports at runtime (real bug 2026-09-15:
    // bind_set_floating shipped missing).
    const versionFile = join(targetDir, "version.json");
    const built = existsSync(versionFile) ? JSON.parse(readFileSync(versionFile, "utf8")) : null;
    const current = bindingsFingerprint();
    if (built?.bindings !== current) {
      log(
        `WARNING: clay-bindings.c changed since this wasm was built (fingerprint ${built?.bindings ?? "none"} ≠ current ${current}) — the committed artifact is STALE and may miss exports. Rebuild with --force on a wasm32-capable clang.`
      );
    }
    log(`already vendored @ ${head.slice(0, 10)} — up to date (use --force to rebuild)`);
    return;
  }

  const toolchain = probeToolchain();
  if (!toolchain) {
    throw new Error(
      "no wasm-capable clang found (host clang or WSL distro). The committed vendor/clay artifacts keep working; install LLVM or set CLAY_WSL_DISTRO to rebuild."
    );
  }

  mkdirSync(buildDir, { recursive: true });
  const patchApplied = writePatchedHeader(clone, buildDir);
  const wasmPath = compileWasm(toolchain, clone, buildDir);

  await withAtomicSwap(targetDir, {
    build: (staging) => {
      copyFileSync(wasmPath, join(staging, "clay.wasm"));
      copyFileSync(join(buildDir, "clay-patched.h"), join(staging, "clay-patched.h"));
      writeFileSync(
        join(staging, "version.json"),
        JSON.stringify(
          {
            commit: head,
            patched: patchApplied,
            patchReason: patchApplied ? "upstream duplicate wasm export name (SetLayoutDimensions)" : "none",
            clang: toolchain.version,
            bindings: bindingsFingerprint(),
            builtAt: new Date().toISOString(),
          },
          null,
          2
        ) + "\n",
        "utf8"
      );
      writeFileSync(join(staging, ".vendored-head"), head, "utf8");
    },
    log,
  });
  log(`vendored clay.wasm @ ${head.slice(0, 10)} (patched: ${patchApplied})`);
}

try {
  await main();
} catch (error) {
  if (currentPinnedHead() && existsSync(join(targetDir, "clay.wasm"))) {
    const reason = error instanceof Error ? error.message : String(error);
    log(`vendor refresh failed (${reason}) — keeping existing vendored copy`);
  } else {
    throw error;
  }
}
