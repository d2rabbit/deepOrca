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
    if (selected === "openwiki")
      void api
        .wikiListPages()
        .then(setPages)
        .catch(() => setPages([]));
    if (selected === "codegraph")
      void api
        .codegraphList()
        .then(setWorkspaces)
        .catch(() => setWorkspaces([]));
  }, [selected]);

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
  const readArchmap = (path: string) => {
    void api
      .knowledgeReadArchmap(path)
      .then((content) => setArchView({ path, content }))
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

        {workspaces ? (
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
              <pre className="deck-srcpage">{page.content}</pre>
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
