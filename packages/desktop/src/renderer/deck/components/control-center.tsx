// Control center (⌘⇧O): observation + command — the meters four-grid
// (duration / cost / context / tokens), the directive input (下达指令), the
// user's command log (指令留痕), and the engine status-observation stream.
//
// E13 deep integration: the directive input is wired into the real engine
// features — @ file mentions (api.scanFiles, same as the classic composer),
// prompt enhance (api.enhancePrompt), and a Plan-mode chip carried by the
// next sendPrompt. Read-only observation in E2; there is no unit-price
// source in the engine, so the cost meter honestly shows "—".
import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import type { FileMatch, SerializableSessionEntry, SkillInfo } from "../../../shared/ipc";
import { api } from "../../api";
import { compactTokenThreshold, formatTokens } from "../../lib/token-usage";
import { useI18n } from "../../i18n";
import { ModelCapsule } from "./model-capsule";
import { useDeckSettings } from "../hooks/use-deck-settings";
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

function Meter(props: {
  label: string;
  value: string;
  onClick?: () => void;
  title?: string;
  /** Water-level tone (E17): context usage vs the compaction threshold. */
  tone?: "warn" | "bad";
}): JSX.Element {
  const cls = `deck-meter${props.tone ? ` ${props.tone}` : ""}`;
  if (props.onClick) {
    return (
      <button type="button" className={`${cls} linked`} onClick={props.onClick} title={props.title}>
        <div className="k">{props.label}</div>
        <div className="v">{props.value}</div>
      </button>
    );
  }
  return (
    <div className={cls}>
      <div className="k">{props.label}</div>
      <div className="v">{props.value}</div>
    </div>
  );
}

/** Detect a / or @ token at or before the cursor (ported from the classic Composer). */
function tokenAt(text: string, cursor: number): { token: string; start: number } | null {
  let start = cursor;
  while (start > 0 && !/\s/.test(text[start - 1] ?? "")) {
    start -= 1;
  }
  const token = text.slice(start, cursor);
  return token.startsWith("@") || token.startsWith("/") ? { token, start } : null;
}

/** 下达指令输入框：/ 技能 + @ 文件引用 + ✨ 提示词增强 + Plan 芯片 + 发送。 */
function DirectiveInput(props: {
  busy: boolean;
  targetStep?: string | null;
  planMode: boolean;
  onTogglePlanMode(): void;
  onSend(text: string, opts?: { skills?: SkillInfo[] }): void;
}): JSX.Element {
  const { t } = useI18n();
  const [draft, setDraft] = useState("");
  const [cursor, setCursor] = useState(0);
  const [matches, setMatches] = useState<FileMatch[]>([]);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [enhancing, setEnhancing] = useState(false);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [picked, setPicked] = useState<SkillInfo[]>([]);
  const [skillIndex, setSkillIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const scanSeq = useRef(0);

  const token = useMemo(() => tokenAt(draft, cursor), [draft, cursor]);
  const atToken = token?.token.startsWith("@") ? token : null;
  const slashToken = token?.token.startsWith("/") ? token : null;
  const mentionOpen = atToken !== null;

  // Skills load once per mount; the slash menu filters client-side.
  useEffect(() => {
    void api
      .listSkills()
      .then((list) => setSkills(Array.isArray(list) ? list : []))
      .catch(() => setSkills([]));
  }, []);

  const skillMatches = useMemo(() => {
    if (!slashToken) return [];
    const query = slashToken.token.slice(1).toLowerCase();
    const pool = skills.filter((s) => !s.pluginOwned);
    if (!query) return pool.slice(0, 8);
    return pool
      .filter((s) => s.name.toLowerCase().includes(query) || s.description.toLowerCase().includes(query))
      .slice(0, 8);
  }, [slashToken, skills]);
  const skillOpen = slashToken !== null && skillMatches.length > 0;

  useEffect(() => setSkillIndex(0), [slashToken?.token]);

  // Latest-request-wins scan so stale results can't overwrite newer ones.
  useEffect(() => {
    if (!atToken) {
      setMatches([]);
      return;
    }
    const seq = ++scanSeq.current;
    const query = atToken.token.slice(1);
    void api
      .scanFiles(query)
      .then((results) => {
        if (seq === scanSeq.current) {
          setMatches(Array.isArray(results) ? results.slice(0, 8) : []);
          setMentionIndex(0);
        }
      })
      .catch(() => {
        if (seq === scanSeq.current) setMatches([]);
      });
  }, [atToken]);

  const replaceToken = (insertion: string) => {
    if (!token) return;
    const before = draft.slice(0, token.start);
    const after = draft.slice(cursor);
    const next = `${before}${insertion}${after ? ` ${after}` : ""}`;
    setDraft(next);
    const pos = (before + insertion).length + (after ? 1 : 0);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(pos, pos);
      setCursor(pos);
    });
  };

  const applyMention = (item: FileMatch) => {
    replaceToken(`@${item.type === "directory" ? `${item.path}/` : item.path}`);
    setMatches([]);
  };

  const applySkill = (skill: SkillInfo) => {
    setPicked((prev) => (prev.some((s) => s.name === skill.name) ? prev : [...prev, skill]));
    replaceToken(""); // 吃掉 /token，技能落到 chips
  };

  const send = () => {
    const text = draft.trim();
    if ((!text && picked.length === 0) || props.busy) return;
    setDraft("");
    setMatches([]);
    props.onSend(props.targetStep && text ? `[针对步骤「${props.targetStep}」] ${text}` : text, {
      skills: picked,
    });
    setPicked([]);
  };

  const enhance = () => {
    const text = draft.trim();
    if (!text || enhancing || props.busy) return;
    setEnhancing(true);
    void api
      .enhancePrompt(text)
      .then((result) => {
        if (result.ok && result.text) setDraft(result.text);
      })
      .finally(() => setEnhancing(false));
  };

  return (
    <div className="deck-cc-directive">
      {picked.length > 0 ? (
        <div className="deck-cc-skillchips">
          {picked.map((skill) => (
            <span key={skill.name} className="deck-cc-skillchip">
              /{skill.name}
              <button
                type="button"
                aria-label="Remove skill"
                onClick={() => setPicked((prev) => prev.filter((s) => s.name !== skill.name))}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      ) : null}
      {mentionOpen && matches.length > 0 ? (
        <div className="deck-cc-mentions deck-gc" role="listbox">
          {matches.map((item, i) => (
            <button
              key={item.path}
              type="button"
              role="option"
              aria-selected={i === mentionIndex}
              className={`deck-cc-mention${i === mentionIndex ? " active" : ""}`}
              onMouseEnter={() => setMentionIndex(i)}
              onClick={() => applyMention(item)}
            >
              <span className="deck-row-main">{item.path}</span>
              <span className="deck-row-meta">{item.type === "directory" ? "dir" : "file"}</span>
            </button>
          ))}
        </div>
      ) : null}
      {skillOpen ? (
        <div className="deck-cc-mentions deck-gc" role="listbox">
          {skillMatches.map((skill, i) => (
            <button
              key={skill.name}
              type="button"
              role="option"
              aria-selected={i === skillIndex}
              className={`deck-cc-mention${i === skillIndex ? " active" : ""}`}
              onMouseEnter={() => setSkillIndex(i)}
              onClick={() => applySkill(skill)}
            >
              <span className="deck-row-main">
                /{skill.name}
                <span className="deck-row-sub">{skill.description}</span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
      <div className="deck-cc-input">
        <span className="deck-cc-target" title={props.targetStep ?? t("deck.cc.targetGoal")}>
          {props.targetStep ?? t("deck.cc.targetGoal")}
        </span>
        <input
          ref={inputRef}
          value={draft}
          placeholder={t("deck.cc.directivePlaceholder")}
          disabled={props.busy}
          onChange={(e) => {
            setDraft(e.target.value);
            setCursor(e.target.selectionStart ?? e.target.value.length);
          }}
          onKeyUp={(e) => setCursor(e.currentTarget.selectionStart ?? 0)}
          onClick={(e) => setCursor(e.currentTarget.selectionStart ?? 0)}
          onKeyDown={(e) => {
            if (mentionOpen && matches.length > 0) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setMentionIndex((i) => Math.min(i + 1, matches.length - 1));
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setMentionIndex((i) => Math.max(i - 1, 0));
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                applyMention(matches[mentionIndex] ?? matches[0]!);
                return;
              }
              if (e.key === "Escape") {
                e.stopPropagation();
                setMatches([]);
                return;
              }
            }
            if (skillOpen) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSkillIndex((i) => Math.min(i + 1, skillMatches.length - 1));
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setSkillIndex((i) => Math.max(i - 1, 0));
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                applySkill(skillMatches[skillIndex] ?? skillMatches[0]!);
                return;
              }
              if (e.key === "Escape") {
                e.stopPropagation();
                replaceToken("");
                return;
              }
            }
            if (e.key === "Enter") {
              e.preventDefault();
              send();
            }
          }}
        />
        <button
          type="button"
          className={`deck-cc-plan${props.planMode ? " active" : ""}`}
          title={t("deck.cc.planHint")}
          onClick={props.onTogglePlanMode}
        >
          Plan
        </button>
        <button
          type="button"
          className="deck-cc-enhance"
          title={t("deck.cc.enhanceHint")}
          disabled={props.busy || enhancing || !draft.trim()}
          onClick={enhance}
        >
          {enhancing ? "…" : "✨"}
        </button>
        <button
          type="button"
          className="deck-cc-send"
          disabled={props.busy || (!draft.trim() && picked.length === 0)}
          onClick={send}
          aria-label={t("deck.cc.directive")}
        >
          ➤
        </button>
      </div>
    </div>
  );
}

export function ControlCenter(props: {
  entry: SerializableSessionEntry | null;
  busy: boolean;
  commandLog: Array<{ ts: string; text: string }>;
  events: DeckEvent[];
  /** 下达指令: send an intervention/command to the engine (same channel the
   *  classic composer uses — skills picked via "/" ride along). */
  onSend?: (text: string, opts?: { skills?: SkillInfo[] }) => void;
  /** The current work step, shown as the directive target chip. */
  targetStep?: string | null;
  /** Context meter click → the context breakdown focus card (设计稿 ctx). */
  onShowContext?: () => void;
  /** Plan mode for the next send (E13) — synced from the session entry. */
  planMode?: boolean;
  onTogglePlanMode?: () => void;
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

  // E17 water-level tone: context vs the compaction threshold (user override
  // honored — same contract as the context focus card). ≥85% warns, ≥95%
  // turns red; the count alone never told you how close compaction is.
  const { settings } = useDeckSettings();
  const tone = useMemo<"warn" | "bad" | undefined>(() => {
    if (!entry || !entry.activeTokens) return undefined;
    const heaviestModel = entry.usagePerModel
      ? Object.entries(entry.usagePerModel).sort(
          ([, a], [, b]) => (b?.total_tokens ?? 0) - (a?.total_tokens ?? 0)
        )[0]?.[0]
      : undefined;
    const threshold = compactTokenThreshold(heaviestModel ?? "", settings?.compactTokenThreshold);
    if (!threshold) return undefined;
    const pct = entry.activeTokens / threshold;
    return pct >= 0.95 ? "bad" : pct >= 0.85 ? "warn" : undefined;
  }, [entry, settings]);

  const commands = [...props.commandLog].reverse().slice(0, 20);
  const events = [...props.events].reverse().slice(0, 30);

  return (
    <div className="deck-cc">
      <div className="deck-cc-meters">
        <Meter label={t("deck.cc.duration")} value={duration} />
        <Meter label={t("deck.cc.cost")} value="—" />
        <Meter
          label={t("deck.cc.context")}
          value={context}
          onClick={props.onShowContext}
          title={t("deck.context.title")}
          tone={tone}
        />
        <Meter label={t("deck.cc.tokens")} value={tokens} />
      </div>

      {/* E15: model & thinking hot-swap — same channels as the classic top bar. */}
      <ModelCapsule busy={props.busy} />

      {props.onSend ? (
        <div className="deck-cc-sec">
          <div className="deck-cc-title">{t("deck.cc.directive")}</div>
          <DirectiveInput
            busy={props.busy}
            targetStep={props.targetStep}
            planMode={props.planMode ?? false}
            onTogglePlanMode={props.onTogglePlanMode ?? (() => {})}
            onSend={props.onSend}
          />
        </div>
      ) : null}

      <div className="deck-cc-sec">
        <div className="deck-cc-title">{t("deck.cc.commands")}</div>
        <div className="deck-cc-list">
          {commands.length === 0 ? <div className="deck-empty">{t("deck.cc.commandsEmpty")}</div> : null}
          {commands.map((cmd, i) => (
            <div key={i} className="deck-cc-ev cmd">
              <span className="ts">{cmd.ts.slice(11, 19)}</span>
              <span>{cmd.text}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="deck-cc-sec">
        <div className="deck-cc-title">{t("deck.cc.events")}</div>
        <div className="deck-cc-list">
          {events.length === 0 ? <div className="deck-empty">{t("deck.cc.eventsEmpty")}</div> : null}
          {events.map((ev, i) => (
            <div key={i} className="deck-cc-ev">
              <span className="ts">{ev.ts.slice(11, 19)}</span>
              <span>{ev.text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
