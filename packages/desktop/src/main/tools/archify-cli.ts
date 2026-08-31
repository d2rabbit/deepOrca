/**
 * ArchifyCli — desktop runner for the vendored archify skill package
 * (https://github.com/tt-a1i/archify, git-pinned by scripts/vendor-archify.js).
 *
 * archify turns a typed JSON IR (`.architecture.json` & friends) into
 * validated, self-contained interactive HTML diagrams. Its `deliver` command
 * is a DETERMINISTIC acceptance gate: schema + layout + render checks must all
 * pass before the HTML is atomically committed — the same "never trust a
 * hollow artifact" contract this codebase enforces everywhere else, bought
 * ready-made instead of hand-rolled (user decision 2026-08-29: 摒弃自有
 * mermaid 方案，采用 archify).
 *
 * Runs under Electron-as-Node (archify is pure ESM JavaScript with zero
 * runtime deps), so no system-Node dependency is introduced.
 */

import * as fs from "node:fs";
import { createRequire as nodeCreateRequire } from "node:module";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Post-deliver patches for delivered archify HTML (desktop viewer tweaks the
 * vendored viewer doesn't offer switches for). All are idempotent: previous
 * blocks are stripped and the current ones re-inserted, so already-delivered
 * artifacts converge in place and callers can re-pin the receipt when the
 * file changed.
 *
 *  1. Passport tracking (user ask 2026-08-30: 浮窗悬浮在对应节点周边，而不是
 *     固定在左上角). The archify viewer pins the chip at a fixed `left:1rem`
 *     and its own placement only nudges the vertical position, so the panel
 *     sits in the corner no matter where the node is. The patch overrides the
 *     chip's left/top with CSS variables and places it beside the focused
 *     node (right side preferred, flips left near the container edge,
 *     vertically centered) on every show + pan/zoom/scroll/resize. v2 fix:
 *     v1 read a `data-node-id` attribute the archify template never sets on
 *     the chip, so it silently no-op'd — v2 derives the focused node from the
 *     viewer's real state (the selected node carries `data-focus-selected`,
 *     the svg carries `data-focus-active="<id>"`).
 *
 *  2. Presentation lock (user ask 2026-08-30: 去掉 Present/Exit 能力，始终
 *     保持放大状态). The desktop always wants the viewport-filling stage —
 *     the panel iframe loads `?present=1` and the preview window loads bare.
 *     The patch force-sets `data-present` regardless of URL, hides the
 *     toolbar Present/Exit button and the diagram-guide entry, and neuters
 *     every toggle path (F / Escape keys, guide action, button click) so the
 *     stage can't be left.
 *
 *  3. Theme sync (2026-08-30: 图板跟随应用明暗). The frame listens for a
 *     validated `{type:"deeporca-theme"}` postMessage from the host page and
 *     re-applies the viewer theme, so the embedded board tracks the app
 *     appearance live instead of only at load time.
 *
 *  A fourth experiment (guided-rail restyle: compact row → side drawer →
 *  floating TOC) was REVERTED on user decision 2026-08-30 — the stock
 *  top-band rail wins. The rail-compact strip regex above stays so
 *  already-delivered files carrying any of those iterations converge back
 *  to the stock band on the next sweep.
 */
function applyViewerPatches(htmlPath: string): boolean {
  try {
    const html = fs.readFileSync(htmlPath, "utf-8");
    // Strip any previous desktop-patch blocks (e.g. the inert passport v1)
    // so already-delivered artifacts converge on the current patches.
    const stripped = html
      .replace(/<style id="deeporca-passport-track[^"]*"[\s\S]*?<\/script>/g, "")
      .replace(/<style id="deeporca-present-lock[^"]*"[\s\S]*?<\/script>/g, "")
      .replace(/<style id="deeporca-theme-sync[^"]*"[\s\S]*?<\/script>/g, "")
      .replace(/<style id="deeporca-rail-compact[^"]*"[\s\S]*?<\/script>/g, "");
    const idx = stripped.indexOf("</body>");
    if (idx < 0) return false;
    const patched = `${stripped.slice(0, idx)}${passportPatch()}${presentLockPatch()}${themeSyncPatch()}${stripped.slice(idx)}`;
    if (patched === html) return false;
    // Temp + rename: file:// readers (the embed iframe, preview windows) load
    // these HTMLs out-of-process — a truncated mid-write file renders broken
    // with no retry (red-team D-1, 2026-08-30).
    const tmp = `${htmlPath}.patching`;
    fs.writeFileSync(tmp, patched, "utf-8");
    fs.renameSync(tmp, htmlPath);
    return true;
  } catch {
    return false; // best-effort — the viewer just keeps its stock behavior
  }
}

function passportPatch(): string {
  return `<style id="deeporca-passport-track">
.focus-chip{left:var(--dp-x,1rem)!important;top:var(--dp-y,1rem)!important;transition:none!important}
</style>
<script>
(function(){
  var chip=document.getElementById('focus-chip');
  if(!chip)return;
  var svg=document.querySelector('.diagram-container svg');
  var frame=0;
  function focusNode(){
    var node=svg&&svg.querySelector('[data-node-id][data-focus-selected]');
    if(node)return node;
    var active=svg?svg.getAttribute('data-focus-active'):'';
    if(!active)return null;
    var id=active.trim().split(/\\s+/)[0];
    return id?svg.querySelector('[data-node-id="'+id+'"]'):null;
  }
  function position(){
    frame=0;
    if(chip.hidden)return;
    var node=focusNode();
    if(!node)return;
    var host=chip.offsetParent||chip.parentElement;
    if(!host)return;
    var nr=node.getBoundingClientRect();
    var hr=host.getBoundingClientRect();
    var cw=chip.offsetWidth||320;
    var ch=chip.offsetHeight||220;
    // Clamp in VIEWPORT space (relative to the container's visible box), then
    // convert to content space: wide-diagram mode translates the chip by the
    // container's scroll offset to keep the corner controls pinned, so the
    // content-space coordinate is visual minus scroll.
    var vx=nr.right-hr.left-host.clientLeft+14;
    if(vx+cw>hr.width-8)vx=nr.left-hr.left-host.clientLeft-cw-14;
    vx=Math.max(8,Math.min(vx,Math.max(8,host.clientWidth-cw-8)));
    var vy=nr.top-hr.top-host.clientTop+nr.height/2-ch/2;
    vy=Math.max(8,Math.min(vy,Math.max(8,host.clientHeight-ch-8)));
    var sx=Math.round(vx-host.scrollLeft)+'px';
    var sy=Math.round(vy-host.scrollTop)+'px';
    if(chip.style.getPropertyValue('--dp-x')!==sx)chip.style.setProperty('--dp-x',sx);
    if(chip.style.getPropertyValue('--dp-y')!==sy)chip.style.setProperty('--dp-y',sy);
  }
  function request(){if(!frame)frame=requestAnimationFrame(position);}
  new MutationObserver(function(){if(!chip.hidden)request();}).observe(chip,{attributes:true,attributeFilter:['hidden','data-relations-expanded','data-relationship-previewing','data-reach-mode']});
  if(svg)new MutationObserver(request).observe(svg,{attributes:true,attributeFilter:['style','viewBox','data-focus-active']});
  (chip.offsetParent||window).addEventListener('scroll',function(){if(!chip.hidden)request();},{passive:true});
  window.addEventListener('scroll',function(){if(!chip.hidden)request();},{passive:true});
  window.addEventListener('resize',function(){if(!chip.hidden)request();},{passive:true});
  request();
})();
</script>`;
}

/**
 * Presentation-lock block (see applyViewerPatches #2). Every toggle path is
 * covered: the toolbar button is hidden AND its click is swallowed in the
 * capture phase (its listener captured the original toggle closure, so API
 * re-binding alone can't stop it); F/Escape and the diagram-guide action go
 * through the late-bound `Archify.presentation` API, which is re-bound to a
 * stay-locked stub; and a MutationObserver re-asserts the attribute against
 * any other code path that removes it.
 */
function presentLockPatch(): string {
  return `<style id="deeporca-present-lock">
#btn-present,.diagram-guide-action[data-guide-action="present"]{display:none!important}
</style>
<script>
(function(){
  var html=document.documentElement;
  function lock(){
    if(html.getAttribute('data-present')!=='true')html.setAttribute('data-present','true');
  }
  lock();
  if(window.Archify&&Archify.presentation){
    var stay=function(){lock();return true;};
    Archify.presentation.enter=stay;
    Archify.presentation.exit=stay;
    Archify.presentation.toggle=stay;
    Archify.presentation.active=function(){return true;};
  }
  var btn=document.getElementById('btn-present');
  if(btn)btn.addEventListener('click',function(e){e.stopImmediatePropagation();},true);
  new MutationObserver(lock).observe(html,{attributes:true,attributeFilter:['data-present']});
})();
</script>`;
}

/**
 * Theme-sync block (see applyViewerPatches #3). The desktop posts
 * `{type:"deeporca-theme", theme:"light"|"dark"}` into the frame when the app
 * appearance changes; the block applies it the same way the viewer's own
 * toggle does (attribute + toolbar button state) so the embedded board tracks
 * the app without a reload. Strict payload validation — this listener runs in
 * model-authored-adjacent territory, so anything else is ignored.
 */
function themeSyncPatch(): string {
  return `<style id="deeporca-theme-sync">/* host theme sync */</style>
<script>
(function(){
  window.addEventListener('message',function(e){
    var d=e&&e.data;
    if(!d||d.type!=='deeporca-theme')return;
    if(d.theme!=='light'&&d.theme!=='dark')return;
    document.documentElement.setAttribute('data-theme',d.theme);
    var label=document.getElementById('theme-label');
    if(label)label.textContent=d.theme==='dark'?'Dark':'Light';
    var btn=document.getElementById('btn-theme');
    if(btn)btn.setAttribute('aria-pressed',d.theme==='light'?'true':'false');
  });
})();
</script>`;
}

/**
 * In-place sweep for already-delivered artifacts (patch rollout): the
 * delivery gate skips files whose receipt still verifies, so maps rendered
 * before a patch change would otherwise keep the stale viewer behavior
 * forever. Re-patch each host-delivered HTML (receipt must verify — never
 * touch model-authored HTML, that stays the round-7 re-render-on-mismatch
 * path) and re-pin the receipt so the file still counts as delivered.
 * Returns patched count.
 */
export function refreshViewerPatches(root: string): number {
  let patched = 0;
  for (const art of listArchifyArtifacts(root)) {
    if (!art.htmlDelivered || !verifyReceipt(art.htmlPath)) continue;
    if (applyViewerPatches(art.htmlPath)) {
      writeReceipt(art.htmlPath, art.jsonPath);
      patched++;
    }
  }
  return patched;
}

function sha256File(path: string): string {
  return createHash("sha256").update(fs.readFileSync(path)).digest("hex");
}
import * as path from "node:path";
import { spawnTracked } from "@deeporca/core";

const DELIVER_TIMEOUT_MS = 120_000;

/** Valid archify diagram types (CLI subcommands / file suffixes). */
export const ARCHIFY_TYPES = ["architecture", "workflow", "sequence", "dataflow", "lifecycle"] as const;
export type ArchifyType = (typeof ARCHIFY_TYPES)[number];

export interface ArchifyArtifact {
  /** File name without extension, e.g. "arch-checkout.architecture". */
  readonly name: string;
  readonly jsonPath: string;
  readonly htmlPath: string;
  readonly type: ArchifyType | "unknown";
  readonly mtime: string;
  readonly htmlDelivered: boolean;
}

/** Parse the diagram type from the artifact file suffix (`*.architecture.json`). */
export function archifyTypeOf(fileName: string): ArchifyType | "unknown" {
  const m = fileName.match(/\.(architecture|workflow|sequence|dataflow|lifecycle)\.json$/);
  return (m?.[1] as ArchifyType) ?? "unknown";
}

/**
 * Deliver-receipt sidecar (review round 7, security): the background task's
 * write grant covers the whole prototypes dir — a prompt-injected model can
 * author BOTH a junk IR and a sibling .html with arbitrary script, and the
 * embed used to trust any existing HTML (existsSync == "delivered"). Receipts
 * pin the sha256 of HTML the HOST actually delivered; embeds re-render when
 * the receipt is missing or mismatched, so hostile HTML is deterministically
 * overwritten before it can execute.
 */
export function receiptPathFor(htmlPath: string): string {
  return `${htmlPath}.receipt.json`;
}

/**
 * Receipt authenticity (red-team 2026-08-30): the receipt sidecar lives in
 * the SAME directory the arch-scan model holds a write grant for, so a
 * plaintext {htmlSha256} receipt is forgeable — hostile HTML + a matching
 * self-computed digest reads as "host-delivered" forever. The receipt now
 * carries an HMAC over `htmlPath|htmlSha256` keyed by a per-install secret
 * persisted in the app's userData (never inside any model-writable root).
 * The model can neither compute nor transplant a valid mac (it is bound to
 * the exact file path AND content bytes).
 */
let receiptSecretCache: Buffer | null = null;
function receiptSecret(): Buffer {
  if (receiptSecretCache) return receiptSecretCache;
  const secret = (() => {
    try {
      // Electron only resolves inside the running app; under plain node (tests)
      // this yields the npm package shim with no .app → deterministic fallback.
      const req = nodeCreateRequire(import.meta.url);
      const electron = req("electron") as { app?: { getPath?: (k: string) => string } };
      const dir = electron?.app?.getPath?.("userData");
      if (dir) {
        const secretPath = path.join(dir, "arch-receipt.secret");
        try {
          const existing = fs.readFileSync(secretPath);
          if (existing.length >= 32) return existing;
        } catch {
          // first boot — generate below
        }
        const fresh = randomBytes(32);
        try {
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(secretPath, fresh, { mode: 0o600 });
        } catch {
          // unreadable userData — fall through to the deterministic key
        }
        return fresh;
      }
    } catch {
      // not running under Electron
    }
    // No userData (tests, bare node): a PROCESS-RANDOM key would invalidate
    // every receipt across processes (real-machine 2026-08-30: each test run
    // re-minted its own key, so GVGL's freshly pinned receipt verified false
    // in the next run and the rail patch sweep skipped the file). A fixed
    // derivation keeps the HMAC chain coherent there; real installs always
    // hold the persisted per-install key, which is where the security
    // boundary actually lives.
    return createHash("sha256").update("deeporca-arch-receipt-fallback-v1").digest();
  })();
  receiptSecretCache = secret;
  return secret;
}

function receiptMac(htmlPath: string, htmlSha256: string): string {
  return createHmac("sha256", receiptSecret()).update(`${htmlPath}|${htmlSha256}`).digest("hex");
}

export function writeReceipt(htmlPath: string, jsonPath: string): void {
  try {
    const sha = sha256File(htmlPath);
    fs.writeFileSync(
      receiptPathFor(htmlPath),
      JSON.stringify({
        htmlSha256: sha,
        irPath: jsonPath,
        at: new Date().toISOString(),
        mac: receiptMac(htmlPath, sha),
      }),
      "utf-8"
    );
  } catch {
    // best-effort — a missing receipt just forces a re-deliver on next embed
  }
}

export function verifyReceipt(htmlPath: string): boolean {
  try {
    const receipt = JSON.parse(fs.readFileSync(receiptPathFor(htmlPath), "utf-8")) as {
      htmlSha256?: string;
      mac?: string;
    };
    if (typeof receipt.htmlSha256 !== "string" || receipt.htmlSha256.length !== 64) return false;
    if (typeof receipt.mac !== "string" || receipt.mac.length !== 64) return false;
    // Timing-safe compare — the mac is the authenticity primitive now.
    const expected = Buffer.from(receiptMac(htmlPath, receipt.htmlSha256), "hex");
    const actual = Buffer.from(receipt.mac, "hex");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return false;
    return sha256File(htmlPath) === receipt.htmlSha256;
  } catch {
    return false;
  }
}

/** List archify artifacts (typed IR + delivered-HTML pairs) under prototypes/. */
export function listArchifyArtifacts(root: string): ArchifyArtifact[] {
  const dir = path.join(root, ".deeporca", "prototypes");
  const out: ArchifyArtifact[] = [];
  try {
    for (const f of fs.readdirSync(dir)) {
      const type = archifyTypeOf(f);
      if (type === "unknown") continue;
      const jsonPath = path.join(dir, f);
      const htmlPath = jsonPath.replace(/\.json$/, ".html");
      try {
        const st = fs.statSync(jsonPath);
        if (st.size <= 256) continue; // hollow leftover — same content-weight rule
        out.push({
          name: f.replace(/\.json$/, ""),
          jsonPath,
          htmlPath,
          type,
          mtime: st.mtime.toISOString(),
          htmlDelivered: fs.existsSync(htmlPath),
        });
      } catch {
        // raced away — skip
      }
    }
  } catch {
    // absent dir — empty
  }
  return out.sort((a, b) => a.mtime.localeCompare(b.mtime));
}

export class ArchifyCli {
  constructor(
    private opts: {
      bin: string;
      nodeRunner: string;
      electronRunAsNode?: boolean;
    }
  ) {}

  isAvailable(): boolean {
    try {
      return fs.statSync(this.opts.bin).isFile();
    } catch {
      return false;
    }
  }

  /** Spawn the archify CLI (argv-form; receipts are JSON on stdout). */
  private async run(
    args: string[],
    timeoutMs = DELIVER_TIMEOUT_MS
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    const env: Record<string, string> = {};
    if (this.opts.electronRunAsNode) env.ELECTRON_RUN_AS_NODE = "1";
    const result = await spawnTracked({
      label: "archify",
      command: this.opts.nodeRunner,
      args: [this.opts.bin, ...args],
      cwd: process.cwd(),
      env,
      timeoutMs,
    });
    return { code: result.code ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  }

  /** Extract the LAST JSON object from stdout (the --json receipt). */
  private parseReceipt(stdout: string): Record<string, unknown> | null {
    const starts = [...stdout.matchAll(/\n?\s*\{/g)].map((m) => m.index ?? 0);
    for (let i = starts.length - 1; i >= 0; i--) {
      try {
        const parsed = JSON.parse(stdout.slice(starts[i]).trim()) as unknown;
        if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
      } catch {
        // partial log noise — try earlier opener
      }
    }
    return null;
  }

  /**
   * Deterministic acceptance gate: validate + render + atomic commit. A
   * non-zero exit or `ok:false` receipt is a FAILURE — never reported as
   * success (the archify delivery contract).
   */
  async deliver(type: ArchifyType, jsonPath: string, htmlPath: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.isAvailable()) return { ok: false, error: "archify CLI is not vendored" };
    // --repo-root: IRs declaring meta.repository carry source evidence that
    // archify verifies against the local checkout — without the flag such an
    // artifact can NEVER render (repository-evidence/root-required,
    // real-machine 2026-08-31). The IR lives at <root>/.deeporca/prototypes/.
    const repoRoot = path.resolve(path.join(jsonPath, "..", "..", ".."));
    const r = await this.run([
      "deliver",
      type,
      jsonPath,
      htmlPath,
      "--repo-root",
      repoRoot,
      "--quality",
      "showcase",
      "--json",
    ]);
    const receipt = this.parseReceipt(r.stdout);
    if (r.code === 0 && receipt?.ok === true) {
      applyViewerPatches(htmlPath);
      writeReceipt(htmlPath, jsonPath);
      return { ok: true };
    }
    const diag = JSON.stringify(receipt?.diagnostics ?? null);
    return { ok: false, error: `archify deliver exited ${r.code}: ${diag !== "null" ? diag : r.stderr.slice(0, 300)}` };
  }

  /**
   * Deliver every typed IR artifact in prototypes/ whose HTML sibling is
   * missing OR OLDER than the IR (an incremental update rewrote the IR —
   * existence alone would silently skip the re-render; audit 2026-08-29).
   * Returns delivered count; throws on the FIRST delivery failure so the
   * build stage fails with the diagnostics.
   */
  async deliverAllPending(root: string): Promise<number> {
    // Degenerate-leftover sweep (real-machine 2026-08-29: a rogue model write
    // produced "undefined.json" — components-only, no name match): files that
    // parse as IR-shaped fragments but don't match the arch-*.<type>.json
    // contract are removed so they neither accumulate nor confuse listings.
    try {
      const dir = path.join(root, ".deeporca", "prototypes");
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith(".json") || archifyTypeOf(f) !== "unknown") continue;
        const full = path.join(dir, f);
        try {
          if (fs.statSync(full).size > 8 * 1024 * 1024) continue;
          const parsed = JSON.parse(fs.readFileSync(full, "utf-8")) as Record<string, unknown>;
          // IR-shaped fragment: has components but missing its siblings.
          if (Array.isArray(parsed.components) && (!Array.isArray(parsed.connections) || !parsed.meta)) {
            fs.rmSync(full, { force: true });
          }
        } catch {
          // unparsable — leave it (not ours to judge)
        }
      }
    } catch {
      // best-effort sweep
    }
    let delivered = 0;
    for (const art of listArchifyArtifacts(root)) {
      if (art.type === "unknown") continue;
      let stale = true;
      try {
        stale = fs.statSync(art.htmlPath).mtimeMs < fs.statSync(art.jsonPath).mtimeMs;
      } catch {
        // no HTML sibling — pending
      }
      // Receipt gate (review round 7): an HTML we never delivered (or that
      // changed since) re-renders — model-authored HTML never survives.
      if (art.htmlDelivered && !stale && verifyReceipt(art.htmlPath)) {
        // Patch sweep rollout: refresh delivered maps in place (receipt
        // re-pinned) instead of forcing a full re-render.
        if (applyViewerPatches(art.htmlPath)) writeReceipt(art.htmlPath, art.jsonPath);
        continue;
      }
      const res = await this.deliver(art.type, art.jsonPath, art.htmlPath);
      if (!res.ok) throw new Error(`archify deliver failed for ${art.name}: ${res.error}`);
      delivered++;
    }
    return delivered;
  }
}
