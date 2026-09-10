import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { useI18n } from "../../i18n";
import { subscribeToSuiteChanges, suiteApi } from "./api";
import {
  isPrototypeContent,
  isUiContent,
  type DesignSuite,
  type DesignSuiteKind,
  type DesignSuiteSummary,
  type DesignTheme,
} from "./types";

type DirectoryGroup = {
  root: string;
  label: string;
  suites: DesignSuiteSummary[];
  /** specs/prd-theme-layer：该工作区的主题列表（分组维度的数据源）。 */
  themes: DesignTheme[];
  /** 另一侧 kind 的 summaries（关系 chips 的跨面板标题解析源）。 */
  titleSource: DesignSuiteSummary[];
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
  // 主题 CRUD / 套件指派的内联编辑态（specs/prd-theme-layer WP4）。
  const [creatingFor, setCreatingFor] = useState<string | null>(null);
  const [newThemeTitle, setNewThemeTitle] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [assignThemeId, setAssignThemeId] = useState("");
  const [assignStage, setAssignStage] = useState("");

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
          const [suites, themes, titleSource] = await Promise.all([
            suiteApi.designSuiteList(workspace.root, kind),
            suiteApi.designThemeList(workspace.root).catch(() => [] as DesignTheme[]),
            // 继承/交叉参考常跨面板（UI 设计稿 ← 原型 PRD）——另一侧 kind 的
            // summaries 是关系 chips 的标题解析源。
            suiteApi
              .designSuiteList(workspace.root, kind === "ui" ? "prototype" : "ui")
              .catch(() => [] as DesignSuiteSummary[]),
          ]);
          // Three-segment rows (mockup dir-items) need the CURRENT version's
          // content — one bounded read per suite (suites per workspace ≈ 1-3).
          const detailList = await Promise.all(
            suites.map((suite) => suiteApi.designSuiteRead(workspace.root, suite.id))
          );
          const details: Record<string, DesignSuite | null> = {};
          suites.forEach((suite, index) => {
            details[suite.id] = detailList[index] ?? null;
          });
          return { root: workspace.root, label: workspace.label, suites, themes, titleSource, details };
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
      // 主题事件（change:"theme"）同时刷新主题列表与套件列表（分组归属变化
      // 也反映在 suites summary 上）。
      void suiteApi
        .designSuiteList(event.root, kind)
        .then((suites) => {
          setGroups((current) => current.map((group) => (group.root === event.root ? { ...group, suites } : group)));
        })
        .catch(() => {
          // re-review L9: an unhandled rejection on a failed refresh must not
          // surface as a renderer error — the next event retries.
        });
      if (event.change === "theme") {
        void suiteApi
          .designThemeList(event.root)
          .then((themes) => {
            setGroups((current) => current.map((group) => (group.root === event.root ? { ...group, themes } : group)));
          })
          .catch(() => {
            // 下一次事件重试。
          });
      }
    });
  }, [kind]);

  /** 主题/指派写操作后的兜底刷新（store 事件也会触发增量刷新，双保险）。 */
  const refreshRoot = useCallback(
    async (root: string) => {
      try {
        const [suites, themes] = await Promise.all([
          suiteApi.designSuiteList(root, kind),
          suiteApi.designThemeList(root).catch(() => [] as DesignTheme[]),
        ]);
        setGroups((current) => current.map((group) => (group.root === root ? { ...group, suites, themes } : group)));
      } catch {
        // 失败留给下一次事件/手动刷新。
      }
    },
    [kind]
  );

  // 交叉审查修复：四个主题写路径统一失败显面——{ok:false} 不再静默吞掉
  // （否则指派/重命名在主题被并发删除时看似成功），IPC 异常不再变成
  // unhandled rejection（re-review L9 同款纪律）。
  const surfaceThemeError = (message: string): void => {
    setError(message);
  };

  const createTheme = async (root: string): Promise<void> => {
    const trimmed = newThemeTitle.trim();
    if (!trimmed) return;
    try {
      const result = await suiteApi.designThemeCreate(root, { title: trimmed });
      if (!result.ok) {
        surfaceThemeError(result.error ?? t("designTheme.opFailed"));
        return;
      }
      setCreatingFor(null);
      setNewThemeTitle("");
      setError(null);
      await refreshRoot(root);
    } catch (cause) {
      surfaceThemeError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const renameTheme = async (root: string, id: string): Promise<void> => {
    const trimmed = renameTitle.trim();
    if (!trimmed) return;
    try {
      const result = await suiteApi.designThemeUpdate(root, id, { title: trimmed });
      if (!result.ok) {
        surfaceThemeError(result.error ?? t("designTheme.opFailed"));
        return;
      }
      setRenamingId(null);
      setError(null);
      await refreshRoot(root);
    } catch (cause) {
      surfaceThemeError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const deleteTheme = async (root: string, id: string): Promise<void> => {
    try {
      const result = await suiteApi.designThemeDelete(root, id);
      if (!result.ok) {
        surfaceThemeError(result.error ?? t("designTheme.opFailed"));
        return;
      }
      setDeletingId(null);
      setError(null);
      await refreshRoot(root);
    } catch (cause) {
      surfaceThemeError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const saveAssign = async (root: string, suiteId: string): Promise<void> => {
    try {
      const result = await suiteApi.designSuiteAssignTheme(root, suiteId, {
        themeId: assignThemeId || null,
        stage: assignStage.trim() || null,
      });
      if (!result.ok) {
        surfaceThemeError(result.error ?? t("designTheme.opFailed"));
        return;
      }
      setAssigningId(null);
      setError(null);
      await refreshRoot(root);
    } catch (cause) {
      surfaceThemeError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  /** 关系 chips 的目标套件标题（本 kind 优先，跨 kind 次之，降级 suiteId）。 */
  const titleOf = (group: DirectoryGroup, suiteId: string): string =>
    group.suites.find((candidate) => candidate.id === suiteId)?.title ??
    group.titleSource.find((candidate) => candidate.id === suiteId)?.title ??
    suiteId;

  const suiteCard = (group: DirectoryGroup, suite: DesignSuiteSummary): JSX.Element => (
    <div className="ui-design-directory-suite" key={suite.id} data-suite-id={suite.id}>
      <div className="ui-design-directory-item">
        <span>{suite.title}</span>
        {suite.stage ? <em className="ui-design-directory-stage">{suite.stage}</em> : null}
        <small>{t("designWorkspace.versionCount", { count: suite.versionCount })}</small>
        <button
          type="button"
          className="ui-design-directory-assign"
          title={t("designTheme.assignTheme")}
          onClick={() => {
            setAssigningId(assigningId === suite.id ? null : suite.id);
            setAssignThemeId(suite.themeId ?? "");
            setAssignStage(suite.stage ?? "");
          }}
        >
          ⋯
        </button>
      </div>
      {(suite.inherits || (suite.references && suite.references.length > 0)) &&
      (group.themes.length > 0 || suite.themeId) ? (
        <div className="ui-design-directory-relations">
          {suite.inherits ? (
            <span className="ui-design-theme-relation inherits">
              {t("designTheme.inheritsFrom")} {titleOf(group, suite.inherits.suiteId)}
            </span>
          ) : null}
          {(suite.references ?? []).map((ref) => (
            <span className="ui-design-theme-relation cross" key={`${ref.suiteId}@${ref.versionId ?? "head"}`}>
              {t("designTheme.references")} {titleOf(group, ref.suiteId)}
            </span>
          ))}
        </div>
      ) : null}
      {assigningId === suite.id ? (
        <div className="ui-design-directory-assign-form">
          <label>
            <span>{t("designTheme.assignTheme")}</span>
            <select value={assignThemeId} onChange={(event) => setAssignThemeId(event.target.value)}>
              <option value="">{t("designTheme.ungrouped")}</option>
              {group.themes.map((theme) => (
                <option key={theme.id} value={theme.id}>
                  {theme.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{t("designTheme.stageLabel")}</span>
            <input
              value={assignStage}
              placeholder={t("designTheme.stagePlaceholder")}
              onChange={(event) => setAssignStage(event.target.value)}
            />
          </label>
          <div className="ui-design-directory-assign-actions">
            <button type="button" onClick={() => void saveAssign(group.root, suite.id)}>
              {t("common.save")}
            </button>
            <button type="button" onClick={() => setAssigningId(null)}>
              {t("common.cancel")}
            </button>
          </div>
        </div>
      ) : null}
      <DirectorySegments suite={group.details[suite.id] ?? null} kind={kind} />
    </div>
  );

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
          ? groups.map((group) => {
              // 主题分组视图（specs/prd-theme-layer）：有主题才分组；旧工作区
              // 零主题时维持既有平铺（EARS 14 零回归）。
              const themed = group.suites.filter(
                (suite) => suite.themeId && group.themes.some((theme) => theme.id === suite.themeId)
              );
              const ungrouped = group.suites.filter(
                (suite) => !suite.themeId || !group.themes.some((theme) => theme.id === suite.themeId)
              );
              return (
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
                  {group.themes.length > 0 ? (
                    <div className="ui-design-directory-themes">
                      {group.themes.map((theme) => {
                        const themeSuites = themed.filter((suite) => suite.themeId === theme.id);
                        return (
                          // EARS 10 可折叠分组（交叉审查修复）：details/summary
                          // 原生折叠，默认展开。
                          <details className="ui-design-directory-theme" key={theme.id} data-theme-id={theme.id} open>
                            <summary className="ui-design-directory-theme-head">
                              {renamingId === theme.id ? (
                                <form
                                  className="ui-design-directory-theme-rename"
                                  onSubmit={(event) => {
                                    event.preventDefault();
                                    void renameTheme(group.root, theme.id);
                                  }}
                                >
                                  <input
                                    value={renameTitle}
                                    autoFocus
                                    onChange={(event) => setRenameTitle(event.target.value)}
                                    onKeyDown={(event) => {
                                      if (event.key === "Escape") setRenamingId(null);
                                    }}
                                  />
                                  <button type="submit">{t("common.save")}</button>
                                  <button type="button" onClick={() => setRenamingId(null)}>
                                    {t("common.cancel")}
                                  </button>
                                </form>
                              ) : (
                                <>
                                  <span className="ui-design-directory-dot theme" />
                                  <strong>{theme.title}</strong>
                                  <small>{themeSuites.length}</small>
                                  <button
                                    type="button"
                                    title={t("designTheme.renameTheme")}
                                    onClick={() => {
                                      setRenamingId(theme.id);
                                      setRenameTitle(theme.title);
                                    }}
                                  >
                                    ✎
                                  </button>
                                  {deletingId === theme.id ? (
                                    <>
                                      <button
                                        type="button"
                                        className="danger"
                                        onClick={() => void deleteTheme(group.root, theme.id)}
                                      >
                                        {t("designTheme.confirmDelete")}
                                      </button>
                                      <button type="button" onClick={() => setDeletingId(null)}>
                                        {t("common.cancel")}
                                      </button>
                                    </>
                                  ) : (
                                    <button
                                      type="button"
                                      title={t("designTheme.deleteThemeHint")}
                                      onClick={() => setDeletingId(theme.id)}
                                    >
                                      ✕
                                    </button>
                                  )}
                                </>
                              )}
                            </summary>
                            <div className="ui-design-directory-items">
                              {themeSuites.length === 0 ? (
                                <span className="ui-design-directory-none">{t("designTheme.emptyTheme")}</span>
                              ) : (
                                themeSuites.map((suite) => suiteCard(group, suite))
                              )}
                            </div>
                          </details>
                        );
                      })}
                      <details className="ui-design-directory-theme ungrouped" open>
                        <summary className="ui-design-directory-theme-head">
                          <span className="ui-design-directory-dot" />
                          <strong>{t("designTheme.ungrouped")}</strong>
                          <small>{ungrouped.length}</small>
                        </summary>
                        <div className="ui-design-directory-items">
                          {ungrouped.length === 0 ? (
                            <span className="ui-design-directory-none">{t("designTheme.emptyTheme")}</span>
                          ) : (
                            ungrouped.map((suite) => suiteCard(group, suite))
                          )}
                        </div>
                      </details>
                    </div>
                  ) : (
                    <div className="ui-design-directory-items">
                      {group.suites.length === 0 ? (
                        <span className="ui-design-directory-none">{t("designWorkspace.noArtifacts")}</span>
                      ) : (
                        group.suites.map((suite) => suiteCard(group, suite))
                      )}
                    </div>
                  )}
                  {creatingFor === group.root ? (
                    <form
                      className="ui-design-directory-theme-create"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void createTheme(group.root);
                      }}
                    >
                      <input
                        value={newThemeTitle}
                        autoFocus
                        placeholder={t("designTheme.themeTitlePlaceholder")}
                        onChange={(event) => setNewThemeTitle(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") setCreatingFor(null);
                        }}
                      />
                      <button type="submit">{t("common.save")}</button>
                      <button type="button" onClick={() => setCreatingFor(null)}>
                        {t("common.cancel")}
                      </button>
                    </form>
                  ) : (
                    <button
                      type="button"
                      className="ui-design-directory-theme-new"
                      onClick={() => {
                        setCreatingFor(group.root);
                        setNewThemeTitle("");
                      }}
                    >
                      + {t("designTheme.newTheme")}
                    </button>
                  )}
                </section>
              );
            })
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
        : t("designWorkspace.dirNotRun"),
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
