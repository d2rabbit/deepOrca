import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type JSX } from "react";
import { api } from "../../api";
import { useI18n } from "../../i18n";
import { IconCheck, IconClose, IconDesign, IconRefresh, IconSparkle } from "../../ui/icons";
import { PrototypePanel, type PrototypeSelection } from "../PrototypePanel";
import { subscribeToSuiteChanges, suiteApi } from "./api";
import { DesignWorkspaceFrame } from "./DesignWorkspaceFrame";
import { FloatingDesignAgent } from "./FloatingDesignAgent";
import { SelectionPopover, type WorkspaceSelection } from "./SelectionPopover";
import { diffLines, summarizeDiff } from "./diff";
import type { DesignSuite, DesignSuiteVersion, DesignSystemCatalogItem, UiSuiteContent } from "./types";
import { isPrototypeContent, isUiContent } from "./types";

type DesignTab = "pages" | "tokens" | "quality";
type PrototypeBasis = { suiteId: string; versionId: string; label: string };

export type DesignWorkspaceProps = {
  root: string;
  suiteId?: string;
  onBack?: () => void;
  onQuoteToChat?: (quote: string) => void;
};

const fallbackCatalogIds = [
  "modern-minimal",
  "editorial",
  "dark-tech",
  "brutalist-contrast",
  "swiss-international",
  "terminal-mono",
  "glass-morphism",
  "soft-neumorphic",
  "warm-handcrafted",
] as const;

function actionError(result: Awaited<ReturnType<typeof api.actionRun>>): string | null {
  if (!result.ok) return result.error;
  if (typeof result.output !== "object" || result.output === null || !("ok" in result.output)) return null;
  const output = result.output as { ok?: boolean; error?: string };
  return output.ok === false ? (output.error ?? "Action failed") : null;
}

function artifactRefFromResult(
  result: Awaited<ReturnType<typeof api.actionRun>> | null
): { suiteId: string; versionId: string } | null {
  if (!result?.ok || typeof result.output !== "object" || result.output === null) return null;
  const output = result.output as { artifactRef?: unknown };
  if (!output.artifactRef || typeof output.artifactRef !== "object") return null;
  const ref = output.artifactRef as { suiteId?: unknown; versionId?: unknown };
  return typeof ref.suiteId === "string" && typeof ref.versionId === "string"
    ? { suiteId: ref.suiteId, versionId: ref.versionId }
    : null;
}

function recordEntries(value: unknown): Array<[string, string]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>).map(([key, item]) => [
    key,
    typeof item === "string" || typeof item === "number" ? String(item) : JSON.stringify(item),
  ]);
}

const tabs: readonly DesignTab[] = ["pages", "tokens", "quality"];

export function DesignWorkspace({ root, suiteId, onBack, onQuoteToChat }: DesignWorkspaceProps): JSX.Element {
  const { t } = useI18n();
  const [suite, setSuite] = useState<DesignSuite | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<DesignSuiteVersion | null>(null);
  const [prototypeBases, setPrototypeBases] = useState<PrototypeBasis[]>([]);
  const [catalog, setCatalog] = useState<DesignSystemCatalogItem[]>([]);
  const [basis, setBasis] = useState("");
  const [designSystemId, setDesignSystemId] = useState("");
  const [tab, setTab] = useState<DesignTab>("pages");
  const [selection, setSelection] = useState<WorkspaceSelection | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [drift, setDrift] = useState<{ detected: boolean; score: number | null } | null>(null);
  const [diff, setDiff] = useState<{ added: number; removed: number; lines: string[] } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [uiSummaries, prototypeSummaries, catalogItems] = await Promise.all([
        suiteApi.designSuiteList(root, "ui"),
        suiteApi.designSuiteList(root, "prototype"),
        suiteApi.designSystemCatalog(),
      ]);
      const prototypeSuites = await Promise.all(
        prototypeSummaries.map((summary) => suiteApi.designSuiteRead(root, summary.id))
      );
      const bases = prototypeSuites.flatMap((prototypeSuite) =>
        prototypeSuite
          ? prototypeSuite.versions
              .filter((version) => isPrototypeContent(version.content) && Boolean(version.content.openui))
              .map((version, index) => ({
                suiteId: prototypeSuite.id,
                versionId: version.versionId,
                label: `${prototypeSuite.title} · v${prototypeSuite.versions.length - index}`,
              }))
          : []
      );
      const effectiveCatalog = catalogItems.length
        ? catalogItems
        : fallbackCatalogIds.map((id) => ({ id, title: t(`designWorkspace.catalog.${id}`), description: "" }));
      setPrototypeBases(bases);
      setCatalog(effectiveCatalog);
      setBasis((current) => current || (bases[0] ? `${bases[0].suiteId}:${bases[0].versionId}` : ""));
      setDesignSystemId((current) => current || effectiveCatalog[0]?.id || "");

      const targetId = suiteId && uiSummaries.some((item) => item.id === suiteId) ? suiteId : uiSummaries[0]?.id;
      if (!targetId) {
        setSuite(null);
        setSelectedVersion(null);
        return;
      }
      const next = await suiteApi.designSuiteRead(root, targetId);
      setSuite(next);
      setSelectedVersion(next?.currentVersion ?? null);
      if (next?.currentVersion && isUiContent(next.currentVersion.content)) {
        const source = next.currentVersion.content.sourcePrototype;
        if (source) setBasis(`${source.suiteId}:${source.versionId}`);
        if (next.currentVersion.content.designSystemId) setDesignSystemId(next.currentVersion.content.designSystemId);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [root, suiteId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    return subscribeToSuiteChanges((event) => {
      if (!event || event.root === root) void load();
    });
  }, [load, root]);

  const selectVersion = useCallback(
    async (versionId: string) => {
      if (!suite) return;
      const version =
        suite.versions.find((candidate) => candidate.versionId === versionId) ??
        (await suiteApi.designSuiteReadVersion(root, suite.id, versionId));
      setSelectedVersion(version);
      setSelection(null);
      if (version && isUiContent(version.content)) {
        const source = version.content.sourcePrototype;
        if (source) setBasis(`${source.suiteId}:${source.versionId}`);
        if (version.content.designSystemId) setDesignSystemId(version.content.designSystemId);
      }
    },
    [root, suite]
  );

  const content: UiSuiteContent =
    selectedVersion && isUiContent(selectedVersion.content) ? selectedVersion.content : {};
  const review = content.quality?.review;
  const readOnly = Boolean(suite && selectedVersion && selectedVersion.versionId !== suite.currentVersionId);
  const selectedBasis = prototypeBases.find((candidate) => `${candidate.suiteId}:${candidate.versionId}` === basis);

  const selectArtifactRef = useCallback(
    async (ref: { suiteId: string; versionId: string }) => {
      const [nextSuite, nextVersion] = await Promise.all([
        suiteApi.designSuiteRead(root, ref.suiteId),
        suiteApi.designSuiteReadVersion(root, ref.suiteId, ref.versionId),
      ]);
      if (nextSuite) setSuite(nextSuite);
      const exactVersion =
        nextVersion ?? nextSuite?.versions.find((version) => version.versionId === ref.versionId) ?? null;
      setSelectedVersion(exactVersion);
      if (exactVersion && isUiContent(exactVersion.content)) {
        const source = exactVersion.content.sourcePrototype;
        if (source) setBasis(`${source.suiteId}:${source.versionId}`);
        if (exactVersion.content.designSystemId) setDesignSystemId(exactVersion.content.designSystemId);
      }
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

  const materialize = () => {
    if (!selectedBasis || !designSystemId) return;
    void runAction("design.materialize", {
      prototypeSuiteId: selectedBasis.suiteId,
      prototypeVersionId: selectedBasis.versionId,
      designSystemId,
      ...(suite ? { suiteId: suite.id } : {}),
    });
  };

  const runQuality = async () => {
    if (!suite || !selectedVersion) return;
    const lintRef = await runAction("design.lint", { suiteId: suite.id, versionId: selectedVersion.versionId });
    if (!lintRef) return;
    await runAction("design.review", { suiteId: lintRef.suiteId, versionId: lintRef.versionId });
  };

  /** Brand drift gate (design.drift — deterministic dembrandt --compare, zero LLM).
   *  Baseline: workspace contract file. Current: the suite's current .dd projection. */
  const runDrift = () => {
    if (!suite || !selectedVersion || busy !== null) return;
    void (async () => {
      setBusy("design.drift");
      setError(null);
      try {
        const result = await api.actionRun("design.drift", {
          baseline: `${root}/.deeporca/design-baseline.json`,
          current: `${root}/.deeporca/designs/${suite.id}/prototype.openui.txt`,
        });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        const output =
          typeof result.output === "object" && result.output !== null
            ? (result.output as { driftDetected?: boolean; score?: number })
            : undefined;
        setDrift({
          detected: Boolean(output?.driftDetected),
          score: typeof output?.score === "number" ? output.score : null,
        });
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(null);
      }
    })();
  };

  const priorText = (source: UiSuiteContent, part: string): string | null => {
    if (part === "design") return source.openui ?? null;
    if (part === "tokens" || part === "components") {
      const value = part === "tokens" ? source.tokens : source.components;
      return value ? JSON.stringify(value, null, 2) : null;
    }
    return null;
  };

  const revise = (instruction: string, target?: string) => {
    if (!suite || !selectedVersion) return;
    const part = tab === "pages" ? "design" : tab;
    const before = priorText(content, part);
    void (async () => {
      const ref = await runAction("design.revise", {
        suiteId: suite.id,
        versionId: selectedVersion.versionId,
        part,
        target: target ?? part,
        instruction,
      });
      if (!ref || !before || part === "quality") return;
      const version = await suiteApi.designSuiteReadVersion(root, ref.suiteId, ref.versionId);
      if (!version || !isUiContent(version.content)) return;
      const after = priorText(version.content, part);
      if (!after) return;
      const { added, removed } = diffLines(before, after);
      if (!added.length && !removed.length) return;
      setDiff(summarizeDiff({ added, removed }));
    })();
  };

  const locateFinding = (nodePath: string) => {
    setSelection(null);
    setTab("pages");
    window.requestAnimationFrame(() => {
      const stage = stageRef.current;
      if (!stage) return;
      const esc = (value: string) => (typeof CSS !== "undefined" && CSS.escape ? CSS.escape(value) : value);
      const semantic = nodePath.replace(/^view:root\/\//, "");
      const direct = stage.querySelector(
        `[data-sem="${esc(nodePath)}"], [data-sem="${esc(semantic)}"], [data-semantic-id="${esc(semantic)}"]`
      );
      const target =
        direct ??
        Array.from(stage.querySelectorAll<HTMLElement>("[data-sem], [data-semantic-id]")).find((candidate) => {
          const value = candidate.dataset.sem ?? candidate.getAttribute("data-semantic-id") ?? "";
          return value.endsWith(semantic) || semantic.endsWith(value);
        });
      if (!target) return;
      if (typeof target.scrollIntoView === "function") target.scrollIntoView({ block: "center", behavior: "smooth" });
      target.classList.add("ui-design-flash");
      window.setTimeout(() => target.classList.remove("ui-design-flash"), 1600);
    });
  };

  const handleSelection = (next: PrototypeSelection | null) => {
    setSelection(next ? { nodePath: next.nodePath, action: next.action, bounds: next.bounds } : null);
  };

  /** Rendered atom wall tinted by the version's design tokens. */
  const atomStyle = useMemo(() => {
    const style: Record<string, string> = {};
    for (const [name, value] of recordEntries(content.tokens)) {
      const key = name.toLowerCase();
      if (key.includes("accent") || key.includes("primary")) style["--ds-accent"] = value;
      if (key.includes("surface") || key.includes("background")) style["--ds-surface"] = value;
      if (key.includes("text") || key.includes("foreground")) style["--ds-text"] = value;
      if (key.includes("radius")) style["--ds-radius"] = value;
      if (key.includes("font") || key.includes("type")) style["--ds-font"] = value;
    }
    return style as CSSProperties;
  }, [content.tokens]);

  const tabLabels = useMemo(
    () => ({
      pages: t("designWorkspace.tabPages"),
      tokens: t("designWorkspace.tabTokens"),
      quality: t("designWorkspace.tabQuality"),
    }),
    [t]
  );
  /** Group flat token names into the six canonical DTCG-ish families. */
  const TOKEN_GROUPS = ["color", "typography", "spacing", "radius", "shadow", "motion"] as const;
  const tokenGroups = useMemo(() => {
    const entries = recordEntries(content.tokens);
    const buckets = new Map<string, Array<[string, string]>>();
    for (const entry of entries) {
      const prefix = entry[0].split(".")[0]?.toLowerCase() ?? "";
      const id = TOKEN_GROUPS.find((group) => prefix.includes(group)) ?? "other";
      const rows = buckets.get(id) ?? [];
      rows.push(entry);
      buckets.set(id, rows);
    }
    return [
      ...TOKEN_GROUPS.filter((id) => buckets.has(id)).map((id) => ({ id, rows: buckets.get(id) ?? [] })),
      ...(buckets.has("other") ? [{ id: "other", rows: buckets.get("other") ?? [] }] : []),
    ];
  }, [content.tokens]);
  const componentNames = useMemo(() => {
    if (!Array.isArray(content.components)) return [];
    return content.components
      .map((item) => (typeof item === "object" && item !== null && "name" in item ? String(item.name) : ""))
      .filter(Boolean);
  }, [content.components]);
  const quickItems: Record<DesignTab, readonly string[]> = {
    pages: [t("designWorkspace.quickPagesOne"), t("designWorkspace.quickPagesTwo")],
    tokens: [t("designWorkspace.quickTokensOne"), t("designWorkspace.quickTokensTwo")],
    quality: [t("designWorkspace.quickQualityOne"), t("designWorkspace.quickQualityTwo")],
  };

  return (
    <DesignWorkspaceFrame
      root={root}
      tabs={tabs.map((id) => ({ id, label: tabLabels[id] }))}
      activeTab={tab}
      onTabChange={(next) => {
        setTab(next);
        if (next !== "pages") setSelection(null);
      }}
      versions={suite?.versions ?? []}
      selectedVersionId={selectedVersion?.versionId}
      latestVersionId={suite?.currentVersionId}
      onVersionChange={(versionId) => void selectVersion(versionId)}
      versionDetail={(version) => {
        const source = isUiContent(version.content) ? version.content.sourcePrototype : undefined;
        return source ? (
          <span className="ui-design-version-basis">{t("designWorkspace.basedOn", { version: source.versionId })}</span>
        ) : null;
      }}
      loading={loading}
      empty={!suite && prototypeBases.length === 0}
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
        {tab === "pages" ? (
          <section
            className="ui-design-preview-stage"
            onClick={(event) => event.target === event.currentTarget && setSelection(null)}
          >
            <div className="ui-design-toolbar compact">
              <label>
                <span>{t("designWorkspace.prototypeBasis")}</span>
                <select
                  value={basis}
                  disabled={readOnly || busy !== null}
                  onChange={(event) => setBasis(event.target.value)}
                >
                  {prototypeBases.map((item) => (
                    <option value={`${item.suiteId}:${item.versionId}`} key={`${item.suiteId}:${item.versionId}`}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>{t("designWorkspace.designSystem")}</span>
                <select
                  value={designSystemId}
                  disabled={readOnly || busy !== null}
                  onChange={(event) => setDesignSystemId(event.target.value)}
                >
                  {catalog.map((item) => (
                    <option value={item.id} key={item.id}>
                      {item.title}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={!selectedBasis || !designSystemId || busy !== null || readOnly}
                onClick={materialize}
              >
                <IconDesign /> {t("designWorkspace.generateFromPrototype")}
              </button>
              <button
                type="button"
                disabled={!content.openui || busy !== null || readOnly}
                onClick={() => void runQuality()}
              >
                <IconCheck /> {t("designWorkspace.runQuality")}
              </button>
              <button type="button" disabled={!content.openui || busy !== null || readOnly} onClick={runDrift}>
                {t("designWorkspace.driftRun")}
              </button>
              {drift ? (
                <span className={`ui-design-drift-chip${drift.detected ? " bad" : " good"}`}>
                  {drift.detected ? t("designWorkspace.driftDetected") : t("designWorkspace.driftPass")}
                  {drift.score != null ? ` · ${t("designWorkspace.driftScore", { score: drift.score })}` : ""}
                </span>
              ) : null}
              {suite && selectedVersion ? (
                <button
                  type="button"
                  onClick={() => void suiteApi.designSuiteExportPackage(root, suite.id, selectedVersion.versionId)}
                >
                  {t("designWorkspace.exportVersion")}
                </button>
              ) : null}
            </div>
            {content.openui ? (
              <div className="ui-design-canvas-stage" ref={stageRef}>
                <PrototypePanel
                  a2uiJson=""
                  openuiCode={content.openui}
                  mode="openui"
                  onIterate={(instruction) => revise(instruction)}
                  onSelectionChange={handleSelection}
                  selectionEnabled={!readOnly}
                  hideComposer
                />
              </div>
            ) : (
              <div className="ui-design-state">{t("designWorkspace.noDesign")}</div>
            )}
            <SelectionPopover
              selection={selection}
              readOnly={readOnly}
              quickFixes={[t("designWorkspace.selectionCopy"), t("designWorkspace.selectionSpacing")]}
              onClose={() => setSelection(null)}
              onFix={(instruction) => revise(instruction, selection?.nodePath)}
            />
          </section>
        ) : null}

        {tab === "tokens" ? (
          <section className="ui-design-system-view">
            {tokenGroups.map((group) => (
              <div className="ui-design-token-group" key={group.id}>
                <header>
                  <h2>{group.id === "other" ? t("designWorkspace.tokensOther") : group.id}</h2>
                  <span>{catalog.find((item) => item.id === content.designSystemId)?.title ?? designSystemId}</span>
                </header>
                {group.rows.length ? (
                  <table>
                    <tbody>
                      {group.rows.map(([name, value]) => (
                        <tr key={name}>
                          <th>{name}</th>
                          <td>{value}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="ui-design-state">{t("designWorkspace.noTokens")}</div>
                )}
              </div>
            ))}
            <div className="ui-design-component-library">
              <header>
                <h2>{t("designWorkspace.componentsTitle")}</h2>
              </header>
              {componentNames.length ? (
                <div className="ui-design-component-chips">
                  {componentNames.map((name) => (
                    <span className="ui-design-component-chip" key={name}>
                      {name}
                    </span>
                  ))}
                </div>
              ) : (
                <div className="ui-design-state">{t("designWorkspace.noComponents")}</div>
              )}
              <div className="ui-design-atom-wall" style={atomStyle}>
                <div className="row">
                  <button className="atom-btn primary" type="button">
                    {t("designWorkspace.atomPrimary")}
                  </button>
                  <button className="atom-btn" type="button">
                    {t("designWorkspace.atomSecondary")}
                  </button>
                  <button className="atom-btn ghost" type="button">
                    {t("designWorkspace.atomGhost")}
                  </button>
                </div>
                <input className="atom-input" placeholder={t("designWorkspace.atomInput")} readOnly />
                <div className="row">
                  <span className="atom-tag">{t("designWorkspace.atomTag")}</span>
                  <span className="atom-tag warn">{t("designWorkspace.atomTagWarn")}</span>
                </div>
                <div className="atom-card">
                  <strong>{t("designWorkspace.atomCardTitle")}</strong>
                  <p>{t("designWorkspace.atomCardBody")}</p>
                </div>
              </div>
            </div>
          </section>
        ) : null}

        {tab === "quality" ? (
          <article className="ui-report-doc">
            <div className="ui-report-doc-head">
              <h1>{t("designWorkspace.qualityTitle")}</h1>
              <button
                type="button"
                className="ui-review-run-btn"
                disabled={!content.openui || busy !== null || readOnly}
                onClick={() => void runQuality()}
              >
                <IconRefresh /> {t("designWorkspace.runQuality")}
              </button>
            </div>
            {content.quality ? (
              <>
                <div className="trigger-card">
                  <b>{t("designWorkspace.triggerChainTitle")}</b>
                  <span>{t("designWorkspace.triggerChain")}</span>
                </div>
                <div className="ui-report-cards">
                  <div className="ui-report-card">
                    <span className="num">{content.quality.lintFindings.length}</span>
                    <span className="lbl">{t("designWorkspace.findings")}</span>
                  </div>
                  <div className="ui-report-card">
                    <span className="num">
                      {content.quality.runtimeChecks.filter((check) => check.status === "passed").length}/
                      {content.quality.runtimeChecks.length}
                    </span>
                    <span className="lbl">{t("designWorkspace.runtimeChecks")}</span>
                  </div>
                  <div className="ui-report-card">
                    <span className="num">{content.quality.review?.composite ?? "-"}</span>
                    <span className="lbl">{t("designWorkspace.reviewScore")}</span>
                  </div>
                </div>
                <section className="ui-report-file">
                  {content.quality.lintFindings.map((finding) => (
                    <div className="ui-report-finding" key={finding.id}>
                      <div className="head">
                        <span className={`ui-design-severity ${finding.severity}`}>{finding.severity}</span>
                        <strong>{finding.ruleId}</strong>
                        <button
                          type="button"
                          className="ui-design-locate"
                          onClick={() => locateFinding(finding.nodePath)}
                        >
                          {t("designWorkspace.locate")}
                        </button>
                        <code className="loc">{finding.nodePath}</code>
                      </div>
                      <div className="body">{finding.message}</div>
                      {finding.suggestion ? <div className="ui-report-note">{finding.suggestion}</div> : null}
                      <button
                        type="button"
                        disabled={readOnly || busy !== null}
                        onClick={() => revise(finding.suggestion ?? finding.message, finding.nodePath)}
                      >
                        <IconSparkle /> {t("prototypeWorkspace.fixFinding")}
                      </button>
                    </div>
                  ))}
                </section>
                {review ? (
                  <section className="ui-report-file">
                    <h2>
                      <code>{t("designWorkspace.reviewRounds")}</code>
                    </h2>
                    <div className="ui-design-rr-cards">
                      {Array.from({ length: Math.max(1, review.rounds) }, (_, index) => {
                        const isLast = index === review.rounds - 1;
                        const cls = isLast ? (review.status === "passed" ? " pass" : " fail") : "";
                        return (
                          <div className={`ui-design-rr${cls}`} key={index}>
                            R{index + 1}
                          </div>
                        );
                      })}
                      <div className="ui-design-rr-score">{review.composite}</div>
                    </div>
                    <div className="ui-design-evidence">
                      <div className="head">{t("designWorkspace.evidence")}</div>
                      {recordEntries(review.evidence).map(([key, value]) => (
                        <div className="row" key={key}>
                          <strong>{key}</strong>
                          <span>{value}</span>
                        </div>
                      ))}
                    </div>
                  </section>
                ) : null}
              </>
            ) : (
              <div className="ui-report-empty">{t("designWorkspace.noQuality")}</div>
            )}
            {onQuoteToChat && content.quality ? (
              <button
                type="button"
                className="ui-report-quote"
                onClick={() => onQuoteToChat(JSON.stringify(content.quality, null, 2))}
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
          busy={busy === "design.revise"}
          onSubmit={(instruction) => revise(instruction)}
        />
      </div>
    </DesignWorkspaceFrame>
  );
}

export default DesignWorkspace;
