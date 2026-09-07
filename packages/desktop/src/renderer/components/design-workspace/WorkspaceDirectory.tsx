import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { useI18n } from "../../i18n";
import { subscribeToSuiteChanges, suiteApi } from "./api";
import {
  isPrototypeContent,
  isUiContent,
  type DesignSuite,
  type DesignSuiteKind,
  type DesignSuiteSummary,
} from "./types";

type DirectoryGroup = {
  root: string;
  label: string;
  suites: DesignSuiteSummary[];
  /** Full current suite (versions + content) per summary id — powers the
   *  three-segment artifact rows; null when the read failed. */
  details: Record<string, DesignSuite | null>;
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
        workspaces.map(async (workspace) => {
          const suites = await suiteApi.designSuiteList(workspace.root, kind);
          // Three-segment rows (mockup dir-items) need the CURRENT version's
          // content — one bounded read per suite (suites per workspace ≈ 1-3).
          const detailList = await Promise.all(
            suites.map((suite) => suiteApi.designSuiteRead(workspace.root, suite.id))
          );
          const details: Record<string, DesignSuite | null> = {};
          suites.forEach((suite, index) => {
            details[suite.id] = detailList[index] ?? null;
          });
          return { root: workspace.root, label: workspace.label, suites, details };
        })
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
  // Seeded with the ACTIVE root so events arriving before the first groups
  // commit are not dropped (re-review L9).
  const knownRootsRef = useRef<ReadonlySet<string>>(new Set([activeRoot]));
  useEffect(() => {
    knownRootsRef.current = new Set(groups.map((group) => group.root));
  }, [groups]);

  useEffect(() => {
    return subscribeToSuiteChanges((event) => {
      if (!knownRootsRef.current.has(event.root)) return;
      // Per-root incremental refresh (mockup: 目录分组随事件只更新本组).
      void suiteApi
        .designSuiteList(event.root, kind)
        .then((suites) => {
          setGroups((current) => current.map((group) => (group.root === event.root ? { ...group, suites } : group)));
        })
        .catch(() => {
          // re-review L9: an unhandled rejection on a failed refresh must not
          // surface as a renderer error — the next event retries.
        });
    });
  }, [kind]);

  return (
    <section className="ui-design-directory" aria-label={title}>
      <header className="ui-design-directory-head">
        <strong>{title}</strong>
        <span>{t("designWorkspace.directoryOnly")}</span>
      </header>
      <p className="ui-design-directory-chain">
        {kind === "prototype" ? t("prototypeWorkspace.dirChainPrototype") : t("designWorkspace.dirChainDesign")}
      </p>
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
                <div className="ui-design-directory-path">{group.root}</div>
                <div className="ui-design-directory-items">
                  {group.suites.length === 0 ? (
                    <span className="ui-design-directory-none">{t("designWorkspace.noArtifacts")}</span>
                  ) : (
                    group.suites.map((suite) => (
                      <div className="ui-design-directory-suite" key={suite.id} data-suite-id={suite.id}>
                        <div className="ui-design-directory-item">
                          <span>{suite.title}</span>
                          <small>{t("designWorkspace.versionCount", { count: suite.versionCount })}</small>
                        </div>
                        <DirectorySegments suite={group.details[suite.id] ?? null} kind={kind} />
                      </div>
                    ))
                  )}
                </div>
              </section>
            ))
          : null}
      </div>
      <p className="ui-design-directory-note">{t("designWorkspace.dirNote")}</p>
    </section>
  );
}

function DirectorySegments({ suite, kind }: { suite: DesignSuite | null; kind: DesignSuiteKind }): JSX.Element | null {
  const { t } = useI18n();
  if (!suite || !suite.currentVersion) {
    return (
      <div className="ui-design-directory-seg">
        <span className="miss">{t("designWorkspace.dirNotGenerated")}</span>
      </div>
    );
  }
  const versionTag = `v${Math.max(1, suite.versions.findIndex((v) => v.versionId === suite.currentVersionId) + 1)}`;
  const status = t(`designWorkspace.status.${suite.status}`);
  const rows: Array<{ label: string; value: string; miss?: boolean }> = [];
  if (kind === "prototype" && isPrototypeContent(suite.currentContent)) {
    const verification = suite.currentContent.verification;
    const passed = verification?.checks.filter((check) => check.status === "passed").length ?? 0;
    rows.push({
      label: t("prototypeWorkspace.setTitleSpec"),
      value: suite.currentContent.spec ? `${versionTag} · ${status}` : t("designWorkspace.dirNotGenerated"),
      miss: !suite.currentContent.spec,
    });
    rows.push({
      label: t("prototypeWorkspace.setTitleProto"),
      value: suite.currentContent.openui ? versionTag : t("designWorkspace.dirNotGenerated"),
      miss: !suite.currentContent.openui,
    });
    rows.push({
      label: t("prototypeWorkspace.setTitleReport"),
      value: verification
        ? `${t("designWorkspace.dirPassedTotal", {
            passed,
            total: verification.checks.length,
          })} · ${t("designWorkspace.dirSelfHeal", { count: verification.healingRounds ?? 0 })}`
        : t("prototypeWorkspace.dirNotRun"),
      miss: !verification,
    });
  } else if (kind === "ui" && isUiContent(suite.currentContent)) {
    const tokenCount = suite.currentContent.tokens
      ? Object.keys(suite.currentContent.tokens as Record<string, unknown>).length
      : 0;
    const review = suite.currentContent.quality?.review;
    rows.push({
      label: t("designWorkspace.setOpenui"),
      value: suite.currentContent.openui ? versionTag : t("designWorkspace.dirNotGenerated"),
      miss: !suite.currentContent.openui,
    });
    rows.push({
      label: t("designWorkspace.setTokens"),
      value:
        tokenCount > 0
          ? t("designWorkspace.dirItemsCount", { count: tokenCount })
          : t("designWorkspace.dirNotGenerated"),
      miss: tokenCount === 0,
    });
    rows.push({
      label: t("designWorkspace.setQuality"),
      value: review ? `${t("designWorkspace.reviewScore")} ${review.composite}` : t("designWorkspace.dirNotRun"),
      miss: !review,
    });
  } else {
    rows.push({ label: t("designWorkspace.versionCount", { count: suite.versions.length }), value: status });
  }
  return (
    <div className="ui-design-directory-seg">
      {rows.map((row) => (
        <div className="ui-design-directory-item" key={row.label}>
          <span>{row.label}</span>
          <small className={row.miss ? "miss" : undefined}>{row.value}</small>
        </div>
      ))}
    </div>
  );
}
