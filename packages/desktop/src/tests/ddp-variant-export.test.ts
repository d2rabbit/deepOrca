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

test("standalone html: honest source-delivery page (交叉审查: 官方无浏览器 bundle,CDN 路线已移除)", () => {
  const html = buildStandaloneOpenuiHtml("标题", 'root = Text("hi")');
  // 诚实降级:不再引用不存在的 CDN 包;交付自包含源码查看页(零网络依赖)。
  assert.doesNotMatch(html, /unpkg\.com|cdn/, "no dead CDN reference");
  assert.ok(
    html.includes("root = Text(&quot;hi&quot;)") || html.includes('root = Text("hi")'),
    "program visible in the source view"
  );
  // JSON 嵌入经 JSON.stringify(引号/换行转义) + </script> 二次转义防注入。
  assert.match(html, /type="application\/json"/);
  const hostile = buildStandaloneOpenuiHtml("t", 'x = Text("</script><b>pwn</b>")');
  assert.ok(!hostile.includes("</script><b>"), "script-closing payload escaped in JSON embed");
  assert.ok(hostile.includes("<\\/script>"), "payload present but escaped inside the JSON string");
});
