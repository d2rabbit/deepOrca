import { after, afterEach, before, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type * as React from "react";
import type * as RTL from "@testing-library/react";
import type { I18nProvider as I18nProviderComponent } from "../renderer/i18n";
import type { DesignPanel as DesignPanelComponent } from "../renderer/components/DesignPanel";
import type { PrototypeDesignPanel as PrototypeDesignPanelComponent } from "../renderer/components/PrototypeDesignPanel";
import type { DesignWorkspaceFrame as FrameComponent } from "../renderer/components/design-workspace/DesignWorkspaceFrame";
import type { PrototypeWorkspace as PrototypeWorkspaceComponent } from "../renderer/components/design-workspace/PrototypeWorkspace";
import type { DesignWorkspace as DesignWorkspaceComponent } from "../renderer/components/design-workspace/DesignWorkspace";
import type { SelectionPopover as SelectionPopoverComponent } from "../renderer/components/design-workspace/SelectionPopover";
import { parseDesignHash } from "../renderer/lib/design-deep-link";
import { paletteFor } from "../renderer/components/design-workspace/palettes";
import type {
  DesignSuite,
  DesignSuiteSummary,
  DesignSuiteVersion,
  DesignSystemCatalogItem,
  UiSuiteContent,
} from "../shared/ipc";
import { createApiStub, installDom, type ApiStub, type DomHandle } from "./dom-harness";

let dom: DomHandle;
let stub: ApiStub;
let rtl: typeof RTL;
let ReactPkg: typeof React;
let I18nProvider: typeof I18nProviderComponent;
let PrototypeDesignPanel: typeof PrototypeDesignPanelComponent;
let DesignPanel: typeof DesignPanelComponent;
let DesignWorkspaceFrame: typeof FrameComponent;
let PrototypeWorkspace: typeof PrototypeWorkspaceComponent;
let DesignWorkspace: typeof DesignWorkspaceComponent;
let SelectionPopover: typeof SelectionPopoverComponent;
const overrides: Record<string, unknown> = {};

function version(versionId: string, content: DesignSuiteVersion["content"], note = versionId): DesignSuiteVersion {
  return {
    versionId,
    content,
    note,
    savedAt: `2026-09-0${versionId === "latest" ? 6 : 5}T10:00:00.000Z`,
    status: "ready",
  };
}

function suite(kind: "prototype" | "ui", versions: DesignSuiteVersion[]): DesignSuite {
  // Store order is oldest-first; the current version is the last one.
  const currentVersion = versions[versions.length - 1];
  return {
    schemaVersion: 2,
    id: `${kind}-suite`,
    title: kind === "prototype" ? "Orders prototype" : "Orders UI",
    kind,
    status: "ready",
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-06T10:00:00.000Z",
    currentVersionId: currentVersion.versionId,
    versions,
    currentVersion,
    currentContent: currentVersion.content,
  };
}

function summary(value: DesignSuite): DesignSuiteSummary {
  return {
    schemaVersion: 2,
    id: value.id,
    title: value.title,
    kind: value.kind,
    status: value.status,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    currentVersionId: value.currentVersionId,
    versionCount: value.versions.length,
  };
}

function renderWithI18n(element: React.ReactElement) {
  return rtl.render(ReactPkg.createElement(I18nProvider, null, element));
}

async function settle(): Promise<void> {
  await rtl.act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

before(async () => {
  dom = installDom();
  Object.defineProperty(globalThis, "localStorage", { value: window.localStorage, configurable: true });
  localStorage.setItem("deeporca.locale", "en");
  stub = createApiStub(overrides);
  window.deeporca = stub.api as Window["deeporca"];
  rtl = await import("@testing-library/react");
  ReactPkg = await import("react");
  ({ I18nProvider } = await import("../renderer/i18n"));
  ({ PrototypeDesignPanel } = await import("../renderer/components/PrototypeDesignPanel"));
  ({ DesignPanel } = await import("../renderer/components/DesignPanel"));
  ({ DesignWorkspaceFrame } = await import("../renderer/components/design-workspace/DesignWorkspaceFrame"));
  ({ PrototypeWorkspace } = await import("../renderer/components/design-workspace/PrototypeWorkspace"));
  ({ DesignWorkspace } = await import("../renderer/components/design-workspace/DesignWorkspace"));
  ({ SelectionPopover } = await import("../renderer/components/design-workspace/SelectionPopover"));
});

afterEach(() => {
  rtl.cleanup();
  stub.reset();
  for (const key of Object.keys(overrides)) delete overrides[key];
});

after(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
  dom.cleanup();
});

test("prototype and design panels are read-only workspace directories with root-filtered refresh", async () => {
  const proto = suite("prototype", [version("latest", { spec: "# Scope", openui: "root = Text('ok')" })]);
  const ui = suite("ui", [
    version("latest", { openui: 'root = Screen("UI")\nhero = Card(data-sem="hero") { Text("Hero") }' }),
  ]);
  overrides.listWorkspaceSessions = async () => ({
    workspaces: [
      { root: "/work/current", label: "current", projectCode: "current", sessions: [] },
      { root: "/work/other", label: "other", projectCode: "other", sessions: [] },
    ],
    archived: [],
  });
  overrides.designSuiteList = async (root: string, kind?: string) => {
    if (root === "/work/current" && kind === "prototype") return [summary(proto)];
    if (root === "/work/current" && kind === "ui") return [summary(ui)];
    return [];
  };
  const opened: string[] = [];
  const out = renderWithI18n(
    ReactPkg.createElement(
      ReactPkg.Fragment,
      null,
      ReactPkg.createElement(PrototypeDesignPanel, {
        activeRoot: "/work/current",
        onOpenWorkspace: (root) => opened.push(root),
      }),
      ReactPkg.createElement(DesignPanel, {
        activeRoot: "/work/current",
        onOpenWorkspace: (root) => opened.push(root),
      })
    )
  );
  await settle();
  assert.equal(out.container.querySelectorAll(".ui-design-directory-group.current").length, 2);
  assert.ok(out.getByText("Orders prototype"));
  assert.ok(out.getByText("Orders UI"));
  assert.equal(out.container.querySelectorAll(".ui-design-directory-item[role=button]").length, 0);
  out.getByText("Orders prototype").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  assert.deepEqual(opened, []);
  const before = stub.calls.filter((call) => call.method === "designSuiteList").length;
  await rtl.act(async () => {
    stub.emit("onDesignChanged", { root: "/not-listed", suiteId: "x", change: "update" });
  });
  assert.equal(stub.calls.filter((call) => call.method === "designSuiteList").length, before);
  // Real suite events carry root/suiteId — known roots refresh incrementally.
  await rtl.act(async () => {
    stub.emit("onDesignChanged", { root: "/work/current", suiteId: proto.id, versionId: "latest", change: "update" });
  });
  await settle();
  const incremental = stub.calls
    .filter((call) => call.method === "designSuiteList")
    .filter((call) => call.args[0] === "/work/current").length;
  assert.ok(incremental > 0);
});

test("shared frame keeps one version selection across tabs and locks old versions", () => {
  // Store order: oldest-first, current version last (matches design-store).
  const versions = [version("old", { spec: "old" }), version("latest", { spec: "new" })];
  function Harness() {
    const [tab, setTab] = ReactPkg.useState<"a" | "b" | "c">("a");
    const [selected, setSelected] = ReactPkg.useState("latest");
    return ReactPkg.createElement(
      DesignWorkspaceFrame,
      {
        root: "/work/current",
        tabs: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
          { id: "c", label: "C" },
        ] as const,
        activeTab: tab,
        onTabChange: (next) => setTab(next as "a" | "b" | "c"),
        versions,
        selectedVersionId: selected,
        latestVersionId: "latest",
        onVersionChange: setSelected,
      },
      ReactPkg.createElement("button", null, `${tab}:${selected}`)
    );
  }
  const out = renderWithI18n(ReactPkg.createElement(Harness));
  rtl.fireEvent.click(out.container.querySelector('[data-version-id="old"]') as Element);
  assert.ok(out.getByText("This older version is read-only."));
  rtl.fireEvent.click(out.getByRole("tab", { name: "C" }));
  assert.ok(out.getByText("c:old"));
  rtl.fireEvent.click(out.getByText("Back to latest"));
  assert.ok(out.getByText("c:latest"));
});

test("prototype workspace runs spec, materialize and verify with suite version parameters; old versions stay read-only", async () => {
  const prototype = suite("prototype", [
    version("old", { spec: "# Scope\nOld requirements", openui: "root = Text('old')" }),
    version("latest", {
      spec: "# Scope\nLatest requirements",
      openui: "root = Text('latest')",
      verification: { status: "passed", checks: [{ id: "c1", label: "Loads", status: "passed" }] },
    }),
  ]);
  overrides.designSuiteList = async () => [summary(prototype)];
  overrides.designSuiteRead = async () => prototype;
  overrides.designSuiteReadVersion = async (_root: string, _id: string, id: string) =>
    prototype.versions.find((item) => item.versionId === id) ?? null;
  overrides.actionRun = async () => ({
    ok: true,
    output: { ok: true, artifactRef: { suiteId: prototype.id, versionId: "latest", kind: "prototype" } },
  });
  const out = renderWithI18n(
    ReactPkg.createElement(PrototypeWorkspace, { root: "/work/current", suiteId: prototype.id })
  );
  await settle();
  rtl.fireEvent.change(out.getByLabelText("Describe the requirement; one sentence is enough…"), {
    target: { value: "Build orders" },
  });
  rtl.fireEvent.click(out.getByText("Generate requirements"));
  await settle();
  let call = stub.calls.find((item) => item.method === "actionRun" && item.args[0] === "prototype.spec");
  assert.deepEqual(call?.args[1], { root: "/work/current", requirement: "Build orders", suiteId: prototype.id });
  rtl.fireEvent.click(out.getByText("Confirm and generate prototype"));
  await settle();
  call = stub.calls.find((item) => item.method === "actionRun" && item.args[0] === "prototype.materialize");
  // WP0.3 指令遵循:UI 不再硬编码三端——devices 由 action 依据 PRD 目标平台
  // 声明决定(mobile-only 只生成手机端)。
  assert.deepEqual(call?.args[1], { root: "/work/current", suiteId: prototype.id, versionId: "latest" });
  rtl.fireEvent.click(out.getByRole("tab", { name: "Acceptance report" }));
  rtl.fireEvent.click(out.getAllByText("Run acceptance walkthrough")[0]);
  await settle();
  call = stub.calls.find((item) => item.method === "actionRun" && item.args[0] === "prototype.verify");
  assert.deepEqual(call?.args[1], { root: "/work/current", suiteId: prototype.id, versionId: "latest" });
  rtl.fireEvent.click(out.container.querySelector('[data-version-id="old"]') as Element);
  await settle();
  // Old version → empty report state: header CTA + empty-state CTA, both locked.
  const walkthroughButtons = out.getAllByText("Run acceptance walkthrough") as HTMLButtonElement[];
  assert.ok(walkthroughButtons.length >= 2);
  assert.ok(walkthroughButtons.every((button) => button.disabled));
});

test("design workspace requires a concrete prototype version, exposes nine systems, and sends linked materialize params", async () => {
  const prototype = suite("prototype", [
    version("proto-v1", { spec: "# Scope", openui: "root = Text('v1')" }),
    version("proto-v2", { spec: "# Scope", openui: "root = Text('v2')" }),
  ]);
  const baseContent: UiSuiteContent = {
    openui: 'root = Screen("UI")\nhero = Card(data-sem="hero") { Text("Hero") }',
    tokens: { accent: "blue", spacing: 8 },
    components: [{ name: "Button" }],
    sourcePrototype: { suiteId: prototype.id, versionId: "proto-v2" },
    designSystemId: "modern-minimal",
    quality: {
      lintFindings: [
        {
          id: "f1",
          preset: "a11y",
          ruleId: "contrast",
          severity: "warning" as const,
          nodePath: '//section[@data-dd-id="hero"]',
          message: "Contrast is low",
          suggestion: "Increase contrast",
        },
      ],
      runtimeChecks: [{ id: "r1", label: "375 overflow", status: "passed" }],
    },
  };
  const ui = suite("ui", [version("ui-v1", baseContent)]);
  // Mutable store: each action "persists" a new suite version and moves current.
  const refByAction: Record<string, string> = {
    "design.materialize": "ui-generated",
    "design.lint": "ui-lint",
    "design.review": "ui-review",
  };
  const storedVersions: DesignSuiteVersion[] = [ui.versions[0]];
  let currentVersionId = "ui-v1";
  overrides.designSuiteList = async (_root: string, kind?: string) => {
    if (kind === "prototype") return [summary(prototype)];
    return [{ ...summary(ui), currentVersionId, versionCount: storedVersions.length }];
  };
  overrides.designSuiteRead = async (_root: string, id: string) => {
    if (id === prototype.id) return prototype;
    const current = storedVersions.find((item) => item.versionId === currentVersionId) ?? ui.currentVersion;
    return { ...ui, currentVersionId, currentVersion: current, versions: [...storedVersions] };
  };
  overrides.designSuiteReadVersion = async (_root: string, id: string, versionId: string) => {
    if (id === prototype.id) return prototype.versions.find((item) => item.versionId === versionId) ?? null;
    return storedVersions.find((item) => item.versionId === versionId) ?? null;
  };
  overrides.actionRun = async (id: string) => {
    const versionId = refByAction[id];
    if (versionId) {
      const content =
        id === "design.materialize"
          ? {
              ...baseContent,
              sourcePrototype: { suiteId: prototype.id, versionId: "proto-v1" },
              designSystemId: "editorial",
              quality: { lintFindings: [], runtimeChecks: [] },
            }
          : baseContent;
      storedVersions.push(version(versionId, content));
      currentVersionId = versionId;
    }
    return {
      ok: true,
      output: {
        ok: true,
        artifactRef: {
          suiteId: ui.id,
          versionId: versionId ?? "ui-v1",
          kind: "ui",
        },
      },
    };
  };
  const out = renderWithI18n(ReactPkg.createElement(DesignWorkspace, { root: "/work/current", suiteId: ui.id }));
  await settle();
  const selects = out.container.querySelectorAll(".ui-design-toolbar select");
  assert.equal(selects.length, 2);
  assert.equal((selects[0] as HTMLSelectElement).options.length, 2);
  assert.equal((selects[1] as HTMLSelectElement).options.length, 9);
  rtl.fireEvent.change(selects[0], { target: { value: `${prototype.id}:proto-v1` } });
  rtl.fireEvent.change(selects[1], { target: { value: "editorial" } });
  rtl.fireEvent.click(out.getByText("Generate from prototype"));
  await settle();
  const call = stub.calls.find((item) => item.method === "actionRun" && item.args[0] === "design.materialize");
  assert.deepEqual(call?.args[1], {
    root: "/work/current",
    prototypeSuiteId: prototype.id,
    prototypeVersionId: "proto-v1",
    designSystemId: "editorial",
    suiteId: ui.id,
  });
  assert.equal(
    stub.calls
      .filter((item) => item.method === "designSuiteReadVersion")
      .some((item) => item.args[2] === "ui-generated"),
    true
  );
  rtl.fireEvent.click(out.getByText("Run quality review"));
  await settle();
  const qualityCalls = stub.calls.filter((item) => item.method === "actionRun");
  const lintCall = qualityCalls.find((item) => item.args[0] === "design.lint");
  const reviewCall = qualityCalls.find((item) => item.args[0] === "design.review");
  assert.deepEqual(lintCall?.args[1], { root: "/work/current", suiteId: ui.id, versionId: "ui-generated" });
  assert.deepEqual(reviewCall?.args[1], { root: "/work/current", suiteId: ui.id, versionId: "ui-lint" });
  rtl.fireEvent.click(out.getByRole("tab", { name: "Design system" }));
  assert.ok(out.container.querySelector(".ui-design-token-group"));
  assert.ok(out.container.querySelector(".ui-design-component-chip"));
  assert.ok(out.getByText("accent"));
  assert.ok(out.container.querySelector(".ui-design-drift-chip") === null);
  rtl.fireEvent.click(out.getByRole("tab", { name: "Quality & review" }));
  assert.ok(out.getByText("Trigger chain"));
  rtl.fireEvent.click(out.getByText("Locate"));
  assert.equal(out.getByRole("tab", { name: "Visuals" }).getAttribute("aria-selected"), "true");
});

test("selection popover uses supplied geometry and Escape cancels", () => {
  let closed = 0;
  const out = renderWithI18n(
    ReactPkg.createElement(SelectionPopover, {
      selection: {
        nodePath: "view:root//button[1]",
        action: "auth:submit",
        bounds: { x: 20, y: 30, width: 80, height: 24 },
      },
      quickFixes: ["Tighten copy"],
      onClose: () => closed++,
      onFix: () => {},
      onExecute: () => {},
    })
  );
  const popover = out.getByTestId("selection-popover");
  assert.equal(popover.style.left, "110px");
  assert.equal(popover.style.top, "24px");
  rtl.fireEvent.keyDown(document, { key: "Escape" });
  assert.equal(closed, 1);
});

test("version rail displays newest-first with vN labels matching store identity", () => {
  const versions = [version("v1-old", { spec: "old" }), version("v2-new", { spec: "new" })];
  const out = renderWithI18n(
    ReactPkg.createElement(DesignWorkspaceFrame, {
      root: "/work/current",
      tabs: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ] as const,
      activeTab: "a",
      onTabChange: () => {},
      versions,
      selectedVersionId: "v2-new",
      latestVersionId: "v2-new",
      onVersionChange: () => {},
    })
  );
  const items = out.container.querySelectorAll(".ui-design-version-item");
  assert.equal(items.length, 2);
  // Newest first (mockup rail), and numbering matches the real store identity.
  assert.equal(items[0].getAttribute("data-version-id"), "v2-new");
  assert.equal(items[0].querySelector("strong")?.textContent, "v2");
  assert.equal(items[1].getAttribute("data-version-id"), "v1-old");
  assert.equal(items[1].querySelector("strong")?.textContent, "v1");
});

test("background suite events refresh without resetting the viewed version", async () => {
  const prototype = suite("prototype", [
    version("old", { spec: "# Scope\nOld requirements", openui: "root = Text('old')" }),
    version("latest", { spec: "# Scope\nLatest requirements", openui: "root = Text('latest')" }),
  ]);
  overrides.designSuiteList = async () => [summary(prototype)];
  overrides.designSuiteRead = async () => prototype;
  const out = renderWithI18n(
    ReactPkg.createElement(PrototypeWorkspace, { root: "/work/current", suiteId: prototype.id })
  );
  await settle();
  rtl.fireEvent.click(out.container.querySelector('[data-version-id="old"]') as Element);
  await settle();
  assert.ok(out.getByText("This older version is read-only."));
  // Re-review M6: pin the REFRESH half too — the emit must actually trigger a
  // reload (a dead subscription would leave this count flat and still pass the
  // banner assertions below).
  const readsBefore = stub.calls.filter((call) => call.method === "designSuiteRead").length;
  await rtl.act(async () => {
    stub.emit("onDesignChanged", {
      root: "/work/current",
      suiteId: prototype.id,
      versionId: "latest",
      change: "update",
    });
  });
  await settle();
  assert.ok(
    stub.calls.filter((call) => call.method === "designSuiteRead").length > readsBefore,
    "the suite event triggered a reload"
  );
  // The user is still reading the old version after the background refresh.
  assert.ok(out.getByText("This older version is read-only."));
});

test("待确认 items confirm page-local and gate materialize until cleared", async () => {
  const prototype = suite("prototype", [
    version("latest", {
      spec: "# Scope\n\n## 待确认\n- Add dark mode\n- Add search",
      openui: "root = Text('latest')",
    }),
  ]);
  overrides.designSuiteList = async () => [summary(prototype)];
  overrides.designSuiteRead = async () => prototype;
  overrides.designSuiteReadVersion = async (_root: string, _id: string, id: string) =>
    prototype.versions.find((item) => item.versionId === id) ?? null;
  const out = renderWithI18n(
    ReactPkg.createElement(PrototypeWorkspace, { root: "/work/current", suiteId: prototype.id })
  );
  await settle();
  const cta = () => out.getByText("Confirm and generate prototype") as HTMLButtonElement;
  // Mockup 2026-09: materialize stays locked until every pending item is confirmed.
  assert.equal(cta().disabled, true);
  assert.equal(out.getAllByText("✓ Confirm").length, 2);
  rtl.fireEvent.click(out.getAllByText("✓ Confirm")[0]);
  assert.equal(cta().disabled, true);
  rtl.fireEvent.click(out.getByText("✓ Confirm"));
  assert.equal(cta().disabled, false);
  // Page-local confirmation must NOT dispatch actions / spawn versions.
  assert.equal(stub.calls.filter((call) => call.method === "actionRun").length, 0);
});

test("deep-link hashes parse to workspace + tab segments; junk is inert", () => {
  assert.deepEqual(parseDesignHash("#design/tokens"), { kind: "design", tab: "tokens" });
  assert.deepEqual(parseDesignHash("#prototype/report"), { kind: "prototype", tab: "report" });
  assert.deepEqual(parseDesignHash("#design"), { kind: "design", tab: undefined });
  assert.equal(parseDesignHash("#design/unknown"), null);
  assert.equal(parseDesignHash("#chat"), null);
  assert.equal(parseDesignHash(""), null);
});

test("system palettes cover the nine bundled ids with --ds-* material", () => {
  for (const id of [
    "modern-minimal",
    "editorial",
    "dark-tech",
    "brutalist-contrast",
    "swiss-international",
    "terminal-mono",
    "glass-morphism",
    "soft-neumorphic",
    "warm-handcrafted",
  ]) {
    const palette = paletteFor(id);
    assert.ok(palette, id);
    assert.match(palette.accent, /^#/);
    assert.ok(palette.surface && palette.text && palette.radius);
  }
  assert.equal(paletteFor("unknown-system"), null);
});

test("deep link initialTab opens the workspace on the requested segment", async () => {
  const prototype = suite("prototype", [version("latest", { spec: "# Scope", openui: "root = Text('x')" })]);
  overrides.designSuiteList = async () => [summary(prototype)];
  overrides.designSuiteRead = async () => prototype;
  const out = renderWithI18n(
    ReactPkg.createElement(PrototypeWorkspace, { root: "/work/current", suiteId: prototype.id, initialTab: "report" })
  );
  await settle();
  assert.equal(out.getByRole("tab", { name: "Acceptance report" }).getAttribute("aria-selected"), "true");
  // Empty state: the walkthrough CTA exists in BOTH the doc head and the
  // empty-state card (mockup rp-actions) — two matches are correct here.
  assert.ok(out.getAllByText("Run acceptance walkthrough").length >= 2);
  assert.ok(out.container.querySelector(".ui-report-empty-state"));
});

test("floating agent surfaces the conversation body, typing state and the ack bubble", async () => {
  const prototype = suite("prototype", [version("latest", { spec: "# Scope", openui: "root = Text('x')" })]);
  overrides.designSuiteList = async () => [summary(prototype)];
  overrides.designSuiteRead = async () => prototype;
  overrides.designSuiteReadVersion = async (_root: string, _id: string, id: string) =>
    prototype.versions.find((item) => item.versionId === id) ?? null;
  // Re-review H3/M7: a manually-resolved actionRun pins the TYPING surface
  // deterministically (no settle-timing luck) — fire, assert mid-flight, then
  // resolve and assert the terminal ack.
  let resolveAction: ((value: { ok: boolean; output: unknown }) => void) | null = null;
  overrides.actionRun = () =>
    new Promise((resolve) => {
      resolveAction = resolve;
    });
  const out = renderWithI18n(
    ReactPkg.createElement(PrototypeWorkspace, { root: "/work/current", suiteId: prototype.id })
  );
  await settle();
  // Welcome bubble renders on first expand.
  assert.ok(out.container.querySelector(".ui-floating-design-agent-msg.agent"));
  const input = out.getByPlaceholderText("Describe the revision…") as HTMLInputElement;
  rtl.fireEvent.change(input, { target: { value: "make the hero calmer" } });
  await rtl.act(async () => {
    rtl.fireEvent.click(out.getByText("Submit"));
    await Promise.resolve();
  });
  assert.ok(out.container.querySelector(".ui-floating-design-agent-msg.user"));
  assert.ok(
    out.container.querySelector(".ui-floating-design-agent-typing"),
    "typing indicator is visible while the silent subagent runs"
  );
  assert.equal(input.value, "", "the draft clears once the instruction is dispatched");
  await rtl.act(async () => {
    resolveAction?.({
      ok: true,
      output: { ok: true, artifactRef: { suiteId: prototype.id, versionId: "latest", kind: "prototype" } },
    });
    await Promise.resolve();
    await Promise.resolve();
  });
  await settle();
  assert.equal(out.container.querySelector(".ui-floating-design-agent-typing"), null, "typing clears on settle");
  assert.ok(
    Array.from(out.container.querySelectorAll(".ui-floating-design-agent-msg.agent")).some((node) =>
      node.textContent?.includes("Revision applied")
    )
  );
});

test("design toolbar shows the version badge with a localized status", async () => {
  const prototype = suite("prototype", [version("proto-v1", { spec: "# Scope", openui: "root = Text('v1')" })]);
  // Re-review L15: two versions — a single-version fixture cannot
  // discriminate head-labeling conventions (both label the sole item v1).
  const ui = suite("ui", [
    version("ui-v1", { openui: 'root = Screen("UI v1")' }),
    version("ui-v2", {
      openui: 'root = Screen("UI")',
      tokens: { accent: "blue" },
      quality: { lintFindings: [], runtimeChecks: [] },
    }),
  ]);
  overrides.designSuiteList = async (_root: string, kind?: string) =>
    kind === "prototype" ? [summary(prototype)] : [summary(ui)];
  overrides.designSuiteRead = async (_root: string, id: string) => (id === prototype.id ? prototype : ui);
  const out = renderWithI18n(ReactPkg.createElement(DesignWorkspace, { root: "/work/current", suiteId: ui.id }));
  await settle();
  const badge = out.container.querySelector(".ui-design-vbadge");
  assert.ok(badge);
  assert.match(badge.textContent ?? "", /v2 · Ready/, "head (newest) labeled v2 — not the oldest");
});

test("leafer versions route to the leafer canvas, not the legacy OpenUI stage", async () => {
  const prototype = suite("prototype", [version("proto-v1", { spec: "# Scope", openui: "root = Text('v1')" })]);
  const leaferDoc = JSON.stringify({
    tag: "Leafer",
    width: 1440,
    height: 1024,
    fill: "#ffffff",
    children: [{ tag: "Rect", x: 24, y: 24, width: 200, height: 64, fill: "#4F46E5" }],
  });
  const ui = suite("ui", [
    version("ui-v1", {
      leafer: leaferDoc,
      designSystemId: "dark-tech",
      quality: { lintFindings: [], runtimeChecks: [] },
    }),
  ]);
  overrides.designSuiteList = async (_root: string, kind?: string) =>
    kind === "prototype" ? [summary(prototype)] : [summary(ui)];
  overrides.designSuiteRead = async (_root: string, id: string) => (id === prototype.id ? prototype : ui);
  overrides.designSuiteAppendLeafer = async () => ({ ok: true });
  const out = renderWithI18n(ReactPkg.createElement(DesignWorkspace, { root: "/work/current", suiteId: ui.id }));
  await settle();
  // The leafer ROUTE must be taken: either the canvas stage mounts (real
  // engine) or the engine failed under jsdom into its LOCAL error branch —
  // both prove the field-level routing picked the leafer branch (EARS 17).
  const routed =
    out.container.querySelector(".ui-design-leafer-stage") !== null ||
    (out.container.textContent ?? "").includes("canvas engine failed");
  assert.ok(routed, "leafer version must render through the leafer canvas branch");
  assert.equal(
    out.container.querySelector(".ui-design-legacy-chip"),
    null,
    "leafer version must not wear the legacy badge"
  );
});

test("legacy openui-only versions keep the read-only OpenUI stage with the legacy badge", async () => {
  const prototype = suite("prototype", [version("proto-v1", { spec: "# Scope", openui: "root = Text('v1')" })]);
  const ui = suite("ui", [version("ui-v1", { openui: 'root = Screen("UI v1")' })]);
  overrides.designSuiteList = async (_root: string, kind?: string) =>
    kind === "prototype" ? [summary(prototype)] : [summary(ui)];
  overrides.designSuiteRead = async (_root: string, id: string) => (id === prototype.id ? prototype : ui);
  const out = renderWithI18n(ReactPkg.createElement(DesignWorkspace, { root: "/work/current", suiteId: ui.id }));
  await settle();
  const chip = out.container.querySelector(".ui-design-legacy-chip");
  assert.ok(chip, "openui-only version must show the legacy view-only badge (EARS 15)");
  assert.match(chip.textContent ?? "", /Legacy OpenUI canvas/);
});

test("progress-label maps every core emit code both ways and handles format/terminal", async () => {
  const { PROGRESS_KEYS, progressLabel, isTerminalProgress } =
    await import("../renderer/components/design-workspace/progress-label");
  // Completeness, both directions: every dotted code literal the core actions
  // emit is mapped, and no mapped key is dead.
  const actionsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../core/src/actions");
  const sources = ["prototype.ts", "design.ts"]
    .map((name) => fs.readFileSync(path.join(actionsDir, name), "utf8"))
    .join("\n");
  const emitted = [...sources.matchAll(/["'](prototype|design)\.[a-z]+(?:\.[a-z]+)+["']/g)]
    .map((match) => match[0].slice(1, -1))
    // File-name literals ("prototype.openui.txt") share the dotted shape —
    // only two-segment-plus codes without extensions count.
    .filter((code) => !/\.(txt|md|json|dd)$/.test(code));
  assert.ok(emitted.length >= 11, `expected ≥11 codes, found ${emitted.length}`);
  for (const code of emitted) {
    assert.ok(PROGRESS_KEYS[code], `unmapped progress code: ${code}`);
  }
  for (const key of Object.keys(PROGRESS_KEYS)) {
    assert.ok(sources.includes(`"${key}"`), `dead mapping — core never emits: ${key}`);
  }
  // Formatting, unknown-code fallback and the terminal marker.
  const translate = (key: string) => `T:${key}`;
  assert.equal(
    progressLabel({ message: "raw", percent: 30, data: { code: "prototype.spec.generating" } }, translate),
    "30% — T:prototypeWorkspace.progressSpec"
  );
  assert.equal(progressLabel({ message: "plain english", percent: 10 }, translate), "10% — plain english");
  assert.equal(isTerminalProgress({ message: "done", data: { done: true } }), true);
  assert.equal(isTerminalProgress({ message: "x", data: { code: "a.b" } }), false);
});

test("hash deep link opens the most-recent workspace root with the tab segment and clears the hash", async () => {
  const hookModule = await import("../renderer/hooks/use-design-workspace-tabs");
  overrides.listWorkspaceSessions = async () => ({
    workspaces: [
      { root: "/work/current", label: "current", projectCode: "current", sessions: [] },
      { root: "/work/other", label: "other", projectCode: "other", sessions: [] },
    ],
    archived: [],
  });
  const seen: unknown[] = [];
  const setActiveTab = (updater: unknown): void => {
    // Object form = a direct open; function form = close/reset (ignored here).
    if (typeof updater === "function") return;
    seen.push(updater);
  };
  function HookHarness(): React.ReactElement {
    hookModule.useDesignWorkspaceTabs(setActiveTab as never);
    return ReactPkg.createElement("div", null, "hook");
  }
  window.location.hash = "#design/tokens";
  try {
    renderWithI18n(ReactPkg.createElement(HookHarness));
    await settle();
    assert.deepEqual(seen.at(-1), { kind: "design", root: "/work/current", tab: "tokens" });
    assert.equal(window.location.hash, "", "the consumed hash is cleared");
  } finally {
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }
});

// ── PRD 主题层（specs/prd-theme-layer）───────────────────────────────────────

test("directory groups suites by requirement theme and shows relations", async () => {
  const prototypeSuite = suite("prototype", [version("proto-v1", { spec: "# Scope", openui: "root = Text('v1')" })]);
  const uiSuite = suite("ui", [version("ui-v1", { openui: 'root = Screen("UI v1")', designSystemId: "dark-tech" })]);
  const theme = {
    id: "theme-login",
    title: "登录",
    createdAt: "2026-09-10T00:00:00.000Z",
    updatedAt: "2026-09-10T00:00:00.000Z",
  };
  const themedSummary = {
    ...summary(uiSuite),
    themeId: theme.id,
    stage: "阶段1",
    inherits: { suiteId: prototypeSuite.id },
  };
  overrides.listWorkspaceSessions = async () => ({ workspaces: [{ root: "/work/current", label: "current" }] });
  overrides.designSuiteList = async (_root: string, kind?: string) =>
    kind === "ui" ? [themedSummary] : [summary(prototypeSuite)];
  overrides.designSuiteRead = async (_root: string, id: string) => (id === uiSuite.id ? uiSuite : prototypeSuite);
  overrides.designThemeList = async () => [theme];
  const out = renderWithI18n(
    ReactPkg.createElement(DesignPanel, { activeRoot: "/work/current", onOpenWorkspace: () => {} })
  );
  await settle();
  // 主题分组出现：主题标题 + 阶段徽标 + 继承关系 chip（目标套件标题解析）。
  const grouped = out.container.querySelector(".ui-design-directory-theme");
  assert.ok(grouped, "theme group section must render when themes exist");
  assert.ok((out.container.textContent ?? "").includes("登录"), "theme title rendered");
  assert.ok((out.container.textContent ?? "").includes("阶段1"), "stage badge rendered");
  const inheritsChip = out.container.querySelector(".ui-design-directory-relations .ui-design-theme-relation.inherits");
  assert.ok(inheritsChip, "inherits chip rendered on the themed card");
  assert.ok(
    (inheritsChip?.textContent ?? "").includes("Orders prototype"),
    "inherits chip resolves the target suite title"
  );
  // 未分组区仍在（当前无未分组套件 → 空文案）。
  assert.ok(out.container.querySelector(".ui-design-directory-theme.ungrouped"));
  delete overrides.listWorkspaceSessions;
  delete overrides.designSuiteList;
  delete overrides.designSuiteRead;
  delete overrides.designThemeList;
});

test("directory keeps the flat list when the workspace has no themes (zero regression)", async () => {
  const uiSuite = suite("ui", [version("ui-v1", { openui: 'root = Screen("UI v1")' })]);
  overrides.listWorkspaceSessions = async () => ({ workspaces: [{ root: "/work/current", label: "current" }] });
  overrides.designSuiteList = async () => [summary(uiSuite)];
  overrides.designSuiteRead = async () => uiSuite;
  const out = renderWithI18n(
    ReactPkg.createElement(DesignPanel, { activeRoot: "/work/current", onOpenWorkspace: () => {} })
  );
  await settle();
  assert.equal(out.container.querySelector(".ui-design-directory-theme"), null, "no theme groups without themes");
  assert.ok(out.container.querySelector(".ui-design-directory-items .ui-design-directory-suite"), "flat list intact");
  assert.ok(out.container.querySelector(".ui-design-directory-theme-new"), "new-theme entry point available");
  delete overrides.listWorkspaceSessions;
  delete overrides.designSuiteList;
  delete overrides.designSuiteRead;
});

test("ThemeStrip hides without theme meta and renders theme/stage/relation chips with one", async () => {
  const { ThemeStrip } = await import("../renderer/components/design-workspace/ThemeStrip");
  const themes = [
    { id: "t1", title: "登录", createdAt: "2026-09-10T00:00:00.000Z", updatedAt: "2026-09-10T00:00:00.000Z" },
  ];
  const plain = suite("ui", [version("ui-v1", { openui: "root = Screen()" })]) as DesignSuite;
  const themed = {
    ...plain,
    themeId: "t1",
    stage: "阶段1",
    inherits: { suiteId: "proto-suite" },
    references: [{ suiteId: "proto-suite", versionId: "v9" }],
  } as DesignSuite;
  const hidden = renderWithI18n(
    ReactPkg.createElement(ThemeStrip, { suite: plain, themes, suiteTitles: { "proto-suite": "人员管理" } } as never)
  );
  assert.equal(hidden.container.querySelector(".ui-design-theme-strip"), null, "un-themed suite hides the strip");

  const shown = renderWithI18n(
    ReactPkg.createElement(ThemeStrip, { suite: themed, themes, suiteTitles: { "proto-suite": "人员管理" } } as never)
  );
  const strip = shown.container.querySelector(".ui-design-theme-strip");
  assert.ok(strip, "themed suite renders the strip");
  assert.ok((strip?.textContent ?? "").includes("登录"), "theme chip shows the theme title");
  assert.ok((strip?.textContent ?? "").includes("阶段1"), "stage chip rendered");
  assert.ok((strip?.textContent ?? "").includes("人员管理"), "relation chips resolve titles");
});

test("spec page exposes the prompt-doc view and the regenerate entry (specs/prompt-doc-chain)", async () => {
  const prototype = suite("prototype", [
    version("latest", {
      spec: "# Scope",
      pmDesign: "# 登录原型设计提示\n\n## 页面结构\n- 登录页：账号密码表单",
      openui: "root = Text('v1')",
    }),
  ]);
  overrides.designSuiteList = async () => [summary(prototype)];
  overrides.designSuiteRead = async () => prototype;
  overrides.designThemeList = async () => [];
  const out = renderWithI18n(
    ReactPkg.createElement(PrototypeWorkspace, { root: "/work/current", suiteId: prototype.id })
  );
  await settle();
  // 提示词视图切换（en locale）。
  rtl.fireEvent.click(out.getByText("Prompt doc"));
  await settle();
  const pdView = out.container.querySelector('[data-testid="pm-design-view"]');
  assert.ok(pdView, "pm-design view renders");
  assert.ok((pdView?.textContent ?? "").includes("登录原型设计提示"), "pm-design body rendered");
  // 手动重算入口 → prototype.pmdesign 动作。
  rtl.fireEvent.click(out.getByText("Regenerate pm-design"));
  await settle();
  const call = stub.calls.find((item) => item.method === "actionRun" && item.args[0] === "prototype.pmdesign");
  assert.deepEqual(call?.args[1], {
    root: "/work/current",
    suiteId: prototype.id,
    versionId: "latest",
  });
  delete overrides.designSuiteList;
  delete overrides.designSuiteRead;
  delete overrides.designThemeList;
});

test("cross-review: theme groups collapse via summary; composer creates themes inline and threads context (specs cross-review)", async () => {
  const prototype = suite("prototype", [version("latest", { spec: "# Scope", openui: "root = Text('v1')" })]);
  const uiSuite = suite("ui", [version("ui-v1", { openui: 'root = Screen("UI v1")', designSystemId: "dark-tech" })]);
  const theme = {
    id: "t1",
    title: "登录",
    createdAt: "2026-09-10T00:00:00.000Z",
    updatedAt: "2026-09-10T00:00:00.000Z",
  };
  overrides.listWorkspaceSessions = async () => ({ workspaces: [{ root: "/work/current", label: "current" }] });
  overrides.designSuiteList = async (_root: string, kind?: string) =>
    kind === "ui" ? [summary(uiSuite)] : [summary(prototype)];
  overrides.designSuiteRead = async (_root: string, id: string) => (id === uiSuite.id ? uiSuite : prototype);
  overrides.designThemeList = async () => [theme];
  const dir = renderWithI18n(
    ReactPkg.createElement(DesignPanel, { activeRoot: "/work/current", onOpenWorkspace: () => {} })
  );
  await settle();
  // F13 折叠：details/summary 原生折叠。
  const group = dir.container.querySelector(".ui-design-directory-theme[open]") as HTMLDetailsElement | null;
  assert.ok(group, "theme group renders as a collapsible <details> (default open)");
  rtl.fireEvent.click(group!.querySelector("summary") as Element);
  assert.equal(group!.open, false, "clicking the summary collapses the group");
  rtl.fireEvent.click(group!.querySelector("summary") as Element);
  assert.equal(group!.open, true, "clicking again re-opens it");

  // F14 编辑器内新建主题 + D14 设计上下文随 runSpec 透传。
  const created = {
    id: "t-new",
    title: "权限",
    createdAt: "2026-09-10T00:00:00.000Z",
    updatedAt: "2026-09-10T00:00:00.000Z",
  };
  overrides.designThemeCreate = async () => ({ ok: true, theme: created });
  const pw = renderWithI18n(
    ReactPkg.createElement(PrototypeWorkspace, { root: "/work/current", suiteId: prototype.id })
  );
  await settle();
  rtl.fireEvent.click(pw.getByText("Design context (theme / stage / relations)"));
  // 工作台编辑器内的内联新建按钮（目录里也有同名入口，限定 composer 范围）。
  rtl.fireEvent.click(pw.container.querySelector(".ui-design-theme-new-inline") as Element);
  await rtl.act(async () => {
    rtl.fireEvent.change(pw.container.querySelector(".ui-design-theme-create-inline input") as Element, {
      target: { value: "权限" },
    });
  });
  rtl.fireEvent.click(pw.container.querySelector('.ui-design-theme-create-inline button[type="submit"]') as Element);
  await settle();
  const themeSelect = pw.container.querySelector(".ui-design-theme-pick select") as HTMLSelectElement;
  assert.equal(themeSelect.value, "t-new", "created theme is auto-selected in the composer");
  // 阶段 + 继承 + 参考 → runSpec 透传（D14）。
  const stageInput = pw.container.querySelectorAll(".ui-design-theme-context-grid input")[0] as HTMLInputElement;
  await rtl.act(async () => {
    rtl.fireEvent.change(stageInput, { target: { value: "阶段1" } });
  });
  await rtl.act(async () => {
    rtl.fireEvent.change(pw.getByLabelText("Describe the requirement; one sentence is enough…"), {
      target: { value: "Build login" },
    });
  });
  rtl.fireEvent.click(pw.getByText("Generate requirements"));
  await settle();
  const call = stub.calls.find((item) => item.method === "actionRun" && item.args[0] === "prototype.spec");
  assert.deepEqual(call?.args[1], {
    root: "/work/current",
    requirement: "Build login",
    suiteId: prototype.id,
    themeId: "t-new",
    stage: "阶段1",
  });
  delete overrides.listWorkspaceSessions;
  delete overrides.designSuiteList;
  delete overrides.designSuiteRead;
  delete overrides.designThemeList;
  delete overrides.designThemeCreate;
});

test("cross-review: theme CRUD failures surface an error instead of a silent no-op", async () => {
  const uiSuite = suite("ui", [version("ui-v1", { openui: 'root = Screen("UI v1")' })]);
  overrides.listWorkspaceSessions = async () => ({ workspaces: [{ root: "/work/current", label: "current" }] });
  overrides.designSuiteList = async () => [summary(uiSuite)];
  overrides.designSuiteRead = async () => uiSuite;
  overrides.designThemeList = async () => [];
  overrides.designThemeCreate = async () => ({ ok: false, error: "theme title too long (limit 200 characters)" });
  const out = renderWithI18n(
    ReactPkg.createElement(DesignPanel, { activeRoot: "/work/current", onOpenWorkspace: () => {} })
  );
  await settle();
  rtl.fireEvent.click(out.getByText("+ New theme"));
  await rtl.act(async () => {
    rtl.fireEvent.change(out.container.querySelector(".ui-design-directory-theme-create input") as Element, {
      target: { value: "登录" },
    });
  });
  rtl.fireEvent.click(
    out.container.querySelector('.ui-design-directory-theme-create button[type="submit"]') as Element
  );
  await settle();
  assert.ok(
    (out.container.textContent ?? "").includes("theme title too long"),
    "the {ok:false} error surfaces in the directory"
  );
  delete overrides.listWorkspaceSessions;
  delete overrides.designSuiteList;
  delete overrides.designSuiteRead;
  delete overrides.designThemeList;
  delete overrides.designThemeCreate;
});

test("directory UI segments route by leafer content (EARS 17) — a leafer suite is NOT reported as ungenerated", async () => {
  const leaferDoc = JSON.stringify({
    tag: "Leafer",
    width: 1440,
    height: 1024,
    fill: "#ffffff",
    children: [{ tag: "Rect", x: 24, y: 24, width: 200, height: 64, fill: "#4F46E5" }],
  });
  const uiSuite = suite("ui", [version("ui-v1", { leafer: leaferDoc, designSystemId: "dark-tech" })]);
  overrides.listWorkspaceSessions = async () => ({ workspaces: [{ root: "/work/current", label: "current" }] });
  overrides.designSuiteList = async () => [summary(uiSuite)];
  overrides.designSuiteRead = async () => uiSuite;
  overrides.designThemeList = async () => [];
  const out = renderWithI18n(
    ReactPkg.createElement(DesignPanel, { activeRoot: "/work/current", onOpenWorkspace: () => {} })
  );
  await settle();
  const segs = [...out.container.querySelectorAll(".ui-design-directory-seg .ui-design-directory-item")].map((n) =>
    (n.textContent || "").trim()
  );
  // p-core 回归：视觉稿段必须显示 v1（已生成），不得再报 Not generated。
  const visual = segs.find((s) => s.includes("Visual"));
  assert.ok(visual && visual.includes("v1"), `visual segment shows generated: ${visual}`);
  assert.ok(!visual?.includes("Not generated"), "leafer suite must not be misreported as ungenerated");
  delete overrides.listWorkspaceSessions;
  delete overrides.designSuiteList;
  delete overrides.designSuiteRead;
  delete overrides.designThemeList;
});
