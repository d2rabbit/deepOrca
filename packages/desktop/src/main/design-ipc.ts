import { readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, parse } from "node:path";
import { fileURLToPath } from "node:url";

import { getExtensionRoot } from "@deeporca/core";

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
  DesignSuiteKind,
  DesignSuiteSummary,
  DesignSuiteVersion,
  DesignSystemCatalogItem,
  PrototypeSuiteContent,
  UiSuiteContent,
} from "../shared/ipc.js";
import { buildDdpPackage, buildDduOpenuiPackage, buildDduPackage } from "./tools/dd-package.js";
import {
  deleteDesignArtifact,
  deleteDesignSuite,
  listDesignArtifacts,
  listDesignSuites,
  onDesignStoreChange,
  onDesignSuiteChange,
  readDesignArtifact,
  readDesignSuite,
  readDesignSuiteVersion,
  readFormState,
  saveFormState,
} from "./tools/design-store.js";

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
  saveFormState(root: string, id: string, state: unknown): boolean;
  readFormState(root: string, id: string): unknown | null;
  onArtifactChange(cb: (root: string) => void): () => void;
  onSuiteChange(cb: (event: DesignSuiteChangeEvent) => void): () => void;
}

export interface DesignIpcDeps {
  resolveRegisteredRoot(root?: string): string | null;
  emit(channel: string, payload: unknown): void;
  savePackage(data: Buffer, options: DesignPackageSaveOptions): Promise<{ ok: boolean; path?: string; error?: string }>;
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
  saveFormState,
  readFormState,
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

/** Read the bundled design-system templates through core's stable extension root. */
export function readDesignSystemCatalog(extensionRoot: string = getExtensionRoot()): DesignSystemCatalogItem[] {
  const systemsDir = join(extensionRoot, "templates", "design", "systems");
  try {
    return readdirSync(systemsDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && extname(entry.name) === ".md")
      .map((entry) => {
        const id = parse(entry.name).name;
        const content = readFileSync(join(systemsDir, entry.name), "utf8");
        const firstLine = content.split(/\r?\n/, 1)[0] ?? "";
        const title = firstLine.replace(/^#\s+(?:Design System:\s*)?/, "").trim() || id;
        return { id, title, description: catalogDescription(content), content };
      })
      .sort((left, right) => left.id.localeCompare(right.id));
  } catch {
    return [];
  }
}

function safePackageTitle(title: string): string {
  return title.replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff]/g, "_").slice(0, 60) || "design";
}

/** Export targets are per-module deliverables: prototype → .ddp, UI design → .ddu.
 *  Suite UI content is OpenUI Lang (the generation stack); .dd remains only on
 *  legacy artifacts, which keep the standalone compiled .ddu render. */
function buildPackage(
  artifact: { id: string; title: string },
  format: "ddp" | "ddu-dd" | "ddu-openui",
  content: string
): { data: Buffer; options: DesignPackageSaveOptions } {
  const isDesign = format !== "ddp";
  const exportedAt = new Date().toISOString();
  const data =
    format === "ddp"
      ? buildDdpPackage(artifact, content, exportedAt)
      : format === "ddu-dd"
        ? buildDduPackage(
            artifact,
            content,
            compileDdToHtml(parseDdFile(content), readTailwindScript() ?? undefined),
            exportedAt
          )
        : buildDduOpenuiPackage(artifact, content, exportedAt);
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
 *  prototype suites export .ddp, UI-design suites export .ddu — both carry
 *  the OpenUI Lang source produced by the generation stack. */
function suiteProjection(
  kind: DesignSuiteKind,
  content: PrototypeSuiteContent | UiSuiteContent
): { format: "ddp" | "ddu-openui"; content: string } | null {
  const openui = kind === "prototype" ? (content as PrototypeSuiteContent).openui : (content as UiSuiteContent).openui;
  if (typeof openui !== "string") return null;
  return { format: kind === "prototype" ? "ddp" : "ddu-openui", content: openui };
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
  handlePrivileged(IpcRequest.DesignSuiteExport, async (root: string, id: string, versionId?: string) => {
    const resolved = pinned(root);
    if (!resolved) return { ok: false, error: "unregistered workspace" };
    const suite = store.readSuite(resolved, id);
    if (!suite) return { ok: false, error: "design suite not found" };
    const version = versionId ? store.readSuiteVersion(resolved, id, versionId) : suite.currentVersion;
    if (!version) return { ok: false, error: "design suite version not found" };
    const projection = suiteProjection(suite.kind, version.content);
    if (!projection) return { ok: false, error: "design suite version has no exportable projection" };
    try {
      const pkg = buildPackage(suite, projection.format, projection.content);
      return deps.savePackage(pkg.data, pkg.options);
    } catch (error) {
      return { ok: false, error: `package build failed: ${error instanceof Error ? error.message : String(error)}` };
    }
  });
  handlePrivileged(IpcRequest.DesignSuiteSaveFormState, (root: string, id: string, state: Record<string, unknown>) => {
    const resolved = pinned(root);
    return resolved ? store.saveFormState(resolved, id, state) : false;
  });
  handle(IpcRequest.DesignSuiteReadFormState, (root: string, id: string) => {
    const resolved = pinned(root);
    if (!resolved) return null;
    const state = store.readFormState(resolved, id);
    return state && typeof state === "object" && !Array.isArray(state) ? (state as Record<string, unknown>) : null;
  });
  handle(IpcRequest.DesignSystemCatalog, () => (deps.readCatalog ?? readDesignSystemCatalog)());
}
