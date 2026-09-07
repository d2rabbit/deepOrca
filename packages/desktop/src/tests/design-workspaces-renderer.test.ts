import { after, afterEach, before, test } from "node:test";
import assert from "node:assert/strict";
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
  assert.deepEqual(call?.args[1], { root: "/work/current", suiteId: prototype.id, versionId: "latest" });
  rtl.fireEvent.click(out.getByRole("tab", { name: "Acceptance report" }));
  rtl.fireEvent.click(out.getByText("Run acceptance walkthrough"));
  await settle();
  call = stub.calls.find((item) => item.method === "actionRun" && item.args[0] === "prototype.verify");
  assert.deepEqual(call?.args[1], { root: "/work/current", suiteId: prototype.id, versionId: "latest" });
  rtl.fireEvent.click(out.container.querySelector('[data-version-id="old"]') as Element);
  await settle();
  assert.equal((out.getByText("Run acceptance walkthrough") as HTMLButtonElement).disabled, true);
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
  await rtl.act(async () => {
    stub.emit("onDesignChanged", {
      root: "/work/current",
      suiteId: prototype.id,
      versionId: "latest",
      change: "update",
    });
  });
  await settle();
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
  assert.ok(out.getByText("Run acceptance walkthrough"));
});

test("floating agent surfaces the conversation body, typing state and the ack bubble", async () => {
  const prototype = suite("prototype", [version("latest", { spec: "# Scope", openui: "root = Text('x')" })]);
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
  // Welcome bubble renders on first expand.
  assert.ok(out.container.querySelector(".ui-floating-design-agent-msg.agent"));
  const input = out.getByPlaceholderText("Describe the revision…") as HTMLInputElement;
  rtl.fireEvent.change(input, { target: { value: "make the hero calmer" } });
  rtl.fireEvent.click(out.getByText("Submit"));
  assert.ok(out.container.querySelector(".ui-floating-design-agent-msg.user"));
  await settle();
  await settle();
  assert.ok(
    Array.from(out.container.querySelectorAll(".ui-floating-design-agent-msg.agent")).some((node) =>
      node.textContent?.includes("Revision applied")
    )
  );
  assert.equal(input.value, "", "the draft clears once the instruction is dispatched");
});

test("design toolbar shows the version badge with a localized status", async () => {
  const prototype = suite("prototype", [version("proto-v1", { spec: "# Scope", openui: "root = Text('v1')" })]);
  const ui = suite("ui", [
    version("ui-v1", {
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
  assert.match(badge.textContent ?? "", /v1 · Ready/);
});
