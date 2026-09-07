import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { useI18n } from "../../i18n";
import { subscribeToSuiteChanges, suiteApi } from "./api";
import type { DesignSuiteKind, DesignSuiteSummary } from "./types";

type DirectoryGroup = {
  root: string;
  label: string;
  suites: DesignSuiteSummary[];
};

type Props = {
  activeRoot: string;
  kind: DesignSuiteKind;
  title: string;
};

export function WorkspaceDirectory({ activeRoot, kind, title }: Props): JSX.Element {
  const { t } = useI18n();
  const [groups, setGroups] = useState<DirectoryGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const listing = await suiteApi.listWorkspaceSessions();
      const fallback = {
        root: activeRoot,
        label: activeRoot.split(/[/\\]/).filter(Boolean).at(-1) ?? activeRoot,
      };
      const workspaces = listing.workspaces.some((workspace) => workspace.root === activeRoot)
        ? listing.workspaces
        : [fallback, ...listing.workspaces];
      const next = await Promise.all(
        workspaces.map(async (workspace) => ({
          root: workspace.root,
          label: workspace.label,
          suites: await suiteApi.designSuiteList(workspace.root, kind),
        }))
      );
      setGroups(next);
    } catch (cause) {
      setGroups([]);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [activeRoot, kind]);

  useEffect(() => {
    void load();
  }, [load]);

  // Known workspace roots, read inside the subscription without re-subscribing
  // on every refresh (the subscription must stay mounted for the app lifetime).
  const knownRootsRef = useRef<ReadonlySet<string>>(new Set());
  useEffect(() => {
    knownRootsRef.current = new Set(groups.map((group) => group.root));
  }, [groups]);

  useEffect(() => {
    return subscribeToSuiteChanges((event) => {
      if (!knownRootsRef.current.has(event.root)) return;
      // Per-root incremental refresh (mockup: 目录分组随事件只更新本组).
      void suiteApi.designSuiteList(event.root, kind).then((suites) => {
        setGroups((current) => current.map((group) => (group.root === event.root ? { ...group, suites } : group)));
      });
    });
  }, [kind]);

  return (
    <section className="ui-design-directory" aria-label={title}>
      <header className="ui-design-directory-head">
        <strong>{title}</strong>
        <span>{t("designWorkspace.directoryOnly")}</span>
      </header>
      <div className="ui-design-directory-body">
        {loading ? <div className="ui-design-directory-state">{t("common.loading")}</div> : null}
        {error ? <div className="ui-design-directory-state error">{error}</div> : null}
        {!loading && !error
          ? groups.map((group) => (
              <section
                key={group.root}
                className={`ui-design-directory-group${group.root === activeRoot ? " current" : ""}`}
                data-root={group.root}
              >
                <div className="ui-design-directory-workspace">
                  <span className="ui-design-directory-dot" />
                  <strong>{group.label}</strong>
                  {group.root === activeRoot ? <i>{t("designWorkspace.current")}</i> : null}
                </div>
                <div className="ui-design-directory-items">
                  {group.suites.length === 0 ? (
                    <span className="ui-design-directory-none">{t("designWorkspace.noArtifacts")}</span>
                  ) : (
                    group.suites.map((suite) => (
                      <div className="ui-design-directory-item" key={suite.id} data-suite-id={suite.id}>
                        <span>{suite.title}</span>
                        <small>{t("designWorkspace.versionCount", { count: suite.versionCount })}</small>
                      </div>
                    ))
                  )}
                </div>
              </section>
            ))
          : null}
      </div>
    </section>
  );
}
