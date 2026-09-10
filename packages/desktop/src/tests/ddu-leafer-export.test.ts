/**
 * Interactive .ddu leafer export (specs/leafer-ui-engine WP3 / EARS 12+14):
 * manifest pipeline "leafer", design.leafer.json entry, the leafer web
 * runtime + flow layout plugin, and an index.html that renders an editable,
 * flow-aware canvas offline.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  buildDduLeaferPackage,
  buildDduLeaferViewerHtml,
  LEAFER_FLOW_RUNTIME_FILE,
  LEAFER_RUNTIME_FILE,
  resolveLeaferRuntimeBundle,
  type LeaferRuntime,
} from "../main/tools/dd-package";

const DESIGN = JSON.stringify({
  tag: "Leafer",
  width: 1440,
  height: 1024,
  fill: "#ffffff",
  children: [{ tag: "Rect", x: 24, y: 24, width: 200, height: 64, fill: "#4F46E5", cornerRadius: 12 }],
});

const FAKE_EDITOR: LeaferRuntime = { fileName: LEAFER_RUNTIME_FILE, data: Buffer.from("/* leafer runtime stub */") };
const FAKE_FLOW: LeaferRuntime = {
  fileName: LEAFER_FLOW_RUNTIME_FILE,
  data: Buffer.from("/* leafer flow plugin stub */"),
};
const FAKE_BUNDLE = { editor: FAKE_EDITOR, flow: FAKE_FLOW };

function extract(buffer: Buffer): { names: string[]; read: (name: string) => string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ddu-leafer-"));
  const zipPath = path.join(dir, "pkg.zip");
  fs.writeFileSync(zipPath, buffer);
  if (process.platform === "win32") {
    execFileSync(
      "powershell",
      ["-NoProfile", "-Command", `Expand-Archive -Path '${zipPath}' -DestinationPath '${dir}\\out' -Force`],
      { encoding: "utf8" }
    );
  } else {
    execFileSync("unzip", ["-o", zipPath, "-d", path.join(dir, "out")], { encoding: "utf8" });
  }
  const outDir = path.join(dir, "out");
  const names = fs.readdirSync(outDir);
  return {
    names,
    read: (name: string) => fs.readFileSync(path.join(outDir, name), "utf8"),
  };
}

test("leafer .ddu carries manifest + design json + interactive html + runtime + flow plugin", () => {
  const pkg = extract(
    buildDduLeaferPackage({ id: "s1", title: "运营看板视觉稿" }, DESIGN, new Date().toISOString(), FAKE_BUNDLE)
  );
  assert.deepEqual(
    pkg.names.filter((name) => name !== "tokens.json" && name !== "components.json").sort(),
    [LEAFER_RUNTIME_FILE, LEAFER_FLOW_RUNTIME_FILE, "design.leafer.json", "index.html", "manifest.json"].sort()
  );
  const manifest = JSON.parse(pkg.read("manifest.json")) as { pipeline?: string; kind?: string; format?: string };
  assert.equal(manifest.pipeline, "leafer");
  assert.equal(manifest.kind, "ui-design");
  assert.equal(manifest.format, "ddu");
  assert.deepEqual(JSON.parse(pkg.read("design.leafer.json")), JSON.parse(DESIGN));
  const html = pkg.read("index.html");
  assert.match(html, new RegExp(`src="./${LEAFER_RUNTIME_FILE}"`), "runtime referenced relative — offline");
  assert.match(
    html,
    new RegExp(`src="./${LEAFER_FLOW_RUNTIME_FILE}"`),
    "flow plugin referenced relative — flow/gap/padding must be live in the export"
  );
  // Script order is load-bearing: the flow global build wires into the
  // editor runtime's LeaferUI namespace, so it must load right after it.
  assert.ok(
    html.indexOf(`./${LEAFER_RUNTIME_FILE}`) < html.indexOf(`./${LEAFER_FLOW_RUNTIME_FILE}`),
    "the flow plugin script must come after the editor runtime script"
  );
  assert.match(html, /type="application\/json" id="ddu-design"/);
  assert.match(html, /new Leafer\(/);
  assert.match(html, /new Editor\(\)/, "the exported canvas must be interactive (editor attached)");
  assert.equal(pkg.read(LEAFER_RUNTIME_FILE), FAKE_EDITOR.data.toString(), "runtime bytes ride verbatim");
  assert.equal(pkg.read(LEAFER_FLOW_RUNTIME_FILE), FAKE_FLOW.data.toString(), "flow plugin bytes ride verbatim");
});

test("leafer viewer html escapes script-breaking payloads in the JSON embed", () => {
  const hostile = JSON.stringify({
    tag: "Leafer",
    width: 100,
    height: 100,
    children: [{ tag: "Text", x: 0, y: 0, text: "</script><b>pwn</b>" }],
  });
  const html = buildDduLeaferViewerHtml("t", hostile, LEAFER_RUNTIME_FILE, LEAFER_FLOW_RUNTIME_FILE);
  assert.ok(!html.includes("</script><b>"), "script-closing payload must be escaped");
  // The data survives verbatim after JSON unescaping (\u003c === <); only `<`
  // needs escaping — the html parser scans for the literal `</script` closer.
  assert.ok(html.includes("\\u003c/script>"), "payload present but escaped inside the JSON string");
});

test("leafer runtime bundle resolves from the installed dependencies (unbuilt checkout)", () => {
  const bundle = resolveLeaferRuntimeBundle();
  assert.ok(bundle, "both runtimes must resolve via node_modules fallback in the test environment");
  assert.equal(bundle.editor.fileName, LEAFER_RUNTIME_FILE);
  assert.equal(bundle.flow.fileName, LEAFER_FLOW_RUNTIME_FILE);
  assert.ok(bundle.editor.data.length > 1024, "real editor runtime bytes, not an empty stub");
  assert.ok(bundle.flow.data.length > 512, "real flow plugin bytes, not an empty stub");
});
