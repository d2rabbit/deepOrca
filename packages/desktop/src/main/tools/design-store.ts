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

export type DesignPipeline = "openui" | "design";

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

interface DesignIndex {
  version: 1;
  artifacts: DesignArtifactMeta[];
}

const INDEX_VERSION = 1;
const MAX_VERSIONS = 20;
const FILE_BY_PIPELINE: Record<DesignPipeline, string> = {
  openui: "prototype.openui.txt",
  design: "prototype.dd",
};

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
  const dir = getDesignsDir(root);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify(index, null, 2), "utf8");
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
    if (input.id !== undefined && !isSafeArtifactId(input.id)) {
      return null;
    }
    const index = getIndex(root);
    const now = new Date().toISOString();
    const existing = input.id ? (readMetaFile(root, input.id) ?? undefined) : undefined;

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
function isSafeArtifactId(id: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id) && !id.includes("..");
}

/** Resolve an artifact id to its directory, or null when the id is unsafe. */
function resolveArtifactDir(root: string, id: string): string | null {
  if (!isSafeArtifactId(id)) return null;
  const resolved = path.resolve(getDesignsDir(root), id);
  const base = path.resolve(getDesignsDir(root));
  return resolved === path.join(base, id) ? resolved : null;
}
export function saveFormState(root: string, id: string, state: unknown): boolean {
  try {
    // containment check (security scan): same id guard as the other artifact
    // paths before the join; unsafe ids cannot become directory names.
    const dir = resolveArtifactDir(root, id);
    if (!dir) return false;
    fs.writeFileSync(path.join(dir, "formState.json"), JSON.stringify(state ?? {}, null, 2), "utf8");
    return true;
  } catch {
    return false;
  }
}

/** Read a persisted form state for hydration; null when none was saved. */
export function readFormState(root: string, id: string): unknown | null {
  const dir = resolveArtifactDir(root, id);
  if (!dir) return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, "formState.json"), "utf8")) as unknown;
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
    }
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
