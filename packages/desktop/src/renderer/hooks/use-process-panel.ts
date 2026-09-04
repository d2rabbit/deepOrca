import { useCallback, useRef, useState } from "react";
import type { SerializableProcess, SerializableSessionEntry } from "../../shared/ipc";

/**
 * Running bash processes and their buffered stdout.
 *
 * Tracking only — the auto-popping "进程输出" dock panel was removed
 * (user ask 2026-09-03: 没有要过这个面板; it popped itself open on any
 * running process and then lingered as an empty "0 运行中" slab after the
 * process ended). The running-process count still feeds the composer's
 * loading line; raw stdout stays buffered here in case a future surface
 * wants it. `syncFromEntry` keeps the stdout-buffer GC — without that, the
 * Map retains up to 1MB per dead PID for the app lifetime.
 */

/** Per-PID stdout cap — bounded so a chatty process can't balloon memory. */
const MAX_STDOUT_BUFFER = 1_000_000;

export type ProcessPanelState = {
  runningProcesses: SerializableProcess[];
  stdoutRef: React.RefObject<Map<number, string>>;
  syncFromEntry: (entry: SerializableSessionEntry) => void;
  appendStdout: (pid: number, chunk: string) => void;
};

/** Accumulate process stdout chunks into a ref map (bounded per PID). */
function accumulateStdout(map: Map<number, string>, pid: number, chunk: string): void {
  const current = map.get(pid) ?? "";
  if (current.length >= MAX_STDOUT_BUFFER) return;
  const available = MAX_STDOUT_BUFFER - current.length;
  map.set(pid, current + chunk.slice(0, available));
}

export function useProcessPanel(): ProcessPanelState {
  const [runningProcesses, setRunningProcesses] = useState<SerializableProcess[]>([]);
  const stdoutRef = useRef<Map<number, string>>(new Map());

  const syncFromEntry = useCallback((entry: SerializableSessionEntry) => {
    setRunningProcesses(entry.processes ?? []);
    // Clean up stdout buffers for processes that are no longer running.
    // Without this, the Map retains up to 1MB per dead PID for the app lifetime.
    const newPids = new Set((entry.processes ?? []).map((p) => Number(p.pid)));
    for (const pid of stdoutRef.current.keys()) {
      if (!newPids.has(pid)) {
        stdoutRef.current.delete(pid);
      }
    }
  }, []);

  const appendStdout = useCallback((pid: number, chunk: string) => {
    accumulateStdout(stdoutRef.current, pid, chunk);
  }, []);

  return { runningProcesses, stdoutRef, syncFromEntry, appendStdout };
}
