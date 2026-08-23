import { useCallback, useEffect, useState, type JSX } from "react";
import { api } from "../api";
import { renderMarkdown } from "../markdown";
import { useI18n, type MessageKey } from "../i18n";
import { Button } from "../ui/index";
import type { KnowledgeStatusResponse, KnowledgeSymbol } from "../../shared/ipc";

/**
 * Knowledge tab body (specs/index-knowledge-rework T3.3): three sub-tabs —
 * Wiki / AGENTS / 架构图 — for ONE workspace root. Engine names never appear
 * (naming redline): the UI says Wiki, not OpenWiki. Wiki pages and AGENTS.md
 * open in the editor (onOpenFile); architecture maps render in the embedded
 * preview pane.
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

export function KnowledgePanel({ root, onOpenFile }: Props): JSX.Element {
  const { t } = useI18n();
  const [status, setStatus] = useState<KnowledgeStatusResponse | null>(null);
  const [sub, setSub] = useState<SubTab>("wiki");
  const [wikiPages, setWikiPages] = useState<Array<{ title: string; path: string; mtime?: string }>>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [agentsContent, setAgentsContent] = useState<string | null>(null);
  const [symbols, setSymbols] = useState<KnowledgeSymbol[]>([]);
  const [symbolQuery, setSymbolQuery] = useState("");

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
            <div className="ui-knowledge-list">
              {wikiPages.map((page) => (
                <button
                  key={page.path}
                  type="button"
                  className="ui-knowledge-item"
                  onClick={() => onOpenFile(`${root}/openwiki/${page.path}`)}
                  title={page.path}
                >
                  <span className="ui-knowledge-item-name">{page.title}</span>
                  <span className="ui-knowledge-item-meta">
                    {formatRelative(page.mtime, t("index.freshness.justNow"), t("index.freshness.never"))}
                  </span>
                </button>
              ))}
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
            <input
              className="ui-knowledge-symbol-search"
              type="text"
              value={symbolQuery}
              placeholder={t("index.symbolSearch")}
              onChange={(e) => setSymbolQuery(e.target.value)}
            />
            {status && status.codegraph.state !== "indexed" ? (
              <div className="ui-side-panel-empty">{t("index.symbolsEmpty")}</div>
            ) : symbols.length === 0 ? (
              <div className="ui-side-panel-empty">{t("index.symbolsNoMatch")}</div>
            ) : (
              <div className="ui-knowledge-list">
                {symbols.map((sym) => (
                  <button
                    key={`${sym.kind}:${sym.filePath}:${sym.startLine}:${sym.name}`}
                    type="button"
                    className="ui-knowledge-item"
                    onClick={() => onOpenFile(`${root}/${sym.filePath}`)}
                    title={`${sym.kind} · ${sym.filePath}:${sym.startLine}`}
                  >
                    <span className="ui-knowledge-item-name">
                      <span className="ui-knowledge-sym-kind">{sym.kind}</span> {sym.name}
                    </span>
                    <span className="ui-knowledge-item-meta">
                      {sym.filePath.split("/").pop()}:{sym.startLine}
                    </span>
                  </button>
                ))}
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

/** Architecture-map preview: surface JSON → self-contained A2UI HTML shell. */
function KnowledgeArchPreview({ path }: { path: string }): JSX.Element {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const result = await api.knowledgeRenderArchmap(path);
        if (!alive) return;
        if (result.ok) setHtml(result.html);
        else setError(result.error ?? "render failed");
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      alive = false;
    };
  }, [path]);

  if (error) return <div className="ui-knowledge-preview-error">{error}</div>;
  if (!html) return <div className="ui-knowledge-preview-loading" />;
  return <iframe className="ui-knowledge-preview-frame" srcDoc={html} sandbox="allow-scripts" title="arch-map" />;
}
