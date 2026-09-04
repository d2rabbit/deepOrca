// CoordChainService — desktop main-side lifecycle for the decentralized
// collaboration workspace (OC3 task 12, chain:* IPC backing).
//
// Electron-free by design: it owns the identity anchor, the ChainNode and
// the state queries the renderer asks for. main/index.ts wires the IPC
// channels onto it and forwards ChainStateChanged to the renderer.
//
// Identity rules (hardware-bound, no person tracking):
//   - one identity-anchor.json per machine, sealed to the machine fingerprint;
//   - start() refuses (fail-closed) when the anchor is not bound to THIS
//     machine or the device key is not the anchor's current key;
//   - rotateKey() rotates both the anchor (old key signs the rotation chain)
//     and the chain membership (member.rotate record), then keeps the node
//     signing with the new key.

import {
  AnchorError,
  checkAnchorBinding,
  createIdentityAnchor,
  loadIdentityAnchor,
  rotateAnchorKey,
  saveDeviceIdentity,
  saveIdentityAnchor,
  type DeviceIdentity,
  type IdentityAnchor,
} from "@deeporca/ledger";
import { ChainNode, type ChainNodeStatus } from "./node.js";
import type {
  ChainBlockView,
  ChainGenealogyView,
  ChainMemberView,
  ChainStatePayload,
  ChainStartArgs,
} from "../../shared/ipc.js";
import { deviceKeyPath, coordChainRoot, loadOrCreateDeviceIdentity } from "./paths.js";

export interface ServiceOptions {
  /** Override the data root (~/.deeporca/coordchain default; tests). */
  dataRoot?: string;
  /** Override the machine fingerprint (DEEPORCA_MACHINE_FINGERPRINT also works). */
  machineFingerprint?: string;
  blocksLimit?: number;
}

export interface ServiceEvent {
  type: "started" | "stopped" | "rotated" | "error";
  payload?: ChainStatePayload;
  error?: string;
}

export class CoordChainService {
  private node: ChainNode | null = null;
  private anchor: IdentityAnchor | null = null;
  private identity: DeviceIdentity | null = null;
  private readonly options: Required<Pick<ServiceOptions, "dataRoot" | "machineFingerprint" | "blocksLimit">>;
  private readonly listeners = new Set<(event: ServiceEvent) => void>();

  constructor(options: ServiceOptions = {}) {
    this.options = {
      dataRoot: options.dataRoot ?? coordChainRoot(),
      machineFingerprint: options.machineFingerprint ?? "",
      blocksLimit: options.blocksLimit ?? 50,
    };
  }

  onEvent(listener: (event: ServiceEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: ServiceEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  /** Load-or-create the device anchor and verify it is bound to this machine. */
  ensureAnchor(deviceName: string): IdentityAnchor {
    // The private key lives in the device-key vault; the anchor seals the
    // public history. Anchor creation binds the EXISTING device identity.
    const deviceIdentity = loadOrCreateDeviceIdentity();
    const anchorPath = this.identityAnchorPath();
    let anchor: IdentityAnchor;
    try {
      anchor = loadIdentityAnchor(anchorPath);
    } catch {
      anchor = createIdentityAnchor({
        deviceName,
        identity: deviceIdentity,
        fingerprint: this.options.machineFingerprint || undefined,
      });
      saveIdentityAnchor(anchor, anchorPath);
    }
    if (!anchor.keys[deviceIdentity.keyId]) {
      throw new AnchorError(`device identity ${deviceIdentity.keyId} is not part of the anchor`);
    }
    const binding = checkAnchorBinding(anchor, this.options.machineFingerprint || undefined);
    if (!binding.bound) {
      throw new AnchorError(`identity anchor not bound to this machine: ${binding.reason}`);
    }
    this.anchor = anchor;
    this.identity = deviceIdentity;
    return anchor;
  }

  /** Start the node: anchor-bound identity + theme-anchored chain. */
  async start(args: ChainStartArgs): Promise<{ ok: boolean; error?: string }> {
    try {
      if (this.node) {
        return { ok: false, error: "already running" };
      }
      const anchor = this.ensureAnchor(args.deviceName ?? "deeporca-device");
      const identity = this.identity as DeviceIdentity;
      if (identity.keyId !== anchor.currentKeyId) {
        return {
          ok: false,
          error: `device key ${identity.keyId} is not the anchor's active key ${anchor.currentKeyId}`,
        };
      }
      this.node = new ChainNode({
        identity,
        deviceName: anchor.deviceName,
        theme: args.theme,
        mode: args.mode,
        ...(args.joinUrl ? { joinUrl: args.joinUrl } : {}),
        dataRoot: this.options.dataRoot,
        anchor,
        machineFingerprint: this.options.machineFingerprint || undefined,
        blockIntervalMs: 2000,
      });
      await this.node.start();
      const payload = this.state();
      this.emit({ type: "started", payload });
      return { ok: true };
    } catch (error) {
      // A failed start must not leave a half-initialized node behind (its
      // transport/timer would keep running with no chain attached).
      if (this.node) {
        await this.node.stop().catch(() => undefined);
        this.node = null;
      }
      const message = (error as Error).message;
      this.emit({ type: "error", error: message });
      return { ok: false, error: message };
    }
  }

  async stop(): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.node?.stop();
      this.node = null;
      const payload = this.state();
      this.emit({ type: "stopped", payload });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  }

  /**
   * Rotate the device signing key: chain member.rotate (old key signs) +
   * anchor rotation chain + local key switch. The node keeps signing with
   * the new key immediately.
   */
  rotateKey(): { ok: boolean; error?: string; newKeyId?: string } {
    try {
      if (!this.node || !this.anchor || !this.identity) {
        return { ok: false, error: "chain not running" };
      }
      const { newIdentity } = this.node.rotateDeviceKey();
      const rotated = rotateAnchorKey(this.anchor, this.identity, { next: newIdentity });
      saveIdentityAnchor(rotated.anchor, this.identityAnchorPath());
      // The private key vault follows the rotation — the OLD key is retired.
      saveDeviceIdentity(newIdentity, deviceKeyPath());
      this.anchor = rotated.anchor;
      this.identity = newIdentity;
      const payload = this.state();
      this.emit({ type: "rotated", payload });
      return { ok: true, newKeyId: newIdentity.keyId };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  }

  state(): ChainStatePayload {
    const node = this.node;
    const anchor = this.anchor;
    let status: ChainNodeStatus | null = null;
    if (node) {
      try {
        status = node.status();
      } catch {
        // Node torn down mid-query — report idle.
      }
    }
    const running = Boolean(node && status);
    return {
      running,
      chainId: status?.chainId ?? "",
      theme: status?.theme ?? "",
      themeId: status?.themeId ?? "",
      height: status?.height ?? -1,
      memberCount: status?.memberCount ?? 0,
      peerCount: status?.peerCount ?? 0,
      pendingRecords: status?.pendingRecords ?? 0,
      port: status?.port ?? 0,
      anchorId: anchor?.anchorId ?? "",
      deviceName: anchor?.deviceName ?? "",
      anchorBound: anchor ? checkAnchorBinding(anchor, this.options.machineFingerprint || undefined).bound : false,
      version: anchor?.version ?? 0,
    };
  }

  members(): ChainMemberView[] {
    const node = this.node;
    if (!node) {
      return [];
    }
    const rows = node.ledgerView?.listMembers() ?? [];
    return rows.map((row) => ({
      keyId: row.key_id,
      deviceName: row.device_name,
      joinedHeight: row.joined_height,
      leftHeight: row.left_height,
      current: this.identity?.keyId === row.key_id,
    }));
  }

  blocks(limit?: number): ChainBlockView[] {
    const node = this.node;
    if (!node) {
      return [];
    }
    return node.blocksView(limit ?? this.options.blocksLimit).map((row) => ({
      height: row.height,
      hash: row.hash,
      proposer: row.proposer,
      ts: row.ts,
      recordCount: row.recordCount,
      approvedBy: row.approvedBy,
    }));
  }

  genealogy(): ChainGenealogyView[] {
    const node = this.node;
    if (!node) {
      return [];
    }
    return node.taskGenealogy().map((task) => ({
      recordId: task.recordId,
      parentRecordId: task.parentRecordId ?? null,
      title: task.title,
      conclusion: task.conclusion,
      author: task.author,
      ts: task.ts,
    }));
  }

  private identityAnchorPath(): string {
    return deviceKeyPath().replace(/device-key\.json$/, "identity-anchor.json");
  }
}
