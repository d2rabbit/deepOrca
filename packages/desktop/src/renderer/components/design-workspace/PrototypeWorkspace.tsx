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
import { StreamdownView } from "../StreamdownView";

type PrototypeTab = "spec" | "proto" | "report" | "arch";

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

const tabs: readonly PrototypeTab[] = ["spec", "proto", "report", "arch"];

export function PrototypeWorkspace({
  root,
  suiteId,
  initialTab,
  onBack,
  onQuoteToChat,
}: PrototypeWorkspaceProps): JSX.Element {
  const { t, locale } = useI18n();
  const [suite, setSuite] = useState<DesignSuite | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<DesignSuiteVersion | null>(null);
  const validInitial: PrototypeTab =
    initialTab === "proto" || initialTab === "report" || initialTab === "arch" ? initialTab : "spec";
  const [tab, setTab] = useState<PrototypeTab>(validInitial);
  useEffect(() => {
    // Mid-session deep links (#prototype/report, #prototype/arch) retarget the
    // open workspace.
    if (initialTab === "spec" || initialTab === "proto" || initialTab === "report" || initialTab === "arch") {
      setTab(initialTab);
    }
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
  /** Spec → slides view (specs/artifact-landing 链路 B): lazily rendered by
   *  the main process; the DOCUMENT view is the default (user ask 2026-09-08:
   *  标准 markdown 展示优先于演示形态),「幻灯片」是切换项。Keyed cache per
   *  versionId. */
  const [specView, setSpecView] = useState<"doc" | "slides">("doc");
  const [slides, setSlides] = useState<{
    html: string;
    css: string;
    pages: number;
    remoteImages: number;
  } | null>(null);
  const [slidesBusy, setSlidesBusy] = useState(false);
  const [slidesPage, setSlidesPage] = useState(1);
  const slidesFrameRef = useRef<HTMLIFrameElement | null>(null);

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

  // ── Spec → slides (specs/artifact-landing 链路 B) ────────────────────────
  const slidesPagesRef = useRef(0);
  /** Lazy main-process render: first open of the slides view per version —
   *  the document view never pays for it. Appearance read from the DOM root
   *  (same channel every leaf component uses). */
  useEffect(() => {
    if (tab !== "spec" || specView !== "slides" || !suite || !selectedVersion || !content.spec) return;
    if (slides) return;
    let alive = true;
    setSlidesBusy(true);
    const appearance = document.documentElement.dataset.appearance === "dark" ? "dark" : "light";
    api
      .prototypeSpecSlides(root, suite.id, selectedVersion.versionId, appearance)
      .then((res) => {
        if (!alive) return;
        if (res.ok && res.html && res.css) {
          const data = { html: res.html, css: res.css, pages: res.pages ?? 0, remoteImages: res.remoteImages ?? 0 };
          slidesPagesRef.current = data.pages;
          setSlides(data);
        } else {
          setError(res.error ?? "slide render failed");
          setSpecView("doc");
        }
      })
      .catch((cause: unknown) => {
        if (alive) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (alive) setSlidesBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [tab, specView, slides, suite, selectedVersion, content.spec, root]);
  /** Reset the per-version cache when the viewed version changes. */
  useEffect(() => {
    setSlides(null);
    setSlidesPage(1);
  }, [selectedVersion?.versionId, suite?.id]);
  /** ←/→ paging: the deck is a stack of 100vh SVG slides inside the frame;
   *  scroll it viewport-by-viewport (sandbox keeps the frame script-free). */
  /** 幻灯片模式(user ask 2026-09-09):marp 页面固定 1280×720,按容器宽度
   *  zoom 适配——否则要么超宽溢出、要么右侧留出大片死区。ResizeObserver
   *  防抖到 0.1% 精度,避免 srcDoc 频繁重载。 */
  const slidesBoxRef = useRef<HTMLDivElement | null>(null);
  const [slidesZoom, setSlidesZoom] = useState(1);
  useEffect(() => {
    if (tab !== "spec" || specView !== "slides") return;
    const box = slidesBoxRef.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      if (width <= 0) return;
      const next = Math.round(Math.min(Math.max(width / 1280, 0.3), 1.6) * 1000) / 1000;
      setSlidesZoom((prev) => (Math.abs(prev - next) > 0.005 ? next : prev));
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, [tab, specView]);

  /** 分页以 marp 固定的文档像素(每页 720)计——html{zoom} 只缩放渲染,
   *  不改变文档坐标,滚动偏移与缩放因子无关。 */
  const slideStep = (dir: 1 | -1): void => {
    const win = slidesFrameRef.current?.contentWindow;
    if (!win) return;
    win.scrollBy({ top: dir * 720 * slidesZoom, behavior: "smooth" });
  };
  const handleSlidesFrameLoad = (): void => {
    const win = slidesFrameRef.current?.contentWindow;
    if (!win) return;
    win.addEventListener("scroll", () => {
      const page = Math.round(win.scrollY / 720) + 1;
      setSlidesPage(Math.min(Math.max(1, page), Math.max(1, slidesPagesRef.current)));
    });
  };
  /** Export-in-progress marker ("html" | "pdf") — double-clicks must not fire
   *  concurrent exports (the main process serializes them, but the button
   *  should say so locally too). */
  const [exporting, setExporting] = useState<string | null>(null);
  const exportSlides = (kind: "html" | "pdf"): void => {
    if (!suite || !selectedVersion || !content.spec || exporting !== null) return;
    setExporting(kind);
    const appearance = document.documentElement.dataset.appearance === "dark" ? "dark" : "light";
    api
      .prototypeSpecExportSlides(root, suite.id, kind, selectedVersion.versionId, appearance)
      .then((res) => {
        if (res.ok && res.path) {
          pushDesignToast("success", t("prototypeWorkspace.slidesExported", { path: res.path }));
          if (res.blockedRemote) {
            pushDesignToast("error", t("prototypeWorkspace.slidesRemoteBlocked", { count: res.blockedRemote }));
          }
        } else {
          pushDesignToast("error", t("prototypeWorkspace.slidesExportFailed", { error: res.error ?? "" }));
        }
      })
      .catch((cause: unknown) => {
        pushDesignToast(
          "error",
          t("prototypeWorkspace.slidesExportFailed", { error: cause instanceof Error ? cause.message : String(cause) })
        );
      })
      .finally(() => setExporting(null));
  };

  // ── Implementation brief (specs/artifact-landing 链路 C) ─────────────────
  const [briefMd, setBriefMd] = useState<string | null>(null);
  /** Reset the brief when the viewed version changes (it documents one spec). */
  useEffect(() => {
    setBriefMd(null);
  }, [selectedVersion?.versionId, suite?.id]);

  const buildBrief = async (): Promise<void> => {
    if (!suite || !selectedVersion || !content.spec || readOnly) return;
    try {
      const res = await api.prototypeBuildBrief(root, suite.id, selectedVersion.versionId, locale);
      if (res.ok && res.briefMd) {
        setBriefMd(res.briefMd);
        pushDesignToast("success", t("prototypeWorkspace.briefOk", { path: res.path ?? "" }));
      } else if (res.gaps && res.gaps.length > 0) {
        pushDesignToast("error", t("prototypeWorkspace.briefGaps", { gaps: res.gaps.join("、") }));
      } else {
        pushDesignToast("error", t("prototypeWorkspace.briefFailed", { error: res.error ?? "" }));
      }
    } catch (cause) {
      pushDesignToast(
        "error",
        t("prototypeWorkspace.briefFailed", { error: cause instanceof Error ? cause.message : String(cause) })
      );
    }
  };

  /** C15: hand the brief to the composer (prefill keeps the user in control —
   *  a direct cross-workspace auto-send would risk posting to the wrong root).
   *  The lead-in names THIS payload; App's quote bridge is a dumb pipe, so
   *  design-side quality/verification quotes don't get brief wording. */
  const injectBrief = (brief: string): void => {
    if (onQuoteToChat) {
      onQuoteToChat(`${t("prototypeWorkspace.briefInjectPrompt")}\n${brief}`);
      pushDesignToast("success", t("prototypeWorkspace.briefInjectOk"));
    } else {
      pushDesignToast("error", t("prototypeWorkspace.briefInjectUnavailable"));
    }
  };

  /** 技术架构模块 (user ask 2026-09-08): 原型验收成功之后,基于 PRD 派生技术
   *  架构文档(prototype.arch 动作,arch-writer 技能),存为新版本并切到
   *  「技术架构」tab。验收未通过时按钮禁用 + 提示。 */
  const generateArch = async (): Promise<void> => {
    if (!suite || !selectedVersion) return;
    if (content.verification?.status !== "passed") {
      pushDesignToast("error", t("prototypeWorkspace.archLocked"));
      return;
    }
    const ref = await runAction("prototype.arch", {
      suiteId: suite.id,
      versionId: selectedVersion.versionId,
    });
    if (ref) {
      pushDesignToast("success", t("prototypeWorkspace.archOk"));
      setTab("arch");
    }
  };

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
   *  单项失败即停——错误已在工作区错误条可见。每轮修订都会推进 suite head，
   *  下一轮必须建在上一轮返回的版本上——闭包里的 selectedVersion 第二轮就
   *  过期了，重发会被 store 的 head-moved 守卫拒绝（M2）。 */
  const fixAllFailed = async (): Promise<void> => {
    const failed = (content.verification?.checks ?? []).filter((check) => check.status === "failed");
    let base: string | undefined = selectedVersion?.versionId;
    for (const check of failed) {
      const next = await revise(check.observation ?? check.label, undefined, base);
      if (!next) break;
      base = next;
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

  /** Revise one part against `baseVersionId` (default: the selected version).
   *  Returns the NEW version id, or null on failure — multi-step callers
   *  (fix-all) thread it forward so every round builds on the current head. */
  const revise = async (instruction: string, target?: string, baseVersionId?: string): Promise<string | null> => {
    if (!suite) return null;
    const base = baseVersionId ?? selectedVersion?.versionId;
    if (!base) return null;
    const part = tab === "proto" ? "openui" : tab === "report" ? "verification" : "spec";
    // The inline diff is only honest when the base IS the version this panel
    // is showing — a threaded fix-all base has moved on, so skip it there.
    const before =
      base === selectedVersion?.versionId
        ? part === "spec"
          ? (content.spec ?? null)
          : part === "openui"
            ? (content.openui ?? null)
            : null
        : null;
    const ref = await runAction("prototype.revise", {
      suiteId: suite.id,
      versionId: base,
      part,
      target: target ?? part,
      instruction,
    });
    if (!ref) return null;
    pushDesignToast("success", t("designWorkspace.toastRevised"));
    if (!before) return ref.versionId;
    try {
      const version = await suiteApi.designSuiteReadVersion(root, ref.suiteId, ref.versionId);
      const next = version && isPrototypeContent(version.content) ? version.content : null;
      if (!next) return ref.versionId;
      const after = part === "spec" ? (next.spec ?? null) : part === "openui" ? (next.openui ?? null) : null;
      if (!after) return ref.versionId;
      const { added, removed } = diffLines(before, after);
      if (added.length || removed.length) setDiff(summarizeDiff({ added, removed }));
    } catch {
      // The revision itself already applied; a failed diff read must not
      // reject — fire-and-forget `void revise(...)` call sites would surface
      // it as an unhandled rejection and fix-all would abort mid-loop.
    }
    return ref.versionId;
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
      arch: t("prototypeWorkspace.tabArch"),
    }),
    [t]
  );
  /** arch tab 无快捷指令(FloatingDesignAgent 在该 tab 停用,收到空列表);其余 tab 各自维护。 */
  const quickItems: Partial<Record<PrototypeTab, readonly string[]>> = {
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
            <i className={version.content.arch ? undefined : "miss"}>{t("prototypeWorkspace.setTitleArch")}</i>
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
          <article
            className={
              "ui-report-doc ui-design-spec-document" +
              (specView === "slides" ? " ui-design-spec-document--slides" : "")
            }
          >
            <div className="ui-report-doc-head">
              <h1>{t("prototypeWorkspace.specTitle")}</h1>
              {selectedVersion ? (
                <span className="ui-report-meta">
                  {t("prototypeWorkspace.specMeta", {
                    version: versionLabel(suite?.versions, selectedVersion.versionId) ?? "-",
                  })}
                </span>
              ) : null}
              {content.spec ? (
                <div className="seg ui-design-spec-viewseg" role="tablist">
                  <button type="button" className={specView === "doc" ? "on" : ""} onClick={() => setSpecView("doc")}>
                    {t("prototypeWorkspace.specViewDoc")}
                  </button>
                  <button
                    type="button"
                    className={specView === "slides" ? "on" : ""}
                    onClick={() => setSpecView("slides")}
                  >
                    {t("prototypeWorkspace.specViewSlides")}
                  </button>
                </div>
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
            {specView === "slides" && content.spec ? (
              <div className="ui-design-slides" ref={slidesBoxRef}>
                <div className="ui-design-slides-toolbar">
                  <span className="ui-design-vbadge">
                    {versionLabel(suite?.versions, selectedVersion?.versionId ?? "") ?? "-"}
                  </span>
                  <button type="button" onClick={() => slideStep(-1)} aria-label={t("prototypeWorkspace.slidesPrev")}>
                    ‹
                  </button>
                  <span className="ui-design-slides-page">
                    {t("prototypeWorkspace.slidesPage", {
                      current: Math.min(slidesPage, Math.max(1, slides?.pages ?? 1)),
                      total: slides?.pages ?? 0,
                    })}
                  </span>
                  <button type="button" onClick={() => slideStep(1)} aria-label={t("prototypeWorkspace.slidesNext")}>
                    ›
                  </button>
                  <span className="ui-design-slides-spacer" />
                  <button
                    type="button"
                    disabled={!slides || slidesBusy || exporting !== null}
                    onClick={() => exportSlides("html")}
                  >
                    {t("prototypeWorkspace.slidesExportHtml")}
                    {exporting === "html" ? "…" : ""}
                  </button>
                  <button
                    type="button"
                    className="primary"
                    disabled={!slides || slidesBusy || exporting !== null}
                    onClick={() => exportSlides("pdf")}
                  >
                    {t("prototypeWorkspace.slidesExportPdf")}
                    {exporting === "pdf" ? "…" : ""}
                  </button>
                </div>
                {slidesBusy ? (
                  <div className="ui-design-slides-state">
                    <span className="ui-spinner" />
                  </div>
                ) : slides ? (
                  <iframe
                    ref={slidesFrameRef}
                    className="ui-design-slides-frame"
                    title={t("prototypeWorkspace.specViewSlides")}
                    sandbox="allow-same-origin"
                    srcDoc={`<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0}html{zoom:${slidesZoom}}${slides.css}</style></head><body>${slides.html}</body></html>`}
                    onLoad={handleSlidesFrameLoad}
                  />
                ) : (
                  <div className="ui-design-slides-state">{t("prototypeWorkspace.noSpec")}</div>
                )}
              </div>
            ) : content.spec ? (
              // 标准 markdown 渲染:表格 / Mermaid 图 / 代码块正经展示
              // (user ask 2026-09-08,与 chat 同一条 Streamdown 管线)。
              <StreamdownView markdown={content.spec} className="ui-design-spec-md" />
            ) : (
              <div className="ui-report-empty">{t("prototypeWorkspace.noSpec")}</div>
            )}
            {/* 待确认逐条勾选（页内定稿流，确认不派发动作/不建版本）。 */}
            {specView === "doc" && specTodos.length > 0 ? (
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
            {specView === "doc" && content.spec ? (
              <div className="ui-design-spec-cta">
                <button
                  type="button"
                  disabled={busy !== null || readOnly || pendingSpecTodos.length > 0}
                  title={pendingSpecTodos.length > 0 ? t("prototypeWorkspace.pendingHint") : undefined}
                  onClick={materialize}
                >
                  <IconPalette /> {t("prototypeWorkspace.materialize")}
                </button>
                <button type="button" disabled={busy !== null || readOnly} onClick={() => void buildBrief()}>
                  {t("prototypeWorkspace.briefGenerate")}
                </button>
                {briefMd ? (
                  <button type="button" className="primary" onClick={() => injectBrief(briefMd)}>
                    {t("prototypeWorkspace.briefInject")}
                  </button>
                ) : null}
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
                    authoringLibrary={suite?.authoringLibrary}
                    onIterate={(instruction) => revise(instruction)}
                    onSelectionChange={handlePrototypeSelection}
                    selectionEnabled={!readOnly}
                    selectionNodePath={selection?.nodePath ?? null}
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
                  disabled={busy !== null || readOnly || content.verification?.status !== "passed"}
                  title={content.verification?.status !== "passed" ? t("prototypeWorkspace.archLocked") : undefined}
                  onClick={() => void generateArch()}
                >
                  {content.arch ? t("prototypeWorkspace.archRegenerate") : t("prototypeWorkspace.archGenerate")}
                </button>
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

        {tab === "arch" ? (
          <article className="ui-report-doc ui-design-spec-document">
            <div className="ui-report-doc-head">
              <h1>{t("prototypeWorkspace.tabArch")}</h1>
              {selectedVersion ? (
                <span className="ui-report-meta">
                  {t("prototypeWorkspace.specMeta", {
                    version: versionLabel(suite?.versions, selectedVersion.versionId) ?? "-",
                  })}
                </span>
              ) : null}
              <div className="ui-design-doc-actions">
                <button
                  type="button"
                  disabled={busy !== null || readOnly || content.verification?.status !== "passed" || !content.arch}
                  title={content.verification?.status !== "passed" ? t("prototypeWorkspace.archLocked") : undefined}
                  onClick={() => void generateArch()}
                >
                  {t("prototypeWorkspace.archRegenerate")}
                </button>
              </div>
            </div>
            {content.arch ? (
              // 与需求文档同一条 Streamdown 管线:架构图(Mermaid)/表格正经渲染。
              <StreamdownView markdown={content.arch} className="ui-design-spec-md" />
            ) : (
              <div className="ui-report-empty-state">
                <p>{t("prototypeWorkspace.archEmpty")}</p>
                <button
                  type="button"
                  className="primary"
                  disabled={busy !== null || readOnly || content.verification?.status !== "passed"}
                  title={content.verification?.status !== "passed" ? t("prototypeWorkspace.archLocked") : undefined}
                  onClick={() => void generateArch()}
                >
                  {t("prototypeWorkspace.archGenerate")}
                </button>
                {content.verification?.status !== "passed" ? <small>{t("prototypeWorkspace.archLocked")}</small> : null}
              </div>
            )}
          </article>
        ) : null}
        <FloatingDesignAgent
          tabLabel={tabLabels[tab]}
          quickItems={quickItems[tab] ?? []}
          disabled={readOnly || !suite || tab === "arch"}
          busy={busy !== null}
          onSubmit={(instruction) => revise(instruction).then((done) => done !== null)}
        />
      </div>
    </DesignWorkspaceFrame>
  );
}

export default PrototypeWorkspace;
