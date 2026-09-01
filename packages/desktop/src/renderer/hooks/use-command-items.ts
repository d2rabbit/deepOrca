import { useMemo } from "react";
import { api } from "../api";
import type { CommandItem } from "../ui/index";
import type { SidebarView } from "./use-panel-layout";
import type { Theme } from "../lib/appearance";
import type { useI18n } from "../i18n";
import type { useToasts } from "../components/Toast";
import type { MainTab } from "../App";

/**
 * ⌘K command palette items — extracted verbatim from App.tsx (file-length
 * hard limit: App() had grown past 2500 lines; the palette item list is a
 * self-contained, purely declarative feature). The hook owns the MEMO only;
 * every behavior stays wired in App — setters arrive as one-way callbacks and
 * handlers keep their App-side identities, so memoization behavior is
 * unchanged.
 */
export interface CommandItemsDeps {
  t: ReturnType<typeof useI18n>["t"];
  modKey: string;
  projectRoot: string;
  activeIdRef: { current: string | null };
  pushToast: ReturnType<typeof useToasts>["push"];
  runPrompt: (opts: { text: string }) => void;
  selectView: (view: SidebarView) => void;
  handleNewSession: () => void;
  handleOpenSettings: () => void;
  handleStop: () => void;
  handleToggleHub: () => void;
  handleCycleReasoning: () => void;
  handleToggleAppearance: () => void;
  handleToggleLineVariant: () => void;
  handleSelectTheme: (theme: Theme) => void;
  openTokensView: () => void;
  setPlanMode: (updater: (prev: boolean) => boolean) => void;
  setModal: (modal: "undo" | "shortcuts") => void;
  setShowProcessPanel: (updater: (prev: boolean) => boolean) => void;
  setActiveTab: (tab: MainTab) => void;
}

export function useCommandItems({
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
}: CommandItemsDeps): CommandItem[] {
  return useMemo<CommandItem[]>(
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
        run: handleToggleHub,
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
        id: "view.taskhub",
        label: t("rail.taskhub"),
        keywords: "sidebar view task tree hub history",
        run: () => selectView("taskhub"),
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
      // ── Flow bridges: main-area surfaces ──
      {
        id: "knowledge.center",
        label: t("command.knowledge.label"),
        keywords: "knowledge center wiki archmap symbols 架构 图谱",
        run: () => {
          // Silent no-op would read as a broken command — say why instead.
          if (projectRoot) setActiveTab({ kind: "knowledge", root: projectRoot });
          else pushToast("info", t("topbar.pickFolderHint"));
        },
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
      activeIdRef,
      handleCycleReasoning,
      handleNewSession,
      handleOpenSettings,
      handleSelectTheme,
      handleStop,
      handleToggleAppearance,
      handleToggleHub,
      handleToggleLineVariant,
      modKey,
      openTokensView,
      projectRoot,
      pushToast,
      runPrompt,
      selectView,
      setModal,
      setPlanMode,
      setShowProcessPanel,
      setActiveTab,
      t,
    ]
  );
}
