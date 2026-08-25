import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";
import { api } from "../api";
import { useI18n, type MessageKey, type Translate } from "../i18n";
import { Button } from "../ui/index";
import { A2uiSurface } from "../a2ui/A2uiSurface";
import type { ActionProgressEvent, KnowledgeStatusResponse, KnowledgeSymbol } from "../../shared/ipc";
import { BASIC_CATALOG_ID } from "../../shared/a2ui-legacy";
import { SymbolGraphView } from "./SymbolGraphView";
import { ErrorBoundary } from "./ErrorBoundary";
import { StreamdownView } from "./StreamdownView";
import { MermaidDiagram } from "./MermaidDiagram";
import { buildStageVerb, formatBuildDuration } from "./KnowledgeBuildProgress";
import { FRONTMATTER_RE } from "../lib/frontmatter";
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
function extractWikiPageMeta(raw: string): { title: string | null; body: string } {
  const fm = raw.match(FRONTMATTER_RE);
  const fmTitle = fm?.[1]
    .match(/^title:[ \t]*(.+)$/m)?.[1]
    ?.trim()
    .replace(/^["']|["']$/g, "");
  if (!fm || !fmTitle) return { title: null, body: raw };
  const body = raw.slice(fm[0].length);
  const h1 = body.match(/^#[ \t]*(.+)$/m);
  if (h1) {
    const normalize = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
    if (normalize(h1[1]).includes(normalize(fmTitle)) || normalize(fmTitle).includes(normalize(h1[1]))) {
      return { title: fmTitle, body: body.replace(h1[0], "") };
    }
  }
  return { title: fmTitle, body };
}

type WikiPage = { title: string; path: string; mtime?: string };

/** Group symbols by kind, largest groups first. */
function groupSymbols(syms: KnowledgeSymbol[]): Array<[string, KnowledgeSymbol[]]> {
  const groups: Record<string, KnowledgeSymbol[]> = {};
  for (const sym of syms) {
    (groups[sym.kind] ??= []).push(sym);
  }
  return Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
}

export function KnowledgePanel({ root, onOpenFile, onQuoteToChat }: Props): JSX.Element {
  const { t } = useI18n();
  const [status, setStatus] = useState<KnowledgeStatusResponse | null>(null);
  const [sub, setSub] = useState<SubTab>("wiki");
  const [wikiPages, setWikiPages] = useState<Array<{ title: string; path: string; mtime?: string }>>([]);
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

  const reload = useCallback(async () => {
    try {
      setStatus(await api.knowledgeStatus(root));
    } catch {
      setStatus(null);
    }
    try {
      setWikiPages(await api.wikiListPages(root));
    } catch {
      setWikiPages([]);
    }
    try {
      const res = await api.knowledgeReadAgents(root);
      setAgentsContent(res.ok ? res.content : null);
    } catch {
      setAgentsContent(null);
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
      void (async () => {
        try {
          setWikiPages(await api.wikiListPages(root));
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

  // R3-5: reset inline selections when the workspace root changes.
  useEffect(() => {
    setWikiSel(null);
    setWikiContent(null);
    setSymbolSel(null);
    setPreview(null);
    setSymbolHistory([]);
  }, [root]);

  // 架构图直出：the map IS the first level — auto-select the NEWEST artifact
  // and render it full-pane. No artifact list, no "root"-style intermediate
  // concept (product decision); reselect whenever the current pick vanishes
  // (deleted or replaced by a fresh scan).
  const archFilePaths = (status?.archmaps.files ?? []).map((f) => f.path).join("|");
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

  // Inline wiki preview: auto-select the first page once, load on selection.
  useEffect(() => {
    if (!wikiSel && wikiPages.length > 0) {
      setWikiSel(wikiPages[0].path);
    }
  }, [wikiPages, wikiSel]);

  useEffect(() => {
    if (!wikiSel) return;
    let alive = true;
    setWikiLoading(true);
    setWikiContent(null);
    (async () => {
      try {
        const res = await api.editorReadFile(`${root}/openwiki/${wikiSel}`);
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
                        onOpenFile={() => onOpenFile(`${root}/openwiki/${wikiSel}`)}
                        openLabel={t("index.openInEditor")}
                        onQuote={onQuoteToChat ? (title) => onQuoteToChat(root, wikiSel, title) : undefined}
                        quoteLabel={t("index.quoteWiki")}
                        fallbackTitle={wikiSel}
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
            <div className="ui-knowledge-agents">
              {agentsContent != null ? (
                <>
                  <div className="ui-knowledge-agents-actions">
                    <Button size="sm" variant="subtle" onClick={() => onOpenFile(`${root}/AGENTS.md`)}>
                      {t("index.openAgents")}
                    </Button>
                  </div>
                  <StreamdownView className="ui-knowledge-agents-md ui-md" markdown={agentsContent} />
                </>
              ) : (
                <div className="ui-side-panel-empty">{t("index.agentsMissing")}</div>
              )}
            </div>
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
                <div className="ui-knowledge-symbol-viewtoggle">
                  <button
                    type="button"
                    className={symbolView === "graph" ? "active" : ""}
                    onClick={() => setSymbolView("graph")}
                  >
                    ◈ {t("index.symbolViewGraph")}
                  </button>
                  <button
                    type="button"
                    className={symbolView === "list" ? "active" : ""}
                    onClick={() => setSymbolView("list")}
                  >
                    ☰ {t("index.symbolViewList")}
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
                            className={`ui-knowledge-item${symbolSel === sym ? " selected" : ""}`}
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
              )}
            </div>
          ) : (
            <div className="ui-knowledge-arch">
              {(status?.archmaps.files ?? []).length === 0 ? (
                <div className="ui-side-panel-empty">{t("index.archmapsEmpty")}</div>
              ) : preview ? (
                <div className="ui-knowledge-preview ui-knowledge-preview-full">
                  <KnowledgeArchPreview
                    path={preview}
                    title={(status?.archmaps.files ?? []).find((f) => f.path === preview)?.name ?? preview}
                    onOpenFile={onOpenFile}
                  />
                </div>
              ) : null}
            </div>
          )}
        </ErrorBoundary>
      </div>
    </div>
  );
}

/** Delegated code-copy for the wiki preview (same contract as chat). */
/**
 * Standard wiki page presentation: a page header row (frontmatter title on the
 * left, "open in editor" on the right) above the rendered document in a
 * reading-measure column — the shape a wiki reader expects, instead of a bare
 * markdown dump.
 */
function WikiPageView({
  raw,
  onOpenFile,
  openLabel,
  onQuote,
  quoteLabel,
  fallbackTitle,
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
}): JSX.Element {
  const { title, body } = useMemo(() => extractWikiPageMeta(raw), [raw]);
  const quoteTitle = title ?? fallbackTitle.split("/").pop() ?? "wiki";
  return (
    <div className="ui-wiki-page">
      <div className="ui-wiki-page-head">
        <span className="ui-wiki-page-icon" aria-hidden>
          ▤
        </span>
        {title ? <h1 className="ui-wiki-page-title">{title}</h1> : <span className="ui-wiki-page-title" />}
        {onQuote ? (
          <Button size="sm" variant="primary" className="ui-wiki-page-quote" onClick={() => onQuote(quoteTitle)}>
            {quoteLabel}
          </Button>
        ) : null}
        <Button size="sm" variant="subtle" onClick={onOpenFile}>
          {openLabel}
        </Button>
      </div>
      <StreamdownView className="ui-knowledge-agents-md ui-md ui-wiki-doc" markdown={body} />
    </div>
  );
}

/** Architecture-map preview. Two artifact generations:
 *  - `.md` (current): a Mermaid diagram document — only the diagrams render
 *    (the map IS a picture; the prose between the fences is scan narration).
 *  - `.json` (legacy): the persisted A2UI surface JSON replayed through the
 *    real A2UI component renderer (the same one the conversation surfaces use). */
type ArchContent =
  | { kind: "md"; markdown: string }
  | { kind: "html"; html: string }
  | { kind: "a2ui"; messagesJson: string; surfaceId: string };

/** Extract ```mermaid fence bodies — the arch doc's prose is not displayed. */
/** One rendered chart plus the document section it belongs to.
 *  The nearest preceding heading becomes the chart's title — arch-scan writes
 *  its narration as headed sections, so the heading IS the relationship the
 *  chart bears to the ones around it (top-level → module → detail). */
type ArchSection = { title: string; chart: string };

/** Split an arch doc into headed mermaid sections (state machine over lines —
 *  fence-aware, so a heading inside a diagram is never mistaken for a doc
 *  heading). Charts with no preceding heading fall back to 图 N. */
function extractArchSections(markdown: string): ArchSection[] {
  const sections: ArchSection[] = [];
  let heading = "";
  let inFence = false;
  let chartLines: string[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    if (!inFence && /^```mermaid\s*$/.test(line)) {
      inFence = true;
      chartLines = [];
      continue;
    }
    if (inFence && /^```\s*$/.test(line)) {
      inFence = false;
      const chart = chartLines.join("\n").trim();
      if (chart) sections.push({ title: heading, chart });
      continue;
    }
    if (inFence) {
      chartLines.push(line);
      continue;
    }
    const h = line.match(/^#{1,4}\s+(.+?)\s*#*\s*$/);
    if (h) heading = h[1].trim();
  }
  return sections;
}

/**
 * One chart FITTED inside its card within a NARROW SCALE BAND. Real-machine
 * feedback ("图好乱"): uncapped fill-width scaling made text sizes swing
 * wildly across cards — a 3-node chart ballooned while a dense one shrank to
 * noise. Every chart now renders at 18px source font, and the scale is
 * clamped to [minScale, maxScale] so effective text height stays comparable
 * card-to-card; a chart that doesn't fill its card just centers with air.
 * Explicit scaled box (transform alone doesn't grow the layout box); the
 * inner box stays unscaled and is what the observer measures.
 */
function ArchChartFit({
  chart,
  minScale,
  maxScale,
}: {
  chart: string;
  minScale: number;
  maxScale: number;
}): JSX.Element {
  const frameRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [boxW, setBoxW] = useState(0);
  // Card content width (frame) — belt-and-braces measurement, same rationale
  // as the symbol graph (a lone contentRect observer missed a maximize).
  const measure = useCallback(() => {
    const frame = frameRef.current;
    const inner = innerRef.current;
    if (frame) {
      const w = Math.floor(frame.getBoundingClientRect().width);
      if (w > 0) setBoxW((prev) => (Math.abs(prev - w) > 1 ? w : prev));
    }
    if (inner && (inner.offsetWidth > 0 || inner.offsetHeight > 0)) {
      setNatural((prev) =>
        prev.w === inner.offsetWidth && prev.h === inner.offsetHeight
          ? prev
          : { w: inner.offsetWidth, h: inner.offsetHeight }
      );
    }
  }, []);
  useEffect(() => {
    measure();
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => measure());
      if (frameRef.current) ro.observe(frameRef.current);
      if (innerRef.current) ro.observe(innerRef.current);
    }
    window.addEventListener("resize", measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure]);
  const scale = natural.w > 0 && boxW > 0 ? Math.min(maxScale, Math.max(minScale, boxW / natural.w)) : 1;
  return (
    <div className="ui-arch-chart-fit" ref={frameRef}>
      <div
        className="ui-arch-chart-box"
        style={natural.w > 0 ? { width: natural.w * scale, height: natural.h * scale } : undefined}
      >
        <div
          ref={innerRef}
          className="ui-arch-chart-inner"
          style={natural.w > 0 ? { transform: `scale(${scale})`, transformOrigin: "top left" } : undefined}
        >
          <MermaidDiagram chart={chart} />
        </div>
      </div>
    </div>
  );
}

/**
 * Arch map viewer — a BOARD, not a document (real-machine feedback round 4:
 * the vertical stack still read as one long messy column).
 *   - the FIRST chart (arch-scan's overall view) is the HERO card, full width;
 *   - every following module chart is a card in a responsive CSS grid
 *     (auto-fit ≥ 380px columns) — a maximized window shows 2-4 cards per
 *     row, so the page fills BOTH dimensions instead of one long column;
 *   - a drill rail joins the hero zone to the module zone (the scan IS a
 *     top-down progression);
 *   - each chart fits its card independently (down freely, up capped), so
 *     text sizes stay comparable and nothing balloons or shrinks to noise.
 * Documents with no mermaid block fall back to full markdown so nothing
 * renders blank.
 */
function ArchDiagrams({
  markdown,
  onOpenSource,
}: {
  markdown: string;
  onOpenSource: (() => void) | null;
}): JSX.Element {
  const { t } = useI18n();
  const sections = useMemo(() => extractArchSections(markdown), [markdown]);

  if (sections.length === 0) {
    return <StreamdownView className="ui-knowledge-agents-md ui-md ui-knowledge-arch-md" markdown={markdown} />;
  }
  const [hero, ...modules] = sections;
  const head = (section: ArchSection, n: number): JSX.Element => (
    <div className="ui-arch-section-head">
      <span className="ui-arch-section-badge">{t("index.archChart", { n })}</span>
      <span className="ui-arch-section-title">{section.title || t("index.archChart", { n })}</span>
    </div>
  );

  return (
    <div className="ui-arch-viewer">
      <div className="ui-arch-toolbar">
        <span className="ui-arch-count">{t("index.archChartCount", { n: sections.length })}</span>
        {onOpenSource ? (
          <Button size="sm" variant="subtle" onClick={onOpenSource}>
            {t("index.openInEditor")}
          </Button>
        ) : null}
      </div>
      <div className="ui-arch-board">
        <div className="ui-arch-card ui-arch-card--hero">
          {head(hero, 1)}
          <ArchChartFit chart={hero.chart} minScale={0.6} maxScale={1.8} />
        </div>
        {modules.length > 0 ? (
          <>
            <div className="ui-arch-flow" aria-hidden>
              <span className="ui-arch-flow-line" />
              <span className="ui-arch-flow-node">◆</span>
              <span className="ui-arch-flow-line" />
            </div>
            <div className="ui-arch-grid">
              {modules.map((section, i) => (
                <div className="ui-arch-card" key={i}>
                  {head(section, i + 2)}
                  <ArchChartFit chart={section.chart} minScale={0.55} maxScale={1.6} />
                </div>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

function KnowledgeArchPreview({
  path,
  title,
  onOpenFile,
}: {
  path: string;
  title: string;
  onOpenFile: (path: string) => void;
}): JSX.Element {
  const { t } = useI18n();
  const archTitle = title.replace(/^arch-/, "").replace(/\.json$/, "");
  const [content, setContent] = useState<ArchContent | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setContent(null);
    setError(null);
    (async () => {
      try {
        const result = await api.knowledgeReadArchmap(path);
        if (!alive) return;
        if (!result.ok) {
          setError(result.error ?? t("app.requestFailed"));
          return;
        }
        if (result.markdown != null) {
          setContent({ kind: "md", markdown: result.markdown });
          return;
        }
        if (result.html != null) {
          setContent({ kind: "html", html: result.html });
          return;
        }
        const surface = result.surface;
        // Prefer replaying the recorded message history; fall back to a
        // synthesized snapshot for older files that only stored components.
        const messages =
          Array.isArray(surface.messages) && surface.messages.length > 0
            ? surface.messages
            : [
                {
                  version: "v0.9",
                  createSurface: { surfaceId: surface.surfaceId, catalogId: BASIC_CATALOG_ID },
                },
                {
                  version: "v0.9",
                  updateComponents: { surfaceId: surface.surfaceId, components: surface.components ?? [] },
                },
                {
                  version: "v0.9",
                  updateDataModel: { surfaceId: surface.surfaceId, path: "/", value: surface.dataModel ?? {} },
                },
              ];
        setContent({ kind: "a2ui", messagesJson: JSON.stringify(messages), surfaceId: surface.surfaceId });
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      alive = false;
    };
  }, [path, t]);

  if (error) return <div className="ui-knowledge-preview-error">{error}</div>;
  const meta =
    content?.kind === "md"
      ? "Mermaid"
      : content?.kind === "html"
        ? "HTML Board"
        : content?.kind === "a2ui"
          ? `A2UI v0.9 · ${content.surfaceId}`
          : "…";
  return (
    <div className="ui-knowledge-archframe">
      <div className="ui-knowledge-archframe-head">
        <span className="ui-knowledge-archframe-title">◈ {archTitle}</span>
        <span className="ui-knowledge-archframe-meta">{meta}</span>
      </div>
      <div className="ui-knowledge-preview-a2ui">
        {content?.kind === "md" ? (
          <ArchDiagrams markdown={content.markdown} onOpenSource={() => onOpenFile(path)} />
        ) : content?.kind === "html" ? (
          /* The layered board: self-contained, JavaScript-free HTML painted on a
           * fully-sandboxed canvas (empty sandbox = no scripts, no same-origin,
           * no navigation — the board is pure CSS). Same srcDoc channel the CRG
           * architecture graph uses in the right dock. */
          <iframe
            srcDoc={content.html}
            title={archTitle}
            sandbox=""
            style={{ width: "100%", height: "100%", border: "none", background: "#fff" }}
          />
        ) : content?.kind === "a2ui" ? (
          <A2uiSurface messagesJson={content.messagesJson} surfaceId={content.surfaceId} />
        ) : (
          <div className="ui-knowledge-preview-loading" />
        )}
      </div>
    </div>
  );
}

// ── Wiki directory tree (R3-6): standard collapsible explorer tree ─────────

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
    </div>
  );
}
