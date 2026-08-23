import { useCallback, useEffect, useMemo, useState, type JSX } from "react";
import { api } from "../api";
import { renderMarkdown } from "../markdown";
import { useI18n, type MessageKey } from "../i18n";
import { Button } from "../ui/index";
import { A2uiSurface } from "../a2ui/A2uiSurface";
import type { ActionProgressEvent, KnowledgeStatusResponse, KnowledgeSymbol } from "../../shared/ipc";
import { BASIC_CATALOG_ID } from "../../shared/a2ui-legacy";
import { SymbolGraphView } from "./SymbolGraphView";

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

function formatRelative(iso: string | undefined, justNow: string, never: string): string {
  if (!iso) return never;
  const delta = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(delta) || delta < 0) return never;
  const mins = Math.floor(delta / 60000);
  if (mins < 1) return justNow;
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
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
  }, [root]);

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
                  formatRelative={(iso) =>
                    formatRelative(iso, t("index.freshness.justNow"), t("index.freshness.never"))
                  }
                />
              </div>
              <div className="ui-knowledge-wiki-preview">
                {wikiSel ? (
                  wikiLoading ? (
                    <div className="ui-side-panel-empty">
                      <span className="ui-spinner" />
                    </div>
                  ) : wikiContent != null ? (
                    <>
                      <div className="ui-knowledge-preview-actions">
                        <Button size="sm" variant="subtle" onClick={() => onOpenFile(`${root}/openwiki/${wikiSel}`)}>
                          {t("index.openInEditor")}
                        </Button>
                      </div>
                      <div
                        className="ui-knowledge-agents-md"
                        dangerouslySetInnerHTML={{ __html: renderMarkdown(wikiContent) }}
                      />
                    </>
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
                <div
                  className="ui-knowledge-agents-md"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(agentsContent) }}
                />
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
                  ◈ 关系图
                </button>
                <button
                  type="button"
                  className={symbolView === "list" ? "active" : ""}
                  onClick={() => setSymbolView("list")}
                >
                  ☰ 列表
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
                        <Button size="sm" variant="subtle" onClick={() => onOpenFile(`${root}/${symbolSel.filePath}`)}>
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
            ) : (
              <>
                <div className="ui-knowledge-list">
                  {(status?.archmaps.files ?? []).map((file) => (
                    <button
                      key={file.path}
                      type="button"
                      className={`ui-knowledge-item${preview === file.path ? " selected" : ""}`}
                      onClick={() => setPreview(file.path)}
                      title={file.path}
                    >
                      <span className="ui-knowledge-item-name">{file.name}</span>
                      <span className="ui-knowledge-item-meta">
                        {formatRelative(file.mtime, t("index.freshness.justNow"), t("index.freshness.never"))}
                      </span>
                    </button>
                  ))}
                </div>
                {preview ? (
                  <div className="ui-knowledge-preview">
                    <KnowledgeArchPreview path={preview} />
                  </div>
                ) : null}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Architecture-map preview: the persisted surface JSON rendered by the real
 * A2UI component renderer (the same one the conversation's surfaces use). */
function KnowledgeArchPreview({ path }: { path: string }): JSX.Element {
  const [messagesJson, setMessagesJson] = useState<string | null>(null);
  const [surfaceId, setSurfaceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const result = await api.knowledgeReadArchmap(path);
        if (!alive) return;
        if (!result.ok) {
          setError(result.error ?? "read failed");
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
        setSurfaceId(surface.surfaceId);
        setMessagesJson(JSON.stringify(messages));
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      alive = false;
    };
  }, [path]);

  if (error) return <div className="ui-knowledge-preview-error">{error}</div>;
  if (!messagesJson || !surfaceId) return <div className="ui-knowledge-preview-loading" />;
  return (
    <div className="ui-knowledge-preview-a2ui">
      <A2uiSurface messagesJson={messagesJson} surfaceId={surfaceId} />
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
