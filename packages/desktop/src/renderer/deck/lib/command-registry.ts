// The ⌘K command registry (E3): every command surface the Deck exposes —
// module overlays (generated from the dock list so the two can never drift),
// theme switches, and layout/engine actions. The shortcuts panel reads the
// same registry, satisfying the coverage requirement "快捷键表与命令层同源".

import type { MessageKey } from "../../i18n";
import { switchLayout } from "../../lib/layout";
import { DECK_THEMES, type DeckTheme } from "./appearance";
import type { LayerKind } from "./overlay-stack";
import { DOCK } from "../components/dock";

export type CommandDomain = "module" | "theme" | "action";

export type DeckCommandContext = {
  openLayer(kind: LayerKind): void;
  setTheme(theme: DeckTheme): void;
  /** Interrupt the running engine loop (only meaningful while busy). */
  interrupt(): void;
  busy: boolean;
};

export type DeckCommand = {
  id: string;
  labelKey: MessageKey;
  /** ASCII keywords so latin queries can match localized (CJK) labels. */
  keywords?: string;
  shortcut?: string;
  domain: CommandDomain;
  run(ctx: DeckCommandContext): void;
};

/** Module commands are derived from the dock list — one source of truth. */
function moduleCommands(): DeckCommand[] {
  const commands: DeckCommand[] = [];
  for (const item of DOCK) {
    if (item === "div") continue;
    if (item.overlay === "floor" && item.labelKey === "deck.dock.newGoal") continue; // surfaced as the action below
    commands.push({
      id: `open.${item.overlay}`,
      labelKey: item.labelKey,
      keywords: item.overlay,
      shortcut: item.shortcut,
      domain: "module",
      run: (ctx) => ctx.openLayer(item.overlay),
    });
  }
  return commands;
}

function themeCommands(): DeckCommand[] {
  return DECK_THEMES.map((theme): DeckCommand => {
    const labelKey = `deck.theme.name.${theme}` as MessageKey;
    return {
      id: `theme.${theme}`,
      labelKey,
      keywords: `theme ${theme}`,
      domain: "theme",
      run: (ctx) => ctx.setTheme(theme),
    };
  });
}

function actionCommands(): DeckCommand[] {
  return [
    {
      id: "goal.new",
      labelKey: "deck.dock.newGoal",
      keywords: "new goal session work order",
      shortcut: "⌘N",
      domain: "action",
      run: (ctx) => ctx.openLayer("floor"),
    },
    {
      id: "engine.interrupt",
      labelKey: "deck.cmd.interrupt",
      keywords: "interrupt stop cancel",
      domain: "action",
      run: (ctx) => ctx.interrupt(),
    },
    {
      id: "layout.classic",
      labelKey: "deck.backToClassic",
      keywords: "classic layout switch back",
      domain: "action",
      run: () => switchLayout("classic"),
    },
  ];
}

export function buildCommandRegistry(): DeckCommand[] {
  return [...moduleCommands(), ...themeCommands(), ...actionCommands()];
}
