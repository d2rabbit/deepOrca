import { readFileSync, readdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, extname, join, parse } from "node:path";
import { fileURLToPath } from "node:url";

import {
  getExtensionRoot,
  lintLeaferDocument,
  getDesignSystemsVendorRoot,
  listVendoredDesignSystems,
  PROJECT_DESIGN_SYSTEM_ID,
} from "@deeporca/core";

import { compileDdToHtml } from "../renderer/dd/compiler.js";
import { parseDdFile } from "../renderer/dd/parser.js";
import { IpcEvent, IpcRequest } from "../shared/ipc.js";
import type {
  DesignArtifact,
  DesignArtifactMeta,
  DesignChangedEvent,
  DesignPipeline,
  DesignSuite,
  DesignSuiteChangeEvent,
  DesignSuiteContent,
  DesignSuiteKind,
  DesignSuiteStatus,
  DesignSuiteSummary,
  DesignSuiteVersion,
  DesignSystemCatalogItem,
  DesignThemeRef,
  PrototypeSuiteContent,
  UiSuiteContent,
} from "../shared/ipc.js";
import {
  buildDdpPackage,
  buildDduLeaferPackage,
  buildDduOpenuiPackage,
  buildDduPackage,
  resolveLeaferRuntimeBundle,
  type PackageVerification,
} from "./tools/dd-package.js";
import {
  appendDesignSuiteVersion,
  assignSuiteTheme,
  createDesignTheme,
  deleteDesignArtifact,
  deleteDesignSuite,
  deleteDesignTheme,
  designSuiteDir,
  listDesignArtifacts,
  listDesignSuites,
  listDesignThemes,
  onDesignStoreChange,
  onDesignSuiteChange,
  readDesignArtifact,
  readDesignSuite,
  readDesignSuiteVersion,
  readFormState,
  saveFormState,
  updateDesignTheme,
  THEME_NOTE_MAX_CHARS,
  THEME_REFERENCES_MAX_ENTRIES,
  THEME_TITLE_MAX_CHARS,
  type AssignSuiteThemeInput,
  type DesignTheme,
} from "./tools/design-store.js";
import { buildSlidesHtml, renderSpecSlides, type SpecSlidesAppearance } from "./tools/spec-slides.js";
import { buildImplementationBrief } from "./tools/prototype-brief.js";

export interface DesignIpcHelpers {
  handle: <T>(channel: string, fn: (...args: never[]) => T | Promise<T>) => void;
  handlePrivileged: <T>(channel: string, fn: (...args: never[]) => T | Promise<T>) => void;
}

export type DesignPackageSaveOptions = {
  title: string;
  defaultPath: string;
  filters: Array<{ name: string; extensions: string[] }>;
};

export interface DesignStoreOps {
  listArtifacts(root: string): DesignArtifactMeta[];
  readArtifact(root: string, id: string): DesignArtifact | null;
  deleteArtifact(root: string, id: string): boolean;
  listSuites(root: string, kind?: DesignSuiteKind): DesignSuiteSummary[];
  readSuite(root: string, id: string): DesignSuite | null;
  readSuiteVersion(root: string, id: string, versionId: string): DesignSuiteVersion | null;
  deleteSuite(root: string, id: string): boolean;
  /** Append a version built from a full suite content (canvas-edit seam). */
  appendSuiteVersion(
    root: string,
    input: { suiteId: string; content: DesignSuiteContent; note?: string; status?: DesignSuiteStatus }
  ): DesignSuite | null;
  saveFormState(root: string, id: string, state: unknown, slot?: string): boolean;
  readFormState(root: string, id: string, slot?: string): unknown | null;
  /** PRD 主题层（specs/prd-theme-layer）：主题 CRUD + 套件主题指派。 */
  listThemes(root: string): DesignTheme[];
  createTheme(root: string, input: { title: string; note?: string }): DesignTheme | null;
  updateTheme(root: string, id: string, input: { title?: string; note?: string | null }): boolean;
  deleteTheme(root: string, id: string): boolean;
  assignSuiteTheme(root: string, suiteId: string, input: AssignSuiteThemeInput): boolean;
  onArtifactChange(cb: (root: string) => void): () => void;
  onSuiteChange(cb: (event: DesignSuiteChangeEvent) => void): () => void;
}

export interface DesignIpcDeps {
  resolveRegisteredRoot(root?: string): string | null;
  emit(channel: string, payload: unknown): void;
  savePackage(data: Buffer, options: DesignPackageSaveOptions): Promise<{ ok: boolean; path?: string; error?: string }>;
  /** Offscreen Chromium print-to-PDF (specs/artifact-landing B9) — injected by
   *  main/index.ts where Electron lives; design-ipc stays Electron-free. */
  renderPdf?: (htmlPath: string) => Promise<Uint8Array>;
  store?: DesignStoreOps;
  readCatalog?: () => DesignSystemCatalogItem[];
}

const defaultStore: DesignStoreOps = {
  listArtifacts: listDesignArtifacts,
  readArtifact: readDesignArtifact,
  deleteArtifact: deleteDesignArtifact,
  listSuites: listDesignSuites,
  readSuite: readDesignSuite,
  readSuiteVersion: readDesignSuiteVersion,
  deleteSuite: deleteDesignSuite,
  appendSuiteVersion: appendDesignSuiteVersion,
  saveFormState,
  readFormState,
  listThemes: listDesignThemes,
  createTheme: createDesignTheme,
  updateTheme: updateDesignTheme,
  deleteTheme: deleteDesignTheme,
  assignSuiteTheme,
  onArtifactChange: onDesignStoreChange,
  onSuiteChange: onDesignSuiteChange,
};

function readTailwindScript(): string | null {
  try {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    return readFileSync(join(currentDir, "..", "vendor", "tailwind", "tailwind.js"), "utf8") || null;
  } catch {
    return null;
  }
}

function catalogDescription(content: string): string {
  const quoted: string[] = [];
  for (const line of content.split(/\r?\n/).slice(1)) {
    const trimmed = line.trim();
    if (!trimmed && quoted.length === 0) continue;
    if (!trimmed.startsWith(">")) break;
    quoted.push(trimmed.replace(/^>\s?/, ""));
  }
  return quoted.join(" ").trim();
}

/** Vendored DESIGN.md 标题：YAML frontmatter 取 name:；markdown 取 H1；兜底 id。 */
function vendoredTitle(content: string, id: string): string {
  const lines = content.split(/\r?\n/);
  if ((lines[0] ?? "").trim() === "---") {
    for (const line of lines.slice(1, 40)) {
      if (line.trim() === "---") break;
      const match = line.match(/^name:\s*(.+)$/);
      if (match) return match[1].trim().replace(/^["']|["']$/g, "");
    }
  }
  const h1 = lines.find((line) => /^#\s+\S/.test(line));
  if (h1) return h1.replace(/^#\s+(?:Design System:\s*)?/, "").trim();
  return id;
}

/** Vendored DESIGN.md 描述：frontmatter description:（截断）；blockquote 兜底。 */
function vendoredDescription(content: string): string {
  const lines = content.split(/\r?\n/);
  if ((lines[0] ?? "").trim() === "---") {
    for (const line of lines.slice(1, 40)) {
      if (line.trim() === "---") break;
      const match = line.match(/^description:\s*(.+)$/);
      if (match) {
        const text = match[1].trim().replace(/^["']|["']$/g, "");
        return text.length > 160 ? `${text.slice(0, 157)}…` : text;
      }
    }
  }
  return catalogDescription(content);
}

/** The host-injected vendored collection dir (core owns the path knowledge). */
function vendorDirOf(): string {
  // resolveDesignSystem 注入根由 main/index.ts 设置；此处只列目录内容。
  const root = getDesignSystemsVendorRoot();
  if (!root) throw new Error("no vendored design-md root configured");
  return root;
}

/** Read the design-system catalog: bundled templates (core extension root) +
 *  vendored DESIGN.md collection (specs/design-md-collection) + the "project"
 *  pseudo-entry (workspace DESIGN.md — picked without the file, the
 *  design.materialize action returns an actionable error). */
export function readDesignSystemCatalog(extensionRoot: string = getExtensionRoot()): DesignSystemCatalogItem[] {
  const systemsDir = join(extensionRoot, "templates", "design", "systems");
  const bundled: DesignSystemCatalogItem[] = [];
  try {
    bundled.push(
      ...readdirSync(systemsDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && extname(entry.name) === ".md")
        .map((entry) => {
          const id = parse(entry.name).name;
          const content = readFileSync(join(systemsDir, entry.name), "utf8");
          const firstLine = content.split(/\r?\n/, 1)[0] ?? "";
          const title = firstLine.replace(/^#\s+(?:Design System:\s*)?/, "").trim() || id;
          return { id, title, description: catalogDescription(content), content };
        })
        .sort((left, right) => left.id.localeCompare(right.id))
    );
  } catch {
    // bundled 目录不可读 → 空，vendored 仍可用。
  }
  const vendored: DesignSystemCatalogItem[] = [];
  try {
    for (const id of listVendoredDesignSystems()) {
      const file = join(vendorDirOf(), id, "DESIGN.md");
      const content = readFileSync(file, "utf8");
      vendored.push({
        id,
        title: `${vendoredTitle(content, id)} (${id})`,
        description: vendoredDescription(content),
        content,
      });
    }
  } catch {
    // 单个 vendored 文件损坏 → 跳过该条，不拖垮目录。
  }
  return [
    ...bundled,
    ...vendored,
    {
      id: PROJECT_DESIGN_SYSTEM_ID,
      title: "Project DESIGN.md",
      description:
        "Project DESIGN.md — workspace root (Google Stitch format) or .deeporca/DESIGN.md (design.extract replication output)",
      content: "",
    },
  ];
}

function safePackageTitle(title: string): string {
  return title.replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff]/g, "_").slice(0, 60) || "design";
}

/** Suite-version extras carried into an export package (spec §6.6): prototype
 *  suites add the verification.md acceptance report to .ddp; UI suites add
 *  tokens.json / components.json to .ddu. Everything is optional — absent or
 *  empty extras never block the export. */
export interface SuiteExportExtras {
  verification?: PackageVerification;
  tokens?: unknown;
  components?: unknown;
  /** WP4.1:prototype 套件的平台变体(mobile/tablet 源码)——随 .ddp 导出。 */
  variants?: { mobile?: string; tablet?: string };
}

/** Export targets are per-module deliverables: prototype → .ddp, UI design → .ddu.
 *  UI suite versions route by their content field (specs/leafer-ui-engine EARS 17):
 *  `leafer` exports the interactive leafer package, legacy `openui` the source
 *  package; .dd remains only on legacy artifacts (standalone compiled render). */
function buildPackage(
  artifact: { id: string; title: string },
  format: "ddp" | "ddu-dd" | "ddu-openui" | "ddu-leafer",
  content: string,
  extras?: SuiteExportExtras
): { data: Buffer; options: DesignPackageSaveOptions } {
  const isDesign = format !== "ddp";
  const exportedAt = new Date().toISOString();
  const data =
    format === "ddp"
      ? buildDdpPackage(artifact, content, exportedAt, extras?.verification, extras?.variants)
      : format === "ddu-dd"
        ? buildDduPackage(
            artifact,
            content,
            compileDdToHtml(parseDdFile(content), readTailwindScript() ?? undefined),
            exportedAt
          )
        : format === "ddu-leafer"
          ? (() => {
              const runtimes = resolveLeaferRuntimeBundle();
              if (!runtimes) {
                throw new Error(
                  "leafer runtime files not found — run `npm run desktop:build` so dist/leafer.web.min.js " +
                    "and dist/leafer-flow.web.min.js exist"
                );
              }
              return buildDduLeaferPackage(artifact, content, exportedAt, runtimes, extras);
            })()
          : buildDduOpenuiPackage(artifact, content, exportedAt, extras);
  const ext = isDesign ? "ddu" : "ddp";
  const label = isDesign ? "UI-Design" : "PM-Design";
  return {
    data,
    options: {
      title: `Export ${label} package (.${ext})`,
      defaultPath: `${safePackageTitle(artifact.title)}.${ext}`,
      filters: [{ name: `${label} Package (.${ext})`, extensions: [ext] }],
    },
  };
}

/** Suite → export projection. Formats are per-module deliverables:
 *  prototype suites export .ddp; UI-design suites export .ddu — the leafer
 *  interactive package for leafer versions, the OpenUI source package for
 *  legacy versions (field-level routing, EARS 17). */
function suiteProjection(
  kind: DesignSuiteKind,
  content: PrototypeSuiteContent | UiSuiteContent
): { format: "ddp" | "ddu-openui" | "ddu-leafer"; content: string } | null {
  if (kind === "prototype") {
    const openui = (content as PrototypeSuiteContent).openui;
    return typeof openui === "string" ? { format: "ddp", content: openui } : null;
  }
  const ui = content as UiSuiteContent;
  if (typeof ui.leafer === "string" && ui.leafer.trim()) return { format: "ddu-leafer", content: ui.leafer };
  if (typeof ui.openui === "string" && ui.openui.trim()) return { format: "ddu-openui", content: ui.openui };
  return null;
}

function registerChangeEvents(store: DesignStoreOps, emit: DesignIpcDeps["emit"]): void {
  const pendingLegacy = new Map<string, symbol>();
  store.onArtifactChange((root) => {
    const marker = Symbol(root);
    pendingLegacy.set(root, marker);
    queueMicrotask(() => {
      if (pendingLegacy.get(root) !== marker) return;
      pendingLegacy.delete(root);
      emit(IpcEvent.DesignChanged, { root } satisfies DesignChangedEvent);
    });
  });
  store.onSuiteChange((event) => {
    pendingLegacy.delete(event.root);
    emit(IpcEvent.DesignChanged, event);
  });
}

/** Register root-pinned legacy and design-suite IPC without importing Electron. */
export function registerDesignIpc(helpers: DesignIpcHelpers, deps: DesignIpcDeps): void {
  const { handle, handlePrivileged } = helpers;
  const store = deps.store ?? defaultStore;
  const pinned = (root?: string): string | null => deps.resolveRegisteredRoot(root);
  registerChangeEvents(store, deps.emit);

  handle(IpcRequest.DesignList, (root?: string) => {
    const resolved = pinned(root);
    return resolved ? store.listArtifacts(resolved) : [];
  });
  handle(IpcRequest.DesignRead, (id: string, root?: string) => {
    const resolved = pinned(root);
    return resolved ? store.readArtifact(resolved, id) : null;
  });
  handlePrivileged(IpcRequest.DesignDelete, (id: string, root?: string) => {
    const resolved = pinned(root);
    return resolved ? store.deleteArtifact(resolved, id) : false;
  });
  handlePrivileged(IpcRequest.DesignExportPackage, async (id: string, root?: string) => {
    const resolved = pinned(root);
    if (!resolved) return { ok: false, error: "unregistered workspace" };
    const artifact = store.readArtifact(resolved, id);
    if (!artifact) return { ok: false, error: "design artifact not found" };
    try {
      const pkg = buildPackage(artifact, artifact.pipeline === "design" ? "ddu-dd" : "ddp", artifact.content);
      return deps.savePackage(pkg.data, pkg.options);
    } catch (error) {
      return { ok: false, error: `package build failed: ${error instanceof Error ? error.message : String(error)}` };
    }
  });

  const latestArtifactId = (root: string, pipeline: DesignPipeline): string | null =>
    store.listArtifacts(root).find((artifact) => artifact.pipeline === pipeline)?.id ?? null;

  handlePrivileged(
    IpcRequest.DesignSaveFormState,
    (pipeline: DesignPipeline, state: Record<string, unknown>, root?: string) => {
      const resolved = pinned(root);
      if (!resolved) return false;
      const id = latestArtifactId(resolved, pipeline);
      return id ? store.saveFormState(resolved, id, state) : false;
    }
  );
  handle(IpcRequest.DesignReadFormState, (pipeline: DesignPipeline, root?: string) => {
    const resolved = pinned(root);
    if (!resolved) return null;
    const id = latestArtifactId(resolved, pipeline);
    const state = id ? store.readFormState(resolved, id) : null;
    return state && typeof state === "object" && !Array.isArray(state) ? (state as Record<string, unknown>) : null;
  });

  handle(IpcRequest.DesignSuiteList, (root: string, kind?: DesignSuiteKind) => {
    const resolved = pinned(root);
    return resolved ? store.listSuites(resolved, kind) : [];
  });
  handle(IpcRequest.DesignSuiteRead, (root: string, id: string) => {
    const resolved = pinned(root);
    return resolved ? store.readSuite(resolved, id) : null;
  });
  handle(IpcRequest.DesignSuiteReadVersion, (root: string, id: string, versionId: string) => {
    const resolved = pinned(root);
    return resolved ? store.readSuiteVersion(resolved, id, versionId) : null;
  });
  handlePrivileged(IpcRequest.DesignSuiteDelete, (root: string, id: string) => {
    const resolved = pinned(root);
    return resolved ? store.deleteSuite(resolved, id) : false;
  });
  /** Leafer canvas edit → new suite version (specs/leafer-ui-engine WP1.4).
   *  Main builds the next content from the head version itself — the renderer
   *  only supplies the serialized scene JSON — and head-moved is refused so a
   *  stale canvas can never silently fork the suite history. */
  const SUITE_LEAFER_MAX_CHARS = 512 * 1024;
  handlePrivileged(
    IpcRequest.DesignSuiteAppendLeafer,
    (root: string, id: string, versionId: string, leaferJson: string, note?: string) => {
      const resolved = pinned(root);
      if (!resolved) return { ok: false as const, error: "unregistered workspace" };
      if (typeof leaferJson !== "string" || !leaferJson.trim())
        return { ok: false as const, error: "leafer JSON is required" };
      if (leaferJson.length > SUITE_LEAFER_MAX_CHARS) {
        return { ok: false as const, error: `leafer JSON is too large (limit ${SUITE_LEAFER_MAX_CHARS} characters)` };
      }
      try {
        const parsed: unknown = JSON.parse(leaferJson);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
      } catch {
        return { ok: false as const, error: "leafer JSON is not a valid JSON document" };
      }
      const suite = store.readSuite(resolved, id);
      if (!suite || suite.kind !== "ui") return { ok: false as const, error: "design suite not found" };
      if (suite.currentVersionId !== versionId) {
        return {
          ok: false as const,
          error: "suite head has moved: reload the latest version before saving canvas edits",
        };
      }
      const version = store.readSuiteVersion(resolved, id, versionId);
      if (!version) return { ok: false as const, error: "design suite version not found" };
      const base = version.content as UiSuiteContent;
      // Zero-LLM auto-lint (WP5) — same contract as render_leafer: a landed
      // canvas version's lintFindings describe the tree being STORED, never
      // the previous one. Review state stays untouched (design.review owns
      // it); tokens ride along so unlisted-color arms exactly like design.lint.
      const lintFindings = lintLeaferDocument(leaferJson, base.tokens);
      const content: UiSuiteContent = {
        ...base,
        leafer: leaferJson,
        openui: undefined,
        quality: { ...base.quality, lintFindings, runtimeChecks: [] },
      };
      const updated = store.appendSuiteVersion(resolved, {
        suiteId: id,
        content,
        ...(note?.trim() ? { note: note.trim() } : {}),
      });
      if (!updated) return { ok: false as const, error: "could not append the canvas version" };
      return {
        ok: true as const,
        ref: { suiteId: updated.id, versionId: updated.currentVersionId, kind: "ui" as const },
      };
    }
  );
  // PRD 主题层（specs/prd-theme-layer）：主题 CRUD + 套件主题指派。全部
  // root-pinned；写通道走 privileged。主题/关系是套件元数据——不产生新版本。
  handle(IpcRequest.DesignThemeList, (root: string) => {
    const resolved = pinned(root);
    return resolved ? store.listThemes(resolved) : [];
  });
  handlePrivileged(IpcRequest.DesignThemeCreate, (root: string, input?: { title?: unknown; note?: unknown }) => {
    const resolved = pinned(root);
    if (!resolved) return { ok: false as const, error: "unregistered workspace" };
    // 交叉审查修复：渲染层载荷钳制（与 SUITE_LEAFER_MAX_CHARS 同思路）——
    // 半受信渲染层不得借主题通道写无界文本进 index.json。
    const title = typeof input?.title === "string" ? input.title : "";
    if (title.length > THEME_TITLE_MAX_CHARS) {
      return { ok: false as const, error: `theme title too long (limit ${THEME_TITLE_MAX_CHARS} characters)` };
    }
    const note = typeof input?.note === "string" ? input.note : "";
    if (note.length > THEME_NOTE_MAX_CHARS) {
      return { ok: false as const, error: `theme note too long (limit ${THEME_NOTE_MAX_CHARS} characters)` };
    }
    const theme = store.createTheme(resolved, {
      title,
      ...(note.trim() ? { note: note.slice(0, THEME_NOTE_MAX_CHARS) } : {}),
    });
    return theme ? { ok: true as const, theme } : { ok: false as const, error: "theme title is required" };
  });
  handlePrivileged(
    IpcRequest.DesignThemeUpdate,
    (root: string, id: string, input?: { title?: unknown; note?: unknown }) => {
      const resolved = pinned(root);
      if (!resolved) return { ok: false as const, error: "unregistered workspace" };
      const updateTitle = typeof input?.title === "string" ? input.title : undefined;
      if (updateTitle !== undefined && updateTitle.length > THEME_TITLE_MAX_CHARS) {
        return { ok: false as const, error: `theme title too long (limit ${THEME_TITLE_MAX_CHARS} characters)` };
      }
      const ok = store.updateTheme(resolved, id, {
        ...(updateTitle !== undefined ? { title: updateTitle } : {}),
        // note: null = 显式清除；undefined = 不动；字符串 = 替换。
        ...(input && "note" in input ? { note: input.note === null ? null : String(input.note ?? "") } : {}),
      });
      return ok ? { ok: true as const } : { ok: false as const, error: "theme not found" };
    }
  );
  handlePrivileged(IpcRequest.DesignThemeDelete, (root: string, id: string) => {
    const resolved = pinned(root);
    if (!resolved) return { ok: false as const, error: "unregistered workspace" };
    const ok = store.deleteTheme(resolved, id);
    return ok ? { ok: true as const } : { ok: false as const, error: "theme not found" };
  });
  handlePrivileged(
    IpcRequest.DesignSuiteAssignTheme,
    (root: string, suiteId: string, input?: Record<string, unknown>) => {
      const resolved = pinned(root);
      if (!resolved) return { ok: false as const, error: "unregistered workspace" };
      if (!input || typeof input !== "object") return { ok: false as const, error: "assignment payload is required" };
      const asRef = (value: unknown): AssignSuiteThemeInput["inherits"] => {
        if (value === null) return null;
        if (value && typeof value === "object" && typeof (value as { suiteId?: unknown }).suiteId === "string") {
          const ref: DesignThemeRef = { suiteId: String((value as { suiteId: string }).suiteId) };
          const versionId = (value as { versionId?: unknown }).versionId;
          if (typeof versionId === "string" && versionId.trim()) ref.versionId = versionId;
          return ref;
        }
        return undefined;
      };
      const rawReferences = input.references;
      // 交叉审查修复：references 条数/长度钳制（与 store 常量一致）。
      const references = Array.isArray(rawReferences)
        ? rawReferences
            .slice(0, THEME_REFERENCES_MAX_ENTRIES)
            .map((item) => asRef(item))
            .filter((item): item is DesignThemeRef => item !== undefined && item !== null)
            .filter((ref) => ref.suiteId.length <= 128 && (!ref.versionId || ref.versionId.length <= 128))
        : undefined;
      const patch: AssignSuiteThemeInput = {};
      if ("themeId" in input) {
        patch.themeId = input.themeId === null ? null : typeof input.themeId === "string" ? input.themeId : null;
      }
      if ("stage" in input) {
        patch.stage = input.stage === null ? null : typeof input.stage === "string" ? input.stage : null;
      }
      if ("inherits" in input) patch.inherits = asRef(input.inherits) ?? (input.inherits === null ? null : undefined);
      if ("references" in input) {
        patch.references = rawReferences === null ? null : (references ?? undefined);
      }
      const ok = store.assignSuiteTheme(resolved, suiteId, patch);
      return ok ? { ok: true as const } : { ok: false as const, error: "suite or theme not found" };
    }
  );
  handlePrivileged(IpcRequest.DesignSuiteExport, async (root: string, id: string, versionId?: string) => {
    const resolved = pinned(root);
    if (!resolved) return { ok: false, error: "unregistered workspace" };
    const suite = store.readSuite(resolved, id);
    if (!suite) return { ok: false, error: "design suite not found" };
    const version = versionId ? store.readSuiteVersion(resolved, id, versionId) : suite.currentVersion;
    if (!version) return { ok: false, error: "design suite version not found" };
    const projection = suiteProjection(suite.kind, version.content);
    if (!projection) return { ok: false, error: "design suite version has no exportable projection" };
    // §6.6 extras, per module: prototype suites ship the acceptance report
    // (.ddp + verification.md), UI suites ship the token/component contract
    // (.ddu + tokens.json/components.json). Optional — never fails the export.
    const prototypeContent = projection.format === "ddp" ? (version.content as PrototypeSuiteContent) : null;
    const extras: SuiteExportExtras =
      projection.format === "ddp"
        ? {
            verification: prototypeContent?.verification,
            variants: prototypeContent?.openuiVariants,
          }
        : {
            tokens: (version.content as UiSuiteContent).tokens,
            components: (version.content as UiSuiteContent).components,
          };
    try {
      const pkg = buildPackage(suite, projection.format, projection.content, extras);
      return deps.savePackage(pkg.data, pkg.options);
    } catch (error) {
      return { ok: false, error: `package build failed: ${error instanceof Error ? error.message : String(error)}` };
    }
  });
  handlePrivileged(
    IpcRequest.DesignSuiteSaveFormState,
    (root: string, id: string, state: Record<string, unknown>, slot?: string) => {
      const resolved = pinned(root);
      return resolved ? store.saveFormState(resolved, id, state, slot) : false;
    }
  );
  handle(IpcRequest.DesignSuiteReadFormState, (root: string, id: string, slot?: string) => {
    const resolved = pinned(root);
    if (!resolved) return null;
    const state = store.readFormState(resolved, id, slot);
    return state && typeof state === "object" && !Array.isArray(state) ? (state as Record<string, unknown>) : null;
  });
  handle(IpcRequest.DesignSystemCatalog, () => (deps.readCatalog ?? readDesignSystemCatalog)());

  // ── Spec → slides (specs/artifact-landing 链路 B) ────────────────────────
  /** Resolve the spec markdown of a suite version (current when versionId is
   *  omitted) — null when anything is missing or the spec is empty. */
  const suiteSpecSource = (root: string, id: string, versionId?: string) => {
    const suite = store.readSuite(root, id);
    if (!suite || suite.kind !== "prototype") return null;
    const version = versionId ? store.readSuiteVersion(root, id, versionId) : suite.currentVersion;
    if (!version) return null;
    const spec = (version.content as PrototypeSuiteContent).spec;
    return typeof spec === "string" && spec.trim() ? { spec, title: suite.title } : null;
  };

  /** Exports currently running (keyed root:suite — deliberately NOT version
   *  or kind: html/pdf both write the same per-suite slides.html, and the PDF
   *  reads it back) — double-clicks and duplicate invocations serialize
   *  instead of interleaving 'w'-truncate writes into a corrupted derivative. */
  const inFlightExports = new Set<string>();

  handle(
    IpcRequest.PrototypeSpecSlides,
    async (root: string, id: string, versionId?: string, appearance?: SpecSlidesAppearance) => {
      const resolved = pinned(root);
      const source = resolved ? suiteSpecSource(resolved, id, versionId) : null;
      if (!source) return { ok: false, error: "spec not found" };
      try {
        return { ok: true, ...(await renderSpecSlides(source.spec, { title: source.title, appearance })) };
      } catch (error) {
        return { ok: false, error: `slide render failed: ${error instanceof Error ? error.message : String(error)}` };
      }
    }
  );

  handlePrivileged(
    IpcRequest.PrototypeSpecExportSlides,
    async (
      root: string,
      id: string,
      kind: "html" | "pdf",
      versionId?: string,
      appearance?: SpecSlidesAppearance
    ): Promise<{ ok: boolean; path?: string; blockedRemote?: number; error?: string }> => {
      const resolved = pinned(root);
      if (!resolved) return { ok: false, error: "unregistered workspace" };
      const source = suiteSpecSource(resolved, id, versionId);
      if (!source) return { ok: false, error: "spec not found" };
      const dir = designSuiteDir(resolved, id);
      if (!dir) return { ok: false, error: "unsafe suite id" };
      if (kind === "pdf" && !deps.renderPdf) return { ok: false, error: "pdf renderer unavailable" };
      // Serialize per suite: html and pdf both write slides.html (the PDF
      // reads it back), and different versions of one suite share the same
      // derivative path — per-version keys would let two runs interleave
      // their 'w'-truncate writes into a corrupted derivative.
      const exportKey = `${resolved}:${id}`;
      if (inFlightExports.has(exportKey)) return { ok: false, error: "slide export already in progress" };
      inFlightExports.add(exportKey);
      try {
        const rendered = await renderSpecSlides(source.spec, { title: source.title, appearance });
        // The HTML derivative is always written (it is the PDF's source too);
        // the versioned content model is never touched (B11).
        const htmlPath = join(dir, "slides.html");
        await writeFile(htmlPath, buildSlidesHtml(rendered.html, rendered.css, source.title), "utf-8");
        if (kind === "pdf") {
          const bytes = await deps.renderPdf!(htmlPath);
          const pdfPath = join(dir, "slides.pdf");
          await writeFile(pdfPath, bytes);
          return { ok: true, path: pdfPath, blockedRemote: rendered.remoteImages };
        }
        return { ok: true, path: htmlPath, blockedRemote: rendered.remoteImages };
      } catch (error) {
        return { ok: false, error: `slide export failed: ${error instanceof Error ? error.message : String(error)}` };
      } finally {
        inFlightExports.delete(exportKey);
      }
    }
  );

  // Implementation brief (specs/artifact-landing 链路 C): deterministic
  // template engine over the suite's spec — gaps block generation (C14) and
  // the derivative brief.md never touches the versioned content model.
  handlePrivileged(
    IpcRequest.PrototypeBuildBrief,
    async (root: string, id: string, versionId?: string, locale?: string) => {
      const resolved = pinned(root);
      if (!resolved) return { ok: false, error: "unregistered workspace" };
      const source = suiteSpecSource(resolved, id, versionId);
      if (!source) return { ok: false, error: "spec not found" };
      const dir = designSuiteDir(resolved, id);
      if (!dir) return { ok: false, error: "unsafe suite id" };
      try {
        const brief = buildImplementationBrief({
          kind: "spec",
          specMd: source.spec,
          title: source.title,
          locale: locale ?? "zh",
        });
        if (!brief.ok) return { ok: false, gaps: brief.gaps ?? [], error: "brief has unresolved gaps" };
        const briefPath = join(dir, "brief.md");
        await writeFile(briefPath, brief.briefMd ?? "", "utf-8");
        return { ok: true, briefMd: brief.briefMd, path: briefPath };
      } catch (error) {
        return { ok: false, error: `brief build failed: ${error instanceof Error ? error.message : String(error)}` };
      }
    }
  );
}
