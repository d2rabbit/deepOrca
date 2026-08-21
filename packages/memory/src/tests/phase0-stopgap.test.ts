/**
 * Phase 0 stopgap regression tests (specs/memory-remediation, 2026-08-21).
 *
 * 1. `disableL2L3: true` must leave the pipeline manager without L2/L3
 *    runners — MemoryPipelineManager null-guards them (runL2/runL3 skip), so
 *    no secondary-model call can be burned on the tool-less extraction path.
 *    Observable via the wiring log across a full TdaiCore boot/destroy cycle
 *    against a real SQLite store in a temp dir (provider="none": no network,
 *    no ONNX). The stub LLM runner throws if ever invoked — wiring must not
 *    call it, only L1 extraction would (not triggered in this test).
 * 2. Recall output carries the SLIM memory-tools guide. (Phase 0 removed the
 *    guide while tdai_memory_search / tdai_conversation_search were never
 *    registered; Phase 4 / T4.1 registered them for real and restored a slim
 *    guide — this now locks the tool-backed version.)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { TdaiCore } from "../tdai/core/tdai-core.js";
import { performAutoRecall } from "../tdai/core/hooks/auto-recall.js";
import { parseConfig } from "../tdai/config.js";
import type { HostAdapter, Logger, LLMRunnerFactory, RuntimeContext } from "../tdai/core/types.js";

function tmpDataDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "deeporca-mem-phase0-"));
}

function recordingLogger(): { lines: string[]; logger: Logger } {
  const lines: string[] = [];
  const push = (msg: string) => {
    lines.push(msg);
  };
  return { lines, logger: { debug: push, info: push, warn: push, error: push } };
}

function fakeHostAdapter(dataDir: string, logger: Logger): HostAdapter {
  const runnerFactory: LLMRunnerFactory = {
    createRunner: () => ({
      run: async () => {
        throw new Error("LLM runner must not be invoked in this test");
      },
    }),
  };
  const context: RuntimeContext = {
    userId: "test-user",
    sessionId: "test-session",
    sessionKey: "test-session",
    platform: "deeporca",
    workspaceDir: dataDir,
    dataDir,
  };
  return {
    hostType: "standalone",
    getRuntimeContext: () => context,
    getLogger: () => logger,
    getLLMRunnerFactory: () => runnerFactory,
  };
}

test("disableL2L3 leaves L2/L3 runners unwired while L1 keeps flowing", async () => {
  const dataDir = tmpDataDir();
  const rec = recordingLogger();
  const core = new TdaiCore({
    hostAdapter: fakeHostAdapter(dataDir, rec.logger),
    config: parseConfig({
      capture: { enabled: false },
      extraction: { enabled: true },
      recall: { enabled: true, strategy: "keyword", timeoutMs: 5000 },
      embedding: { enabled: false, provider: "none" },
      storeBackend: "sqlite",
    }),
    disableL2L3: true,
  });
  try {
    await core.initialize();
    // destroy() awaits storeReady, which guarantees wirePipelineRunners (a
    // then-handler attached during initialize) has already run — and releases
    // the store bundle so the temp dir can be removed on Windows too.
    await core.destroy();
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }

  const joined = rec.lines.join("\n");
  assert.match(joined, /L2\/L3 runners NOT wired/, "stopgap log line must be emitted");
  assert.match(joined, /Pipeline runners wired/, "L1 wiring must still complete");
});

test("recall output carries no guidance toward unregistered tools", async () => {
  const dataDir = tmpDataDir();
  fs.writeFileSync(path.join(dataDir, "persona.md"), "# 用户画像\n\nAlice 偏好 TypeScript，常在下午写代码。\n");
  try {
    const cfg = parseConfig({ recall: { enabled: true, strategy: "keyword", timeoutMs: 5000 } });
    // Empty userText skips the memory search path; persona is still injected,
    // which is exactly the branch that used to append the tools guide.
    const result = await performAutoRecall({
      userText: "",
      actorId: "test-user",
      sessionKey: "test-session",
      cfg,
      pluginDataDir: dataDir,
    });

    assert.ok(result, "recall must return a result when persona exists");
    assert.ok(result.appendSystemContext?.includes("<user-persona>"), "persona block must remain");
    // Phase 4 / T4.1: the guide is back in SLIM form — the two tools are now
    // genuinely registered (core MemoryProvider bridge → ToolExecutor), so
    // this pointer is real again. Phase 0 removed it while the tools were
    // unregistered; this now locks the slim, tool-backed version.
    assert.ok(result.appendSystemContext?.includes("memory-tools-guide"), "slim guide must be present");
    assert.ok(result.appendSystemContext?.includes("tdai_memory_search"));
    assert.ok(result.appendSystemContext?.includes("tdai_conversation_search"));
    assert.equal(result.prependContext, undefined, "no L1 hits expected for empty query");
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
