// Toast layer (E5.3, 设计稿「toast 落档」双通道): the notification archive is
// the durable channel; toasts are its ephemeral twin — top-right, 3.5s,
// capped at 5 so bursts can't flood the screen. Same event source, two views.
import { useCallback, useRef, useState, type JSX } from "react";

export type DeckToastKind = "info" | "ok" | "warn" | "bad";

export type DeckToast = {
  id: number;
  text: string;
  kind: DeckToastKind;
};

const MAX_TOASTS = 5;
const TOAST_TTL_MS = 3500;

export function useDeckToasts(): {
  toasts: DeckToast[];
  push(text: string, kind?: DeckToastKind): void;
} {
  const [toasts, setToasts] = useState<DeckToast[]>([]);
  const nextId = useRef(1);

  const push = useCallback((text: string, kind: DeckToastKind = "info") => {
    const id = nextId.current++;
    setToasts((prev) => {
      const next = [...prev, { id, text, kind }];
      return next.length > MAX_TOASTS ? next.slice(next.length - MAX_TOASTS) : next;
    });
    setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, TOAST_TTL_MS);
  }, []);

  return { toasts, push };
}

const KIND_ICON: Record<DeckToastKind, string> = {
  info: "◈",
  ok: "✓",
  warn: "⚠",
  bad: "✕",
};

export function DeckToasts(props: { toasts: DeckToast[] }): JSX.Element | null {
  if (props.toasts.length === 0) return null;
  return (
    <div className="deck-toasts">
      {props.toasts.map((toast) => (
        <div key={toast.id} className={`deck-toast deck-gc ${toast.kind}`} role="status">
          <span className="ic">{KIND_ICON[toast.kind]}</span>
          <span>{toast.text}</span>
        </div>
      ))}
    </div>
  );
}
