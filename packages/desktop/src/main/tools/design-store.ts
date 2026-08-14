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

export interface DesignArtifactMeta {
  id: string;
  title: string;
  pipeline: DesignPipeline;
  createdAt: string;
  updatedAt: string;
}

export interface DesignArtifact extends DesignArtifactMeta {
  content: string;
}

interface DesignIndex {
  version: 1;
  artifacts: DesignArtifactMeta[];
}

const INDEX_VERSION = 1;
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

/** Save (create or update) a design artifact. Returns the artifact meta. */
export function saveDesignArtifact(
  root: string,
  input: { id?: string; title: string; pipeline: DesignPipeline; content: string }
): DesignArtifactMeta | null {
  try {
    const dir = getDesignsDir(root);
    const index = getIndex(root);
    const now = new Date().toISOString();
    const existing = input.id ? index.artifacts.find((a) => a.id === input.id) : undefined;

    const meta: DesignArtifactMeta = {
      id: existing?.id ?? input.id ?? randomUUID(),
      title: input.title || existing?.title || "Untitled",
      pipeline: input.pipeline,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    const artifactDir = path.join(dir, meta.id);
    fs.mkdirSync(artifactDir, { recursive: true });
    fs.writeFileSync(path.join(artifactDir, FILE_BY_PIPELINE[meta.pipeline]), input.content, "utf8");
    fs.writeFileSync(path.join(artifactDir, "meta.json"), JSON.stringify(meta, null, 2), "utf8");

    // Update index (replace or append).
    const idx = index.artifacts.findIndex((a) => a.id === meta.id);
    if (idx >= 0) {
      index.artifacts[idx] = meta;
    } else {
      index.artifacts.push(meta);
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

/** Read a single artifact's full content. */
export function readDesignArtifact(root: string, id: string): DesignArtifact | null {
  try {
    const metaPath = path.join(getDesignsDir(root), id, "meta.json");
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf8")) as DesignArtifactMeta;
    const content = fs.readFileSync(path.join(getDesignsDir(root), id, FILE_BY_PIPELINE[meta.pipeline]), "utf8");
    return { ...meta, content };
  } catch {
    return null;
  }
}

/** Delete an artifact (directory + index entry). */
export function deleteDesignArtifact(root: string, id: string): boolean {
  try {
    const artifactDir = path.join(getDesignsDir(root), id);
    fs.rmSync(artifactDir, { recursive: true, force: true });
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
