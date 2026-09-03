import { useEffect, type JSX } from "react";
import { useI18n } from "../i18n";

type Props = {
  platform: string;
  onClose: () => void;
};

type ShortcutEntry = { keys: string; desc: string };

/**
 * Keyboard shortcuts reference overlay. Triggered via ⌘? / Ctrl+? or the
 * command palette. Lists all global and composer shortcuts in a scannable
 * two-column layout grouped by context.
 */
export function ShortcutsModal({ platform, onClose }: Props): JSX.Element {
  const { t } = useI18n();
  const mod = platform === "darwin" ? "⌘" : "Ctrl";

  // The reference itself advertises "Esc — close overlay"; the modal must
  // actually honor it (overlay click and ✕ were the only ways out).
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const global: ShortcutEntry[] = [
    { keys: `${mod}+K`, desc: t("shortcuts.commandPalette") },
    { keys: `${mod}+N`, desc: t("shortcuts.newSession") },
    { keys: `${mod}+B`, desc: t("shortcuts.toggleSidebar") },
    { keys: `${mod}+,`, desc: t("shortcuts.settings") },
    { keys: `${mod}+?`, desc: t("shortcuts.shortcuts") },
    { keys: "Esc", desc: t("shortcuts.closeOverlay") },
  ];

  const composer: ShortcutEntry[] = [
    { keys: "Enter", desc: t("shortcuts.send") },
    { keys: "Shift+Enter", desc: t("shortcuts.newline") },
    { keys: "Shift+Tab", desc: t("shortcuts.togglePlan") },
    { keys: `${mod}+Z`, desc: t("shortcuts.undo") },
    { keys: `${mod}+Shift+Z`, desc: t("shortcuts.redo") },
    { keys: "↑ / ↓", desc: t("shortcuts.history") },
    { keys: "Esc", desc: t("shortcuts.stopGeneration") },
  ];

  const navigation: ShortcutEntry[] = [
    { keys: "/ or $", desc: t("shortcuts.slashCommands") },
    { keys: "@", desc: t("shortcuts.fileMention") },
    { keys: `${mod}+V`, desc: t("shortcuts.pasteImage") },
  ];

  function renderGroup(title: string, entries: ShortcutEntry[], groupIdx: number): JSX.Element {
    return (
      <div className="ui-shortcuts-group" style={{ animationDelay: `${groupIdx * 0.06}s` }}>
        <div className="ui-shortcuts-group-title">{title}</div>
        {entries.map((entry) => (
          <div key={entry.keys} className="ui-shortcuts-row">
            <kbd className="ui-shortcuts-keys">{entry.keys}</kbd>
            <span className="ui-shortcuts-desc">{entry.desc}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="ui-modal-overlay" onClick={onClose}>
      <div className="ui-shortcuts-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ui-shortcuts-head">
          <span className="ui-shortcuts-title">{t("shortcuts.title")}</span>
          <button className="ui-diff-overlay-close" onClick={onClose} aria-label={t("common.close")}>
            ✕
          </button>
        </div>
        <div className="ui-shortcuts-body">
          {renderGroup(t("shortcuts.global"), global, 0)}
          {renderGroup(t("shortcuts.composerGroup"), composer, 1)}
          {renderGroup(t("shortcuts.inputGroup"), navigation, 2)}
        </div>
      </div>
    </div>
  );
}
