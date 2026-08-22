// Shortcuts table (⌘?): generated from the same dock list the command
// registry reads, plus the overlay-stack globals — the coverage requirement
// is that the two surfaces share one source and can never drift.
import type { JSX } from "react";
import { useI18n } from "../../i18n";
import { DOCK, type DockEntry } from "./dock";

const GLOBAL_SHORTCUTS: Array<{
  keys: string;
  labelKey:
    | "deck.cmd.title"
    | "deck.shortcuts.closeTop"
    | "deck.shortcuts.clearStack"
    | "deck.shortcuts.cc"
    | "deck.shortcuts.zen"
    | "deck.shortcuts.brake"
    | "deck.shortcuts.stepNav"
    | "deck.shortcuts.autonomy"
    | "deck.shortcuts.send";
}> = [
  { keys: "⌘K", labelKey: "deck.cmd.title" },
  { keys: "⌘⇧O", labelKey: "deck.shortcuts.cc" },
  { keys: "⌘.", labelKey: "deck.shortcuts.zen" },
  { keys: "Space", labelKey: "deck.shortcuts.brake" },
  { keys: "J / K", labelKey: "deck.shortcuts.stepNav" },
  { keys: "⌥1/2/3", labelKey: "deck.shortcuts.autonomy" },
  { keys: "⏎", labelKey: "deck.shortcuts.send" },
  { keys: "Esc", labelKey: "deck.shortcuts.closeTop" },
  { keys: "⌘⇧Esc", labelKey: "deck.shortcuts.clearStack" },
];

export function ShortcutsPanel(): JSX.Element {
  const { t } = useI18n();
  const modules = DOCK.filter((item): item is DockEntry => item !== "div" && item.shortcut !== undefined);

  return (
    <div className="deck-panel">
      <div className="deck-panel-group-title">{t("deck.shortcuts.global")}</div>
      {GLOBAL_SHORTCUTS.map((row) => (
        <div key={row.keys} className="deck-row static">
          <span className="deck-row-main">{t(row.labelKey)}</span>
          <span className="deck-row-meta">
            <span className="deck-kbd">{row.keys}</span>
          </span>
        </div>
      ))}

      <div className="deck-panel-group-title">{t("deck.shortcuts.modules")}</div>
      {modules.map((item) => (
        <div key={item.labelKey} className="deck-row static">
          <span className="deck-row-main">{t(item.labelKey)}</span>
          <span className="deck-row-meta">
            <span className="deck-kbd">{item.shortcut}</span>
          </span>
        </div>
      ))}
    </div>
  );
}
