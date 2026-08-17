import * as fs from "fs";
import * as path from "path";
import { createHash } from "node:crypto";

// P1 side-effect audit bus (specs/sandbox/design.md §4.3): every spawn, fs
// mutation and path-gate verdict lands in an append-only JSONL log with a
// SHA-256 hash chain, so tampering with any single record is detectable.
// Deliberately plain: no LZ4/CRC64/page index (that machinery exists for
// object storage; this is a local small file). Core never logs to the
// console — the writer is fail-open and only exposes counters.

export type AuditEventType = "path_gate" | "process_start" | "file_write" | "sandbox_backend";

export type AuditEventCommon = {
  /** Monotonic nanoseconds from process.hrtime.bigint() (string: JSON has no bigint). */
  readonly monotonicNs: string;
  /** Wall clock for cross-reference with other logs. */
  readonly wallClock: string;
  readonly sessionId: string;
  readonly eventType: AuditEventType;
  /** Chain link: checksum of the previous record ("" for the genesis record). */
  readonly prevChecksum: string;
  /** SHA-256 hex over the canonical JSON of this record without `checksum`. */
  readonly checksum: string;
};

export type PathGateAuditEvent = AuditEventCommon & {
  eventType: "path_gate";
  readonly tool: string;
  readonly verdict: "allow" | "deny";
  readonly scope?: string;
  readonly filePath: string;
};

export type ProcessStartAuditEvent = AuditEventCommon & {
  eventType: "process_start";
  readonly command: string;
};

export type FileWriteAuditEvent = AuditEventCommon & {
  eventType: "file_write";
  readonly source: string;
  readonly filePath: string;
};

/** Reserved for the P3 backends (selection, probe failures, degradations). */
export type SandboxBackendAuditEvent = AuditEventCommon & {
  eventType: "sandbox_backend";
  readonly backend: string;
  readonly outcome: string;
  readonly detail?: string;
};

export type AuditEvent = PathGateAuditEvent | ProcessStartAuditEvent | FileWriteAuditEvent | SandboxBackendAuditEvent;

/** Omit must distribute over the union, or only the common keys survive. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export type AuditEventWithoutChecksum = DistributiveOmit<AuditEvent, "checksum">;
/** What a caller supplies per record: the eventType plus its own fields. */
export type AuditEventPayload = DistributiveOmit<
  AuditEvent,
  "monotonicNs" | "wallClock" | "sessionId" | "prevChecksum" | "checksum"
>;

export type AuditChainVerification = {
  ok: boolean;
  /** Number of records verified before the first problem (== total when ok). */
  verifiedCount: number;
  firstBadIndex?: number;
  reason?: string;
};

const MAX_COMMAND_AUDIT_LENGTH = 512;

/** Deterministic serialization: object keys sorted at every level. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

/** SHA-256 hex over the canonical JSON of the record without its checksum. */
export function computeAuditChecksum(eventWithoutChecksum: AuditEventWithoutChecksum): string {
  return createHash("sha256").update(canonicalJson(eventWithoutChecksum), "utf8").digest("hex");
}

export type AuditEventInputs = {
  monotonicNs: bigint;
  wallClock?: string;
  sessionId: string;
  prevChecksum: string;
  payload: AuditEventPayload;
};

/** Build a fully chained record from a payload plus the previous checksum. */
export function buildAuditEvent(inputs: AuditEventInputs): AuditEvent {
  const eventWithoutChecksum = {
    monotonicNs: inputs.monotonicNs.toString(),
    wallClock: inputs.wallClock ?? new Date().toISOString(),
    sessionId: inputs.sessionId,
    prevChecksum: inputs.prevChecksum,
    ...inputs.payload,
  } as AuditEventWithoutChecksum;
  return { ...eventWithoutChecksum, checksum: computeAuditChecksum(eventWithoutChecksum) } as AuditEvent;
}

export function serializeAuditEvent(event: AuditEvent): string {
  return canonicalJson(event);
}

/**
 * Verify the hash chain of parsed records: every checksum must recompute and
 * every prevChecksum must link to the previous record. Returns the index of
 * the first bad record so partial logs (a torn final line after a crash)
 * still report how much of the chain is intact.
 */
export function verifyAuditChain(events: AuditEvent[]): AuditChainVerification {
  let prevChecksum = "";
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (event.prevChecksum !== prevChecksum) {
      return {
        ok: false,
        verifiedCount: index,
        firstBadIndex: index,
        reason: `prevChecksum does not link to record ${index - 1}`,
      };
    }
    const { checksum, ...eventWithoutChecksum } = event;
    if (computeAuditChecksum(eventWithoutChecksum) !== checksum) {
      return { ok: false, verifiedCount: index, firstBadIndex: index, reason: "checksum mismatch" };
    }
    prevChecksum = checksum;
  }
  return { ok: true, verifiedCount: events.length };
}

export function parseAuditLine(line: string): AuditEvent | null {
  try {
    const parsed = JSON.parse(line) as AuditEvent;
    if (!parsed || typeof parsed !== "object" || typeof parsed.checksum !== "string") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function readAuditEvents(filePath: string): AuditEvent[] {
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch {
    return [];
  }
  return content
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => parseAuditLine(line))
    .filter((event): event is AuditEvent => event !== null);
}

function truncateCommand(command: string): string {
  const compact = command.replace(/\s+/g, " ").trim();
  return compact.length > MAX_COMMAND_AUDIT_LENGTH ? `${compact.slice(0, MAX_COMMAND_AUDIT_LENGTH)}…` : compact;
}

/**
 * File-backed append-only writer, one instance per session log. Fail-open by
 * design: an audit failure must never break tool execution — dropped events
 * are counted and the last error is exposed for host telemetry.
 */
export class AuditLog {
  private lastChecksum = "";
  private droppedCount = 0;
  private lastError: string | null = null;

  private constructor(
    private readonly filePath: string,
    private readonly sessionId: string
  ) {}

  static open(filePath: string, sessionId: string): AuditLog {
    const log = new AuditLog(filePath, sessionId);
    const events = readAuditEvents(filePath);
    if (events.length > 0) {
      log.lastChecksum = events[events.length - 1].checksum;
    }
    return log;
  }

  get chainTip(): string {
    return this.lastChecksum;
  }

  get droppedEvents(): number {
    return this.droppedCount;
  }

  get lastFailure(): string | null {
    return this.lastError;
  }

  appendPathGate(record: {
    tool: string;
    verdict: "allow" | "deny";
    scope?: string;
    filePath: string;
  }): AuditEvent | null {
    return this.append({
      eventType: "path_gate",
      tool: record.tool,
      verdict: record.verdict,
      scope: record.scope,
      filePath: record.filePath,
    });
  }

  appendProcessStart(command: string): AuditEvent | null {
    return this.append({ eventType: "process_start", command: truncateCommand(command) });
  }

  appendFileWrite(source: string, filePath: string): AuditEvent | null {
    return this.append({ eventType: "file_write", source, filePath });
  }

  appendSandboxBackend(record: { backend: string; outcome: string; detail?: string }): AuditEvent | null {
    return this.append({
      eventType: "sandbox_backend",
      backend: record.backend,
      outcome: record.outcome,
      detail: record.detail,
    });
  }

  private append(payload: AuditEventPayload): AuditEvent | null {
    try {
      const event = buildAuditEvent({
        monotonicNs: process.hrtime.bigint(),
        sessionId: this.sessionId,
        prevChecksum: this.lastChecksum,
        payload,
      });
      const line = `${serializeAuditEvent(event)}\n`;
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.appendFileSync(this.filePath, line, { encoding: "utf8", mode: 0o600 });
      this.lastChecksum = event.checksum;
      return event;
    } catch (error) {
      this.droppedCount += 1;
      this.lastError = error instanceof Error ? error.message : String(error);
      return null;
    }
  }
}
