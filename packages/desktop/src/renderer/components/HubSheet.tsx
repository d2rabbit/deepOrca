import type { JSX, MouseEvent, ReactNode } from "react";
import { useI18n, type MessageKey } from "../i18n";
import type { SidebarView } from "../hooks/use-panel-layout";
import { cx } from "../ui/class-names";
import {
  IconChain,
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
  // IconTasks 随 tasks 视图隐藏（B1）不再使用；视图恢复时一并恢复 import。
  IconTokens,
} from "../ui/index";

/** i18n key per hub view — reuses the old rail labels. */
const VIEW_LABEL_KEYS: Record<SidebarView, MessageKey> = {
  explorer: "rail.sessions",
  scm: "rail.git",
  chain: "rail.chain",
  tasks: "rail.tasks",
  tokens: "rail.tokens",
  index: "rail.index",
  review: "rail.review",
  prototype: "rail.prototype",
  design: "rail.design",
  taskhub: "rail.taskhub",
  gitmcp: "rail.gitmcp",
  editor: "rail.editor",
  plugins: "rail.plugins",
};

type HubViewDef = { id: SidebarView; labelKey: MessageKey; icon: JSX.Element };

type HubSheetProps = {
  /** Currently active sidebar view (item highlight + flyout title). */
  view: SidebarView;
  /** Whether the level-2 content card is extended beside the rail. */
  expanded: boolean;
  /** Views whose backing data is absent (rendered dimmed, not clickable). */
  disabledViews?: SidebarView[];
  onSelectView: (view: SidebarView) => void;
  /** Collapse ONLY the flyout back to the icon rail (flyout header ✕). */
  onCollapseFlyout: () => void;
  /** Close the whole hub (rail bottom ⟨ / Esc / orb). */
  onClose: () => void;
  onResizeStart: (e: MouseEvent) => void;
  children: ReactNode;
};

/**
 * Hub — two stacked levels:
 *
 *   Level 1 · `.ui-hub-rail`    a slim vertical glass column of module icons;
 *                               summoned by the tide orb / ⌘B.
 *   Level 2 · `.ui-hub-flyout`  the selected module's content card, extending
 *                               out beside the rail once an item is picked.
 *
 * The orb stays level-1 only; picking an icon is what extends level 2.
 */
export function HubSheet({
  view,
  expanded,
  disabledViews = [],
  onSelectView,
  onCollapseFlyout,
  onClose,
  onResizeStart,
  children,
}: HubSheetProps): JSX.Element {
  const { t } = useI18n();
  // Dock 顺序 = 实用性排序（user ask 2026-09-03 十二轮 B2）：会话 → 源代码
  // 管理 → 知识库 → 代码审查 → 编辑器 → Token → 原型 → UI 设计 → 任务树 →
  // GitMCP → 插件。「任务」(tasks) 视图暂时隐藏（B1）—— dock 不再渲染，
  // 视图本身保留注册，程序内通路不受影响。
  const views: HubViewDef[] = [
    { id: "explorer", labelKey: VIEW_LABEL_KEYS.explorer, icon: <IconSessions /> },
    { id: "chain", labelKey: VIEW_LABEL_KEYS.chain, icon: <IconChain /> },
    { id: "scm", labelKey: VIEW_LABEL_KEYS.scm, icon: <IconGit /> },
    { id: "index", labelKey: VIEW_LABEL_KEYS.index, icon: <IconIndex /> },
    { id: "review", labelKey: VIEW_LABEL_KEYS.review, icon: <IconReview /> },
    { id: "editor", labelKey: VIEW_LABEL_KEYS.editor, icon: <IconEditor /> },
    { id: "tokens", labelKey: VIEW_LABEL_KEYS.tokens, icon: <IconTokens /> },
    { id: "prototype", labelKey: VIEW_LABEL_KEYS.prototype, icon: <IconPrototype /> },
    { id: "design", labelKey: VIEW_LABEL_KEYS.design, icon: <IconDesign /> },
    { id: "taskhub", labelKey: VIEW_LABEL_KEYS.taskhub, icon: <IconTaskTree /> },
    { id: "gitmcp", labelKey: VIEW_LABEL_KEYS.gitmcp, icon: <IconGitmcp /> },
    { id: "plugins", labelKey: VIEW_LABEL_KEYS.plugins, icon: <IconPlugins /> },
  ];
  return (
    <>
      {/* Level 1: vertical rail — one glowing entry per row. */}
      <nav className="ui-hub-rail" aria-label={t("hub.title")}>
        <span className="ui-hub-mark" aria-hidden>
          ◈
        </span>
        <div className="ui-hub-rail-items" role="tablist" aria-label={t("hub.title")}>
          {views.map((v) => (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={v.id === view}
              disabled={disabledViews.includes(v.id)}
              className={cx("ui-hub-item", v.id === view && "active")}
              onClick={() => onSelectView(v.id)}
            >
              <span className="ui-hub-item-icon" aria-hidden>
                {v.icon}
              </span>
              <span className="ui-hub-item-label">{t(v.labelKey)}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          className="ui-hub-close ui-hub-collapse"
          onClick={onClose}
          title={t("common.close")}
          aria-label={t("common.close")}
        >
          ⟨
        </button>
      </nav>

      {/* Level 2: floating content card anchored beside the rail. Rendered
          only when extended; the inner key re-triggers the per-view fade. */}
      {expanded ? (
        <section className="ui-hub-flyout" aria-label={t(VIEW_LABEL_KEYS[view])}>
          <header className="ui-hub-head">
            <span className="ui-hub-title">{t(VIEW_LABEL_KEYS[view])}</span>
            <button
              type="button"
              className="ui-hub-close"
              onClick={onCollapseFlyout}
              title={t("hub.collapseToRail")}
              aria-label={t("hub.collapseToRail")}
            >
              ✕
            </button>
          </header>
          <div className="ui-hub-body">
            <div className="ui-hub-body-view" key={view}>
              {children}
            </div>
          </div>
          <div className="ui-hub-resize" onMouseDown={onResizeStart} role="separator" aria-orientation="vertical" />
        </section>
      ) : null}
    </>
  );
}

type HubOrbProps = {
  /** Attention dot (permission pending / waiting for user). */
  badge?: boolean;
  /** Platform modifier label (⌘ / Ctrl) for the shortcut hint. */
  modKey: string;
  onClick: () => void;
};

/**
 * Tide orb — summons the icon rail (level 1). Rendered ONLY while the hub is
 * closed: once the rail is up it owns the corner entirely (its bottom ⟨ / Esc
 * / ⌘B close it), so orb and rail never stack in the same spot. Picking a
 * module extends the content card (level 2).
 */
export function HubOrb({ badge = false, modKey, onClick }: HubOrbProps): JSX.Element {
  const { t } = useI18n();
  return (
    <button
      type="button"
      className={cx("ui-orb", badge && "ui-orb--badge")}
      onClick={onClick}
      title={`${t("hub.title")} (${modKey}B)`}
      aria-label={t("hub.title")}
      aria-haspopup="true"
    >
      <span className="ui-orb-glyph" aria-hidden>
        ◈
      </span>
    </button>
  );
}
