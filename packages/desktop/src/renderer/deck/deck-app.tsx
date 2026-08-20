// Orca Deck — root component (E1 core loop + E2 functional layer).
//
// Shell: goal band (real goal + plan progress + escape hatch), left-edge
// module dock wired to overlays, work-order stage (step board + pending
// approvals + command input), and a single-overlay surface (stack lands in
// E3). Keyboard: ⌘⇧O control center, ⌘T tape, ⌘E files, ⌘⇧E changes,
// ⌘⇧P processes, ⌘⇧M floor wall, Esc closes the open overlay.
import { useEffect, useMemo, useState, type JSX } from "react";
import { useI18n, type MessageKey } from "../i18n";
import { useDeckEngine } from "./hooks/use-deck-engine";
import { useDeckEvents } from "./hooks/use-deck-events";
import type { OverlayKind } from "./types";
import { GoalBand } from "./components/goal-band";
import { DeckDock } from "./components/dock";
import { DeckStage } from "./components/stage";
import { DeckTape } from "./components/tape";
import { ControlCenter } from "./components/control-center";
import { DeckOverlay } from "./components/overlay";
import { extractPlanSteps } from "./components/step-board";
import { FloorPanel, CheckpointsPanel, LedgerPanel, TreePanel } from "./components/session-panels";
import { FilesPanel, ChangesPanel, ProcessesPanel } from "./components/workspace-panels";
import { SourcesPanel, PluginsPanel, ReviewPanel, AssetsPanel, PlaceholderPanel } from "./components/module-panels";

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
};

const WIDE_OVERLAYS = new Set<OverlayKind>(["tape", "floor", "ledger"]);

export function DeckApp(): JSX.Element {
  const { t } = useI18n();
  const engine = useDeckEngine();
  const events = useDeckEvents();
  const [overlay, setOverlay] = useState<OverlayKind | null>(null);

  const steps = useMemo(() => extractPlanSteps(engine.messages), [engine.messages]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOverlay(null);
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      const toggle = (kind: OverlayKind) => {
        setOverlay((prev) => (prev === kind ? null : kind));
        e.preventDefault();
      };
      if (e.shiftKey && key === "o") toggle("control-center");
      else if (key === "t") toggle("tape");
      else if (e.shiftKey && key === "e") toggle("changes");
      else if (key === "e") toggle("files");
      else if (e.shiftKey && key === "p") toggle("processes");
      else if (e.shiftKey && key === "m") toggle("floor");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const renderOverlay = (kind: OverlayKind): JSX.Element => {
    switch (kind) {
      case "tape":
        return <DeckTape messages={engine.messages} />;
      case "control-center":
        return <ControlCenter entry={engine.entry} busy={engine.busy} commandLog={engine.commandLog} events={events} />;
      case "floor":
        return <FloorPanel engine={engine} onClose={() => setOverlay(null)} />;
      case "checkpoints":
        return <CheckpointsPanel engine={engine} />;
      case "ledger":
        return <LedgerPanel />;
      case "tree":
        return <TreePanel />;
      case "files":
        return <FilesPanel />;
      case "changes":
        return <ChangesPanel />;
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
        return <PlaceholderPanel noteKey="deck.placeholder.theme" />;
      case "notifications":
        return <PlaceholderPanel noteKey="deck.placeholder.notifications" />;
      case "settings":
      case "editor":
      case "shortcuts":
        return <PlaceholderPanel noteKey="deck.placeholder.e3" />;
    }
  };

  return (
    <div className="deck-app" data-deck-theme="liquid">
      <GoalBand goal={engine.entry?.summary ?? null} steps={steps} />
      <DeckDock onOpen={(kind) => setOverlay((prev) => (prev === kind ? null : kind))} />
      <DeckStage engine={engine} steps={steps} />

      {overlay ? (
        <DeckOverlay
          title={t(OVERLAY_TITLES[overlay])}
          wide={WIDE_OVERLAYS.has(overlay)}
          onClose={() => setOverlay(null)}
        >
          {renderOverlay(overlay)}
        </DeckOverlay>
      ) : null}
    </div>
  );
}
