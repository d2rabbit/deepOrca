/**
 * Archify artifact discovery (archify-cli.ts pure surface).
 *
 * The typed-IR file-name convention (`arch-<slug>.<type>.json`, type from the
 * CLI's five diagram kinds) is load-bearing: the host deliver gate parses the
 * type from the suffix and the Knowledge panel lists what discovery returns.
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  archifyTypeOf,
  listArchifyArtifacts,
  refreshViewerPatches,
  writeReceipt,
  verifyReceipt,
} from "../main/tools/archify-cli";

test("archifyTypeOf parses the five diagram suffixes", () => {
  assert.equal(archifyTypeOf("arch-checkout.architecture.json"), "architecture");
  assert.equal(archifyTypeOf("arch-release.workflow.json"), "workflow");
  assert.equal(archifyTypeOf("arch-login.sequence.json"), "sequence");
  assert.equal(archifyTypeOf("arch-analytics.dataflow.json"), "dataflow");
  assert.equal(archifyTypeOf("arch-run.lifecycle.json"), "lifecycle");
  assert.equal(archifyTypeOf("arch-legacy.json"), "unknown");
  assert.equal(archifyTypeOf("arch-old.md"), "unknown");
});

test("listArchifyArtifacts: typed pairs, hollow excluded, html flag", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "archify-cli-"));
  try {
    const proto = path.join(root, ".deeporca", "prototypes");
    fs.mkdirSync(proto, { recursive: true });
    // Real typed artifact + delivered sibling.
    fs.writeFileSync(path.join(proto, "arch-checkout.architecture.json"), `${"j".repeat(400)}`);
    fs.writeFileSync(path.join(proto, "arch-checkout.architecture.html"), "<html/>");
    // Typed but not yet delivered.
    fs.writeFileSync(path.join(proto, "arch-pipeline.dataflow.json"), `${"j".repeat(400)}`);
    // Hollow leftover — must not count (content-weight line).
    fs.writeFileSync(path.join(proto, "arch-empty.lifecycle.json"), "{}");
    // Retired formats — invisible to the archify era.
    fs.writeFileSync(path.join(proto, "arch-legacy.md"), `${"m".repeat(600)}`);

    const arts = listArchifyArtifacts(root);
    assert.equal(arts.length, 2, "typed substantial artifacts only");
    const checkout = arts.find((a) => a.name === "arch-checkout.architecture");
    assert.ok(checkout);
    assert.equal(checkout.type, "architecture");
    assert.equal(checkout.htmlDelivered, true);
    assert.equal(checkout.htmlPath.endsWith("arch-checkout.architecture.html"), true);
    const pipeline = arts.find((a) => a.name === "arch-pipeline.dataflow");
    assert.ok(pipeline);
    assert.equal(pipeline.htmlDelivered, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("listArchifyArtifacts: absent prototypes dir → empty", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "archify-cli-"));
  try {
    assert.deepEqual(listArchifyArtifacts(root), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("refreshViewerPatches: v1 block replaced + present locked, idempotent, receipt stays valid", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "archify-passport-"));
  try {
    const proto = path.join(root, ".deeporca", "prototypes");
    fs.mkdirSync(proto, { recursive: true });
    const jsonPath = path.join(proto, "arch-checkout.architecture.json");
    const htmlPath = path.join(proto, "arch-checkout.architecture.html");
    fs.writeFileSync(jsonPath, "j".repeat(400));
    // Delivered HTML carrying the INERT v1 passport patch (v1 keyed off a
    // chip attribute archify never sets — the chip stayed pinned top-left).
    fs.writeFileSync(
      htmlPath,
      `<html><body><div class="diagram-container"><svg/></div><style id="deeporca-passport-track">
.focus-chip{left:var(--dp-x,1rem)!important;top:var(--dp-y,1rem)!important;transition:none!important}
</style>
<script>
(function(){
  var chip=document.getElementById('focus-chip');
  if(!chip)return;
  var id=chip.getAttribute('data-node-id')||'';
  if(!id)return;
})();
</script></body></html>`
    );
    writeReceipt(htmlPath, jsonPath);

    assert.equal(refreshViewerPatches(root), 1, "v1-delivered map is refreshed");
    const html = fs.readFileSync(htmlPath, "utf-8");
    assert.equal(html.includes("data-focus-selected"), true, "v2 tracks the viewer's real focus state");
    assert.equal(html.includes("chip.getAttribute('data-node-id')"), false, "inert v1 script is gone");
    assert.equal(
      html.indexOf("deeporca-passport-track"),
      html.lastIndexOf("deeporca-passport-track"),
      "single passport block"
    );
    // Presentation lock: stage forced on, exits neutered, controls hidden.
    assert.equal(html.includes("deeporca-present-lock"), true, "present-lock block present");
    assert.equal(
      html.includes('#btn-present,.diagram-guide-action[data-guide-action="present"]{display:none!important}'),
      true,
      "Present/Exit controls hidden"
    );
    assert.equal(html.includes("stopImmediatePropagation"), true, "button click swallowed");
    assert.equal(html.includes("Archify.presentation.exit=stay"), true, "API exits neutered");
    assert.equal(
      html.indexOf("deeporca-present-lock"),
      html.lastIndexOf("deeporca-present-lock"),
      "single present-lock block"
    );
    // Theme sync: live postMessage channel, strictly validated payload.
    assert.equal(html.includes("deeporca-theme-sync"), true, "theme-sync block present");
    assert.equal(html.includes("deeporca-theme"), true, "message channel present");
    assert.equal(
      html.indexOf("deeporca-theme-sync"),
      html.lastIndexOf("deeporca-theme-sync"),
      "single theme-sync block"
    );
    // Guided-rail restyle REVERTED (user decision 2026-08-30: the stock top
    // band wins) — no rail block is injected anymore. The strip regex stays
    // so already-delivered files carrying any earlier iteration converge.
    assert.equal(html.includes("deeporca-rail-compact"), false, "no rail restyle block");
    assert.equal(verifyReceipt(htmlPath), true, "receipt re-pinned — file still counts as delivered");

    assert.equal(refreshViewerPatches(root), 0, "second sweep is a no-op");
    assert.equal(fs.readFileSync(htmlPath, "utf-8"), html, "already-current HTML is byte-identical");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("rail revert: a delivered file carrying the old floating-TOC block converges back to stock", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "archify-railrevert-"));
  try {
    const proto = path.join(root, ".deeporca", "prototypes");
    fs.mkdirSync(proto, { recursive: true });
    const jsonPath = path.join(proto, "arch-legacy.architecture.json");
    const htmlPath = path.join(proto, "arch-legacy.architecture.html");
    fs.writeFileSync(jsonPath, "j".repeat(400));
    // A file patched by an app build that still shipped the floating-TOC
    // experiment: v4 style + reparent script before </body>.
    fs.writeFileSync(
      htmlPath,
      `<html><body><div class="diagram-container"><svg/></div>
<style id="deeporca-rail-compact">
html[data-present="true"] .guided-views{position:absolute;top:1rem;left:1rem;}
</style>
<script>
(function(){var g=document.getElementById('guided-views');var dc=document.querySelector('.diagram-container');if(g&&dc&&g.parentElement!==dc)dc.appendChild(g);})();
</script></body></html>`
    );
    writeReceipt(htmlPath, jsonPath);

    assert.equal(refreshViewerPatches(root), 1, "stale rail block stripped");
    const html = fs.readFileSync(htmlPath, "utf-8");
    assert.equal(html.includes("deeporca-rail-compact"), false, "rail block fully removed");
    assert.equal(html.includes("dc.appendChild(g)"), false, "reparent script removed with the block");
    assert.equal(html.includes("</body></html>") || html.trimEnd().endsWith("</html>"), true, "document intact");
    assert.equal(verifyReceipt(htmlPath), true, "receipt re-pinned");
    assert.equal(refreshViewerPatches(root), 0, "converged");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("refreshViewerPatches: HTML without valid receipt is never touched", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "archify-passport-"));
  try {
    const proto = path.join(root, ".deeporca", "prototypes");
    fs.mkdirSync(proto, { recursive: true });
    const jsonPath = path.join(proto, "arch-hostile.workflow.json");
    const htmlPath = path.join(proto, "arch-hostile.workflow.html");
    fs.writeFileSync(jsonPath, "j".repeat(400));
    fs.writeFileSync(htmlPath, "<html><body>model-authored</body></html>");
    // No receipt → round-7 gate: the deliver stage re-renders this; the
    // sweep must not bless it with a patch + fresh receipt.
    assert.equal(refreshViewerPatches(root), 0);
    assert.equal(fs.readFileSync(htmlPath, "utf-8"), "<html><body>model-authored</body></html>");
    assert.equal(verifyReceipt(htmlPath), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
