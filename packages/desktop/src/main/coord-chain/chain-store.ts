// Per-chain persistence (design §6/§10, R1/R10).
//
// The ledger directory is the single source of truth: one JSON file per
// finalized block (`<height>-<hashprefix>.json`, block + its approval set).
// The SQLite view and the object store are disposable caches derived from it.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  blockHash,
  rebuildView,
  LedgerView,
  ObjectStore,
  type Approval,
  type Block,
  type BlobManifest,
} from "@deeporca/ledger";
import { chainPaths, ensureChainDirs, type ChainPaths } from "./paths.js";

export interface StoredBlock {
  block: Block;
  approvals: Approval[];
}

const MANIFESTS_DIR = "manifests";

export class ChainStore {
  readonly paths: ChainPaths;
  readonly objects: ObjectStore;
  private view: LedgerView | null = null;

  constructor(chainId: string, root?: string) {
    this.paths = chainPaths(chainId, root);
    ensureChainDirs(this.paths);
    this.objects = new ObjectStore(this.paths.objectsDir);
  }

  /** Blocks from disk, ascending by height. */
  loadBlocks(): StoredBlock[] {
    if (!existsSync(this.paths.blocksDir)) {
      return [];
    }
    const files = readdirSync(this.paths.blocksDir).filter((name) => name.endsWith(".json"));
    const stored: StoredBlock[] = [];
    for (const name of files) {
      try {
        const parsed = JSON.parse(readFileSync(join(this.paths.blocksDir, name), "utf8")) as StoredBlock;
        if (parsed && parsed.block && Array.isArray(parsed.approvals)) {
          stored.push(parsed);
        }
      } catch {
        // A torn write (partial file) must not poison the ledger; the file is
        // simply absent from the in-memory chain and the next full replay of
        // a joined peer would flag any real inconsistency (R5).
      }
    }
    stored.sort((a, b) => a.block.height - b.block.height);
    return stored;
  }

  appendBlock(stored: StoredBlock): void {
    const hash = blockHash(stored.block);
    const name = `${String(stored.block.height).padStart(6, "0")}-${hash.slice(0, 16)}.json`;
    writeFileSync(join(this.paths.blocksDir, name), JSON.stringify(stored, null, 2));
  }

  openView(): LedgerView {
    if (!this.view) {
      this.view = new LedgerView(this.paths.viewDbPath);
    }
    return this.view;
  }

  /** Delete-and-rebuild the SQLite view from the block list (R10). */
  rebuildView(blocks: Block[]): LedgerView {
    this.view?.close();
    this.view = rebuildView(this.paths.viewDbPath, blocks);
    return this.view;
  }

  closeView(): void {
    this.view?.close();
    this.view = null;
  }

  // Manifests are tiny metadata objects; persist them so a restarted node can
  // still serve getManifest for assets it published.
  writeManifest(manifestCid: string, manifest: BlobManifest): void {
    const dir = join(this.paths.objectsDir, MANIFESTS_DIR);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(join(dir, `${manifestCid.replace(/[^a-z0-9]/gi, "_")}.json`), JSON.stringify(manifest));
  }

  readManifest(manifestCid: string): BlobManifest | undefined {
    const dir = join(this.paths.objectsDir, MANIFESTS_DIR);
    const path = join(dir, `${manifestCid.replace(/[^a-z0-9]/gi, "_")}.json`);
    if (!existsSync(path)) {
      return undefined;
    }
    try {
      return JSON.parse(readFileSync(path, "utf8")) as BlobManifest;
    } catch {
      return undefined;
    }
  }
}
