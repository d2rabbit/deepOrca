// The ⌘K command registry (E3 + E5.4): every command surface the Deck
// exposes — module overlays (generated from the dock list so the two can
// never drift), the workspace's sessions (searchable by title, Enter to
// switch work orders), theme switches, and layout/engine actions. The
// shortcuts panel reads the same registry, satisfying the coverage
// requirement "快捷键表与命令层同源".

import type { MessageKey } from "../../i18n";
import type { SerializableSessionEntry } from "../../../shared/ipc";
import { switchLayout } from "../../lib/layout";
import { DECK_THEMES, type DeckTheme } from "./appearance";
import type { LayerKind } from "./overlay-stack";
import { MODULE_TAB_KINDS, type ModuleTabKind } from "../types";
import { DOCK } from "../components/dock";

export type CommandDomain = "module" | "theme" | "action";
/** Result grouping in the palette (E5.4, mirrors the design demo). */
export type CommandGroup = "goals" | "views" | "themes" | "actions";

export type DeckCommandContext = {
  openLayer(kind: LayerKind): void;
  /** Load a module's full-body view into a stage tab (E8). */
  openModuleTab?(kind: ModuleTabKind): void;
  setTheme(theme: DeckTheme): void;
  /** Interrupt the running engine loop (only meaningful while busy). */
  interrupt(): void;
  /** Switch the active work order (session). */
  selectSession(id: string): void;
  /** Toggle zen focus mode (⌘.) — ribbon/dock/control center hide away. */
  toggleZen?(): void;
  /** Sessions of the current workspace — the searchable work-order list. */
  sessions: SerializableSessionEntry[];
  busy: boolean;
};

export type DeckCommand = {
  id: string;
  /** Rendered label — dynamic so session titles can join the registry. */
  label: string;
  /** ASCII keywords so latin queries can match localized (CJK) labels. */
  keywords?: string;
  shortcut?: string;
  domain: CommandDomain;
  group: CommandGroup;
  run(ctx: DeckCommandContext): void;
};

/** Module commands are derived from the dock list — one source of truth. */
function moduleCommands(t: (key: MessageKey) => string): DeckCommand[] {
  const commands: DeckCommand[] = [];
  for (const item of DOCK) {
    if (item === "div") continue;
    if (item.labelKey === "deck.dock.newGoal") continue; // surfaced as the action below
    commands.push({
      id: `open.${item.overlay}`,
      label: t(item.labelKey),
      keywords: item.overlay,
      shortcut: item.shortcut,
      domain: "module",
      group: "views",
      run: (ctx) => ctx.openLayer(item.overlay),
    });
  }
  return commands;
}

/** Stage-tab commands for modules with a full-body view (E8). */
function tabCommands(t: (key: MessageKey) => string): DeckCommand[] {
  const commands: DeckCommand[] = [];
  for (const item of DOCK) {
    if (item === "div") continue;
    if (!MODULE_TAB_KINDS.has(item.overlay as ModuleTabKind)) continue;
    commands.push({
      id: `tab.${item.overlay}`,
      label: `${t(item.labelKey)} · ${t("deck.tab.open")}`,
      keywords: `${item.overlay} tab full`,
      domain: "module",
      group: "views",
      run: (ctx) => ctx.openModuleTab?.(item.overlay as ModuleTabKind),
    });
  }
  return commands;
}

/** The workspace's work orders, searchable by title (E5.4). */ function goalCommands(
  ctx: DeckCommandContext
): DeckCommand[] {
  return ctx.sessions.slice(0, 30).map((session): DeckCommand => {
    const title = session.summary ?? session.id.slice(0, 8);
    return {
      id: `goal.${session.id}`,
      label: title,
      keywords: `goal work order session ${session.id}`,
      domain: "module",
      group: "goals",
      run: (c) => c.selectSession(session.id),
    };
  });
}

function themeCommands(t: (key: MessageKey) => string): DeckCommand[] {
  return DECK_THEMES.map((theme): DeckCommand => {
    const labelKey = `deck.theme.name.${theme}` as MessageKey;
    return {
      id: `theme.${theme}`,
      // 带「主题」前缀——命令层里搜“主题/theme”能命中全部六套（E12 修：
      // 裸主题名只能被精确名称搜到）。
      label: `${t("deck.settings.theme")} · ${t(labelKey)}`,
      keywords: `theme ${theme}`,
      domain: "theme",
      group: "themes",
      run: (ctx) => ctx.setTheme(theme),
    };
  });
}

function actionCommands(t: (key: MessageKey) => string): DeckCommand[] {
  return [
    {
      id: "goal.new",
      label: t("deck.dock.newGoal"),
      keywords: "new goal session work order draft",
      shortcut: "⌘N",
      domain: "action",
      group: "actions",
      run: (ctx) => ctx.openLayer("draft"),
    },
    {
      id: "engine.interrupt",
      label: t("deck.cmd.interrupt"),
      keywords: "interrupt stop cancel",
      domain: "action",
      group: "actions",
      run: (ctx) => ctx.interrupt(),
    },
    {
      id: "layout.classic",
      label: t("deck.backToClassic"),
      keywords: "classic layout switch back",
      domain: "action",
      group: "actions",
      run: () => switchLayout("classic"),
    },
    {
      id: "layout.zen",
      label: t("deck.cmd.zen"),
      keywords: "zen focus mode hide chrome",
      shortcut: "⌘.",
      domain: "action",
      group: "actions",
      run: (ctx) => ctx.toggleZen?.(),
    },
  ];
}

export function buildCommandRegistry(ctx: DeckCommandContext, t: (key: MessageKey) => string): DeckCommand[] {
  return [...goalCommands(ctx), ...moduleCommands(t), ...tabCommands(t), ...themeCommands(t), ...actionCommands(t)];
}
