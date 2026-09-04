// Materialized SQLite view (design §6/§10, R10).
//
// The ledger (JSON block files) is the single source of truth; this view is a
// disposable query cache for the shared-space panel (members/assets/tasks/
// commits/blocks). It can be deleted and rebuilt from the block list at any
// time — `rebuildView` is that entry point. Blocks must be applied in height
// order; `applyBlockToView` is idempotent (INSERT OR IGNORE everywhere), so
// replays and re-gossip of the same block are harmless.

import { DatabaseSync } from "node:sqlite";
import { keyIdFromPublicKeyBase64 } from "../identity/identity.js";
import { existsSync, rmSync } from "node:fs";
import { blockHash, type Block } from "../block/block.js";
import { commitCidOf } from "../ws/commit.js";
import type { RecordType } from "../record/record.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS blocks (
  height INTEGER PRIMARY KEY,
  hash TEXT NOT NULL,
  proposer TEXT NOT NULL,
  ts INTEGER NOT NULL,
  merkle_root TEXT NOT NULL,
  record_count INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS members (
  key_id TEXT PRIMARY KEY,
  device_name TEXT NOT NULL,
  pub_key TEXT NOT NULL,
  joined_height INTEGER NOT NULL,
  left_height INTEGER
);
CREATE TABLE IF NOT EXISTS records (
  record_id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  ts INTEGER NOT NULL,
  author TEXT NOT NULL,
  parent_record_id TEXT,
  body_json TEXT NOT NULL,
  block_height INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS assets (
  cid TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  kind TEXT NOT NULL,
  size INTEGER NOT NULL,
  head_record_id TEXT NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS tasks (
  task_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  percent INTEGER NOT NULL DEFAULT 0,
  head_record_id TEXT NOT NULL,
  last_ts INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS commits (
  commit_cid TEXT PRIMARY KEY,
  tree_cid TEXT NOT NULL,
  author TEXT NOT NULL,
  ts INTEGER NOT NULL,
  message TEXT NOT NULL,
  task_ref TEXT,
  block_height INTEGER NOT NULL
);
`;

export class LedgerView {
  readonly db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec(SCHEMA);
  }

  applyBlock(block: Block): void {
    const insertBlock = this.db.prepare(
      "INSERT OR IGNORE INTO blocks (height, hash, proposer, ts, merkle_root, record_count) VALUES (?, ?, ?, ?, ?, ?)"
    );
    insertBlock.run(block.height, blockHash(block), block.proposer, block.ts, block.merkleRoot, block.records.length);

    const insertRecord = this.db.prepare(
      "INSERT OR IGNORE INTO records (record_id, type, ts, author, parent_record_id, body_json, block_height) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    for (const record of block.records) {
      insertRecord.run(
        record.recordId,
        record.type,
        record.ts,
        record.author,
        record.parentRecordId ?? null,
        JSON.stringify(record.body),
        block.height
      );
      this.applyRecordSemantics(record.type, record.recordId, record.ts, record.author, record.body, block.height);
    }
  }

  private applyRecordSemantics(
    type: RecordType,
    recordId: string,
    ts: number,
    author: string,
    body: unknown,
    height: number
  ): void {
    const b = (body ?? {}) as Record<string, unknown>;
    switch (type) {
      case "member.join": {
        this.db
          .prepare("INSERT OR IGNORE INTO members (key_id, device_name, pub_key, joined_height) VALUES (?, ?, ?, ?)")
          .run(author, String(b.deviceName ?? ""), String(b.pubKey ?? ""), height);
        break;
      }
      case "member.leave": {
        this.db.prepare("UPDATE members SET left_height = ? WHERE key_id = ?").run(height, author);
        break;
      }
      case "member.rotate": {
        // The membership entry is continuous: key_id + pub_key move to the
        // derived id while joined_height/left_height history is preserved.
        const body = b as { newPubKey?: string };
        if (typeof body.newPubKey === "string") {
          try {
            const newKeyId = keyIdFromPublicKeyBase64(body.newPubKey);
            this.db
              .prepare("UPDATE members SET key_id = ?, pub_key = ? WHERE key_id = ? AND left_height IS NULL")
              .run(newKeyId, body.newPubKey, author);
          } catch {
            // Malformed key — the replay layer already rejected the block.
          }
        }
        break;
      }
      case "asset.publish": {
        this.db
          .prepare(
            "INSERT OR IGNORE INTO assets (cid, name, mime, kind, size, head_record_id, revoked) VALUES (?, ?, ?, ?, ?, ?, 0)"
          )
          .run(
            String(b.cid),
            String(b.name ?? ""),
            String(b.mime ?? ""),
            String(b.kind ?? "other"),
            Number(b.size ?? 0),
            recordId
          );
        break;
      }
      case "asset.update": {
        this.db.prepare("UPDATE assets SET head_record_id = ? WHERE cid = ?").run(recordId, String(b.cid));
        break;
      }
      case "asset.revoke": {
        this.db.prepare("UPDATE assets SET revoked = 1 WHERE cid = ?").run(String(b.cid));
        break;
      }
      case "task.share": {
        this.db
          .prepare(
            "INSERT OR IGNORE INTO tasks (task_id, title, status, percent, head_record_id, last_ts) VALUES (?, ?, 'shared', 0, ?, ?)"
          )
          .run(recordId, String(b.title ?? ""), recordId, ts);
        break;
      }
      case "task.claim":
      case "task.progress":
      case "task.done": {
        const taskId = String(b.taskId ?? "");
        const row = this.db.prepare("SELECT last_ts, head_record_id FROM tasks WHERE task_id = ?").get(taskId) as
          | { last_ts: number | bigint; head_record_id: string }
          | undefined;
        if (!row) {
          break;
        }
        const status = type === "task.claim" ? "claimed" : type === "task.done" ? "done" : "in-progress";
        const percent =
          type === "task.progress" && typeof b.percent === "number"
            ? Math.max(0, Math.min(100, Math.round(b.percent)))
            : undefined;
        const newer = Number(row.last_ts) < ts || (Number(row.last_ts) === ts && row.head_record_id < recordId);
        if (newer) {
          if (percent === undefined) {
            this.db
              .prepare("UPDATE tasks SET status = ?, head_record_id = ?, last_ts = ? WHERE task_id = ?")
              .run(status, recordId, ts, taskId);
          } else {
            this.db
              .prepare("UPDATE tasks SET status = ?, percent = ?, head_record_id = ?, last_ts = ? WHERE task_id = ?")
              .run(status, percent, recordId, ts, taskId);
          }
        }
        break;
      }
      case "ws.commit": {
        const commitCid = commitCidOf({
          version: 1,
          treeCid: String(b.treeCid ?? ""),
          parents: Array.isArray(b.parents) ? b.parents.map(String) : [],
          message: String(b.message ?? ""),
          author,
          ts,
          ...(typeof b.taskRef === "string" ? { taskRef: b.taskRef } : {}),
        });
        this.db
          .prepare(
            "INSERT OR IGNORE INTO commits (commit_cid, tree_cid, author, ts, message, task_ref, block_height) VALUES (?, ?, ?, ?, ?, ?, ?)"
          )
          .run(
            commitCid,
            String(b.treeCid ?? ""),
            author,
            ts,
            String(b.message ?? ""),
            typeof b.taskRef === "string" ? b.taskRef : null,
            height
          );
        break;
      }
      default:
        break;
    }
  }

  listMembers(): MemberRow[] {
    return this.db
      .prepare(
        "SELECT key_id, device_name, pub_key, joined_height, left_height FROM members ORDER BY joined_height, key_id"
      )
      .all() as unknown as MemberRow[];
  }

  listRecords(type?: RecordType): RecordRow[] {
    if (type) {
      return this.db
        .prepare(
          "SELECT record_id, type, ts, author, parent_record_id, body_json, block_height FROM records WHERE type = ? ORDER BY ts, record_id"
        )
        .all(type) as unknown as RecordRow[];
    }
    return this.db
      .prepare(
        "SELECT record_id, type, ts, author, parent_record_id, body_json, block_height FROM records ORDER BY ts, record_id"
      )
      .all() as unknown as RecordRow[];
  }

  /** Assets with revoked filtered out by default (asset.revoke = view filter, R13). */
  listAssets(includeRevoked = false): AssetRow[] {
    const sql =
      "SELECT cid, name, mime, kind, size, head_record_id, revoked FROM assets" +
      (includeRevoked ? "" : " WHERE revoked = 0") +
      " ORDER BY name, cid";
    return this.db.prepare(sql).all() as unknown as AssetRow[];
  }

  listTasks(): TaskRow[] {
    return this.db
      .prepare(
        "SELECT task_id, title, status, percent, head_record_id, last_ts FROM tasks ORDER BY last_ts DESC, task_id"
      )
      .all() as unknown as TaskRow[];
  }

  listCommits(): CommitRow[] {
    return this.db
      .prepare(
        "SELECT commit_cid, tree_cid, author, ts, message, task_ref, block_height FROM commits ORDER BY ts DESC, commit_cid"
      )
      .all() as unknown as CommitRow[];
  }

  listBlocks(offset: number, limit: number): BlockRow[] {
    return this.db
      .prepare(
        "SELECT height, hash, proposer, ts, merkle_root, record_count FROM blocks ORDER BY height DESC LIMIT ? OFFSET ?"
      )
      .all(limit, offset) as unknown as BlockRow[];
  }

  close(): void {
    this.db.close();
  }
}

export interface MemberRow {
  key_id: string;
  device_name: string;
  pub_key: string;
  joined_height: number;
  left_height: number | null;
}

export interface RecordRow {
  record_id: string;
  type: string;
  ts: number;
  author: string;
  parent_record_id: string | null;
  body_json: string;
  block_height: number;
}

export interface AssetRow {
  cid: string;
  name: string;
  mime: string;
  kind: string;
  size: number;
  head_record_id: string;
  revoked: number;
}

export interface TaskRow {
  task_id: string;
  title: string;
  status: string;
  percent: number;
  head_record_id: string;
  last_ts: number;
}

export interface CommitRow {
  commit_cid: string;
  tree_cid: string;
  author: string;
  ts: number;
  message: string;
  task_ref: string | null;
  block_height: number;
}

export interface BlockRow {
  height: number;
  hash: string;
  proposer: string;
  ts: number;
  merkle_root: string;
  record_count: number;
}

/**
 * Delete-and-rebuild entry point (R10): the ledger is authoritative, so the
 * view is always reproducible by applying every block from height 0.
 */
export function rebuildView(dbPath: string, blocks: Block[]): LedgerView {
  if (existsSync(dbPath)) {
    rmSync(dbPath, { force: true });
  }
  const view = new LedgerView(dbPath);
  for (const block of blocks) {
    view.applyBlock(block);
  }
  return view;
}
