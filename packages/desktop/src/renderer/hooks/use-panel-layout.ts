import { useCallback, useRef, useState } from "react";

/** The nine views the VSCode-style activity rail can select. */
export type SidebarView =
  | "explorer"
  | "scm"
  | "tasks"
  | "tokens"
  | "index"
  | "review"
  | "gitmcp"
  | "plugins"
  | "editor";

/**
 * Left panel: which view is showing, whether it is open, and its width.
 *
 * Extracted from App.tsx verbatim. `setPanelOpen` is returned raw because the
 * global-shortcut effect and the command palette toggle it directly, and the
 * `[]`-dep callbacks are kept `[]` because they are passed to React.memo children.
 */
export type PanelLayout = {
  sidebarView: SidebarView;
  setSidebarView: React.Dispatch<React.SetStateAction<SidebarView>>;
  panelOpen: boolean;
  setPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  panelWidth: number;
  handleResizeStart: (e: React.MouseEvent) => void;
  /** Selecting the active view again toggles the panel. */
  selectView: (view: SidebarView) => void;
  openTokensView: () => void;
  handleCollapsePanel: () => void;
};

export function usePanelLayout(): PanelLayout {
  const [sidebarView, setSidebarView] = useState<SidebarView>("explorer");
  const [panelOpen, setPanelOpen] = useState(true);
  const [panelWidth, setPanelWidth] = useState(280);

  // ── Panel resize handle ──────────────────────────────────────────────────────
  const resizingRef = useRef(false);
  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      resizingRef.current = true;
      const startX = e.clientX;
      const startWidth = panelWidth;
      const onMove = (ev: MouseEvent) => {
        if (!resizingRef.current) return;
        const delta = ev.clientX - startX;
        setPanelWidth(Math.max(200, Math.min(480, startWidth + delta)));
      };
      const onUp = () => {
        resizingRef.current = false;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [panelWidth]
  );

  // VSCode-style activity bar: selecting a rail view swaps the left panel while
  // the main area stays put. Re-selecting the active view toggles the panel.
  const selectView = useCallback((view: SidebarView) => {
    setSidebarView((prev) => {
      if (prev === view) {
        setPanelOpen((wasOpen) => !wasOpen);
        return view;
      }
      setPanelOpen(true);
      return view;
    });
  }, []);
  const openTokensView = useCallback(() => selectView("tokens"), [selectView]);
  const handleCollapsePanel = useCallback(() => setPanelOpen(false), []);

  return {
    sidebarView,
    setSidebarView,
    panelOpen,
    setPanelOpen,
    panelWidth,
    handleResizeStart,
    selectView,
    openTokensView,
    handleCollapsePanel,
  };
}
