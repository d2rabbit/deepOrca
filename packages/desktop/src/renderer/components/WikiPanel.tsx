import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import type { WikiPageEntry, WikiProgressEvent } from "../../shared/ipc";
import { api } from "../api";
import { useI18n } from "../i18n";
import { Button, IconButton } from "../ui/index";

/**
 * Left-panel wiki knowledge graph: lists pages from the project's `openwiki/`
 * directory, renders markdown content, and provides init/update actions with
 * live streaming output.
 */
export function WikiPanel(): JSX.Element {
  const { t } = useI18n();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [pages, setPages] = useState<WikiPageEntry[]>([]);
  const [selectedPage, setSelectedPage] = useState<string | null>(null);
  const [pageContent, setPageContent] = useState("");
  const [busy, setBusy] = useState<"init" | "update" | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [showLog, setShowLog] = useState(false);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  // Check openwiki availability on mount.
  useEffect(() => {
    void api.wikiCheckAvailable().then((r) => setAvailable(r.available));
  }, []);

  const reloadPages = useCallback(async () => {
    const list = await api.wikiListPages();
    setPages(list);
  }, []);

  useEffect(() => {
    void reloadPages();
  }, [reloadPages]);

  // Subscribe to streaming wiki progress events.
  useEffect(() => {
    const off = api.onWikiProgress((event: WikiProgressEvent) => {
      if (event.done) {
        setBusy(null);
        setLogLines((prev) => {
          const suffix = event.exitCode === 0 ? t("wiki.done") : `${t("wiki.failed")} (exit ${event.exitCode})`;
          return [...prev, `\n✓ ${suffix}`];
        });
        void reloadPages();
        return;
      }
      setLogLines((prev) => {
        const text = event.chunk.replace(/\n$/, "");
        if (!text) return prev;
        const lines = text.split("\n");
        const next = [...prev, ...lines];
        return next.length > 300 ? next.slice(next.length - 300) : next;
      });
    });
    return off;
  }, [reloadPages, t]);

  // Auto-scroll log to bottom.
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logLines]);

  const handleInit = useCallback(async () => {
    setBusy("init");
    setShowLog(true);
    setLogLines(["$ openwiki --init"]);
    await api.wikiInit();
  }, []);

  const handleUpdate = useCallback(async () => {
    setBusy("update");
    setShowLog(true);
    setLogLines(["$ openwiki --update"]);
    await api.wikiUpdate();
  }, []);

  const handleSelectPage = useCallback(async (path: string) => {
    setSelectedPage(path);
    const content = await api.wikiReadPage(path);
    setPageContent(content);
  }, []);

  // Not installed state
  if (available === false) {
    return (
      <div className="ui-side-panel">
        <div className="ui-side-panel-head">
          <span>{t("wiki.title")}</span>
        </div>
        <div className="ui-side-panel-body">
          <div className="ui-side-panel-empty">
            <p>{t("wiki.notInstalled")}</p>
            <code>npm install -g openwiki</code>
          </div>
        </div>
      </div>
    );
  }

  // Page content reader view
  if (selectedPage) {
    return (
      <div className="ui-side-panel">
        <div className="ui-side-panel-head">
          <IconButton onClick={() => setSelectedPage(null)} title={t("wiki.back")} aria-label={t("wiki.back")}>
            ←
          </IconButton>
          <span>{selectedPage}</span>
        </div>
        <div className="ui-side-panel-body">
          <pre className="ui-wiki-content">{pageContent || t("wiki.emptyPage")}</pre>
        </div>
      </div>
    );
  }

  return (
    <div className="ui-side-panel">
      <div className="ui-side-panel-head">
        <span>{t("wiki.title")}</span>
        <IconButton onClick={() => void reloadPages()} title={t("scm.refresh")} aria-label={t("scm.refresh")}>
          ⟳
        </IconButton>
      </div>
      <div className="ui-side-panel-body">
        {/* Action buttons */}
        <div className="ui-wiki-actions">
          <Button size="sm" variant="primary" disabled={busy !== null} onClick={() => void handleInit()}>
            {busy === "init" ? t("wiki.generating") : t("wiki.generate")}
          </Button>
          <Button
            size="sm"
            variant="subtle"
            disabled={busy !== null || pages.length === 0}
            onClick={() => void handleUpdate()}
          >
            {busy === "update" ? t("wiki.updating") : t("wiki.update")}
          </Button>
        </div>

        {/* Page list */}
        {pages.length === 0 ? (
          <div className="ui-side-panel-empty">{t("wiki.noPages")}</div>
        ) : (
          <div className="ui-wiki-pages">
            {pages.map((page) => (
              <button
                key={page.path}
                className="ui-wiki-page-item"
                title={page.path}
                onClick={() => void handleSelectPage(page.path)}
              >
                {page.title}
              </button>
            ))}
          </div>
        )}

        {/* Streaming log */}
        {showLog && logLines.length > 0 && (
          <div className="ui-index-log">
            <div className="ui-index-log-head">
              <span>openwiki</span>
              <IconButton
                onClick={() => {
                  setShowLog(false);
                  setLogLines([]);
                }}
                title="✕"
                aria-label="close"
              >
                ✕
              </IconButton>
            </div>
            <pre className="ui-index-log-body">
              {logLines.join("\n")}
              <div ref={logEndRef} />
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
