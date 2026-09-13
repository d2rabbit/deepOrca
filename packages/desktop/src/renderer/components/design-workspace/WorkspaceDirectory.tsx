import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type JSX,
  type MouseEvent,
} from "react";
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
  /** 打开一个工作区的设计工作台（suiteId 缺省 = 该工作台的默认套件）。
   *  tab 模型由 App 持有——目录只负责导航，不切换会话 root。 */
  onOpenWorkspace: (root: string, suiteId?: string) => void;
  /** 本 kind 的设计工作台 tab 正被查看（激活主题判定的前提）。 */
  surfaceActive?: boolean;
  /** 当前查看的套件 id（surfaceActive 时生效；缺省回退该工作区默认套件）。 */
  activeSuiteId?: string;
};

/** 未分组组的激活 key（与主题 key 同一命名空间）。 */
const UNGROUPED_KEY = "__ungrouped__";

/** 分组/激活共用的复合 key 拼法（theme id、UNGROUPED_KEY 同一命名空间）。 */
const groupKey = (root: string, id: string): string => `${root}:${id}`;

/** 套件归属的主题 id；未分组（或主题已删）返回 null。分组过滤与激活推导
 *  共用同一谓词——两处口径漂移会让激活展开指错组。 */
const themeIdOf = (group: DirectoryGroup, suite: DesignSuiteSummary): string | null =>
  suite.themeId && group.themes.some((theme) => theme.id === suite.themeId) ? suite.themeId : null;

async function readDirectoryData(root: string, kind: DesignSuiteKind) {
  const [suites, themes, titleSource] = await Promise.all([
    suiteApi.designSuiteList(root, kind),
    suiteApi.designThemeList(root).catch(() => [] as DesignTheme[]),
    suiteApi.designSuiteList(root, kind === "ui" ? "prototype" : "ui").catch(() => [] as DesignSuiteSummary[]),
  ]);
  const detailList = await Promise.all(
    suites.map((suite) => suiteApi.designSuiteRead(root, suite.id).catch(() => null))
  );
  const details: Record<string, DesignSuite | null> = {};
  suites.forEach((suite, index) => {
    details[suite.id] = detailList[index] ?? null;
  });
  return { suites, themes, titleSource, details };
}

function WorkspaceDirectoryImpl({
  activeRoot,
  kind,
  title,
  onOpenWorkspace,
  surfaceActive,
  activeSuiteId,
}: Props): JSX.Element {
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
  // 重命名输入用 ref 聚焦（effect 只在 renamingId 变化时跑一次）而非
  // autoFocus——details 因激活位翻转重挂载时不得重新抢走焦点。
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (renamingId) renameInputRef.current?.focus();
  }, [renamingId]);

  const loadGeneration = useRef(0);
  const rootGenerations = useRef(new Map<string, number>());
  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    rootGenerations.current.clear();
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
          ...(await readDirectoryData(workspace.root, kind)),
        }))
      );
      if (generation !== loadGeneration.current) return;
      setGroups(next);
    } catch (cause) {
      if (generation !== loadGeneration.current) return;
      setGroups([]);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }, [activeRoot, kind]);

  useEffect(() => {
    void load();
    const generation = loadGeneration.current;
    return () => {
      loadGeneration.current = generation + 1;
    };
  }, [load]);

  // Known workspace roots, read inside the subscription without re-subscribing
  // on every refresh (the subscription must stay mounted for the app lifetime).
  // Seeded with the ACTIVE root so events arriving before the first groups
  // commit are not dropped (re-review L9).
  const knownRootsRef = useRef<ReadonlySet<string>>(new Set([activeRoot]));
  useEffect(() => {
    knownRootsRef.current = new Set(groups.map((group) => group.root));
  }, [groups]);

  const refreshRoot = useCallback(
    async (root: string) => {
      const generation = loadGeneration.current;
      const request = (rootGenerations.current.get(root) ?? 0) + 1;
      rootGenerations.current.set(root, request);
      try {
        const data = await readDirectoryData(root, kind);
        if (generation !== loadGeneration.current || rootGenerations.current.get(root) !== request) return;
        setGroups((current) => current.map((group) => (group.root === root ? { ...group, ...data } : group)));
      } catch {
        // Keep the last snapshot until a subsequent event retries.
      }
    },
    [kind]
  );

  useEffect(() => {
    return subscribeToSuiteChanges((event) => {
      if (!knownRootsRef.current.has(event.root)) return;
      void refreshRoot(event.root);
    });
  }, [refreshRoot]);

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

  /** 导航行公共句柄：role=button + Enter/Space 激活——点击与键盘同走一个
   *  回调，键盘契约单点维护。 */
  const navHandle = (run: () => void) => ({
    role: "button" as const,
    tabIndex: 0,
    onClick: run,
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>): void => {
      if (event.target !== event.currentTarget) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        run();
      }
    },
  });

  /** 主题/未分组标题点击：组内按钮/表单不导航；空组只原生折叠不导航
   *  （导航会把用户带到别的主题的默认套件，激活高亮与点击对象脱节）；
   *  已激活组再点标题 = 仅导航，不顺手折叠组。 */
  const headNav =
    (group: DirectoryGroup, seedOpen: boolean, target: DesignSuiteSummary | undefined) =>
    (event: MouseEvent<HTMLElement>): void => {
      if ((event.target as HTMLElement).closest("button, input, form")) return;
      if (!target) return;
      if (seedOpen) event.preventDefault();
      onOpenWorkspace(group.root, target.id);
    };

  /** 激活分组 = 设计工作台正在查看的套件的主题归属（未分组套件落到未分组
   *  组）。suiteId 缺省或已失效（套件被删）时回退该工作区的默认套件——与
   *  两个工作台的 summaries[0] 口径一致，目录激活态不得与实际显示脱节。
   *  仅激活分组默认展开，其余折叠。 */
  const activeGroupKey = useMemo(() => {
    if (!surfaceActive) return null;
    const group = groups.find((item) => item.root === activeRoot);
    if (!group) return null;
    const active = activeSuiteId
      ? (group.suites.find((item) => item.id === activeSuiteId) ?? group.suites[0])
      : group.suites[0];
    if (!active) return null;
    return groupKey(group.root, themeIdOf(group, active) ?? UNGROUPED_KEY);
  }, [surfaceActive, activeSuiteId, activeRoot, groups]);

  const suiteCard = (group: DirectoryGroup, suite: DesignSuiteSummary): JSX.Element => (
    <div className="ui-design-directory-suite" key={suite.id} data-suite-id={suite.id}>
      <div
        className="ui-design-directory-item ui-design-directory-open"
        {...navHandle(() => onOpenWorkspace(group.root, suite.id))}
      >
        <span>{suite.title}</span>
        {suite.stage ? <em className="ui-design-directory-stage">{suite.stage}</em> : null}
        <small>{t("designWorkspace.versionCount", { count: suite.versionCount })}</small>
        <button
          type="button"
          className="ui-design-directory-assign"
          title={t("designTheme.assignTheme")}
          onClick={(event) => {
            event.stopPropagation();
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
        {!loading
          ? groups.map((group) => {
              // 主题分组视图（specs/prd-theme-layer）：有主题才分组；旧工作区
              // 零主题时维持既有平铺（EARS 14 零回归）。归属判定走共享谓词。
              const themed = group.suites.filter((suite) => themeIdOf(group, suite) !== null);
              const ungrouped = group.suites.filter((suite) => themeIdOf(group, suite) === null);
              const ungroupedKey = groupKey(group.root, UNGROUPED_KEY);
              const ungroupedOpen = activeGroupKey === ungroupedKey;
              return (
                <section
                  key={group.root}
                  className={`ui-design-directory-group${group.root === activeRoot ? " current" : ""}`}
                  data-root={group.root}
                >
                  <div
                    className="ui-design-directory-workspace ui-design-directory-open"
                    {...navHandle(() => onOpenWorkspace(group.root))}
                  >
                    <span className="ui-design-directory-dot" />
                    <strong>{group.label}</strong>
                    {group.root === activeRoot ? <i>{t("designWorkspace.current")}</i> : null}
                  </div>
                  <div className="ui-design-directory-path">{group.root}</div>
                  {group.themes.length > 0 ? (
                    <div className="ui-design-directory-themes">
                      {group.themes.map((theme) => {
                        const themeSuites = themed.filter((suite) => suite.themeId === theme.id);
                        const themeKey = groupKey(group.root, theme.id);
                        // 激活位进 key：激活主题切换时重挂载 <details> 播种
                        // open 属性——原生点击折叠不受重渲染回写干扰；非激活
                        // 组默认折叠（仅激活主题展开）。
                        const seedOpen = activeGroupKey === themeKey;
                        return (
                          // EARS 10 可折叠分组（交叉审查修复）：details/summary
                          // 原生折叠；标题点击同时导航到该主题的工作台。
                          <details
                            className="ui-design-directory-theme"
                            key={`${themeKey}:${seedOpen ? "open" : "closed"}`}
                            data-theme-id={theme.id}
                            open={seedOpen}
                          >
                            <summary
                              className="ui-design-directory-theme-head"
                              onClick={headNav(group, seedOpen, themeSuites[0])}
                            >
                              {renamingId === theme.id ? (
                                <form
                                  className="ui-design-directory-theme-rename"
                                  onSubmit={(event) => {
                                    event.preventDefault();
                                    void renameTheme(group.root, theme.id);
                                  }}
                                >
                                  <input
                                    ref={renameInputRef}
                                    value={renameTitle}
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
                      <details
                        className="ui-design-directory-theme ungrouped"
                        key={`${ungroupedKey}:${ungroupedOpen ? "open" : "closed"}`}
                        open={ungroupedOpen}
                      >
                        <summary
                          className="ui-design-directory-theme-head"
                          onClick={headNav(group, ungroupedOpen, ungrouped[0])}
                        >
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

/** props 全为原始值/稳定回调（onOpenWorkspace 即 hook 的 useCallback 产物）
 *  ——包 memo：App 流式期间的高频重渲染不再穿透进目录全量重渲染。 */
export const WorkspaceDirectory = memo(WorkspaceDirectoryImpl);

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
    // specs/leafer-ui-engine EARS 17 字段级双栈路由：视觉稿 = leafer（新栈）
    // 或 openui（旧栈只读）任一存在即已生成——只查 openui 曾把 leafer 套件
    // 整面误报"未生成"（p-core 真机走查发现）。
    const hasVisual = Boolean(suite.currentContent.leafer || suite.currentContent.openui);
    rows.push({
      label: t("designWorkspace.setOpenui"),
      value: hasVisual ? versionTag : t("designWorkspace.dirNotGenerated"),
      miss: !hasVisual,
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
