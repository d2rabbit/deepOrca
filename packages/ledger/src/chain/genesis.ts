// Genesis and chain ID (design §4.2, R3/R26).
//
// One chain per workspace theme. The theme first opened for sharing on a LAN
// creates the genesis; the chain ID is derived from the canonical genesis
// bytes and is therefore bidirectionally anchored to the theme — joiners must
// verify BOTH the stored theme string and the recomputed themeId before
// accepting (protects against near-miss theme collisions).

import { createHash, randomBytes } from "node:crypto";
import { base32LowerNoPad } from "../encode/base32.js";
import { jcsBytes, type JsonValue } from "../encode/jcs.js";
import { toHex } from "../encode/bytes.js";
import { themeIdFromTheme } from "../theme/theme.js";
import type { QuorumPolicy } from "../block/block.js";

export interface ChainParams {
  quorum: QuorumPolicy;
  blockIntervalMs: number;
  maxBlockRecords: number;
  admission: "open" | "invite";
}

export interface Genesis {
  type: "genesis";
  /** Canonical theme string — the chain's namespace. */
  theme: string;
  /** ISO-8601 timestamp. */
  createdAt: string;
  /** Creator keyId (first member). */
  creator: string;
  params: ChainParams;
  /** 32 random bytes, hex — makes chain IDs unique even for equal params. */
  salt: string;
}

export const DEFAULT_CHAIN_PARAMS: ChainParams = {
  quorum: "majority",
  blockIntervalMs: 2000,
  maxBlockRecords: 256,
  admission: "open",
};

export interface BuildGenesisInput {
  theme: string;
  creator: string;
  createdAt?: string;
  params?: Partial<ChainParams>;
  saltHex?: string;
}

export function buildGenesis(input: BuildGenesisInput): Genesis {
  const salt = input.saltHex ?? toHex(new Uint8Array(randomBytes(32)));
  if (salt.length !== 64 || !/^[0-9a-f]{64}$/.test(salt)) {
    throw new Error("genesis salt must be 32 bytes of hex");
  }
  return {
    type: "genesis",
    theme: input.theme,
    createdAt: input.createdAt ?? new Date().toISOString(),
    creator: input.creator,
    params: { ...DEFAULT_CHAIN_PARAMS, ...input.params },
    salt,
  };
}

export function genesisHash(genesis: Genesis): string {
  return toHex(genesisHashDigest(genesis));
}

export function genesisHashDigest(genesis: Genesis): Uint8Array {
  return new Uint8Array(
    createHash("sha256")
      .update(jcsBytes(genesis as unknown as JsonValue))
      .digest()
  );
}

/** "orca1" + first 20 base32 chars of SHA-256(canonical genesis), lowercase. */
export function chainIdFromGenesis(genesis: Genesis): string {
  return "orca1" + base32LowerNoPad(genesisHashDigest(genesis)).slice(0, 20);
}

/** Display grouping: orca1-abcd2-fghij-klmno-pqrst (5-char groups, R3). */
export function formatChainId(chainId: string): string {
  if (!chainId.startsWith("orca1")) {
    return chainId;
  }
  const body = chainId.slice("orca1".length);
  const groups = body.match(/.{1,5}/g) ?? [];
  return ["orca1", ...groups].join("-");
}

export type ThemeAnchorCheck = { ok: true } | { ok: false; reason: string };

/** Join-time anchor verification (R26): genesis theme string AND recomputed themeId must both match. */
export function verifyThemeAnchor(genesis: Genesis, expectedTheme: string, expectedThemeId: string): ThemeAnchorCheck {
  if (genesis.theme !== expectedTheme) {
    return { ok: false, reason: `genesis theme mismatch: ${genesis.theme} != ${expectedTheme}` };
  }
  if (themeIdFromTheme(genesis.theme) !== expectedThemeId) {
    return { ok: false, reason: `themeId mismatch for theme ${genesis.theme}` };
  }
  return { ok: true };
}
