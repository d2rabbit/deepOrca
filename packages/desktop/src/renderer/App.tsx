import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type JSX } from "react";
import { api } from "./api";
import { useTreeRefresh } from "./hooks/use-tree-refresh";
import { useDocumentTitle } from "./hooks/use-document-title";
import { useComposerDockHeight } from "./hooks/use-composer-dock-height";
import type { SidebarView } from "./hooks/use-panel-layout";
import { usePanelLayout } from "./hooks/use-panel-layout";
import { useCompanionWidth } from "./hooks/use-companion-width";
import { useAppearance } from "./hooks/use-appearance";
import { usePreview } from "./hooks/use-preview";
import { useSkills } from "./hooks/use-skills";
import { useProcessPanel } from "./hooks/use-process-panel";
import { useGit } from "./hooks/use-git";
import { useGlobalShortcuts } from "./hooks/use-global-shortcuts";
import { useCommandItems } from "./hooks/use-command-items";
import { useSettingsData } from "./hooks/use-settings-data";
import type {
  ActionProgressEvent,
  AskPermissionRequest,
  DesignArtifactMeta,
  SerializableSessionEntry,
  SessionMessage,
  UserPromptContent,
  WorkspaceTrustLevel,
} from "../shared/ipc";
import { TopBar } from "./components/TopBar";
import { Sidebar } from "./components/Sidebar";
import { MessageList } from "./components/MessageList";
import { Composer } from "./components/Composer";
import { PermissionCard } from "./components/PermissionCard";
import { QuestionCard } from "./components/QuestionCard";
import { PlanCard } from "./components/PlanCard";
import { SettingsPanel } from "./components/SettingsPanel";
import { TaskPanel } from "./components/TaskPanel";
import { SourceControlPanel } from "./components/SourceControlPanel";
import { PluginMcpPanel } from "./components/PluginMcpPanel";
import { PluginDetail, type PluginSelection } from "./components/PluginDetail";
import { ContextProgress } from "./components/ContextProgress";
import { TokenStatsPanel } from "./components/TokenStatsPanel";
import { IndexLibraryPanel } from "./components/IndexLibraryPanel";
import { BuildQuickContent, ReportQuickContent, TaskQuickSheet } from "./components/TaskQuickSheet";
import { InstructionToc } from "./components/InstructionToc";
import { ActivityRail } from "./components/ActivityRail";
import { PinnedPlan } from "./components/PinnedPlan";
import type { TaskHubQuickView } from "./components/TaskHubWorkspace";
import { lazy, Suspense } from "react";

// Lazy-load heavy components that are only shown when the user navigates to
// specific views. This keeps the initial bundle small and defers ~5MB+ of
// code (Monaco + markdown renderers) until actually needed.
const CodeReviewPanel = lazy(() =>
  import("./components/CodeReviewPanel").then((m) => ({ default: m.CodeReviewPanel }))
);
const DiffOverlay = lazy(() => import("./components/DiffOverlay").then((m) => ({ default: m.DiffOverlay })));
import type { DiffTarget } from "./components/DiffOverlay";
const EditorOverlay = lazy(() => import("./components/EditorOverlay").then((m) => ({ default: m.EditorOverlay })));
const PrototypePanel = lazy(() => import("./components/PrototypePanel").then((m) => ({ default: m.PrototypePanel })));
const DesignPreview = lazy(() => import("./components/DesignPreview").then((m) => ({ default: m.DesignPreview })));
const PrototypeDesignPanel = lazy(() =>
  import("./components/PrototypeDesignPanel").then((m) => ({ default: m.PrototypeDesignPanel }))
);
const DesignPanel = lazy(() => import("./components/DesignPanel").then((m) => ({ default: m.DesignPanel })));
const KnowledgePanel = lazy(() => import("./components/KnowledgePanel").then((m) => ({ default: m.KnowledgePanel })));
const ReviewWorkspace = lazy(() =>
  import("./components/ReviewWorkspace").then((m) => ({ default: m.ReviewWorkspace }))
);
const TaskRecordPanel = lazy(() =>
  import("./components/TaskRecordPanel").then((m) => ({ default: m.TaskRecordPanel }))
);
const TaskHubPanel = lazy(() => import("./components/TaskHubPanel").then((m) => ({ default: m.TaskHubPanel })));
const TaskHubWorkspace = lazy(() =>
  import("./components/TaskHubWorkspace").then((m) => ({ default: m.TaskHubWorkspace }))
);
import { GitMcpPanel } from "./components/GitMcpPanel";
import { EditorPanel } from "./components/EditorPanel";
import { UndoModal } from "./components/UndoModal";
import { ProcessOutputPanel } from "./components/ProcessOutputPanel";
import { ShortcutsModal } from "./components/ShortcutsModal";
import { WorkspaceTrustDialog } from "./components/WorkspaceTrustDialog";
import { ToastContainer, useToasts } from "./components/Toast";
import { BuildConsolePanel } from "./components/BuildConsolePanel";
import { StreamdownView } from "./components/StreamdownView";
import { buildReviewFixPrompt, type ReviewFinding } from "./lib/review-fix";
import { reviewStorePath, wikiStorePath } from "./lib/generated-paths";
import { looksLikeLlmTransportError } from "./lib/llm-error";
import { formatBuildError } from "./lib/build-error";
import { BackgroundTaskBadge } from "./components/BackgroundTaskBadge";
import { SerenaPanel } from "./components/SerenaPanel";
import { scanSerenaEvents } from "./lib/serena-extract";
import { useBuildJobs } from "./hooks/useBuildJobs";
import { aggregateUsage, cacheHitRate } from "./lib/token-usage";
import { buildToolSummary, getPlanLines } from "./lib/messages";
import { extractOpenuiFence } from "./openui/inline-extract";
import type { PermissionResult } from "./lib/permissions";
import {
  findPendingAskUserQuestion,
  formatAskUserQuestionAnswers,
  type AskUserQuestionAnswers,
} from "./lib/ask-question";
import { extractProposedPlan, getImplementationPrompt, type PlanImplementationChoice } from "./lib/plan";
import { useI18n } from "./i18n";
import {
  CommandPalette,
  GlobalTooltip,
  IconChat,
  IconCommand,
  IconFile,
  IconIndex,
  IconReview,
  IconPlugins,
  IconTaskTree,
  IconTaskHub,
  IconSparkle,
  IconMoon,
  IconSun,
  IconUndo,
  IconSettings,
  Modal,
  Button,
} from "./ui/index";
import { cx } from "./ui/class-names";
import { HubOrb, HubSheet } from "./components/HubSheet";
import { QuickDock } from "./components/QuickDock";
import { FailureBanner } from "./components/FailureBanner";

type PendingPermissionReply = {
  sessionId: string;
  permissions: PermissionResult["permissions"];
  alwaysAllows: PermissionResult["alwaysAllows"];
  alwaysAllowPaths: PermissionResult["alwaysAllowPaths"];
};

/**
 * Picture-in-picture entry (real-machine ask 2026-08-27): a workspace whose
 * conversation is parked because the user switched to ANOTHER workspace. The
 * transcript is frozen at capture time (events for background roots are not
 * streamed into the view); returning re-selects the root and history reloads
 * fresh from disk, so freezing never loses anything.
 */
type PipEntry = {
  root: string;
  label: string;
  sessionId: string | null;
  title: string | null;
  /** Last turns at capture time, oldest→newest, capped slice. */
  frozen: SessionMessage[];
  /**
   * Gate status AT CAPTURE TIME (ask_permission / waiting_for_user). Live
   * flips for background roots are not streamed to this renderer, so this
   * is a snapshot signal by design — returning to the root gives the live,
   * full-fidelity state.
   */
  blockedAtCapture: boolean;
};

/** Extract the markdown plan from the newest UpdatePlan tool message, if any. */
function findLatestPlan(messages: SessionMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!message || message.role !== "tool") continue;
    const lines = getPlanLines(buildToolSummary(message));
    if (lines.length > 0) return lines.join("\n");
  }
  return null;
}

/** The main-area tab model — module-level so the extracted ⌘K palette hook
 *  (use-command-items) can type its setActiveTab dep. */
export type MainTab =
  | { kind: "chat" }
  | { kind: "settings" }
  | { kind: "plugins" }
  | { kind: "editor"; file: string }
  | { kind: "knowledge"; root: string }
  | { kind: "review"; root: string }
  | { kind: "task"; treeId: string }
  | { kind: "taskhub"; root: string };

function syntheticUserMessage(sessionId: string, content: string): SessionMessage {
  const now = new Date().toISOString();
  return {
    id: `synthetic-${Date.now()}`,
    sessionId,
    role: "user",
    content,
    contentParams: null,
    messageParams: null,
    compacted: false,
    visible: true,
    createTime: now,
    updateTime: now,
  };
}

export function App(): JSX.Element {
  const { t } = useI18n();
  const { toasts, push: pushToast, dismiss: dismissToast, pause: pauseToast, resume: resumeToast } = useToasts();
  const [trustAskOpen, setTrustAskOpen] = useState(false);
  const [trustBusy, setTrustBusy] = useState(false);
  const [projectRoot, setProjectRoot] = useState("");
  // Home dir reported by main — used to detect the fresh-install fallback root
  // so the UI never presents the user's home as a real workspace.
  const [homeDir, setHomeDir] = useState("");
  const [platform, setPlatform] = useState<string>("");
  /**
   * Modifier-key label for shortcut hints: ⌘ on macOS, Ctrl elsewhere. Falls
   * back to a userAgent sniff until main reports the real platform, so the
   * first paint already shows the right glyph (the handler itself accepts
   * metaKey || ctrlKey on every platform — this is display only).
   */
  const modKey = platform === "darwin" || (!platform && /Mac|iPhone|iPad/.test(navigator.userAgent)) ? "⌘" : "Ctrl";
  const [sessions, setSessions] = useState<SerializableSessionEntry[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const { skills, selectedSkills, setSelectedSkills, refreshSkills, handleToggleSkill, handleRefreshPluginSkills } =
    useSkills(activeId);

  const [draft, setDraft] = useState("");
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [enhancing, setEnhancing] = useState(false);
  const [planMode, setPlanMode] = useState(false);
  const [statusLine, setStatusLine] = useState<string | null>(null);
  const [errorLine, setErrorLine] = useState<string | null>(null);
  const [streamProgress, setStreamProgress] = useState<{ startedAt: string; formattedTokens: string } | null>(null);
  const [nowTick, setNowTick] = useState(0);

  const [activeStatus, setActiveStatus] = useState<string | null>(null);
  const [askPermissions, setAskPermissions] = useState<AskPermissionRequest[] | undefined>(undefined);
  const [pendingPermissionReply, setPendingPermissionReply] = useState<PendingPermissionReply | null>(null);
  const [pendingPlan, setPendingPlan] = useState<string | null>(null);
  const [dismissedQuestionIds, setDismissedQuestionIds] = useState<Set<string>>(() => new Set());

  const [modal, setModal] = useState<"undo" | "shortcuts" | "discard-settings" | null>(null);
  /** Settings tab has unsaved edits — every settings close path asks first. */
  const [settingsDirty, setSettingsDirty] = useState(false);
  // Branch the user tried to switch to while the working tree had blocking local changes.

  // ── Main-area tab model ─────────────────────────────────────────────────────
  // The session tab is the workspace's fixed first tab (never closable); every
  // other surface — settings, plugin detail, editor files, task records,
  // knowledge views — opens as its OWN tab and never overwrites another.
  // Panels close only via their tab's ✕ (falling back to the session tab).
  // This replaced the old pre-empting `mainView` state, whose bug: while
  // settings/plugins filled the main area, opening another panel added a tab
  // underneath that could never be reached.
  const [activeTab, setActiveTab] = useState<MainTab>({ kind: "chat" });
  /** Bar entries beyond task/knowledge: one settings tab, one plugins tab, one per editor file. */
  const [auxTabs, setAuxTabs] = useState<
    Array<{ key: string; kind: "settings" | "plugins" | "editor"; file?: string }>
  >([]);
  // Back-compat view for consumers keyed on the old tri-state (composer dock,
  // rail active state) and the settings hook's dispatcher.
  const mainView: "chat" | "settings" | "plugins" =
    activeTab.kind === "settings" || activeTab.kind === "plugins" ? activeTab.kind : "chat";
  const setMainView = useCallback((view: "chat" | "settings" | "plugins") => {
    if (view === "settings" || view === "plugins") {
      setAuxTabs((tabs) => (tabs.some((tab) => tab.kind === view) ? tabs : [...tabs, { key: view, kind: view }]));
      setActiveTab({ kind: view });
    } else {
      setActiveTab({ kind: "chat" });
    }
  }, []);
  const openEditorTab = useCallback((file: string) => {
    const key = `editor:${file}`;
    setAuxTabs((tabs) => (tabs.some((tab) => tab.key === key) ? tabs : [...tabs, { key, kind: "editor", file }]));
    setActiveTab({ kind: "editor", file });
  }, []);
  const handleCloseAuxTab = useCallback((key: string) => {
    setAuxTabs((tabs) => tabs.filter((tab) => tab.key !== key));
    setActiveTab((current) => {
      const currentKey =
        current.kind === "chat"
          ? null
          : current.kind === "editor"
            ? `editor:${current.file}`
            : current.kind === "knowledge"
              ? `knowledge:${current.root}`
              : current.kind === "task"
                ? `task:${current.treeId}`
                : current.kind;
      return currentKey === key ? { kind: "chat" } : current;
    });
  }, []);
  /** The ONE guarded close for the settings tab: dirty edits raise the
   *  discard-confirm no matter which path fired (panel button, tab-strip ✕,
   *  Esc, scrim click) — previously only the button asked. */
  const requestCloseSettings = useCallback(() => {
    if (settingsDirty) {
      setModal("discard-settings");
      return;
    }
    handleCloseAuxTab("settings");
  }, [settingsDirty, handleCloseAuxTab]);
  const {
    prototypeJson,
    prototypeMode,
    prototypeOpenuiCode,
    designContent,
    previewOpen,
    previewTab,
    setPreviewTab,
    applyToolMessage: applyPreviewToolMessage,
    openDesignArtifact,
    resetForSession: resetPreviewForSession,
    closePreview,
  } = usePreview();
  const handleOpenDesignArtifact = useCallback(
    async (artifact: DesignArtifactMeta) => {
      const full = await api.designRead(artifact.id);
      if (full) {
        openDesignArtifact(full.pipeline, full.content);
      }
    },
    [openDesignArtifact]
  );
  /** Task-hub artifact → right-side quick sheet (single slot: evicts the
   *  design preview; the preview's open path evicts this one in turn). */
  const handleOpenTaskQuick = useCallback(
    (quick: TaskHubQuickView) => {
      closePreview();
      setTaskQuick(quick);
    },
    [closePreview]
  );
  const [selectedPlugin, setSelectedPlugin] = useState<PluginSelection | null>(null);
  const [diffTarget, setDiffTarget] = useState<DiffTarget | null>(null);
  // Task-hub quick sheet (user ask 2026-09-02: 任务树产物一律走右侧悬浮窗) —
  // ONE right slot shared with the design preview: opening either closes the
  // other. Content is read-only; full workbenches stay in the main area.
  const [taskQuick, setTaskQuick] = useState<TaskHubQuickView | null>(null);
  const handleCloseTaskQuick = useCallback(() => setTaskQuick(null), []);
  useEffect(() => {
    if (previewOpen) setTaskQuick(null);
  }, [previewOpen]);
  // Workspace task tabs (specs/task-tree session→task cross-reference entry):
  // opened from session badges, one tree per tab in the main area.
  const [taskTabs, setTaskTabs] = useState<Array<{ treeId: string; title: string; root?: string }>>([]);
  /** Knowledge tab (specs/index-knowledge-rework T3): one per workspace root. */
  const [knowledgeTabs, setKnowledgeTabs] = useState<Array<{ root: string; label: string }>>([]);
  const [reviewTabs, setReviewTabs] = useState<Array<{ root: string; label: string; reportId?: string }>>([]);
  const [taskhubTabs, setTaskhubTabs] = useState<Array<{ root: string; label: string }>>([]);
  const [treeTitles, setTreeTitles] = useState<Record<string, { title: string; archived: boolean }>>({});
  const taskTabsRef = useRef(taskTabs);
  taskTabsRef.current = taskTabs;

  const {
    appearance,
    theme,
    reasoningMode,
    initFromPlatform: initAppearanceFromPlatform,
    handleToggleAppearance,
    handleToggleLineVariant,
    handleSelectTheme,
    handleCycleReasoning,
  } = useAppearance(platform);

  const {
    sidebarView,
    setSidebarView,
    panelOpen,
    setPanelOpen,
    viewExtended,
    setViewExtended,
    panelWidth,
    handleResizeStart,
    selectView: selectViewBase,
    openTokensView,
    handleCollapsePanel,
  } = usePanelLayout();
  /** Palette / slash-command / quick-action entries land DIRECTLY on their
   *  module extended — unlike rail clicks (which own the level-2 toggle),
   *  an intent to "open X" from elsewhere always extends the flyout. */
  const selectView = useCallback(
    (view: SidebarView) => {
      setViewExtended(true);
      selectViewBase(view);
    },
    [selectViewBase, setViewExtended]
  );
  /** Orb / ⌘B: pure summon-dismiss of level 1 (the icon rail). Opening
   *  starts rail-only; picking a module is what extends level 2. */
  const handleToggleHub = useCallback(() => {
    setPanelOpen((open) => !open);
    setViewExtended(false);
  }, [setPanelOpen, setViewExtended]);
  const { companionWidth, handleCompanionResizeStart } = useCompanionWidth();
  // Opening a file opens (or focuses) its OWN editor tab in the main area and
  // flips the left panel to the file tree (audit P1-2 behavior preserved) —
  // other tabs are never overwritten.
  const handleOpenEditor = useCallback(
    (file: string) => {
      openEditorTab(file);
      setSidebarView("editor");
    },
    [openEditorTab, setSidebarView]
  );
  // Code review tab (index-module interaction: workspace row click opens the
  // main-area tab; report history + risk map render in-app, never pop out).
  const handleOpenReviewTab = useCallback((root: string, reportId?: string) => {
    const label = root.split(/[\\/]/).pop() ?? root;
    setReviewTabs((tabs) => {
      const existing = tabs.find((tab) => tab.root === root);
      if (!existing) return [...tabs, { root, label, reportId }];
      return reportId && existing.reportId !== reportId
        ? tabs.map((tab) => (tab.root === root ? { ...tab, reportId } : tab))
        : tabs;
    });
    setActiveTab({ kind: "review", root });
  }, []);
  const handleCloseReviewTab = useCallback((root: string) => {
    setReviewTabs((tabs) => tabs.filter((tab) => tab.root !== root));
    setActiveTab((tab) => (tab.kind === "review" && tab.root === root ? { kind: "chat" } : tab));
  }, []);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const {
    showProcessPanel,
    setShowProcessPanel,
    runningProcesses,
    stdoutRef: processStdoutRef,
    syncFromEntry: syncProcessesFromEntry,
    appendStdout: appendProcessStdout,
  } = useProcessPanel(busy);

  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeId;
  const projectRootRef = useRef<string>("");
  projectRootRef.current = projectRoot;
  const pendingSelectRef = useRef<string | null>(null);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const prevBusyRef = useRef(false);
  // Monotonic counter for loadSession race protection: only the latest call
  // should commit its fetched state. An older, slower request that resolves
  // after a newer one is discarded.
  const loadSeqRef = useRef(0);

  const { refreshKey: treeRefreshKey, bump: bumpTree, bumpThrottled: bumpTreeThrottled } = useTreeRefresh();

  // ── Session completion notification ────────────────────────────────────────
  useEffect(() => {
    if (prevBusyRef.current && !busy && !errorLine) {
      pushToast("success", t("app.taskComplete") || "Task completed");
    }
    prevBusyRef.current = busy;
  }, [busy, errorLine, pushToast, t]);

  // ── Data loading ────────────────────────────────────────────────────────────
  /** treeId → {title, archived} for the CURRENT workspace — badge/tab labels. */
  const refreshTreeTitles = useCallback(async () => {
    try {
      const trees = await api.taskTreeList();
      const next: Record<string, { title: string; archived: boolean }> = {};
      for (const tree of trees) next[tree.id] = { title: tree.title, archived: tree.archived };
      setTreeTitles(next);
    } catch {
      setTreeTitles({}); // fail-open — badges fall back to a generic label
    }
  }, []);

  const refreshSessions = useCallback(async () => {
    setSessions(await api.listSessions());
    void refreshTreeTitles();
  }, [refreshTreeTitles]);

  const {
    branch,
    branches,
    branchConflict,
    setBranchConflict,
    stashSwitching,
    refreshGit,
    handleSwitchBranch,
    handleStashAndSwitch,
  } = useGit({ bumpTree, refreshSessions, setErrorLine, pushToast, t });

  const {
    settings,
    editable,
    settingsInitialTab,
    refreshSettings,
    refreshMcp,
    handleSetModel,
    handleSetThinking,
    handleOpenSettings,
    handleSaveSettings,
  } = useSettingsData({ setMainView, setMessages, activeIdRef, refreshSkills });

  const loadSession = useCallback(
    async (id: string | null) => {
      // Claim this load slot; a newer call will have incremented past us.
      const seq = ++loadSeqRef.current;
      const isStale = (): boolean => seq !== loadSeqRef.current;
      await api.setActiveSession(id);
      if (isStale()) return; // a newer loadSession started — abandon
      setActiveId(id);
      setPendingPlan(null);
      setErrorLine(null);
      setPendingPermissionReply((prev) => (prev && prev.sessionId !== id ? null : prev));
      resetPreviewForSession();
      if (!id) {
        setMessages([]);
        setActiveStatus(null);
        setAskPermissions(undefined);
        setPlanMode(false);
        await refreshSkills();
        return;
      }
      const [entry, msgs] = await Promise.all([api.getSession(id), api.listMessages(id)]);
      // Guard against races: if the user selected another session (or switched
      // workspaces) while these fetches were in flight, discard the stale data
      // so it can't overwrite the newer session's view.
      if (isStale()) return;
      setMessages(msgs);
      setActiveStatus(entry?.status ?? null);
      setAskPermissions(entry?.askPermissions);
      setPlanMode(entry?.planMode === true);
      await refreshSkills(id);
    },
    [refreshSkills, resetPreviewForSession]
  );

  // ── Startup + event wiring ───────────────────────────────────────────────────
  // First-open workspace trust question (specs/sandbox/design.md §10.3):
  // explicit=false means the project was never asked — show the dialog once.
  const checkWorkspaceTrust = useCallback(async () => {
    try {
      const status = await api.getWorkspaceTrust();
      if (!status.explicit) {
        setTrustAskOpen(true);
      }
    } catch (error) {
      console.error("[trust] getWorkspaceTrust failed:", error);
    }
  }, []);

  const handleTrustSelect = useCallback(
    async (level: WorkspaceTrustLevel) => {
      setTrustBusy(true);
      try {
        await api.setWorkspaceTrust(level);
        setTrustAskOpen(false);
        if (level === "quarantine") {
          pushToast("info", t("trust.applied.quarantine"));
        }
        await refreshSettings();
      } catch (error) {
        pushToast("error", error instanceof Error ? error.message : String(error));
      } finally {
        setTrustBusy(false);
      }
    },
    [pushToast, refreshSettings, t]
  );

  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        const { projectRoot: root, platform: plat, homeDir: home } = await api.ready();
        if (disposed) return;
        setProjectRoot(root);
        setHomeDir(home);
        setPlatform(plat);
        initAppearanceFromPlatform(plat);
        await Promise.all([refreshSessions(), refreshSettings(), refreshSkills(), refreshMcp(), refreshGit()]);
        await checkWorkspaceTrust();
        const active = await api.getActiveSession();
        if (!disposed && active) {
          await loadSession(active);
        }
      } catch (error) {
        // Boot must never fail silently — surface the failure in the composer.
        console.error("[boot] initial load failed:", error);
        if (!disposed) setErrorLine(error instanceof Error ? error.message : String(error));
      }
    })();

    const offMessage = api.onAssistantMessage((message) => {
      if (activeIdRef.current === null) {
        // A brand-new session is being created by the in-flight prompt; adopt it.
        activeIdRef.current = message.sessionId;
        setActiveId(message.sessionId);
      }
      // Subagent tool artifacts (design/prototype materialize runs are
      // silent sub-sessions) must still open the preview — the old
      // sessionId filter dropped them, so materialize never auto-previewed.
      applyPreviewToolMessage(message);
      if (message.sessionId === activeIdRef.current) {
        setMessages((prev) => [...prev, message]);
        // Inline-mode (opt-in via settings.openuiInlineMode): render a
        // complete ```openui-lang block embedded in the assistant reply,
        // without waiting for a render_openui tool call. The tool channel
        // always wins — it lands later and overwrites with the same code.
        if (message.role === "assistant" && message.content?.includes("```openui-lang")) {
          void api
            .getSettings()
            .then((settings) => {
              if ((settings as { openuiInlineMode?: boolean }).openuiInlineMode !== true) return;
              const block = extractOpenuiFence(message.content ?? "");
              if (block?.complete && block.code) {
                openDesignArtifact("openui", block.code);
              }
            })
            .catch(() => {});
        }
      }
    });

    const offEntry = api.onSessionEntryUpdated((entry) => {
      setSessions((prev) => {
        const idx = prev.findIndex((s) => s.id === entry.id);
        if (idx === -1) return [entry, ...prev];
        const next = [...prev];
        next[idx] = entry;
        return next;
      });
      if (entry.id === activeIdRef.current) {
        setActiveStatus(entry.status);
        setAskPermissions(entry.askPermissions);
        syncProcessesFromEntry(entry);
      }
      bumpTreeThrottled();
    });

    const offProcessStdout = api.onProcessStdout((event) => {
      appendProcessStdout(event.pid, event.chunk);
    });

    // Throttle stream progress updates to max 4/sec (250ms). Token streaming
    // fires hundreds of events/sec; without throttling, each token triggers a
    // full App re-render. The progress bar only needs sub-second granularity.
    let lastStreamUpdate = 0;
    let pendingStreamP: { startedAt: string; formattedTokens: string } | null = null;
    let streamFlushTimer: ReturnType<typeof setTimeout> | null = null;
    const flushStreamProgress = () => {
      streamFlushTimer = null;
      if (pendingStreamP) {
        setStreamProgress(pendingStreamP);
        pendingStreamP = null;
      }
    };
    const offStreamProgress = api.onLlmStreamProgress((progress) => {
      const p = progress as { phase?: string; startedAt?: string; formattedTokens?: string };
      if (p.phase === "end") {
        if (streamFlushTimer) {
          clearTimeout(streamFlushTimer);
          streamFlushTimer = null;
        }
        pendingStreamP = null;
        setStreamProgress(null);
        return;
      }
      if (p.startedAt) {
        const next = { startedAt: p.startedAt, formattedTokens: p.formattedTokens ?? "0" };
        const now = Date.now();
        if (now - lastStreamUpdate >= 250) {
          lastStreamUpdate = now;
          setStreamProgress(next);
        } else {
          pendingStreamP = next;
          if (!streamFlushTimer) {
            streamFlushTimer = setTimeout(flushStreamProgress, 250 - (now - lastStreamUpdate));
          }
        }
      }
    });

    // Periodic tick for loading animation (500ms) — registered in a dedicated
    // effect below so it only runs while a prompt is in flight.

    const offMcp = api.onMcpStatusChanged(() => void refreshMcp());
    const offPlugin = api.onPluginEvent((event) => {
      if (event.type === "mcp:server-error") {
        pushToast("error", `MCP ${event.payload.name}: ${event.payload.error}`);
      } else if (event.type === "plugin:error") {
        pushToast("error", `${event.payload.source}: ${event.payload.error}`);
      }
    });
    const offSandbox = api.onSandboxStatusChanged((event) => {
      // Degradation must be visible (design constraint 6) — the audit log
      // already records it; this surfaces it to the user.
      if (event.outcome === "degraded") {
        pushToast("error", t("sandbox.degradedToast", { backend: event.backend, detail: event.detail }));
      }
    });
    const offRoot = api.onProjectRootChanged((root) => {
      setProjectRoot(root);
      // We are now LIVE in this workspace: a stale frozen snapshot of it may
      // still sit in the pip stack (parked earlier, returned to via the
      // cross-workspace sidebar or a re-picked folder). Leaving it would layer
      // the frozen preview over the real conversation and keep firing its
      // "waiting for confirmation" alert.
      setPipStack((prev) => prev.filter((p) => p.root !== root));
      void (async () => {
        try {
          await Promise.all([refreshSessions(), refreshSettings(), refreshSkills(), refreshMcp(), refreshGit()]);
          await checkWorkspaceTrust();
          const pending = pendingSelectRef.current;
          pendingSelectRef.current = null;
          await loadSession(pending);
          bumpTree();
        } catch (error) {
          console.error("[workspace] switch reload failed:", error);
          setErrorLine(error instanceof Error ? error.message : String(error));
        }
      })();
    });

    return () => {
      disposed = true;
      offMessage();
      offEntry();
      offProcessStdout();
      offStreamProgress();
      offMcp();
      offPlugin();
      offSandbox();
      offRoot();
      // Cancel any pending throttled stream-progress flush so a detached timer
      // can't call setStreamProgress after the effect (and possibly the App)
      // has unmounted — important under React StrictMode double-invoke too.
      if (streamFlushTimer) {
        clearTimeout(streamFlushTimer);
        streamFlushTimer = null;
      }
    };
    // openDesignArtifact (inline-mode renderer) is deliberately omitted: it is
    // an identity-stable useCallback from usePreview, and this boot effect
    // must stay identity-stable or the entire boot chain re-runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    appendProcessStdout,
    applyPreviewToolMessage,
    bumpTree,
    bumpTreeThrottled,
    initAppearanceFromPlatform,
    loadSession,
    pushToast,
    refreshGit,
    refreshMcp,
    refreshSessions,
    refreshSettings,
    refreshSkills,
    syncProcessesFromEntry,
  ]);

  // Loading-animation tick — only while busy, so an idle app doesn't re-render
  // the whole tree every 500ms.
  useEffect(() => {
    if (!busy) return;
    const tickTimer = setInterval(() => {
      setNowTick((v) => v + 1);
    }, 500);
    return () => clearInterval(tickTimer);
  }, [busy]);

  // ── Prompt lifecycle ─────────────────────────────────────────────────────────
  const runPrompt = useCallback(
    async (prompt: UserPromptContent, opts: { showUser?: boolean; isContinue?: boolean } = {}) => {
      const activeSessionId = await api.getActiveSession();
      const reply =
        pendingPermissionReply && activeSessionId === pendingPermissionReply.sessionId ? pendingPermissionReply : null;
      if (reply) {
        prompt.permissions = prompt.permissions ?? reply.permissions;
        prompt.alwaysAllows = prompt.alwaysAllows ?? reply.alwaysAllows;
        prompt.alwaysAllowPaths = prompt.alwaysAllowPaths ?? reply.alwaysAllowPaths;
      }

      if (opts.showUser !== false && !opts.isContinue) {
        const display =
          (prompt.text ?? "").trim() ||
          (prompt.skills && prompt.skills.length > 0
            ? `Use skills: ${prompt.skills.map((s) => s.name).join(", ")}`
            : "");
        if (display) {
          setMessages((prev) => [...prev, syntheticUserMessage(activeSessionId ?? "", display)]);
        }
      }

      setBusy(true);
      setErrorLine(null);
      setStatusLine(null);
      // A failed send must not eat the user's typing: handleSend clears the
      // draft up-front, so on failure we hand the original text back (only
      // when the composer is still empty — never clobber fresh keystrokes).
      const restoreDraftOnFailure = opts.showUser !== false && !opts.isContinue ? (prompt.text ?? "") : "";
      try {
        const result = await api.sendPrompt(prompt);
        if (!result.ok) {
          setErrorLine(result.error ?? t("app.requestFailed"));
          if (restoreDraftOnFailure) {
            setDraft((current) => (current.trim().length === 0 ? restoreDraftOnFailure : current));
          }
        }
        if (reply) {
          setPendingPermissionReply(null);
        }
        const finalId = await api.getActiveSession();
        if (finalId) {
          activeIdRef.current = finalId;
          setActiveId(finalId);
          // Fetch messages and entry state in parallel — one round-trip less.
          const [msgs, entry] = await Promise.all([api.listMessages(finalId), api.getSession(finalId)]);
          setMessages(msgs);
          setActiveStatus(entry?.status ?? null);
          setAskPermissions(entry?.askPermissions);
          const plan =
            prompt.planMode && entry?.status === "completed" ? extractProposedPlan(entry.assistantReply) : null;
          setPendingPlan(plan);
        }
        await Promise.all([refreshSessions(), refreshSkills(finalId ?? undefined)]);
      } catch (error) {
        setErrorLine(error instanceof Error ? error.message : String(error));
        if (restoreDraftOnFailure) {
          setDraft((current) => (current.trim().length === 0 ? restoreDraftOnFailure : current));
        }
      } finally {
        setBusy(false);
        setStreamProgress(null);
        // Drop a stale "pausing…" notice once the loop has actually exited.
        setStatusLine((prev) => (prev === t("composer.pausing") ? null : prev));
      }
    },
    [pendingPermissionReply, refreshSessions, refreshSkills, t]
  );

  const handleSend = useCallback(() => {
    const text = draft.trim();
    const skillObjs = skills.filter((s) => selectedSkills.includes(s.name));
    if (!text && skillObjs.length === 0 && imageUrls.length === 0) {
      return;
    }
    setDraft("");
    setSelectedSkills([]);
    setImageUrls([]);
    void runPrompt({
      text: text || undefined,
      imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
      skills: skillObjs.length > 0 ? skillObjs : undefined,
      planMode,
    });
  }, [draft, imageUrls, planMode, runPrompt, selectedSkills, setSelectedSkills, skills]);

  const handleStop = useCallback(() => {
    void api.interrupt();
  }, []);

  const handlePause = useCallback(() => {
    setStatusLine(t("composer.pausing"));
    void api.pausePrompt();
  }, [t]);

  const handleResume = useCallback(async () => {
    const sessionId = activeIdRef.current;
    if (!sessionId) return;
    setBusy(true);
    setErrorLine(null);
    setStatusLine(null);
    try {
      const result = await api.resumePrompt(sessionId);
      if (!result.ok) {
        setErrorLine(result.error ?? t("app.requestFailed"));
      }
      const [msgs, entry] = await Promise.all([api.listMessages(sessionId), api.getSession(sessionId)]);
      setMessages(msgs);
      setActiveStatus(entry?.status ?? null);
      setAskPermissions(entry?.askPermissions);
      await refreshSessions();
    } catch (error) {
      setErrorLine(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
      setStreamProgress(null);
    }
  }, [refreshSessions, t]);

  const handleEnhance = useCallback(async () => {
    const text = draft.trim();
    if (!text || enhancing) return;
    setEnhancing(true);
    setErrorLine(null);
    setStatusLine(t("composer.enhancing"));
    try {
      const result = await api.enhancePrompt(text);
      if (result.ok && result.text) {
        setDraft(result.text);
      } else if (!result.ok) {
        setErrorLine(result.error ?? t("composer.enhanceFailed"));
      }
    } catch (error) {
      setErrorLine(error instanceof Error ? error.message : String(error));
    } finally {
      setEnhancing(false);
      setStatusLine(null);
    }
  }, [draft, enhancing, t]);

  const handlePermissionResult = useCallback(
    (result: PermissionResult) => {
      const sessionId = activeIdRef.current;
      if (!sessionId) return;
      if (result.hasDeny) {
        setPendingPermissionReply({
          sessionId,
          permissions: result.permissions,
          alwaysAllows: result.alwaysAllows,
          alwaysAllowPaths: result.alwaysAllowPaths,
        });
        setStatusLine(t("app.permissionDenied"));
        // F5: the deny decision is silently merged into the next prompt —
        // surface it so users know where their decision went (audit P1-5).
        pushToast("info", t("app.permissionDeniedToast"));
        setAskPermissions(undefined);
        void api.denyPermission();
        return;
      }
      void runPrompt(
        {
          text: "/continue",
          permissions: result.permissions,
          alwaysAllows: result.alwaysAllows,
          alwaysAllowPaths: result.alwaysAllowPaths,
        },
        { isContinue: true }
      );
    },
    [pushToast, runPrompt, t]
  );

  const handlePermissionCancel = useCallback(() => {
    void api.interrupt();
    setActiveStatus("interrupted");
    setAskPermissions(undefined);
    void refreshSessions();
  }, [refreshSessions]);

  const handleQuestionAnswers = useCallback(
    (answers: AskUserQuestionAnswers) => {
      void runPrompt({ text: formatAskUserQuestionAnswers(answers) }, { showUser: false });
    },
    [runPrompt]
  );

  const handlePlanChoice = useCallback(
    (choice: PlanImplementationChoice) => {
      const plan = pendingPlan;
      setPendingPlan(null);
      if (choice === "stay") return;
      setPlanMode(false);
      if (choice === "implement" && plan) {
        void runPrompt({ text: getImplementationPrompt(plan), planMode: false });
      }
    },
    [pendingPlan, runPrompt]
  );

  // New workspace: pick a folder, switch root; the project-root-changed handler
  // resets to a fresh session slate (a session is created lazily on first prompt).
  // ── Picture-in-picture (parked workspaces) ─────────────────────────────────
  // Switching to another workspace parks the old conversation as a bottom-right
  // mini-window: a frozen last-turns preview + the gate status captured at
  // switch time. Background roots get no message/entry streams here, so the
  // preview is a snapshot by design; returning re-selects the root and the
  // full, up-to-date history reloads from disk — nothing is lost.
  const [pipStack, setPipStack] = useState<PipEntry[]>([]);

  /** Park the CURRENT conversation before switching roots (no-op if empty or
   *  already parked). Must run BEFORE api.setProjectRoot mutates the world. */
  const pushPipSnapshot = useCallback((targetRoot: string) => {
    const root = projectRootRef.current;
    if (!root || root === targetRoot) return;
    const current = messagesRef.current;
    if (current.length === 0) return; // fresh workspace — nothing worth parking
    const sessionId = activeIdRef.current;
    const entry = sessionsRef.current.find((s) => s.id === sessionId);
    setPipStack((prev) =>
      [
        {
          root,
          label: root.split(/[\\/]/).filter(Boolean).pop() ?? root,
          sessionId,
          title: entry?.summary ?? null,
          frozen: current.slice(-24),
          blockedAtCapture:
            entry?.status === "ask_permission" ||
            entry?.status === "waiting_for_user" ||
            Boolean(entry?.askPermissions && entry.askPermissions.length > 0),
        },
        ...prev.filter((p) => p.root !== root),
      ].slice(0, 4)
    );
  }, []);

  const restorePipEntry = useCallback(
    (entry: PipEntry) => {
      if (entry.root === projectRootRef.current) {
        setPipStack((prev) => prev.filter((p) => p.root !== entry.root)); // already active — dismiss only
        return;
      }
      pushPipSnapshot(entry.root); // park whatever is on stage first
      setPipStack((prev) => prev.filter((p) => p.root !== entry.root));
      pendingSelectRef.current = entry.sessionId; // root-changed handler re-selects it
      setActiveTab({ kind: "chat" });
      void api.setProjectRoot(entry.root);
    },
    [pushPipSnapshot]
  );

  /** Most-recent-first rotation so stacked parked sessions stay reachable. */
  const cyclePip = useCallback(() => {
    setPipStack((s) => (s.length > 1 ? [...s.slice(1), s[0]] : s));
  }, []);

  const handleNewWorkspace = useCallback(async () => {
    const picked = await api.pickFolder();
    if (picked) {
      pushPipSnapshot(picked);
      pendingSelectRef.current = null;
      setMainView("chat");
      await api.setProjectRoot(picked);
    }
  }, [pushPipSnapshot, setMainView]);

  // New session within a workspace: switch root if needed (fresh slate follows),
  // else just reset the current workspace to a fresh session.
  const handleNewSessionInWorkspace = useCallback(
    async (root: string) => {
      setMainView("chat");
      if (root && root !== projectRootRef.current) {
        pushPipSnapshot(root);
        pendingSelectRef.current = null;
        await api.setProjectRoot(root);
        return;
      }
      await loadSession(null);
    },
    [pushPipSnapshot, loadSession, setMainView]
  );

  const handleUndoRestored = useCallback(async () => {
    const id = activeIdRef.current;
    if (id) {
      setMessages(await api.listMessages(id));
      const entry = await api.getSession(id);
      setActiveStatus(entry?.status ?? null);
    }
    await refreshSessions();
  }, [refreshSessions]);

  const handleNewSession = useCallback(() => {
    setMainView("chat");
    void loadSession(null);
  }, [loadSession, setMainView]);
  const handleDeleteSession = useCallback(
    async (id: string) => {
      await api.deleteSession(id);
      await refreshSessions();
      bumpTree();
      if (id === activeIdRef.current) {
        await loadSession(null);
      }
    },
    [bumpTree, loadSession, refreshSessions]
  );
  const handleRenameSession = useCallback(
    async (id: string, summary: string) => {
      await api.renameSession(id, summary);
      await refreshSessions();
      bumpTree();
    },
    [bumpTree, refreshSessions]
  );
  const handleArchiveSession = useCallback(
    async (id: string, workspaceRoot?: string) => {
      // The root lets main resolve the session's task binding for the
      // archive cascade even when the session lives in another workspace.
      await api.archiveSession(id, workspaceRoot);
      await refreshSessions();
      bumpTree();
      if (id === activeIdRef.current) {
        await loadSession(null);
      }
    },
    [bumpTree, loadSession, refreshSessions]
  );
  const handleUnarchiveSession = useCallback(
    async (id: string) => {
      await api.unarchiveSession(id);
      await refreshSessions();
      bumpTree();
    },
    [bumpTree, refreshSessions]
  );
  const handleSelectSession = useCallback(
    async (root: string, id: string) => {
      // Selecting a conversation always lands on its workspace (chat) tab —
      // the task-badge entry relies on this (R3-8): leaving an aux tab
      // active would hide the chat the user asked for.
      setActiveTab({ kind: "chat" });
      if (root && root !== projectRootRef.current) {
        pushPipSnapshot(root);
        pendingSelectRef.current = id;
        await api.setProjectRoot(root);
        setMainView("chat");
        return;
      }
      setMainView("chat");
      await loadSession(id);
    },
    [pushPipSnapshot, loadSession, setMainView]
  );
  const handleOpenDiff = useCallback((target: DiffTarget) => setDiffTarget(target), []);

  // Session export with visible outcome — the sidebar's ⤓ used to fire the
  // IPC and leave the user with no idea where the file went (or that it failed).
  const handleExportSession = useCallback(
    (id: string) => {
      void api.exportSession(id).then((res) => {
        if (res.ok && res.path) {
          pushToast("success", `${t("command.export.label")}: ${res.path.split(/[\\/]/).pop()}`);
        } else if (!res.ok) {
          pushToast("error", res.error ?? t("app.requestFailed"));
        }
      });
    },
    [pushToast, t]
  );

  // Left-rail task history (R3-7): open a task RECORD tab for ANY workspace
  // without switching the active project root — the record panel reads the
  // tree through its own root-scoped IPC.
  const handleOpenTaskHub = useCallback((root: string) => {
    const label = root.split(/[\\/]/).pop() ?? root;
    setTaskhubTabs((tabs) => (tabs.some((tab) => tab.root === root) ? tabs : [...tabs, { root, label }]));
    setActiveTab({ kind: "taskhub", root });
  }, []);
  const taskhubTabsRef = useRef(taskhubTabs);
  taskhubTabsRef.current = taskhubTabs;
  const handleCloseTaskHubTab = useCallback((root: string) => {
    setTaskhubTabs((tabs) => tabs.filter((tab) => tab.root !== root));
    setActiveTab((current) => {
      if (current.kind !== "taskhub" || current.root !== root) return current;
      const remaining = taskhubTabsRef.current.filter((tab) => tab.root !== root);
      return remaining.length > 0 ? { kind: "taskhub", root: remaining[remaining.length - 1].root } : { kind: "chat" };
    });
  }, []);
  const knowledgeTabsRef = useRef(knowledgeTabs);
  knowledgeTabsRef.current = knowledgeTabs;
  const handleOpenKnowledgeTab = useCallback((root: string) => {
    const label = root.split(/[\\/]/).filter(Boolean).pop() ?? root;
    setKnowledgeTabs((tabs) => (tabs.some((tab) => tab.root === root) ? tabs : [...tabs, { root, label }]));
    setActiveTab({ kind: "knowledge", root });
  }, []);
  const handleCloseKnowledgeTab = useCallback((root: string) => {
    setKnowledgeTabs((tabs) => tabs.filter((tab) => tab.root !== root));
    setActiveTab((current) => (current.kind === "knowledge" && current.root === root ? { kind: "chat" } : current));
  }, []);
  const handleCloseTaskTab = useCallback((treeId: string) => {
    setTaskTabs((tabs) => tabs.filter((tab) => tab.treeId !== treeId));
    setActiveTab((current) => {
      if (current.kind !== "task" || current.treeId !== treeId) return current;
      const remaining = taskTabsRef.current.filter((tab) => tab.treeId !== treeId);
      return remaining.length > 0 ? { kind: "task", treeId: remaining[remaining.length - 1].treeId } : { kind: "chat" };
    });
  }, []);

  // ── Stable props for memoized children ──────────────────────────────────────
  // MessageList / Composer / Sidebar are wrapped in React.memo; every callback
  // handed to them must keep a stable identity across App re-renders (stream
  // ticks, busy ticks) or memoization is defeated.
  const handleTogglePlan = useCallback(() => setPlanMode((v) => !v), []);
  const handleRemoveImage = useCallback((i: number) => setImageUrls((prev) => prev.filter((_, idx) => idx !== i)), []);
  const handleAddImage = useCallback((dataUrl: string) => setImageUrls((prev) => [...prev, dataUrl]), []);
  const handleResumeClick = useCallback(() => void handleResume(), [handleResume]);
  const handleEnhanceClick = useCallback(() => void handleEnhance(), [handleEnhance]);
  const handleSelectPlugin = useCallback(
    (sel: PluginSelection) => {
      setSelectedPlugin(sel);
      setMainView("plugins");
    },
    [setMainView]
  );

  const handleQuickAction = useCallback(
    (action: "plan" | "init" | "skills" | "undo" | "knowledge" | "review") => {
      if (action === "plan") {
        setPlanMode((v) => !v);
      } else if (action === "init") {
        void runPrompt({ text: "/init" });
      } else if (action === "skills") {
        selectView("plugins");
      } else if (action === "undo") {
        setModal("undo");
      } else if (action === "knowledge") {
        // Flow bridge: welcome → index rail view; the workspace's own row
        // carries the per-root build action.
        selectView("index");
      } else if (action === "review") {
        selectView("review");
      }
    },
    [runPrompt, selectView]
  );

  // Flow bridge (wiki → chat): quote a Wiki page into the composer as an
  // @-mention so the agent reads the exact page, then land the user back in
  // the conversation — knowledge becomes usable inside the chat without a
  // manual copy-paste round-trip.
  const handleQuoteWikiToChat = useCallback(
    (root: string, path: string, title: string) => {
      setActiveTab({ kind: "chat" });
      setDraft((current) => {
        const prefix = current.trim().length > 0 ? `${current.trimEnd()}\n\n` : "";
        return `${prefix}${t("index.quoteWikiPrompt", { title })} @${wikiStorePath(root, path)}\n`;
      });
    },
    [t]
  );

  // Flow bridge (review → chat), wiki parity: quote a saved report into the
  // composer as an @-mention of its structured JSON (full findings, scope,
  // status — NOT the lossy 8-finding text copy of handleReviewAskInChat) so
  // the agent reads the exact run and can act on it in the session.
  const handleQuoteReviewToChat = useCallback(
    (root: string, reportId: string) => {
      setActiveTab({ kind: "chat" });
      setDraft((current) => {
        const prefix = current.trim().length > 0 ? `${current.trimEnd()}\n\n` : "";
        return `${prefix}${t("review.quotePrompt")} @${reviewStorePath(root, reportId)}\n`;
      });
    },
    [t]
  );

  // Flow bridge (review → chat): "ask in chat" quotes the current findings
  // into the composer as a numbered list (capped — a 40-finding dump in the
  // draft is unreadable; the count note keeps the truncation honest).
  const handleReviewAskInChat = useCallback(
    (findings: Array<{ path: string; startLine: number; content: string; crgRisk?: string }>) => {
      setActiveTab({ kind: "chat" });
      const MAX = 8;
      const lines = findings
        .slice(0, MAX)
        .map(
          (f) =>
            `- ${f.crgRisk ? `[${f.crgRisk}] ` : ""}${f.path}:${f.startLine} — ${f.content.replace(/\s+/g, " ").trim().slice(0, 160)}`
        );
      if (findings.length > MAX) lines.push(`…(+${findings.length - MAX})`);
      setDraft((current) => {
        const prefix = current.trim().length > 0 ? `${current.trimEnd()}\n\n` : "";
        return `${prefix}${t("review.askPrompt")}\n${lines.join("\n")}\n`;
      });
    },
    [t]
  );

  // ── Knowledge build → chat suggestion bar (flow closure) ─────────────────
  // A settled build used to end with the badge silently vanishing; the
  // conversation never learned the knowledge it just paid for is ready. On a
  // SUCCESSFUL settle for the current workspace, show a dismissible bar over
  // the composer: view the Wiki, or quote it straight into a question.
  const [kbSuggest, setKbSuggest] = useState<{ pages: number } | null>(null);
  const kbSuggestedRef = useRef<Set<string>>(new Set());
  // Latest-root mirror: the event callback validates `root !== projectRoot`
  // synchronously, but two IPC roundtrips follow — without a re-check the
  // bar for workspace A could land on workspace B if the user switches in
  // that window (the clearing effect below already ran once, too early).
  const kbSuggestRootRef = useRef(projectRoot);
  kbSuggestRootRef.current = projectRoot;
  useEffect(() => {
    const off = api.onActionProgress((event: ActionProgressEvent) => {
      if (event.actionId !== "knowledge.buildComplete") return;
      const root = (event.data as { root?: string } | undefined)?.root;
      if (!root || root !== kbSuggestRootRef.current) return;
      void (async () => {
        try {
          // buildComplete fires on failure too — only successful builds suggest.
          const jobs = await api.knowledgeBuildStatus();
          if (kbSuggestRootRef.current !== root) return;
          const job = jobs.find((j) => j.root === root);
          if (!job || job.running || job.error) return;
          const key = `${root}@${job.startedAt}`;
          if (kbSuggestedRef.current.has(key)) return;
          kbSuggestedRef.current.add(key);
          // Bounded: one key per settled build; long sessions shouldn't grow it forever.
          if (kbSuggestedRef.current.size > 50) {
            kbSuggestedRef.current = new Set([...kbSuggestedRef.current].slice(-50));
          }
          const pages = await api.wikiListPages(root);
          if (kbSuggestRootRef.current !== root) return;
          setKbSuggest({ pages: pages.length });
        } catch {
          // The suggestion is best-effort; failure just means no bar.
        }
      })();
    });
    return off;
  }, []);
  // A different workspace is a different knowledge base — never carry the bar over.
  useEffect(() => {
    setKbSuggest(null);
  }, [projectRoot]);

  const handleSlashCommand = useCallback(
    (cmd: string) => {
      if (cmd === "new") {
        handleNewSession();
      } else if (cmd === "plan") {
        setPlanMode((v) => !v);
      } else if (cmd === "mcp" || cmd === "plugins") {
        selectView("plugins");
      } else if (cmd === "skills") {
        // Skills are shown as chips already, nothing extra needed
      } else if (cmd === "settings") {
        void handleOpenSettings();
      } else if (cmd === "undo") {
        setModal("undo");
      } else if (cmd === "init") {
        void runPrompt({ text: "/init" });
      } else if (cmd === "pm-design" || cmd === "prototype" || cmd === "pm-design-openui" || cmd === "openui") {
        // Designer prototypes now use OpenUI Lang as the default pipeline.
        void runPrompt({
          text: "Create an interactive prototype using the render_openui tool with OpenUI Lang syntax. Ask me what to build first.",
        });
      } else if (cmd === "deep-design" || cmd === "design") {
        // DeepDesign: generate a web design using the .dd format
        void runPrompt({
          text: "Create a web design using the render_design tool with the .dd (OrcaDesign) format. Ask me what to design first.",
        });
      } else if (cmd === "raw") {
        handleCycleReasoning();
      } else if (cmd === "continue") {
        handleSend();
      } else if (cmd === "resume") {
        selectView("explorer");
      } else if (cmd === "exit") {
        void api.closeWindow();
      }
    },
    [handleCycleReasoning, handleNewSession, handleOpenSettings, handleSend, runPrompt, selectView]
  );

  // ── ⌘K command palette + global keyboard shortcuts ─────────────────────────
  useGlobalShortcuts({
    togglePalette: () => setPaletteOpen((v) => !v),
    toggleProcessPanel: () => setShowProcessPanel((v) => !v),
    togglePanel: handleToggleHub,
    newSession: handleNewSession,
    openSettings: handleOpenSettings,
    toggleShortcutsModal: () => setModal((v) => (v === "shortcuts" ? null : "shortcuts")),
    // The trust dialog is modal by design — no shortcut may act behind it.
    blocked: () => trustAskOpen,
  });

  // Command-palette items extracted to hooks/use-command-items.ts
  // (file-length hard limit: App() had grown past 2500 lines). Behavior
  // is unchanged: every handler/setter keeps its App-side identity, so
  // the palette memoization still holds.
  const commandItems = useCommandItems({
    t,
    modKey,
    projectRoot,
    activeIdRef,
    pushToast,
    runPrompt,
    selectView,
    handleNewSession,
    handleOpenSettings,
    handleStop,
    handleToggleHub,
    handleCycleReasoning,
    handleToggleAppearance,
    handleToggleLineVariant,
    handleSelectTheme,
    openTokensView,
    setPlanMode,
    setModal,
    setShowProcessPanel,
    setActiveTab,
  });

  // ── Derived UI ────────────────────────────────────────────────────────────────
  const pendingQuestion = useMemo(() => {
    const found = findPendingAskUserQuestion(messages, activeStatus);
    return found && !dismissedQuestionIds.has(found.messageId) ? found : null;
  }, [activeStatus, dismissedQuestionIds, messages]);

  const showQuestion = Boolean(pendingQuestion) && !busy;
  const showPermission =
    activeStatus === "ask_permission" &&
    !!askPermissions &&
    askPermissions.length > 0 &&
    !pendingPermissionReply &&
    !busy;
  const showPlan = Boolean(pendingPlan) && !busy;
  const hasPlan = useMemo(() => findLatestPlan(messages) !== null, [messages]);

  // Build loading text from stream progress + running processes (ported from CLI buildLoadingText).
  const loadingText = useMemo(() => {
    if (!busy) return null;
    // nowTick forces periodic recalculation for elapsed time display
    void nowTick;
    // Show running process info if any
    if (runningProcesses.length > 0) {
      const proc = runningProcesses[0];
      const elapsed = proc ? Math.max(0, Date.now() - new Date(proc.startTime).getTime()) : 0;
      const secs = Math.floor(elapsed / 1000);
      const mins = Math.floor(secs / 60);
      const s = secs % 60;
      const elapsedStr = mins > 0 ? `${mins}m${s}s` : `${secs}s`;
      return `(${elapsedStr}) ${proc?.command ?? ""}`;
    }
    if (!streamProgress) return t("composer.thinking");
    const startedAt = Date.parse(streamProgress.startedAt);
    if (Number.isNaN(startedAt)) return t("composer.thinking");
    const elapsedMs = Math.max(0, Date.now() - startedAt);
    if (elapsedMs < 3000) return t("composer.thinking");
    const elapsedSeconds = Math.floor(elapsedMs / 1000);
    return `${t("composer.thinking")} (${elapsedSeconds}s) · \u2193 ${streamProgress.formattedTokens} tokens`;
  }, [busy, streamProgress, runningProcesses, nowTick, t]);

  useDocumentTitle(busy, activeStatus);

  const composerDockRef = useComposerDockHeight(mainView);

  // Memoized: MessageList is React.memo and its scroll effect depends on
  // `footer` — an unstable identity would re-run smooth scrolling every render.
  const footer = useMemo(
    () =>
      showQuestion ? (
        <QuestionCard
          questions={pendingQuestion!.questions}
          onSubmit={handleQuestionAnswers}
          onCancel={() => setDismissedQuestionIds((prev) => new Set(prev).add(pendingQuestion!.messageId))}
        />
      ) : showPermission ? (
        <PermissionCard
          requests={askPermissions!}
          onSubmit={handlePermissionResult}
          onCancel={handlePermissionCancel}
        />
      ) : showPlan ? (
        <PlanCard onSelect={handlePlanChoice} planText={pendingPlan} />
      ) : null,
    [
      showQuestion,
      showPermission,
      showPlan,
      pendingQuestion,
      askPermissions,
      pendingPlan,
      handleQuestionAnswers,
      handlePermissionResult,
      handlePermissionCancel,
      handlePlanChoice,
    ]
  );

  const composerDisabled = showQuestion || showPermission || showPlan;

  // 钉住计划条：最近一次 UpdatePlan 的清单状态（进行中才显示）。
  const planProgress = useMemo(() => {
    if (!busy) return null;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i];
      if (m.role !== "tool") continue;
      const lines = getPlanLines(buildToolSummary(m));
      if (lines.length > 0) {
        const done = lines.filter((l) => /^\s*[-*]\s*\[x\]/i.test(l)).length;
        return { lines, done, total: lines.length };
      }
    }
    return null;
  }, [messages, busy]);

  // (The right-side preview surfaces render as floating companion cards over
  // the stage — no shell grid track to enable anymore.)

  // Token mini-panel figures: active session context + workspace grand total.
  const workspaceUsage = useMemo(() => aggregateUsage(sessions), [sessions]);
  const activeContextTokens = useMemo(() => {
    const s = activeId ? sessions.find((x) => x.id === activeId) : null;
    return s ? s.activeTokens : 0;
  }, [activeId, sessions]);
  const activeSessionTitle = useMemo(() => {
    const s = activeId ? sessions.find((x) => x.id === activeId) : null;
    return s?.summary ?? null;
  }, [activeId, sessions]);
  const activeSessionStatus = useMemo(() => {
    const s = activeId ? sessions.find((x) => x.id === activeId) : null;
    return s?.status ?? null;
  }, [activeId, sessions]);

  const appearanceTitle = appearance === "dark" ? t("topbar.appearanceDark") : t("topbar.appearanceLight");

  // Background tasks (R3-5 → real-machine feedback): a compact circular badge
  // (module icon in the center) is the bottom-right presence while builds or
  // reviews run — the big console NEVER auto-opens anymore (it used to plaster
  // 460px over the chat view); it opens on demand from the badge.
  const buildJobs = useBuildJobs();
  const [buildConsoleOpen, setBuildConsoleOpen] = useState(false);
  // Model-transport fault dialog (real-machine 2026-08-27): a background
  // build dying on the LLM plumbing used to surface only as console tail —
  // the user had no way to tell the endpoint broke, not the pipeline. Scan
  // stage errors for transport signatures; the first match pops ONE
  // dismissible dialog, deduped per root+error so poll ticks can't re-spam.
  const [modelFault, setModelFault] = useState<string | null>(null);
  const seenModelFaultsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const job of buildJobs) {
      const errors = [job.error ?? "", ...job.stages.map((stage) => stage.error ?? "")];
      for (const error of errors) {
        if (!looksLikeLlmTransportError(error)) continue;
        const key = `${job.root}:${error}`;
        if (seenModelFaultsRef.current.has(key)) continue;
        seenModelFaultsRef.current.add(key);
        setModelFault((current) => current ?? error);
      }
    }
  }, [buildJobs]);
  const hasBuildJobs = buildJobs.length > 0;
  const openBackgroundTask = useCallback(
    (kind: "knowledge" | "review") => {
      if (kind === "knowledge") setBuildConsoleOpen((v) => !v);
      else selectView("review");
    },
    [selectView]
  );

  // One-click fix (review module): current findings → fix brief → SESSION mode
  // — switch the main area to the chat, inject the brief; the agent generates
  // the UpdatePlan task plan from the findings and fixes them.
  const handleReviewOneClickFix = useCallback(
    (findings: ReviewFinding[]) => {
      const text = buildReviewFixPrompt(findings);
      if (!text) return;
      setMainView("chat");
      void runPrompt({ text });
    },
    [runPrompt, setMainView]
  );

  // Serena panel (R3-6): mirror the agent's Serena tool results as targeted
  // views in a floating right panel. Auto-opens on every NEW serena result;
  // closing only hides it until the next one arrives.
  const serenaEvents = useMemo(() => scanSerenaEvents(messages), [messages]);
  const [serenaOpen, setSerenaOpen] = useState(false);
  const lastSerenaId = useRef<string | null>(null);
  useEffect(() => {
    const latest = serenaEvents[serenaEvents.length - 1];
    if (latest && latest.id !== lastSerenaId.current) {
      lastSerenaId.current = latest.id;
      setSerenaOpen(true);
    }
  }, [serenaEvents]);

  // The main session conversation — rendered inside the first tab when
  // workspace tabs exist, or as the whole content area when they don't.
  // Extracted so the tab strip (below) never has to duplicate it.
  const chatContent = (
    <>
      <FailureBanner
        messages={messages}
        busy={busy}
        sessionFailed={activeStatus === "failed"}
        onRetry={(text) => void runPrompt({ text }, { showUser: false })}
        onOpenSettings={() => setActiveTab({ kind: "settings" })}
      />
      <MessageList
        messages={messages}
        hasActiveSession={activeId !== null || messages.length > 0}
        reasoningMode={reasoningMode}
        modKey={modKey}
        compacting={activeStatus === "compacting"}
        streaming={busy}
        onQuickAction={handleQuickAction}
        footer={footer}
      />
      {showProcessPanel ? (
        <ProcessOutputPanel
          processes={runningProcesses}
          stdoutRef={processStdoutRef}
          onDismiss={() => setShowProcessPanel(false)}
          platform={platform}
        />
      ) : null}
      <div className="ui-composer-dock" ref={composerDockRef}>
        {kbSuggest ? (
          <div className="ui-chat-suggest" role="status">
            <span className="ui-chat-suggest-icon" aria-hidden>
              ◈
            </span>
            <span className="ui-chat-suggest-text">{t("suggest.knowledgeTitle", { n: kbSuggest.pages })}</span>
            <button
              type="button"
              className="ui-chat-suggest-btn"
              onClick={() => {
                setKbSuggest(null);
                if (projectRoot) setActiveTab({ kind: "knowledge", root: projectRoot });
              }}
            >
              {t("suggest.viewWiki")}
            </button>
            <button
              type="button"
              className="ui-chat-suggest-btn primary"
              onClick={() => {
                setKbSuggest(null);
                setDraft((current) => {
                  const prefix = current.trim().length > 0 ? `${current.trimEnd()}\n\n` : "";
                  return `${prefix}${t("suggest.askArch")}\n`;
                });
              }}
            >
              {t("index.quoteWiki")}
            </button>
            <button
              type="button"
              className="ui-chat-suggest-close"
              aria-label={t("common.close")}
              onClick={() => setKbSuggest(null)}
            >
              ✕
            </button>
          </div>
        ) : null}
        <Composer
          value={draft}
          onChange={setDraft}
          onSend={handleSend}
          onStop={handleStop}
          onPause={handlePause}
          onResume={handleResumeClick}
          canResume={!busy && (activeStatus === "paused" || activeStatus === "interrupted")}
          onEnhance={handleEnhanceClick}
          enhancing={enhancing}
          busy={busy}
          disabled={composerDisabled}
          planMode={planMode}
          onTogglePlan={handleTogglePlan}
          skills={skills}
          selectedSkills={selectedSkills}
          onToggleSkill={handleToggleSkill}
          statusText={loadingText ?? statusLine}
          errorText={errorLine}
          imageUrls={imageUrls}
          onRemoveImage={handleRemoveImage}
          onAddImage={handleAddImage}
          onSlashCommand={handleSlashCommand}
        />
        <ContextProgress
          activeTokens={activeContextTokens}
          model={settings?.model ?? ""}
          thresholdOverride={settings?.compactTokenThreshold}
          compacting={activeStatus === "compacting"}
        />
      </div>
    </>
  );

  // ── Surface chips (cockpit center) ────────────────────────────────────────
  // Successor of the editor-style tab strip: one glowing chip per open
  // surface plus the always-first conversation chip. Rendered only when at
  // least one auxiliary surface exists — a lone conversation keeps the
  // cockpit clean. Chip = container div + two SIBLING buttons (switch +
  // close) — nested interactive elements are an a11y/HTML anti-pattern.
  const hasAuxSurfaces =
    auxTabs.length > 0 ||
    taskTabs.length > 0 ||
    knowledgeTabs.length > 0 ||
    reviewTabs.length > 0 ||
    taskhubTabs.length > 0;
  const surfaceChips = useMemo(() => {
    if (!hasAuxSurfaces) return null;
    return (
      <div className="ui-surface-chips">
        <button
          type="button"
          className={cx("ui-surface-chip", activeTab.kind === "chat" && "active")}
          onClick={() => setActiveTab({ kind: "chat" })}
          data-tip={t("surface.chat")}
        >
          <IconChat />
        </button>
        {auxTabs.map((tab) => {
          const active =
            tab.kind === "editor"
              ? activeTab.kind === "editor" && activeTab.file === tab.file
              : activeTab.kind === tab.kind;
          const title =
            tab.kind === "settings"
              ? t("settings.title")
              : tab.kind === "plugins"
                ? t("plugins.title")
                : ((tab.file ?? "").split(/[\\/]/).pop() ?? "");
          const label = (
            <>
              {tab.kind === "settings" ? <IconSettings /> : tab.kind === "plugins" ? <IconPlugins /> : <IconFile />}
              {title}
            </>
          );
          return (
            <div key={tab.key} className={cx("ui-surface-chip", active && "active")}>
              <button
                type="button"
                className="ui-surface-chip-main"
                onClick={() =>
                  setActiveTab(tab.kind === "editor" ? { kind: "editor", file: tab.file ?? "" } : { kind: tab.kind })
                }
                data-tip={tab.kind === "editor" ? tab.file : title}
              >
                {label}
              </button>
              <button
                type="button"
                className="ui-surface-chip-close"
                onClick={() => (tab.kind === "settings" ? requestCloseSettings() : handleCloseAuxTab(tab.key))}
                aria-label={t("tasktree.closeTab")}
              >
                ✕
              </button>
            </div>
          );
        })}
        {taskTabs.map((tab) => (
          <div
            key={tab.treeId}
            className={cx("ui-surface-chip", activeTab.kind === "task" && activeTab.treeId === tab.treeId && "active")}
          >
            <button
              type="button"
              className="ui-surface-chip-main"
              onClick={() => setActiveTab({ kind: "task", treeId: tab.treeId })}
              data-tip={tab.title}
            >
              <IconTaskTree /> {tab.title}
            </button>
            <button
              type="button"
              className="ui-surface-chip-close"
              onClick={() => handleCloseTaskTab(tab.treeId)}
              aria-label={t("tasktree.closeTab")}
            >
              ✕
            </button>
          </div>
        ))}
        {knowledgeTabs.map((tab) => (
          <div
            key={tab.root}
            className={cx("ui-surface-chip", activeTab.kind === "knowledge" && activeTab.root === tab.root && "active")}
          >
            <button
              type="button"
              className="ui-surface-chip-main"
              onClick={() => setActiveTab({ kind: "knowledge", root: tab.root })}
              data-tip={tab.root}
            >
              <IconIndex /> {tab.label}
            </button>
            <button
              type="button"
              className="ui-surface-chip-close"
              onClick={() => handleCloseKnowledgeTab(tab.root)}
              aria-label={t("tasktree.closeTab")}
            >
              ✕
            </button>
          </div>
        ))}
        {reviewTabs.map((tab) => (
          <div
            key={tab.root}
            className={cx("ui-surface-chip", activeTab.kind === "review" && activeTab.root === tab.root && "active")}
          >
            <button
              type="button"
              className="ui-surface-chip-main"
              onClick={() => setActiveTab({ kind: "review", root: tab.root })}
              data-tip={tab.root}
            >
              <IconReview /> {tab.label}
            </button>
            <button
              type="button"
              className="ui-surface-chip-close"
              onClick={() => handleCloseReviewTab(tab.root)}
              aria-label={t("tasktree.closeTab")}
            >
              ✕
            </button>
          </div>
        ))}
        {taskhubTabs.map((tab) => (
          <div
            key={tab.root}
            className={cx("ui-surface-chip", activeTab.kind === "taskhub" && activeTab.root === tab.root && "active")}
          >
            <button
              type="button"
              className="ui-surface-chip-main"
              onClick={() => setActiveTab({ kind: "taskhub", root: tab.root })}
              data-tip={tab.label}
            >
              <IconTaskHub /> {tab.label}
            </button>
            <button
              type="button"
              className="ui-surface-chip-close"
              onClick={() => handleCloseTaskHubTab(tab.root)}
              aria-label={t("tasktree.closeTab")}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    );
  }, [
    activeTab,
    auxTabs,
    handleCloseAuxTab,
    handleCloseKnowledgeTab,
    handleCloseReviewTab,
    handleCloseTaskTab,
    handleCloseTaskHubTab,
    hasAuxSurfaces,
    knowledgeTabs,
    requestCloseSettings,
    reviewTabs,
    t,
    taskTabs,
    taskhubTabs,
  ]);

  // Cockpit right cluster — the old rail's bottom icons (commands / undo /
  // appearance / settings) live here now, floating with the other cockpit
  // pills. The ⌘K button keeps the palette reachable for mouse-only users —
  // its only discoverable entry died with the rail. Memoized so TopBar
  // (React.memo) isn't defeated by an unstable prop identity.
  const cockpitActions = useMemo(
    () => (
      <div className="ui-cockpit-actions">
        <button
          type="button"
          className="ui-cockpit-icon-btn"
          onClick={() => setPaletteOpen(true)}
          data-tip={`${t("rail.commands")} (${modKey}K)`}
          aria-label={t("rail.commands")}
        >
          <IconCommand />
        </button>
        <button
          type="button"
          className="ui-cockpit-icon-btn"
          onClick={handleToggleAppearance}
          disabled={theme === "orca"}
          data-tip={appearanceTitle}
          aria-label={appearanceTitle}
        >
          {appearance === "dark" ? <IconMoon /> : <IconSun />}
        </button>
        <button
          type="button"
          className="ui-cockpit-icon-btn"
          onClick={() => setModal("undo")}
          data-tip={`${t("rail.undo")} (${modKey}Z)`}
          aria-label={t("rail.undo")}
        >
          <IconUndo />
        </button>
        <button
          type="button"
          className={cx("ui-cockpit-icon-btn", mainView === "settings" && "active")}
          onClick={() => void handleOpenSettings()}
          data-tip={`${t("rail.settings")} (${modKey},)`}
          aria-label={t("rail.settings")}
        >
          <IconSettings />
        </button>
      </div>
    ),
    [
      appearance,
      appearanceTitle,
      handleOpenSettings,
      handleToggleAppearance,
      mainView,
      modKey,
      setPaletteOpen,
      t,
      theme,
    ]
  );

  // Esc unwinds the hub level by level — flyout first, then the rail itself.
  // A system modal surface (palette, dialog, diff, trust ask) owns Escape
  // while visible; those bail out first.
  useEffect(() => {
    if (!panelOpen && activeTab.kind !== "settings") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (paletteOpen || modal !== null || diffTarget !== null || trustAskOpen) return;
      if (panelOpen) {
        if (viewExtended) setViewExtended(false);
        else handleCollapsePanel();
        return;
      }
      if (activeTab.kind === "settings") requestCloseSettings();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    panelOpen,
    viewExtended,
    setViewExtended,
    activeTab.kind,
    paletteOpen,
    modal,
    diffTarget,
    trustAskOpen,
    handleCollapsePanel,
    requestCloseSettings,
  ]);

  // The conversation is the stage's base layer; auxiliary surfaces
  // (settings / plugin detail / editor files / task records / knowledge)
  // render as the stage's flat workspace pane — same plane as the chat view,
  // and DOCKED beside the hub rail/flyout when those are open (shell.css
  // docking rules), so the hub keeps serving until the user collapses it.

  // ── Picture-in-picture derivations ────────────────────────────────────────
  /** Live gate check: session entries are workspace-scoped, so this only sees
   *  the CURRENT root; parked roots rely on the capture-time flag instead. */
  const isPipBlocked = useCallback(
    (entry: PipEntry): boolean =>
      entry.root === projectRootRef.current &&
      sessions.some(
        (s) =>
          (!entry.sessionId || s.id === entry.sessionId) &&
          (s.status === "ask_permission" || s.status === "waiting_for_user")
      ),
    [sessions]
  );
  const pipTop = pipStack[0] ?? null;
  const pipBlockedEntries = useMemo(
    () => pipStack.filter((entry) => entry.blockedAtCapture || isPipBlocked(entry)),
    [isPipBlocked, pipStack]
  );
  /** Flatten one frozen message into a one-line preview for the mini-window. */
  const pipLineOf = useCallback((message: SessionMessage): { role: string; text: string } => {
    if (message.role === "user") {
      return { role: "user", text: truncateForPip(message.content ?? "") };
    }
    if (message.role === "assistant") {
      const plain = (message.content ?? "")
        .replace(/```[\s\S]*?(```|$)/g, " ")
        .replace(/[#*`>[\]()]/g, "")
        .replace(/\s+/g, " ")
        .trim();
      return { role: "assistant", text: truncateForPip(plain) };
    }
    return { role: "tool", text: buildToolSummary(message).name || "" };
  }, []);
  function truncateForPip(value: string): string {
    const flat = value.replace(/\s+/g, " ").trim();
    return flat.length > 96 ? `${flat.slice(0, 96)}…` : flat;
  }

  // Floating-island size vars — the hub sheet and the companion card each own
  // a drag-resizable width (persisted); the CSS vars keep orb offset, stage
  // reflow and card width in lock-step.
  const companionOpen = Boolean(previewOpen && (prototypeJson || prototypeMode === "openui" || designContent));
  const shellVars = {
    ...(panelOpen ? { "--ui-panel-w": `${panelWidth}px` } : {}),
    ...(companionOpen ? { "--ui-right-w": `${companionWidth}px` } : {}),
  } as CSSProperties;

  return (
    <div
      className={`ui-shell${panelOpen ? " panel-open" : ""}${panelOpen && viewExtended ? " hub-expanded" : ""}`}
      style={shellVars}
    >
      {/* Global [data-tip] hover tooltip — portal-rendered, fixed-position. */}
      <GlobalTooltip />

      {/* Hub sheet — floating glass island (launcher tiles + sidebar views),
          the successor of the activity rail + docked sidebar. The stage
          reflows its centered column instead of being occluded. */}
      {panelOpen ? (
        <HubSheet
          view={sidebarView}
          expanded={viewExtended}
          disabledViews={hasPlan ? [] : ["tasks"]}
          onSelectView={selectViewBase}
          onCollapseFlyout={() => setViewExtended(false)}
          onClose={handleCollapsePanel}
          onResizeStart={handleResizeStart}
        >
          {sidebarView === "explorer" ? (
            <Sidebar
              activeId={activeId}
              currentRoot={projectRoot}
              refreshKey={treeRefreshKey}
              sessions={sessions}
              treeTitles={treeTitles}
              onSelectSession={handleSelectSession}
              onDelete={handleDeleteSession}
              onRename={handleRenameSession}
              onArchive={handleArchiveSession}
              onUnarchive={handleUnarchiveSession}
              onExportSession={handleExportSession}
              onCollapse={handleCollapsePanel}
              onNewWorkspace={handleNewWorkspace}
              onNewSessionInWorkspace={handleNewSessionInWorkspace}
              onOpenTokens={openTokensView}
            />
          ) : sidebarView === "scm" ? (
            <SourceControlPanel
              refreshKey={treeRefreshKey}
              sessionId={activeId}
              platform={platform}
              onOpenDiff={handleOpenDiff}
              onOpenEditor={handleOpenEditor}
            />
          ) : sidebarView === "tasks" ? (
            <TaskPanel messages={messages} />
          ) : sidebarView === "tokens" ? (
            <TokenStatsPanel
              root={projectRoot}
              // Count alone freezes while the ACTIVE session grows — folding
              // usage totals into the key makes the panel refetch as the
              // numbers it displays actually move.
              refreshKey={sessions.reduce((sum, s) => sum + (s.usage?.total_tokens ?? 0), 0) + sessions.length}
            />
          ) : sidebarView === "index" ? (
            <IndexLibraryPanel onOpenWorkspace={handleOpenKnowledgeTab} />
          ) : sidebarView === "review" ? (
            <Suspense fallback={<div className="ui-side-panel-empty">{t("common.loading")}</div>}>
              <CodeReviewPanel
                onOpenReviewTab={handleOpenReviewTab}
                onOneClickFix={handleReviewOneClickFix}
                onAskInChat={handleReviewAskInChat}
              />
            </Suspense>
          ) : sidebarView === "prototype" ? (
            <Suspense fallback={<div className="ui-side-panel-empty">{t("common.loading")}</div>}>
              <PrototypeDesignPanel onOpenArtifact={handleOpenDesignArtifact} />
            </Suspense>
          ) : sidebarView === "design" ? (
            <Suspense fallback={<div className="ui-side-panel-empty">{t("common.loading")}</div>}>
              <DesignPanel onOpenArtifact={handleOpenDesignArtifact} />
            </Suspense>
          ) : sidebarView === "taskhub" ? (
            <Suspense fallback={<div className="ui-side-panel-empty">{t("common.loading")}</div>}>
              <TaskHubPanel onOpenTaskHub={handleOpenTaskHub} />
            </Suspense>
          ) : sidebarView === "gitmcp" ? (
            <GitMcpPanel />
          ) : sidebarView === "editor" ? (
            <EditorPanel onOpenFile={handleOpenEditor} />
          ) : (
            <PluginMcpPanel
              skills={skills}
              selectedSkills={selectedSkills}
              onToggleSkill={handleToggleSkill}
              onRefreshSkills={handleRefreshPluginSkills}
              selected={selectedPlugin}
              onSelect={handleSelectPlugin}
              platform={platform}
            />
          )}
        </HubSheet>
      ) : null}

      <TopBar
        platform={platform}
        projectRoot={projectRoot}
        isHomeRoot={homeDir !== "" && projectRoot === homeDir}
        onPickFolder={handleNewWorkspace}
        settings={settings}
        branch={branch}
        branches={branches}
        onSwitchBranch={handleSwitchBranch}
        onSetModel={handleSetModel}
        onSetThinking={handleSetThinking}
        onOpenSettings={handleOpenSettings}
        onOpenTokens={openTokensView}
        activeTokens={activeContextTokens}
        totalTokens={workspaceUsage.totals.total}
        cacheRate={cacheHitRate(workspaceUsage.totals)}
        totalReqs={workspaceUsage.totals.reqs}
        sessionTitle={activeSessionTitle}
        sessionStatus={activeSessionStatus}
        streaming={busy}
        streamElapsedSecs={
          busy && streamProgress
            ? Math.max(0, Math.floor((Date.now() - Date.parse(streamProgress.startedAt)) / 1000))
            : 0
        }
        center={surfaceChips}
        actions={cockpitActions}
      />

      <div className="ui-main">
        {/* Settings renders at SHELL level (modal family) — here the chain
            falls through to the conversation, which stays visible (dimmed by
            the scrim) instead of being covered by a full-stage sheet. */}
        {activeTab.kind === "plugins" ? (
          <div className="ui-sheet">
            <PluginDetail
              selection={selectedPlugin}
              skills={skills}
              selectedSkills={selectedSkills}
              onToggleSkill={handleToggleSkill}
              onBack={() => handleCloseAuxTab("plugins")}
            />
          </div>
        ) : activeTab.kind === "editor" && activeTab.file ? (
          <div className="ui-sheet">
            <Suspense
              fallback={
                <div className="ui-editor-empty">
                  <span className="ui-spinner" /> {t("editor.loading")}
                </div>
              }
            >
              <EditorOverlay
                filePath={activeTab.file}
                onClose={() => handleCloseAuxTab(`editor:${activeTab.file}`)}
                appearance={appearance}
                inline
              />
            </Suspense>
          </div>
        ) : activeTab.kind === "knowledge" ? (
          <div className="ui-sheet">
            <button
              type="button"
              className="ui-sheet-close"
              onClick={() => handleCloseKnowledgeTab(activeTab.root)}
              aria-label={t("sheet.backToChat")}
            >
              ✕ {t("sheet.backToChat")}
            </button>
            <KnowledgePanel
              root={activeTab.root}
              appearance={appearance}
              onOpenFile={handleOpenEditor}
              onQuoteToChat={handleQuoteWikiToChat}
            />
          </div>
        ) : activeTab.kind === "review" ? (
          <div className="ui-sheet">
            <button
              type="button"
              className="ui-sheet-close"
              onClick={() => handleCloseReviewTab(activeTab.root)}
              aria-label={t("sheet.backToChat")}
            >
              ✕ {t("sheet.backToChat")}
            </button>
            <Suspense fallback={<div className="ui-side-panel-empty">{t("common.loading")}</div>}>
              {/* key={root}: without it, switching between two review tabs
                  REUSED the component instance — the risk map (and error state)
                  from workspace A stayed visible under workspace B's tab, and
                  openGraph's cache guard short-circuited the refetch
                  (review round 2026-09-01). */}
              <ReviewWorkspace
                key={activeTab.root}
                root={activeTab.root}
                initialReportId={reviewTabs.find((tab) => tab.root === activeTab.root)?.reportId}
                onQuoteToChat={handleQuoteReviewToChat}
              />
            </Suspense>
          </div>
        ) : activeTab.kind === "taskhub" ? (
          <div className="ui-sheet">
            <button
              type="button"
              className="ui-sheet-close"
              onClick={() => handleCloseTaskHubTab(activeTab.root)}
              aria-label={t("sheet.backToChat")}
            >
              ✕ {t("sheet.backToChat")}
            </button>
            <Suspense fallback={<div className="ui-side-panel-empty">{t("common.loading")}</div>}>
              <TaskHubWorkspace
                key={activeTab.root}
                root={activeTab.root}
                onOpenQuick={(quick) => handleOpenTaskQuick(quick)}
                onOpenKnowledge={handleOpenKnowledgeTab}
                onOpenDesign={(artifactId, pipeline) =>
                  void handleOpenDesignArtifact({
                    id: artifactId,
                    title: artifactId,
                    pipeline: pipeline === "spec" ? "spec" : "openui",
                    createdAt: "",
                    updatedAt: "",
                  })
                }
              />
            </Suspense>
          </div>
        ) : activeTab.kind === "task" ? (
          <div className="ui-sheet">
            <button
              type="button"
              className="ui-sheet-close"
              onClick={() => handleCloseTaskTab(activeTab.treeId)}
              aria-label={t("sheet.backToChat")}
            >
              ✕ {t("sheet.backToChat")}
            </button>
            <Suspense fallback={<div className="ui-side-panel-empty">{t("diff.loading")}</div>}>
              <TaskRecordPanel
                treeId={activeTab.treeId}
                workspaceRoot={taskTabs.find((tab) => tab.treeId === activeTab.treeId)?.root ?? undefined}
              />
            </Suspense>
          </div>
        ) : (
          <div className="ui-chat-stage">
            <InstructionToc messages={messages} />
            <div className="ui-chat-main">
              {planProgress ? (
                <PinnedPlan lines={planProgress.lines} done={planProgress.done} total={planProgress.total} />
              ) : null}
              {chatContent}
            </div>
            <ActivityRail messages={messages} busy={busy} collapsed={companionOpen} />
          </div>
        )}
      </div>

      {/* Settings — centered modal card (shell level, modal family): settings
          is a form dialog, not a workspace surface. Compact card over a
          click-to-dismiss scrim; the conversation stage stays visible behind.
          scrim 98 · card 99 — above the floating islands, below the app's
          .ui-modal-overlay (100) / palette (120) / toasts (200). */}
      {activeTab.kind === "settings" && editable ? (
        <>
          <div className="ui-settings-scrim" onClick={requestCloseSettings} aria-hidden />
          <div className="ui-settings-modal">
            <SettingsPanel
              initial={editable}
              initialTab={settingsInitialTab}
              onSave={handleSaveSettings}
              onClose={requestCloseSettings}
              onDirtyChange={setSettingsDirty}
              platform={platform}
              theme={theme}
              onSelectTheme={handleSelectTheme}
            />
          </div>
        </>
      ) : null}

      {/* Right-side companion card — PM-Design / DeepDesign output */}
      {previewOpen && (prototypeJson || prototypeMode === "openui" || designContent) ? (
        <div className="ui-preview-panel">
          <div
            className="ui-companion-resize"
            onMouseDown={handleCompanionResizeStart}
            role="separator"
            aria-orientation="vertical"
          />
          <div className="ui-preview-panel-head">
            <div className="ui-preview-tabs">
              {/* PRD artifacts get their OWN marker — the Design tab is for UI
                  visual drafts only (user report 2026-09-02: a PM spec opened
                  under "Design" read as a UI design). */}
              {prototypeMode === "spec" ? (
                <button
                  className={`ui-preview-tab ${previewTab === "prd" ? "active" : ""}`}
                  onClick={() => setPreviewTab("prd")}
                >
                  <IconSparkle /> PRD
                </button>
              ) : (
                <>
                  <button
                    className={`ui-preview-tab ${previewTab === "prototype" ? "active" : ""}`}
                    onClick={() => setPreviewTab("prototype")}
                  >
                    <IconSparkle /> Prototype
                  </button>
                  <button
                    className={`ui-preview-tab ${previewTab === "design" ? "active" : ""}`}
                    onClick={() => setPreviewTab("design")}
                  >
                    <IconSparkle /> Design
                  </button>
                </>
              )}
            </div>
            <button className="ui-preview-close" onClick={closePreview} title="Close preview">
              ✕
            </button>
          </div>
          <div className="ui-preview-panel-body">
            <Suspense
              fallback={
                <div className="ui-editor-empty">
                  <span className="ui-spinner" /> {t("common.loading")}
                </div>
              }
            >
              {previewTab === "prd" && designContent && prototypeMode === "spec" ? (
                <StreamdownView className="ui-md ui-proto-spec-doc" markdown={designContent} />
              ) : previewTab === "design" && designContent ? (
                <DesignPreview ddContent={designContent} onIterate={(text) => void runPrompt({ text })} />
              ) : prototypeMode !== "design" && prototypeMode !== "spec" ? (
                <PrototypePanel
                  a2uiJson={prototypeJson ?? ""}
                  openuiCode={prototypeOpenuiCode}
                  mode={prototypeMode}
                  onIterate={(text) => void runPrompt({ text })}
                />
              ) : null}
            </Suspense>
          </div>
        </div>
      ) : null}

      {/* Task-hub quick sheet (same right slot as the preview — mutually
          exclusive): read-only report / timeline / build-details views. */}
      {taskQuick ? (
        <Suspense fallback={null}>
          <TaskQuickSheet title={taskQuick.title} onClose={handleCloseTaskQuick}>
            {taskQuick.kind === "report" ? (
              <ReportQuickContent root={taskQuick.root} reportId={taskQuick.reportId} />
            ) : taskQuick.kind === "timeline" ? (
              <TaskRecordPanel treeId={taskQuick.treeId} workspaceRoot={taskQuick.root} />
            ) : (
              <BuildQuickContent stages={taskQuick.stages} error={taskQuick.error} />
            )}
          </TaskQuickSheet>
        </Suspense>
      ) : null}

      {/* Quick dock — the everyday trio (sessions / new / workspace) pulled
          out of the hub into a persistent top-left capsule. Hidden while the
          hub rail is up: same corner, and browsing belongs to the rail. */}
      {!panelOpen ? (
        <QuickDock
          sessionTitle={activeSessionTitle}
          busy={busy}
          modKey={modKey}
          onOpenSessions={() => selectView("explorer")}
          onNewSession={handleNewSession}
          onNewWorkspace={() => void handleNewWorkspace()}
        />
      ) : null}

      {/* Tide orb — the stage's idle-state navigation affordance: summons the
          hub sheet. Merged into the rail while it is open (the rail's bottom
          ⟨ / Esc / ⌘B close it), so the corner never shows both. Pulses when
          the session needs the user (permission/question). */}
      {!panelOpen ? (
        <HubOrb
          badge={activeStatus === "ask_permission" || activeStatus === "waiting_for_user"}
          modKey={modKey}
          onClick={handleToggleHub}
        />
      ) : null}

      {/* Background-task badge — compact circular presence (module icon in
          center) for running builds/reviews; the big console below opens ONLY
          from the badge (real-machine feedback: never auto-pop over chat).
          The badge hides while its console is open (same corner, no overlap). */}
      {!buildConsoleOpen ? <BackgroundTaskBadge onOpen={openBackgroundTask} /> : null}

      {/* Build console — temporary floating A2UI surface (R3-5), on demand */}
      {buildConsoleOpen && hasBuildJobs ? <BuildConsolePanel onClose={() => setBuildConsoleOpen(false)} /> : null}

      {/* Picture-in-picture — parked workspaces: mini card bottom-right +
          top-right alerts for sessions blocked on a gate. Click restores. */}
      {pipBlockedEntries.length > 0 ? (
        <div className="ui-pip-alerts" role="status">
          {pipBlockedEntries.map((entry) => (
            <button key={entry.root} type="button" className="ui-pip-alert-row" onClick={() => restorePipEntry(entry)}>
              <span className="ui-pip-alert-dot" aria-hidden />
              <span className="ui-pip-alert-text">{(entry.title ?? entry.label) + " · " + t("pip.blocked")}</span>
              <span className="ui-pip-alert-go">→</span>
            </button>
          ))}
        </div>
      ) : null}
      {pipTop ? (
        <div className={cx("ui-pip", isPipBlocked(pipTop) && "blocked", buildConsoleOpen && "console-open")}>
          <div className="ui-pip-head">
            <span className={cx("ui-pip-dot", isPipBlocked(pipTop) && "urgent")} aria-hidden />
            <button
              type="button"
              className="ui-pip-title"
              onClick={() => restorePipEntry(pipTop)}
              data-tip={pipTop.root}
            >
              {(pipTop.title ?? pipTop.label).slice(0, 28) || t("sidebar.untitled")}
            </button>
            <span className="ui-pip-label">{pipTop.label}</span>
            {pipStack.length > 1 ? (
              <button
                type="button"
                className="ui-pip-cycle"
                onClick={cyclePip}
                title={`${t("pip.cycle")} (${pipStack.length})`}
                aria-label={t("pip.cycle")}
              >
                ⇅{pipStack.length}
              </button>
            ) : null}
          </div>
          <div className="ui-pip-body">
            {pipTop.frozen.slice(-6).map((m, i) => {
              const line = pipLineOf(m);
              if (!line.text) return null;
              return (
                <div key={i} className={`ui-pip-line ${line.role}`}>
                  <span className="ui-pip-line-role">{line.role === "user" ? t("pip.you") : t("pip.ai")}</span>
                  <span className="ui-pip-line-text">{line.text}</span>
                </div>
              );
            })}
          </div>
          <button type="button" className="ui-pip-back" onClick={() => restorePipEntry(pipTop)}>
            ↩ {t("pip.back")}
          </button>
        </div>
      ) : null}

      {/* Serena result mirror — floating right panel (R3-6) */}
      {serenaOpen && serenaEvents.length > 0 ? (
        <SerenaPanel events={serenaEvents} onClose={() => setSerenaOpen(false)} />
      ) : null}

      {diffTarget ? (
        <Suspense fallback={<div className="ui-editor-overlay" />}>
          <DiffOverlay target={diffTarget} onClose={() => setDiffTarget(null)} onOpenEditor={handleOpenEditor} />
        </Suspense>
      ) : null}

      {modal === "undo" ? (
        <UndoModal sessionId={activeId} onClose={() => setModal(null)} onRestored={() => void handleUndoRestored()} />
      ) : null}

      {/* Model-transport fault dialog — the build console keeps the full
          detail; this exists so a broken endpoint is impossible to miss. */}
      {modelFault ? (
        <Modal
          title={t("build.modelFaultTitle")}
          subtitle={t("build.modelFaultBody")}
          onClose={() => setModelFault(null)}
          actions={
            <Button variant="primary" onClick={() => setModelFault(null)}>
              {t("build.modelFaultOk")}
            </Button>
          }
        >
          <div className="ui-model-fault-detail">{formatBuildError(modelFault, t)}</div>
        </Modal>
      ) : null}

      {modal === "shortcuts" ? <ShortcutsModal platform={platform} onClose={() => setModal(null)} /> : null}

      {/* Settings close confirmed by Esc / scrim / tab ✕ while edits are
          unsaved — same dialog the panel's old close button used to show. */}
      {modal === "discard-settings" ? (
        <Modal
          title={t("settings.unsavedTitle")}
          subtitle={t("settings.unsavedBody")}
          onClose={() => setModal(null)}
          actions={
            <>
              <Button onClick={() => setModal(null)}>{t("common.cancel")}</Button>
              <Button
                variant="primary"
                onClick={() => {
                  setSettingsDirty(false);
                  setModal(null);
                  handleCloseAuxTab("settings");
                }}
              >
                {t("settings.unsavedDiscard")}
              </Button>
            </>
          }
        />
      ) : null}

      {trustAskOpen ? (
        <WorkspaceTrustDialog busy={trustBusy} onSelect={(level) => void handleTrustSelect(level)} />
      ) : null}

      {branchConflict ? (
        <Modal
          title={t("scm.dirtySwitchTitle")}
          subtitle={t("scm.dirtySwitchBody", { branch: branchConflict })}
          onClose={() => setBranchConflict(null)}
          actions={
            <>
              <Button onClick={() => setBranchConflict(null)}>{t("common.cancel")}</Button>
              <Button variant="primary" disabled={stashSwitching} onClick={() => void handleStashAndSwitch()}>
                {stashSwitching ? t("scm.stashSwitchBusy") : t("scm.stashAndSwitch")}
              </Button>
            </>
          }
        />
      ) : null}

      <CommandPalette
        open={paletteOpen}
        items={commandItems}
        placeholder={t("command.placeholder")}
        emptyLabel={t("command.empty")}
        onClose={() => setPaletteOpen(false)}
      />

      <ToastContainer toasts={toasts} onDismiss={dismissToast} onPause={pauseToast} onResume={resumeToast} />
    </div>
  );
}
