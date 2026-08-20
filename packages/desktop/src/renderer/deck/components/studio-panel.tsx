// Studio 样板（E9）— action 目录工作台：除 agent 会话外的核心能力已全部
// 注册为 defineAction（review/index/design/tasks/browser/work/system），本
// 面板把注册表原样浮出水面——分类分组、搜索、按 JSON schema 自动生成参数
// 表单、运行 + 统一进度流、结构化结果、本次会话运行历史。与 LLM 工具面/
// IPC/MCP 同源（ActionRegistry 单实例），零新增后端通道。
import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import { api } from "../../api";
import type { ActionListItem } from "../../../shared/ipc";
import { useI18n, type MessageKey } from "../../i18n";

/** The ActionList channel returns full ActionDefinitions — the shared type is
 *  narrower, so widen locally (no IPC contract change). */
type SchemaProp = { type?: string; enum?: unknown[]; description?: string; default?: unknown };
type StudioActionDef = ActionListItem & {
  parameters?: { type?: string; properties?: Record<string, SchemaProp>; required?: string[] };
  sideEffects?: string[];
};

type StudioRun = {
  id: number;
  at: string;
  actionId: string;
  ok: boolean;
  code?: string;
  error?: string;
  output?: unknown;
};

const CATEGORY_ORDER = ["review", "index", "design", "tasks", "browser", "work", "system"];
const CATEGORY_KEY: Record<string, MessageKey> = {
  review: "deck.studio.cat.review",
  index: "deck.studio.cat.index",
  design: "deck.studio.cat.design",
  tasks: "deck.studio.cat.tasks",
  browser: "deck.studio.cat.browser",
  work: "deck.studio.cat.work",
  system: "deck.studio.cat.system",
};

function outputText(output: unknown): string {
  if (output == null) return "—";
  if (typeof output === "string") return output;
  const comments = (output as { comments?: Array<{ path?: string; startLine?: number; content?: string }> }).comments;
  if (Array.isArray(comments) && comments.length > 0) {
    return comments.map((c) => `${c.path ?? "?"}:${c.startLine ?? 0} — ${c.content ?? ""}`).join("\n");
  }
  try {
    return JSON.stringify(output, null, 2);
  } catch {
    return String(output);
  }
}

/** Assemble the run input from raw form strings; empty optional fields drop out. */
export function assembleInput(def: StudioActionDef, raw: Record<string, string | boolean>): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  const props = def.parameters?.properties ?? {};
  for (const [name, prop] of Object.entries(props)) {
    const value = raw[name];
    if (prop.type === "boolean") {
      if (value !== undefined) input[name] = value === true;
      continue;
    }
    if (typeof value !== "string" || value.trim() === "") continue;
    input[name] = prop.type === "number" || prop.type === "integer" ? Number(value) : value;
  }
  return input;
}

export function StudioPanel(props: { full?: boolean }): JSX.Element {
  const { t } = useI18n();
  const [defs, setDefs] = useState<StudioActionDef[] | null>(null);
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [raw, setRaw] = useState<Record<string, Record<string, string | boolean>>>({});
  const [running, setRunning] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [runs, setRuns] = useState<StudioRun[]>([]);
  const [viewing, setViewing] = useState<number | null>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    void api
      .actionList()
      .then((list) => setDefs(list as StudioActionDef[]))
      .catch(() => setDefs([]));
  }, []);

  useEffect(() => {
    if (!running) {
      setProgress(null);
      return;
    }
    return api.onActionProgress((evt) => {
      if (evt.actionId === running) {
        setProgress(evt.percent != null ? `${evt.percent}% — ${evt.message}` : evt.message);
      }
    });
  }, [running]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = (defs ?? []).filter(
      (d) => !q || d.id.toLowerCase().includes(q) || d.description.toLowerCase().includes(q)
    );
    const byCat = new Map<string, StudioActionDef[]>();
    for (const def of matched) {
      const cat = def.category ?? "system";
      byCat.set(cat, [...(byCat.get(cat) ?? []), def]);
    }
    return [...byCat.entries()].sort(
      ([a], [b]) =>
        (CATEGORY_ORDER.indexOf(a) < 0 ? 99 : CATEGORY_ORDER.indexOf(a)) -
        (CATEGORY_ORDER.indexOf(b) < 0 ? 99 : CATEGORY_ORDER.indexOf(b))
    );
  }, [defs, query]);

  const run = (def: StudioActionDef) => {
    if (running) return;
    setRunning(def.id);
    const input = assembleInput(def, raw[def.id] ?? {});
    void api
      .actionRun(def.id, input)
      .then((res) => {
        const entry: StudioRun = res.ok
          ? { id: seqRef.current++, at: new Date().toISOString(), actionId: def.id, ok: true, output: res.output }
          : {
              id: seqRef.current++,
              at: new Date().toISOString(),
              actionId: def.id,
              ok: false,
              code: res.code,
              error: res.error,
            };
        setRuns((prev) => [entry, ...prev].slice(0, 20));
        setViewing(entry.id);
      })
      .catch((err: unknown) => {
        const entry: StudioRun = {
          id: seqRef.current++,
          at: new Date().toISOString(),
          actionId: def.id,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
        setRuns((prev) => [entry, ...prev].slice(0, 20));
        setViewing(entry.id);
      })
      .finally(() => setRunning(null));
  };

  if (defs === null) return <div className="deck-empty">{t("deck.loading")}</div>;

  const lastRunFor = (actionId: string): StudioRun | null => runs.find((r) => r.actionId === actionId) ?? null;
  const viewed = runs.find((r) => r.id === viewing) ?? null;

  const renderRunner = (def: StudioActionDef) => {
    const props = def.parameters?.properties ?? {};
    const required = new Set(def.parameters?.required ?? []);
    const names = Object.keys(props);
    const formRaw = raw[def.id] ?? {};
    const missingRequired = names.some((n) => {
      if (!required.has(n) || props[n].type === "boolean") return false;
      const v = formRaw[n];
      return typeof v !== "string" || v.trim() === "";
    });
    const last = lastRunFor(def.id);
    const shown = viewed && viewed.actionId === def.id ? viewed : last;

    return (
      <div className="deck-studio-runner">
        {names.length === 0 ? <div className="deck-row-meta">{t("deck.studio.noParams")}</div> : null}
        <div className="deck-studio-form">
          {names.map((name) => {
            const prop = props[name];
            const label = (
              <span className="deck-studio-field-label">
                {name}
                {required.has(name) ? <em>{t("deck.studio.required")}</em> : null}
              </span>
            );
            if (prop.type === "boolean") {
              return (
                <label key={name} className="deck-studio-field">
                  {label}
                  <input
                    type="checkbox"
                    checked={formRaw[name] === true}
                    onChange={(e) =>
                      setRaw((prev) => ({
                        ...prev,
                        [def.id]: { ...prev[def.id], [name]: e.target.checked },
                      }))
                    }
                  />
                </label>
              );
            }
            if (Array.isArray(prop.enum) && prop.enum.length > 0) {
              return (
                <label key={name} className="deck-studio-field">
                  {label}
                  <select
                    value={typeof formRaw[name] === "string" ? (formRaw[name] as string) : ""}
                    onChange={(e) =>
                      setRaw((prev) => ({
                        ...prev,
                        [def.id]: { ...prev[def.id], [name]: e.target.value },
                      }))
                    }
                  >
                    <option value="">—</option>
                    {prop.enum.map((v) => (
                      <option key={String(v)} value={String(v)}>
                        {String(v)}
                      </option>
                    ))}
                  </select>
                </label>
              );
            }
            return (
              <label key={name} className="deck-studio-field">
                {label}
                <input
                  value={typeof formRaw[name] === "string" ? (formRaw[name] as string) : ""}
                  placeholder={prop.description ?? name}
                  onChange={(e) =>
                    setRaw((prev) => ({
                      ...prev,
                      [def.id]: { ...prev[def.id], [name]: e.target.value },
                    }))
                  }
                />
              </label>
            );
          })}
        </div>
        <div className="deck-panel-ops">
          <button
            type="button"
            className="deck-op primary"
            disabled={running !== null || missingRequired}
            onClick={() => run(def)}
          >
            {running === def.id ? t("deck.studio.running") : t("deck.studio.run")}
          </button>
          {running === def.id && progress ? <span className="deck-srcprog">{progress}</span> : null}
        </div>
        {shown ? (
          shown.ok ? (
            <pre className="deck-srcpage deck-studio-out">{outputText(shown.output)}</pre>
          ) : (
            <div className="deck-tree-error">
              {t("deck.studio.failed", { code: shown.code ?? "?", error: shown.error ?? "?" })}
            </div>
          )
        ) : null}
      </div>
    );
  };

  const catalog = (
    <section className="deck-studio-catalog">
      {groups.length === 0 ? <div className="deck-empty">{t("deck.studio.empty")}</div> : null}
      {groups.map(([cat, items]) => (
        <div key={cat}>
          <div className="deck-panel-group-title">{CATEGORY_KEY[cat] ? t(CATEGORY_KEY[cat]) : cat}</div>
          {items.map((def) => (
            <div key={def.id} className={`deck-studio-action${openId === def.id ? " open" : ""}`}>
              <button
                type="button"
                className="deck-studio-action-head"
                onClick={() => setOpenId(openId === def.id ? null : def.id)}
              >
                <span className="deck-studio-id">{def.id}</span>
                <span className="deck-studio-desc">{def.description}</span>
                {(def.sideEffects ?? []).map((se) => (
                  <span key={se} className="deck-wo-tag">
                    {se}
                  </span>
                ))}
              </button>
              {openId === def.id ? renderRunner(def) : null}
            </div>
          ))}
        </div>
      ))}
    </section>
  );

  return (
    <div className="deck-studio">
      <div className="deck-studio-head">
        <input
          className="deck-studio-search"
          value={query}
          placeholder={t("deck.studio.search")}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="deck-row-meta">{t("deck.studio.hint")}</span>
      </div>
      {props.full ? (
        <div className="deck-review-body">
          <aside className="deck-review-runs">
            <div className="deck-panel-group-title">{t("deck.review.history")}</div>
            {runs.length === 0 ? <div className="deck-empty">—</div> : null}
            {runs.map((r) => (
              <button
                key={r.id}
                type="button"
                className={`deck-row linked${viewed?.id === r.id ? " active" : ""}`}
                onClick={() => {
                  setViewing(r.id);
                  setOpenId(r.actionId);
                }}
              >
                <span className={`deck-wo-tag ${r.ok ? "g" : "r"}`}>{r.ok ? "✓" : "✕"}</span>
                <span className="deck-row-main">{r.actionId}</span>
                <span className="deck-row-meta">{r.at.slice(11, 16)}</span>
              </button>
            ))}
          </aside>
          {catalog}
        </div>
      ) : (
        catalog
      )}
    </div>
  );
}
