import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { useI18n } from "../i18n";
import { IconInfo } from "../ui/index";

export type ToastKind = "info" | "success" | "error";
export type Toast = { id: number; kind: ToastKind; text: string };

let nextId = 1;

/**
 * Per-kind auto-dismiss delay. Success/info notices are transient chatter;
 * errors linger longer so they actually get read before vanishing.
 */
const TOAST_DURATION_MS: Record<ToastKind, number> = { info: 3500, success: 3500, error: 6500 };

const TOAST_GLYPH: Record<ToastKind, JSX.Element> = {
  info: <IconInfo />,
  success: <span>✓</span>,
  error: <span>✗</span>,
};

/**
 * Lightweight toast notification hook + renderer. Call `push(kind, text)`
 * to show a transient notification; `dismiss(id)` removes one early (also
 * wired to the ✕ button rendered on every toast); `pause(id)` / `resume(id)`
 * freeze the auto-dismiss clock while the pointer hovers a toast so error
 * text can actually be read.
 */
export function useToasts(): {
  toasts: Toast[];
  push: (kind: ToastKind, text: string) => void;
  dismiss: (id: number) => void;
  pause: (id: number) => void;
  resume: (id: number, durationMs: number) => void;
} {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  // Cancel every pending auto-dismiss timer when the host unmounts so a
  // detached timer can't resurrect state after teardown.
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  const push = useCallback((kind: ToastKind, text: string) => {
    const id = nextId++;
    setToasts((prev) => [...prev.slice(-4), { id, kind, text }]);
    const timer = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
      // Natural expiry must drop the map entry too, or timersRef grows
      // unbounded over a long session (dismiss() cleaned up, expiry didn't).
      timersRef.current.delete(id);
    }, TOAST_DURATION_MS[kind]);
    timersRef.current.set(id, timer);
  }, []);

  /** Freeze the auto-dismiss clock (pointer entered the toast). */
  const pause = useCallback((id: number) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  /** Restart the auto-dismiss clock (pointer left the toast). */
  const resume = useCallback((id: number, durationMs: number) => {
    if (timersRef.current.has(id)) return;
    const timer = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
      timersRef.current.delete(id);
    }, durationMs);
    timersRef.current.set(id, timer);
  }, []);

  return { toasts, push, dismiss, pause, resume };
}

export function ToastContainer({
  toasts,
  onDismiss,
  onPause,
  onResume,
}: {
  toasts: Toast[];
  onDismiss?: (id: number) => void;
  /** Hover interactions: freeze/restart the auto-dismiss clock so error
   *  toasts don't vanish mid-read. */
  onPause?: (id: number) => void;
  onResume?: (id: number, durationMs: number) => void;
}): JSX.Element | null {
  const { t } = useI18n();
  if (toasts.length === 0) return null;
  return (
    <div className="ui-toast-container" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`ui-toast ui-toast--${toast.kind}`}
          onMouseEnter={onPause ? () => onPause(toast.id) : undefined}
          onMouseLeave={onResume ? () => onResume(toast.id, TOAST_DURATION_MS[toast.kind]) : undefined}
        >
          <span className="ui-toast-icon">{TOAST_GLYPH[toast.kind]}</span>
          <span className="ui-toast-text">{toast.text}</span>
          {onDismiss ? (
            <button
              type="button"
              className="ui-toast-close"
              onClick={() => onDismiss(toast.id)}
              aria-label={t("common.close")}
              title={t("common.close")}
            >
              ×
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
