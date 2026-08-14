import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";
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
import type { AskPermissionRequest, SerializableSessionEntry, SessionMessage, UserPromptContent } from "../shared/ipc";
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
// specific views. This keeps the initial bundle small and defers ~8MB+ of
// code (Monaco + Mermaid + markdown renderers) until actually needed.
const CodeReviewPanel = lazy(() =>
  import("./components/CodeReviewPanel").then((m) => ({ default: m.CodeReviewPanel }))
);
const DiffOverlay = lazy(() => import("./components/DiffOverlay").then((m) => ({ default: m.DiffOverlay })));
import type { DiffTarget } from "./components/DiffOverlay";
const EditorOverlay = lazy(() => import("./components/EditorOverlay").then((m) => ({ default: m.EditorOverlay })));
const PrototypePanel = lazy(() => import("./components/PrototypePanel").then((m) => ({ default: m.PrototypePanel })));
const DesignPreview = lazy(() => import("./components/DesignPreview").then((m) => ({ default: m.DesignPreview })));
import { GitMcpPanel } from "./components/GitMcpPanel";
import { EditorPanel } from "./components/EditorPanel";
import { UndoModal } from "./components/UndoModal";
import { ProcessOutputPanel } from "./components/ProcessOutputPanel";
import { TaskProgressPanel } from "./components/TaskProgressPanel";
import { ShortcutsModal } from "./components/ShortcutsModal";
import { ToastContainer, useToasts } from "./components/Toast";
import { aggregateUsage, cacheHitRate } from "./lib/token-usage";
import { buildToolSummary, getPlanLines } from "./lib/messages";
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
  IconGitmcp,
  IconEditor,
  IconReasoningHidden,
  IconReasoningNormal,
  IconReasoningExpanded,
  IconMoon,
  IconSun,
  IconGlass,
  IconPunk,
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
  const { toasts, push: pushToast } = useToasts();
  const [projectRoot, setProjectRoot] = useState("");
  // Home dir reported by main — used to detect the fresh-install fallback root
  // so the UI never presents the user's home as a real workspace.
  const [homeDir, setHomeDir] = useState("");
  const [platform, setPlatform] = useState<string>("");
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

  const [mainView, setMainView] = useState<"chat" | "settings" | "plugins">("chat");
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
    resetForSession: resetPreviewForSession,
    closePreview,
  } = usePreview();
  const [selectedPlugin, setSelectedPlugin] = useState<PluginSelection | null>(null);
  const [diffTarget, setDiffTarget] = useState<DiffTarget | null>(null);
  const [editorFile, setEditorFile] = useState<string | null>(null);

  const {
    appearance,
    theme,
    lineVariant,
    reasoningMode,
    initFromPlatform: initAppearanceFromPlatform,
    handleToggleAppearance,
    handleToggleTheme,
    handleToggleLineVariant,
    handleSelectTheme,
    handleCycleReasoning,
  } = useAppearance(platform);

  const {
    sidebarView,
    panelOpen,
    setPanelOpen,
    panelWidth,
    handleResizeStart,
    selectView,
    openTokensView,
    handleCollapsePanel,
  } = usePanelLayout();
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
  const refreshSessions = useCallback(async () => {
    setSessions(await api.listSessions());
  }, []);

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
      if (message.sessionId === activeIdRef.current) {
        setMessages((prev) => [...prev, message]);
        applyPreviewToolMessage(message);
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
    const offRoot = api.onProjectRootChanged((root) => {
      setProjectRoot(root);
      void (async () => {
        try {
          await Promise.all([refreshSessions(), refreshSettings(), refreshSkills(), refreshMcp(), refreshGit()]);
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
      offRoot();
      // Cancel any pending throttled stream-progress flush so a detached timer
      // can't call setStreamProgress after the effect (and possibly the App)
      // has unmounted — important under React StrictMode double-invoke too.
      if (streamFlushTimer) {
        clearTimeout(streamFlushTimer);
        streamFlushTimer = null;
      }
    };
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
      try {
        const result = await api.sendPrompt(prompt);
        if (!result.ok) {
          setErrorLine(result.error ?? t("app.requestFailed"));
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
        });
        setStatusLine(t("app.permissionDenied"));
        setAskPermissions(undefined);
        void api.denyPermission();
        return;
      }
      void runPrompt(
        { text: "/continue", permissions: result.permissions, alwaysAllows: result.alwaysAllows },
        { isContinue: true }
      );
    },
    [runPrompt, t]
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
  }, []);

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
    [loadSession]
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
  }, [loadSession]);
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
    async (id: string) => {
      await api.archiveSession(id);
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
      if (root && root !== projectRootRef.current) {
        pendingSelectRef.current = id;
        await api.setProjectRoot(root);
        setMainView("chat");
        return;
      }
      setMainView("chat");
      await loadSession(id);
    },
    [loadSession]
  );
  const handleOpenDiff = useCallback((target: DiffTarget) => setDiffTarget(target), []);

  // ── Stable props for memoized children ──────────────────────────────────────
  // MessageList / Composer / Sidebar are wrapped in React.memo; every callback
  // handed to them must keep a stable identity across App re-renders (stream
  // ticks, busy ticks) or memoization is defeated.
  const handleTogglePlan = useCallback(() => setPlanMode((v) => !v), []);
  const handleRemoveImage = useCallback((i: number) => setImageUrls((prev) => prev.filter((_, idx) => idx !== i)), []);
  const handleAddImage = useCallback((dataUrl: string) => setImageUrls((prev) => [...prev, dataUrl]), []);
  const handleResumeClick = useCallback(() => void handleResume(), [handleResume]);
  const handleEnhanceClick = useCallback(() => void handleEnhance(), [handleEnhance]);
  const handleBackToChat = useCallback(() => setMainView("chat"), []);
  const handleSelectPlugin = useCallback((sel: PluginSelection) => {
    setSelectedPlugin(sel);
    setMainView("plugins");
  }, []);

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
  });

  const commandItems = useMemo<CommandItem[]>(
    () => [
      { id: "new", label: t("command.new.label"), keywords: "new session", shortcut: "⌘N", run: handleNewSession },
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
        shortcut: "⌘,",
        run: () => void handleOpenSettings(),
      },
      {
        id: "undo",
        label: t("command.undo.label"),
        keywords: "undo restore",
        shortcut: "⌘Z",
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
        shortcut: "⌘B",
        run: () => setPanelOpen((v) => !v),
      },
      {
        id: "shortcuts",
        label: t("shortcuts.title"),
        keywords: "keyboard help hotkeys",
        shortcut: "⌘?",
        run: () => setModal("shortcuts"),
      },
    ],
    [
      handleCycleReasoning,
      handleNewSession,
      handleOpenSettings,
      openTokensView,
      pushToast,
      runPrompt,
      selectView,
      setPanelOpen,
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

  const reasoningIconEl =
    reasoningMode === "hidden" ? (
      <IconReasoningHidden />
    ) : reasoningMode === "expanded" ? (
      <IconReasoningExpanded />
    ) : (
      <IconReasoningNormal />
    );
  const reasoningTitle =
    reasoningMode === "hidden"
      ? t("topbar.reasoningHidden")
      : reasoningMode === "expanded"
        ? t("topbar.reasoningExpanded")
        : t("topbar.reasoningNormal");
  const appearanceTitle = appearance === "dark" ? t("topbar.appearanceDark") : t("topbar.appearanceLight");
  const themeTitle = theme === "glass" ? t("topbar.themeGlass") : t("topbar.themeNative");
  const lineVariantTitle = lineVariant === "punk" ? t("topbar.linePunk") : t("topbar.lineStroke");

  return (
    <div
      className={`ui-shell${panelOpen ? " panel-open" : ""}`}
      style={panelOpen ? { gridTemplateColumns: `52px ${panelWidth}px 1fr 0` } : undefined}
    >
      <Rail>
        <RailButton title={`${t("rail.newSession")} (⌘N)`} aria-label={t("rail.newSession")} onClick={handleNewSession}>
          <IconNewSession />
        </RailButton>
        <RailButton
          active={panelOpen && sidebarView === "explorer"}
          badge={activeStatus === "ask_permission" || activeStatus === "waiting_for_user"}
          title={`${t("rail.sessions")} (⌘B)`}
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
        {hasPlan ? (
          <RailButton
            active={panelOpen && sidebarView === "tasks"}
            title={t("rail.tasks")}
            aria-label={t("rail.tasks")}
            onClick={() => selectView("tasks")}
          >
            <IconTasks />
          </RailButton>
        ) : null}
        <RailButton
          title={`${t("rail.commands")} (⌘K)`}
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
        <RailButton title={reasoningTitle} aria-label={reasoningTitle} onClick={handleCycleReasoning}>
          {reasoningIconEl}
        </RailButton>
        {/* Orca is dark-only — hide the light/dark toggle while it's active. */}
        {theme !== "orca" ? (
          <RailButton title={appearanceTitle} aria-label={appearanceTitle} onClick={handleToggleAppearance}>
            {appearance === "dark" ? <IconMoon /> : <IconSun />}
          </RailButton>
        ) : null}
        {theme === "line" ? (
          <RailButton
            active={lineVariant === "punk"}
            title={lineVariantTitle}
            aria-label={lineVariantTitle}
            onClick={handleToggleLineVariant}
          >
            <IconPunk />
          </RailButton>
        ) : theme !== "orca" && platform !== "win32" ? (
          <RailButton active={theme === "glass"} title={themeTitle} aria-label={themeTitle} onClick={handleToggleTheme}>
            <IconGlass />
          </RailButton>
        ) : null}
        <RailButton title={t("rail.undo")} aria-label={t("rail.undo")} onClick={() => setModal("undo")}>
          <IconUndo />
        </RailButton>
        <RailButton
          active={mainView === "settings"}
          title={`${t("rail.settings")} (⌘,)`}
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
            onSelectSession={handleSelectSession}
            onDelete={handleDeleteSession}
            onRename={handleRenameSession}
            onArchive={handleArchiveSession}
            onUnarchive={handleUnarchiveSession}
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
            onOpenEditor={setEditorFile}
          />
        ) : sidebarView === "tasks" ? (
          <TaskPanel messages={messages} />
        ) : sidebarView === "tokens" ? (
          <TokenStatsPanel sessions={sessions} />
        ) : sidebarView === "index" ? (
          <IndexLibraryPanel />
        ) : sidebarView === "review" ? (
          <Suspense fallback={<div className="ui-side-panel-empty">Loading…</div>}>
            <CodeReviewPanel />
          </Suspense>
        ) : sidebarView === "gitmcp" ? (
          <GitMcpPanel />
        ) : sidebarView === "editor" ? (
          <EditorPanel onOpenFile={setEditorFile} />
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
        {mainView === "settings" && editable ? (
          <SettingsPanel
            initial={editable}
            initialTab={settingsInitialTab}
            onSave={handleSaveSettings}
            onClose={handleBackToChat}
            platform={platform}
            theme={theme}
            onSelectTheme={handleSelectTheme}
          />
        ) : mainView === "plugins" ? (
          <PluginDetail
            selection={selectedPlugin}
            skills={skills}
            selectedSkills={selectedSkills}
            onToggleSkill={handleToggleSkill}
            onBack={handleBackToChat}
          />
        ) : sidebarView === "editor" && editorFile ? (
          <Suspense
            fallback={
              <div className="ui-editor-empty">
                <span className="ui-spinner" /> Loading editor…
              </div>
            }
          >
            <EditorOverlay filePath={editorFile} onClose={() => setEditorFile(null)} appearance={appearance} inline />
          </Suspense>
        ) : (
          <>
            <MessageList
              messages={messages}
              hasActiveSession={activeId !== null || messages.length > 0}
              reasoningMode={reasoningMode}
              compacting={activeStatus === "compacting"}
              onQuickAction={handleQuickAction}
              footer={footer}
            />
            <TaskProgressPanel />
            {showProcessPanel ? (
              <ProcessOutputPanel
                processes={runningProcesses}
                stdoutRef={processStdoutRef}
                onDismiss={() => setShowProcessPanel(false)}
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
                compacting={activeStatus === "compacting"}
              />
            </div>
          </>
        )}
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
                <DesignPreview ddContent={designContent} />
              ) : (
                <PrototypePanel
                  a2uiJson={prototypeJson ?? ""}
                  openuiCode={prototypeOpenuiCode}
                  mode={prototypeMode === "design" ? "a2ui" : prototypeMode}
                  onIterate={(text) => void runPrompt({ text })}
                />
              )}
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

      {diffTarget ? (
        <Suspense fallback={<div className="ui-editor-overlay" />}>
          <DiffOverlay target={diffTarget} onClose={() => setDiffTarget(null)} onOpenEditor={setEditorFile} />
        </Suspense>
      ) : null}

      {modal === "undo" ? (
        <UndoModal sessionId={activeId} onClose={() => setModal(null)} onRestored={() => void handleUndoRestored()} />
      ) : null}

      {modal === "shortcuts" ? <ShortcutsModal platform={platform} onClose={() => setModal(null)} /> : null}

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

      <ToastContainer toasts={toasts} />
    </div>
  );
}
