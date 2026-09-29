// Vendor the MoonViz wasm-gc engine (https://github.com/asdshuaishuai/moonviz)
// into the desktop app as the prototype-generation engine asset.
//
// Single-target discipline (specs/moonviz-engine-replacement): we consume the
// **wasm-gc** variant ONLY — the classic variant (wasmtime-oriented, `_in`
// byte-slot codec) never enters vendor, design, or code paths. Hosts lacking
// WasmGC/js-string builtins fail instantiation with a diagnostic; there is no
// fallback.
//
// Pipeline (mirrors deepDesign scripts/sync-engine.mjs, the production-proven
// reference host — adapted from classic to gc and from Rust/wasmtime to the
// Electron main-process worker):
//   1. Download the pinned GitHub Releases asset (direct → proxy fallback via
//      vendor-download.js) and verify the whole-file sha512 anchor. Mismatch
//      is a hard failure: proxies are third parties, the hash is the only
//      end-to-end attestation.
//   2. Run the instantiation contract probe in a REAL gc-capable runtime:
//      the repo's Electron binary as node (ELECTRON_RUN_AS_NODE=1 — Node 24 /
//      V8 15 with js-string builtins), falling back to the current node when
//      it is >= 24. The repo .nvmrc (22) and plain node 20 cannot instantiate
//      the gc variant — a compile-options failure there would be a false
//      negative, not an engine regression.
//   3. Probe hard-fails on any contract regression: version handshake, batch
//      + session export surface, exact 14-template id set, component catalog
//      dual-gate place probes, session round-trip (canonical envelope ↔
//      reopen render ↔ project-JSON rehydration), gate-block four-segment
//      shape. "New wasm with old components.json silently downstream" must
//      never happen.
//   4. Write vendor/moonviz/{moonviz.wasm, components.json, manifest.json}
//      and the .vendored-moonviz-version marker.
//
// Component probe semantics (deepDesign issue #12): a uniform probe position
// (10,10) cannot represent legal geometry for every component — fill-wide
// components (app_bar/tab_bar/navbar/…) inevitably trigger
// contained_in_parent there. That is a probe artifact, not component debt, so
// agent-gate rejects are WARNED and recorded as gateDebt (real debt belongs
// upstream); only a total probe failure is fatal.
//
// Usage:
//   node scripts/vendor-moonviz-wasm.js            # download + probe (skip when current)
//   node scripts/vendor-moonviz-wasm.js --force    # re-download + re-probe
//
// Env overrides:
//   MOONVIZ_WASM_URL   full asset URL (CI mirror etc.)
//   MOONVIZ_WASM_FILE  local .wasm path (offline dev; skips download, still probed)
//   MOONVIZ_PROBE_BIN  explicit probe runtime binary (defaults: repo electron
//                      as node, else node >= 24)

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { download } from "./vendor-download.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const targetDir = join(repoRoot, "packages", "desktop", "vendor", "moonviz");
const wasmFile = join(targetDir, "moonviz.wasm");
const markerFile = join(targetDir, ".vendored-moonviz-version");

function log(message) {
  console.log(`[vendor-moonviz] ${message}`);
}

function fail(message) {
  console.error(`[vendor-moonviz] ${message}`);
  process.exit(1);
}

// ——— Engine version anchor (upgrade = edit here + rerun + seam tests green) ———
// Baseline lineage: 0.1.6-fix (deepDesign production-validated; wasm/main.mbt
// byte-identical since) → 0.1.6-moon (moonc >= 0.10.14 toolchain gate) →
// 0.1.7 (mooncakes rename "asdshuaishuai/moonviz" + SDK facade; wasm export
// surface unchanged, ENGINE_VERSION bump only).
const ENGINE_VERSION = "0.1.7";
const RELEASE_TAG = `engine-v${ENGINE_VERSION}`;
const WASM_ASSET = `moonviz-wasm-gc-${ENGINE_VERSION}.wasm`; // gc variant ONLY
const WASM_URL =
  process.env.MOONVIZ_WASM_URL ||
  `https://github.com/asdshuaishuai/moonviz/releases/download/${RELEASE_TAG}/${WASM_ASSET}`;
// Whole-file sha512 of the pinned asset (hex) — the only end-to-end
// attestation across direct/proxy fetches.
const WASM_SHA512 =
  "611c21e2681ed87b0de80e51c104c832360b875f3a23676c4c8b0323554096b4cff9edd790607b66dc78154f084b7e8c0b60c6c50a4cba92c37b41a86b2f22ec";
// Transport-level digest for vendor-download.js (refuses to keep bad bytes
// before the sha512 anchor check runs; same asset, same upgrade moment).
const WASM_SHA256 = "9c2174e94e52a9a965f71607f5ecb7f4b582dc4e1fe0d360626add54ada42887";

// Contract expectations (probe hard-fails on drift; see engine-integration-plan §0).
const REQUIRED_BATCH_EXPORTS = [
  "render_mbt",
  "validate_mbt",
  "apply_agent_op",
  "apply_human_op",
  "export_html",
  "list_templates",
  "list_components",
  "list_themes",
  "list_tokens",
  "list_ops",
  "version_info",
];
const REQUIRED_SESSION_EXPORTS = [
  "session_open",
  "session_close",
  "session_save",
  "session_count",
  "session_open_project_json",
  "session_apply_agent",
  "session_apply_human",
  "session_export_svg",
  "session_lint",
  "session_critique",
  "session_auto_fix",
  "session_query_nodes",
  "session_list_artboards",
  "session_flows",
  "session_interactions",
  "session_states",
  "session_spec",
  "session_constrain",
  "session_tap",
  "session_history",
  "session_infer_page_type",
  "session_infer_missing",
  "session_extract_design_system",
  "session_generate_responsive",
  "session_benchmark",
  "session_component_compile_b64",
  "session_library_snapshot",
];
// Exact template id set (14 = 8 mobile + 3 web + 1 pc + 2 adaptive at 0.1.7).
// Additions/renames upstream must bump the anchor consciously, not drift in.
const REQUIRED_TEMPLATE_IDS = [
  "adaptive_landing",
  "dashboard",
  "empty_state",
  "list_detail",
  "login",
  "login_v2",
  "onboarding",
  "pc_app",
  "profile",
  "settings",
  "signup",
  "web_dashboard",
  "web_landing",
  "web_login",
];
const MIN_COMPONENTS = 65;

// Canonical .mbt.md seed: frontmatter + visual code block. `session_open("")`
// returns -1, so cold starts materialize from this constant once.
const SEED_DOC = `---
moonviz:
  format: visual-document
  revision: 1
  entry: __seed
---

# __seed

<!-- moonviz:artboard __seed -->
\`\`\`mbt
fn visual___seed() -> @decl.Prototype {
  let page = @decl.prototype(name="__seed", width=390.0, height=844.0)
  page
}
\`\`\`
`;

// ————————————————————— probe child (runs under Electron-as-node) —————————————————————

function runProbeChild() {
  const wasmPath = process.argv[process.argv.indexOf("--probe-child") + 1];
  const expectedVersion = process.argv[process.argv.indexOf("--probe-child") + 2];
  try {
    const bytes = readFileSync(wasmPath);
    const mod = new WebAssembly.Module(new Uint8Array(bytes), {
      builtins: ["js-string"],
      importedStringConstants: "_",
    });
    const X = new WebAssembly.Instance(mod, {}).exports;

    // 1) Version handshake: instance must self-report the anchor version.
    const ver = JSON.parse(X.version_info());
    if (ver.version !== expectedVersion) {
      throw new Error(`version handshake failed: engine ${ver.version} != anchor ${expectedVersion}`);
    }

    // 2) Export surface: batch + session methods must all be present.
    const names = new Set(WebAssembly.Module.exports(mod).map((e) => e.name));
    const missing = [...REQUIRED_BATCH_EXPORTS, ...REQUIRED_SESSION_EXPORTS].filter((n) => !names.has(n));
    if (missing.length) throw new Error(`missing exports: ${missing.join(",")}`);

    // 3) Template set: exact id match.
    const tplRaw = JSON.parse(X.list_templates());
    const tpl = Array.isArray(tplRaw) ? tplRaw : (tplRaw.templates ?? tplRaw.data ?? []);
    const ids = tpl.map((t) => t.id).sort();
    const want = [...REQUIRED_TEMPLATE_IDS].sort();
    if (ids.join() !== want.join()) {
      throw new Error(`template set drifted: [${ids.join(",")}] != [${want.join(",")}]`);
    }

    // 4) Component catalog + dual-gate place probes (issue #12 semantics).
    const compRaw = JSON.parse(X.list_components());
    const components = Array.isArray(compRaw) ? compRaw : (compRaw.components ?? []);
    if (components.length < MIN_COMPONENTS) {
      throw new Error(`component catalog shrank: ${components.length} < ${MIN_COMPONENTS}`);
    }
    const gateDebt = [];
    let placed = 0;
    for (const c of components) {
      const r = JSON.parse(X.apply_agent_op(SEED_DOC, `place __seed ${c.id} probe_${c.id} - 10 10`));
      if (r.ok) placed++;
      else gateDebt.push(c.id);
    }
    if (placed === 0) throw new Error("component place probes all failed — asset or seed broken");

    // 5) Session round-trip: canonical envelope ↔ reopen render ↔ project-JSON rehydration.
    if (X.session_open("") !== -1) throw new Error('contract: session_open("") must return -1');
    const h = X.session_open(SEED_DOC);
    if (!(h >= 0)) throw new Error(`session_open(seed) failed: ${h}`);
    let env = JSON.parse(X.session_apply_agent(h, "template login t_login 390 844"));
    if (!env.ok) throw new Error(`template op failed: ${JSON.stringify(env).slice(0, 160)}`);
    env = JSON.parse(X.session_apply_agent(h, "place __seed button probe_btn - 24 600 200 48"));
    if (!env.ok) throw new Error(`place op failed: ${JSON.stringify(env).slice(0, 160)}`);
    if (typeof env.mbt !== "string" || !env.mbt.includes("moonviz:artboard")) {
      throw new Error("mutating envelope must echo canonical .mbt.md in `mbt`");
    }
    const saved = JSON.parse(X.session_save(h));
    if (!saved.ok || typeof saved.data !== "string") {
      throw new Error("session_save must return {ok, data: projectJSON}");
    }
    if (X.session_close(h) !== 1) throw new Error("session_close must return 1 on success");
    if (X.session_count() !== 0) throw new Error("session_count must be 0 after close");
    const r1 = JSON.parse(X.render_mbt(env.mbt));
    if (!r1.ok) throw new Error(`render(canonical) failed: ${JSON.stringify(r1).slice(0, 160)}`);
    const h2 = X.session_open(env.mbt);
    const seedBoard = r1.artboards.find((a) => a.id === "__seed");
    const svg2 = JSON.parse(X.session_export_svg(h2, "__seed"));
    if (!svg2.ok || (svg2.svg ?? svg2.data?.svg) !== seedBoard.svg) {
      throw new Error("reopen-canonical session SVG must match batch render byte-for-byte");
    }
    X.session_close(h2);
    const h3 = X.session_open_project_json(saved.data);
    if (!(h3 >= 0)) throw new Error(`open_project_json rehydration failed: ${h3}`);
    const svg3 = JSON.parse(X.session_export_svg(h3, "__seed"));
    if (!svg3.ok) throw new Error("rehydrated session must export SVG");
    X.session_close(h3);

    // 6) Gate rejection shape: single-block four-segment string.
    const bad = JSON.parse(X.apply_agent_op(SEED_DOC, "place __seed button oob - 99999 99999 200 48"));
    if (bad.ok || !/^mbt_gate_block:[^:]+:[^:]+:[^:]+$/.test(bad.error ?? "")) {
      throw new Error(`gate block shape drifted: ${JSON.stringify(bad).slice(0, 160)}`);
    }

    process.stdout.write(
      JSON.stringify({
        ok: true,
        runtime: `${process.versions.node} (v8 ${process.versions.v8})`,
        exports: names.size,
        templates: ids.length,
        components: components.map((c) => ({ id: c.id, name: c.name, variants: c.variants ?? [] })),
        gateDebt,
      })
    );
  } catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, error: String(error?.message ?? error) }));
  }
  // Exit 0 either way: the JSON report carries the verdict, and a non-zero
  // child status would read as "probe runtime crashed" to the parent.
}

if (process.argv.includes("--probe-child")) {
  runProbeChild();
} else {
  await vendorMain();
}

// ————————————————————————— parent —————————————————————————

function sha512Of(file) {
  return createHash("sha512").update(readFileSync(file)).digest("hex");
}

/** Resolve a gc-capable probe runtime: repo Electron as node, else node >= 24. */
function probeRuntime() {
  if (process.env.MOONVIZ_PROBE_BIN) {
    return { bin: process.env.MOONVIZ_PROBE_BIN, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } };
  }
  const electronBin = join(
    repoRoot,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "electron.cmd" : "electron"
  );
  if (existsSync(electronBin)) {
    return { bin: electronBin, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } };
  }
  const [major] = process.versions.node.split(".").map(Number);
  if (major >= 24) return { bin: process.execPath, env: { ...process.env } };
  return null;
}

async function vendorMain() {
  const force = process.argv.includes("--force");
  mkdirSync(targetDir, { recursive: true });
  const anchor = `${ENGINE_VERSION} ${WASM_SHA512.slice(0, 16)}`;

  if (!force && existsSync(markerFile)) {
    const marker = readFileSync(markerFile, "utf8").trim();
    if (marker === anchor && existsSync(wasmFile) && sha512Of(wasmFile) === WASM_SHA512) {
      log(`up-to-date (${RELEASE_TAG}) — skipping.`);
      return;
    }
  }

  // 1) Acquire bytes: local override, or download with sha512 verification.
  if (process.env.MOONVIZ_WASM_FILE) {
    const src = resolve(process.env.MOONVIZ_WASM_FILE);
    if (!existsSync(src)) fail(`MOONVIZ_WASM_FILE not found: ${src}`);
    writeFileSync(wasmFile, readFileSync(src));
    log(`copied local asset ${src}`);
  } else {
    await download(WASM_URL, wasmFile, (m) => log(m), WASM_SHA256);
  }
  const actual = sha512Of(wasmFile);
  if (actual !== WASM_SHA512) {
    fail(`sha512 anchor mismatch for ${WASM_ASSET}\n  want ${WASM_SHA512}\n  got ${actual}`);
  }
  log(`asset verified: ${WASM_ASSET} (${(readFileSync(wasmFile).length / 1024).toFixed(0)}KB, sha512 ✓)`);

  // 2) Instantiation contract probe in a gc-capable runtime (hard fail).
  const runtime = probeRuntime();
  if (!runtime) {
    fail(
      "no gc-capable probe runtime: repo electron binary not found and node < 24 " +
        `(current ${process.versions.node}). The wasm-gc variant needs js-string builtins ` +
        "(Electron main process or Node >= 24). Install dependencies or set MOONVIZ_PROBE_BIN."
    );
  }
  const self = fileURLToPath(import.meta.url);
  const probe = spawnSync(runtime.bin, [self, "--probe-child", wasmFile, ENGINE_VERSION], {
    env: runtime.env,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (probe.error) fail(`probe runtime failed to start: ${probe.error.message}`);
  let report;
  try {
    report = JSON.parse(probe.stdout?.trim() ?? "");
  } catch {
    fail(`probe produced no JSON report (exit ${probe.status}): ${(probe.stderr ?? "").slice(0, 400)}`);
  }
  if (!report.ok) fail(`contract probe failed: ${report.error}`);
  log(
    `probe ✓ ${report.runtime} — ${report.exports} exports, ${report.templates} templates, ` +
      `${report.components.length} components` +
      (report.gateDebt.length ? ` (gateDebt warn: ${report.gateDebt.join(",")})` : "")
  );

  // 3) Artifacts: component snapshot + manifest + marker.
  writeFileSync(
    join(targetDir, "components.json"),
    JSON.stringify({ engineVersion: ENGINE_VERSION, components: report.components }, null, 2) + "\n"
  );
  writeFileSync(
    join(targetDir, "manifest.json"),
    JSON.stringify(
      {
        engineVersion: ENGINE_VERSION,
        releaseTag: RELEASE_TAG,
        source: process.env.MOONVIZ_WASM_FILE ? "local-file" : WASM_URL,
        sha512: WASM_SHA512,
        templates: report.templates,
        componentCount: report.components.length,
        gateDebt: report.gateDebt,
        probeRuntime: report.runtime,
        generatedAt: new Date().toISOString(),
      },
      null,
      2
    ) + "\n"
  );
  writeFileSync(markerFile, `${anchor}\n`);
  log(`done → ${targetDir} (${RELEASE_TAG}, ${report.components.length} components snapshotted)`);
}
