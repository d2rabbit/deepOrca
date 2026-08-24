import { useCallback, useEffect, useMemo, useState, type JSX, type MouseEvent as ReactMouseEvent } from "react";
import { api } from "../api";
import { useI18n, type MessageKey, type Translate } from "../i18n";
import { Button } from "../ui/index";
import { A2uiSurface } from "../a2ui/A2uiSurface";
import type { ActionProgressEvent, KnowledgeStatusResponse, KnowledgeSymbol } from "../../shared/ipc";
import { BASIC_CATALOG_ID } from "../../shared/a2ui-legacy";
import { SymbolGraphView } from "./SymbolGraphView";
import { ErrorBoundary } from "./ErrorBoundary";
import { MarkdownView } from "./MarkdownView";

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
  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:[ \t]*\r?\n)/);
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

export function KnowledgePanel({ root, onOpenFile }: Props): JSX.Element {
  const { t } = useI18n();
  const [status, setStatus] = useState<KnowledgeStatusResponse | null>(null);
  const [sub, setSub] = useState<SubTab>("wiki");
  const [wikiPages, setWikiPages] = useState<Array<{ title: string; path: string; mtime?: string }>>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [agentsContent, setAgentsContent] = useState<string | null>(null);
  const [symbols, setSymbols] = useState<KnowledgeSymbol[]>([]);
  const [symbolQuery, setSymbolQuery] = useState("");
  // R3-5 inline master–detail state.
  const [wikiSel, setWikiSel] = useState<string | null>(null);
  const [wikiContent, setWikiContent] = useState<string | null>(null);
  const [wikiLoading, setWikiLoading] = useState(false);
  const [symbolSel, setSymbolSel] = useState<KnowledgeSymbol | null>(null);
  // R3-6: symbols default to the GRAPH view (display-only relationship
  // graph); the grouped list stays one toggle away.
  const [symbolView, setSymbolView] = useState<"graph" | "list">("graph");

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

  // Symbols sub-tab: debounced search over the index.
  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        setSymbols(await api.knowledgeListSymbols(root, symbolQuery || undefined));
      } catch {
        setSymbols([]);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [root, symbolQuery]);

  // R3-5: reset inline selections when the workspace root changes.
  useEffect(() => {
    setWikiSel(null);
    setWikiContent(null);
    setSymbolSel(null);
    setPreview(null);
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
            className={`ui-knowledge-subtab${sub === key ? " active" : ""}`}
            onClick={() => setSub(key)}
          >
            {t(labelKey)}
          </button>
        ))}
      </div>
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
                  <MarkdownView className="ui-knowledge-agents-md" markdown={agentsContent} />
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
                <SymbolGraphView root={root} query={symbolQuery} onRecenter={(name) => setSymbolQuery(name)} />
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
function handleWikiCopyClick(e: ReactMouseEvent<HTMLDivElement>): void {
  const btn = (e.target as HTMLElement).closest(".code-block-copy");
  if (!btn) return;
  const wrap = btn.closest(".code-block-wrap");
  const code = wrap?.querySelector("code");
  if (code) {
    void navigator.clipboard.writeText(code.textContent ?? "").then(() => {
      btn.textContent = "✓";
      setTimeout(() => {
        btn.textContent = "⧉";
      }, 1500);
    });
  }
}

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
}: {
  raw: string;
  onOpenFile: () => void;
  openLabel: string;
}): JSX.Element {
  const { title, body } = useMemo(() => extractWikiPageMeta(raw), [raw]);
  return (
    <div className="ui-wiki-page">
      <div className="ui-wiki-page-head">
        {title ? <h1 className="ui-wiki-page-title">{title}</h1> : <span className="ui-wiki-page-title" />}
        <Button size="sm" variant="subtle" onClick={onOpenFile}>
          {openLabel}
        </Button>
      </div>
      <MarkdownView
        className="ui-knowledge-agents-md ui-md ui-wiki-doc"
        markdown={body}
        onClick={handleWikiCopyClick}
      />
    </div>
  );
}

/** Architecture-map preview. Two artifact generations:
 *  - `.md` (current): a Mermaid diagram document — diagrams hydrate inline,
 *    so the map reads as an actual graph, not a flat card list.
 *  - `.json` (legacy): the persisted A2UI surface JSON replayed through the
 *    real A2UI component renderer (the same one the conversation surfaces use). */
type ArchContent = { kind: "md"; markdown: string } | { kind: "a2ui"; messagesJson: string; surfaceId: string };

function KnowledgeArchPreview({ path, title }: { path: string; title: string }): JSX.Element {
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
          setError(result.error ?? "read failed");
          return;
        }
        if (result.markdown != null) {
          setContent({ kind: "md", markdown: result.markdown });
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
  }, [path]);

  if (error) return <div className="ui-knowledge-preview-error">{error}</div>;
  const meta = content?.kind === "md" ? "Mermaid" : content?.kind === "a2ui" ? `A2UI v0.9 · ${content.surfaceId}` : "…";
  return (
    <div className="ui-knowledge-archframe">
      <div className="ui-knowledge-archframe-head">
        <span className="ui-knowledge-archframe-title">◈ {archTitle}</span>
        <span className="ui-knowledge-archframe-meta">{meta}</span>
      </div>
      <div className="ui-knowledge-preview-a2ui">
        {content?.kind === "md" ? (
          <MarkdownView className="ui-knowledge-agents-md ui-md ui-knowledge-arch-md" markdown={content.markdown} />
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
