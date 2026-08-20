// Module dock: the 18 entries from the design demo, now wired to overlays.
import type { JSX } from "react";
import { useI18n, type MessageKey } from "../../i18n";
import { DeckIcon, type DeckIconId } from "../icons";
import type { OverlayKind } from "../types";

export type DockEntry = {
  icon: DeckIconId;
  labelKey: MessageKey;
  overlay: OverlayKind;
  shortcut?: string;
  accent?: boolean;
};

type DockItem = DockEntry | "div";

export const DOCK: DockItem[] = [
  { icon: "bell", labelKey: "deck.dock.notifications", overlay: "notifications", shortcut: "⌘⇧N" },
  { icon: "tape", labelKey: "deck.dock.tape", overlay: "tape", shortcut: "⌘T" },
  { icon: "theme", labelKey: "deck.dock.theme", overlay: "theme" },
  { icon: "gear", labelKey: "deck.dock.settings", overlay: "settings", shortcut: "⌘," },
  "div",
  { icon: "files", labelKey: "deck.dock.files", overlay: "files", shortcut: "⌘E" },
  { icon: "git", labelKey: "deck.dock.changes", overlay: "changes", shortcut: "⌘⇧E" },
  { icon: "proc", labelKey: "deck.dock.processes", overlay: "processes", shortcut: "⌘⇧P" },
  { icon: "assets", labelKey: "deck.dock.assets", overlay: "assets" },
  { icon: "review", labelKey: "deck.dock.review", overlay: "review" },
  { icon: "db", labelKey: "deck.dock.sources", overlay: "sources" },
  { icon: "ledger", labelKey: "deck.dock.ledger", overlay: "ledger" },
  { icon: "tree", labelKey: "deck.dock.tree", overlay: "tree" },
  { icon: "plug", labelKey: "deck.dock.plugins", overlay: "plugins" },
  { icon: "undo", labelKey: "deck.dock.checkpoints", overlay: "checkpoints", shortcut: "⌘⇧Z" },
  { icon: "edit", labelKey: "deck.dock.editor", overlay: "editor" },
  { icon: "keys", labelKey: "deck.dock.shortcuts", overlay: "shortcuts", shortcut: "⌘?" },
  { icon: "floor", labelKey: "deck.dock.floor", overlay: "floor", shortcut: "⌘⇧M" },
  "div",
  { icon: "plus", labelKey: "deck.dock.newGoal", overlay: "floor", shortcut: "⌘N", accent: true },
];

export function DeckDock(props: { onOpen: (overlay: OverlayKind) => void; unread?: number }): JSX.Element {
  const { t } = useI18n();
  return (
    <nav className="deck-dock deck-gc">
      {DOCK.map((item, idx) =>
        item === "div" ? (
          <span key={`div-${idx}`} className="deck-ddiv" />
        ) : (
          <button
            key={item.labelKey}
            type="button"
            data-overlay={item.overlay}
            className={`deck-dicon${item.accent ? " accent" : ""}`}
            data-tip={`${t(item.labelKey)}${item.shortcut ? ` ${item.shortcut}` : ""}`}
            onClick={() => props.onOpen(item.overlay)}
          >
            <DeckIcon id={item.icon} />
            <small>{t(item.labelKey)}</small>
            {item.overlay === "notifications" && props.unread && props.unread > 0 ? (
              <span className="deck-dock-badge">{props.unread > 99 ? "99+" : String(props.unread)}</span>
            ) : null}
          </button>
        )
      )}
    </nav>
  );
}
