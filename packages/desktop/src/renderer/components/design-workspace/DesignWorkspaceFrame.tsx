import type { JSX, ReactNode } from "react";
import { useI18n } from "../../i18n";
import { IconClose } from "../../ui/icons";
import type { DesignSuiteVersion } from "./types";

export type WorkspaceTab<T extends string> = { id: T; label: string };

type Props<T extends string> = {
  root: string;
  tabs: readonly WorkspaceTab<T>[];
  activeTab: T;
  onTabChange: (tab: T) => void;
  versions: readonly DesignSuiteVersion[];
  selectedVersionId?: string;
  latestVersionId?: string;
  onVersionChange: (versionId: string) => void;
  versionDetail?: (version: DesignSuiteVersion) => ReactNode;
  /** Version-rail caption (mockup: 「版本 · 一版一套（…）」). Defaults to 版本历史. */
  versionCap?: string;
  /** Scope hint under the tabs (mockup: 版本 / 基底 / 主题 联动摘要). */
  hint?: string;
  /** specs/prd-theme-layer：版本历史上方的轻量需求主题条（只读，由调用方
   *  决定渲染什么；不传则不渲染——旧布局零回归）。 */
  railHeader?: ReactNode;
  loading?: boolean;
  empty?: boolean;
  error?: string | null;
  onBack?: () => void;
  /** 交互播放模式(user ask 2026-09-09):冻结 frame 的所有编辑入口——
   *  tab/版本轨/返回都不可点,版本轨隐藏,画布获得全部空间。 */
  locked?: boolean;
  children?: ReactNode;
};

function rootLabel(root: string): string {
  const segments = root.split(/[/\\]/).filter(Boolean);
  return segments.at(-1) ?? root;
}

/**
 * Store versions are oldest-first: the label for store index i is `v{i + 1}`
 * (v1 = oldest, newest = vN). Re-review L15 catch — the previous
 * `v{length - i}` formula was inverted and mislabeled every hint/badge/meta
 * surface (the rail itself renders over the reversed array and was correct).
 */
export function versionLabel(
  versions: readonly { versionId: string }[] | undefined,
  versionId?: string
): string | null {
  if (!versions || !versionId) return null;
  const index = versions.findIndex((version) => version.versionId === versionId);
  return index === -1 ? null : `v${index + 1}`;
}

export function DesignWorkspaceFrame<T extends string>({
  root,
  tabs,
  activeTab,
  onTabChange,
  versions,
  selectedVersionId,
  latestVersionId,
  onVersionChange,
  versionDetail,
  versionCap,
  hint,
  railHeader,
  loading = false,
  empty = false,
  error,
  onBack,
  locked = false,
  children,
}: Props<T>): JSX.Element {
  const { t } = useI18n();
  const readOnly = Boolean(selectedVersionId && latestVersionId && selectedVersionId !== latestVersionId);
  const railVersions = [...versions].reverse();

  return (
    <section className="ui-design-workspace" data-locked={locked || undefined} data-testid="design-workspace-frame">
      <header className="ui-design-workspace-head">
        <div className="ui-design-workspace-tabs" role="tablist">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              className={`ui-design-workspace-tab${activeTab === tab.id ? " active" : ""}`}
              disabled={locked}
              onClick={() => onTabChange(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <span className="ui-design-root-badge" title={root}>
          {t("designWorkspace.currentRoot", { root: rootLabel(root) })}
        </span>
        {onBack ? (
          <button
            type="button"
            className="ui-design-workspace-close"
            disabled={locked}
            onClick={onBack}
            aria-label={t("designWorkspace.backToConversation")}
          >
            <IconClose />
            <span>{t("designWorkspace.backToConversation")}</span>
          </button>
        ) : null}
      </header>
      {hint ? <div className="ui-design-scope-hint">{hint}</div> : null}

      <div className="ui-design-workspace-body">
        <aside className="ui-design-version-rail" aria-label={t("designWorkspace.versionHistory")}>
          {railHeader}
          <div className="ui-design-version-cap">{versionCap ?? t("designWorkspace.versionHistory")}</div>
          {versions.length === 0 ? (
            <div className="ui-design-version-empty">{t("designWorkspace.noVersions")}</div>
          ) : null}
          {railVersions.map((version, index) => {
            const isLatest = version.versionId === latestVersionId;
            return (
              <button
                type="button"
                key={version.versionId}
                className={`ui-design-version-item${version.versionId === selectedVersionId ? " active" : ""}`}
                disabled={locked}
                onClick={() => onVersionChange(version.versionId)}
                data-version-id={version.versionId}
              >
                <span className="ui-design-version-line">
                  <strong>v{versions.length - index}</strong>
                  <time>{new Date(version.savedAt).toLocaleString()}</time>
                  {isLatest ? <i>{t("designWorkspace.latest")}</i> : null}
                </span>
                <span className="ui-design-version-note">{version.note ?? version.status}</span>
                {versionDetail?.(version)}
              </button>
            );
          })}
        </aside>

        <main className="ui-design-workspace-main">
          {readOnly ? (
            <div className="ui-design-readonly" role="status">
              <span>{t("designWorkspace.readOnly")}</span>
              {/* 播放锁定期间禁用:否则可以在播放中偷渡版本切换(D#2)。 */}
              <button
                type="button"
                disabled={locked}
                onClick={() => latestVersionId && onVersionChange(latestVersionId)}
              >
                {t("designWorkspace.backToLatest")}
              </button>
            </div>
          ) : null}
          {loading ? <div className="ui-design-state">{t("common.loading")}</div> : null}
          {!loading && error ? <div className="ui-design-state error">{error}</div> : null}
          {!loading && !error && empty ? <div className="ui-design-state">{t("designWorkspace.empty")}</div> : null}
          {!loading && !error && !empty ? children : null}
        </main>
      </div>
    </section>
  );
}
