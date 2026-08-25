import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { useI18n } from "../i18n";

export type ToastKind = "info" | "success" | "error";
export type Toast = { id: number; kind: ToastKind; text: string };

let nextId = 1;

/**
 * Per-kind auto-dismiss delay. Success/info notices are transient chatter;
 * errors linger longer so they actually get read before vanishing.
 */
const TOAST_DURATION_MS: Record<ToastKind, number> = { info: 3500, success: 3500, error: 6500 };

const TOAST_GLYPH: Record<ToastKind, string> = { info: "ℹ", success: "✓", error: "✗" };

/**
 * Lightweight toast notification hook + renderer. Call `push(kind, text)`
 * to show a transient notification; `dismiss(id)` removes one early (also
 * wired to the ✕ button rendered on every toast).
 */
export function useToasts(): {
  toasts: Toast[];
  push: (kind: ToastKind, text: string) => void;
  dismiss: (id: number) => void;
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
      timersRef.current.delete(id);
    }, TOAST_DURATION_MS[kind]);
    timersRef.current.set(id, timer);
  }, []);

  return { toasts, push, dismiss };
}

export function ToastContainer({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss?: (id: number) => void;
}): JSX.Element | null {
  const { t } = useI18n();
  if (toasts.length === 0) return null;
  return (
    <div className="ui-toast-container">
      {toasts.map((toast) => (
        <div key={toast.id} className={`ui-toast ui-toast--${toast.kind}`}>
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
