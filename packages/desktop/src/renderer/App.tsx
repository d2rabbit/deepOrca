import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type JSX } from "react";
import { api } from "./api";
import { useTreeRefresh } from "./hooks/use-tree-refresh";
import { useDocumentTitle } from "./hooks/use-document-title";
import { useComposerDockHeight } from "./hooks/use-composer-dock-height";
import { usePanelLayout } from "./hooks/use-panel-layout";
import { useAppearance } from "./hooks/use-appearance";
import { usePreview } from "./hooks/use-preview";
import { useSkills } from "./hooks/use-skills";
import { useProcessPanel } from "./hooks/use-process-panel";
import { useGit } from "./hooks/use-git";
import { useGlobalShortcuts } from "./hooks/use-global-shortcuts";
import { useSettingsData } from "./hooks/use-settings-data";
import type {
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
const TaskTreePanel = lazy(() => import("./components/TaskTreePanel").then((m) => ({ default: m.TaskTreePanel })));
const TaskRecordPanel = lazy(() =>
  import("./components/TaskRecordPanel").then((m) => ({ default: m.TaskRecordPanel }))
);
import { GitMcpPanel } from "./components/GitMcpPanel";
import { EditorPanel } from "./components/EditorPanel";
import { UndoModal } from "./components/UndoModal";
import { ProcessOutputPanel } from "./components/ProcessOutputPanel";
import { TaskProgressPanel } from "./components/TaskProgressPanel";
import { ShortcutsModal } from "./components/ShortcutsModal";
import { WorkspaceTrustDialog } from "./components/WorkspaceTrustDialog";
import { ToastContainer, useToasts } from "./components/Toast";
import { BuildConsolePanel } from "./components/BuildConsolePanel";
import { StreamdownView } from "./components/StreamdownView";
import { buildReviewFixPrompt, type ReviewFinding } from "./lib/review-fix";
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
  Rail,
  RailButton,
  RailSpacer,
  IconNewSession,
  IconSessions,
  IconGit,
  IconTasks,
  IconCommand,
  IconPlugins,
  IconTokens,
  IconIndex,
  IconReview,
  IconDesign,
  IconPrototype,
  IconTaskTree,
  IconGitmcp,
  IconEditor,
  IconMoon,
  IconSun,
  IconUndo,
  IconSettings,
  Modal,
  Button,
  type CommandItem,
} from "./ui/index";

type PendingPermissionReply = {
  sessionId: string;
  permissions: PermissionResult["permissions"];
  alwaysAllows: PermissionResult["alwaysAllows"];
  alwaysAllowPaths: PermissionResult["alwaysAllowPaths"];
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
  const { toasts, push: pushToast, dismiss: dismissToast } = useToasts();
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

  const [modal, setModal] = useState<"undo" | "shortcuts" | null>(null);
  // Branch the user tried to switch to while the working tree had blocking local changes.

  // ── Main-area tab model ─────────────────────────────────────────────────────
  // The session tab is the workspace's fixed first tab (never closable); every
  // other surface — settings, plugin detail, editor files, task records,
  // knowledge views — opens as its OWN tab and never overwrites another.
  // Panels close only via their tab's ✕ (falling back to the session tab).
  // This replaced the old pre-empting `mainView` state, whose bug: while
  // settings/plugins filled the main area, opening another panel added a tab
  // underneath that could never be reached.
  type MainTab =
    | { kind: "chat" }
    | { kind: "settings" }
    | { kind: "plugins" }
    | { kind: "editor"; file: string }
    | { kind: "knowledge"; root: string }
    | { kind: "task"; treeId: string };
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
  const {
    prototypeJson,
    prototypeMode,
    prototypeOpenuiCode,
    designContent,
    graphHtml,
    setGraphHtml,
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
  const [selectedPlugin, setSelectedPlugin] = useState<PluginSelection | null>(null);
  const [diffTarget, setDiffTarget] = useState<DiffTarget | null>(null);
  // Workspace task tabs (specs/task-tree session→task cross-reference entry):
  // opened from session badges, one tree per tab in the main area.
  const [taskTabs, setTaskTabs] = useState<Array<{ treeId: string; title: string; root?: string }>>([]);
  /** Knowledge tab (specs/index-knowledge-rework T3): one per workspace root. */
  const [knowledgeTabs, setKnowledgeTabs] = useState<Array<{ root: string; label: string }>>([]);
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
    panelWidth,
    handleResizeStart,
    selectView,
    openTokensView,
    handleCollapsePanel,
  } = usePanelLayout();
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
  // CRG architecture graph (Code Review panel) shares the right dock with the
  // design preview — opening one evicts the other (single-slot mutex; the
  // reverse direction lives in use-preview's open paths).
  const handleShowGraph = useCallback(
    (html: string) => {
      setGraphHtml(html);
      closePreview();
    },
    [closePreview, setGraphHtml]
  );
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
  const handleNewWorkspace = useCallback(async () => {
    const picked = await api.pickFolder();
    if (picked) {
      pendingSelectRef.current = null;
      setMainView("chat");
      await api.setProjectRoot(picked);
    }
  }, [setMainView]);

  // New session within a workspace: switch root if needed (fresh slate follows),
  // else just reset the current workspace to a fresh session.
  const handleNewSessionInWorkspace = useCallback(
    async (root: string) => {
      setMainView("chat");
      if (root && root !== projectRootRef.current) {
        pendingSelectRef.current = null;
        await api.setProjectRoot(root);
        return;
      }
      await loadSession(null);
    },
    [loadSession, setMainView]
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
      // Selecting a conversation always lands on its workspace (💬) tab —
      // the task-badge entry relies on this (R3-8): leaving an aux tab
      // active would hide the chat the user asked for.
      setActiveTab({ kind: "chat" });
      if (root && root !== projectRootRef.current) {
        pendingSelectRef.current = id;
        await api.setProjectRoot(root);
        setMainView("chat");
        return;
      }
      setMainView("chat");
      await loadSession(id);
    },
    [loadSession, setMainView]
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
  const handleOpenTaskRecord = useCallback((treeId: string, title: string, root: string) => {
    setTaskTabs((tabs) => (tabs.some((tab) => tab.treeId === treeId) ? tabs : [...tabs, { treeId, title, root }]));
    setActiveTab({ kind: "task", treeId });
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
    (action: "plan" | "init" | "skills" | "undo") => {
      if (action === "plan") {
        setPlanMode((v) => !v);
      } else if (action === "init") {
        void runPrompt({ text: "/init" });
      } else if (action === "skills") {
        selectView("plugins");
      } else if (action === "undo") {
        setModal("undo");
      }
    },
    [runPrompt, selectView]
  );

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
    togglePanel: () => setPanelOpen((v) => !v),
    newSession: handleNewSession,
    openSettings: handleOpenSettings,
    toggleShortcutsModal: () => setModal((v) => (v === "shortcuts" ? null : "shortcuts")),
    // The trust dialog is modal by design — no shortcut may act behind it.
    blocked: () => trustAskOpen,
  });

  const commandItems = useMemo<CommandItem[]>(
    () => [
      {
        id: "new",
        label: t("command.new.label"),
        keywords: "new session",
        shortcut: `${modKey}N`,
        run: handleNewSession,
      },
      {
        id: "plan",
        label: t("command.plan.label"),
        keywords: "plan",
        shortcut: "⇧Tab",
        run: () => setPlanMode((v) => !v),
      },
      {
        id: "plugins",
        label: t("command.plugins.label"),
        keywords: "plugins mcp skills",
        run: () => selectView("plugins"),
      },
      {
        id: "settings",
        label: t("command.settings.label"),
        keywords: "settings config",
        shortcut: `${modKey},`,
        run: () => void handleOpenSettings(),
      },
      {
        id: "undo",
        label: t("command.undo.label"),
        keywords: "undo restore",
        shortcut: `${modKey}Z`,
        run: () => setModal("undo"),
      },
      {
        id: "export",
        label: t("command.export.label"),
        keywords: "export markdown save session",
        run: () => {
          const id = activeIdRef.current;
          if (id) {
            void api.exportSession(id).then((res) => {
              if (res.ok && res.path)
                pushToast("success", `${t("command.export.label")}: ${res.path.split(/[\\/]/).pop()}`);
              else if (!res.ok) pushToast("error", res.error ?? t("app.requestFailed"));
            });
          }
        },
      },
      {
        id: "tokens",
        label: t("command.tokens.label"),
        keywords: "token usage cost consumption",
        run: openTokensView,
      },
      {
        id: "init",
        label: t("command.init.label"),
        keywords: "init agents",
        run: () => void runPrompt({ text: "/init" }),
      },
      { id: "raw", label: t("command.raw.label"), keywords: "reasoning raw", run: handleCycleReasoning },
      {
        id: "sidebar",
        label: t("shortcuts.toggleSidebar"),
        keywords: "sidebar panel toggle",
        shortcut: `${modKey}B`,
        run: () => setPanelOpen((v) => !v),
      },
      {
        id: "shortcuts",
        label: t("shortcuts.title"),
        keywords: "keyboard help hotkeys",
        shortcut: `${modKey}?`,
        run: () => setModal("shortcuts"),
      },
      // ── Sidebar views (audit P1-4: every rail-reachable view must be ⌘K-reachable) ──
      {
        id: "view.explorer",
        label: t("rail.sessions"),
        keywords: "sidebar view sessions explorer",
        run: () => selectView("explorer"),
      },
      {
        id: "view.scm",
        label: t("rail.git"),
        keywords: "sidebar view git scm source control",
        run: () => selectView("scm"),
      },
      {
        id: "view.tasks",
        label: t("rail.tasks"),
        keywords: "sidebar view tasks plan todo",
        run: () => selectView("tasks"),
      },
      {
        id: "view.index",
        label: t("rail.index"),
        keywords: "sidebar view index library knowledge",
        run: () => selectView("index"),
      },
      {
        id: "view.review",
        label: t("rail.review"),
        keywords: "sidebar view code review comments",
        run: () => selectView("review"),
      },
      {
        id: "view.prototype",
        label: t("rail.prototype"),
        keywords: "sidebar view prototype spec requirements 原型 需求文档",
        run: () => selectView("prototype"),
      },
      {
        id: "view.design",
        label: t("rail.design"),
        keywords: "sidebar view design ui ux",
        run: () => selectView("design"),
      },
      {
        id: "view.tasktree",
        label: t("rail.tasktree"),
        keywords: "sidebar view task tree history",
        run: () => selectView("tasktree"),
      },
      {
        id: "view.gitmcp",
        label: t("rail.gitmcp"),
        keywords: "sidebar view gitmcp remote",
        run: () => selectView("gitmcp"),
      },
      {
        id: "view.editor",
        label: t("rail.editor"),
        keywords: "sidebar view editor files",
        run: () => selectView("editor"),
      },
      // ── Themes (all 6, via the same handler the settings panel uses) ──
      {
        id: "theme.aqua",
        label: t("theme.aqua"),
        keywords: "theme appearance aqua native",
        run: () => handleSelectTheme("aqua"),
      },
      {
        id: "theme.metro",
        label: t("theme.metro"),
        keywords: "theme appearance metro native",
        run: () => handleSelectTheme("metro"),
      },
      {
        id: "theme.glass",
        label: t("theme.glass"),
        keywords: "theme appearance glass",
        run: () => handleSelectTheme("glass"),
      },
      {
        id: "theme.fusion",
        label: t("theme.fusion"),
        keywords: "theme appearance fusion tile",
        run: () => handleSelectTheme("fusion"),
      },
      {
        id: "theme.line",
        label: t("theme.line"),
        keywords: "theme appearance line stroke",
        run: () => handleSelectTheme("line"),
      },
      {
        id: "theme.orca",
        label: t("theme.orca"),
        keywords: "theme appearance orca cyber hud",
        run: () => handleSelectTheme("orca"),
      },
      // ── Appearance / panel toggles ──
      {
        id: "appearance.toggle",
        label: t("command.appearance.label"),
        keywords: "appearance dark light mode",
        run: handleToggleAppearance,
      },
      {
        id: "line.variant",
        label: t("command.lineVariant.label"),
        keywords: "line variant punk style",
        run: handleToggleLineVariant,
      },
      {
        id: "processPanel",
        label: t("shortcuts.processPanel"),
        keywords: "process output panel terminal",
        shortcut: `${modKey}J`,
        run: () => setShowProcessPanel((v) => !v),
      },
      {
        id: "stop",
        label: t("shortcuts.stopGeneration"),
        keywords: "stop interrupt cancel generation",
        run: handleStop,
      },
    ],
    [
      handleCycleReasoning,
      handleNewSession,
      handleOpenSettings,
      handleSelectTheme,
      handleStop,
      handleToggleAppearance,
      handleToggleLineVariant,
      modKey,
      openTokensView,
      pushToast,
      runPrompt,
      selectView,
      setPanelOpen,
      setShowProcessPanel,
      t,
    ]
  );

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

  // Right dock is mounted when either preview surface has content (F1): the
  // shell gains `right-open` so the 4th grid track gets real width. Without
  // it the auto-placed panel landed in a 0px track and rendered off-window.
  const previewPanelMounted = Boolean(previewOpen && (prototypeJson || prototypeMode === "openui" || designContent));
  const rightPanelOpen = previewPanelMounted || Boolean(graphHtml);

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
      <TaskProgressPanel />
      {showProcessPanel ? (
        <ProcessOutputPanel
          processes={runningProcesses}
          stdoutRef={processStdoutRef}
          onDismiss={() => setShowProcessPanel(false)}
          platform={platform}
        />
      ) : null}
      <div className="ui-composer-dock" ref={composerDockRef}>
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

  // The session workspace is ALWAYS the first, locked tab; every auxiliary
  // surface (settings / plugin detail / editor files / task records /
  // knowledge) is its own tab in the strip. The strip is permanently visible —
  // even with no auxiliary tabs the session tab anchors the main area.

  return (
    <div
      className={`ui-shell${panelOpen ? " panel-open" : ""}${rightPanelOpen ? " right-open" : ""}`}
      style={panelOpen ? ({ "--ui-panel-w": `${panelWidth}px` } as CSSProperties) : undefined}
    >
      {/* Global [data-tip] hover tooltip — portal-rendered, fixed-position
          (the old CSS ::after tips clipped inside the rail's scroll container). */}
      <GlobalTooltip />
      <Rail>
        <RailButton
          title={`${t("rail.newSession")} (${modKey}N)`}
          aria-label={t("rail.newSession")}
          onClick={handleNewSession}
        >
          <IconNewSession />
        </RailButton>
        <RailButton
          active={panelOpen && sidebarView === "explorer"}
          badge={activeStatus === "ask_permission" || activeStatus === "waiting_for_user"}
          title={`${t("rail.sessions")} (${modKey}B)`}
          aria-label={t("rail.sessions")}
          onClick={() => selectView("explorer")}
        >
          <IconSessions />
        </RailButton>
        <RailButton
          active={panelOpen && sidebarView === "scm"}
          title={t("rail.git")}
          aria-label={t("rail.git")}
          onClick={() => selectView("scm")}
        >
          <IconGit />
        </RailButton>
        <RailButton
          active={panelOpen && sidebarView === "tasks"}
          disabled={!hasPlan}
          title={t("rail.tasks")}
          aria-label={t("rail.tasks")}
          onClick={() => selectView("tasks")}
        >
          <IconTasks />
        </RailButton>
        <RailButton
          title={`${t("rail.commands")} (${modKey}K)`}
          aria-label={t("rail.commands")}
          onClick={() => setPaletteOpen(true)}
        >
          <IconCommand />
        </RailButton>
        <RailButton
          active={panelOpen && sidebarView === "plugins"}
          title={t("rail.plugins")}
          aria-label={t("rail.plugins")}
          onClick={() => selectView("plugins")}
        >
          <IconPlugins />
        </RailButton>
        <RailButton
          active={panelOpen && sidebarView === "tokens"}
          title={t("rail.tokens")}
          aria-label={t("rail.tokens")}
          onClick={openTokensView}
        >
          <IconTokens />
        </RailButton>
        <RailButton
          active={panelOpen && sidebarView === "index"}
          title={t("rail.index")}
          aria-label={t("rail.index")}
          onClick={() => selectView("index")}
        >
          <IconIndex />
        </RailButton>
        <RailButton
          active={panelOpen && sidebarView === "review"}
          title={t("rail.review")}
          aria-label={t("rail.review")}
          onClick={() => selectView("review")}
        >
          <IconReview />
        </RailButton>
        <RailButton
          active={panelOpen && sidebarView === "prototype"}
          title={t("rail.prototype")}
          aria-label={t("rail.prototype")}
          onClick={() => selectView("prototype")}
        >
          <IconPrototype />
        </RailButton>
        <RailButton
          active={panelOpen && sidebarView === "design"}
          title={t("rail.design")}
          aria-label={t("rail.design")}
          onClick={() => selectView("design")}
        >
          <IconDesign />
        </RailButton>
        <RailButton
          active={panelOpen && sidebarView === "tasktree"}
          title={t("rail.tasktree")}
          aria-label={t("rail.tasktree")}
          onClick={() => selectView("tasktree")}
        >
          <IconTaskTree />
        </RailButton>
        <RailButton
          active={panelOpen && sidebarView === "gitmcp"}
          title={t("rail.gitmcp")}
          aria-label={t("rail.gitmcp")}
          onClick={() => selectView("gitmcp")}
        >
          <IconGitmcp />
        </RailButton>
        <RailButton
          active={panelOpen && sidebarView === "editor"}
          title={t("rail.editor")}
          aria-label={t("rail.editor")}
          onClick={() => selectView("editor")}
        >
          <IconEditor />
        </RailButton>
        <RailSpacer />
        {/* Bottom cluster: appearance / undo / settings only (rail declutter —
            reasoning cycle, line variant and glass theme live on their
            shortcuts + command palette). Orca is dark-only, so the light/dark
            toggle is disabled while it's active. */}
        <RailButton
          title={appearanceTitle}
          aria-label={appearanceTitle}
          disabled={theme === "orca"}
          onClick={handleToggleAppearance}
        >
          {appearance === "dark" ? <IconMoon /> : <IconSun />}
        </RailButton>
        <RailButton title={t("rail.undo")} aria-label={t("rail.undo")} onClick={() => setModal("undo")}>
          <IconUndo />
        </RailButton>
        <RailButton
          active={mainView === "settings"}
          title={`${t("rail.settings")} (${modKey},)`}
          aria-label={t("rail.settings")}
          onClick={() => void handleOpenSettings()}
        >
          <IconSettings />
        </RailButton>
      </Rail>

      {/* Sidebar view transition wrapper — key change triggers fade animation */}
      <div className="ui-session-panel-view" key={sidebarView}>
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
            onOpenDiff={handleOpenDiff}
            onOpenEditor={handleOpenEditor}
          />
        ) : sidebarView === "tasks" ? (
          <TaskPanel messages={messages} />
        ) : sidebarView === "tokens" ? (
          <TokenStatsPanel sessions={sessions} />
        ) : sidebarView === "index" ? (
          <IndexLibraryPanel onOpenWorkspace={handleOpenKnowledgeTab} />
        ) : sidebarView === "review" ? (
          <Suspense fallback={<div className="ui-side-panel-empty">Loading…</div>}>
            <CodeReviewPanel onShowGraph={handleShowGraph} onOneClickFix={handleReviewOneClickFix} />
          </Suspense>
        ) : sidebarView === "prototype" ? (
          <Suspense fallback={<div className="ui-side-panel-empty">Loading…</div>}>
            <PrototypeDesignPanel onOpenArtifact={handleOpenDesignArtifact} />
          </Suspense>
        ) : sidebarView === "design" ? (
          <Suspense fallback={<div className="ui-side-panel-empty">Loading…</div>}>
            <DesignPanel onOpenArtifact={handleOpenDesignArtifact} />
          </Suspense>
        ) : sidebarView === "tasktree" ? (
          <Suspense fallback={<div className="ui-side-panel-empty">Loading…</div>}>
            <TaskTreePanel onOpenTask={handleOpenTaskRecord} />
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
      </div>

      {/* Panel resize handle */}
      {panelOpen ? (
        <div className="ui-panel-resize" style={{ left: `${52 + panelWidth - 2}px` }} onMouseDown={handleResizeStart} />
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
      />

      <div className="ui-main">
        <div className="ui-tasktab-view">
          <div className="ui-tasktabs">
            {/* Main session tab — always first, locked (never closable). */}
            <div className={`ui-tasktab${activeTab.kind === "chat" ? " active" : ""}`}>
              <button type="button" className="ui-tasktab-main" onClick={() => setActiveTab({ kind: "chat" })}>
                💬 {projectRoot ? (projectRoot.split(/[\\/]/).filter(Boolean).pop() ?? "Session") : "Session"}
              </button>
            </div>
            {auxTabs.map((tab) => (
              <div
                key={tab.key}
                className={`ui-tasktab${
                  tab.kind === "editor"
                    ? activeTab.kind === "editor" && activeTab.file === tab.file
                      ? " active"
                      : ""
                    : activeTab.kind === tab.kind
                      ? " active"
                      : ""
                }`}
              >
                <button
                  type="button"
                  className="ui-tasktab-main"
                  onClick={() =>
                    setActiveTab(tab.kind === "editor" ? { kind: "editor", file: tab.file ?? "" } : { kind: tab.kind })
                  }
                  title={tab.kind === "editor" ? tab.file : undefined}
                >
                  {tab.kind === "settings"
                    ? `⚙ ${t("settings.title")}`
                    : tab.kind === "plugins"
                      ? `🧩 ${t("plugins.title")}`
                      : `📄 ${(tab.file ?? "").split(/[\\/]/).pop()}`}
                </button>
                <button
                  type="button"
                  className="ui-tasktab-close"
                  onClick={() => handleCloseAuxTab(tab.key)}
                  title={t("tasktree.closeTab")}
                  aria-label={t("tasktree.closeTab")}
                >
                  ✕
                </button>
              </div>
            ))}
            {taskTabs.map((tab) => (
              <div
                key={tab.treeId}
                className={`ui-tasktab${activeTab.kind === "task" && activeTab.treeId === tab.treeId ? " active" : ""}`}
              >
                <button
                  type="button"
                  className="ui-tasktab-main"
                  onClick={() => setActiveTab({ kind: "task", treeId: tab.treeId })}
                >
                  <IconTaskTree /> {tab.title}
                </button>
                <button
                  type="button"
                  className="ui-tasktab-close"
                  onClick={() => handleCloseTaskTab(tab.treeId)}
                  title={t("tasktree.closeTab")}
                  aria-label={t("tasktree.closeTab")}
                >
                  ✕
                </button>
              </div>
            ))}
            {knowledgeTabs.map((tab) => (
              <div
                key={tab.root}
                className={`ui-tasktab${activeTab.kind === "knowledge" && activeTab.root === tab.root ? " active" : ""}`}
              >
                <button
                  type="button"
                  className="ui-tasktab-main"
                  onClick={() => setActiveTab({ kind: "knowledge", root: tab.root })}
                >
                  📚 {tab.label}
                </button>
                <button
                  type="button"
                  className="ui-tasktab-close"
                  onClick={() => handleCloseKnowledgeTab(tab.root)}
                  title={t("tasktree.closeTab")}
                  aria-label={t("tasktree.closeTab")}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          {activeTab.kind === "settings" && editable ? (
            <SettingsPanel
              initial={editable}
              initialTab={settingsInitialTab}
              onSave={handleSaveSettings}
              onClose={() => handleCloseAuxTab("settings")}
              platform={platform}
              theme={theme}
              onSelectTheme={handleSelectTheme}
            />
          ) : activeTab.kind === "plugins" ? (
            <PluginDetail
              selection={selectedPlugin}
              skills={skills}
              selectedSkills={selectedSkills}
              onToggleSkill={handleToggleSkill}
              onBack={() => handleCloseAuxTab("plugins")}
            />
          ) : activeTab.kind === "editor" && activeTab.file ? (
            <Suspense
              fallback={
                <div className="ui-editor-empty">
                  <span className="ui-spinner" /> Loading editor…
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
          ) : activeTab.kind === "knowledge" ? (
            <KnowledgePanel root={activeTab.root} onOpenFile={handleOpenEditor} />
          ) : activeTab.kind === "task" ? (
            <Suspense fallback={<div className="ui-side-panel-empty">{t("diff.loading")}</div>}>
              <TaskRecordPanel
                treeId={activeTab.treeId}
                workspaceRoot={taskTabs.find((tab) => tab.treeId === activeTab.treeId)?.root ?? undefined}
              />
            </Suspense>
          ) : (
            chatContent
          )}
        </div>
      </div>

      {/* Right-side preview panel — PM-Design / DeepDesign output */}
      {previewOpen && (prototypeJson || prototypeMode === "openui" || designContent) ? (
        <div className="ui-preview-panel">
          <div className="ui-preview-panel-head">
            <div className="ui-preview-tabs">
              <button
                className={`ui-preview-tab ${previewTab === "prototype" ? "active" : ""}`}
                onClick={() => setPreviewTab("prototype")}
              >
                ✦ Prototype
              </button>
              <button
                className={`ui-preview-tab ${previewTab === "design" ? "active" : ""}`}
                onClick={() => setPreviewTab("design")}
              >
                ✦ Design
              </button>
            </div>
            <button className="ui-preview-close" onClick={closePreview} title="Close preview">
              ✕
            </button>
          </div>
          <div className="ui-preview-panel-body">
            <Suspense
              fallback={
                <div className="ui-editor-empty">
                  <span className="ui-spinner" /> Loading…
                </div>
              }
            >
              {previewTab === "design" && designContent ? (
                prototypeMode === "spec" ? (
                  <StreamdownView className="ui-md ui-proto-spec-doc" markdown={designContent} />
                ) : (
                  <DesignPreview ddContent={designContent} onIterate={(text) => void runPrompt({ text })} />
                )
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

      {graphHtml ? (
        <div className="ui-preview-panel">
          <div className="ui-preview-panel-head">
            <div className="ui-preview-tabs">
              <span className="ui-preview-tab active"> ◈ Architecture Graph</span>
            </div>
            <button className="ui-preview-close" onClick={() => setGraphHtml(null)} title="Close graph">
              ✕
            </button>
          </div>
          <div className="ui-preview-panel-body">
            <iframe
              srcDoc={graphHtml}
              title="Code Architecture Graph"
              sandbox="allow-scripts"
              style={{ width: "100%", height: "100%", border: "none", background: "#fff" }}
            />
          </div>
        </div>
      ) : null}

      {/* Background-task badge — compact circular presence (module icon in
          center) for running builds/reviews; the big console below opens ONLY
          from the badge (real-machine feedback: never auto-pop over chat).
          The badge hides while its console is open (same corner, no overlap). */}
      {!buildConsoleOpen ? <BackgroundTaskBadge onOpen={openBackgroundTask} /> : null}

      {/* Build console — temporary floating A2UI surface (R3-5), on demand */}
      {buildConsoleOpen && hasBuildJobs ? <BuildConsolePanel onClose={() => setBuildConsoleOpen(false)} /> : null}

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

      {modal === "shortcuts" ? <ShortcutsModal platform={platform} onClose={() => setModal(null)} /> : null}

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

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
