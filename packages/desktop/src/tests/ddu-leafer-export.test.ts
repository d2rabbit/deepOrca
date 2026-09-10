/**
 * Interactive .ddu leafer export (specs/leafer-ui-engine WP3 / EARS 12+14):
 * manifest pipeline "leafer", design.leafer.json entry, the leafer web
 * runtime, and an index.html that renders an editable canvas offline.
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
  LEAFER_RUNTIME_FILE,
  resolveLeaferRuntimeSource,
} from "../main/tools/dd-package";

const DESIGN = JSON.stringify({
  tag: "Leafer",
  width: 1440,
  height: 1024,
  fill: "#ffffff",
  children: [{ tag: "Rect", x: 24, y: 24, width: 200, height: 64, fill: "#4F46E5", cornerRadius: 12 }],
});

const FAKE_RUNTIME = { fileName: LEAFER_RUNTIME_FILE, data: Buffer.from("/* leafer runtime stub */") };

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

test("leafer .ddu carries manifest + design json + interactive html + runtime", () => {
  const pkg = extract(
    buildDduLeaferPackage({ id: "s1", title: "运营看板视觉稿" }, DESIGN, new Date().toISOString(), FAKE_RUNTIME)
  );
  assert.deepEqual(
    pkg.names.filter((name) => name !== "tokens.json" && name !== "components.json").sort(),
    [LEAFER_RUNTIME_FILE, "design.leafer.json", "index.html", "manifest.json"].sort()
  );
  const manifest = JSON.parse(pkg.read("manifest.json")) as { pipeline?: string; kind?: string; format?: string };
  assert.equal(manifest.pipeline, "leafer");
  assert.equal(manifest.kind, "ui-design");
  assert.equal(manifest.format, "ddu");
  assert.deepEqual(JSON.parse(pkg.read("design.leafer.json")), JSON.parse(DESIGN));
  const html = pkg.read("index.html");
  assert.match(html, new RegExp(`src="./${LEAFER_RUNTIME_FILE}"`), "runtime referenced relative — offline");
  assert.match(html, /type="application\/json" id="ddu-design"/);
  assert.match(html, /new Leafer\(/);
  assert.match(html, /new Editor\(\)/, "the exported canvas must be interactive (editor attached)");
  assert.equal(pkg.read(LEAFER_RUNTIME_FILE), FAKE_RUNTIME.data.toString(), "runtime bytes ride verbatim");
});

test("leafer viewer html escapes script-breaking payloads in the JSON embed", () => {
  const hostile = JSON.stringify({
    tag: "Leafer",
    width: 100,
    height: 100,
    children: [{ tag: "Text", x: 0, y: 0, text: "</script><b>pwn</b>" }],
  });
  const html = buildDduLeaferViewerHtml("t", hostile, LEAFER_RUNTIME_FILE);
  assert.ok(!html.includes("</script><b>"), "script-closing payload must be escaped");
  // The data survives verbatim after JSON unescaping (\u003c === <); only `<`
  // needs escaping — the html parser scans for the literal `</script` closer.
  assert.ok(html.includes("\\u003c/script>"), "payload present but escaped inside the JSON string");
});

test("leafer runtime resolves from the installed dependency (unbuilt checkout)", () => {
  const runtime = resolveLeaferRuntimeSource();
  assert.ok(runtime, "runtime must resolve via node_modules fallback in the test environment");
  assert.equal(runtime.fileName, LEAFER_RUNTIME_FILE);
  assert.ok(runtime.data.length > 1024, "real runtime bytes, not an empty stub");
});
