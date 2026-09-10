/**
 * design-store — unified persistence for Designer module artifacts.
 *
 * Serves both Designer pipelines:
 *   - PM-Design (OpenUI prototypes, pipeline="openui" → .txt)
 *   - UI-Design (.dd design documents, pipeline="design" → .dd)
 *
 * Layout (per specs/pm-design-v2 §8, simplified):
 *   <root>/.deeporca/designs/
 *   ├── index.json                     # artifact index
 *   └── <uuid>/
 *       ├── meta.json                  # {id, title, pipeline, createdAt, updatedAt}
 *       └── prototype.openui.txt | prototype.dd
 *
 * All operations are best-effort — failures are swallowed to never
 * block the tool pipeline (matching persistSurfaces' error model).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

export type DesignPipeline = "openui" | "design" | "spec";

/** Prior content snapshot, taken automatically when a save changes the content. */
export interface DesignArtifactVersion {
  savedAt: string;
  content: string;
}

export interface DesignArtifactMeta {
  id: string;
  title: string;
  pipeline: DesignPipeline;
  createdAt: string;
  updatedAt: string;
  /** Prior-content snapshots (Implementation detail of save; capped, FIFO). */
  versions?: DesignArtifactVersion[];
}

export interface DesignArtifact extends DesignArtifactMeta {
  content: string;
  /** Original requirement text, when the artifact was created via materialize. */
  requirement?: string;
}

export type DesignSuiteKind = "prototype" | "ui";
export type DesignSuiteStatus = "draft" | "ready" | "verified";
export type DesignCheckStatus = "pending" | "passed" | "failed" | "healed";

export interface DesignArtifactRef {
  suiteId: string;
  versionId: string;
  kind: DesignSuiteKind;
}

export interface PrototypeVerificationCheck {
  id: string;
  label: string;
  status: DesignCheckStatus;
  action?: string;
  observation?: string;
}

export interface PrototypeVerificationResult {
  status: "pending" | "passed" | "failed";
  checks: PrototypeVerificationCheck[];
  generatedAt?: string;
  healingRounds?: number;
}

export interface DesignLintFinding {
  id: string;
  preset: string;
  ruleId: string;
  severity: "info" | "warning" | "error";
  nodePath: string;
  message: string;
  suggestion?: string;
}

export interface DesignRuntimeCheck {
  id: string;
  label: string;
  status: "pending" | "passed" | "failed";
  value?: unknown;
}

export interface DesignQualityReview {
  status: "pending" | "passed" | "failed";
  composite: number;
  rounds: number;
  evidence: Record<string, unknown>;
}

export interface DesignQualityResult {
  lintFindings: DesignLintFinding[];
  runtimeChecks: DesignRuntimeCheck[];
  review?: DesignQualityReview;
}

export interface PrototypeSuiteContent {
  requirement?: string;
  spec?: string;
  openui?: string;
  /** 平台变体(user ask 2026-09-09):mobile/tablet 的结构性独立程序;desktop
   *  即 openui 本体。与 core 的 PrototypeSuiteContent 镜像(评审 F11 已知)。 */
  openuiVariants?: Partial<Record<"desktop" | "mobile" | "tablet", string>>;
  verification?: PrototypeVerificationResult;
  /** Technical architecture document (user ask 2026-09-08 技术架构模块). */
  arch?: string;
  /** specs/prompt-doc-chain: pd-design.md——PRD 蒸馏的原型提示词文档（原型
   *  生成的主驱动；render_spec 重写 PRD 时失效）。 */
  pdDesign?: string;
}

export interface UiSuiteContent {
  requirement?: string;
  openui?: string;
  /** specs/leafer-ui-engine: UI-Design 新栈产物（Leafer JSON 场景树字符串）。
   *  字段级双栈路由：有 leafer → Leafer 栈；仅 openui → 旧栈只读；同一
   *  suite 版本不混写两种字段。与 core 的 UiSuiteContent 镜像（已知）。 */
  leafer?: string;
  /** specs/prompt-doc-chain: ui-design.md——原型转 UI 的视觉强化提示词
   *  （pd-design 的视觉翻译），随 design.materialize 落盘。 */
  uiDesign?: string;
  tokens?: unknown;
  components?: unknown;
  quality?: DesignQualityResult;
  sourcePrototype?: Pick<DesignArtifactRef, "suiteId" | "versionId">;
  designSystemId?: string;
}

export type DesignSuiteContent = PrototypeSuiteContent | UiSuiteContent;

export interface DesignSuiteVersionSummary {
  versionId: string;
  savedAt: string;
  note?: string;
  status: DesignSuiteStatus;
}

export interface DesignSuiteVersion extends DesignSuiteVersionSummary {
  content: DesignSuiteContent;
}

/** Which component library authored a suite's code. Stamped at creation
 *  ("official" for every post-switch a2ui creation); absent on pre-field
 *  suites and legacy artifacts — the renderer then falls back to the
 *  component-name heuristic, which misroutes shared-name-only suites. */
export type DesignAuthoringLibrary = "official" | "legacy";

export interface DesignSuiteMeta {
  schemaVersion: 2;
  id: string;
  title: string;
  kind: DesignSuiteKind;
  status: DesignSuiteStatus;
  createdAt: string;
  updatedAt: string;
  currentVersionId: string;
  versions: DesignSuiteVersionSummary[];
  authoringLibrary?: DesignAuthoringLibrary;
  /** specs/prd-theme-layer: PRD 主题归属与关系——套件元数据，不进版本内容
   *  （调整不追加版本）。主题实体本身存 index.json 的 themes 数组。 */
  themeId?: string;
  stage?: string;
  inherits?: DesignThemeRef;
  references?: DesignThemeRef[];
}

/** PRD 主题关系引用：指向另一套件（PRD），versionId 省略 = 跟随其 head。 */
export interface DesignThemeRef {
  suiteId: string;
  versionId?: string;
}

/** PRD 主题（分组维度，纯展示）——持久化于 index.json 的 themes 数组。 */
export interface DesignTheme {
  id: string;
  title: string;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DesignSuiteSummary {
  schemaVersion: 2;
  id: string;
  title: string;
  kind: DesignSuiteKind;
  status: DesignSuiteStatus;
  createdAt: string;
  updatedAt: string;
  currentVersionId: string;
  versionCount: number;
  /** True for a virtual view over one unmigrated legacy artifact. */
  partial?: boolean;
  sourcePipeline?: DesignPipeline;
  themeId?: string;
  stage?: string;
  inherits?: DesignThemeRef;
  references?: DesignThemeRef[];
}

export interface DesignSuite extends Omit<DesignSuiteMeta, "versions"> {
  versions: DesignSuiteVersion[];
  currentVersion: DesignSuiteVersion;
  currentContent: DesignSuiteContent;
  /** True for a virtual view over one unmigrated legacy artifact. */
  partial?: boolean;
  sourcePipeline?: DesignPipeline;
}

export type CreateDesignSuiteInput =
  | {
      title: string;
      kind: "prototype";
      content: PrototypeSuiteContent;
      note?: string;
      status?: DesignSuiteStatus;
      authoringLibrary?: DesignAuthoringLibrary;
      themeId?: string;
      stage?: string;
      inherits?: DesignThemeRef;
      references?: DesignThemeRef[];
    }
  | {
      title: string;
      kind: "ui";
      content: UiSuiteContent;
      note?: string;
      status?: DesignSuiteStatus;
      authoringLibrary?: DesignAuthoringLibrary;
      themeId?: string;
      stage?: string;
      inherits?: DesignThemeRef;
      references?: DesignThemeRef[];
    };

export interface AppendDesignSuiteVersionInput {
  suiteId: string;
  content: DesignSuiteContent;
  note?: string;
  status?: DesignSuiteStatus;
}

/** specs/prd-theme-layer: 套件的主题归属/阶段/关系指派。undefined = 保持现状，
 *  null = 清除，数组 = 整体替换。 */
export interface AssignSuiteThemeInput {
  themeId?: string | null;
  stage?: string | null;
  inherits?: DesignThemeRef | null;
  references?: DesignThemeRef[] | null;
}

interface DesignIndex {
  version: 1;
  artifacts: DesignArtifactMeta[];
  suites?: DesignSuiteSummary[];
  themes?: DesignTheme[];
}

const INDEX_VERSION = 1;
const MAX_VERSIONS = 20;
const FILE_BY_PIPELINE: Record<DesignPipeline, string> = {
  openui: "prototype.openui.txt",
  design: "prototype.dd",
  spec: "spec.md",
};

// ── Change notification ──────────────────────────────────────────────────────
// Design artifacts are written by the a2ui MCP tools mid-agent-run, not by
// the panels — a save/delete event lets the panels refresh live instead of
// showing a stale list until the next manual reload (chain-integrity fix).

type DesignStoreListener = (root: string) => void;
const listeners = new Set<DesignStoreListener>();

export interface DesignSuiteChangeEvent {
  root: string;
  suiteId: string;
  versionId?: string;
  change: "create" | "update" | "delete" | "theme";
}

type DesignSuiteChangeListener = (event: DesignSuiteChangeEvent) => void;
const suiteListeners = new Set<DesignSuiteChangeListener>();

/** Subscribe to artifact saves/deletes; returns an unsubscribe function. */
export function onDesignStoreChange(cb: DesignStoreListener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Subscribe to structured suite changes; returns an unsubscribe function. */
export function onDesignSuiteChange(cb: DesignSuiteChangeListener): () => void {
  suiteListeners.add(cb);
  return () => suiteListeners.delete(cb);
}

function notifyChange(root: string): void {
  for (const cb of listeners) {
    try {
      cb(root);
    } catch {
      // A broken listener must never break the store.
    }
  }
}

function notifySuiteChange(event: DesignSuiteChangeEvent): void {
  notifyChange(event.root);
  for (const cb of suiteListeners) {
    try {
      cb(event);
    } catch {
      // A broken listener must never break the store.
    }
  }
}

function getDesignsDir(root: string): string {
  return path.join(root, ".deeporca", "designs");
}

function getIndex(root: string): DesignIndex {
  try {
    const raw = fs.readFileSync(path.join(getDesignsDir(root), "index.json"), "utf8");
    const parsed = JSON.parse(raw) as DesignIndex;
    if (parsed && Array.isArray(parsed.artifacts)) return parsed;
  } catch {
    // Missing or corrupt — fresh index.
  }
  return { version: INDEX_VERSION, artifacts: [] };
}

function writeIndex(root: string, index: DesignIndex): void {
  // Atomic write (review fix): a torn bare writeFileSync here silently reset
  // the legacy artifact index on the next persist — same temp+rename
  // discipline as the suite index path.
  writeJsonAtomic(path.join(getDesignsDir(root), "index.json"), index);
}

/** Full meta (incl. versions) from the artifact directory; null when absent. */
function readMetaFile(root: string, id: string): DesignArtifactMeta | null {
  const dir = resolveArtifactDir(root, id);
  if (!dir) return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf8")) as DesignArtifactMeta;
  } catch {
    return null;
  }
}

/**
 * True when the id resolves to a meta.json that has been reshaped into the v2
 * suite model (schemaVersion 2 / no `pipeline` field): the legacy artifact
 * file map no longer applies, and a legacy lineage update must NOT touch it
 * (it used to throw deep inside path.join and silently drop the revision).
 */
export function isSuiteNormalizedArtifact(root: string, id: string): boolean {
  const dir = resolveArtifactDir(root, id);
  if (!dir) return false;
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf8")) as {
      pipeline?: DesignPipeline;
      schemaVersion?: unknown;
    };
    return meta.pipeline === undefined || meta.schemaVersion === 2;
  } catch {
    return false;
  }
}

/** Save (create or update) a design artifact. Returns the artifact meta.
 *
 * When the content of an existing artifact changes, the previous content is
 * snapshotted into `versions[]` (capped at MAX_VERSIONS, oldest dropped) —
 * callers never manage versions explicitly. `requirement` (when provided)
 * is persisted as requirement.md; on updates an omitted requirement keeps
 * the existing file.
 */
export function saveDesignArtifact(
  root: string,
  input: {
    id?: string;
    title: string;
    pipeline: DesignPipeline;
    content: string;
    requirement?: string;
  }
): DesignArtifactMeta | null {
  try {
    // SECURITY (scan fix): apply the same id guard the read/delete paths use —
    // a caller-supplied id that cannot be a safe directory name fails the save
    // instead of ever reaching path.join below.
    if (input.id !== undefined && !isSafeDesignId(input.id)) {
      return null;
    }
    const index = getIndex(root);
    const now = new Date().toISOString();
    const existing = input.id ? (readMetaFile(root, input.id) ?? undefined) : undefined;
    // A suite-shaped meta (v2 normalization) has no `pipeline` — the legacy
    // file map does not apply. Fail explicitly here instead of throwing
    // inside path.join below; callers surface the reason to the tool layer.
    if (existing && (existing as { pipeline?: DesignPipeline }).pipeline === undefined) {
      return null;
    }

    // Snapshot the outgoing content before it is replaced.
    let versions = existing?.versions ?? [];
    if (existing) {
      // containment check (security scan): existing.id is read back from disk
      // (meta.json) — resolve it through the guarded path before reading the
      // previous content file.
      const snapshotDir = resolveArtifactDir(root, existing.id);
      if (!snapshotDir) {
        return null;
      }
      const contentPath = path.join(snapshotDir, FILE_BY_PIPELINE[existing.pipeline]);
      // containment check (security scan): the snapshot file must stay inside
      // the guarded artifact directory after the join.
      const relToArtifactDir = path.relative(snapshotDir, contentPath);
      if (relToArtifactDir === "" || relToArtifactDir.startsWith("..") || path.isAbsolute(relToArtifactDir)) {
        return null;
      }
      try {
        const previousContent = fs.readFileSync(contentPath, "utf8");
        if (previousContent !== input.content) {
          versions = [...versions, { savedAt: existing.updatedAt, content: previousContent }].slice(-MAX_VERSIONS);
        }
      } catch {
        // No previous content file (e.g. corrupted dir) — nothing to snapshot.
      }
    }

    const meta: DesignArtifactMeta = {
      id: existing?.id ?? input.id ?? randomUUID(),
      title: input.title || existing?.title || "Untitled",
      pipeline: input.pipeline,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      ...(versions.length > 0 ? { versions } : {}),
    };

    // containment check (security scan): the write target directory must
    // resolve through the guarded id → dir mapping before any file is written.
    const artifactDirPath = resolveArtifactDir(root, meta.id);
    if (!artifactDirPath) {
      return null;
    }
    fs.mkdirSync(artifactDirPath, { recursive: true });
    fs.writeFileSync(path.join(artifactDirPath, FILE_BY_PIPELINE[meta.pipeline]), input.content, "utf8");
    fs.writeFileSync(path.join(artifactDirPath, "meta.json"), JSON.stringify(meta, null, 2), "utf8");
    if (input.requirement !== undefined && input.requirement !== "") {
      fs.writeFileSync(path.join(artifactDirPath, "requirement.md"), input.requirement, "utf8");
    }

    // Update index (replace or append; index stays light — no versions).
    const lightMeta: DesignArtifactMeta = { ...meta };
    delete lightMeta.versions;
    const idx = index.artifacts.findIndex((a) => a.id === meta.id);
    if (idx >= 0) {
      index.artifacts[idx] = lightMeta;
    } else {
      index.artifacts.push(lightMeta);
    }
    writeIndex(root, index);
    notifyChange(root);
    return meta;
  } catch {
    return null; // best-effort
  }
}

/** List all design artifacts (newest first). */
export function listDesignArtifacts(root: string): DesignArtifactMeta[] {
  try {
    const index = getIndex(root);
    return [...index.artifacts].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch {
    return [];
  }
}

/** Read a single artifact's full content (incl. requirement and versions). */
export function readDesignArtifact(root: string, id: string): DesignArtifact | null {
  const dir = resolveArtifactDir(root, id);
  if (!dir) return null;
  try {
    const meta = readMetaFile(root, id);
    if (!meta) return null;
    const content = fs.readFileSync(path.join(dir, FILE_BY_PIPELINE[meta.pipeline]), "utf8");
    let requirement: string | undefined;
    try {
      requirement = fs.readFileSync(path.join(dir, "requirement.md"), "utf8");
    } catch {
      // No requirement recorded.
    }
    return { ...meta, content, ...(requirement !== undefined ? { requirement } : {}) };
  } catch {
    return null;
  }
}

/**
 * SECURITY: artifact ids reach path.join from the renderer. Only a plain
 * UUID-ish token may become a directory name — traversal/absolute/separator
 * ids would let a compromised renderer read or (worse) recursively DELETE
 * outside `.deeporca/designs` (defense in depth on top of the sender policy).
 */
export function isSafeDesignId(id: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id) && !id.includes("..");
}

/** Resolve an artifact id to its directory, or null when the id is unsafe. */
function resolveArtifactDir(root: string, id: string): string | null {
  if (!isSafeDesignId(id)) return null;
  const resolved = path.resolve(getDesignsDir(root), id);
  const base = path.resolve(getDesignsDir(root));
  return resolved === path.join(base, id) ? resolved : null;
}

/** Suite directory on disk (containment-checked) — home of derivative files
 *  such as slides.html / slides.pdf (specs/artifact-landing 链路 B). Null
 *  when the id is unsafe. */
export function designSuiteDir(root: string, id: string): string | null {
  return resolveArtifactDir(root, id);
}

function resolveContainedFile(dir: string, ...segments: string[]): string | null {
  const base = path.resolve(dir);
  const resolved = path.resolve(base, ...segments);
  const relative = path.relative(base, resolved);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative) ? resolved : null;
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), "utf8");
    fs.renameSync(tempPath, filePath);
  } finally {
    try {
      fs.rmSync(tempPath, { force: true });
    } catch {
      // The rename already removed the temp file in the success case.
    }
  }
}

function isDesignSuiteStatus(value: unknown): value is DesignSuiteStatus {
  return value === "draft" || value === "ready" || value === "verified";
}

function isDesignSuiteVersionSummary(value: unknown): value is DesignSuiteVersionSummary {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DesignSuiteVersionSummary>;
  return (
    typeof candidate.versionId === "string" &&
    isSafeDesignId(candidate.versionId) &&
    typeof candidate.savedAt === "string" &&
    isDesignSuiteStatus(candidate.status) &&
    (candidate.note === undefined || typeof candidate.note === "string")
  );
}

function isDesignSuiteMeta(value: unknown): value is DesignSuiteMeta {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DesignSuiteMeta>;
  return (
    candidate.schemaVersion === 2 &&
    typeof candidate.id === "string" &&
    isSafeDesignId(candidate.id) &&
    typeof candidate.title === "string" &&
    (candidate.kind === "prototype" || candidate.kind === "ui") &&
    isDesignSuiteStatus(candidate.status) &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.updatedAt === "string" &&
    typeof candidate.currentVersionId === "string" &&
    isSafeDesignId(candidate.currentVersionId) &&
    Array.isArray(candidate.versions) &&
    candidate.versions.length > 0 &&
    candidate.versions.every(isDesignSuiteVersionSummary)
  );
}

function readRawSuiteMeta(root: string, id: string): unknown {
  const dir = resolveArtifactDir(root, id);
  const metaPath = dir ? resolveContainedFile(dir, "meta.json") : null;
  if (!metaPath) return null;
  try {
    return JSON.parse(fs.readFileSync(metaPath, "utf8")) as unknown;
  } catch {
    return null;
  }
}

function readSuiteMeta(root: string, id: string): DesignSuiteMeta | null {
  const parsed = readRawSuiteMeta(root, id);
  return isDesignSuiteMeta(parsed) && parsed.id === id ? parsed : null;
}

/** Light kind probe — meta.json only, no version-file reads (re-review L6:
 *  deriving an append's kind used to load every version of the suite).
 *  Legacy (pre-v2) artifact metas carry a `pipeline` instead of v2's
 *  `schemaVersion`/`kind`; fall back to the pipeline-derived kind so appends
 *  against a legacy artifact keep the pre-probe behavior (a v2-only probe
 *  returned null and callers defaulted to "prototype", rejecting legacy
 *  "design" artifacts with a kind mismatch). */
export function readDesignSuiteKind(root: string, id: string): DesignSuiteKind | null {
  const parsed = readRawSuiteMeta(root, id);
  if (!parsed || typeof parsed !== "object") return null;
  if (isDesignSuiteMeta(parsed) && parsed.id === id) return parsed.kind;
  const candidate = parsed as { id?: unknown; pipeline?: unknown };
  if (
    candidate.id === id &&
    (candidate.pipeline === "openui" || candidate.pipeline === "design" || candidate.pipeline === "spec")
  ) {
    return legacyKind(candidate.pipeline);
  }
  return null;
}

function readSuiteVersionFile(root: string, suiteId: string, versionId: string): DesignSuiteVersion | null {
  if (!isSafeDesignId(versionId)) return null;
  const dir = resolveArtifactDir(root, suiteId);
  const versionPath = dir ? resolveContainedFile(dir, "versions", `${versionId}.json`) : null;
  if (!versionPath) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(versionPath, "utf8")) as Partial<DesignSuiteVersion>;
    if (
      parsed.versionId !== versionId ||
      typeof parsed.savedAt !== "string" ||
      !isDesignSuiteStatus(parsed.status) ||
      (parsed.note !== undefined && typeof parsed.note !== "string") ||
      !parsed.content ||
      typeof parsed.content !== "object" ||
      Array.isArray(parsed.content)
    ) {
      return null;
    }
    return parsed as DesignSuiteVersion;
  } catch {
    return null;
  }
}

function summaryFromMeta(meta: DesignSuiteMeta): DesignSuiteSummary {
  return {
    schemaVersion: 2,
    id: meta.id,
    title: meta.title,
    kind: meta.kind,
    status: meta.status,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    currentVersionId: meta.currentVersionId,
    versionCount: meta.versions.length,
    // 主题字段（specs/prd-theme-layer）：undefined 在 JSON 序列化时自然消隐。
    ...(meta.themeId !== undefined ? { themeId: meta.themeId } : {}),
    ...(meta.stage !== undefined ? { stage: meta.stage } : {}),
    ...(meta.inherits !== undefined ? { inherits: meta.inherits } : {}),
    ...(meta.references !== undefined ? { references: meta.references } : {}),
  };
}

function writeSuiteIndex(root: string, meta: DesignSuiteMeta): void {
  const index = getIndex(root);
  const summary = summaryFromMeta(meta);
  const suites = (index.suites ?? []).filter((suite) => suite.id !== meta.id);
  suites.unshift(summary);
  writeJsonAtomic(path.join(getDesignsDir(root), "index.json"), {
    ...index,
    artifacts: index.artifacts.filter((artifact) => artifact.id !== meta.id),
    suites,
  });
}

function writeProjectionFile(dir: string, name: string, content: string | undefined): void {
  const filePath = resolveContainedFile(dir, name);
  if (!filePath) throw new Error("Unsafe projection path");
  if (content === undefined) {
    fs.rmSync(filePath, { force: true });
  } else {
    fs.writeFileSync(filePath, content, "utf8");
  }
}

function writeJsonProjection(dir: string, name: string, content: unknown): void {
  const filePath = resolveContainedFile(dir, name);
  if (!filePath) throw new Error("Unsafe projection path");
  if (content === undefined) fs.rmSync(filePath, { force: true });
  else writeJsonAtomic(filePath, content);
}

function syncSuiteProjections(dir: string, kind: DesignSuiteKind, content: DesignSuiteContent): void {
  if (kind === "prototype") {
    const prototype = content as PrototypeSuiteContent;
    writeProjectionFile(dir, "requirement.md", prototype.requirement);
    writeProjectionFile(dir, "spec.md", prototype.spec);
    // specs/prompt-doc-chain: pd-design.md 提示词文档投影。
    writeProjectionFile(dir, "pd-design.md", prototype.pdDesign);
    writeProjectionFile(dir, "prototype.openui.txt", prototype.openui);
    // WP4.1:平台变体投影——desktop 即本体文件,变体单独成文件,任何按文件
    // 消费的下游(简报/外部工具)都能拿到每端程序。
    writeProjectionFile(dir, "prototype.openui.mobile.txt", prototype.openuiVariants?.mobile);
    writeProjectionFile(dir, "prototype.openui.tablet.txt", prototype.openuiVariants?.tablet);
    writeProjectionFile(dir, "prototype.dd", undefined);
    writeJsonProjection(dir, "design.leafer.json", undefined);
    writeJsonProjection(dir, "tokens.json", undefined);
    writeJsonProjection(dir, "components.json", undefined);
    writeJsonProjection(dir, "quality.json", undefined);
    return;
  }

  const ui = content as UiSuiteContent;
  writeProjectionFile(dir, "requirement.md", ui.requirement);
  writeProjectionFile(dir, "prototype.dd", undefined);
  writeProjectionFile(dir, "spec.md", undefined);
  // Leafer 栈投影(specs/leafer-ui-engine WP1):content.leafer 是 JSON 字符串,
  // 解析后美化落盘;损坏内容按缺失处理(投影是只读衍生物,不阻塞持久化)。
  let leaferProjection: unknown;
  try {
    leaferProjection = ui.leafer === undefined ? undefined : JSON.parse(ui.leafer);
  } catch {
    leaferProjection = undefined;
  }
  writeJsonProjection(dir, "design.leafer.json", leaferProjection);
  writeProjectionFile(dir, "prototype.openui.txt", ui.openui);
  // specs/prompt-doc-chain: ui-design.md 强化提示词投影。
  writeProjectionFile(dir, "ui-design.md", ui.uiDesign);
  writeJsonProjection(dir, "tokens.json", ui.tokens);
  writeJsonProjection(dir, "components.json", ui.components);
  writeJsonProjection(dir, "quality.json", ui.quality);
}

function legacyKind(pipeline: DesignPipeline): DesignSuiteKind {
  return pipeline === "design" ? "ui" : "prototype";
}

function legacyContent(artifact: DesignArtifact): DesignSuiteContent {
  if (artifact.pipeline === "design") {
    return {
      ...(artifact.requirement !== undefined ? { requirement: artifact.requirement } : {}),
      openui: artifact.content,
    } satisfies UiSuiteContent;
  }
  return {
    ...(artifact.requirement !== undefined ? { requirement: artifact.requirement } : {}),
    ...(artifact.pipeline === "spec" ? { spec: artifact.content } : { openui: artifact.content }),
  } satisfies PrototypeSuiteContent;
}

function legacySummary(meta: DesignArtifactMeta): DesignSuiteSummary {
  return {
    schemaVersion: 2,
    id: meta.id,
    title: meta.title,
    kind: legacyKind(meta.pipeline),
    status: "draft",
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    currentVersionId: "legacy",
    versionCount: 1,
    partial: true,
    sourcePipeline: meta.pipeline,
  };
}

function readLegacySuite(root: string, id: string): DesignSuite | null {
  const artifact = readDesignArtifact(root, id);
  if (!artifact) return null;
  const status: DesignSuiteStatus = "draft";
  const version: DesignSuiteVersion = {
    versionId: "legacy",
    savedAt: artifact.updatedAt,
    status,
    content: legacyContent(artifact),
  };
  return {
    schemaVersion: 2,
    id: artifact.id,
    title: artifact.title,
    kind: legacyKind(artifact.pipeline),
    status,
    createdAt: artifact.createdAt,
    updatedAt: artifact.updatedAt,
    currentVersionId: version.versionId,
    versions: [version],
    currentVersion: version,
    currentContent: version.content,
    partial: true,
    sourcePipeline: artifact.pipeline,
  };
}

function newVersionId(): string {
  return randomUUID();
}

function cloneSuiteContent<T extends DesignSuiteContent>(content: T): T {
  return JSON.parse(JSON.stringify(content)) as T;
}

function persistSuiteVersion(root: string, meta: DesignSuiteMeta, version: DesignSuiteVersion): void {
  const dir = resolveArtifactDir(root, meta.id);
  const metaPath = dir ? resolveContainedFile(dir, "meta.json") : null;
  const versionPath = dir ? resolveContainedFile(dir, "versions", `${version.versionId}.json`) : null;
  if (!dir || !metaPath || !versionPath) throw new Error("Unsafe suite path");
  writeJsonAtomic(versionPath, version);
  syncSuiteProjections(dir, meta.kind, version.content);
  writeJsonAtomic(metaPath, meta);
  writeSuiteIndex(root, meta);
}

/** Create a versioned design suite with one initial version. */
export function createDesignSuite(root: string, input: CreateDesignSuiteInput): DesignSuite | null {
  try {
    const now = new Date().toISOString();
    const id = randomUUID();
    const version: DesignSuiteVersion = {
      versionId: newVersionId(),
      savedAt: now,
      ...(input.note !== undefined ? { note: input.note } : {}),
      status: input.status ?? "draft",
      content: cloneSuiteContent(input.content),
    };
    const versionSummary: DesignSuiteVersionSummary = {
      versionId: version.versionId,
      savedAt: version.savedAt,
      ...(version.note !== undefined ? { note: version.note } : {}),
      status: version.status,
    };
    const meta: DesignSuiteMeta = {
      schemaVersion: 2,
      id,
      title: input.title || "Untitled",
      kind: input.kind,
      status: version.status,
      createdAt: now,
      updatedAt: now,
      currentVersionId: version.versionId,
      versions: [versionSummary],
      ...(input.authoringLibrary ? { authoringLibrary: input.authoringLibrary } : {}),
      // 主题字段（specs/prd-theme-layer）：创建即带主题/关系（agent 建套件路径）。
      ...(input.themeId !== undefined ? { themeId: input.themeId } : {}),
      ...(input.stage !== undefined ? { stage: input.stage } : {}),
      ...(input.inherits !== undefined ? { inherits: input.inherits } : {}),
      ...(input.references !== undefined ? { references: input.references } : {}),
    };
    persistSuiteVersion(root, meta, version);
    notifySuiteChange({ root, suiteId: id, versionId: version.versionId, change: "create" });
    return readDesignSuite(root, id);
  } catch {
    return null;
  }
}

/** Append a distinct current-content version. The 20-version cap includes current. */
export function appendDesignSuiteVersion(root: string, input: AppendDesignSuiteVersionInput): DesignSuite | null {
  if (!isSafeDesignId(input.suiteId)) return null;
  try {
    let suite = readDesignSuite(root, input.suiteId);
    if (!suite) return null;
    const wasLegacy = suite.partial === true;
    const status = input.status ?? suite.status;
    const normalizedContent = cloneSuiteContent(input.content);
    const contentChanged = !isDeepStrictEqual(suite.currentContent, normalizedContent);
    if (!wasLegacy && !contentChanged) return suite;

    const dir = resolveArtifactDir(root, suite.id);
    if (!dir) return null;
    if (wasLegacy) {
      const legacyVersion = suite.currentVersion;
      const legacyPath = resolveContainedFile(dir, "versions", `${legacyVersion.versionId}.json`);
      if (!legacyPath) return null;
      writeJsonAtomic(legacyPath, legacyVersion);
    }

    let versions = suite.versions.map(({ versionId, savedAt, note, status: versionStatus }) => ({
      versionId,
      savedAt,
      ...(note !== undefined ? { note } : {}),
      status: versionStatus,
    }));
    let currentVersion = suite.currentVersion;
    // Evicted version files are deleted only AFTER the new meta/index persist
    // (delete-last): deleting first meant a crash in between left meta.json
    // referencing deleted files, and readDesignSuite returned null for the
    // whole suite. Delete-last leaves at most orphan files, never a dangling
    // meta.
    const evictedPaths: string[] = [];
    if (contentChanged) {
      const now = new Date().toISOString();
      currentVersion = {
        versionId: newVersionId(),
        savedAt: now,
        ...(input.note !== undefined ? { note: input.note } : {}),
        status,
        content: normalizedContent,
      };
      versions.push({
        versionId: currentVersion.versionId,
        savedAt: currentVersion.savedAt,
        ...(currentVersion.note !== undefined ? { note: currentVersion.note } : {}),
        status: currentVersion.status,
      });
      while (versions.length > MAX_VERSIONS) {
        const removed = versions.shift();
        const removedPath = removed ? resolveContainedFile(dir, "versions", `${removed.versionId}.json`) : null;
        if (removedPath) evictedPaths.push(removedPath);
      }
    } else if (wasLegacy) {
      versions = versions.map((version) =>
        version.versionId === currentVersion.versionId
          ? {
              ...version,
              ...(input.note !== undefined ? { note: input.note } : {}),
              status,
            }
          : version
      );
      currentVersion = {
        ...currentVersion,
        ...(input.note !== undefined ? { note: input.note } : {}),
        status,
      };
    }

    const meta: DesignSuiteMeta = {
      schemaVersion: 2,
      id: suite.id,
      title: suite.title,
      kind: suite.kind,
      status,
      createdAt: suite.createdAt,
      updatedAt: currentVersion.savedAt,
      currentVersionId: currentVersion.versionId,
      versions,
      // The authoring library is lineage-stable: stamped once at creation and
      // carried forward verbatim on every append.
      ...(suite.authoringLibrary ? { authoringLibrary: suite.authoringLibrary } : {}),
      // 主题字段与 authoringLibrary 同规：lineage-stable，逐次 append 原样携带。
      ...(suite.themeId !== undefined ? { themeId: suite.themeId } : {}),
      ...(suite.stage !== undefined ? { stage: suite.stage } : {}),
      ...(suite.inherits !== undefined ? { inherits: suite.inherits } : {}),
      ...(suite.references !== undefined ? { references: suite.references } : {}),
    };
    persistSuiteVersion(root, meta, currentVersion);
    for (const evictedPath of evictedPaths) {
      try {
        fs.rmSync(evictedPath, { force: true });
      } catch {
        // Best-effort eviction — an orphan file is harmless; a failed delete
        // must not fail the already-persisted append.
      }
    }
    notifySuiteChange({
      root,
      suiteId: suite.id,
      versionId: currentVersion.versionId,
      change: "update",
    });
    suite = readDesignSuite(root, suite.id);
    return suite;
  } catch {
    return null;
  }
}

/** Read one suite version; legacy artifacts expose one virtual `legacy` version. */
export function readDesignSuiteVersion(root: string, id: string, versionId: string): DesignSuiteVersion | null {
  if (!isSafeDesignId(id) || !isSafeDesignId(versionId)) return null;
  const meta = readSuiteMeta(root, id);
  if (meta) {
    if (!meta.versions.some((version) => version.versionId === versionId)) return null;
    return readSuiteVersionFile(root, id, versionId);
  }
  const legacy = readLegacySuite(root, id);
  return legacy?.currentVersion.versionId === versionId ? legacy.currentVersion : null;
}

/** Read all retained versions and the current content of a suite. */
export function readDesignSuite(root: string, id: string): DesignSuite | null {
  if (!isSafeDesignId(id)) return null;
  const meta = readSuiteMeta(root, id);
  if (!meta) return readLegacySuite(root, id);
  const versions: DesignSuiteVersion[] = [];
  const dropped: string[] = [];
  for (const summary of meta.versions) {
    const version = readSuiteVersionFile(root, id, summary.versionId);
    if (!version) {
      // Crash tolerance (delete-last companion): a non-current version file
      // that went missing is dropped from the read instead of nulling the
      // whole suite. The CURRENT version is the suite head — without it the
      // suite is unreadable and stays null.
      if (summary.versionId === meta.currentVersionId) return null;
      dropped.push(summary.versionId);
      continue;
    }
    versions.push(version);
  }
  const currentVersion = versions.find((version) => version.versionId === meta.currentVersionId);
  if (!currentVersion) return null;
  if (dropped.length > 0) {
    // Re-review M2: dropping a version without repairing the store left meta,
    // index and every read silently disagreeing (rail renumbering, stale
    // versionCount). Reconcile on read so the next append cannot build on the
    // stale listing either. Best-effort — a failed repair degrades to the
    // un-repaired (still readable) view.
    try {
      const dir = resolveArtifactDir(root, id);
      const metaPath = dir ? resolveContainedFile(dir, "meta.json") : null;
      if (metaPath) {
        const repaired: DesignSuiteMeta = {
          ...meta,
          versions: meta.versions.filter((summary) => !dropped.includes(summary.versionId)),
        };
        writeJsonAtomic(metaPath, repaired);
        writeSuiteIndex(root, repaired);
      }
    } catch {
      // best-effort repair
    }
  }
  return { ...meta, versions, currentVersion, currentContent: currentVersion.content };
}

/** List native v2 suites and one partial suite per legacy artifact, newest first. */
export function listDesignSuites(root: string, kind?: DesignSuiteKind): DesignSuiteSummary[] {
  try {
    const index = getIndex(root);
    const native = (index.suites ?? []).filter((suite) => readSuiteMeta(root, suite.id) !== null);
    const nativeIds = new Set(native.map((suite) => suite.id));
    const legacy = index.artifacts.filter((artifact) => !nativeIds.has(artifact.id)).map(legacySummary);
    return [...native, ...legacy]
      .filter((suite) => kind === undefined || suite.kind === kind)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch {
    return [];
  }
}

/** Delete a suite (native or lazily normalized legacy) and remove all index entries. */
export function deleteDesignSuite(root: string, id: string): boolean {
  const dir = resolveArtifactDir(root, id);
  if (!dir) return false;
  try {
    const index = getIndex(root);
    const hadSuite = (index.suites ?? []).some((suite) => suite.id === id);
    const hadArtifact = index.artifacts.some((artifact) => artifact.id === id);
    if (!hadSuite && !hadArtifact && !fs.existsSync(dir)) return false;
    fs.rmSync(dir, { recursive: true, force: true });
    writeJsonAtomic(path.join(getDesignsDir(root), "index.json"), {
      ...index,
      artifacts: index.artifacts.filter((artifact) => artifact.id !== id),
      suites: (index.suites ?? []).filter((suite) => suite.id !== id),
    });
    notifySuiteChange({ root, suiteId: id, change: "delete" });
    return true;
  } catch {
    return false;
  }
}

export function saveFormState(root: string, id: string, state: unknown, slot?: string): boolean {
  try {
    // containment check (security scan): same id guard as the other artifact
    // paths before the join; unsafe ids cannot become directory names.
    const dir = resolveArtifactDir(root, id);
    // WP3.5 slot: per-device form state ("formState.mobile.json")。非法 slot
    // 直接拒绝(交叉审查:静默降级写共享槽会污染 desktop 表单状态)。
    if (slot && !/^[a-z0-9-]{1,32}$/.test(slot)) return false;
    const safeSlot = slot ?? null;
    if (!dir) return false;
    fs.writeFileSync(
      path.join(dir, safeSlot ? `formState.${safeSlot}.json` : "formState.json"),
      JSON.stringify(state ?? {}, null, 2),
      "utf8"
    );
    return true;
  } catch {
    return false;
  }
}

/** Read a persisted form state for hydration; null when none was saved. */
export function readFormState(root: string, id: string, slot?: string): unknown | null {
  // 与 save 同规:非法 slot 拒绝(不静默读共享槽)。
  if (slot && !/^[a-z0-9-]{1,32}$/.test(slot)) return null;
  const dir = resolveArtifactDir(root, id);
  if (!dir) return null;
  try {
    return JSON.parse(
      fs.readFileSync(
        path.join(dir, slot && /^[a-z0-9-]{1,32}$/.test(slot) ? `formState.${slot}.json` : "formState.json"),
        "utf8"
      )
    ) as unknown;
  } catch {
    return null;
  }
}

/** Delete an artifact (directory + index entry). */
export function deleteDesignArtifact(root: string, id: string): boolean {
  const dir = resolveArtifactDir(root, id);
  if (!dir) return false;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    const index = getIndex(root);
    const next = index.artifacts.filter((a) => a.id !== id);
    if (next.length !== index.artifacts.length) {
      writeIndex(root, { ...index, artifacts: next });
      notifyChange(root);
    }
    return true;
  } catch {
    return false;
  }
}

// ── PRD 主题层（specs/prd-theme-layer）───────────────────────────────────────
// 主题是 index.json 里的轻量分组实体（无版本、无投影文件）；套件的主题归属/
// 阶段/关系是套件元数据（meta + 索引 summary），调整永不追加版本。

function themesOf(index: DesignIndex): DesignTheme[] {
  return index.themes ?? [];
}

function writeThemes(root: string, index: DesignIndex, themes: DesignTheme[]): void {
  writeJsonAtomic(path.join(getDesignsDir(root), "index.json"), { ...index, themes });
}

/** List themes oldest-first（稳定分组序：阶段随时间累积）. 交叉审查修复：
 * 手改/损坏的单条主题（缺 createdAt 之类）不得炸掉整个主题层——过滤坏条目
 * 再排序，排序键缺失降级到稳定序。 */
export function listDesignThemes(root: string): DesignTheme[] {
  const valid = themesOf(getIndex(root)).filter(
    (theme): theme is DesignTheme =>
      Boolean(theme) && typeof theme === "object" && typeof theme.id === "string" && typeof theme.title === "string"
  );
  return valid
    .slice()
    .sort((a, b) =>
      (typeof a.createdAt === "string" ? a.createdAt : "").localeCompare(
        typeof b.createdAt === "string" ? b.createdAt : ""
      )
    );
}

/** 主题载荷钳制（交叉审查修复，与 SUITE 载荷钳制同思路）：标题/备注/阶段
 *  是渲染层反复回显的文本，长度必须有界。 */
export const THEME_TITLE_MAX_CHARS = 200;
export const THEME_NOTE_MAX_CHARS = 2000;
export const THEME_STAGE_MAX_CHARS = 64;
export const THEME_REFERENCES_MAX_ENTRIES = 100;

export function createDesignTheme(root: string, input: { title: string; note?: string }): DesignTheme | null {
  const title = input.title?.trim().slice(0, THEME_TITLE_MAX_CHARS);
  if (!title) return null;
  try {
    const index = getIndex(root);
    const now = new Date().toISOString();
    const theme: DesignTheme = {
      id: randomUUID(),
      title,
      ...(input.note !== undefined && input.note.trim() ? { note: input.note.trim() } : {}),
      createdAt: now,
      updatedAt: now,
    };
    writeThemes(root, index, [...themesOf(index), theme]);
    notifySuiteChange({ root, suiteId: theme.id, change: "theme" });
    return theme;
  } catch {
    return null;
  }
}

/** Update a theme's title/note. `note: null` clears it. */
export function updateDesignTheme(root: string, id: string, input: { title?: string; note?: string | null }): boolean {
  if (!isSafeDesignId(id)) return false;
  try {
    const index = getIndex(root);
    const themes = themesOf(index);
    const targetIndex = themes.findIndex((theme) => theme.id === id);
    if (targetIndex < 0) return false;
    const previous = themes[targetIndex];
    const next: DesignTheme = {
      ...previous,
      title: input.title === undefined ? previous.title : input.title.trim() || previous.title,
      updatedAt: new Date().toISOString(),
    };
    if (input.note === null) delete next.note;
    else if (input.note !== undefined && input.note.trim()) next.note = input.note.trim();
    const nextThemes = themes.slice();
    nextThemes[targetIndex] = next;
    writeThemes(root, index, nextThemes);
    notifySuiteChange({ root, suiteId: id, change: "theme" });
    return true;
  } catch {
    return false;
  }
}

/** Delete a theme and DETACH its suites（meta + 索引 themeId 置空）——删主题
 *  永不删 PRD。 */
export function deleteDesignTheme(root: string, id: string): boolean {
  if (!isSafeDesignId(id)) return false;
  try {
    const index = getIndex(root);
    const themes = themesOf(index);
    if (!themes.some((theme) => theme.id === id)) return false;
    const suites = index.suites ?? [];
    // 交叉审查修复：先写索引（渲染层的权威视图——主题移除 + summary 解绑
    // 一次原子完成），meta 尽力收敛；中途失败不再让索引半新半旧且事件照发。
    writeJsonAtomic(path.join(getDesignsDir(root), "index.json"), {
      ...index,
      suites: suites.map((suite) => (suite.themeId === id ? { ...suite, themeId: undefined } : suite)),
      themes: themes.filter((theme) => theme.id !== id),
    });
    for (const suite of suites) {
      if (suite.themeId !== id) continue;
      const meta = readSuiteMeta(root, suite.id);
      if (!meta || meta.themeId !== id) continue;
      const dir = resolveArtifactDir(root, suite.id);
      const metaPath = dir ? resolveContainedFile(dir, "meta.json") : null;
      if (!metaPath) continue;
      try {
        const next: DesignSuiteMeta = { ...meta, themeId: undefined };
        writeJsonAtomic(metaPath, next);
      } catch {
        // best-effort：索引已解绑（显示正确）；meta 残留无害，下次 assign/
        // append 的 meta 写会自然收敛。
      }
    }
    notifySuiteChange({ root, suiteId: id, change: "theme" });
    return true;
  } catch {
    return false;
  }
}

/** Assign theme/stage/relations on a suite's META（永不追加版本）.
 *  undefined = 保持现状, null = 清除, 数组 = 整体替换。themeId 指向的主题必须
 *  存在（悬空归属会让目录分组静默丢卡片）；关系引用按宽松校验（UI 从真实
 *  套件列表选取，关系目标可能迟于被引用方删除而悬空——展示层容错）。 */
export function assignSuiteTheme(root: string, suiteId: string, input: AssignSuiteThemeInput): boolean {
  if (!isSafeDesignId(suiteId)) return false;
  try {
    const meta = readSuiteMeta(root, suiteId);
    if (!meta) return false;
    let themeId = meta.themeId;
    if (input.themeId !== undefined) {
      if (input.themeId === null) themeId = undefined;
      else {
        if (!themesOf(getIndex(root)).some((theme) => theme.id === input.themeId)) return false;
        themeId = input.themeId;
      }
    }
    const stage =
      input.stage === undefined
        ? meta.stage
        : input.stage === null || !input.stage.trim()
          ? undefined
          : input.stage.trim().slice(0, THEME_STAGE_MAX_CHARS);
    const inherits =
      input.inherits === undefined ? meta.inherits : input.inherits === null ? undefined : { ...input.inherits };
    const references =
      input.references === undefined
        ? meta.references
        : input.references === null
          ? undefined
          : input.references
              .slice(0, THEME_REFERENCES_MAX_ENTRIES)
              .filter((ref) => typeof ref?.suiteId === "string" && ref.suiteId.length <= 128)
              .map((ref) => ({
                suiteId: ref.suiteId,
                ...(typeof ref.versionId === "string" && ref.versionId.length <= 128
                  ? { versionId: ref.versionId }
                  : {}),
              }));
    const next: DesignSuiteMeta = { ...meta };
    if (themeId === undefined) delete next.themeId;
    else next.themeId = themeId;
    if (stage === undefined) delete next.stage;
    else next.stage = stage;
    if (inherits === undefined) delete next.inherits;
    else next.inherits = inherits;
    if (references === undefined) delete next.references;
    else next.references = references;
    const dir = resolveArtifactDir(root, suiteId);
    const metaPath = dir ? resolveContainedFile(dir, "meta.json") : null;
    if (!metaPath) return false;
    writeJsonAtomic(metaPath, next);
    writeSuiteIndex(root, next);
    notifySuiteChange({ root, suiteId, change: "theme" });
    return true;
  } catch {
    return false;
  }
}

/** Derive a title from content (first heading or first non-empty line). */
export function deriveTitle(content: string): string {
  const heading = content.match(/^#\s+(.+)$/m)?.[1];
  if (heading) return heading.slice(0, 60);
  const nameMatch = content.match(/^name:\s*(.+)$/m)?.[1];
  if (nameMatch) return nameMatch.trim().slice(0, 60);
  const firstLine = content.split("\n").find((l) => l.trim().length > 0);
  return (firstLine ?? "Untitled").trim().slice(0, 60);
}
