import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";
import { api } from "./api";
import type {
  AskPermissionRequest,
  EditableSettings,
  McpServerStatus,
  ModelConfigSelection,
  SerializableProcess,
  SerializableSessionEntry,
  SessionMessage,
  SettingsSummary,
  SkillInfo,
  UserPromptContent,
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
import { ProcessOutputPanel, accumulateStdout } from "./components/ProcessOutputPanel";
import { TaskProgressPanel } from "./components/TaskProgressPanel";
import { clearSurfaces as clearA2uiSurfaces } from "./a2ui/processor";
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
import {
  defaultAppearance,
  getStoredReasoningMode,
  getStoredLineVariant,
  applyLineVariant,
  nextReasoningMode,
  resolveAppearance,
  resolveTheme,
  baseTheme,
  setAppearance as persistAppearance,
  setTheme as persistTheme,
  setLineVariant as persistLineVariant,
  setReasoningMode as persistReasoningMode,
  type Appearance,
  type LineVariant,
  type ReasoningMode,
  type Theme,
} from "./lib/appearance";
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
  const [settings, setSettings] = useState<SettingsSummary | null>(null);
  const [platform, setPlatform] = useState<string>("");
  const [sessions, setSessions] = useState<SerializableSessionEntry[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [, setMcpStatuses] = useState<McpServerStatus[]>([]);

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
  const [branchConflict, setBranchConflict] = useState<string | null>(null);
  const [stashSwitching, setStashSwitching] = useState(false);
  const [editable, setEditable] = useState<EditableSettings | null>(null);
  const [settingsInitialTab, setSettingsInitialTab] = useState<string | undefined>(undefined);

  const [mainView, setMainView] = useState<"chat" | "settings" | "plugins">("chat");
  const [prototypeJson, setPrototypeJson] = useState<string | null>(null);
  const [prototypeMode, setPrototypeMode] = useState<"a2ui" | "openui" | "design">("a2ui");
  const [prototypeOpenuiCode, setPrototypeOpenuiCode] = useState<string>("");
  const [designContent, setDesignContent] = useState<string | null>(null);
  const [graphHtml, setGraphHtml] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewTab, setPreviewTab] = useState<"prototype" | "design">("prototype");
  const [selectedPlugin, setSelectedPlugin] = useState<PluginSelection | null>(null);
  const [sidebarView, setSidebarView] = useState<
    "explorer" | "scm" | "tasks" | "tokens" | "index" | "review" | "gitmcp" | "plugins" | "editor"
  >("explorer");
  const [treeRefreshKey, setTreeRefreshKey] = useState(0);
  const [diffTarget, setDiffTarget] = useState<DiffTarget | null>(null);
  const [editorFile, setEditorFile] = useState<string | null>(null);
  const [branch, setBranch] = useState("");
  const [branches, setBranches] = useState<string[]>([]);

  const [appearance, setAppearanceState] = useState<Appearance>("light");
  const [theme, setThemeState] = useState<Theme>("aqua");
  const [lineVariant, setLineVariantState] = useState<LineVariant>(() => getStoredLineVariant());
  const [reasoningMode, setReasoningModeState] = useState<ReasoningMode>(() => getStoredReasoningMode());

  const [panelOpen, setPanelOpen] = useState(true);
  const [panelWidth, setPanelWidth] = useState(280);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [showProcessPanel, setShowProcessPanel] = useState(false);
  const [runningProcesses, setRunningProcesses] = useState<SerializableProcess[]>([]);
  const processStdoutRef = useRef<Map<number, string>>(new Map());

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

  const bumpTree = useCallback(() => setTreeRefreshKey((k) => k + 1), []);

  // Throttled variant for high-frequency session-entry updates: every bump makes
  // the sidebar re-fetch the whole workspace tree over IPC, so during streaming
  // we cap it to once per 1.5s with a trailing call.
  const bumpTreeThrottleRef = useRef<{ last: number; timer: ReturnType<typeof setTimeout> | null }>({
    last: 0,
    timer: null,
  });
  const bumpTreeThrottled = useCallback(() => {
    const state = bumpTreeThrottleRef.current;
    const elapsed = Date.now() - state.last;
    if (elapsed >= 1500) {
      state.last = Date.now();
      bumpTree();
      return;
    }
    if (state.timer) return;
    state.timer = setTimeout(() => {
      state.timer = null;
      state.last = Date.now();
      bumpTree();
    }, 1500 - elapsed);
  }, [bumpTree]);
  useEffect(
    () => () => {
      const state = bumpTreeThrottleRef.current;
      if (state.timer) clearTimeout(state.timer);
    },
    []
  );

  // ── Session completion notification ────────────────────────────────────────
  useEffect(() => {
    if (prevBusyRef.current && !busy && !errorLine) {
      pushToast("success", t("app.taskComplete") || "Task completed");
    }
    prevBusyRef.current = busy;
  }, [busy, errorLine, pushToast, t]);

  // ── Panel resize handle ──────────────────────────────────────────────────────
  const resizingRef = useRef(false);
  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      resizingRef.current = true;
      const startX = e.clientX;
      const startWidth = panelWidth;
      const onMove = (ev: MouseEvent) => {
        if (!resizingRef.current) return;
        const delta = ev.clientX - startX;
        setPanelWidth(Math.max(200, Math.min(480, startWidth + delta)));
      };
      const onUp = () => {
        resizingRef.current = false;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [panelWidth]
  );

  // VSCode-style activity bar: selecting a rail view swaps the left panel while
  // the main area stays put. Re-selecting the active view toggles the panel.
  const selectView = useCallback(
    (view: "explorer" | "scm" | "tasks" | "tokens" | "index" | "review" | "gitmcp" | "plugins" | "editor") => {
      setSidebarView((prev) => {
        if (prev === view) {
          setPanelOpen((wasOpen) => !wasOpen);
          return view;
        }
        setPanelOpen(true);
        return view;
      });
    },
    []
  );
  const openTokensView = useCallback(() => selectView("tokens"), [selectView]);

  // ── Data loading ────────────────────────────────────────────────────────────
  const refreshSessions = useCallback(async () => {
    setSessions(await api.listSessions());
  }, []);

  const refreshSkills = useCallback(async (sessionId?: string) => {
    setSkills(await api.listSkills(sessionId));
  }, []);

  const refreshSettings = useCallback(async () => {
    setSettings(await api.getSettings());
  }, []);

  const refreshMcp = useCallback(async () => {
    setMcpStatuses(await api.mcpStatus());
  }, []);

  const refreshGit = useCallback(async () => {
    try {
      const [current, list] = await Promise.all([api.gitCurrentBranch(), api.gitListBranches()]);
      setBranch(current);
      setBranches(list);
    } catch {
      // Git may be unavailable in this workspace — keep prior branch state.
    }
  }, []);

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
      // M1: drop all cached A2UI surfaces so the new session starts clean and
      // the global singleton Map doesn't grow unbounded across switches.
      clearA2uiSurfaces();
      // F3: reset prototype panel state so switching sessions doesn't reopen
      // the preview with stale content from the prior session.
      setPrototypeJson(null);
      setPrototypeOpenuiCode("");
      setPrototypeMode("a2ui");
      setPreviewOpen(false);
      setDesignContent(null);
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
    [refreshSkills]
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
        const resolvedTheme = resolveTheme(plat);
        setAppearanceState(resolveAppearance(plat, resolvedTheme));
        setThemeState(resolvedTheme);
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
        // Auto-switch to prototype panel when a render_prototype/render_surface
        // tool result arrives with A2UI payload.
        if (message.role === "tool") {
          const content = message.content || "";
          // Check for DeepDesign (.dd format) tool results via metadata.design.
          if (content.includes("render_design") || content.includes("update_design")) {
            try {
              const parsed = JSON.parse(content);
              const meta = parsed.metadata ?? {};
              if (meta.design) {
                const ddContent = typeof meta.design === "string" ? meta.design : String(meta.design);
                setPrototypeMode("design");
                setDesignContent(ddContent);
                setPreviewOpen(true);
                setPreviewTab("design");
              }
            } catch {
              // Not parseable.
            }
          }
          // Check for OpenUI Lang tool results via metadata.openui.
          if (content.includes("render_openui") || content.includes("update_openui")) {
            try {
              const parsed = JSON.parse(content);
              const meta = parsed.metadata ?? {};
              if (meta.openui) {
                const openuiCode = typeof meta.openui === "string" ? meta.openui : String(meta.openui);
                setPrototypeMode("openui");
                setPrototypeOpenuiCode(openuiCode);
                setPreviewOpen(true);
                setPreviewTab("prototype");
              }
            } catch {
              // Not parseable.
            }
          }
          // Check for A2UI tool results via metadata.a2ui (set by executor).
          else if (
            content.includes("render_prototype") ||
            content.includes("render_surface") ||
            content.includes("update_surface")
          ) {
            try {
              const parsed = JSON.parse(content);
              const meta = parsed.metadata ?? {};
              if (meta.a2ui) {
                const a2uiJson = typeof meta.a2ui === "string" ? meta.a2ui : JSON.stringify(meta.a2ui);
                if (content.includes("render_prototype") || content.includes("render_surface")) {
                  setPrototypeMode("a2ui");
                  setPrototypeJson(a2uiJson);
                  setPreviewOpen(true);
                  setPreviewTab("prototype");
                } else if (content.includes("update_surface")) {
                  setPrototypeMode("a2ui");
                  setPrototypeJson(a2uiJson);
                  setPreviewOpen(true);
                }
              }
            } catch {
              // Not parseable — stay in chat view.
            }
          }
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
        setRunningProcesses(entry.processes ?? []);
        // Clean up stdout buffers for processes that are no longer running.
        // Without this, the Map retains up to 1MB per dead PID for the app lifetime.
        const newPids = new Set((entry.processes ?? []).map((p) => Number(p.pid)));
        for (const pid of processStdoutRef.current.keys()) {
          if (!newPids.has(pid)) {
            processStdoutRef.current.delete(pid);
          }
        }
      }
      bumpTreeThrottled();
    });

    const offProcessStdout = api.onProcessStdout((event) => {
      accumulateStdout(processStdoutRef.current, event.pid, event.chunk);
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
    bumpTree,
    bumpTreeThrottled,
    loadSession,
    pushToast,
    refreshGit,
    refreshMcp,
    refreshSessions,
    refreshSettings,
    refreshSkills,
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
  }, [draft, imageUrls, planMode, runPrompt, selectedSkills, skills]);

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

  const handleSwitchBranch = useCallback(
    async (next: string) => {
      const result = await api.gitCheckout(next);
      if (result.ok) {
        await refreshGit();
        await refreshSessions();
        bumpTree();
      } else if (result.conflict) {
        // Dirty tree: offer stash-and-switch instead of dumping raw git stderr.
        setBranchConflict(next);
        await refreshGit();
      } else {
        setErrorLine(result.error ?? t("app.requestFailed"));
        // Keep the dropdown in sync with the real branch after a failed switch.
        await refreshGit();
      }
    },
    [bumpTree, refreshGit, refreshSessions, t]
  );

  const handleStashAndSwitch = useCallback(async () => {
    const target = branchConflict;
    if (!target || stashSwitching) {
      return;
    }
    setStashSwitching(true);
    try {
      const result = await api.gitStashCheckout(target);
      if (result.ok) {
        setBranchConflict(null);
        if (result.stashWarning) {
          // Checkout succeeded but the stashed changes could not be restored —
          // surface as an error toast so the user recovers via `git stash pop`.
          pushToast("error", result.stashWarning);
        } else {
          pushToast("success", t("scm.stashSwitchDone", { branch: target }));
        }
        await refreshGit();
        await refreshSessions();
        bumpTree();
      } else {
        setBranchConflict(null);
        setErrorLine(result.error ?? t("app.requestFailed"));
        await refreshGit();
      }
    } finally {
      setStashSwitching(false);
    }
  }, [branchConflict, stashSwitching, bumpTree, pushToast, refreshGit, refreshSessions, t]);

  const handleSetModel = useCallback(async (selection: ModelConfigSelection) => {
    setSettings(await api.setModel(selection));
    const id = activeIdRef.current;
    if (id) {
      setMessages(await api.listMessages(id));
    }
  }, []);

  const handleOpenSettings = useCallback(async () => {
    setEditable(await api.getEditableSettings());
    setSettingsInitialTab(undefined);
    setMainView("settings");
  }, []);

  const handleToggleAppearance = useCallback(() => {
    setAppearanceState((prev) => {
      const next: Appearance = prev === "dark" ? "light" : "dark";
      persistAppearance(next);
      return next;
    });
  }, []);

  const handleToggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next: Theme = prev === "glass" ? baseTheme(platform) : "glass";
      persistTheme(next);
      // Auto-switch appearance to match the theme's native tone.
      const tone = defaultAppearance(platform, next);
      setAppearanceState(tone);
      persistAppearance(tone);
      return next;
    });
  }, [platform]);

  // Line theme flavour toggle: original stroke look ↔ punk (2077 tribute).
  const handleToggleLineVariant = useCallback(() => {
    setLineVariantState((prev) => {
      const next: LineVariant = prev === "punk" ? "stroke" : "punk";
      persistLineVariant(next);
      return next;
    });
  }, []);

  // The punk recolor only applies while the Line theme is active.
  useEffect(() => {
    applyLineVariant(theme === "line" ? lineVariant : "stroke");
  }, [theme, lineVariant]);

  // Theme selection from the settings panel (General tab). Applies immediately
  // (swaps the stylesheet link) and persists — no reload needed.
  const handleSelectTheme = useCallback(
    (next: Theme) => {
      setThemeState(next);
      persistTheme(next);
      const tone = defaultAppearance(platform, next);
      setAppearanceState(tone);
      persistAppearance(tone);
    },
    [platform]
  );

  const handleCycleReasoning = useCallback(() => {
    setReasoningModeState((prev) => {
      const next = nextReasoningMode(prev);
      persistReasoningMode(next);
      return next;
    });
  }, []);

  const handleUndoRestored = useCallback(async () => {
    const id = activeIdRef.current;
    if (id) {
      setMessages(await api.listMessages(id));
      const entry = await api.getSession(id);
      setActiveStatus(entry?.status ?? null);
    }
    await refreshSessions();
  }, [refreshSessions]);

  const handleSaveSettings = useCallback(
    async (next: EditableSettings) => {
      const { summary, editable: fresh } = await api.updateSettings(next);
      setSettings(summary);
      setEditable(fresh);
      setMainView("chat");
      await Promise.all([refreshMcp(), refreshSkills(activeIdRef.current ?? undefined)]);
    },
    [refreshMcp, refreshSkills]
  );

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
  const handleToggleSkill = useCallback(
    (name: string) =>
      setSelectedSkills((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name])),
    []
  );
  const handleRemoveImage = useCallback((i: number) => setImageUrls((prev) => prev.filter((_, idx) => idx !== i)), []);
  const handleAddImage = useCallback((dataUrl: string) => setImageUrls((prev) => [...prev, dataUrl]), []);
  const handleResumeClick = useCallback(() => void handleResume(), [handleResume]);
  const handleEnhanceClick = useCallback(() => void handleEnhance(), [handleEnhance]);
  const handleCollapsePanel = useCallback(() => setPanelOpen(false), []);
  const handleBackToChat = useCallback(() => setMainView("chat"), []);
  const handleSelectPlugin = useCallback((sel: PluginSelection) => {
    setSelectedPlugin(sel);
    setMainView("plugins");
  }, []);
  const handleRefreshPluginSkills = useCallback(async () => {
    await api.pluginRefreshSkills(activeId ?? undefined);
    await refreshSkills(activeId ?? undefined);
  }, [activeId, refreshSkills]);

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
      } else if (cmd === "pm-design" || cmd === "prototype") {
        // PM-Design: trigger prototype creation mode via agent prompt
        void runPrompt({
          text: "Create an interactive prototype using the A2UI render_prototype tool. Ask me what to build first.",
        });
      } else if (cmd === "pm-design-openui" || cmd === "openui") {
        // PM-Design (OpenUI Lang mode): use the compact OpenUI Lang syntax
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
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === "o" || e.key === "O")) {
        e.preventDefault();
        setShowProcessPanel((v) => !v);
      }
      // ⌘B / Ctrl+B — toggle sidebar panel
      if ((e.metaKey || e.ctrlKey) && (e.key === "b" || e.key === "B")) {
        e.preventDefault();
        setPanelOpen((v) => !v);
      }
      // ⌘J / Ctrl+J — toggle bottom process panel
      if ((e.metaKey || e.ctrlKey) && (e.key === "j" || e.key === "J")) {
        e.preventDefault();
        setShowProcessPanel((v) => !v);
      }
      // ⌘N / Ctrl+N — new session
      if ((e.metaKey || e.ctrlKey) && (e.key === "n" || e.key === "N")) {
        e.preventDefault();
        handleNewSession();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        void handleOpenSettings();
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "?" || e.key === "/")) {
        e.preventDefault();
        setModal((v) => (v === "shortcuts" ? null : "shortcuts"));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleOpenSettings, handleNewSession]);

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
    [handleCycleReasoning, handleNewSession, handleOpenSettings, openTokensView, pushToast, runPrompt, selectView, t]
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

  // Auto-show process panel when processes start running.
  useEffect(() => {
    if (runningProcesses.length > 0 && busy) {
      setShowProcessPanel(true);
    }
  }, [runningProcesses, busy]);

  // Reflect session state in the window title so the user can see progress
  // even when the app is in the background (taskbar / dock tooltip).
  useEffect(() => {
    const base = "DeepOrca";
    if (busy) {
      document.title = `⚡ ${base}`;
    } else if (activeStatus === "ask_permission" || activeStatus === "waiting_for_user") {
      document.title = `⚠️ ${base}`;
    } else if (activeStatus === "error") {
      document.title = `✖ ${base}`;
    } else {
      document.title = base;
    }
  }, [busy, activeStatus]);

  // Keep the conversation's bottom padding in sync with the floating
  // composer-dock's actual height so the last message can never sit
  // underneath the input. We measure the dock and write a CSS variable
  // consumed by .ui-conversation's padding-bottom. The +12px gap is a
  // small breathing buffer so the last line doesn't kiss the composer.
  const composerDockRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = composerDockRef.current;
    if (!el) return;
    const apply = () => {
      const h = el.offsetHeight;
      document.documentElement.style.setProperty("--ui-composer-reserved", `${h + 12}px`);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => {
      ro.disconnect();
      document.documentElement.style.removeProperty("--ui-composer-reserved");
    };
  }, [mainView]);

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
            <CodeReviewPanel onShowGraph={setGraphHtml} />
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
            <button
              className="ui-preview-close"
              onClick={() => {
                setPreviewOpen(false);
                setPrototypeJson(null);
                setPrototypeOpenuiCode("");
                setDesignContent(null);
              }}
              title="Close preview"
            >
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
