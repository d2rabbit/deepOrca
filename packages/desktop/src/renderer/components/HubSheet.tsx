import type { JSX, MouseEvent, ReactNode } from "react";
import { useI18n, type MessageKey } from "../i18n";
import type { SidebarView } from "../hooks/use-panel-layout";
import { cx } from "../ui/class-names";
import {
  IconDesign,
  IconEditor,
  IconGit,
  IconGitmcp,
  IconIndex,
  IconPlugins,
  IconPrototype,
  IconReview,
  IconSessions,
  IconTaskTree,
  IconTasks,
  IconTokens,
} from "../ui/index";

/** i18n key per hub view — reuses the old rail labels. */
const VIEW_LABEL_KEYS: Record<SidebarView, MessageKey> = {
  explorer: "rail.sessions",
  scm: "rail.git",
  tasks: "rail.tasks",
  tokens: "rail.tokens",
  index: "rail.index",
  review: "rail.review",
  prototype: "rail.prototype",
  design: "rail.design",
  tasktree: "rail.tasktree",
  gitmcp: "rail.gitmcp",
  editor: "rail.editor",
  plugins: "rail.plugins",
};

type HubViewDef = { id: SidebarView; labelKey: MessageKey; icon: JSX.Element };

type HubSheetProps = {
  /** Currently active sidebar view (tile highlight + sheet title). */
  view: SidebarView;
  /** Views whose backing data is absent (rendered dimmed, not clickable). */
  disabledViews?: SidebarView[];
  onSelectView: (view: SidebarView) => void;
  onClose: () => void;
  onResizeStart: (e: MouseEvent) => void;
  children: ReactNode;
};

/**
 * Hub sheet — the floating glass island that replaced the VSCode-style
 * activity-rail + docked-sidebar pair. It overlays the conversation stage
 * (never reflows into a grid track), carries its own launcher tile grid for
 * switching views, and keeps the legacy drag-to-resize interaction on its
 * right edge.
 */
export function HubSheet({
  view,
  disabledViews = [],
  onSelectView,
  onClose,
  onResizeStart,
  children,
}: HubSheetProps): JSX.Element {
  const { t } = useI18n();
  const views: HubViewDef[] = [
    { id: "explorer", labelKey: VIEW_LABEL_KEYS.explorer, icon: <IconSessions /> },
    { id: "scm", labelKey: VIEW_LABEL_KEYS.scm, icon: <IconGit /> },
    { id: "tasks", labelKey: VIEW_LABEL_KEYS.tasks, icon: <IconTasks /> },
    { id: "tokens", labelKey: VIEW_LABEL_KEYS.tokens, icon: <IconTokens /> },
    { id: "index", labelKey: VIEW_LABEL_KEYS.index, icon: <IconIndex /> },
    { id: "review", labelKey: VIEW_LABEL_KEYS.review, icon: <IconReview /> },
    { id: "prototype", labelKey: VIEW_LABEL_KEYS.prototype, icon: <IconPrototype /> },
    { id: "design", labelKey: VIEW_LABEL_KEYS.design, icon: <IconDesign /> },
    { id: "tasktree", labelKey: VIEW_LABEL_KEYS.tasktree, icon: <IconTaskTree /> },
    { id: "gitmcp", labelKey: VIEW_LABEL_KEYS.gitmcp, icon: <IconGitmcp /> },
    { id: "editor", labelKey: VIEW_LABEL_KEYS.editor, icon: <IconEditor /> },
    { id: "plugins", labelKey: VIEW_LABEL_KEYS.plugins, icon: <IconPlugins /> },
  ];
  return (
    <aside className="ui-hub-sheet" role="complementary" aria-label={t("hub.title")}>
      <div className="ui-hub-head">
        <span className="ui-hub-title">{t(VIEW_LABEL_KEYS[view])}</span>
        <button
          type="button"
          className="ui-hub-close"
          onClick={onClose}
          title={t("common.close")}
          aria-label={t("common.close")}
        >
          ✕
        </button>
      </div>
      <div className="ui-hub-tiles" role="tablist" aria-label={t("hub.title")}>
        {views.map((v) => (
          <button
            key={v.id}
            type="button"
            role="tab"
            aria-selected={v.id === view}
            disabled={disabledViews.includes(v.id)}
            className={cx("ui-hub-tile", v.id === view && "active")}
            onClick={() => onSelectView(v.id)}
          >
            <span className="ui-hub-tile-icon" aria-hidden>
              {v.icon}
            </span>
            <span className="ui-hub-tile-label">{t(v.labelKey)}</span>
          </button>
        ))}
      </div>
      <div className="ui-hub-body">
        {/* key change re-triggers the per-view entrance animation */}
        <div className="ui-hub-body-view" key={view}>
          {children}
        </div>
      </div>
      <div className="ui-hub-resize" onMouseDown={onResizeStart} role="separator" aria-orientation="vertical" />
    </aside>
  );
}

type HubOrbProps = {
  open: boolean;
  /** Attention dot (permission pending / waiting for user). */
  badge?: boolean;
  onClick: () => void;
};

/**
 * Tide orb — the single persistent navigation affordance. A floating orb at
 * the bottom-left corner of the stage that summons/dismisses the hub sheet.
 * When the sheet is open the orb slides to the sheet's right edge, staying
 * reachable as the close affordance.
 */
export function HubOrb({ open, badge = false, onClick }: HubOrbProps): JSX.Element {
  const { t } = useI18n();
  return (
    <button
      type="button"
      className={cx("ui-orb", open && "ui-orb--open", badge && "ui-orb--badge")}
      onClick={onClick}
      title={`${t("hub.title")} (⌘B)`}
      aria-label={t("hub.title")}
      aria-expanded={open}
    >
      <span className="ui-orb-glyph" aria-hidden>
        ◈
      </span>
    </button>
  );
}
