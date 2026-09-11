import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, test } from "node:test";

import { configureDesignSystemsVendorRoot, getExtensionRoot } from "@deeporca/core";

import { readDesignSystemCatalog, registerDesignIpc } from "../main/design-ipc.js";
import type { DesignIpcHelpers, DesignStoreOps } from "../main/design-ipc.js";
import { IpcEvent, IpcRequest } from "../shared/ipc.js";
import type {
  DesignArtifact,
  DesignArtifactMeta,
  DesignSuite,
  DesignSuiteChangeEvent,
  DesignSuiteKind,
  DesignSuiteSummary,
  DesignSuiteVersion,
  DesignTheme,
  UiSuiteContent,
} from "../shared/ipc.js";

const ROOT_A = "/registered/a";
const ROOT_B = "/unregistered/b";
const ARTIFACT: DesignArtifact = {
  id: "artifact-a",
  title: "Artifact A",
  pipeline: "openui",
  createdAt: "2026-09-06T00:00:00.000Z",
  updatedAt: "2026-09-06T00:00:00.000Z",
  content: "element Root",
};
const VERSION: DesignSuiteVersion = {
  versionId: "version-a",
  savedAt: "2026-09-06T00:00:00.000Z",
  status: "ready",
  content: { openui: "element Root" },
};
const HISTORICAL_VERSION: DesignSuiteVersion = {
  versionId: "version-history",
  savedAt: "2026-09-05T00:00:00.000Z",
  status: "draft",
  content: { openui: "historical-source" },
};
const SUITE: DesignSuite = {
  schemaVersion: 2,
  id: "suite-a",
  title: "Suite A",
  kind: "prototype",
  status: "ready",
  createdAt: "2026-09-06T00:00:00.000Z",
  updatedAt: "2026-09-06T00:00:00.000Z",
  currentVersionId: VERSION.versionId,
  versions: [VERSION],
  currentVersion: VERSION,
  currentContent: VERSION.content,
};
const SUMMARY: DesignSuiteSummary = {
  schemaVersion: 2,
  id: SUITE.id,
  title: SUITE.title,
  kind: SUITE.kind,
  status: SUITE.status,
  createdAt: SUITE.createdAt,
  updatedAt: SUITE.updatedAt,
  currentVersionId: SUITE.currentVersionId,
  versionCount: 1,
};

type Handler = (...args: never[]) => unknown;

type Harness = {
  handlers: Map<string, Handler>;
  privileged: Set<string>;
  emitted: Array<{ channel: string; payload: unknown }>;
  calls: { deleteSuite: number; savedPackage?: Buffer };
  fireArtifactChange(root: string): void;
  fireSuiteChange(event: DesignSuiteChangeEvent): void;
};

function createHarness(
  storeOverrides: Partial<
    Pick<
      DesignStoreOps,
      | "readSuite"
      | "readSuiteVersion"
      | "appendSuiteVersion"
      | "listThemes"
      | "createTheme"
      | "updateTheme"
      | "deleteTheme"
      | "assignSuiteTheme"
    >
  > = {}
): Harness {
  const handlers = new Map<string, Handler>();
  const privileged = new Set<string>();
  const emitted: Array<{ channel: string; payload: unknown }> = [];
  const calls: { deleteSuite: number; savedPackage?: Buffer } = { deleteSuite: 0 };
  let artifactListener: (root: string) => void = () => {};
  let suiteListener: (event: DesignSuiteChangeEvent) => void = () => {};
  const capture =
    (isPrivileged: boolean) =>
    <T>(channel: string, handler: (...args: never[]) => T | Promise<T>): void => {
      handlers.set(channel, handler as Handler);
      if (isPrivileged) privileged.add(channel);
    };
  const helpers: DesignIpcHelpers = {
    handle: capture(false),
    handlePrivileged: capture(true),
  };
  const store: DesignStoreOps = {
    listArtifacts: (root): DesignArtifactMeta[] => (root === ROOT_A ? [ARTIFACT] : []),
    readArtifact: (root, id) => (root === ROOT_A && id === ARTIFACT.id ? ARTIFACT : null),
    deleteArtifact: () => true,
    listSuites: (root, kind?: DesignSuiteKind) =>
      root === ROOT_A && (kind === undefined || kind === SUITE.kind) ? [SUMMARY] : [],
    readSuite: storeOverrides.readSuite ?? ((root, id) => (root === ROOT_A && id === SUITE.id ? SUITE : null)),
    readSuiteVersion:
      storeOverrides.readSuiteVersion ??
      ((root, id, versionId) => {
        if (root !== ROOT_A || id !== SUITE.id) return null;
        if (versionId === VERSION.versionId) return VERSION;
        return versionId === HISTORICAL_VERSION.versionId ? HISTORICAL_VERSION : null;
      }),
    deleteSuite: () => {
      calls.deleteSuite += 1;
      return true;
    },
    appendSuiteVersion: storeOverrides.appendSuiteVersion ?? (() => null),
    saveFormState: () => true,
    readFormState: () => ({ field: "value" }),
    listThemes: storeOverrides.listThemes ?? (() => []),
    createTheme: storeOverrides.createTheme ?? (() => null),
    updateTheme: storeOverrides.updateTheme ?? (() => false),
    deleteTheme: storeOverrides.deleteTheme ?? (() => false),
    assignSuiteTheme: storeOverrides.assignSuiteTheme ?? (() => false),
    onArtifactChange: (listener) => {
      artifactListener = listener;
      return () => {};
    },
    onSuiteChange: (listener) => {
      suiteListener = listener;
      return () => {};
    },
  };
  registerDesignIpc(helpers, {
    resolveRegisteredRoot: (root) => (root === undefined || root === ROOT_A ? ROOT_A : null),
    emit: (channel, payload) => emitted.push({ channel, payload }),
    savePackage: async (data) => {
      calls.savedPackage = data;
      return { ok: true, path: "/tmp/design.ddp" };
    },
    store,
    readCatalog: () => [],
  });
  return {
    handlers,
    privileged,
    emitted,
    calls,
    fireArtifactChange: (root) => artifactListener(root),
    fireSuiteChange: (event) => suiteListener(event),
  };
}

function invoke<T>(harness: Harness, channel: string, ...args: unknown[]): T {
  const handler = harness.handlers.get(channel);
  assert.ok(handler, `missing handler for ${channel}`);
  return handler(...(args as never[])) as T;
}

describe("design suite IPC root pinning", () => {
  test("registered root can list/read while unregistered root degrades empty", () => {
    const harness = createHarness();
    assert.deepEqual(invoke(harness, IpcRequest.DesignSuiteList, ROOT_A), [SUMMARY]);
    assert.equal(invoke(harness, IpcRequest.DesignSuiteRead, ROOT_A, SUITE.id), SUITE);
    assert.deepEqual(invoke(harness, IpcRequest.DesignSuiteList, ROOT_B), []);
    assert.equal(invoke(harness, IpcRequest.DesignSuiteRead, ROOT_B, SUITE.id), null);
    assert.equal(invoke(harness, IpcRequest.DesignSuiteReadVersion, ROOT_B, SUITE.id, VERSION.versionId), null);
  });

  test("unregistered delete never calls the store and mutations are privileged", () => {
    const harness = createHarness();
    assert.equal(invoke(harness, IpcRequest.DesignSuiteDelete, ROOT_B, SUITE.id), false);
    assert.equal(harness.calls.deleteSuite, 0);
    for (const channel of [
      IpcRequest.DesignDelete,
      IpcRequest.DesignExportPackage,
      IpcRequest.DesignSaveFormState,
      IpcRequest.DesignSuiteAppendLeafer,
      IpcRequest.DesignSuiteAssignTheme,
      IpcRequest.DesignSuiteDelete,
      IpcRequest.DesignSuiteExport,
      IpcRequest.DesignSuiteSaveFormState,
      IpcRequest.DesignThemeCreate,
      IpcRequest.DesignThemeDelete,
      IpcRequest.DesignThemeUpdate,
    ]) {
      assert.ok(harness.privileged.has(channel), `${channel} must be privileged`);
    }
  });

  test("legacy omitted root resolves to active registered root", () => {
    const harness = createHarness();
    assert.deepEqual(invoke(harness, IpcRequest.DesignList), [ARTIFACT]);
    assert.equal(invoke(harness, IpcRequest.DesignRead, ARTIFACT.id), ARTIFACT);
    assert.deepEqual(invoke(harness, IpcRequest.DesignList, ROOT_B), []);
  });

  test("suite export selects the requested historical version content", async () => {
    const harness = createHarness();
    const result = await invoke<Promise<{ ok: boolean }>>(
      harness,
      IpcRequest.DesignSuiteExport,
      ROOT_A,
      SUITE.id,
      HISTORICAL_VERSION.versionId
    );
    assert.equal(result.ok, true);
    assert.ok(harness.calls.savedPackage);
    assert.ok(harness.calls.savedPackage.includes(Buffer.from("historical-source", "utf8")));
    assert.equal(harness.calls.savedPackage.includes(Buffer.from("element Root", "utf8")), false);
  });

  test("suite change emits one rich event instead of a duplicate root-only event", async () => {
    const harness = createHarness();
    const event: DesignSuiteChangeEvent = {
      root: ROOT_A,
      suiteId: SUITE.id,
      versionId: VERSION.versionId,
      change: "update",
    };
    harness.fireArtifactChange(ROOT_A);
    harness.fireSuiteChange(event);
    await Promise.resolve();
    assert.deepEqual(harness.emitted, [{ channel: IpcEvent.DesignChanged, payload: event }]);
  });
});

describe("PRD theme channels (specs/prd-theme-layer)", () => {
  test("theme list degrades empty on an unregistered root", () => {
    const harness = createHarness({
      listThemes: (root) =>
        root === ROOT_A
          ? [{ id: "t1", title: "人员管理", createdAt: "2026-09-10T00:00:00Z", updatedAt: "2026-09-10T00:00:00Z" }]
          : [],
    });
    assert.equal(invoke<DesignTheme[]>(harness, IpcRequest.DesignThemeList, ROOT_A).length, 1);
    assert.deepEqual(invoke<DesignTheme[]>(harness, IpcRequest.DesignThemeList, ROOT_B), []);
  });

  test("theme create/update/delete are privileged, root-pinned and title-guarded", () => {
    const harness = createHarness({
      createTheme: (root, input) =>
        root === ROOT_A && input.title.trim()
          ? { id: "t1", title: input.title, createdAt: "2026-09-10T00:00:00Z", updatedAt: "2026-09-10T00:00:00Z" }
          : null,
      updateTheme: (root) => root === ROOT_A,
      deleteTheme: (root) => root === ROOT_A,
    });
    for (const channel of [IpcRequest.DesignThemeCreate, IpcRequest.DesignThemeUpdate, IpcRequest.DesignThemeDelete]) {
      assert.ok(harness.privileged.has(channel), `${channel} must be privileged`);
    }
    assert.equal(invoke<{ ok: boolean }>(harness, IpcRequest.DesignThemeCreate, ROOT_A, { title: "登录" }).ok, true);
    assert.equal(invoke<{ ok: boolean }>(harness, IpcRequest.DesignThemeCreate, ROOT_B, { title: "登录" }).ok, false);
    assert.equal(
      invoke<{ ok: boolean }>(harness, IpcRequest.DesignThemeCreate, ROOT_A, {}).ok,
      false,
      "missing title refused"
    );
    assert.deepEqual(invoke<{ ok: boolean }>(harness, IpcRequest.DesignThemeUpdate, ROOT_A, "t1", { title: "x" }), {
      ok: true,
    });
    assert.equal(
      invoke<{ ok: boolean }>(harness, IpcRequest.DesignThemeUpdate, ROOT_B, "t1", { title: "x" }).ok,
      false
    );
    assert.deepEqual(invoke<{ ok: boolean }>(harness, IpcRequest.DesignThemeDelete, ROOT_A, "t1"), { ok: true });
    assert.equal(invoke<{ ok: boolean }>(harness, IpcRequest.DesignThemeDelete, ROOT_B, "t1").ok, false);
  });

  test("suite theme assignment passes a sanitized patch through (clear semantics preserved)", () => {
    let captured: unknown;
    const harness = createHarness({
      assignSuiteTheme: (_root, _suiteId, input) => {
        captured = input;
        return true;
      },
    });
    assert.ok(harness.privileged.has(IpcRequest.DesignSuiteAssignTheme));
    const result = invoke<{ ok: boolean }>(harness, IpcRequest.DesignSuiteAssignTheme, ROOT_A, SUITE.id, {
      themeId: "t1",
      stage: "阶段1",
      inherits: { suiteId: "s2" },
      references: [{ suiteId: "s3", versionId: "v1" }, "junk"],
    });
    assert.equal(result.ok, true);
    assert.deepEqual(captured, {
      themeId: "t1",
      stage: "阶段1",
      inherits: { suiteId: "s2" },
      references: [{ suiteId: "s3", versionId: "v1" }],
    });

    // 清除语义透传（null）；载荷缺失拒绝。
    invoke<{ ok: boolean }>(harness, IpcRequest.DesignSuiteAssignTheme, ROOT_A, SUITE.id, {
      themeId: null,
      stage: null,
      references: null,
    });
    assert.deepEqual(captured, { themeId: null, stage: null, references: null });
    assert.equal(invoke<{ ok: boolean }>(harness, IpcRequest.DesignSuiteAssignTheme, ROOT_A, SUITE.id).ok, false);
    assert.equal(
      invoke<{ ok: boolean }>(harness, IpcRequest.DesignSuiteAssignTheme, ROOT_B, SUITE.id, { themeId: "t1" }).ok,
      false
    );
  });
});

test("design system catalog: nine bundled ids + project pseudo-entry + vendored when injected", () => {
  // specs/design-md-collection：目录 = bundled（9 套闭合）+ project 伪条目；
  // vendored 条目只在宿主注入根之后出现（测试环境默认未注入）。
  configureDesignSystemsVendorRoot(null);
  const baseIds = readDesignSystemCatalog(getExtensionRoot()).map((item) => item.id);
  assert.deepEqual(baseIds, [
    "brutalist-contrast",
    "dark-tech",
    "editorial",
    "glass-morphism",
    "modern-minimal",
    "soft-neumorphic",
    "swiss-international",
    "terminal-mono",
    "warm-handcrafted",
    "project",
  ]);
  const vendored = fs.mkdtempSync(path.join(os.tmpdir(), "design-md-catalog-"));
  fs.mkdirSync(path.join(vendored, "stripe"), { recursive: true });
  fs.writeFileSync(path.join(vendored, "stripe", "DESIGN.md"), "## A\nx\n## B\ny\n## C\nz", "utf8");
  configureDesignSystemsVendorRoot(vendored);
  try {
    const withVendor = readDesignSystemCatalog(getExtensionRoot());
    assert.ok(
      withVendor.some((item) => item.id === "stripe"),
      "vendored entry appears"
    );
    assert.ok(
      withVendor.some((item) => item.id === "project"),
      "project pseudo-entry retained"
    );
  } finally {
    configureDesignSystemsVendorRoot(null);
    fs.rmSync(vendored, { recursive: true, force: true });
  }
});

// ── Leafer canvas append (DesignSuiteAppendLeafer, WP1.4) ────────────────────

const OLD_LEAFER = JSON.stringify({
  tag: "Leafer",
  width: 1440,
  height: 1024,
  fill: "#ffffff",
  children: [{ tag: "Rect", x: 24, y: 24, width: 200, height: 64, fill: "#4F46E5" }],
});
const EDITED_LEAFER = JSON.stringify({
  tag: "Leafer",
  width: 1440,
  height: 1024,
  fill: "#ffffff",
  children: [{ tag: "Rect", x: 2000, y: 2000, width: 100, height: 50, fill: "#ff0000" }],
});
const UI_TOKENS = { color: { accent: { $value: "#4F46E5" } } };
const UI_VERSION: DesignSuiteVersion = {
  versionId: "ui-v1",
  savedAt: "2026-09-10T00:00:00.000Z",
  status: "ready",
  content: {
    leafer: OLD_LEAFER,
    designSystemId: "dark-tech",
    tokens: UI_TOKENS,
    quality: {
      lintFindings: [
        {
          id: "stale-1",
          preset: "leafer-static",
          ruleId: "out-of-bounds",
          severity: "error",
          nodePath: "document.children[9]",
          message: "stale finding describing the PREVIOUS tree",
        },
      ],
      runtimeChecks: [{ id: "check-1", label: "legacy check", status: "passed" }],
      review: { status: "passed", composite: 88, rounds: 2, evidence: { notes: "reviewed" } },
    },
  },
};
const UI_SUITE: DesignSuite = {
  schemaVersion: 2,
  id: "suite-ui",
  title: "UI Suite",
  kind: "ui",
  status: "ready",
  createdAt: "2026-09-10T00:00:00.000Z",
  updatedAt: "2026-09-10T00:00:00.000Z",
  currentVersionId: UI_VERSION.versionId,
  versions: [UI_VERSION],
  currentVersion: UI_VERSION,
  currentContent: UI_VERSION.content,
};

describe("leafer canvas append (DesignSuiteAppendLeafer)", () => {
  test("the appended version carries fresh auto-lint findings, preserving review and tokens", () => {
    let appended: UiSuiteContent | undefined;
    const harness = createHarness({
      readSuite: (root, id) => (root === ROOT_A && id === UI_SUITE.id ? UI_SUITE : null),
      readSuiteVersion: (root, id, versionId) =>
        root === ROOT_A && id === UI_SUITE.id && versionId === UI_VERSION.versionId ? UI_VERSION : null,
      appendSuiteVersion: (_root, input) => {
        appended = input.content as UiSuiteContent;
        return { ...UI_SUITE, currentVersionId: "ui-v2" };
      },
    });
    const result = invoke<{ ok: boolean; ref?: { suiteId: string; versionId: string; kind: string } }>(
      harness,
      IpcRequest.DesignSuiteAppendLeafer,
      ROOT_A,
      UI_SUITE.id,
      UI_VERSION.versionId,
      EDITED_LEAFER
    );
    assert.equal(result.ok, true);
    assert.equal(result.ref?.versionId, "ui-v2");
    assert.ok(appended, "the append must reach the store");
    const content = appended;
    assert.equal(content.leafer, EDITED_LEAFER, "the edited document is what gets stored");
    assert.equal(content.openui, undefined, "canvas commits never resurrect the legacy openui field");
    const findings = content.quality?.lintFindings ?? [];
    assert.ok(
      findings.some((finding) => finding.ruleId === "out-of-bounds"),
      "the zero-LLM auto-lint must describe the STORED tree (the edit introduces an out-of-bounds rect)"
    );
    assert.ok(
      !findings.some((finding) => finding.message.includes("PREVIOUS tree")),
      "the previous version's stale lint findings must not ride along"
    );
    assert.equal(content.quality?.review?.composite, 88, "review state stays untouched (design.review owns it)");
    assert.deepEqual(content.quality?.runtimeChecks, []);
    assert.deepEqual(content.tokens, UI_TOKENS, "tokens ride along so unlisted-color arms like design.lint");
  });

  test("a canvas commit against a moved head is refused", () => {
    const harness = createHarness({
      readSuite: (root, id) =>
        root === ROOT_A && id === UI_SUITE.id ? { ...UI_SUITE, currentVersionId: "ui-v2" } : null,
      readSuiteVersion: (root, id, versionId) =>
        root === ROOT_A && id === UI_SUITE.id && versionId === UI_VERSION.versionId ? UI_VERSION : null,
      appendSuiteVersion: () => {
        throw new Error("append must never be reached on a moved head");
      },
    });
    const result = invoke<{ ok: boolean; error?: string }>(
      harness,
      IpcRequest.DesignSuiteAppendLeafer,
      ROOT_A,
      UI_SUITE.id,
      UI_VERSION.versionId,
      EDITED_LEAFER
    );
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /head has moved/);
  });

  test("unregistered workspace root degrades to a refusal", () => {
    const harness = createHarness();
    const result = invoke<{ ok: boolean; error?: string }>(
      harness,
      IpcRequest.DesignSuiteAppendLeafer,
      ROOT_B,
      UI_SUITE.id,
      UI_VERSION.versionId,
      EDITED_LEAFER
    );
    assert.equal(result.ok, false);
    assert.equal(result.error, "unregistered workspace");
  });

  test("oversized canvas payloads are clamped at the boundary", () => {
    const harness = createHarness();
    const oversized = JSON.stringify({
      tag: "Leafer",
      width: 100,
      height: 100,
      children: [{ tag: "Text", x: 0, y: 0, text: "x".repeat(513 * 1024) }],
    });
    const result = invoke<{ ok: boolean; error?: string }>(
      harness,
      IpcRequest.DesignSuiteAppendLeafer,
      ROOT_A,
      UI_SUITE.id,
      UI_VERSION.versionId,
      oversized
    );
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /too large/);
  });
});

describe("PRD theme payload clamps (cross-review fix)", () => {
  test("oversized theme titles/notes and reference floods are refused at the boundary", () => {
    const harness = createHarness({
      createTheme: (_root, input) => ({ id: "t1", title: input.title, createdAt: "", updatedAt: "" }),
      assignSuiteTheme: () => true,
    });
    const bigTitle = invoke<{ ok: boolean; error?: string }>(harness, IpcRequest.DesignThemeCreate, ROOT_A, {
      title: "T".repeat(5000),
    });
    assert.equal(bigTitle.ok, false);
    assert.match(bigTitle.error ?? "", /too long/);
    const bigNote = invoke<{ ok: boolean; error?: string }>(harness, IpcRequest.DesignThemeCreate, ROOT_A, {
      title: "ok",
      note: "N".repeat(5000),
    });
    assert.equal(bigNote.ok, false);
    const flood = invoke<{ ok: boolean }>(harness, IpcRequest.DesignSuiteAssignTheme, ROOT_A, SUITE.id, {
      references: Array.from({ length: 5000 }, () => ({ suiteId: "s" })),
    });
    assert.equal(flood.ok, true, "assign still succeeds — the flood is clamped, not refused");
  });
});
