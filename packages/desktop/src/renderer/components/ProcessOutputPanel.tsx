import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";
import { api } from "../api";
import type { SerializableProcess } from "../../shared/ipc";
import { useI18n } from "../i18n";

const BASH_TIMEOUT_INCREMENT_MS = 5 * 60 * 1000;
const BASH_TIMEOUT_DECREMENT_MS = 60 * 1000;
const REFRESH_INTERVAL_MS = 150;
const MAX_STDOUT_BUFFER = 1_000_000;

type ProcessOutputPanelProps = {
  processes: SerializableProcess[];
  stdoutRef: React.RefObject<Map<number, string>>;
  onDismiss: () => void;
  /** Host platform ("darwin"/"win32"/"linux") — shortcut glyphs in tooltips. */
  platform?: string;
};

export function ProcessOutputPanel({
  processes,
  stdoutRef,
  onDismiss,
  platform,
}: ProcessOutputPanelProps): JSX.Element {
  const { t } = useI18n();
  const [stdoutText, setStdoutText] = useState("");
  const [scrollOffset, setScrollOffset] = useState(0);
  const [statusMessage, setStatusMessage] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Poll stdout buffer at high frequency for live feel
  useEffect(() => {
    const updateStdout = () => {
      let text = "";
      if (processes.length > 0) {
        for (const proc of processes) {
          const pidNum = Number(proc.pid);
          const stdout = stdoutRef.current?.get(pidNum) ?? "";
          if (text) text += "\n";
          if (processes.length > 1) {
            text += `${t("process.processHeader", { pid: proc.pid, command: proc.command })}\n`;
          }
          text += stdout || t("process.noOutput");
        }
      } else {
        text = t("process.noProcesses");
      }
      setStdoutText(text);
    };

    updateStdout();
    const interval = setInterval(updateStdout, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [processes, stdoutRef, t]);

  // Auto-scroll to bottom when new content arrives (unless user scrolled up)
  useEffect(() => {
    if (scrollOffset === 0 && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [stdoutText, scrollOffset]);

  useEffect(() => {
    return () => {
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    };
  }, []);

  const lines = useMemo(() => stdoutText.split("\n"), [stdoutText]);

  const timeoutProcess = useMemo(() => {
    for (const proc of processes) {
      if (typeof proc.timeoutMs === "number") return proc;
    }
    return null;
  }, [processes]);

  const setTemporaryStatus = useCallback((message: string) => {
    setStatusMessage(message);
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    statusTimerRef.current = setTimeout(() => setStatusMessage(""), 2500);
  }, []);

  const handleAdjustTimeout = useCallback(
    async (deltaMs: number) => {
      const result = await api.adjustBashTimeout(deltaMs);
      if (result) {
        const minutes = Math.max(1, Math.round(result.timeoutMs / 60000));
        setTemporaryStatus(`${t("process.timeoutSet")} ${minutes}m`);
      } else {
        setTemporaryStatus(t("process.noAdjustable"));
      }
    },
    [setTemporaryStatus, t]
  );

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
    setScrollOffset(atBottom ? 0 : 1);
  }, []);

  const formatTimeout = (ms?: number): string => {
    if (typeof ms !== "number") return "—";
    return `${Math.max(1, Math.round(ms / 60000))}m`;
  };

  return (
    <div className="ui-process-panel">
      <div className="ui-process-panel-head">
        <span className="ui-process-panel-title">
          {processes.length > 0 ? <span className="ui-process-running-dot" /> : null}
          {t("process.title")}
        </span>
        <span className="ui-process-panel-meta">
          {timeoutProcess
            ? `${t("process.timeout")} ${formatTimeout(timeoutProcess.timeoutMs)}`
            : t("process.noTimeout")}
          {" · "}
          {processes.length} {t("process.running")}
        </span>
        <span className="ui-process-panel-actions">
          <button
            className="ui-process-btn"
            onClick={() => {
              stdoutRef.current?.clear();
              setStdoutText("");
              setTemporaryStatus(t("process.cleared"));
            }}
            title={t("process.clear")}
          >
            ⌫
          </button>
          <button
            className="ui-process-btn"
            onClick={() => void handleAdjustTimeout(BASH_TIMEOUT_INCREMENT_MS)}
            title="+5m"
          >
            +
          </button>
          <button
            className="ui-process-btn"
            onClick={() => void handleAdjustTimeout(-BASH_TIMEOUT_DECREMENT_MS)}
            title="-1m"
          >
            −
          </button>
          {/* Single global stop: interrupt kills the WHOLE agent turn (there is
              no per-PID channel), so one clearly-labelled button replaces the
              old per-card ■ that implied single-process control. */}
          <button
            className="ui-process-btn ui-process-btn-stop"
            onClick={() => void api.interrupt()}
            title={t("process.stopAll")}
          >
            ■
          </button>
          <button
            className="ui-process-btn ui-process-btn-close"
            onClick={onDismiss}
            title={`${platform === "darwin" ? "⌘" : "Ctrl"}J / Esc`}
          >
            ✕
          </button>
        </span>
      </div>
      {/* Per-process status cards (info only — stopping is global, above) */}
      {processes.length > 0 ? (
        <div className="ui-process-cards">
          {processes.map((proc) => (
            <div key={proc.pid} className="ui-process-card">
              <span className="ui-process-card-dot" />
              <span className="ui-process-card-pid">
                {t("process.pidLabel")} {proc.pid}
              </span>
              <span className="ui-process-card-cmd ui-mono">{proc.command}</span>
              {proc.deadlineAt ? (
                <span className="ui-process-card-deadline">
                  ⏱ {new Date(proc.deadlineAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      <div className="ui-process-panel-body" ref={containerRef} onScroll={handleScroll}>
        {lines.map((line, i) => (
          <div key={i} className="ui-process-line">
            <span className="ui-process-line-no">{i + 1}</span>
            <span className="ui-process-line-text">{line}</span>
          </div>
        ))}
      </div>
      {statusMessage ? <div className="ui-process-panel-status">{statusMessage}</div> : null}
    </div>
  );
}

/** Accumulate process stdout chunks into a ref map (called from App). */
export function accumulateStdout(map: Map<number, string>, pid: number, chunk: string): void {
  const current = map.get(pid) ?? "";
  if (current.length >= MAX_STDOUT_BUFFER) return;
  const available = MAX_STDOUT_BUFFER - current.length;
  map.set(pid, current + chunk.slice(0, available));
}
