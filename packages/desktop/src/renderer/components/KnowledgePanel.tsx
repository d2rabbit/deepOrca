import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";
import { api } from "../api";
import { useI18n, type MessageKey, type Translate } from "../i18n";
import { Button, IconMenuBars } from "../ui/index";
import type { ActionProgressEvent, KnowledgeStatusResponse, KnowledgeSymbol, WikiPageEntry } from "../../shared/ipc";
import { SymbolGraphView } from "./SymbolGraphView";
import { ErrorBoundary } from "./ErrorBoundary";
import { StreamdownView } from "./StreamdownView";
import { TocNav, useHeadingToc } from "./TocNav";
import { buildStageVerb, formatBuildDuration } from "./KnowledgeBuildProgress";
import { FRONTMATTER_RE } from "../lib/frontmatter";
import { wikiStorePath } from "../lib/generated-paths";
import { useBuildJobs } from "../hooks/useBuildJobs";

/**
 * Knowledge tab body (specs/index-knowledge-rework T3.3): three sub-tabs —
 * Wiki / AGENTS / 架构图 — for ONE workspace root. Engine names never appear
 * (naming redline): the UI says Wiki, not OpenWiki.
 *
 * R3-5: Wiki pages and symbols render INLINE (master–detail) — clicking a
 * page shows the rendered markdown next to the list, clicking a symbol shows
 * its signature card — the editor is a secondary "open file" action, no
 * longer a required round-trip. Architecture maps render in the embedded
 * A2UI preview pane.
 */

type Props = {
  root: string;
  /** App light/dark — synced into the archify viewer via ?theme= so the
   *  embedded board blends with the surrounding surface (2026-08-30). */
  appearance?: "light" | "dark";
  onOpenFile: (path: string) => void;
  /** Flow bridge: quote a wiki page into the chat composer as an @-mention. */
  onQuoteToChat?: (root: string, path: string, title: string) => void;
};

type SubTab = "wiki" | "agents" | "archmaps" | "symbols";

const SUB_TABS: Array<{ key: SubTab; labelKey: MessageKey }> = [
  { key: "wiki", labelKey: "index.wikiTab" },
  { key: "agents", labelKey: "index.agentsTab" },
  { key: "archmaps", labelKey: "index.archmapsTab" },
  { key: "symbols", labelKey: "index.symbolsTab" },
];

/** Localized relative time for the wiki tree / artifact meta ("3 小时" / "3h"). */
function formatRelative(iso: string | undefined, t: Translate): string {
  if (!iso) return t("index.freshness.never");
  const delta = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(delta) || delta < 0) return t("index.freshness.never");
  const mins = Math.floor(delta / 60000);
  if (mins < 1) return t("index.freshness.justNow");
  if (mins < 60) return t("index.freshness.minutes", { n: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t("index.freshness.hours", { n: hours });
  return t("index.freshness.days", { n: Math.floor(hours / 24) });
}

/**
 * Standard wiki page header (i18n-agnostic, content-driven): the page's
 * frontmatter `title`, shown as the document header. When the body then opens
 * with an H1 carrying the same text, that H1 is dropped so the title is not
 * rendered twice (frontmatter title IS the page title in wiki convention).
 */
function extractWikiPageMeta(raw: string): { title: string | null; description: string | null; body: string } {
  const fm = raw.match(FRONTMATTER_RE);
  const fmTitle = fm?.[1]
    .match(/^title:[ \t]*(.+)$/m)?.[1]
    ?.trim()
    .replace(/^["']|["']$/g, "");
  const fmDesc =
    fm?.[1]
      .match(/^description:[ \t]*(.+)$/m)?.[1]
      ?.trim()
      .replace(/^["']|["']$/g, "") ?? null;
  if (!fm || !fmTitle) return { title: null, description: null, body: raw };
  const body = raw.slice(fm[0].length);
  const h1 = body.match(/^#[ \t]*(.+)$/m);
  if (h1) {
    const normalize = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
    if (normalize(h1[1]).includes(normalize(fmTitle)) || normalize(fmTitle).includes(normalize(h1[1]))) {
      return { title: fmTitle, description: fmDesc, body: body.replace(h1[0], "") };
    }
  }
  return { title: fmTitle, description: fmDesc, body };
}

type WikiPage = WikiPageEntry;

/** Group symbols by kind, largest groups first. */
function groupSymbols(syms: KnowledgeSymbol[]): Array<[string, KnowledgeSymbol[]]> {
  const groups: Record<string, KnowledgeSymbol[]> = {};
  for (const sym of syms) {
    (groups[sym.kind] ??= []).push(sym);
  }
  return Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
}

/** Stable identity of a listed symbol (the row key) — used to keep the
 *  selection across result refreshes, where object identity changes. */
function symbolKey(s: KnowledgeSymbol): string {
  return `${s.kind}:${s.filePath}:${s.startLine}:${s.name}`;
}

export function KnowledgePanel({ root, appearance, onOpenFile, onQuoteToChat }: Props): JSX.Element {
  const { t } = useI18n();
  const [status, setStatus] = useState<KnowledgeStatusResponse | null>(null);
  const [sub, setSub] = useState<SubTab>("wiki");
  const [wikiPages, setWikiPages] = useState<WikiPage[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [agentsContent, setAgentsContent] = useState<string | null>(null);
  const [symbols, setSymbols] = useState<KnowledgeSymbol[]>([]);
  const [symbolQuery, setSymbolQuery] = useState("");
  // Symbol navigation history — LIFTED from SymbolGraphView (real-machine
  // feedback round 5) so Back/Home live in the panel toolbar and work for
  // BOTH the graph and the list view. Typing in the search box does NOT push
  // history; deliberate navigation (node recenter / home / back) does.
  const [symbolHistory, setSymbolHistory] = useState<string[]>([]);
  const navigateSymbol = useCallback(
    (q: string) => {
      setSymbolHistory((h) => [...h, symbolQuery]);
      setSymbolQuery(q);
    },
    [symbolQuery]
  );
  const symbolBack = useCallback(() => {
    const prev = symbolHistory[symbolHistory.length - 1];
    if (prev === undefined) return;
    setSymbolQuery(prev);
    setSymbolHistory((h) => h.slice(0, -1));
  }, [symbolHistory]);
  const symbolHome = useCallback(() => {
    setSymbolHistory([]);
    setSymbolQuery("");
  }, []);
  // R3-5 inline master–detail state.
  const [wikiSel, setWikiSel] = useState<string | null>(null);
  const [wikiContent, setWikiContent] = useState<string | null>(null);
  const [wikiLoading, setWikiLoading] = useState(false);
  const [symbolSel, setSymbolSel] = useState<KnowledgeSymbol | null>(null);
  // R3-6: symbols default to the GRAPH view (display-only relationship
  // graph); the grouped list stays one toggle away.
  const [symbolView, setSymbolView] = useState<"graph" | "list">("graph");
  // Live build state for THIS workspace — the knowledge tab is where users
  // look after clicking "build" in the rail, and it used to show nothing.
  const buildJobs = useBuildJobs();
  const activeJob = buildJobs.find((j) => j.root === root && j.running);

  // Last-writer-wins guard for root-scoped data: bumped on every reload
  // start AND on root change, so an in-flight response from the previous
  // workspace can never overwrite the new root's state (same seq pattern as
  // the symbol search below).
  const dataSeqRef = useRef(0);

  // R3-5: reset inline selections when the workspace root changes. The
  // previous root's LISTS must go too: keeping wikiPages would let the
  // auto-select effect below re-fill wikiSel with A's first page while B's
  // reload is in flight, leaving the wiki preview in a persistent
  // "read failed" state (P1 audit fix). Stale symbols would render old-root
  // rows that click into `${newRoot}/${oldPath}`. Declared BEFORE the reload
  // effect on purpose: effects run in declaration order, so the seq bump
  // here lands before the new root's reload captures its ticket — otherwise
  // the fresh reload itself would be invalidated on every switch.
  useEffect(() => {
    setWikiPages([]);
    setWikiSel(null);
    setWikiContent(null);
    setSymbols([]);
    setSymbolQuery("");
    setSymbolSel(null);
    setStatus(null);
    setPreview(null);
    setSymbolHistory([]);
    dataSeqRef.current++;
  }, [root]);

  const reload = useCallback(async () => {
    const mySeq = ++dataSeqRef.current;
    try {
      const s = await api.knowledgeStatus(root);
      if (mySeq === dataSeqRef.current) setStatus(s);
    } catch {
      if (mySeq === dataSeqRef.current) setStatus(null);
    }
    try {
      const pages = await api.wikiListPages(root);
      if (mySeq === dataSeqRef.current) setWikiPages(pages);
    } catch {
      if (mySeq === dataSeqRef.current) setWikiPages([]);
    }
    try {
      const res = await api.knowledgeReadAgents(root);
      if (mySeq === dataSeqRef.current) setAgentsContent(res.ok ? res.content : null);
    } catch {
      if (mySeq === dataSeqRef.current) setAgentsContent(null);
    }
  }, [root]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Refresh when a build for this root completes.
  useEffect(() => {
    const off = api.onActionProgress((event: ActionProgressEvent) => {
      if (event.actionId !== "knowledge.buildComplete") return;
      if ((event.data as { root?: string } | undefined)?.root !== root) return;
      void reload();
    });
    return off;
  }, [root, reload]);

  // While a build runs for this root, keep the wiki page list LIVE — pages
  // are written incrementally, and the user must SEE the run advance and
  // finish instead of guessing from a stale list (real-machine feedback).
  const building = activeJob != null;
  useEffect(() => {
    if (!building) return;
    const timer = setInterval(() => {
      const mySeq = dataSeqRef.current;
      void (async () => {
        try {
          const pages = await api.wikiListPages(root);
          // A root change or a newer reload must win over this tick's snapshot.
          if (mySeq === dataSeqRef.current) setWikiPages(pages);
        } catch {
          // Keep the last list; the next tick retries.
        }
      })();
    }, 8000);
    return () => clearInterval(timer);
  }, [building, root]);

  // Symbols sub-tab: debounced search over the index. The seq guard drops
  // stale responses — a slow earlier query must not overwrite a newer one.
  const symbolSeqRef = useRef(0);
  useEffect(() => {
    const mySeq = ++symbolSeqRef.current;
    const timer = setTimeout(async () => {
      try {
        const result = await api.knowledgeListSymbols(root, symbolQuery || undefined);
        if (mySeq === symbolSeqRef.current) setSymbols(result);
      } catch {
        if (mySeq === symbolSeqRef.current) setSymbols([]);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      // Same rationale as FileMentionMenu's reqId guard: reading the CURRENT
      // ref value and bumping it is the invalidation mechanism — copying it
      // to a local would increment a stale counter and stop invalidating.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      symbolSeqRef.current++;
    };
  }, [root, symbolQuery]);

  // List-view auto-select (real-machine 2026-08-28: the pane opened with a
  // dead "select a symbol" hint on the right while the first group sat fully
  // loaded) — same product rule as the arch map's 直出: the detail follows
  // the results. Sticky while the current symbol survives the result set
  // (rebound to the FRESH object so the row highlight's reference equality
  // keeps working); a query that drops it moves the selection to the new
  // head; no results clears it back to the empty-state hint.
  useEffect(() => {
    setSymbolSel((prev) => {
      if (symbols.length === 0) return null;
      if (prev) {
        const still = symbols.find((s) => symbolKey(s) === symbolKey(prev));
        if (still) return still;
      }
      return symbols[0];
    });
  }, [symbols]);

  // 架构图直出：auto-select the NEWEST artifact and show its LAUNCHER pane
  // (archify era 2026-08-29: the interactive map opens in the host's sandboxed
  // preview window — this pane launches it). Reselect whenever the current
  // pick vanishes (deleted or replaced by a fresh scan).
  const archFilePaths = (status?.archmaps.files ?? []).map((f) => f.path).join("|");
  // Artifact pager neighbours (Oink: pager shares the tree's one order —
  // here: mtime-desc, the exact order the auto-select newest logic uses).
  const archNeighbours = useMemo(() => {
    const ordered = [...(status?.archmaps.files ?? [])].sort((a, b) => b.mtime.localeCompare(a.mtime));
    const idx = ordered.findIndex((f) => f.path === preview);
    return {
      prevName: idx >= 0 && idx < ordered.length - 1 ? ordered[idx + 1].name : null,
      prevPath: idx >= 0 && idx < ordered.length - 1 ? ordered[idx + 1].path : null,
      nextName: idx > 0 ? ordered[idx - 1].name : null,
      nextPath: idx > 0 ? ordered[idx - 1].path : null,
    };
  }, [status?.archmaps.files, preview]);

  useEffect(() => {
    const files = status?.archmaps.files ?? [];
    if (files.length === 0) {
      setPreview(null);
      return;
    }
    if (!files.some((f) => f.path === preview)) {
      const newest = [...files].sort((a, b) => b.mtime.localeCompare(a.mtime))[0];
      setPreview(newest.path);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the file set + current pick
  }, [archFilePaths, preview]);

  // Reading order for prev/next paging (Oink shell idea: the sidebar tree and
  // the pager share ONE root and order). Pages before dirs at EVERY level:
  // root-level overview pages (index/quickstart) read first, then sections —
  // the same order WikiTree renders (real-machine 2026-08-27: dirs-first sank
  // Index/综合说明 to the bottom and made Index the pager's LAST page).
  const wikiOrder = useMemo(() => {
    const root = buildWikiTree(wikiPages);
    const order: string[] = [];
    const walk = (dir: { dirs: Map<string, ReturnType<typeof buildWikiTree>>; pages: WikiPage[] }): void => {
      for (const page of dir.pages) order.push(page.path);
      for (const d of [...dir.dirs.values()].sort((a, b) => a.name.localeCompare(b.name))) walk(d);
    };
    walk(root);
    return order;
  }, [wikiPages]);
  const wikiNeighbours = useMemo(() => {
    const idx = wikiOrder.indexOf(wikiSel ?? "");
    const at = (i: number): WikiPage | null => {
      if (i < 0 || i >= wikiOrder.length) return null;
      const path = wikiOrder[i];
      return wikiPages.find((pg) => pg.path === path) ?? { title: path.split("/").pop() ?? path, path };
    };
    return { prev: idx > 0 ? at(idx - 1) : null, next: idx >= 0 ? at(idx + 1) : null };
  }, [wikiOrder, wikiSel, wikiPages]);

  // Inline wiki preview: auto-select the landing page once, load on selection.
  // Prefer the wiki's index page (the 前言/导航), else the first page in the
  // tree's reading order — the raw list's first entry is a subdirectory page.
  useEffect(() => {
    if (!wikiSel && wikiPages.length > 0) {
      // wikiOrder[0] (NOT wikiPages[0]): the raw list is path-sorted, so its
      // first entry is a subdirectory page even when root pages exist.
      const indexPage = wikiPages.find((pg) => /^index\.md$/i.test(pg.path));
      const firstInOrder = wikiPages.find((pg) => pg.path === wikiOrder[0]);
      setWikiSel((indexPage ?? firstInOrder ?? wikiPages[0]).path);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot default selection
  }, [wikiPages, wikiSel]);

  useEffect(() => {
    if (!wikiSel) return;
    let alive = true;
    setWikiLoading(true);
    setWikiContent(null);
    (async () => {
      try {
        const res = await api.editorReadFile(wikiStorePath(root, wikiSel));
        if (!alive) return;
        setWikiContent(res.ok && !res.binary ? (res.content ?? "") : null);
      } catch {
        if (alive) setWikiContent(null);
      } finally {
        if (alive) setWikiLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [root, wikiSel]);

  return (
    <div className="ui-knowledge-view">
      <div className="ui-knowledge-subtabs">
        {SUB_TABS.map(({ key, labelKey }) => (
          <button
            key={key}
            type="button"
            className={`ui-knowledge-subtab subtab-${key}${sub === key ? " active" : ""}`}
            onClick={() => setSub(key)}
          >
            {t(labelKey)}
          </button>
        ))}
      </div>
      {/* Slim status line only — the full stage checklist lives UNDER the
          workspace's row in the left rail. The trailing live line carries the
          freshest heartbeat (page counts, 完成标记) so the tab itself states
          whether wiki is still working (real-machine feedback). */}
      {activeJob ? (
        <div className="ui-knowledge-buildbar" role="status">
          <span className="ui-spinner" aria-hidden />
          <span className="ui-knowledge-buildbar-label">
            {(() => {
              const running = activeJob.stages.find((s) => s.status === "running");
              const label = running ? buildStageVerb(running, activeJob.mode, t) : t("index.building");
              return `${label} · ${formatBuildDuration(activeJob.startedAt, undefined, Date.now())}`;
            })()}
          </span>
          {(() => {
            const running = activeJob.stages.find((s) => s.status === "running");
            return running?.detail ? <span className="ui-knowledge-buildbar-live">{running.detail}</span> : null;
          })()}
        </div>
      ) : null}
      <div className="ui-knowledge-body">
        <ErrorBoundary>
          {sub === "wiki" ? (
            wikiPages.length === 0 ? (
              <div className="ui-side-panel-empty">{t("index.wikiEmpty")}</div>
            ) : (
              <div className="ui-knowledge-wiki">
                <div className="ui-knowledge-wiki-list">
                  <WikiTree
                    pages={wikiPages}
                    selected={wikiSel}
                    onSelect={(path) => setWikiSel(path)}
                    formatRelative={(iso) => formatRelative(iso, t)}
                  />
                </div>
                <div className="ui-knowledge-wiki-preview">
                  {wikiSel ? (
                    wikiLoading ? (
                      <div className="ui-side-panel-empty">
                        <span className="ui-spinner" />
                      </div>
                    ) : wikiContent != null ? (
                      <WikiPageView
                        raw={wikiContent}
                        onOpenFile={() => onOpenFile(wikiStorePath(root, wikiSel))}
                        openLabel={t("index.openInEditor")}
                        onQuote={onQuoteToChat ? (title) => onQuoteToChat(root, wikiSel, title) : undefined}
                        quoteLabel={t("index.quoteWiki")}
                        fallbackTitle={wikiSel}
                        prev={wikiNeighbours.prev}
                        next={wikiNeighbours.next}
                        onNavigate={(path) => setWikiSel(path)}
                        tocLabel={t("index.wikiToc")}
                      />
                    ) : (
                      <div className="ui-side-panel-empty">{t("index.wikiPreviewFailed")}</div>
                    )
                  ) : (
                    <div className="ui-side-panel-empty">{t("index.wikiPickHint")}</div>
                  )}
                </div>
              </div>
            )
          ) : sub === "agents" ? (
            <AgentsDocView
              content={agentsContent}
              onOpenFile={() => onOpenFile(`${root}/AGENTS.md`)}
              openLabel={t("index.openAgents")}
              missingLabel={t("index.agentsMissing")}
              tocLabel={t("index.wikiToc")}
            />
          ) : sub === "symbols" ? (
            <div className="ui-knowledge-symbols">
              <div className="ui-knowledge-symbol-toolbar">
                <input
                  className="ui-knowledge-symbol-search"
                  type="text"
                  value={symbolQuery}
                  placeholder={t("index.symbolSearch")}
                  onChange={(e) => setSymbolQuery(e.target.value)}
                />
                <button
                  type="button"
                  className="ui-knowledge-symbol-navbtn"
                  disabled={symbolHistory.length === 0}
                  title={
                    symbolHistory.length > 0
                      ? t("symbols.backTo", { name: symbolHistory[symbolHistory.length - 1] || t("symbols.global") })
                      : t("symbols.topmost")
                  }
                  onClick={symbolBack}
                >
                  ← {t("symbols.back")}
                </button>
                <button
                  type="button"
                  className="ui-knowledge-symbol-navbtn"
                  title={t("symbols.homeTitle")}
                  disabled={symbolQuery === "" && symbolHistory.length === 0}
                  onClick={symbolHome}
                >
                  ⌂ {t("symbols.home")}
                </button>
                <div className="ui-knowledge-symbol-viewtoggle" role="group">
                  <button
                    type="button"
                    className={symbolView === "graph" ? "active" : ""}
                    aria-pressed={symbolView === "graph"}
                    onClick={() => setSymbolView("graph")}
                  >
                    ◈ {t("index.symbolViewGraph")}
                  </button>
                  <button
                    type="button"
                    className={symbolView === "list" ? "active" : ""}
                    aria-pressed={symbolView === "list"}
                    onClick={() => setSymbolView("list")}
                  >
                    <IconMenuBars /> {t("index.symbolViewList")}
                  </button>
                </div>
              </div>
              {symbolView === "graph" ? (
                <SymbolGraphView root={root} query={symbolQuery} onRecenter={navigateSymbol} />
              ) : status && status.codegraph.state !== "indexed" ? (
                <div className="ui-side-panel-empty">{t("index.symbolsEmpty")}</div>
              ) : symbols.length === 0 ? (
                <div className="ui-side-panel-empty">{t("index.symbolsNoMatch")}</div>
              ) : (
                <div className="ui-symbol-graph-scroll">
                  <div className="ui-knowledge-wiki">
                    <div className="ui-knowledge-wiki-list">
                      {groupSymbols(symbols).map(([kind, group]) => (
                        <div key={kind} className="ui-knowledge-wiki-group">
                          <div className="ui-knowledge-wiki-group-label">
                            {kind} <span className="ui-knowledge-wiki-group-count">{group.length}</span>
                          </div>
                          {group.map((sym) => (
                            <button
                              key={`${sym.kind}:${sym.filePath}:${sym.startLine}:${sym.name}`}
                              type="button"
                              className={`ui-knowledge-item${symbolSel && symbolKey(symbolSel) === symbolKey(sym) ? " selected" : ""}`}
                              onClick={() => setSymbolSel(sym)}
                              title={`${sym.kind} · ${sym.filePath}:${sym.startLine}`}
                            >
                              <span className="ui-knowledge-item-name">{sym.name}</span>
                              <span className="ui-knowledge-item-meta">
                                {sym.filePath.split("/").pop()}:{sym.startLine}
                              </span>
                            </button>
                          ))}
                        </div>
                      ))}
                    </div>
                    <div className="ui-knowledge-wiki-preview">
                      {symbolSel ? (
                        <div className="ui-knowledge-symbol-detail">
                          <div className="ui-knowledge-symbol-detail-head">
                            <span className="ui-knowledge-sym-kind">{symbolSel.kind}</span>
                            <strong className="ui-knowledge-symbol-detail-name">{symbolSel.name}</strong>
                          </div>
                          {symbolSel.signature ? (
                            <pre className="ui-knowledge-symbol-signature">{symbolSel.signature}</pre>
                          ) : null}
                          <div className="ui-knowledge-symbol-location">
                            {symbolSel.filePath}:{symbolSel.startLine}
                          </div>
                          <div className="ui-knowledge-preview-actions">
                            <Button
                              size="sm"
                              variant="subtle"
                              onClick={() => onOpenFile(`${root}/${symbolSel.filePath}`)}
                            >
                              {t("index.openInEditor")}
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="ui-side-panel-empty">{t("index.symbolPickHint")}</div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="ui-knowledge-arch ui-arch-board">
              {(status?.archmaps.files ?? []).length === 0 ? (
                <div className="ui-side-panel-empty">{t("index.archmapsEmpty")}</div>
              ) : (
                <ArchBoard
                  files={status?.archmaps.files ?? []}
                  selected={preview}
                  appearance={appearance}
                  onSelect={(p) => setPreview(p)}
                  onOpenFile={onOpenFile}
                  neighbours={archNeighbours}
                />
              )}
            </div>
          )}
        </ErrorBoundary>
      </div>
    </div>
  );
}

/** Delegated code-copy for the wiki preview (same contract as chat). */
/** AGENTS document view — same reading shell as wiki pages (Oink adaptation):
 *  centered 860 column + on-this-page TOC with scrollspy on wide panes. */
function AgentsDocView({
  content,
  onOpenFile,
  openLabel,
  missingLabel,
  tocLabel,
}: {
  content: string | null;
  onOpenFile: () => void;
  openLabel: string;
  missingLabel: string;
  tocLabel: string;
}): JSX.Element {
  const docRef = useRef<HTMLDivElement>(null);
  const { toc, activeId } = useHeadingToc(docRef, content, {
    idPrefix: "agents",
    scrollerClosest: ".ui-knowledge-body",
  });
  if (content == null) {
    return (
      <div className="ui-knowledge-agents">
        <div className="ui-side-panel-empty">{missingLabel}</div>
      </div>
    );
  }
  return (
    <div className="ui-knowledge-agents">
      <div className="ui-knowledge-agents-actions">
        <Button size="sm" variant="subtle" onClick={onOpenFile}>
          {openLabel}
        </Button>
      </div>
      <div className="ui-wiki-columns">
        <div ref={docRef}>
          <StreamdownView className="ui-knowledge-agents-md ui-md" markdown={content} />
        </div>
        <TocNav
          entries={toc}
          activeId={activeId}
          label={tocLabel}
          onJump={(id) => docRef.current?.querySelector(`#${CSS.escape(id)}`)?.scrollIntoView({ behavior: "smooth" })}
        />
      </div>
    </div>
  );
}

/**
 * Wiki reading shell (ideas adopted from the Oink Hugo theme's shell/nav
 * contracts — pgsty/oink.pgsty.com, Apache-2.0): breadcrumb + frontmatter
 * description in the hero, a sticky on-this-page TOC with scrollspy beside
 * the reading column, and tree-order prev/next paging at the foot. Our
 * openwiki pages already carry title/description/tags front matter; the
 * shell is what turns those pages into a *site* instead of a file dump.
 */
function WikiPageView({
  raw,
  onOpenFile,
  openLabel,
  onQuote,
  quoteLabel,
  fallbackTitle,
  prev,
  next,
  onNavigate,
  tocLabel,
}: {
  raw: string;
  onOpenFile: () => void;
  openLabel: string;
  /** Quote this page into the chat composer (carries the extracted title). */
  onQuote?: (title: string) => void;
  quoteLabel: string;
  /** Page path — the basename becomes the quote title when the page has no
   *  frontmatter title (quote must not silently disappear for those pages). */
  fallbackTitle: string;
  /** Tree-order neighbours (Oink: sidebar and pager share one root/order). */
  prev: WikiPage | null;
  next: WikiPage | null;
  onNavigate: (path: string) => void;
  tocLabel: string;
}): JSX.Element {
  const { t } = useI18n();
  const { title, description, body } = useMemo(() => extractWikiPageMeta(raw), [raw]);
  const quoteTitle = title ?? fallbackTitle.split("/").pop() ?? "wiki";
  const docRef = useRef<HTMLDivElement>(null);
  const { toc, activeId } = useHeadingToc(docRef, body, { idPrefix: "wiki" });
  const jump = (id: string): void => {
    docRef.current?.querySelector(`#${CSS.escape(id)}`)?.scrollIntoView({ behavior: "smooth" });
  };

  const crumb = fallbackTitle.split("/").filter(Boolean);

  return (
    <div className="ui-wiki-page">
      {/* 横幅只保留动作（user ask 2026-09-03）：标题/简介/面包屑全部
          下沉到正文头部，跟随正文滚动 —— 元数据来自 front matter，
          纯渲染组装，不影响文档生成物。 */}
      <div className="ui-wiki-page-head">
        <span className="ui-wiki-page-icon" aria-hidden>
          ▤
        </span>
        {onQuote ? (
          <Button size="sm" variant="primary" className="ui-wiki-page-quote" onClick={() => onQuote(quoteTitle)}>
            {quoteLabel}
          </Button>
        ) : null}
        <Button size="sm" variant="subtle" onClick={onOpenFile}>
          {openLabel}
        </Button>
      </div>
      <div className="ui-wiki-columns">
        <div ref={docRef} className="ui-wiki-doc-wrap">
          <div className="ui-wiki-doc-head">
            {crumb.length > 1 ? (
              <div className="ui-wiki-breadcrumb" aria-hidden>
                {crumb.slice(0, -1).map((part, i) => (
                  <span key={i} className="ui-wiki-breadcrumb-part">
                    {part}
                  </span>
                ))}
              </div>
            ) : null}
            {title ? <h1 className="ui-wiki-page-title">{title}</h1> : null}
            {description ? <div className="ui-wiki-page-desc">{description}</div> : null}
          </div>
          <StreamdownView className="ui-knowledge-agents-md ui-md ui-wiki-doc" markdown={body} />
        </div>
        <TocNav entries={toc} activeId={activeId} label={tocLabel} onJump={jump} />
      </div>
      {prev || next ? (
        <div className="ui-wiki-pager">
          {prev ? (
            <button type="button" className="ui-wiki-pager-btn" onClick={() => onNavigate(prev.path)}>
              <span className="ui-wiki-pager-dir">← {t("index.wikiPrev")}</span>
              <span className="ui-wiki-pager-title">{prev.title}</span>
            </button>
          ) : (
            <span />
          )}
          {next ? (
            <button type="button" className="ui-wiki-pager-btn next" onClick={() => onNavigate(next.path)}>
              <span className="ui-wiki-pager-dir">{t("index.wikiNext")} →</span>
              <span className="ui-wiki-pager-title">{next.title}</span>
            </button>
          ) : (
            <span />
          )}
        </div>
      ) : null}
    </div>
  );
}

/** pathToFileURL-equivalent for the renderer (no node:url in the browser
 *  bundle): POSIX → file:///<encoded>, Windows → file:///C:/<encoded> — the
 *  bare `file://${path}` form parses Windows drive letters as the URL host
 *  and truncates at `#`/`%` (repo discipline: ipc-security.ts). */
function toFileUrl(p: string): string {
  const isWin = /^[A-Za-z]:[\\/]/.test(p);
  const norm = p.replace(/\\/g, "/");
  const encoded = norm
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  return isWin ? `file:///${encoded}` : `file://${encoded.startsWith("/") ? "" : "/"}${encoded}`;
}

/**
 * Architecture BOARD (user decision 2026-08-29: 嵌入自家画板 + 一级直出 +
 * 子级类似索引关系图动态绘制):
 *   - HERO (the newest `architecture` artifact) embeds archify's validated
 *     HTML INLINE via iframe — the first level is directly expanded when the
 *     tab opens, no launcher, no external window;
 *   - SUB-LEVEL artifacts (module/dataflow/sequence/…) render with OUR
 *     dynamic SVG map (ArchifyMiniMap, symbol-graph interaction grammar);
 *   - the rail lists every artifact; selecting swaps the pane (hero embeds,
 *     sub-levels draw); a secondary button still opens the standalone window.
 */
function ArchBoard({
  files,
  selected,
  appearance,
  onSelect,
  onOpenFile: _onOpenFile,
  neighbours,
}: {
  files: Array<{ name: string; path: string; mtime: string; type?: string; htmlPath?: string }>;
  selected: string | null;
  appearance?: "light" | "dark";
  onSelect: (path: string) => void;
  onOpenFile: (path: string) => void;
  neighbours: { prevName: string | null; prevPath: string | null; nextName: string | null; nextPath: string | null };
}): JSX.Element {
  const { t } = useI18n();
  // Hero = newest architecture artifact; fall back to newest of any type.
  const heroPath = useMemo(() => {
    const archs = files.filter((f) => f.type === "architecture");
    const pool = archs.length > 0 ? archs : files;
    return [...pool].sort((a, b) => b.mtime.localeCompare(a.mtime))[0]?.path ?? null;
  }, [files]);
  const current = selected ?? heroPath;
  const currentEntry = files.find((f) => f.path === current) ?? null;
  const [rendered, setRendered] = useState<string | null>(null);
  // In-app fullscreen overlay (user ask 2026-08-30: A2UI 动态弹窗, NOT an OS
  // window) — the same embed URL expanded to cover the app, ESC to dismiss.
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Theme the embed loads with — frozen at mount so an appearance toggle does
  // NOT rewrite the iframe src (that would reload the diagram and drop the
  // reader's pan/zoom); live changes ride the deeporca-theme postMessage
  // channel handled by the host viewer patch instead.
  // Theme the embed loads with — captured at gate resolution so an appearance
  // toggle NEVER rewrites the iframe src (a src change navigates the frame,
  // dropping the reader's pan/zoom). Live changes ride the deeporca-theme
  // postMessage channel handled by the host viewer patch instead.
  const appearanceRef = useRef(appearance);
  appearanceRef.current = appearance;
  const [embedSrc, setEmbedSrc] = useState<string | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  useEffect(() => {
    // Fire on appearance change AND after each fresh frame (embedSrc switch):
    // fresh frames already carry the theme in their src, so this is a no-op
    // for them — it exists so a mid-load toggle is re-asserted.
    if (!appearance) return;
    frameRef.current?.contentWindow?.postMessage({ type: "deeporca-theme", theme: appearance }, "*");
  }, [appearance, embedSrc]);

  // ALWAYS run the render gate on selection (review round 7, security): the
  // host verifies the deliver-receipt (sha sidecar) and re-renders anything
  // it did not produce — an htmlPath that merely EXISTS never embeds. Valid
  // receipts take the hash-check fast path (no spawn).
  useEffect(() => {
    setErr(null);
    // Reset the on-demand result whenever the SELECTION changes — a stale
    // htmlPath from artifact A would flash A's iframe under B's title
    // (review round 7) and keep the ⧉ button pointing at A.
    setRendered(null);
    setEmbedSrc(null);
    if (!currentEntry) {
      setBusy(false);
      return;
    }
    let alive = true;
    setBusy(true);
    (async () => {
      const res = await api.knowledgeArchRender(currentEntry.path);
      if (!alive) return;
      if (res.ok && res.htmlPath) {
        setRendered(res.htmlPath);
        setEmbedSrc(
          `${toFileUrl(res.htmlPath)}?present=1${appearanceRef.current ? `&theme=${appearanceRef.current}` : ""}`
        );
      } else setErr(res.error ?? t("app.requestFailed"));
    })().finally(() => alive && setBusy(false));
    return () => {
      alive = false;
    };
  }, [currentEntry?.path, currentEntry?.htmlPath, t]); // eslint-disable-line react-hooks/exhaustive-deps -- entry identity changes per list refresh; only path/htmlPath drive the gate

  // Render-phase reset (red-team A-1): a selection switch must drop the
  // previous artifact's embed in the SAME commit as the title change — the
  // effect-based reset alone painted one committed frame of artifact A's
  // iframe under artifact B's header.
  const lastGatePath = useRef<string | null>(null);
  if ((currentEntry?.path ?? null) !== lastGatePath.current) {
    lastGatePath.current = currentEntry?.path ?? null;
    if (rendered) setRendered(null);
    if (embedSrc) setEmbedSrc(null);
  }

  if (!currentEntry) return <div className="ui-side-panel-empty">{t("index.archmapsEmpty")}</div>;
  // Trust ONLY gate output (receipt-verified) — a bare htmlPath could be
  // model-authored HTML (review round 7, security).
  const htmlSrc = rendered ?? undefined;
  const title = currentEntry.name
    .replace(/^arch-/, "")
    .replace(/\.(architecture|workflow|sequence|dataflow|lifecycle)$/, "");

  return (
    <div className="ui-arch-board">
      <div className="ui-arch-board-head">
        <span className="ui-arch-board-title">◈ {title}</span>
        <span className="ui-arch-board-meta">{currentEntry.type ?? "diagram"}</span>
        <div className="ui-arch-pager">
          {neighbours.prevPath ? (
            <button
              type="button"
              title={neighbours.prevName ?? undefined}
              aria-label={t("index.wikiPrev")}
              onClick={() => onSelect(neighbours.prevPath ?? "")}
            >
              ←
            </button>
          ) : null}
          {neighbours.nextPath ? (
            <button
              type="button"
              title={neighbours.nextName ?? undefined}
              aria-label={t("index.wikiNext")}
              onClick={() => onSelect(neighbours.nextPath ?? "")}
            >
              →
            </button>
          ) : null}
        </div>
      </div>
      {/* Hero: iframe primary (archify validated render) + graph drill-down
          (SymbolGraphView grammar) side by side — the user sees BOTH the
          polished render AND the navigable component graph. */}
      <div className="ui-arch-board-pane">
        {busy ? (
          <div className="ui-knowledge-preview-loading" />
        ) : err ? (
          <div className="ui-knowledge-preview-error">{err}</div>
        ) : htmlSrc ? (
          // Inline embed of archify's validated, self-contained artifact.
          // sandbox: scripts only (round 7) — the viewer runtime works
          // without same-origin; the framed doc cannot touch app storage.
          <iframe
            key={htmlSrc}
            ref={frameRef}
            // Mid-load theme toggles post into a frame whose listener isn't
            // installed yet and are lost — re-assert from the latest
            // appearance once the document is actually live.
            onLoad={() => {
              const theme = appearanceRef.current;
              const w = frameRef.current?.contentWindow;
              if (theme && w) w.postMessage({ type: "deeporca-theme", theme }, "*");
            }}
            className="ui-arch-board-frame"
            // present=1 = the mode from the user's correct reference (图2):
            // SVG fills the frame, archify's internal interactions (node
            // click → SEMANTIC PASSPORT panel near the node) work as the
            // vendored viewer designed them.
            // embedSrc is frozen per gate resolution — appearance toggles
            // never mutate this src (they postMessage instead), so the
            // reader's pan/zoom survives a theme switch.
            src={embedSrc ?? undefined}
            // No allow-same-origin (review round 7): the artifact is
            // self-contained and needs no same-origin resources — the
            // scripts+same-origin pair would let a hostile framed doc reach
            // into same-origin storage. Scripts alone keep the viewer alive.
            sandbox="allow-scripts"
            title={title}
          />
        ) : null}
      </div>
      {/* Sub-level rail: every OTHER artifact */}
      {files.length > 1 ? (
        <div className="ui-arch-board-rail">
          {files
            .filter((f) => f.path !== currentEntry.path)
            .map((f) => (
              <button
                type="button"
                key={f.path}
                className={`ui-arch-rail-chip${f.path === current ? " active" : ""}`}
                onClick={() => onSelect(f.path)}
              >
                <span className="sym-dot" style={{ background: f.type === "architecture" ? "#2dd4bf" : "#a78bfa" }} />
                <span className="ui-arch-rail-name">
                  {f.name.replace(/^arch-/, "").replace(/\.(architecture|workflow|sequence|dataflow|lifecycle)$/, "")}
                </span>
                <span className="ui-arch-rail-type">{f.type ?? ""}</span>
              </button>
            ))}
        </div>
      ) : null}
    </div>
  );
}

type WikiTreeDir = {
  name: string;
  dirs: Map<string, WikiTreeDir>;
  pages: WikiPage[];
};

function buildWikiTree(pages: WikiPage[]): WikiTreeDir {
  const root: WikiTreeDir = { name: "", dirs: new Map(), pages: [] };
  for (const page of pages) {
    const parts = page.path.split("/").filter(Boolean);
    const file = parts.pop();
    if (!file) continue;
    let dir = root;
    for (const part of parts) {
      let next = dir.dirs.get(part);
      if (!next) {
        next = { name: part, dirs: new Map(), pages: [] };
        dir.dirs.set(part, next);
      }
      dir = next;
    }
    dir.pages.push(page);
  }
  return root;
}

function WikiTreeDirView({
  dir,
  depth,
  selected,
  onSelect,
  formatRelative,
  defaultOpen,
}: {
  dir: WikiTreeDir;
  depth: number;
  selected: string | null;
  onSelect: (path: string) => void;
  formatRelative: (iso: string | undefined) => string;
  defaultOpen: boolean;
}): JSX.Element {
  const [open, setOpen] = useState(defaultOpen);
  const dirCount = dir.dirs.size + dir.pages.length;
  return (
    <div className="ui-wiki-tree-dir">
      <button
        type="button"
        className="ui-wiki-tree-dir-label"
        style={{ paddingLeft: 6 + depth * 12 }}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={`ui-wiki-tree-chevron${open ? " open" : ""}`}>▸</span>
        <span className="ui-wiki-tree-dir-name">{dir.name || "wiki"}</span>
        <span className="ui-wiki-tree-count">{dirCount}</span>
      </button>
      {open ? (
        <div className="ui-wiki-tree-children">
          {dir.pages.map((page) => (
            <button
              key={page.path}
              type="button"
              className={`ui-knowledge-item${selected === page.path ? " selected" : ""}`}
              style={{ paddingLeft: 18 + depth * 12 }}
              onClick={() => onSelect(page.path)}
              title={page.path}
            >
              <span className="ui-wiki-tree-file-icon">▦</span>
              <span className="ui-knowledge-item-name">{page.title}</span>
              <span className="ui-knowledge-item-meta">{formatRelative(page.mtime)}</span>
            </button>
          ))}
          {[...dir.dirs.values()].map((child) => (
            <WikiTreeDirView
              key={child.name}
              dir={child}
              depth={depth + 1}
              selected={selected}
              onSelect={onSelect}
              formatRelative={formatRelative}
              defaultOpen={depth < 1}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function WikiTree({
  pages,
  selected,
  onSelect,
  formatRelative,
}: {
  pages: WikiPage[];
  selected: string | null;
  onSelect: (path: string) => void;
  formatRelative: (iso: string | undefined) => string;
}): JSX.Element {
  const root = useMemo(() => buildWikiTree(pages), [pages]);
  return (
    <div className="ui-wiki-tree">
      {/* Pages before dirs at every level — root-level overview pages (Index /
          综合说明) pin to the TOP instead of sinking below the sections. The
          order must mirror the wikiOrder walk (pager shares it). */}
      {root.pages.map((page) => (
        <button
          key={page.path}
          type="button"
          className={`ui-knowledge-item${selected === page.path ? " selected" : ""}`}
          style={{ paddingLeft: 18 }}
          onClick={() => onSelect(page.path)}
          title={page.path}
        >
          <span className="ui-wiki-tree-file-icon">▦</span>
          <span className="ui-knowledge-item-name">{page.title}</span>
          <span className="ui-knowledge-item-meta">{formatRelative(page.mtime)}</span>
        </button>
      ))}
      {[...root.dirs.values()]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((dir) => (
          <WikiTreeDirView
            key={dir.name}
            dir={dir}
            depth={0}
            selected={selected}
            onSelect={onSelect}
            formatRelative={formatRelative}
            defaultOpen={true}
          />
        ))}
    </div>
  );
}
