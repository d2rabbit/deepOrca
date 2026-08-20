// Orca Deck — root component (E1 core loop + E2 functional layer + E3
// overlay stack).
//
// Shell: goal band (real goal + plan progress + escape hatch), left-edge
// module dock, work-order stage, and the unified overlay stack — every
// floating surface lives in one ordered stack (drawers < panels < command
// layer / workshop wall), Esc closes the topmost layer, ⌘⇧Esc clears it.
// ⌘K opens the command layer; theme state hot-swaps data-deck-theme.
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";
import { useI18n, type MessageKey } from "../i18n";
import { useDeckEngine } from "./hooks/use-deck-engine";
import { useDeckEvents } from "./hooks/use-deck-events";
import { useDeckNotifications } from "./hooks/use-deck-notifications";
import { useDeckToasts, DeckToasts } from "./hooks/use-deck-toasts";
import { useWorkOrder } from "./hooks/use-work-order";
import { persistDeckTheme, resolveDeckTheme, type DeckTheme } from "./lib/appearance";
import { popLayer, pushLayer, drawerSide, isDrawerKind, type LayerKind, type OverlayLayer } from "./lib/overlay-stack";
import type { DeckCommandContext } from "./lib/command-registry";
import type { OverlayKind } from "./types";
import { GoalBand } from "./components/goal-band";
import { DeckDock } from "./components/dock";
import { DeckStage } from "./components/stage";
import { DeckTape } from "./components/tape";
import { ControlCenter } from "./components/control-center";
import { DeckOverlay } from "./components/overlay";
import { CommandLayer } from "./components/command-layer";
import { NotificationsPanel } from "./components/notifications";
import { ThemeSwatches } from "./components/theme-panel";
import { DeckSettingsPanel } from "./components/settings-panel";
import { ShortcutsPanel } from "./components/shortcuts-panel";
import { EditorPanel } from "./components/editor-panel";
import { DiffPanel, type DeckDiffTarget } from "./components/diff-panel";
import { DrawerShell } from "./components/drawer";
import { OnboardingModal, useDeckOnboarding } from "./components/onboarding";
import { DraftPanel } from "./components/draft-panel";
import { extractPlanSteps } from "./components/step-board";
import { FloorPanel, CheckpointsPanel, LedgerPanel, TreePanel } from "./components/session-panels";
import { FilesPanel, ChangesPanel, ProcessesPanel } from "./components/workspace-panels";
import { SourcesPanel, PluginsPanel, ReviewPanel, AssetsPanel } from "./components/module-panels";

const OVERLAY_TITLES: Record<OverlayKind, MessageKey> = {
  tape: "deck.dock.tape",
  "control-center": "deck.cc.title",
  notifications: "deck.dock.notifications",
  theme: "deck.dock.theme",
  settings: "deck.dock.settings",
  files: "deck.dock.files",
  changes: "deck.dock.changes",
  processes: "deck.dock.processes",
  assets: "deck.dock.assets",
  review: "deck.dock.review",
  sources: "deck.dock.sources",
  ledger: "deck.dock.ledger",
  tree: "deck.dock.tree",
  plugins: "deck.dock.plugins",
  checkpoints: "deck.dock.checkpoints",
  editor: "deck.dock.editor",
  shortcuts: "deck.dock.shortcuts",
  floor: "deck.dock.floor",
  diff: "deck.changes.diff",
  draft: "deck.dock.newGoal",
};

const WIDE_OVERLAYS = new Set<OverlayKind>(["tape", "floor", "ledger", "editor", "diff"]);

/** Control-center docked state (E6.5) — open by default, collapse persists. */
const CC_STATE_KEY = "deeporca.deck.cc";

function resolveCcOpen(): boolean {
  try {
    return localStorage.getItem(CC_STATE_KEY) !== "1";
  } catch {
    return true;
  }
}

function persistCcOpen(open: boolean): void {
  try {
    localStorage.setItem(CC_STATE_KEY, open ? "0" : "1");
  } catch {
    // Best-effort persistence.
  }
}

export function DeckApp(): JSX.Element {
  const { t } = useI18n();
  const engine = useDeckEngine();
  const events = useDeckEvents();
  const toasts = useDeckToasts();
  const notifications = useDeckNotifications((n) => toasts.push(n.text, n.level));
  const onboarding = useDeckOnboarding();
  const [layers, setLayers] = useState<OverlayLayer[]>([]);
  const [theme, setThemeState] = useState<DeckTheme>(resolveDeckTheme);
  const [editorPath, setEditorPath] = useState<string | null>(null);
  const [diffTarget, setDiffTarget] = useState<DeckDiffTarget | null>(null);
  const [ccOpen, setCcOpen] = useState(resolveCcOpen);
  const seqRef = useRef(0);
  // Keyboard listener reads the engine through a ref so it stays bound once.
  const engineRef = useRef(engine);
  engineRef.current = engine;

  const steps = useMemo(() => extractPlanSteps(engine.messages), [engine.messages]);

  // E7 work-order policy layer: autonomy / gates / striking — Deck-side,
  // above the engine loop. Toasts mirror its decisions (same channel as
  // engine events).
  const workOrder = useWorkOrder(engine, steps, (text, kind) => toasts.push(text, kind));

  const toggleCc = useCallback(() => {
    setCcOpen((prev) => {
      persistCcOpen(!prev);
      return !prev;
    });
  }, []);

  const openLayer = useCallback(
    (kind: LayerKind) => {
      // The control center is a docked resident (E6.5), not a stack layer —
      // every entry point (dock, ⌘⇧O, command palette) toggles it instead.
      if (kind === "control-center") {
        toggleCc();
        return;
      }
      if (kind === "notifications") notifications.markAllRead();
      setLayers((prev) => pushLayer(prev, kind, seqRef.current++));
    },
    [notifications, toggleCc]
  );

  const closeLayer = useCallback((kind: LayerKind) => {
    setLayers((prev) => prev.filter((layer) => layer.kind !== kind));
  }, []);

  const setTheme = useCallback((next: DeckTheme) => {
    setThemeState(next);
    persistDeckTheme(next);
  }, []);

  const openInEditor = useCallback(
    (path: string) => {
      setEditorPath(path);
      openLayer("editor");
    },
    [openLayer]
  );

  const openDiff = useCallback(
    (file: string, staged: boolean) => {
      setDiffTarget({ file, staged });
      openLayer("diff");
    },
    [openLayer]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === "Escape") {
        if (mod && e.shiftKey) setLayers([]);
        else setLayers((prev) => popLayer(prev));
        return;
      }
      // Brake (E5.2): Space freezes/resumes — only when nothing editable or
      // clickable holds focus, so button activation keeps working.
      if (e.key === " " && !mod) {
        const el = document.activeElement as HTMLElement | null;
        const tag = el?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "BUTTON" || tag === "SELECT" || el?.isContentEditable) {
          return;
        }
        const current = engineRef.current;
        if (current.busy || current.status === "paused" || current.status === "interrupted") {
          e.preventDefault();
          void current.brake();
        }
        return;
      }
      if (!mod) return;
      const key = e.key.toLowerCase();
      const toggle = (kind: LayerKind) => {
        openLayer(kind);
        e.preventDefault();
      };
      if (key === "k" && !e.shiftKey) toggle("command");
      else if (key === "o" && e.shiftKey) toggle("control-center");
      else if (key === "t") toggle("tape");
      else if (key === "e" && e.shiftKey) toggle("changes");
      else if (key === "e") toggle("files");
      else if (key === "p" && e.shiftKey) toggle("processes");
      else if (key === "m" && e.shiftKey) toggle("floor");
      else if (key === "n" && e.shiftKey) toggle("notifications");
      else if (key === "n") toggle("draft");
      else if (key === "z" && e.shiftKey) toggle("checkpoints");
      else if (key === ",") toggle("settings");
      else if (e.key === "?") toggle("shortcuts");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openLayer, workOrder]);

  // ⌥1/2/3 set the autonomy level directly (E7.1). Uses e.code so the
  // macOS alt-glyph keys (¡™¢) still resolve to their digits.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.metaKey || e.ctrlKey) return;
      const map: Record<string, 0 | 1 | 2> = { Digit1: 0, Digit2: 1, Digit3: 2 };
      const level = map[e.code];
      if (level === undefined) return;
      e.preventDefault();
      workOrder.setAutonomy(level);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [workOrder]);

  const commandCtx: DeckCommandContext = useMemo(
    () => ({
      openLayer,
      setTheme,
      interrupt: () => void engine.interrupt(),
      selectSession: (id: string) => void engine.selectSession(id),
      sessions: engine.sessions,
      busy: engine.busy,
    }),
    [openLayer, setTheme, engine]
  );

  const renderOverlay = (kind: OverlayKind): JSX.Element | null => {
    switch (kind) {
      case "tape":
        return <DeckTape messages={engine.messages} />;
      case "control-center":
        return null; // resident dock (E6.5), never a stack layer
      case "notifications":
        return <NotificationsPanel notifications={notifications} />;
      case "floor":
        return <FloorPanel engine={engine} onClose={() => closeLayer("floor")} />;
      case "checkpoints":
        return <CheckpointsPanel engine={engine} />;
      case "ledger":
        return <LedgerPanel />;
      case "tree":
        return <TreePanel />;
      case "files":
        return <FilesPanel onOpen={openInEditor} />;
      case "changes":
        return <ChangesPanel onDiff={openDiff} />;
      case "diff":
        return diffTarget ? (
          <DiffPanel key={`${diffTarget.file}:${diffTarget.staged}`} target={diffTarget} />
        ) : (
          <div className="deck-empty">—</div>
        );
      case "processes":
        return <ProcessesPanel engine={engine} />;
      case "sources":
        return <SourcesPanel />;
      case "plugins":
        return <PluginsPanel />;
      case "review":
        return <ReviewPanel />;
      case "assets":
        return <AssetsPanel />;
      case "draft":
        return (
          <DraftPanel
            onDispatch={(text) => {
              closeLayer("draft");
              void engine.send(text);
            }}
          />
        );
      case "theme":
        return (
          <div className="deck-panel">
            <ThemeSwatches theme={theme} onPick={setTheme} />
          </div>
        );
      case "settings":
        return <DeckSettingsPanel theme={theme} onPickTheme={setTheme} />;
      case "shortcuts":
        return <ShortcutsPanel />;
      case "editor":
        return <EditorPanel key={editorPath ?? "blank"} initialPath={editorPath} />;
    }
  };

  return (
    <div className="deck-app" data-deck-theme={theme}>
      <GoalBand goal={engine.entry?.summary ?? null} steps={steps} />
      <DeckDock onOpen={openLayer} unread={notifications.unread} />
      <DeckStage engine={engine} steps={steps} workOrder={workOrder} />
      <DeckToasts toasts={toasts.toasts} />

      {/* Control center (E6.5): resident right-edge pane when open, a
          vertical pull tab (unread badge + urgent pulse while a permission
          ask is pending) when collapsed. */}
      {ccOpen ? (
        <aside className="deck-cc-dock deck-gcd" data-layer="control-center" aria-label={t("deck.cc.title")}>
          <div className="deck-cc-dock-head">
            <span className="deck-cc-dock-title">{t("deck.cc.title")}</span>
            <button type="button" className="deck-overlay-close" onClick={toggleCc} aria-label="Close">
              ✕
            </button>
          </div>
          <ControlCenter entry={engine.entry} busy={engine.busy} commandLog={engine.commandLog} events={events} />
        </aside>
      ) : (
        <button
          type="button"
          className={`deck-cc-tab deck-gc${(engine.askPermissions?.length ?? 0) > 0 ? " urgent" : ""}`}
          onClick={toggleCc}
          title={`${t("deck.cc.title")} ⌘⇧O`}
        >
          ◔ {t("deck.cc.title")}
          {notifications.unread > 0 ? <span className="deck-dock-badge">{notifications.unread}</span> : null}
        </button>
      )}

      {onboarding.visible ? <OnboardingModal onDismiss={onboarding.dismiss} /> : null}

      {layers.map((layer, depth) => {
        if (layer.kind === "command") {
          return <CommandLayer key={layer.seq} depth={depth} ctx={commandCtx} onRun={() => closeLayer("command")} />;
        }
        if (isDrawerKind(layer.kind)) {
          return (
            <DrawerShell
              key={layer.seq}
              layer={layer.kind}
              side={drawerSide(layer.kind)}
              title={t(OVERLAY_TITLES[layer.kind])}
              onClose={() => closeLayer(layer.kind)}
            >
              {renderOverlay(layer.kind)}
            </DrawerShell>
          );
        }
        return (
          <DeckOverlay
            key={layer.seq}
            depth={depth}
            layer={layer.kind}
            title={layer.kind === "diff" && diffTarget ? diffTarget.file : t(OVERLAY_TITLES[layer.kind])}
            wide={WIDE_OVERLAYS.has(layer.kind)}
            onClose={() => closeLayer(layer.kind)}
          >
            {renderOverlay(layer.kind)}
          </DeckOverlay>
        );
      })}
    </div>
  );
}
