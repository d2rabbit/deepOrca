import { useCallback, useEffect, useRef, useState } from "react";
import { accumulateStdout } from "../components/ProcessOutputPanel";
import type { SerializableProcess, SerializableSessionEntry } from "../../shared/ipc";

/**
 * Running bash processes and their buffered stdout.
 *
 * Extracted from App.tsx verbatim. `syncFromEntry` is the block that lived inline
 * in the boot effect's onSessionEntryUpdated handler, including the stdout-buffer
 * GC — without that, the Map retains up to 1MB per dead PID for the app lifetime.
 */
export type ProcessPanelState = {
  showProcessPanel: boolean;
  /** Returned raw — toggled by the shortcut effect and the command palette. */
  setShowProcessPanel: React.Dispatch<React.SetStateAction<boolean>>;
  runningProcesses: SerializableProcess[];
  stdoutRef: React.RefObject<Map<number, string>>;
  syncFromEntry: (entry: SerializableSessionEntry) => void;
  appendStdout: (pid: number, chunk: string) => void;
};

export function useProcessPanel(busy: boolean): ProcessPanelState {
  const [showProcessPanel, setShowProcessPanel] = useState(false);
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

  // Auto-show process panel when processes start running.
  useEffect(() => {
    if (runningProcesses.length > 0 && busy) {
      setShowProcessPanel(true);
    }
  }, [runningProcesses, busy]);

  return { showProcessPanel, setShowProcessPanel, runningProcesses, stdoutRef, syncFromEntry, appendStdout };
}
