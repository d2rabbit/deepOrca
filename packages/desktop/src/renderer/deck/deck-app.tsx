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
import { persistDeckTheme, resolveDeckTheme, type DeckTheme } from "./lib/appearance";
import { popLayer, pushLayer, type LayerKind, type OverlayLayer } from "./lib/overlay-stack";
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
};

const WIDE_OVERLAYS = new Set<OverlayKind>(["tape", "floor", "ledger", "editor", "diff"]);

export function DeckApp(): JSX.Element {
  const { t } = useI18n();
  const engine = useDeckEngine();
  const events = useDeckEvents();
  const toasts = useDeckToasts();
  const notifications = useDeckNotifications((n) => toasts.push(n.text, n.level));
  const [layers, setLayers] = useState<OverlayLayer[]>([]);
  const [theme, setThemeState] = useState<DeckTheme>(resolveDeckTheme);
  const [editorPath, setEditorPath] = useState<string | null>(null);
  const [diffTarget, setDiffTarget] = useState<DeckDiffTarget | null>(null);
  const seqRef = useRef(0);
  // Keyboard listener reads the engine through a ref so it stays bound once.
  const engineRef = useRef(engine);
  engineRef.current = engine;

  const steps = useMemo(() => extractPlanSteps(engine.messages), [engine.messages]);

  const openLayer = useCallback(
    (kind: LayerKind) => {
      if (kind === "notifications") notifications.markAllRead();
      setLayers((prev) => pushLayer(prev, kind, seqRef.current++));
    },
    [notifications]
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
      else if (key === "n") toggle("floor");
      else if (key === "z" && e.shiftKey) toggle("checkpoints");
      else if (key === ",") toggle("settings");
      else if (e.key === "?") toggle("shortcuts");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openLayer]);

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

  const renderOverlay = (kind: OverlayKind): JSX.Element => {
    switch (kind) {
      case "tape":
        return <DeckTape messages={engine.messages} />;
      case "control-center":
        return <ControlCenter entry={engine.entry} busy={engine.busy} commandLog={engine.commandLog} events={events} />;
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
      <DeckStage engine={engine} steps={steps} />
      <DeckToasts toasts={toasts.toasts} />

      {layers.map((layer, depth) =>
        layer.kind === "command" ? (
          <CommandLayer key={layer.seq} depth={depth} ctx={commandCtx} onRun={() => closeLayer("command")} />
        ) : (
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
        )
      )}
    </div>
  );
}
