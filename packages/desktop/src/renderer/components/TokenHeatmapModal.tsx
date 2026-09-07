import { useCallback, useEffect, useMemo, useState, type JSX } from "react";
import type { ModelHeatCell, WorkspaceModelDetail } from "../../shared/ipc";
import { api } from "../api";
import { useI18n } from "../i18n";

/**
 * 「模型热力图」弹窗（specs/token-model-charts v2）：Token 面板头部按钮的
 * 唯一弹窗，覆盖层实现——开关不影响面板本身。上半是以天为基础的像素热力图
 * （7 天 × 24 小时，chips 切换单模型，hue 按模型名哈希全局稳定），下半是
 * 横向 token 速度对比（最近 20 次中位数，Top 5 + 其余收起；弹窗开着时每
 * 2 秒轮询账本，新落账的请求自动出现）。
 */

/** Fixed 10-hue palette — model → hue is a stable hash of its name so the
 *  same model keeps its color across panels and sessions (design §2). */
const HUES = [
  "#3b82f6",
  "#8b5cf6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#14b8a6",
  "#f97316",
  "#a78bfa",
  "#ec4899",
  "#84cc16",
];
const OPACITY_STEPS = [0.18, 0.38, 0.58, 0.78, 1];
const TOP_N = 5;

export function modelHue(model: string): string {
  let h = 0;
  for (let i = 0; i < model.length; i += 1) h = (h * 31 + model.charCodeAt(i)) >>> 0;
  return HUES[h % HUES.length];
}

type Props = {
  /** Registered workspace root the detail is scoped to. */
  root: string;
  onClose: () => void;
};

export function TokenHeatmapModal({ root, onClose }: Props): JSX.Element {
  const { t } = useI18n();
  const [detail, setDetail] = useState<WorkspaceModelDetail | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      const next = await api.tokensModelDetail(root, 7);
      setDetail(next);
    } catch {
      // unreadable store — keep the previous snapshot
    }
  }, [root]);

  useEffect(() => {
    void load();
    // Poll while open: a landed request shows up within ≤2s (design §3 —
    // the live per-second in-flight ticker needs an in-flight feed, deferred).
    const timer = setInterval(() => void load(), 2000);
    return () => clearInterval(timer);
  }, [load]);

  // Esc closes (the scrim click is handled inline).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const models = useMemo(() => {
    if (!detail) return [];
    const tokens = new Map<string, number>();
    for (const cell of detail.heat) {
      tokens.set(cell.model, (tokens.get(cell.model) ?? 0) + cell.tokens);
    }
    return [...tokens.entries()].map(([model, sum]) => ({ model, sum })).sort((a, b) => b.sum - a.sum);
  }, [detail]);

  const activeModel = selected ?? models[0]?.model ?? null;

  const cells = useMemo(() => {
    if (!detail || !activeModel) return new Map<string, ModelHeatCell>();
    const map = new Map<string, ModelHeatCell>();
    for (const cell of detail.heat) {
      if (cell.model !== activeModel) continue;
      map.set(`${cell.day}|${cell.hour}`, cell);
    }
    return map;
  }, [detail, activeModel]);

  const maxTokens = useMemo(() => Math.max(0, ...[...cells.values()].map((c) => c.tokens)), [cells]);

  const speeds = detail?.speeds ?? [];
  const maxTokS = Math.max(1, ...speeds.map((s) => s.tokS));
  const top = speeds.slice(0, TOP_N);
  const rest = speeds.slice(TOP_N);

  const nowDay = detail?.days.at(-1) ?? null;
  const nowHour = new Date().getHours();

  return (
    <div
      className="ui-token-heat-scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="ui-token-heat-modal" role="dialog" aria-modal="true">
        <div className="m-head">
          <span className="m-title">{t("tokens.heatmap")}</span>
          <span className="m-badge">
            {t("tokens.currentWorkspace")} · {t("tokens.last7d")}
          </span>
          <button type="button" className="m-close" onClick={onClose} aria-label={t("common.close")}>
            ✕
          </button>
        </div>

        <div className="blk-title">{t("tokens.heatTitle")}</div>
        {models.length > 1 ? (
          <div className="chips">
            {models.map(({ model, sum }) => (
              <button
                key={model}
                type="button"
                className={`chip${model === activeModel ? " on" : ""}`}
                onClick={() => setSelected(model)}
                title={model}
              >
                <span className="swatch" style={{ background: modelHue(model) }} />
                {model} · {Math.round(sum / 100) / 10}k
              </button>
            ))}
          </div>
        ) : null}
        {detail && detail.heat.length === 0 ? (
          <div className="heat-empty">{t("tokens.heatEmpty")}</div>
        ) : (
          <div className="hm">
            <span />
            {Array.from({ length: 24 }, (_, h) => (
              <span key={h} className="hour-row">
                {h % 2 === 0 ? String(h).padStart(2, "0") : ""}
              </span>
            ))}
            {(detail?.days ?? []).map((day) => (
              <HeatRow
                key={day}
                day={day}
                cells={cells}
                maxTokens={maxTokens}
                hue={modelHue(activeModel ?? "")}
                isToday={day === nowDay}
                nowHour={nowHour}
              />
            ))}
          </div>
        )}
        <div className="hm-legend">
          {t("tokens.low")}
          {OPACITY_STEPS.map((o) => (
            <i key={o} style={{ background: modelHue(activeModel ?? ""), opacity: o }} />
          ))}
          {t("tokens.high")}
        </div>

        <div className="blk-title">{t("tokens.speedTitle")}</div>
        <div className="speeds">
          {top.map((s) => (
            <div key={s.model} className="spd">
              <span className="swatch" style={{ background: modelHue(s.model) }} />
              <span className="name" title={s.model}>
                {s.model}
              </span>
              <span className="track">
                <span
                  className="fill"
                  style={{ width: `${Math.max(2, (s.tokS / maxTokS) * 100)}%`, background: modelHue(s.model) }}
                />
              </span>
              <span className="toks">
                <b>{s.tokS.toFixed(1)}</b> tok/s · {t("tokens.reqCount", { n: s.samples })}
              </span>
            </div>
          ))}
          {rest.length > 0 ? (
            <button type="button" className="collapsed" onClick={() => setShowAll((v) => !v)}>
              {showAll ? t("tokens.collapse") : t("tokens.speedOthers", { n: rest.length })}
              {!showAll ? (
                <span className="mini">
                  {rest.slice(0, 4).map((s) => (
                    <i
                      key={s.model}
                      style={{ width: `${Math.max(6, Math.min(30, s.tokS / 2))}px`, background: modelHue(s.model) }}
                    />
                  ))}
                </span>
              ) : null}
              {showAll ? "▴" : "▾"}
            </button>
          ) : null}
          {showAll
            ? rest.map((s) => (
                <div key={s.model} className="spd">
                  <span className="swatch" style={{ background: modelHue(s.model) }} />
                  <span className="name" title={s.model}>
                    {s.model}
                  </span>
                  <span className="track">
                    <span
                      className="fill"
                      style={{ width: `${Math.max(2, (s.tokS / maxTokS) * 100)}%`, background: modelHue(s.model) }}
                    />
                  </span>
                  <span className="toks">
                    <b>{s.tokS.toFixed(1)}</b> tok/s · {t("tokens.reqCount", { n: s.samples })}
                  </span>
                </div>
              ))
            : null}
          {speeds.length === 0 ? <div className="heat-empty">{t("tokens.speedEmpty")}</div> : null}
        </div>
      </div>
    </div>
  );
}

function HeatRow(props: {
  day: string;
  cells: Map<string, ModelHeatCell>;
  maxTokens: number;
  hue: string;
  isToday: boolean;
  nowHour: number;
}): JSX.Element {
  const { t } = useI18n();
  const { day, cells, maxTokens, hue, isToday, nowHour } = props;
  return (
    <>
      <span className="day-label">{day.slice(5)}</span>
      {Array.from({ length: 24 }, (_, hour) => {
        const cell = cells.get(`${day}|${hour}`);
        const intensity = cell && maxTokens > 0 ? cell.tokens / maxTokens : 0;
        const step = intensity <= 0 ? -1 : Math.min(4, Math.floor(intensity * 5));
        const isNow = isToday && hour === nowHour;
        const title = cell
          ? `${day} ${String(hour).padStart(2, "0")}:00 — ≈${cell.tokens} tok · ${t("tokens.reqCount", { n: cell.reqs })}`
          : `${day} ${String(hour).padStart(2, "0")}:00`;
        return (
          <span
            key={hour}
            className={`hm-cell${isNow ? " now" : ""}`}
            style={{ background: step >= 0 ? hue : undefined, opacity: step >= 0 ? OPACITY_STEPS[step] : undefined }}
            title={title}
          />
        );
      })}
    </>
  );
}
