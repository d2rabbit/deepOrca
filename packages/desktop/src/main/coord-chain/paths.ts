// Data layout for the Coord Chain node (design §4.3/§10, R1).
//
//   <root>/device-key.json                 per-machine Ed25519 identity (0600)
//   <root>/<chainId>/ledger/blocks/*.json  the authoritative ledger (one JSON per block)
//   <root>/<chainId>/objects/chunks/…      content-addressed blob chunks (disposable)
//   <root>/<chainId>/view.db               SQLite materialized view (rebuildable)
//
// DEEPORCA_COORDCHAIN_HOME overrides the root — tests use it to stay out of
// the developer's real ~/.deeporca.

import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { generateDeviceIdentity, loadDeviceIdentity, saveDeviceIdentity, type DeviceIdentity } from "@deeporca/ledger";

export function coordChainRoot(): string {
  return process.env.DEEPORCA_COORDCHAIN_HOME ?? join(homedir(), ".deeporca", "coordchain");
}

export function deviceKeyPath(): string {
  return join(coordChainRoot(), "device-key.json");
}

export interface ChainPaths {
  chainId: string;
  dir: string;
  blocksDir: string;
  objectsDir: string;
  viewDbPath: string;
}

export function chainPaths(chainId: string, root: string = coordChainRoot()): ChainPaths {
  const dir = join(root, chainId);
  return {
    chainId,
    dir,
    blocksDir: join(dir, "ledger", "blocks"),
    objectsDir: join(dir, "objects"),
    viewDbPath: join(dir, "view.db"),
  };
}

/** Create the directory skeleton for a chain (idempotent). */
export function ensureChainDirs(paths: ChainPaths): void {
  for (const dir of [paths.dir, paths.blocksDir, paths.objectsDir]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}

/** Load-or-create the device identity at the well-known path (R2). */
export function loadOrCreateDeviceIdentity(): DeviceIdentity {
  const path = deviceKeyPath();
  if (existsSync(path)) {
    return loadDeviceIdentity(path);
  }
  const identity = generateDeviceIdentity();
  saveDeviceIdentity(identity, path);
  return identity;
}
