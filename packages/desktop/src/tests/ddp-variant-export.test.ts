/**
 * .ddp platform-variant export (WP4.1/WP4.3) — mobile/tablet sources and
 * standalone playable HTML ride along when the suite carries variants.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { buildDdpPackage, buildStandaloneOpenuiHtml } from "../main/tools/dd-package";

function unzipList(buffer: Buffer): string[] {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ddp-variant-"));
  const zipPath = path.join(dir, "pkg.ddp");
  fs.writeFileSync(zipPath, buffer);
  const listing = execFileSync("unzip", ["-Z1", zipPath], { encoding: "utf8" });
  fs.rmSync(dir, { recursive: true, force: true });
  return listing.trim().split("\n").filter(Boolean);
}

test("ddp includes per-device sources and standalone html when variants exist", () => {
  const buffer = buildDdpPackage(
    { id: "s1", title: "轻订单管理" },
    'root = Text("desktop")',
    new Date().toISOString(),
    undefined,
    { mobile: 'root = Text("mobile")', tablet: 'root = Text("tablet")' }
  );
  const names = unzipList(buffer);
  assert.ok(names.includes("source.openui.txt"), "desktop source always present");
  assert.ok(names.includes("source.openui.mobile.txt"), "mobile source exported");
  assert.ok(names.includes("source.openui.tablet.txt"), "tablet source exported");
  assert.ok(names.includes("standalone.mobile.html"), "mobile standalone playable html");
  assert.ok(names.includes("standalone.tablet.html"), "tablet standalone playable html");
});

test("ddp without variants keeps the legacy three-entry shape", () => {
  const names = unzipList(buildDdpPackage({ id: "s1", title: "T" }, 'root = Text("d")', new Date().toISOString()));
  assert.deepEqual(
    names.filter((n) => n.startsWith("source.openui") || n.startsWith("standalone")),
    ["source.openui.txt"]
  );
});

test("standalone html embeds the program and loads the official bundle", () => {
  const html = buildStandaloneOpenuiHtml("标题", 'root = Text("hi")');
  assert.match(html, /@openuidev\/browser/);
  assert.match(html, /type="application\/json"/);
  assert.ok(html.includes('root = Text("hi")'), "program embedded verbatim");
  // </script> 在 JSON 嵌入中被转义,防提前闭合注入
  const hostile = buildStandaloneOpenuiHtml("t", 'x = Text("</script><b>pwn</b>")');
  // 有效负载被转义为 <\/script>,JSON script 标签不会被提前闭合。
  assert.ok(!hostile.includes("</script><b>"), "script-closing payload escaped");
  assert.ok(hostile.includes("<\\/script>"), "payload present but escaped");
});
