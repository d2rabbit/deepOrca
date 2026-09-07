import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { getExtensionRoot } from "@deeporca/core";

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

function createHarness(): Harness {
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
    readSuite: (root, id) => (root === ROOT_A && id === SUITE.id ? SUITE : null),
    readSuiteVersion: (root, id, versionId) => {
      if (root !== ROOT_A || id !== SUITE.id) return null;
      if (versionId === VERSION.versionId) return VERSION;
      return versionId === HISTORICAL_VERSION.versionId ? HISTORICAL_VERSION : null;
    },
    deleteSuite: () => {
      calls.deleteSuite += 1;
      return true;
    },
    saveFormState: () => true,
    readFormState: () => ({ field: "value" }),
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
      IpcRequest.DesignSuiteDelete,
      IpcRequest.DesignSuiteExport,
      IpcRequest.DesignSuiteSaveFormState,
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

test("design system catalog is sourced from exactly the nine bundled template ids", () => {
  const ids = readDesignSystemCatalog(getExtensionRoot()).map((item) => item.id);
  assert.deepEqual(ids, [
    "brutalist-contrast",
    "dark-tech",
    "editorial",
    "glass-morphism",
    "modern-minimal",
    "soft-neumorphic",
    "swiss-international",
    "terminal-mono",
    "warm-handcrafted",
  ]);
});
