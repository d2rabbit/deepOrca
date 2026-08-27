import { useEffect } from "react";

/**
 * Reflect session state in the window title so the user can see progress even
 * when the app is in the background (taskbar / dock tooltip).
 *
 * Extracted from App.tsx verbatim; owns no state, reads its inputs as arguments.
 */
export function useDocumentTitle(busy: boolean, activeStatus: string | null): void {
  useEffect(() => {
    const base = "DeepOrca";
    if (busy) {
      document.title = `[busy] ${base}`;
    } else if (activeStatus === "ask_permission" || activeStatus === "waiting_for_user") {
      document.title = `[warn] ${base}`;
    } else if (activeStatus === "error") {
      document.title = `[error] ${base}`;
    } else {
      document.title = base;
    }
  }, [busy, activeStatus]);
}
