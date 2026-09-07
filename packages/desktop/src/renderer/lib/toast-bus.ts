export type DesignToastKind = "info" | "success" | "error";

type Listener = (kind: DesignToastKind, text: string) => void;

let listener: Listener | null = null;

/**
 * Module-level toast bus so design-workspace components (rendered deep inside
 * lazy surfaces) can surface feedback through App's single toast container
 * without prop-drilling through App.tsx. App's `useToasts` subscribes once.
 */
export function pushDesignToast(kind: DesignToastKind, text: string): void {
  listener?.(kind, text);
}

export function subscribeDesignToasts(callback: Listener): () => void {
  listener = callback;
  return () => {
    if (listener === callback) listener = null;
  };
}
