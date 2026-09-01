import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";
import { createPortal } from "react-dom";
import type {
  TaskHubDomain,
  TaskHubNode,
  TaskTraceStep,
  WorkspaceTaskHub,
  WorkspaceTokenSummary,
} from "../../shared/ipc";
import { api } from "../api";
import { useI18n } from "../i18n";
import { formatRelative } from "./task-hub-format";

/**
 * Task hub workspace V2 (designs/task-tree-hub/screen-task-tree.html, user
 * approved 2026-09-01) — Git-Graph-style task history for ONE workspace:
 *
 *   │ ● 主任务（会话树, 实心圆）      ← trunk (lane 0)
 *   │ ◆ 伴随任务（审查/构建/原型, 域色菱形, 前置 tag）
 *
 * 会话任务的完整轨迹（用户指令 → agent 行为流：工具/skill/subagent/MCP）
 * 常开展开在节点下方（不收起）；存在 git 记录（file-history checkpoint）的
 * 任务显示 ⎇ 短hash 绑定徽章；审查按需执行（与活动区无关）；token 统计
 * 汇总全工作区 LLM 消耗（silent subagents 含）。
 */

const DOMAINS: TaskHubDomain[] = ["session", "index", "review", "prototype"];
const RAIL_W = 90;
const TRUNK_X = 28;

type Props = {
  root: string;
  onOpenReview: (root: string, reportId: string) => void;
  onOpenDesign: (artifactId: string, pipeline: string) => void;
  onOpenSessionTimeline: (treeId: string, title: string, root: string) => void;
  onOpenKnowledge: (root: string) => void;
};

export function TaskHubWorkspace({
  root,
  onOpenReview,
  onOpenDesign,
  onOpenSessionTimeline,
  onOpenKnowledge,
}: Props): JSX.Element {
  const { t } = useI18n();
  const [hub, setHub] = useState<WorkspaceTaskHub | null>(null);
  const [tokens, setTokens] = useState<WorkspaceTokenSummary | null>(null);
  const [tokensOpen, setTokensOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [domainFilter, setDomainFilter] = useState<TaskHubDomain | "all">("all");
  // Floating detail window (user ask 2026-09-01: 左侧任务详情也用悬浮窗):
  // anchored at the click point, closed by Esc / outside press / scroll.
  const [pop, setPop] = useState<{ node: TaskHubNode; x: number; y: number } | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const [traces, setTraces] = useState<Record<string, Awaited<ReturnType<typeof api.taskHubTrace>>>>({});
  // fork form state (session domain): which node id, name, why
  const [forkFor, setForkFor] = useState<string | null>(null);
  const [forkName, setForkName] = useState("");
  const [forkWhy, setForkWhy] = useState("");
  const [forkBusy, setForkBusy] = useState(false);
  const [forkError, setForkError] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());

  const reload = useCallback(async (): Promise<void> => {
    try {
      const [h, tk] = await Promise.all([api.taskHubList(root), api.tokensSummary(root)]);
      setHub(h);
      setTokens(tk);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [root]);

  useEffect(() => {
    setHub(null);
    setTraces({});
    setPop(null);
    void reload();
  }, [reload]);

  // traces: one fetch per session-tree node (recent turns kept main-side)
  useEffect(() => {
    if (!hub) return;
    let alive = true;
    (async () => {
      for (const g of hub.groups) {
        for (const n of g.nodes) {
          const src = n.source;
          if (src.kind !== "session-tree") continue;
          const treeId = src.treeId;
          try {
            const tr = await api.taskHubTrace(root, treeId);
            if (alive) setTraces((prev) => ({ ...prev, [n.id]: tr }));
          } catch {
            if (alive) setTraces((prev) => ({ ...prev, [n.id]: { treeId, sessions: [] } }));
          }
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [hub, root]);

  // incremental refresh off the EXISTING module events
  useEffect(() => {
    const unsubs = [
      api.onActionProgress((evt) => {
        const done = evt.actionId === "review.full" && (evt.data as { done?: boolean } | undefined)?.done === true;
        const build =
          evt.actionId === "knowledge.buildComplete" && (evt.data as { root?: string } | undefined)?.root === root;
        if (done || build) void reload();
      }),
      api.onDesignChanged(() => void reload()),
      api.onCrgProgress((evt: { done?: boolean }) => {
        if (evt.done) void reload();
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }, [reload, root]);

  // Popover dismissal — capture-phase scroll so inner scrollers close it too.
  useEffect(() => {
    if (!pop) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setPop(null);
    };
    const onScroll = (): void => setPop(null);
    const onPointerDown = (e: MouseEvent): void => {
      if (!popRef.current?.contains(e.target as Node)) setPop(null);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [pop]);

  const flat = useMemo(() => hub?.groups.flatMap((g) => g.nodes) ?? [], [hub]);
  const visible = useMemo(
    () => flat.filter((n) => domainFilter === "all" || n.domain === domainFilter),
    [flat, domainFilter]
  );
  const rows = visible;
  const countOf = (d: TaskHubDomain): number => hub?.groups.find((g) => g.domain === d)?.nodes.length ?? 0;

  // graph rail alignment — measure card title positions after paint
  useEffect(() => {
    const draw = () => {
      const svg = svgRef.current;
      if (!svg) return;
      const gRect = svg.parentElement?.getBoundingClientRect();
      if (!gRect) return;
      const yOf = (node: TaskHubNode): number => {
        const el = rowRefs.current.get(`${node.domain}:${node.id}`);
        const card = el?.querySelector(".ui-taskhub-card");
        const r = card?.getBoundingClientRect();
        return r ? r.top - gRect.top + 26 : 0;
      };
      const H = (svg.parentElement?.scrollHeight ?? 100) + 20;
      svg.setAttribute("width", String(RAIL_W));
      svg.setAttribute("height", String(H));
      svg.setAttribute("viewBox", `0 0 ${RAIL_W} ${H}`);
      svg.innerHTML = "";
      const E = (d: string, cls: string): void => {
        const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
        p.setAttribute("d", d);
        p.setAttribute("class", `edge ${cls}`);
        svg.appendChild(p);
      };
      let prev: TaskHubNode | null = null;
      for (const node of rows) {
        if (prev) E(`M ${TRUNK_X} ${yOf(prev)} L ${TRUNK_X} ${yOf(node)}`, "trunk");
        prev = node;
      }
      for (const node of rows) {
        const y = yOf(node);
        const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
        g.setAttribute("class", `node${node.status === "running" ? " running" : ""}`);
        const color = `var(--dot-${node.domain})`;
        if (node.status === "running") {
          const pulse = document.createElementNS("http://www.w3.org/2000/svg", "circle");
          pulse.setAttribute("class", "pulse");
          pulse.setAttribute("cx", String(TRUNK_X));
          pulse.setAttribute("cy", String(y));
          pulse.setAttribute("r", "10");
          pulse.setAttribute("fill", "var(--dot-session)");
          g.appendChild(pulse);
        }
        const halo = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        halo.setAttribute("class", "halo");
        halo.setAttribute("cx", String(TRUNK_X));
        halo.setAttribute("cy", String(y));
        halo.setAttribute("r", "12");
        halo.setAttribute("fill", "none");
        halo.setAttribute("stroke", "var(--ui-accent)");
        halo.setAttribute("stroke-width", "1.6");
        g.appendChild(halo);
        if (node.source.kind === "session-tree") {
          const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
          c.setAttribute("cx", String(TRUNK_X));
          c.setAttribute("cy", String(y));
          c.setAttribute("r", "7");
          c.setAttribute("fill", "var(--ui-surface-raised)");
          c.setAttribute("stroke", color);
          c.setAttribute("stroke-width", "3");
          g.appendChild(c);
        } else {
          const d = document.createElementNS("http://www.w3.org/2000/svg", "rect");
          const s = 8.4;
          d.setAttribute("x", String(TRUNK_X - s / 2));
          d.setAttribute("y", String(y - s / 2));
          d.setAttribute("width", String(s));
          d.setAttribute("height", String(s));
          d.setAttribute("rx", "1.6");
          d.setAttribute("transform", `rotate(45 ${TRUNK_X} ${y})`);
          d.setAttribute("fill", color);
          d.setAttribute("stroke", "var(--ui-surface-raised)");
          d.setAttribute("stroke-width", "1.6");
          g.appendChild(d);
        }
        svg.appendChild(g);
      }
    };
    const raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [rows, domainFilter, pop, traces]);

  const runFork = async (): Promise<void> => {
    const selected = pop?.node;
    if (!selected || selected.source.kind !== "session-tree" || !forkWhy.trim()) return;
    setForkBusy(true);
    setForkError(null);
    try {
      await api.actionRun("task.fork", {
        treeId: selected.source.treeId,
        why: forkWhy.trim(),
        ...(forkName.trim() ? { name: forkName.trim() } : {}),
      });
      setForkFor(null);
      setForkName("");
      setForkWhy("");
      setPop(null);
      await reload();
    } catch (err) {
      setForkError(err instanceof Error ? err.message : String(err));
    } finally {
      setForkBusy(false);
    }
  };

  const runSwitch = async (node: TaskHubNode): Promise<void> => {
    if (node.source.kind !== "session-tree") return;
    try {
      await api.actionRun("task.switch", { treeId: node.source.treeId });
      setPop(null);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const tagOf = (n: TaskHubNode): { label: string; cls: string } => {
    if (n.source.kind === "review-report") return { label: "REVIEW", cls: "tag-review" };
    if (n.source.kind === "index-job") return { label: "INDEX", cls: "tag-index" };
    if (n.source.kind === "design-artifact")
      return {
        label: n.source.pipeline === "spec" ? "PM-DESIGN" : "UI-DESIGN",
        cls: n.source.pipeline === "spec" ? "tag-pm-design" : "tag-ui-design",
      };
    return { label: "SESSION", cls: "tag-session" };
  };
  const fmtTokens = (n: number): string =>
    n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);

  return (
    <div className="ui-taskhub">
      <div className="ui-taskhub-top">
        <div className="ui-taskhub-pills">
          <button
            type="button"
            className={`ui-taskhub-pill${domainFilter === "all" ? " on" : ""}`}
            onClick={() => setDomainFilter("all")}
          >
            {t("taskhub.all")} · {flat.length}
          </button>
          {DOMAINS.map((d) => (
            <button
              key={d}
              type="button"
              className={`ui-taskhub-pill${domainFilter === d ? " on" : ""}`}
              onClick={() => setDomainFilter(d)}
            >
              {t(`taskhub.domain.${d}` as never)} · {countOf(d)}
            </button>
          ))}
        </div>
        {tokens ? (
          <div className="ui-taskhub-tokens">
            <button type="button" className="ui-taskhub-token-badge" onClick={() => setTokensOpen((v) => !v)}>
              Ⓣ {fmtTokens(tokens.totalTokens)} · {tokens.requests} reqs
            </button>
            {tokensOpen ? (
              <div className="ui-taskhub-token-pop">
                <div className="ui-taskhub-token-line">
                  {t("taskhub.tokens.sessions", { n: tokens.sessions, s: tokens.silentSessions })}
                </div>
                <div className="ui-taskhub-token-line">
                  {t("taskhub.tokens.split", {
                    p: fmtTokens(tokens.promptTokens),
                    c: fmtTokens(tokens.completionTokens),
                    h: fmtTokens(tokens.cacheReadTokens),
                  })}
                </div>
                {Object.entries(tokens.perModel).map(([model, u]) => (
                  <div key={model} className="ui-taskhub-token-line model">
                    <span className="model-name">{model}</span>
                    <span className="model-nums">
                      {fmtTokens(u.total)} · {u.reqs} reqs
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="ui-taskhub-body">
        <div className="ui-taskhub-graph">
          <div className="ui-taskhub-railwrap">
            <svg ref={svgRef} className="ui-taskhub-tracks" />
          </div>
          <div className="ui-taskhub-rows">
            {error ? (
              <div className="ui-taskhub-empty">
                {error}{" "}
                <button
                  type="button"
                  className="ui-review-retry"
                  onClick={() => {
                    setError(null);
                    void reload();
                  }}
                >
                  {t("error.retry")}
                </button>
              </div>
            ) : !hub ? (
              <div className="ui-taskhub-empty">
                <span className="ui-spinner" />
              </div>
            ) : visible.length === 0 ? (
              <div className="ui-taskhub-empty">{t("taskhub.empty")}</div>
            ) : (
              visible.map((node) => {
                const tag = tagOf(node);
                const sel = pop?.node.domain === node.domain && pop?.node.id === node.id;
                const trace = node.source.kind === "session-tree" ? traces[node.id] : undefined;
                const gitHash = node.source.kind === "session-tree" ? (node.meta?.gitHash as string | null) : null;
                const key = `${node.domain}:${node.id}`;
                return (
                  <div
                    key={key}
                    className="ui-taskhub-row"
                    data-domain={node.domain}
                    ref={(el) => {
                      if (el) rowRefs.current.set(key, el);
                      else rowRefs.current.delete(key);
                    }}
                  >
                    <div className="ui-taskhub-card-wrap">
                      <div
                        className={`ui-taskhub-card${sel ? " sel" : ""}`}
                        role="button"
                        tabIndex={0}
                        onClick={(e) =>
                          setPop({
                            node,
                            x: Math.max(8, Math.min(e.clientX + 14, window.innerWidth - 346)),
                            y: Math.max(8, Math.min(e.clientY + 10, window.innerHeight - 320)),
                          })
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                            setPop({
                              node,
                              x: Math.max(8, Math.min(r.right + 14, window.innerWidth - 346)),
                              y: Math.max(8, Math.min(r.top + 10, window.innerHeight - 320)),
                            });
                          }
                        }}
                      >
                        <div className="t">
                          <span className={`chip ${tag.cls}`}>{tag.label}</span>
                          <span className="name">{node.title}</span>
                          {node.status === "running" ? (
                            <span className="chip st-running">{t("taskhub.status.running")}</span>
                          ) : null}
                          {node.status === "archived" ? (
                            <span className="chip st-abandoned">{t("taskhub.status.archived")}</span>
                          ) : null}
                        </div>
                        <div className="meta">
                          {gitHash ? (
                            <span className="git-chip" title={t("taskhub.gitBound")}>
                              ⎇ <span className="hash">{gitHash}</span>
                            </span>
                          ) : null}
                          {node.meta?.activeBranch ? (
                            <span className="meta-branch">⑂ {String(node.meta.activeBranch)}</span>
                          ) : null}
                          <span>{formatRelative(node.startedAt, t("index.freshness.justNow"), "—")}</span>
                          {node.meta?.comments != null ? (
                            <span>{t("taskhub.findings", { n: node.meta.comments as number })}</span>
                          ) : null}
                          {node.meta?.sessionCount != null ? (
                            <span>{t("taskhub.sessionsCount", { n: node.meta.sessionCount as number })}</span>
                          ) : null}
                        </div>
                      </div>
                      {/* 常开 trace：会话任务的完整轨迹直接展开（不收起） */}
                      {trace && trace.sessions.length > 0
                        ? trace.sessions.map((s) => (
                            <div key={s.sessionId} className="ui-taskhub-trace">
                              <div className="tr-head">
                                ◈ {s.title} — {t("taskhub.traceHead")}
                              </div>
                              <div className="tr-body">
                                {s.turns.length === 0 ? (
                                  <div className="ui-taskhub-empty" style={{ minHeight: 40 }}>
                                    {t("taskhub.traceEmpty")}
                                  </div>
                                ) : (
                                  s.turns.map((turn, i) => (
                                    <div key={i} className="turn">
                                      <div className="turn-head">
                                        <span>
                                          Turn {i + 1}
                                          {s.truncated && i === 0 ? " …" : ""}
                                        </span>
                                        <span className="ln" />
                                      </div>
                                      <div className="user-msg">
                                        <span className="ic">💬</span>
                                        <div>
                                          <div className="who">{t("taskhub.userPrompt")}</div>
                                          <div className="txt">{turn.user}</div>
                                        </div>
                                      </div>
                                      <div className="steps">
                                        {turn.steps.map((st, j) => (
                                          <TraceStepRow key={j} step={st as TaskTraceStep} />
                                        ))}
                                      </div>
                                    </div>
                                  ))
                                )}
                                {s.truncated ? <div className="tr-more">{t("taskhub.traceTruncated")}</div> : null}
                              </div>
                            </div>
                          ))
                        : null}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {pop
          ? createPortal(
              <div ref={popRef} className="ui-taskhub-pop" style={{ left: pop.x, top: pop.y }} role="dialog">
                {(() => {
                  const node = pop.node;
                  const src = node.source;
                  return (
                    <div className="ui-taskhub-detail-card">
                      <div className="ui-taskhub-detail-head">
                        <span className="glyph">{src.kind === "session-tree" ? "●" : "◆"}</span>
                        <h2>{node.title}</h2>
                        <button
                          type="button"
                          className="ui-risk-pop-close"
                          aria-label="close"
                          onClick={() => setPop(null)}
                        >
                          ✕
                        </button>
                      </div>
                      <div className="sub">{t(`taskhub.domain.${node.domain}` as never)}</div>
                      <div className="rows">
                        <div className="row">
                          <span className="k">{t("taskhub.detail.status")}</span>
                          <span>{t(`taskhub.status.${node.status}` as never)}</span>
                        </div>
                        <div className="row">
                          <span className="k">{t("taskhub.detail.started")}</span>
                          <span>{formatRelative(node.startedAt, t("index.freshness.justNow"), "—")}</span>
                        </div>
                        {src.kind === "session-tree" && node.meta?.gitHash ? (
                          <div className="row">
                            <span className="k">{t("taskhub.gitBound")}</span>
                            <span className="git-chip">
                              ⎇ <span className="hash">{String(node.meta.gitHash)}</span>
                            </span>
                          </div>
                        ) : null}
                        {src.kind === "review-report" && node.meta?.comments != null ? (
                          <div className="row">
                            <span className="k">{t("taskhub.findings", { n: node.meta.comments as number })}</span>
                            <span />
                          </div>
                        ) : null}
                      </div>
                      {src.kind === "session-tree" ? (
                        <div className="dsec">
                          <div className="hd">{t("taskhub.forkSection")}</div>
                          {forkFor === node.id ? (
                            <div className="ui-taskhub-forkform">
                              <input
                                className="ui-review-scope-select"
                                value={forkName}
                                onChange={(e) => setForkName(e.target.value)}
                                placeholder={t("taskhub.forkName")}
                              />
                              <input
                                className="ui-review-scope-select"
                                value={forkWhy}
                                onChange={(e) => setForkWhy(e.target.value)}
                                placeholder={t("taskhub.forkWhy")}
                              />
                              {forkError ? <div className="ui-error">{forkError}</div> : null}
                              <div className="forkform-actions">
                                <button
                                  type="button"
                                  className="btn"
                                  disabled={forkBusy || !forkWhy.trim()}
                                  onClick={() => void runFork()}
                                >
                                  ⑂ {t("taskhub.forkGo")}
                                </button>
                                <button type="button" className="btn subtle" onClick={() => setForkFor(null)}>
                                  {t("common.cancel")}
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="actions">
                              <button
                                type="button"
                                className="btn"
                                onClick={() => onOpenSessionTimeline(src.treeId, node.title, root)}
                              >
                                {t("taskhub.openTimeline")}
                              </button>
                              <button
                                type="button"
                                className="btn"
                                onClick={() => {
                                  setForkFor(node.id);
                                  setForkWhy("");
                                  setForkName("");
                                }}
                              >
                                ⑂ {t("taskhub.fork")}
                              </button>
                              <button type="button" className="btn subtle" onClick={() => void runSwitch(node)}>
                                {t("taskhub.switchBranch")}
                              </button>
                            </div>
                          )}
                        </div>
                      ) : null}
                      {src.kind === "review-report" ? (
                        <div className="dsec">
                          <div className="hd">{t("taskhub.detail.actions")}</div>
                          <div className="actions">
                            <button type="button" className="btn" onClick={() => onOpenReview(root, src.reportId)}>
                              {t("taskhub.openReport")}
                            </button>
                          </div>
                        </div>
                      ) : null}
                      {src.kind === "design-artifact" ? (
                        <div className="dsec">
                          <div className="hd">{t("taskhub.detail.actions")}</div>
                          <div className="actions">
                            <button
                              type="button"
                              className="btn"
                              onClick={() => onOpenDesign(src.artifactId, src.pipeline)}
                            >
                              {t("taskhub.openDesign")}
                            </button>
                          </div>
                        </div>
                      ) : null}
                      {src.kind === "index-job" ? (
                        <div className="dsec">
                          <div className="hd">{t("taskhub.detail.actions")}</div>
                          <div className="actions">
                            <button type="button" className="btn" onClick={() => onOpenKnowledge(root)}>
                              {t("taskhub.openIndex")}
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })()}
              </div>,
              document.body
            )
          : null}
      </div>
    </div>
  );
}

function TraceStepRow({ step }: { step: TaskTraceStep }): JSX.Element {
  const mcp = step.mcp ? <span className="mcp-badge">MCP · {step.mcp}</span> : null;
  return (
    <>
      <div className="step">
        <span className={`ic ${step.cls}`}>{step.ic}</span>
        <div className="body">
          <div className="l1">
            {mcp}
            <span className="tool">{step.tool}</span>
            <span className="arg">{step.arg}</span>
            {step.fail ? <span className="fail">✗</span> : step.ok ? <span className="ok">✓</span> : null}
            <span className="ms">{step.ms || ""}</span>
          </div>
        </div>
      </div>
      {step.nested?.length ? (
        <div className="subagent-block">
          <div className="sa-head">🤖 subagent</div>
          <div className="steps">
            {step.nested.map((n, i) => (
              <TraceStepRow key={i} step={n} />
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}
