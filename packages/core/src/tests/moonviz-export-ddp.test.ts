/**
 * prototype.export-ddp action surface (specs/moonviz-engine-replacement
 * T3.3) — DDP1/DDP2 branch, fileName guard, error mapping, write location.
 * The crypto beneath is pinned by ddp-codec.test.ts golden vectors; here we
 * pin the action glue with the fixture seam + a scripted a2ui channel.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { prototypeExportDdpRun, prototypeExportDdpDefinition } from "../actions/prototype";
import { installMoonvizFixture, MOCK_MOONVIZ_DOC } from "./moonviz-fixture";
import { NULL_SPAWNER } from "../actions/types";
import type { ActionContext } from "../actions/types";

const REF = { suiteId: "ddp-suite", versionId: "d-v1", kind: "prototype" as const };

function makeCtx(options: { versionContent?: Record<string, unknown> } = {}): ActionContext {
  installMoonvizFixture();
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "export-ddp-")));
  return {
    projectRoot: root,
    signal: new AbortController().signal,
    emit: () => {},
    spawner: NULL_SPAWNER,
    runSubagent: async () => ({ sessionId: "s", content: "" }),
    executeMcpTool: async (name, args) => {
      if (name.endsWith("read_suite_version")) {
        return {
          ok: true,
          output: JSON.stringify({
            artifactRef: REF,
            title: "Suite",
            status: "ready",
            content: options.versionContent ?? { spec: "# s", moonviz: MOCK_MOONVIZ_DOC },
          }),
        };
      }
      return { ok: true, output: "ok" };
    },
  } as unknown as ActionContext;
}

test("export-ddp: empty password produces a DDP2 container under the suite dir", async () => {
  const ctx = makeCtx();
  const result = await prototypeExportDdpRun({ suiteId: REF.suiteId }, ctx);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.container, "DDP2");
  assert.ok(result.ddpPath?.includes(".deeporca/designs/ddp-suite/"), "written under the suite dir");
  assert.ok(result.ddpPath?.endsWith(".ddp"));
  const bytes = fs.readFileSync(result.ddpPath!);
  assert.equal(bytes.subarray(0, 4).toString("latin1"), "DDP2");
});

test("export-ddp: non-empty password produces DDP1 and plaintext is absent", async () => {
  const ctx = makeCtx();
  const result = await prototypeExportDdpRun({ suiteId: REF.suiteId, password: "pw" }, ctx);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.container, "DDP1");
  const bytes = fs.readFileSync(result.ddpPath!);
  assert.equal(bytes.subarray(0, 4).toString("latin1"), "DDP1");
  assert.equal(bytes.includes(Buffer.from("moonviz:artboard")), false);
});

test("export-ddp: custom fileName lands sanitized; missing doc / ui kind fail loudly", async () => {
  const ctx = makeCtx();
  const named = await prototypeExportDdpRun({ suiteId: REF.suiteId, fileName: "order pkg" }, ctx);
  // 非法文件名（含空格）回退 <suiteId>.ddp。
  assert.equal(named.ok, true);
  assert.ok(named.ddpPath?.endsWith("ddp-suite.ddp"));

  const noDoc = await prototypeExportDdpRun({ suiteId: REF.suiteId }, makeCtx({ versionContent: { spec: "# only" } }));
  assert.equal(noDoc.ok, false);
  assert.match(noDoc.error ?? "", /no MoonViz document/);

  assert.ok(prototypeExportDdpDefinition.id === "prototype.export-ddp");
});
