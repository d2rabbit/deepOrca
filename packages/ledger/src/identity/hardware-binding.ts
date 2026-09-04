// Hardware binding for the identity anchor (hardware-bound identity).
//
// The anchor's identity is a DEVICE, not a person: the anchor is sealed to
// one machine and refuses to sign anywhere else. The v1 binding is a machine
// FINGERPRINT seal (weak binding: defeats accidental copy / cloud-sync /
// migration, does NOT defend against someone deliberately faking the OS
// machine-id — the strong Secure Enclave / TPM binding is the OC4 path).
//
// Fingerprint sources (hashed before use — the raw id never touches disk):
//   darwin  IOPlatformUUID via `ioreg -rd1 -c IOPlatformExpertDevice`
//   win32   MachineGuid via `reg query HKLM\SOFTWARE\Microsoft\Cryptography`
//   linux   /etc/machine-id (fallback /var/lib/dbus/machine-id)
//
// DEEPORCA_MACHINE_FINGERPRINT overrides collection (tests, CI, unusual
// setups). If collection fails and no override is set, machineFingerprintHash
// is null — the anchor layer treats "no fingerprint available" as unsealable
// (fail-closed: no seal → no bound identity).

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

/** SHA-256 hex of the raw machine identifier — the only form that is stored. */
export function fingerprintHash(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

export function machineFingerprintHash(): string | null {
  const injected = process.env.DEEPORCA_MACHINE_FINGERPRINT;
  if (injected !== undefined && injected.length > 0) {
    return fingerprintHash(injected);
  }
  if (injected === "") {
    // Explicitly empty = fingerprint collection disabled (tests, CI).
    return null;
  }
  const raw = collectRawFingerprint();
  return raw ? fingerprintHash(raw) : null;
}

/** Collect the raw machine identifier for the current platform. */
export function collectRawFingerprint(): string | null {
  const platform = process.platform;
  if (platform === "darwin") {
    const result = spawnSync("ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"], { encoding: "utf8" });
    if (result.status !== 0) {
      return null;
    }
    return parseIoRegistryUuid(result.stdout ?? "");
  }
  if (platform === "win32") {
    const result = spawnSync("reg", ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"], {
      encoding: "utf8",
    });
    if (result.status !== 0) {
      return null;
    }
    return parseMachineGuid(result.stdout ?? "");
  }
  // Assume POSIX: /etc/machine-id first, then the dbus fallback.
  for (const path of ["/etc/machine-id", "/var/lib/dbus/machine-id"]) {
    if (existsSync(path)) {
      try {
        const value = readFileSync(path, "utf8").trim();
        if (/^[0-9a-fA-F]+$/.test(value)) {
          return value;
        }
      } catch {
        // fall through to the next source
      }
    }
  }
  return null;
}

/** Parse `"IOPlatformUUID" = "…"` out of ioreg output (pure, unit-tested). */
export function parseIoRegistryUuid(ioregOutput: string): string | null {
  const match = /IOPlatformUUID"?\s*=\s*"([^"]+)"/.exec(ioregOutput);
  return match ? match[1] : null;
}

/** Parse MachineGuid out of `reg query` output (pure, unit-tested). */
export function parseMachineGuid(regOutput: string): string | null {
  const match = /MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]+)/.exec(regOutput);
  return match ? match[1] : null;
}
