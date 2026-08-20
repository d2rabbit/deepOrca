// ⌘K command layer: true fuzzy scoring over the full command registry, with
// results grouped 工单/视图/主题/动作 (E5.4). A leading "›" (>) locks the
// query to module navigation. ↑/↓ move, ↵ runs (and closes the layer); Esc
// is handled by the overlay stack.
import { Fragment, useMemo, useState, type JSX, type KeyboardEvent } from "react";
import { useI18n, type MessageKey } from "../../i18n";
import { rankFuzzy } from "../lib/fuzzy";
import {
  buildCommandRegistry,
  type CommandGroup,
  type DeckCommand,
  type DeckCommandContext,
} from "../lib/command-registry";

const MODULE_LOCK_PREFIX = ">";

const GROUP_LABEL: Record<CommandGroup, MessageKey> = {
  goals: "deck.cmd.group.goals",
  views: "deck.cmd.group.views",
  themes: "deck.cmd.group.themes",
  actions: "deck.cmd.group.actions",
};

export function CommandLayer(props: { ctx: DeckCommandContext; onRun(): void; depth?: number }): JSX.Element {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const registry = useMemo(() => buildCommandRegistry(props.ctx, t), [props.ctx, t]);
  const ctx = props.ctx;

  const locked = query.startsWith(MODULE_LOCK_PREFIX);
  const raw = locked ? query.slice(MODULE_LOCK_PREFIX.length).trim() : query.trim();
  const pool = locked ? registry.filter((cmd) => cmd.domain === "module") : registry;

  const results = useMemo(() => rankFuzzy(raw, pool, (cmd) => `${cmd.label} ${cmd.keywords ?? ""}`), [raw, pool]);

  const clamp = (next: number) => Math.min(Math.max(next, 0), Math.max(results.length - 1, 0));

  const run = (cmd: DeckCommand) => {
    cmd.run(ctx);
    props.onRun();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndex((i) => clamp(i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndex((i) => clamp(i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const cmd = results[index];
      if (cmd) run(cmd.item);
    }
  };

  let lastGroup: CommandGroup | null = null;

  return (
    <div className="deck-overlay-scrim cmd" style={{ zIndex: 40 + (props.depth ?? 0) * 10 }} data-layer="command">
      <div className="deck-cmd deck-gc" role="dialog" aria-label={t("deck.cmd.title")}>
        <input
          className="deck-cmd-input"
          autoFocus
          value={query}
          placeholder={t("deck.cmd.placeholder")}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={onKeyDown}
        />
        <div className="deck-cmd-list">
          {results.length === 0 ? <div className="deck-empty">{t("deck.cmd.empty")}</div> : null}
          {results.map((entry, i) => {
            const header =
              entry.item.group !== lastGroup ? (
                <div className="deck-cmd-group">{t(GROUP_LABEL[entry.item.group])}</div>
              ) : null;
            lastGroup = entry.item.group;
            return (
              <Fragment key={entry.item.id}>
                {header}
                <button
                  type="button"
                  className={`deck-cmd-row${i === index ? " active" : ""}`}
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => run(entry.item)}
                >
                  <span className="deck-cmd-label">{entry.item.label}</span>
                  <span className="deck-cmd-meta">{entry.item.domain === "theme" ? t("deck.settings.theme") : ""}</span>
                  {entry.item.shortcut ? <span className="deck-kbd">{entry.item.shortcut}</span> : null}
                </button>
              </Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}
