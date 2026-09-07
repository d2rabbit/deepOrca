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
  loading?: boolean;
  empty?: boolean;
  error?: string | null;
  onBack?: () => void;
  children?: ReactNode;
};

function rootLabel(root: string): string {
  const segments = root.split(/[/\\]/).filter(Boolean);
  return segments.at(-1) ?? root;
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
  loading = false,
  empty = false,
  error,
  onBack,
  children,
}: Props<T>): JSX.Element {
  const { t } = useI18n();
  const readOnly = Boolean(selectedVersionId && latestVersionId && selectedVersionId !== latestVersionId);

  return (
    <section className="ui-design-workspace" data-testid="design-workspace-frame">
      <header className="ui-design-workspace-head">
        <div className="ui-design-workspace-tabs" role="tablist">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              className={`ui-design-workspace-tab${activeTab === tab.id ? " active" : ""}`}
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
          <button type="button" className="ui-design-workspace-close" onClick={onBack} aria-label={t("common.close")}>
            <IconClose />
          </button>
        ) : null}
      </header>

      <div className="ui-design-workspace-body">
        <aside className="ui-design-version-rail" aria-label={t("designWorkspace.versionHistory")}>
          <div className="ui-design-version-cap">{t("designWorkspace.versionHistory")}</div>
          {versions.length === 0 ? (
            <div className="ui-design-version-empty">{t("designWorkspace.noVersions")}</div>
          ) : null}
          {versions.map((version, index) => {
            const isLatest = version.versionId === latestVersionId;
            return (
              <button
                type="button"
                key={version.versionId}
                className={`ui-design-version-item${version.versionId === selectedVersionId ? " active" : ""}`}
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
              <button type="button" onClick={() => latestVersionId && onVersionChange(latestVersionId)}>
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
