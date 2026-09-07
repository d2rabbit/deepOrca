import { memo, type JSX } from "react";
import { IconCommand, IconMoon, IconSettings, IconSun, IconUndo } from "../ui/index";
import { cx } from "../ui/class-names";
import type { Theme } from "../lib/appearance";

export type CockpitActionsProps = {
  appearance: "light" | "dark";
  appearanceTitle: string;
  theme: Theme;
  mainView: string;
  modKey: string;
  commandsLabel: string;
  undoLabel: string;
  settingsLabel: string;
  onOpenPalette: () => void;
  onToggleAppearance: () => void;
  onUndo: () => void;
  onOpenSettings: () => void;
};

/** Stable cockpit action cluster extracted from App's composition root. */
export const CockpitActions = memo(function CockpitActions({
  appearance,
  appearanceTitle,
  theme,
  mainView,
  modKey,
  commandsLabel,
  undoLabel,
  settingsLabel,
  onOpenPalette,
  onToggleAppearance,
  onUndo,
  onOpenSettings,
}: CockpitActionsProps): JSX.Element {
  return (
    <div className="ui-cockpit-actions">
      <button
        type="button"
        className="ui-cockpit-icon-btn"
        onClick={onOpenPalette}
        data-tip={`${commandsLabel} (${modKey}K)`}
        aria-label={commandsLabel}
      >
        <IconCommand />
      </button>
      <button
        type="button"
        className="ui-cockpit-icon-btn"
        onClick={onToggleAppearance}
        disabled={theme === "orca"}
        data-tip={appearanceTitle}
        aria-label={appearanceTitle}
      >
        {appearance === "dark" ? <IconMoon /> : <IconSun />}
      </button>
      <button
        type="button"
        className="ui-cockpit-icon-btn"
        onClick={onUndo}
        data-tip={`${undoLabel} (${modKey}Z)`}
        aria-label={undoLabel}
      >
        <IconUndo />
      </button>
      <button
        type="button"
        className={cx("ui-cockpit-icon-btn", mainView === "settings" && "active")}
        onClick={onOpenSettings}
        data-tip={`${settingsLabel} (${modKey},)`}
        aria-label={settingsLabel}
      >
        <IconSettings />
      </button>
    </div>
  );
});
