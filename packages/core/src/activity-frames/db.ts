/**
 * Read-only SQLite access for the activity-frames capture DB.
 * Port of activity_frames/db.py.
 *
 * Uses `node:sqlite` (available in Electron Node 24+) with read-only mode.
 * Falls back to better-sqlite3 if node:sqlite is unavailable.
 */

import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { RawFrame, RawEvent } from "./types";
import { parseEpoch } from "./time";

/** Default DB locations (checked in order, most recent mtime wins). */
const DB_CANDIDATES = [
  join(homedir(), ".deeporca", "activity.db"),
  join(homedir(), ".nocta", "db.sqlite"),
  join(homedir(), ".nocta", "data", "db.sqlite"),
];

/** Find the default capture DB path, or null if none exists. */
export function findDefaultDb(): string | null {
  const candidates = DB_CANDIDATES.filter(existsSync);
  if (candidates.length === 0) return null;
  // Pick most recently modified (the live DB is written every few seconds).
  let best = candidates[0];
  let bestMtime = statSync(best).mtimeMs;
  for (const c of candidates.slice(1)) {
    const m = statSync(c).mtimeMs;
    if (m > bestMtime) {
      best = c;
      bestMtime = m;
    }
  }
  return best;
}

/**
 * Read-only activity DB wrapper.
 * Use `try { ... } finally { db.close() }` pattern.
 */
export class ActivityDb {
  private conn: {
    exec(sql: string): void;
    prepare(sql: string): { get(...params: unknown[]): unknown[] | undefined; all(...params: unknown[]): unknown[][] };
  };

  constructor(path?: string) {
    const dbPath = path ?? findDefaultDb();
    if (!dbPath) {
      throw new Error("Activity DB not found. Expected at ~/.deeporca/activity.db or ~/.nocta/db.sqlite.");
    }
    // Try node:sqlite first (Node 22+ with --experimental-sqlite, or Node 24+ native).
    try {
      // Dynamic require to avoid import errors on older Node.
      const { DatabaseSync } = require("node:sqlite");
      this.conn = new DatabaseSync(dbPath, { readOnly: true });
    } catch {
      // Fallback: better-sqlite3 (available in Electron environment).
      const Database = require("better-sqlite3");
      this.conn = new Database(dbPath, { readonly: true, timeout: 3000 });
      this.conn.exec("PRAGMA query_only = ON");
    }
  }

  /** Execute a query and return all rows. */
  rows(sql: string, ...params: unknown[]): unknown[][] {
    return this.conn.prepare(sql).all(...params) as unknown[][];
  }

  /** Execute a query and return the first cell of the first row, or default. */
  scalar(sql: string, defaultValue: number = 0, ...params: unknown[]): number {
    const row = this.conn.prepare(sql).get(...params);
    if (!row || row[0] === undefined || row[0] === null) return defaultValue;
    return Number(row[0]);
  }

  /** Check if a table exists. */
  tableExists(name: string): boolean {
    const row = this.conn.prepare("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
    return Number(row?.[0] ?? 0) > 0;
  }

  /** Check if a column exists in a table. */
  hasColumn(table: string, column: string): boolean {
    const rows = this.conn.prepare(`PRAGMA table_info(${table})`).all() as unknown[][];
    return rows.some((r) => r[1] === column);
  }

  /** Close the database connection. */
  close(): void {
    try {
      (this.conn as { close?: () => void }).close?.();
    } catch {
      // Best-effort.
    }
  }

  // ── High-level loaders ─────────────────────────────────────────────────

  /**
   * Load raw frames in a time window.
   * Returns frames sorted by timestamp ascending.
   */
  loadFrames(startUtc: string, endUtc: string, deviceCol = "device_name"): RawFrame[] {
    const sql = `SELECT id, timestamp, app_name, window_name, browser_url, ${deviceCol} FROM frames WHERE timestamp >= ? AND timestamp < ? AND app_name IS NOT NULL AND app_name != '' ORDER BY timestamp ASC`;
    const rows = this.rows(sql, startUtc, endUtc);
    return rows.map((r) => ({
      id: Number(r[0]),
      epoch: parseEpoch(String(r[1])),
      app: String(r[2] ?? ""),
      window: String(r[3] ?? ""),
      url: String(r[4] ?? ""),
      domain: null,
      device: String(r[5] ?? ""),
    }));
  }

  /**
   * Load raw input events in a time window (optional table).
   * Returns events sorted by epoch ascending.
   */
  loadEvents(startUtc: string, endUtc: string): RawEvent[] {
    if (!this.tableExists("ui_events")) return [];
    const sql = `SELECT timestamp, event_type, text_content FROM ui_events WHERE timestamp >= ? AND timestamp < ? ORDER BY timestamp ASC`;
    const rows = this.rows(sql, startUtc, endUtc);
    return rows.map((r) => ({
      epoch: parseEpoch(String(r[0])),
      eventType: String(r[1] ?? ""),
      textContent: String(r[2] ?? ""),
    }));
  }
}
