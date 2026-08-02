/**
 * TaskProgressPanel — unified progress display for long-running tasks.
 *
 * Subscribes to ALL *Progress IPC events (codegraph, CRG, wiki, review)
 * and shows a compact progress card per active task. Extracts percentage
 * from text output (NN% pattern) and displays a progress bar.
 *
 * Mounted at the bottom of the main view, alongside ProcessOutputPanel.
 */

import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { api } from "../api";
import type {
  CodegraphProgressEvent,
  CrgProgressEvent,
  WikiProgressEvent,
  ReviewProgressEvent,
} from "../../shared/ipc";

type TaskState = {
  key: string;
  label: string;
  root?: string;
  percent: number;
  lastLine: string;
  done: boolean;
  doneAt?: number;
};

const FADE_DELAY_MS = 3000;

export function TaskProgressPanel(): JSX.Element | null {
  const [tasks, setTasks] = useState<Map<string, TaskState>>(new Map());
  const fadeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const updateTask = useCallback((key: string, label: string, chunk: string, root?: string) => {
    setTasks((prev) => {
      const next = new Map(prev);
      const existing = next.get(key);
      const percent = extractPercent(chunk) ?? existing?.percent ?? 0;
      const done = chunk.includes("done") || chunk.includes("complete") || chunk.includes("✅") || percent >= 100;
      next.set(key, {
        key,
        label,
        root,
        percent,
        lastLine: chunk.trim().split("\n").pop() ?? "",
        done: done || existing?.done === true,
        doneAt: done ? Date.now() : existing?.doneAt,
      });
      return next;
    });
  }, []);

  // Subscribe to all progress events.
  useEffect(() => {
    const offs: Array<() => void> = [];

    offs.push(
      api.onCodegraphProgress((e: CodegraphProgressEvent) => {
        if (e.done) {
          markDone(setTasks, `codegraph:${e.root ?? ""}`);
        } else {
          updateTask(`codegraph:${e.root ?? ""}`, "CodeGraph", e.chunk, e.root);
        }
      })
    );
    offs.push(
      api.onCrgProgress((e: CrgProgressEvent) => {
        if (e.done) {
          markDone(setTasks, `crg:${e.root ?? ""}`);
        } else {
          updateTask(`crg:${e.root ?? ""}`, "CRG", e.chunk, e.root);
        }
      })
    );
    offs.push(
      api.onWikiProgress((e: WikiProgressEvent) => {
        if (e.done) {
          markDone(setTasks, `wiki`);
        } else {
          updateTask(`wiki`, "Wiki", e.chunk);
        }
      })
    );
    offs.push(
      api.onReviewProgress((e: ReviewProgressEvent) => {
        if (e.done) {
          markDone(setTasks, `review`);
        } else {
          updateTask(`review`, "Code Review", e.chunk);
        }
      })
    );

    return () => offs.forEach((off) => off());
  }, [updateTask]);

  // Fade out completed tasks.
  useEffect(() => {
    fadeTimerRef.current = setInterval(() => {
      setTasks((prev) => {
        const now = Date.now();
        let changed = false;
        const next = new Map(prev);
        for (const [key, task] of next) {
          if (task.done && task.doneAt && now - task.doneAt > FADE_DELAY_MS) {
            next.delete(key);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 1000);
    return () => {
      if (fadeTimerRef.current) clearInterval(fadeTimerRef.current);
    };
  }, []);

  const activeTasks = Array.from(tasks.values());
  if (activeTasks.length === 0) return null;

  return (
    <div className="ui-task-progress-panel">
      {activeTasks.map((task) => (
        <div key={task.key} className={`ui-task-progress-item${task.done ? " done" : ""}`}>
          <div className="ui-task-progress-header">
            <span className={`ui-task-progress-dot${task.done ? " done" : ""}`} />
            <span className="ui-task-progress-label">{task.label}</span>
            {task.root ? <span className="ui-task-progress-root">{task.root.split("/").pop()}</span> : null}
            <span className="ui-task-progress-percent">{task.percent}%</span>
          </div>
          <div className="ui-task-progress-bar">
            <div className="ui-task-progress-fill" style={{ width: `${task.percent}%` }} />
          </div>
          {!task.done && task.lastLine ? <div className="ui-task-progress-line">{task.lastLine}</div> : null}
        </div>
      ))}
    </div>
  );
}

/** Extract a percentage from text output (e.g. "Indexing... 45%"). */
function extractPercent(text: string): number | null {
  const match = text.match(/(\d{1,3})%/);
  if (match) {
    const pct = parseInt(match[1]!, 10);
    return Math.min(100, Math.max(0, pct));
  }
  return null;
}

/** Mark a task as done. */
function markDone(setTasks: React.Dispatch<React.SetStateAction<Map<string, TaskState>>>, key: string): void {
  setTasks((prev) => {
    const existing = prev.get(key);
    if (!existing) return prev;
    const next = new Map(prev);
    next.set(key, { ...existing, done: true, doneAt: Date.now(), percent: 100 });
    return next;
  });
}
