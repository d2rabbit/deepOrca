// LAN discovery for the Coord Chain (design §7, R4/R25; OC2 task 9).
//
// Service: `_deeporca-chain._tcp.local.` with TXT records
//   wt = themeId prefix (first 8 chars)   — the discovery-level isolation key
//   cid = chainId body prefix (8 chars)   — diagnostics / dedupe
//   v  = protocol version
//   port = sync port of the advertising node
//
// Discovery only ever CONNECTS on a wt match — cross-theme instances stay
// invisible to each other (no handshake, no member listing, R25). The
// handshake re-verifies themeShort as defense in depth, and chainInfo
// re-checks the full chainId.
//
// The invite code (`deeporca-chain://host:port/<themeId>`) is the fallback
// for networks where multicast is blocked (design §7, R4).
//
// Type note: @types/dns-packet types SRV data as {target}, while the
// multicast-dns runtime uses {host} — casts at the packet boundary are
// deliberate and confined to this file.

import { hostname } from "node:os";
import multicastDns, { type MulticastDNS } from "multicast-dns";
import type { Answer } from "dns-packet";

export const SERVICE_NAME = "_deeporca-chain._tcp.local.";
export const DISCOVERY_VERSION = 1;

export interface AdvertisedChain {
  host: string;
  port: number;
  themeShort: string;
  chainShort: string;
  version: number;
}

/**
 * Discovery-level isolation (R25): only chains advertising the SAME theme
 * prefix and the CURRENT protocol version are connectable peers.
 */
export function filterMatchingChains(chains: Iterable<AdvertisedChain>, themeShort: string): AdvertisedChain[] {
  const matches: AdvertisedChain[] = [];
  for (const chain of chains) {
    if (chain.themeShort === themeShort && chain.version === DISCOVERY_VERSION) {
      matches.push(chain);
    }
  }
  return matches;
}

export class Discovery {
  private mdns: MulticastDNS | null = null;
  private advertisement: { instance: string; themeShort: string; chainShort: string; port: number } | null = null;
  private readonly seen = new Map<string, AdvertisedChain>();

  /** Start answering queries for our chain (must match one workspace theme). */
  advertise(input: { themeShort: string; chainShort: string; port: number; instanceName?: string }): void {
    this.stopAdvertisement();
    const instance = `${input.instanceName ?? "deeporca"}-${Math.random().toString(36).slice(2, 8)}.${SERVICE_NAME}`;
    this.advertisement = { instance, themeShort: input.themeShort, chainShort: input.chainShort, port: input.port };
    this.ensureSocket();
  }

  stopAdvertisement(): void {
    this.advertisement = null;
  }

  /**
   * Send one mDNS query sweep and resolve with the matching chains seen so
   * far (themeId prefix match only — isolation lives here, R25).
   */
  async browse(themeShort: string, timeoutMs = 1500): Promise<AdvertisedChain[]> {
    this.ensureSocket();
    const mdns = this.mdns as MulticastDNS;
    mdns.query({ questions: [{ name: SERVICE_NAME, type: "PTR" }] });
    await new Promise((resolve) => setTimeout(resolve, timeoutMs));
    return filterMatchingChains([...this.seen.values()], themeShort);
  }

  destroy(): void {
    this.mdns?.removeAllListeners();
    this.mdns?.destroy();
    this.mdns = null;
    this.seen.clear();
    this.advertisement = null;
  }

  private ensureSocket(): void {
    if (this.mdns) {
      return;
    }
    this.mdns = multicastDns();
    this.mdns.on("response", (packet) => {
      const ptr = packet.answers.find(
        (answer): answer is Answer & { type: "PTR"; data: string } =>
          answer.type === "PTR" && answer.name === SERVICE_NAME
      );
      if (!ptr) {
        return;
      }
      const instance = ptr.data;
      const all = [...packet.answers, ...packet.additionals];
      const srv = all.find((record) => record.type === "SRV" && record.name === instance);
      const txt = all.find((record) => record.type === "TXT" && record.name === instance);
      if (!srv || !txt) {
        return;
      }
      const srvData = (srv as unknown as { data: { port: number; host?: string } }).data;
      const fields = parseTxtRecords((txt as unknown as { data: string[] }).data);
      const chain: AdvertisedChain = {
        host: srvData.host && srvData.host.length > 0 ? srvData.host : "0.0.0.0",
        port: srvData.port,
        themeShort: fields.wt ?? "",
        chainShort: fields.cid ?? "",
        version: Number(fields.v ?? "0"),
      };
      if (chain.themeShort && chain.port > 0) {
        this.seen.set(instance, chain);
      }
    });
    this.mdns.on("query", (packet) => {
      const wantsService = packet.questions.some(
        (question) => question.name === SERVICE_NAME && question.type === "PTR"
      );
      if (!wantsService || !this.advertisement || !this.mdns) {
        return;
      }
      const ad = this.advertisement;
      this.mdns.respond({
        answers: [{ name: SERVICE_NAME, type: "PTR", ttl: 120, data: ad.instance }],
        additionals: [
          {
            name: ad.instance,
            type: "SRV",
            ttl: 120,
            data: { port: ad.port, weight: 0, priority: 0, host: hostname() },
          } as unknown as Answer,
          {
            name: ad.instance,
            type: "TXT",
            ttl: 120,
            data: [`wt=${ad.themeShort}`, `cid=${ad.chainShort}`, `v=${DISCOVERY_VERSION}`, `port=${ad.port}`],
          },
        ],
      });
    });
  }
}

export function parseTxtRecords(entries: string[]): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const entry of entries) {
    const eq = entry.indexOf("=");
    if (eq > 0) {
      fields[entry.slice(0, eq)] = entry.slice(eq + 1);
    }
  }
  return fields;
}

// ---------------------------------------------------------------- invite codes

export interface InviteCode {
  host: string;
  port: number;
  themeId: string;
  /** Optional genesis-member signature for `admission: invite` chains. */
  sig?: string;
}

export function buildInviteCode(invite: InviteCode): string {
  const sig = invite.sig ? `?sig=${encodeURIComponent(invite.sig)}` : "";
  return `deeporca-chain://${invite.host}:${invite.port}/${invite.themeId}${sig}`;
}

export function parseInviteCode(code: string): InviteCode | null {
  const match = /^deeporca-chain:\/\/([^/:]+):(\d+)\/([A-Za-z0-9:.]+)(?:\?sig=([^&]+))?$/.exec(code.trim());
  if (!match) {
    return null;
  }
  return {
    host: match[1],
    port: Number(match[2]),
    themeId: match[3],
    ...(match[4] !== undefined ? { sig: decodeURIComponent(match[4]) } : {}),
  };
}
