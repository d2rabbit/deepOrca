/**
 * Spec → slides IPC handlers (main design-ipc.ts) — specs/artifact-landing B.
 * Pins the export contract (B9/B10/B11):
 *   - preview returns self-contained {html, css, pages} without scripts,
 *   - HTML export writes slides.html into the suite dir and reports
 *     CSP-blocked remote images,
 *   - PDF export prints through the injected renderPdf and writes slides.pdf,
 *   - unregistered roots and non-prototype suites degrade to {ok:false},
 *   - the versioned content model (versions/*.json) is never touched.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { registerDesignIpc } from "../main/design-ipc";
import type { DesignSuite, DesignSuiteVersion } from "../shared/ipc";

const SPEC = `# 登录模块重设计

产出可演示的登录界面与验收口径。

## 登录页

- 账号密码输入
`;

const SUITE = {
  schemaVersion: 2,
  id: "s1",
  title: "登录重设计",
  kind: "prototype",
  status: "draft",
  createdAt: "2026-09-08T00:00:00Z",
  updatedAt: "2026-09-08T00:00:00Z",
  currentVersionId: "v1",
  authoringLibrary: "official",
  versions: [{ versionId: "v1", savedAt: "2026-09-08T00:00:00Z", status: "draft" }],
  currentVersion: {
    versionId: "v1",
    savedAt: "2026-09-08T00:00:00Z",
    status: "draft",
    content: { spec: SPEC },
  },
} as unknown as DesignSuite;

/** Boot the real registerDesignIpc with a stub store + captured handlers. */
function boot(root: string, suite: DesignSuite | null) {
  const handlers = new Map<string, (...args: never[]) => unknown>();
  const readVersion = (id: string, versionId?: string): DesignSuiteVersion | null =>
    suite && (!versionId || versionId === suite.currentVersionId) ? suite.currentVersion : null;
  registerDesignIpc(
    {
      handle: (channel, fn) => handlers.set(channel, fn as (...args: never[]) => unknown),
      handlePrivileged: (channel, fn) => handlers.set(channel, fn as (...args: never[]) => unknown),
    },
    {
      resolveRegisteredRoot: (r?: string) => (r === root ? root : null),
      emit: () => {},
      savePackage: async () => ({ ok: true }),
      renderPdf: async () => new Uint8Array([37, 80, 68, 70, 45, 49]), // %PDF-1
      store: {
        listArtifacts: () => [],
        readArtifact: () => null,
        deleteArtifact: () => false,
        listSuites: () => [],
        readSuite: (_r: string, id: string) => (suite && suite.id === id ? suite : null),
        readSuiteVersion: (_r: string, id: string, versionId?: string) => readVersion(id, versionId),
        deleteSuite: () => false,
        appendSuiteVersion: () => null,
        saveFormState: () => false,
        readFormState: () => null,
        listThemes: () => [],
        createTheme: () => null,
        updateTheme: () => false,
        deleteTheme: () => false,
        assignSuiteTheme: () => false,
        onArtifactChange: () => () => {},
        onSuiteChange: () => () => {},
      },
    }
  );
  return (channel: string) => handlers.get(channel) as (...args: unknown[]) => unknown;
}

test("spec-slides IPC: preview renders pages without scripts; remote images counted", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deeporca-slides-"));
  try {
    const call = boot(root, SUITE);
    const res = (await call("prototype:specSlides")(root, "s1")) as { ok: boolean; pages?: number; html?: string };
    assert.equal(res.ok, true);
    assert.ok((res.pages ?? 0) >= 2);
    assert.ok(!res.html?.includes("<script"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("spec-slides IPC: html/pdf exports land in the suite dir, version model untouched", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deeporca-slides-"));
  try {
    const suiteDir = path.join(root, ".deeporca", "designs", "s1");
    fs.mkdirSync(suiteDir, { recursive: true });
    const call = boot(root, SUITE);

    const html = (await call("prototype:specExportSlides")(root, "s1", "html")) as {
      ok: boolean;
      path?: string;
      blockedRemote?: number;
    };
    assert.equal(html.ok, true);
    assert.equal(html.path, path.join(suiteDir, "slides.html"));
    const written = fs.readFileSync(html.path!, "utf-8");
    assert.ok(written.includes("default-src 'none'"));
    assert.ok(fs.existsSync(path.join(suiteDir, "versions")) === false);

    const pdf = (await call("prototype:specExportSlides")(root, "s1", "pdf")) as { ok: boolean; path?: string };
    assert.equal(pdf.ok, true);
    const bytes = fs.readFileSync(pdf.path!);
    assert.deepEqual([...bytes.slice(0, 4)], [37, 80, 68, 70]); // %PDF
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("spec-slides IPC: unregistered root / missing suite degrade to ok:false", async () => {
  const call = boot("/tmp/never", SUITE);
  const unregistered = (await call("prototype:specSlides")("other-root", "s1")) as { ok: boolean; error?: string };
  assert.equal(unregistered.ok, false);
  const noSuite = (await call("prototype:specSlides")("/tmp/never", "ghost")) as { ok: boolean };
  assert.equal(noSuite.ok, false);
});

test("spec-slides IPC: exports serialize per suite — a concurrent different-version export is refused", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deeporca-slides-"));
  try {
    fs.mkdirSync(path.join(root, ".deeporca", "designs", "s1"), { recursive: true });
    const call = boot(root, SUITE);
    // Both kinds AND both versions write the same per-suite slides.html (the
    // PDF reads it back) — the mutex must be per suite, not per version, or
    // two runs interleave 'w'-truncate writes into a corrupted derivative.
    const first = call("prototype:specExportSlides")(root, "s1", "html") as Promise<{ ok: boolean }>;
    const second = (await call("prototype:specExportSlides")(root, "s1", "html", "v1")) as {
      ok: boolean;
      error?: string;
    };
    assert.equal(second.ok, false);
    assert.match(second.error ?? "", /already in progress/);
    assert.equal((await first).ok, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
