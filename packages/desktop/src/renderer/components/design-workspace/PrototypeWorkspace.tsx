import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";
import { api } from "../../api";
import { useI18n } from "../../i18n";
import { pushDesignToast } from "../../lib/toast-bus";
import { IconCheck, IconClose, IconFile, IconPalette, IconRefresh, IconSparkle } from "../../ui/icons";
import { PrototypePanel, type PrototypeSelection } from "../PrototypePanel";
import { subscribeToSuiteChanges, suiteApi } from "./api";
import { DesignWorkspaceFrame, versionLabel } from "./DesignWorkspaceFrame";
import { FloatingDesignAgent } from "./FloatingDesignAgent";
import { isTerminalProgress, progressLabel } from "./progress-label";
import { SelectionPopover, type WorkspaceSelection } from "./SelectionPopover";
import { diffLines, summarizeDiff } from "./diff";
import type { DesignSuite, DesignSuiteVersion, PrototypeSuiteContent } from "./types";
import { isPrototypeContent } from "./types";

type PrototypeTab = "spec" | "proto" | "report";

export type PrototypeWorkspaceProps = {
  root: string;
  suiteId?: string;
  /** Hash deep link / surface tab segment (validated against the tab union). */
  initialTab?: string;
  onBack?: () => void;
  onQuoteToChat?: (quote: string) => void;
};

function actionError(result: Awaited<ReturnType<typeof api.actionRun>>): string | null {
  if (!result.ok) return result.error;
  if (typeof result.output !== "object" || result.output === null || !("ok" in result.output)) return null;
  const output = result.output as { ok?: boolean; error?: string };
  return output.ok === false ? (output.error ?? "Action failed") : null;
}

function artifactRefFromResult(
  result: Awaited<ReturnType<typeof api.actionRun>>
): { suiteId: string; versionId: string } | null {
  if (!result.ok || typeof result.output !== "object" || result.output === null) return null;
  const output = result.output as { artifactRef?: unknown };
  if (!output.artifactRef || typeof output.artifactRef !== "object") return null;
  const ref = output.artifactRef as { suiteId?: unknown; versionId?: unknown };
  return typeof ref.suiteId === "string" && typeof ref.versionId === "string"
    ? { suiteId: ref.suiteId, versionId: ref.versionId }
    : null;
}

function markdownSections(markdown: string): Array<{ heading: string; body: string }> {
  const sections: Array<{ heading: string; body: string }> = [];
  let heading = "";
  let body: string[] = [];
  const flush = () => {
    const text = body.join("\n").trim();
    if (heading || text) sections.push({ heading, body: text });
    body = [];
  };
  for (const line of markdown.split("\n")) {
    const match = /^#{1,3}\s+(.+)$/.exec(line);
    if (match) {
      flush();
      heading = match[1];
    } else {
      body.push(line);
    }
  }
  flush();
  return sections;
}

const tabs: readonly PrototypeTab[] = ["spec", "proto", "report"];

export function PrototypeWorkspace({
  root,
  suiteId,
  initialTab,
  onBack,
  onQuoteToChat,
}: PrototypeWorkspaceProps): JSX.Element {
  const { t } = useI18n();
  const [suite, setSuite] = useState<DesignSuite | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<DesignSuiteVersion | null>(null);
  const validInitial: PrototypeTab = initialTab === "proto" || initialTab === "report" ? initialTab : "spec";
  const [tab, setTab] = useState<PrototypeTab>(validInitial);
  useEffect(() => {
    // Mid-session deep links (#prototype/report) retarget the open workspace.
    if (initialTab === "spec" || initialTab === "proto" || initialTab === "report") setTab(initialTab);
  }, [initialTab]);
  const [requirement, setRequirement] = useState("");
  const [selection, setSelection] = useState<WorkspaceSelection | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [device, setDevice] = useState<"desktop" | "mobile" | "tablet">("desktop");
  /** Confirmed 待确认 items (per selected version, session scope). */
  const [confirmedSpecItems, setConfirmedSpecItems] = useState<ReadonlySet<string>>(new Set());
  const [diff, setDiff] = useState<{ added: number; removed: number; lines: string[] } | null>(null);

  const loadSeq = useRef(0);
  /** Suite currently viewed — re-targets clear the per-suite surfaces (M5). */
  const viewedSuiteIdRef = useRef<string | null>(null);
  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    setError(null);
    try {
      const summaries = await suiteApi.designSuiteList(root, "prototype");
      if (seq !== loadSeq.current) return;
      const targetId = suiteId && summaries.some((item) => item.id === suiteId) ? suiteId : summaries[0]?.id;
      if (!targetId) {
        setSuite(null);
        setSelectedVersion(null);
        return;
      }
      const next = await suiteApi.designSuiteRead(root, targetId);
      if (seq !== loadSeq.current) return;
      if ((next?.id ?? null) !== viewedSuiteIdRef.current) {
        // Re-target (suiteId prop change): clear the stale selection/diff so
        // an old-canvas popover cannot revise the NEW suite (re-review M5).
        viewedSuiteIdRef.current = next?.id ?? null;
        setSelection(null);
        setDiff(null);
        setConfirmedSpecItems(new Set());
      }
      setSuite(next);
      // Keep the user's version selection across background refreshes.
      setSelectedVersion((prev) =>
        prev && next?.versions.some((version) => version.versionId === prev.versionId)
          ? prev
          : (next?.currentVersion ?? null)
      );
    } catch (cause) {
      if (seq === loadSeq.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [root, suiteId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    return subscribeToSuiteChanges((event) => {
      if (event.root === root && (!suiteId || event.suiteId === suiteId)) void load();
    });
  }, [load, root, suiteId]);

  const selectVersion = useCallback(
    async (versionId: string) => {
      if (!suite) return;
      const cached = suite.versions.find((version) => version.versionId === versionId);
      setSelectedVersion(cached ?? (await suiteApi.designSuiteReadVersion(root, suite.id, versionId)));
      setSelection(null);
      setDiff(null);
      setConfirmedSpecItems(new Set());
    },
    [root, suite]
  );

  /** Live action progress for the currently busy step (generation / walkthrough). */
  useEffect(() => {
    if (!busy) {
      setProgress(null);
      return;
    }
    return api.onActionProgress((event) => {
      if (event.actionId !== busy) return;
      // Per-workspace multiplexing: ignore runs belonging to another root.
      if (event.root && event.root !== root) return;
      // Re-review L7: skip the raw unlocalized terminal "done" marker.
      if (isTerminalProgress(event)) return;
      setProgress(progressLabel(event, t));
    });
  }, [busy, root, t]);

  /** 待确认 items are confirmed page-local (mockup 2026-09: 勾选→定稿→一键生成),
   *  not one LLM rewrite + version per item. */
  useEffect(() => {
    setConfirmedSpecItems(new Set());
  }, [selectedVersion?.versionId]);

  const content: PrototypeSuiteContent =
    selectedVersion && isPrototypeContent(selectedVersion.content) ? selectedVersion.content : {};
  /** 待确认 items extracted from the spec's 待确认 section list. */
  const specTodos = useMemo(() => {
    if (!content.spec) return [] as string[];
    const lines = content.spec.split("\n");
    const start = lines.findIndex((line) => line.includes("待确认"));
    if (start === -1) return [];
    return lines
      .slice(start + 1)
      .filter((line) => /^\s*[-*]\s+/.test(line))
      .map((line) => line.replace(/^\s*[-*]\s+/, "").trim())
      .filter(Boolean);
  }, [content.spec]);
  const pendingSpecTodos = useMemo(
    () => specTodos.filter((item) => !confirmedSpecItems.has(item)),
    [specTodos, confirmedSpecItems]
  );

  /** Report grouping (mockup rp-file): checks clustered by their action's
   *  namespace ("auth:submit" → "auth"); checks without an action land in
   *  「通用」. Insertion-ordered so first appearance drives group order. */
  const checkGroups = useMemo(() => {
    const checks = content.verification?.checks ?? [];
    const grouped = new Map<string, Array<(typeof checks)[number]>>();
    for (const check of checks) {
      const namespace = check.action?.split(":")[0]?.trim() || t("prototypeWorkspace.checkGroupOther");
      const rows = grouped.get(namespace) ?? [];
      rows.push(check);
      grouped.set(namespace, rows);
    }
    return [...grouped.entries()].map(([namespace, checks]) => ({ namespace, checks }));
  }, [content.verification, t]);
  const failedCheckCount = (content.verification?.checks ?? []).filter((check) => check.status === "failed").length;

  /** mockup ✦一键修复全部未过项：逐项派发修订（每次自愈生成一个新版本），
   *  单项失败即停——错误已在工作区错误条可见。 */
  const fixAllFailed = async (): Promise<void> => {
    const failed = (content.verification?.checks ?? []).filter((check) => check.status === "failed");
    for (const check of failed) {
      const applied = await revise(check.observation ?? check.label);
      if (!applied) break;
    }
  };

  /** Clearing the last pending item toasts the 定稿 state (mockup 待确认清零). */
  const hadPendingRef = useRef(false);
  useEffect(() => {
    if (specTodos.length === 0) {
      hadPendingRef.current = false;
      return;
    }
    if (pendingSpecTodos.length > 0) {
      hadPendingRef.current = true;
      return;
    }
    if (hadPendingRef.current) {
      hadPendingRef.current = false;
      pushDesignToast("success", t("prototypeWorkspace.pendingCleared"));
    }
  }, [pendingSpecTodos.length, specTodos.length, t]);
  const readOnly = Boolean(suite && selectedVersion && selectedVersion.versionId !== suite.currentVersionId);

  const selectArtifactRef = useCallback(
    async (ref: { suiteId: string; versionId: string }) => {
      const [nextSuite, nextVersion] = await Promise.all([
        suiteApi.designSuiteRead(root, ref.suiteId),
        suiteApi.designSuiteReadVersion(root, ref.suiteId, ref.versionId),
      ]);
      if (nextSuite) setSuite(nextSuite);
      setSelectedVersion(
        nextVersion ?? nextSuite?.versions.find((version) => version.versionId === ref.versionId) ?? null
      );
      setSelection(null);
    },
    [root]
  );

  const runAction = useCallback(
    async (id: string, input: Record<string, unknown>) => {
      if (busy || readOnly) return null;
      setBusy(id);
      setError(null);
      try {
        const result = await api.actionRun(id, { root, ...input });
        const failure = actionError(result);
        if (failure) {
          setError(failure);
          return null;
        }
        const ref = artifactRefFromResult(result);
        if (ref) await selectArtifactRef(ref);
        else await load();
        return ref;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        return null;
      } finally {
        setBusy(null);
      }
    },
    [busy, load, readOnly, root, selectArtifactRef]
  );

  const runSpec = () => {
    const text = requirement.trim();
    if (!text) return;
    void runAction("prototype.spec", { requirement: text, ...(suite ? { suiteId: suite.id } : {}) });
  };

  const materialize = () => {
    if (!suite || !selectedVersion) return;
    void runAction("prototype.materialize", { suiteId: suite.id, versionId: selectedVersion.versionId });
  };

  const verify = () => {
    if (!suite || !selectedVersion) return;
    void (async () => {
      const ref = await runAction("prototype.verify", { suiteId: suite.id, versionId: selectedVersion.versionId });
      if (ref) pushDesignToast("success", t("prototypeWorkspace.toastVerified"));
    })();
  };

  /** Export the selected suite version as .ddp and toast the outcome. */
  const exportVersion = async () => {
    if (!suite || !selectedVersion) return;
    const result = await suiteApi.designSuiteExportPackage(root, suite.id, selectedVersion.versionId);
    if (result.ok && result.path) {
      pushDesignToast("success", t("designWorkspace.toastExported", { path: result.path }));
    } else if (!result.ok) {
      pushDesignToast("error", t("designWorkspace.toastExportFailed", { error: result.error ?? "" }));
    }
  };

  const revise = async (instruction: string, target?: string): Promise<boolean> => {
    if (!suite || !selectedVersion) return false;
    const part = tab === "proto" ? "openui" : tab === "report" ? "verification" : "spec";
    const before = part === "spec" ? (content.spec ?? null) : part === "openui" ? (content.openui ?? null) : null;
    const ref = await runAction("prototype.revise", {
      suiteId: suite.id,
      versionId: selectedVersion.versionId,
      part,
      target: target ?? part,
      instruction,
    });
    if (!ref) return false;
    pushDesignToast("success", t("designWorkspace.toastRevised"));
    if (!before) return true;
    const version = await suiteApi.designSuiteReadVersion(root, ref.suiteId, ref.versionId);
    const next = version && isPrototypeContent(version.content) ? version.content : null;
    if (!next) return true;
    const after = part === "spec" ? (next.spec ?? null) : part === "openui" ? (next.openui ?? null) : null;
    if (!after) return true;
    const { added, removed } = diffLines(before, after);
    if (added.length || removed.length) setDiff(summarizeDiff({ added, removed }));
    return true;
  };

  const executePrototypeAction = (action: string) => {
    void revise(t("prototypeWorkspace.executeInstruction", { action }), selection?.nodePath);
  };

  // Memoized (re-review M3): a fresh identity per render made PrototypePanel's
  // selection-effect resubscribe and re-emit on every workspace re-render.
  const handlePrototypeSelection = useCallback((next: PrototypeSelection | null) => {
    setSelection(next ? { nodePath: next.nodePath, action: next.action, bounds: next.bounds } : null);
  }, []);

  const tabLabels = useMemo(
    () => ({
      spec: t("prototypeWorkspace.tabSpec"),
      proto: t("prototypeWorkspace.tabPrototype"),
      report: t("prototypeWorkspace.tabReport"),
    }),
    [t]
  );
  const quickItems: Record<PrototypeTab, readonly string[]> = {
    spec: [
      t("prototypeWorkspace.quickSpecOne"),
      t("prototypeWorkspace.quickSpecTwo"),
      t("prototypeWorkspace.quickSpecThree"),
    ],
    proto: [
      t("prototypeWorkspace.quickProtoOne"),
      t("prototypeWorkspace.quickProtoTwo"),
      t("prototypeWorkspace.quickProtoThree"),
    ],
    report: [
      t("prototypeWorkspace.quickReportOne"),
      t("prototypeWorkspace.quickReportTwo"),
      t("prototypeWorkspace.quickReportThree"),
    ],
  };

  return (
    <DesignWorkspaceFrame
      root={root}
      tabs={tabs.map((id) => ({ id, label: tabLabels[id] }))}
      activeTab={tab}
      onTabChange={(next) => {
        setTab(next);
        if (next !== "proto") setSelection(null);
      }}
      versions={suite?.versions ?? []}
      selectedVersionId={selectedVersion?.versionId}
      latestVersionId={suite?.currentVersionId}
      onVersionChange={(versionId) => void selectVersion(versionId)}
      versionCap={t("prototypeWorkspace.versionCapProto")}
      hint={
        selectedVersion
          ? t("prototypeWorkspace.scopeHint", {
              version: versionLabel(suite?.versions, selectedVersion.versionId) ?? "-",
            })
          : undefined
      }
      versionDetail={(version) => {
        if (!isPrototypeContent(version.content)) return null;
        return (
          <span className="ui-design-version-set">
            <i className={version.content.spec ? undefined : "miss"}>{t("prototypeWorkspace.setTitleSpec")}</i>
            <i className={version.content.openui ? undefined : "miss"}>{t("prototypeWorkspace.setTitleProto")}</i>
            <i className={version.content.verification ? undefined : "miss"}>
              {t("prototypeWorkspace.setTitleReport")}
            </i>
          </span>
        );
      }}
      loading={loading}
      empty={!suite}
      error={error}
      onBack={onBack}
    >
      <div className="ui-design-workspace-content" data-active-tab={tab}>
        {diff ? (
          <aside className="ui-design-diff-card">
            <header>
              <strong>{t("designWorkspace.diffTitle")}</strong>
              <span className="stat add">+{diff.added}</span>
              <span className="stat del">−{diff.removed}</span>
              <button type="button" onClick={() => setDiff(null)} aria-label={t("common.close")}>
                <IconClose />
              </button>
            </header>
            <pre>{diff.lines.join("\n")}</pre>
          </aside>
        ) : null}
        {tab === "spec" ? (
          <article className="ui-report-doc ui-design-spec-document">
            <div className="ui-report-doc-head">
              <h1>{t("prototypeWorkspace.specTitle")}</h1>
              {selectedVersion ? (
                <span className="ui-report-meta">
                  {t("prototypeWorkspace.specMeta", {
                    version: versionLabel(suite?.versions, selectedVersion.versionId) ?? "-",
                  })}
                </span>
              ) : null}
            </div>
            <div className="ui-design-spec-card">
              <label htmlFor="ui-design-spec-input">{t("prototypeWorkspace.requirementPrompt")}</label>
              <textarea
                id="ui-design-spec-input"
                value={requirement}
                disabled={busy !== null || readOnly}
                placeholder={t("prototypeWorkspace.requirementPrompt")}
                onChange={(event) => setRequirement(event.target.value)}
              />
              <footer>
                <span className="hint">{t("prototypeWorkspace.specHint")}</span>
                <button type="button" disabled={!requirement.trim() || busy !== null || readOnly} onClick={runSpec}>
                  <IconFile /> {t("prototypeWorkspace.generateSpec")}
                </button>
              </footer>
              {busy === "prototype.spec" && progress ? <div className="ui-design-gen-progress">{progress}</div> : null}
            </div>
            {content.spec ? (
              markdownSections(content.spec).map((section, index) => (
                <section className="ui-design-spec-section" key={`${section.heading}-${index}`}>
                  {section.heading ? <h2>{section.heading}</h2> : null}
                  <p>{section.body}</p>
                </section>
              ))
            ) : (
              <div className="ui-report-empty">{t("prototypeWorkspace.noSpec")}</div>
            )}
            {/* 待确认逐条勾选（页内定稿流，确认不派发动作/不建版本）。 */}
            {specTodos.length > 0 ? (
              <section className="ui-design-spec-section ui-design-spec-todos">
                <header className="ui-design-spec-todos-head">
                  <h2>{t("prototypeWorkspace.todosTitle")}</h2>
                  <span className={pendingSpecTodos.length ? "pending" : "done"}>
                    {t("prototypeWorkspace.pendingCount", { count: pendingSpecTodos.length })}
                  </span>
                </header>
                {specTodos.map((item) => {
                  const done = confirmedSpecItems.has(item) || readOnly;
                  return (
                    <div className="ui-design-spec-todo" key={item}>
                      <span>{item}</span>
                      <button
                        type="button"
                        disabled={done || busy !== null}
                        onClick={() => setConfirmedSpecItems((prev) => new Set(prev).add(item))}
                      >
                        {done ? `✓ ${t("prototypeWorkspace.confirmedItem")}` : t("prototypeWorkspace.confirmItem")}
                      </button>
                    </div>
                  );
                })}
              </section>
            ) : null}
            {content.spec ? (
              <div className="ui-design-spec-cta">
                <button
                  type="button"
                  disabled={busy !== null || readOnly || pendingSpecTodos.length > 0}
                  title={pendingSpecTodos.length > 0 ? t("prototypeWorkspace.pendingHint") : undefined}
                  onClick={materialize}
                >
                  <IconPalette /> {t("prototypeWorkspace.materialize")}
                </button>
              </div>
            ) : null}
          </article>
        ) : null}

        {tab === "proto" ? (
          <section
            className="ui-design-preview-stage"
            onClick={(event) => event.target === event.currentTarget && setSelection(null)}
          >
            <div className="ui-design-toolbar compact">
              {selectedVersion ? (
                <>
                  <span className="ui-design-vbadge">
                    {versionLabel(suite?.versions, selectedVersion.versionId) ?? "-"} ·{" "}
                    {t(`designWorkspace.status.${selectedVersion.status}`)}
                  </span>
                  {content.verification ? (
                    <span className="ui-design-vnote">
                      {t("prototypeWorkspace.vbadgeNote", {
                        passed: content.verification.checks.filter((check) => check.status === "passed").length,
                        total: content.verification.checks.length,
                        heal: content.verification.healingRounds ?? 0,
                      })}
                    </span>
                  ) : null}
                </>
              ) : null}
              <div className="seg">
                {(["desktop", "mobile", "tablet"] as const).map((d) => (
                  <button key={d} type="button" className={device === d ? "on" : ""} onClick={() => setDevice(d)}>
                    {t(`prototypeWorkspace.device.${d}`)}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="primary"
                disabled={!content.spec || busy !== null || readOnly}
                onClick={materialize}
              >
                <IconPalette /> {t("prototypeWorkspace.materialize")}
              </button>
              <button type="button" disabled={!content.openui || busy !== null || readOnly} onClick={verify}>
                <IconCheck /> {t("prototypeWorkspace.verify")}
              </button>
              <button
                type="button"
                disabled={!suite || !selectedVersion || busy !== null}
                onClick={() => void exportVersion()}
              >
                {t("designWorkspace.exportVersion")}
              </button>
            </div>
            {progress ? <div className="ui-design-gen-progress">{progress}</div> : null}
            <div className="ui-design-canvas-area">
              {content.openui ? (
                <div className={`ui-design-device ui-design-device-${device}`}>
                  <div className="ui-design-device-chrome" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                    <span>{suite?.title ?? "prototype"}</span>
                  </div>
                  <PrototypePanel
                    a2uiJson=""
                    openuiCode={content.openui}
                    mode="openui"
                    onIterate={(instruction) => revise(instruction)}
                    onSelectionChange={handlePrototypeSelection}
                    selectionEnabled={!readOnly}
                    hideComposer
                  />
                </div>
              ) : (
                // Re-review pixel round: the empty state keeps the device shell
                // + grid so the canvas never collapses into a bare line of text
                // (mockup: 画布永远在壳里).
                <div className={`ui-design-device ui-design-device-${device}`}>
                  <div className="ui-design-device-chrome" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                    <span>{suite?.title ?? "prototype"}</span>
                  </div>
                  <div className="ui-design-device-empty">
                    <p>{t("prototypeWorkspace.noPrototype")}</p>
                    <button
                      type="button"
                      className="primary"
                      disabled={!content.spec || busy !== null || readOnly}
                      onClick={materialize}
                    >
                      <IconPalette /> {t("prototypeWorkspace.materialize")}
                    </button>
                  </div>
                </div>
              )}
            </div>
            <SelectionPopover
              selection={selection}
              readOnly={readOnly}
              quickFixes={[t("prototypeWorkspace.selectionCopy"), t("prototypeWorkspace.selectionSpacing")]}
              onClose={() => setSelection(null)}
              onFix={(instruction) => revise(instruction, selection?.nodePath)}
              onExecute={executePrototypeAction}
            />
          </section>
        ) : null}

        {tab === "report" ? (
          <article className="ui-report-doc">
            <div className="ui-report-doc-head">
              <h1>
                {t("prototypeWorkspace.reportTitle")}
                {suite ? ` — ${suite.title}` : ""}
              </h1>
              <div className="ui-design-doc-actions">
                <button
                  type="button"
                  className="ui-review-run-btn primary"
                  disabled={!content.openui || busy !== null || readOnly}
                  onClick={verify}
                >
                  <IconRefresh /> {t("prototypeWorkspace.runWalkthrough")}
                </button>
                {failedCheckCount > 0 ? (
                  <button
                    type="button"
                    className="ui-review-run-btn"
                    disabled={readOnly || busy !== null}
                    onClick={() => void fixAllFailed()}
                  >
                    <IconSparkle /> {t("prototypeWorkspace.fixAll")}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="ui-review-run-btn"
                  disabled={!suite || !selectedVersion || busy !== null}
                  onClick={() => void exportVersion()}
                >
                  {t("designWorkspace.exportVersion")}
                </button>
              </div>
            </div>
            {selectedVersion ? (
              <div className="ui-report-meta">
                {t("prototypeWorkspace.reportMeta", {
                  version: versionLabel(suite?.versions, selectedVersion.versionId) ?? "-",
                  time: new Date(selectedVersion.savedAt).toLocaleString(),
                })}
                {content.verification ? (
                  <>
                    {" · "}
                    {t("prototypeWorkspace.reportStatusLabel")}{" "}
                    {t(`prototypeWorkspace.checkStatus.${content.verification.status}`)}
                  </>
                ) : null}
              </div>
            ) : null}
            <div className="trigger-card">
              <b>{t("designWorkspace.triggerChainTitle")}</b>
              <span>{t("prototypeWorkspace.triggerChain")}</span>
            </div>
            {content.verification ? (
              <>
                <div className="ui-report-cards">
                  <div className="ui-report-card">
                    <span className="num">{content.verification.checks.length}</span>
                    <span className="lbl">{t("prototypeWorkspace.reportChecks")}</span>
                  </div>
                  <div className="ui-report-card">
                    <span className="num">
                      {content.verification.checks.filter((check) => check.status === "passed").length}
                    </span>
                    <span className="lbl">{t("prototypeWorkspace.passed")}</span>
                  </div>
                  <div className="ui-report-card excluded">
                    <span className="num">
                      {content.verification.checks.filter((check) => check.status === "failed").length}
                    </span>
                    <span className="lbl">{t("prototypeWorkspace.failed")}</span>
                  </div>
                  <div className="ui-report-card">
                    <span className="num">{content.verification.healingRounds ?? 0}</span>
                    <span className="lbl">{t("prototypeWorkspace.reportHealRounds")}</span>
                  </div>
                </div>
                {/* mockup rp-file：按 action 命名空间分组（登录页/订单页/…），无 action 归「通用」。 */}
                {checkGroups.map((group) => (
                  <section className="ui-report-file" key={group.namespace}>
                    <h2 className="ui-report-group-head">
                      <code>{group.namespace}</code>
                      <span>{group.checks.length}</span>
                    </h2>
                    {group.checks.map((check) => (
                      <div className="ui-report-finding" key={check.id}>
                        <div className="head">
                          <span className={`ui-design-status ${check.status}`}>
                            {t(`prototypeWorkspace.checkStatus.${check.status}`)}
                          </span>
                          <strong>{check.label}</strong>
                          {check.action ? <code className="loc">{check.action}</code> : null}
                        </div>
                        {check.observation ? <div className="body">{check.observation}</div> : null}
                        {check.status === "failed" ? (
                          <button
                            type="button"
                            disabled={readOnly || busy !== null}
                            onClick={() => void revise(check.observation ?? check.label)}
                          >
                            <IconSparkle /> {t("prototypeWorkspace.fixFinding")}
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </section>
                ))}
              </>
            ) : (
              <div className="ui-report-empty-state">
                <p>{t("prototypeWorkspace.noReport")}</p>
                <button
                  type="button"
                  className="primary"
                  disabled={!content.openui || busy !== null || readOnly}
                  onClick={verify}
                >
                  <IconRefresh /> {t("prototypeWorkspace.runWalkthrough")}
                </button>
                {!content.openui ? <small>{t("prototypeWorkspace.reportNeedsPrototype")}</small> : null}
              </div>
            )}
            {onQuoteToChat && content.verification ? (
              <button
                type="button"
                className="ui-report-quote"
                onClick={() => onQuoteToChat(JSON.stringify(content.verification, null, 2))}
              >
                {t("designWorkspace.quoteToChat")}
              </button>
            ) : null}
          </article>
        ) : null}
        <FloatingDesignAgent
          tabLabel={tabLabels[tab]}
          quickItems={quickItems[tab]}
          disabled={readOnly || !suite}
          busy={busy !== null}
          onSubmit={(instruction) => revise(instruction)}
        />
      </div>
    </DesignWorkspaceFrame>
  );
}

export default PrototypeWorkspace;
