// Control center (⌘⇧O): observation + command — the meters four-grid
// (duration / cost / context / tokens), the user's command log (指令留痕),
// and the engine status-observation stream. Read-only observation in E2;
// there is no unit-price source in the engine, so the cost meter honestly
// shows "—" rather than inventing a number.
import { useEffect, useState, type JSX } from "react";
import type { SerializableSessionEntry } from "../../../shared/ipc";
import { formatTokens } from "../../lib/token-usage";
import { useI18n } from "../../i18n";
import type { DeckEvent } from "../types";

function formatDuration(ms: number): string {
  if (ms < 0) return "0:00";
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min >= 60) {
    return `${Math.floor(min / 60)}h ${min % 60}m`;
  }
  return `${min}:${String(sec).padStart(2, "0")}`;
}

function Meter(props: { label: string; value: string }): JSX.Element {
  return (
    <div className="deck-meter">
      <div className="k">{props.label}</div>
      <div className="v">{props.value}</div>
    </div>
  );
}

export function ControlCenter(props: {
  entry: SerializableSessionEntry | null;
  busy: boolean;
  commandLog: Array<{ ts: string; text: string }>;
  events: DeckEvent[];
}): JSX.Element {
  const { t } = useI18n();
  const [, setTick] = useState(0);

  // Duration meter ticks while the engine is running.
  useEffect(() => {
    if (!props.busy) return;
    const timer = setInterval(() => setTick((v) => v + 1), 1000);
    return () => clearInterval(timer);
  }, [props.busy]);

  const entry = props.entry;
  const start = entry ? Date.parse(entry.createTime) : 0;
  const end = entry ? (props.busy ? Date.now() : Date.parse(entry.updateTime)) : 0;
  const duration = entry ? formatDuration(end - start) : "—";
  const tokens = entry?.usage ? formatTokens(entry.usage.total_tokens) : "—";
  const context = entry ? formatTokens(entry.activeTokens) : "—";

  const commands = [...props.commandLog].reverse().slice(0, 20);
  const events = [...props.events].reverse().slice(0, 30);

  return (
    <div className="deck-cc">
      <div className="deck-cc-meters">
        <Meter label={t("deck.cc.duration")} value={duration} />
        <Meter label={t("deck.cc.cost")} value="—" />
        <Meter label={t("deck.cc.context")} value={context} />
        <Meter label={t("deck.cc.tokens")} value={tokens} />
      </div>

      <div className="deck-cc-sec">
        <div className="deck-cc-title">{t("deck.cc.commands")}</div>
        {commands.length === 0 ? <div className="deck-empty">{t("deck.cc.commandsEmpty")}</div> : null}
        {commands.map((cmd, i) => (
          <div key={i} className="deck-cc-ev cmd">
            <span className="ts">{cmd.ts.slice(11, 19)}</span>
            <span>{cmd.text}</span>
          </div>
        ))}
      </div>

      <div className="deck-cc-sec">
        <div className="deck-cc-title">{t("deck.cc.events")}</div>
        {events.length === 0 ? <div className="deck-empty">{t("deck.cc.eventsEmpty")}</div> : null}
        {events.map((ev, i) => (
          <div key={i} className="deck-cc-ev">
            <span className="ts">{ev.ts.slice(11, 19)}</span>
            <span>{ev.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
