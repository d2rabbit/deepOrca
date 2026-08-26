import { useCallback, useEffect, useRef, useState } from "react";

/** The views the hub sheet (floating island) can select. */
export type SidebarView =
  | "explorer"
  | "scm"
  | "tasks"
  | "tokens"
  | "index"
  | "review"
  | "prototype"
  | "design"
  | "tasktree"
  | "gitmcp"
  | "plugins"
  | "editor";

const VIEW_KEYS: SidebarView[] = [
  "explorer",
  "scm",
  "tasks",
  "tokens",
  "index",
  "review",
  "prototype",
  "design",
  "tasktree",
  "gitmcp",
  "plugins",
  "editor",
];

/** localStorage may be absent (tests, hardened contexts) — never let chrome
 *  persistence break the layout hook; fall back to the default silently. */
function readStorage(key: string): string | null {
  try {
    return window.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}
function writeStorage(key: string, value: string): void {
  try {
    window.localStorage?.setItem(key, value);
  } catch {
    // Persistence is best-effort chrome state — ignore quota/security errors.
  }
}

const W_KEY = "deeporca.hub.width";
const V_KEY = "deeporca.hub.view";

function loadWidth(): number {
  const raw = Number(readStorage(W_KEY));
  return Number.isFinite(raw) && raw >= 200 && raw <= 480 ? raw : 320;
}
function loadView(): SidebarView {
  const raw = readStorage(V_KEY);
  return VIEW_KEYS.includes(raw as SidebarView) ? (raw as SidebarView) : "explorer";
}

/**
 * Left hub sheet: which view is showing, whether it is open, and its width.
 *
 * Hub chrome state (width + last view) persists across launches via
 * localStorage — resize once, it stays resized. `setPanelOpen` is returned
 * raw because the global-shortcut effect and the command palette toggle it
 * directly, and the `[]`-dep callbacks are kept `[]` because they are passed
 * to React.memo children.
 */
export type PanelLayout = {
  sidebarView: SidebarView;
  setSidebarView: React.Dispatch<React.SetStateAction<SidebarView>>;
  panelOpen: boolean;
  setPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  panelWidth: number;
  handleResizeStart: (e: React.MouseEvent) => void;
  /** Selecting the active view again toggles the hub. */
  selectView: (view: SidebarView) => void;
  openTokensView: () => void;
  handleCollapsePanel: () => void;
};

export function usePanelLayout(): PanelLayout {
  const [sidebarView, setSidebarView] = useState<SidebarView>(loadView);
  const [panelOpen, setPanelOpen] = useState(true);
  // 320 default (was 280): the hub island's 4-column launcher tile grid needs
  // the extra room so CJK tile labels don't ellipsize on first open.
  const [panelWidth, setPanelWidth] = useState<number>(loadWidth);

  // Remember the last hub view — reopening the hub (or relaunching the app)
  // lands where the user left off instead of always resetting to sessions.
  useEffect(() => {
    writeStorage(V_KEY, sidebarView);
  }, [sidebarView]);

  // ── Hub sheet resize (right edge) ───────────────────────────────────────────
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
        // Persist the committed width (not every mousemove).
        setPanelWidth((w) => {
          writeStorage(W_KEY, String(w));
          return w;
        });
      };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [panelWidth]
  );

  // Hub tiles: selecting a tile swaps the sheet's view; re-selecting the
  // active tile toggles the hub (same semantics as the old rail).
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
