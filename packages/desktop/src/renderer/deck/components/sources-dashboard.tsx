// Knowledge & index full-body dashboard (E8): a card wall over every real
// source (knowledgeStatus + memoryRouting status + the CRG graph library),
// per-source detail with stats / workspace & page lists, wiki page reading,
// and rebuild actions with live progress streaming. The overlay keeps the
// list→detail thumbnail.
import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { api } from "../../api";
import type {
  CodegraphIndexEntry,
  CrgIndexEntry,
  KnowledgeArchmapContent,
  KnowledgeSourceStatus,
  KnowledgeStatusResponse,
  MemoryPipelineStats,
  MemoryRoutingStatus,
  WikiPageEntry,
} from "../../../shared/ipc";
import { MermaidDiagram } from "../../components/MermaidDiagram";
import { StreamdownView } from "../../components/StreamdownView";
import { useI18n } from "../../i18n";

const STATE_DOT: Record<string, string> = {
  indexed: "ok",
  empty: "idle",
  disabled: "off",
  stale: "warn",
};

// Post-merge contract: core knowledge sources live in knowledgeStatus(),
// while memory/routing/serena report through the dedicated
// MemoryRoutingStatus surface — the dashboard unions both into one wall.
type KnowledgeSourceKey = keyof KnowledgeStatusResponse;
type SourceKey = KnowledgeSourceKey | keyof MemoryRoutingStatus;
type SourceEntry = KnowledgeSourceStatus & { stats?: MemoryPipelineStats };

export const SOURCE_LABEL: Record<SourceKey, string> = {
  codegraph: "CodeGraph",
  openwiki: "OpenWiki",
  archmaps: "ArchMaps",
  serena: "Serena",
  agents: "AGENTS.md",
  memory: "Memory",
  routing: "Routing",
};

export function SourcesDashboard(): JSX.Element {
  const { t } = useI18n();
  const [status, setStatus] = useState<KnowledgeStatusResponse | null>(null);
  const [legacy, setLegacy] = useState<MemoryRoutingStatus | null>(null);
  const [crg, setCrg] = useState<CrgIndexEntry[] | null>(null);
  const [selected, setSelected] = useState<SourceKey | "crg" | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState<{ path: string; content: string } | null>(null);
  const [pages, setPages] = useState<WikiPageEntry[] | null>(null);
  const [workspaces, setWorkspaces] = useState<CodegraphIndexEntry[] | null>(null);
  const [archView, setArchView] = useState<{ path: string; content: KnowledgeArchmapContent } | null>(null);
  const [agentsDoc, setAgentsDoc] = useState<{ ok: boolean; content?: string; error?: string } | null>(null);
  const [symbolQuery, setSymbolQuery] = useState("");
  const [symbols, setSymbols] = useState<Array<{
    name: string;
    kind: string;
    filePath: string;
    startLine: number;
  }> | null>(null);
  // E19: lite call-relation view for a picked symbol (focus + callers + callees).
  const [symGraph, setSymGraph] = useState<{
    name: string;
    graph: {
      nodes: Array<{ id: string; name: string; kind: string; filePath: string; role: "focus" | "caller" | "callee" }>;
      truncated: boolean;
    };
  } | null>(null);
  const busyRef = useRef(false);

  const reload = useCallback(() => {
    void api
      .knowledgeStatus()
      .then(setStatus)
      .catch(() => {});
    void api
      .memoryRoutingStatus()
      .then(setLegacy)
      .catch(() => {});
    void api
      .crgList()
      .then(setCrg)
      .catch(() => setCrg([]));
  }, []);

  useEffect(reload, [reload]);

  // Live rebuild progress — whichever channel fires while a rebuild runs.
  useEffect(() => {
    if (!busy) {
      setProgress(null);
      return;
    }
    const offs = [
      api.onCodegraphProgress((e) => {
        if (!e.done && e.chunk.trim()) setProgress(e.chunk.trim().split("\n").pop() ?? null);
      }),
      api.onWikiProgress((e) => {
        if (!e.done && e.chunk.trim()) setProgress(e.chunk.trim().split("\n").pop() ?? null);
      }),
      api.onCrgProgress((e) => {
        if (!e.done && e.chunk.trim()) setProgress(e.chunk.trim().split("\n").pop() ?? null);
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [busy]);

  useEffect(() => {
    setPage(null);
    setPages(null);
    setWorkspaces(null);
    setArchView(null);
    setAgentsDoc(null);
    setSymbolQuery("");
    setSymbols(null);
    setSymGraph(null);
    if (selected === "openwiki")
      void api
        .wikiListPages()
        .then(setPages)
        .catch(() => setPages([]));
    // E18: agents detail needs a workspace root for knowledgeReadAgents, and
    // symbol search needs one for knowledgeListSymbols — same listing as the
    // codegraph rebuild context provides it.
    if (selected === "codegraph" || selected === "agents")
      void api
        .codegraphList()
        .then(setWorkspaces)
        .catch(() => setWorkspaces([]));
  }, [selected]);

  // E18: AGENTS.md inline read (root = first initialized workspace).
  const activeRoot = workspaces?.find((ws) => ws.initialized)?.root ?? workspaces?.find((ws) => ws.root)?.root ?? null;

  useEffect(() => {
    if (selected !== "agents" || !activeRoot) {
      setAgentsDoc(null);
      return;
    }
    let cancelled = false;
    void api.knowledgeReadAgents(activeRoot).then(
      (doc) => {
        if (!cancelled) setAgentsDoc(doc);
      },
      () => {}
    );
    return () => {
      cancelled = true;
    };
  }, [selected, activeRoot]);

  // E18: debounced symbol search against the active workspace's index.
  useEffect(() => {
    if (selected !== "codegraph" || !activeRoot || !symbolQuery.trim()) {
      setSymbols(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void api
        .knowledgeListSymbols(activeRoot, symbolQuery.trim())
        .then((rows) => {
          if (!cancelled) setSymbols(rows.slice(0, 20));
        })
        .catch(() => {
          if (!cancelled) setSymbols([]);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [symbolQuery, selected, activeRoot]);

  if (!status) return <div className="deck-empty">{t("deck.loading")}</div>;

  const entries: Array<[SourceKey, SourceEntry]> = [
    ...(Object.entries(status) as Array<[KnowledgeSourceKey, SourceEntry]>),
    ...Object.entries(legacy ?? {}).map(([k, v]) => [k as SourceKey, v as SourceEntry] as [SourceKey, SourceEntry]),
  ];
  const ready = entries.filter(([, s]) => s.state === "indexed").length;

  const runRebuild = (what: "all" | SourceKey | "crg") => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    const jobs: Array<Promise<unknown>> = [];
    if (what === "all" || what === "codegraph") jobs.push(api.codegraphReindex(".").catch(() => null));
    if (what === "all" || what === "openwiki") jobs.push(api.wikiUpdate().catch(() => null));
    if ((what === "all" || what === "crg") && crg && crg.length > 0) {
      jobs.push(api.crgReindex(crg[0].root).catch(() => null));
    }
    void Promise.all(jobs).finally(() => {
      busyRef.current = false;
      setBusy(false);
      reload();
    });
  };

  const readPage = (path: string) => {
    void api
      .wikiReadPage(path)
      .then((content) => setPage({ path, content }))
      .catch(() => setPage({ path, content: t("deck.opFailed", { error: "wikiReadPage" }) }));
  };

  // E16: open an archmap artifact — html boards show in a sandboxed iframe,
  // mermaid docs render through the shared diagram pipeline, legacy A2UI
  // surface JSON falls back to pretty-printed text.
  // E19: open the lite call-relation view for a symbol name.
  const readSymbolGraph = (name: string) => {
    if (!activeRoot) return;
    void api
      .knowledgeSymbolGraph(activeRoot, name)
      .then((graph) => setSymGraph({ name, graph }))
      .catch(() => {});
  };

  const readArchmap = (path: string) => {
    void api
      .knowledgeReadArchmap(path)
      .then((content) =>
        // Malformed resolves (contract drift / stubs) land as an honest
        // failure — never as a shape the wall crashes on.
        setArchView({ path, content: content && content.ok ? content : { ok: false, error: "malformed response" } })
      )
      .catch(() => setArchView({ path, content: { ok: false, error: "knowledgeReadArchmap" } }));
  };

  // ── 详情（二级页） ──────────────────────────────────────────────────────
  if (selected) {
    const byKey = (key: string): SourceEntry | undefined =>
      (status as Partial<Record<string, SourceEntry>>)[key] ??
      ((legacy ?? {}) as Partial<Record<string, SourceEntry>>)[key];
    const source = selected === "crg" ? null : (byKey(selected) ?? null);
    return (
      <div className="deck-srcdash">
        <div className="deck-sub-head">
          <button type="button" className="deck-sub-back" onClick={() => setSelected(null)}>
            ‹ {t("deck.dock.sources")}
          </button>
          <span className="deck-sub-title">{selected === "crg" ? "CRG" : SOURCE_LABEL[selected]}</span>
          {source ? (
            <span className={`deck-wo-tag ${source.state === "indexed" ? "g" : "a"}`}>{source.state}</span>
          ) : null}
        </div>

        {source ? (
          <div className="deck-kv-grid">
            <div className="deck-kv">
              <span className="k">{t("deck.sources.count")}</span>
              <span className="v">
                {typeof source.count === "number" ? `${source.count}${source.unit ?? ""}` : "—"}
              </span>
            </div>
            <div className="deck-kv">
              <span className="k">{t("deck.sources.lastSync")}</span>
              <span className="v">{source.lastSync ? source.lastSync.slice(0, 16).replace("T", " ") : "—"}</span>
            </div>
            {source.detail ? (
              <div className="deck-kv">
                <span className="k">{t("deck.sources.detail")}</span>
                <span className="v">{source.detail}</span>
              </div>
            ) : null}
            {selected === "memory" && source.stats ? (
              <>
                <div className="deck-kv">
                  <span className="k">L0/L1/L2</span>
                  <span className="v">
                    {source.stats.l0}/{source.stats.l1}/{source.stats.l2}
                  </span>
                </div>
                <div className="deck-kv">
                  <span className="k">L3 persona</span>
                  <span className="v">{source.stats.l3 ? "✓" : "—"}</span>
                </div>
              </>
            ) : null}
          </div>
        ) : null}

        {selected === "crg" && crg ? (
          <>
            <div className="deck-panel-group-title">{t("deck.sources.workspaces")}</div>
            {crg.map((ws) => (
              <div key={ws.root} className="deck-row static">
                <span className={`deck-sdot ${ws.hasGraph ? "ok" : "idle"}`} aria-hidden="true" />
                <span className="deck-row-main">{ws.label}</span>
                <span className="deck-row-meta">
                  {ws.hasGraph ? t("deck.sources.graphReady") : t("deck.sources.noGraph")}
                </span>
              </div>
            ))}
          </>
        ) : null}

        {selected === "codegraph" && workspaces ? (
          <>
            <div className="deck-panel-group-title">{t("deck.sources.workspaces")}</div>
            {workspaces.map((ws) => (
              <div key={ws.root} className="deck-row static">
                <span className={`deck-sdot ${ws.initialized ? "ok" : "idle"}`} aria-hidden="true" />
                <span className="deck-row-main">{ws.label}</span>
                <span className="deck-row-meta">{ws.root}</span>
              </div>
            ))}
          </>
        ) : null}

        {/* E18/E19: symbol search against the active workspace's codegraph
            index; clicking a result opens the lite call-relation view. */}
        {selected === "codegraph" && activeRoot ? (
          <div className="deck-sym">
            {symGraph ? (
              <>
                <div className="deck-sub-head">
                  <button type="button" className="deck-sub-back" onClick={() => setSymGraph(null)}>
                    ‹ {t("deck.sources.symbolHint")}
                  </button>
                  <span className="deck-sub-title">{symGraph.name}</span>
                </div>
                {symGraph.graph.truncated ? (
                  <div className="deck-row static warn-note">{t("deck.sources.graphTruncated")}</div>
                ) : null}
                {(
                  [
                    ["focus", t("deck.sources.roleFocus")],
                    ["caller", t("deck.sources.roleCallers")],
                    ["callee", t("deck.sources.roleCallees")],
                  ] as const
                ).map(([role, title]) => {
                  const nodes = symGraph.graph.nodes.filter((n) => n.role === role);
                  if (nodes.length === 0) return null;
                  return (
                    <div key={role}>
                      <div className="deck-panel-group-title">
                        {title} · {nodes.length}
                      </div>
                      {nodes.map((n) => (
                        <div key={`${role}:${n.id}`} className="deck-row static">
                          <span className="deck-wo-tag b">{n.kind}</span>
                          <span className="deck-row-main">{n.name}</span>
                          <span className="deck-row-meta">{n.filePath}</span>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </>
            ) : (
              <>
                <input
                  className="deck-sym-input"
                  value={symbolQuery}
                  placeholder={t("deck.sources.symbolHint")}
                  onChange={(e) => setSymbolQuery(e.target.value)}
                />
                {symbols ? (
                  symbols.length > 0 ? (
                    symbols.map((sym) => (
                      <button
                        key={`${sym.filePath}:${sym.startLine}:${sym.name}`}
                        type="button"
                        className="deck-row linked"
                        onClick={() => readSymbolGraph(sym.name)}
                      >
                        <span className="deck-wo-tag b">{sym.kind}</span>
                        <span className="deck-row-main">{sym.name}</span>
                        <span className="deck-row-meta">
                          {sym.filePath}:{sym.startLine} ›
                        </span>
                      </button>
                    ))
                  ) : (
                    <div className="deck-empty">{t("deck.sources.noResults")}</div>
                  )
                ) : null}
              </>
            )}
          </div>
        ) : null}

        {/* E18: AGENTS.md inline read — the agents source IS this document. */}
        {selected === "agents" ? (
          agentsDoc ? (
            agentsDoc.ok ? (
              <>
                <div className="deck-panel-group-title">AGENTS.md</div>
                <div className="deck-md-view">
                  <StreamdownView markdown={agentsDoc.content ?? ""} />
                </div>
              </>
            ) : (
              <div className="deck-empty">
                {t("deck.opFailed", { error: agentsDoc.error ?? "knowledgeReadAgents" })}
              </div>
            )
          ) : (
            <div className="deck-empty">{t("deck.loading")}</div>
          )
        ) : null}

        {selected === "archmaps" && status.archmaps.files && status.archmaps.files.length > 0 ? (
          archView ? (
            <>
              <div className="deck-sub-head">
                <button type="button" className="deck-sub-back" onClick={() => setArchView(null)}>
                  ‹ {t("deck.sources.files")}
                </button>
                <span className="deck-sub-title">{archView.path}</span>
              </div>
              {!archView.content.ok ? (
                <div className="deck-empty deck-archview-fail">
                  {t("deck.opFailed", { error: archView.content.error })}
                </div>
              ) : archView.content.html !== undefined ? (
                // HTML board: fully sandboxed iframe — no same-origin, no
                // scripts, so the artifact can't reach back into the shell.
                <iframe
                  className="deck-archview-board"
                  sandbox=""
                  title={archView.path}
                  srcDoc={archView.content.html}
                />
              ) : archView.content.markdown !== undefined ? (
                <div className="deck-archview-md">
                  <MermaidDiagram chart={archView.content.markdown} />
                </div>
              ) : (
                <pre className="deck-srcpage">{JSON.stringify(archView.content.surface, null, 2)}</pre>
              )}
            </>
          ) : (
            <>
              <div className="deck-panel-group-title">
                {t("deck.sources.files")} · {status.archmaps.files.length}
              </div>
              {status.archmaps.files.map((f) => (
                <button key={f.path} type="button" className="deck-row linked" onClick={() => readArchmap(f.path)}>
                  <span className="deck-row-main">{f.name}</span>
                  <span className="deck-row-meta">{f.mtime ? f.mtime.slice(0, 16).replace("T", " ") : f.path} ›</span>
                </button>
              ))}
            </>
          )
        ) : null}

        {selected === "openwiki" && pages ? (
          page ? (
            <>
              <div className="deck-sub-head">
                <button type="button" className="deck-sub-back" onClick={() => setPage(null)}>
                  ‹ {t("deck.sources.pages")}
                </button>
                <span className="deck-sub-title">{page.path}</span>
              </div>
              <div className="deck-md-view">
                <StreamdownView markdown={page.content} />
              </div>
            </>
          ) : (
            <>
              <div className="deck-panel-group-title">
                {t("deck.sources.pages")} · {pages.length}
              </div>
              {pages.map((p) => (
                <button key={p.path} type="button" className="deck-row linked" onClick={() => readPage(p.path)}>
                  <span className="deck-row-main">{p.title}</span>
                  <span className="deck-row-meta">{p.path} ›</span>
                </button>
              ))}
            </>
          )
        ) : null}

        <div className="deck-panel-ops">
          {selected === "codegraph" || selected === "openwiki" || selected === "crg" ? (
            <button type="button" className="deck-op primary" disabled={busy} onClick={() => runRebuild(selected)}>
              {busy ? t("deck.sources.rebuilding") : t("deck.sources.rebuild")}
            </button>
          ) : null}
          {progress ? <span className="deck-srcprog">{progress}</span> : null}
        </div>
      </div>
    );
  }

  // ── 卡片墙（一级页） ────────────────────────────────────────────────────
  return (
    <div className="deck-srcdash">
      <div className="deck-srcdash-head">
        <span className={`deck-wo-tag ${ready === entries.length ? "g" : "a"}`}>
          {t("deck.sources.ready", { ready: String(ready), total: String(entries.length) })}
        </span>
        <span className="deck-row-meta">{t("deck.sources.hint")}</span>
        <span className="deck-tree-head-ops">
          <button type="button" className="deck-op" disabled={busy} onClick={() => runRebuild("all")}>
            {busy ? t("deck.sources.rebuilding") : t("deck.sources.rebuildAll")}
          </button>
        </span>
      </div>
      {progress ? <div className="deck-srcprog">{progress}</div> : null}
      <div className="deck-src-grid">
        {entries.map(([name, source]) => (
          <button key={name} type="button" className="deck-src-card" onClick={() => setSelected(name)}>
            <span className={`deck-sdot ${STATE_DOT[source.state] ?? "idle"}`} aria-hidden="true" />
            <b>{SOURCE_LABEL[name]}</b>
            <span className="deck-row-meta">
              {source.state}
              {typeof source.count === "number" ? ` · ${source.count}${source.unit ?? ""}` : ""}
            </span>
            {source.lastSync ? (
              <span className="deck-row-meta">{source.lastSync.slice(0, 16).replace("T", " ")}</span>
            ) : null}
          </button>
        ))}
        {crg && crg.length > 0 ? (
          <button type="button" className="deck-src-card" onClick={() => setSelected("crg")}>
            <span className={`deck-sdot ${crg.some((w) => w.hasGraph) ? "ok" : "idle"}`} aria-hidden="true" />
            <b>CRG</b>
            <span className="deck-row-meta">
              {crg.some((w) => w.hasGraph) ? t("deck.sources.graphReady") : t("deck.sources.noGraph")} · {crg.length}{" "}
              {t("deck.sources.workspaces")}
            </span>
          </button>
        ) : null}
      </div>
    </div>
  );
}
