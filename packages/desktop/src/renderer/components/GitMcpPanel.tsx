import { useCallback, useEffect, useState, type JSX } from "react";
import type { GitmcpRepoEntry } from "../../shared/ipc";
import { api } from "../api";
import { useI18n } from "../i18n";
import { Button, Input, StatusDot, Switch } from "../ui/index";

/** Compact relative time ("3d" / "5h" / "12m") for the last index timestamp. */
function relativeTime(ms: number): string {
  const delta = Math.max(0, Date.now() - ms);
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/**
 * GitMCP module (edge rail item, sibling of Code Review): register a GitHub
 * repository and it becomes a local MCP server (`gitmcp:owner/repo`) backed by
 * a shared local index (`<config root>/gitmcp/index.db`). This panel is the only
 * place such servers can be removed — the plugin MCP tab may only toggle them.
 */
export function GitMcpPanel(): JSX.Element {
  const { t } = useI18n();
  const [entries, setEntries] = useState<GitmcpRepoEntry[]>([]);
  const [input, setInput] = useState("");
  const [addError, setAddError] = useState<"invalid" | "exists" | null>(null);
  const [adding, setAdding] = useState(false);
  const [busySlugs, setBusySlugs] = useState<string[]>([]);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setEntries(await api.gitmcpList());
  }, []);

  useEffect(() => {
    void reload();
    return api.onMcpStatusChanged(() => void reload());
  }, [reload]);

  /** Rebuild a repository index; the row shows progress until the IPC resolves. */
  const runReindex = useCallback(
    async (slug: string) => {
      setBusySlugs((prev) => (prev.includes(slug) ? prev : [...prev, slug]));
      setRowErrors((prev) => {
        if (!(slug in prev)) return prev;
        const next = { ...prev };
        delete next[slug];
        return next;
      });
      try {
        const result = await api.gitmcpReindex(slug);
        if (!result.ok) {
          setRowErrors((prev) => ({ ...prev, [slug]: result.error ?? t("gitmcp.indexFailed") }));
        }
      } finally {
        setBusySlugs((prev) => prev.filter((s) => s !== slug));
        await reload();
      }
    },
    [reload, t]
  );

  const add = useCallback(async () => {
    const value = input.trim();
    if (!value || adding) return;
    setAdding(true);
    setAddError(null);
    try {
      const result = await api.gitmcpAdd(value);
      if (!result.ok) {
        setAddError(result.error ?? "invalid");
        return;
      }
      setInput("");
      await reload();
      // Build the index right away so the first session doesn't pay the cost.
      if (result.slug) void runReindex(result.slug);
    } finally {
      setAdding(false);
    }
  }, [adding, input, reload, runReindex]);

  const toggle = useCallback(
    async (entry: GitmcpRepoEntry) => {
      await api.pluginSetMcpEnabled(entry.serverName, !entry.enabled);
      await reload();
    },
    [reload]
  );

  const remove = useCallback(
    async (slug: string) => {
      setConfirmDelete(null);
      await api.gitmcpRemove(slug);
      await reload();
    },
    [reload]
  );

  return (
    <div className="ui-side-panel">
      <div className="ui-side-panel-head">
        <span>{t("gitmcp.title")}</span>
      </div>
      <div className="ui-side-panel-body">
        <div className="ui-mcp-add-form">
          <Input
            type="text"
            placeholder={t("gitmcp.placeholder")}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setAddError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void add();
            }}
          />
          <div className="ui-mcp-add-actions">
            <Button size="sm" variant="primary" disabled={adding || !input.trim()} onClick={() => void add()}>
              {adding ? t("gitmcp.adding") : t("gitmcp.add")}
            </Button>
          </div>
          {addError ? (
            <div className="ui-scm-error">{addError === "exists" ? t("gitmcp.exists") : t("gitmcp.invalid")}</div>
          ) : null}
        </div>

        {entries.length === 0 ? (
          <div className="ui-side-panel-empty">{t("gitmcp.empty")}</div>
        ) : (
          entries.map((entry) => {
            const busy = busySlugs.includes(entry.slug);
            const rowError = rowErrors[entry.slug];
            return (
              <div key={entry.slug} className={`ui-mcp-row${entry.enabled ? "" : " disabled"}`}>
                <div className="ui-mcp-row-main">
                  <span className="ui-mcp-row-name">
                    {entry.status ? <StatusDot status={entry.status.status} /> : <StatusDot />}
                    {entry.slug}
                    <span className="ui-mcp-badge">{t("mcp.builtin")}</span>
                  </span>
                  <span className="ui-plugin-item-desc">
                    {busy
                      ? t("gitmcp.indexing")
                      : rowError
                        ? `${t("gitmcp.indexFailed")}: ${rowError}`
                        : entry.indexed
                          ? t("gitmcp.indexed", {
                              n: entry.chunkCount,
                              time: entry.fetchedAt != null ? relativeTime(entry.fetchedAt) : "—",
                            })
                          : t("gitmcp.notIndexed")}
                  </span>
                  {confirmDelete === entry.slug ? (
                    <div className="ui-mcp-add-actions">
                      <span className="ui-plugin-item-desc">{t("gitmcp.deleteConfirm", { name: entry.slug })}</span>
                      <Button size="sm" variant="danger" onClick={() => void remove(entry.slug)}>
                        {t("gitmcp.delete")}
                      </Button>
                      <Button size="sm" variant="subtle" onClick={() => setConfirmDelete(null)}>
                        {t("common.cancel")}
                      </Button>
                    </div>
                  ) : (
                    <div className="ui-mcp-add-actions">
                      <Button size="sm" variant="subtle" disabled={busy} onClick={() => void runReindex(entry.slug)}>
                        {busy ? t("gitmcp.indexing") : t("gitmcp.reindex")}
                      </Button>
                      <Button size="sm" variant="subtle" onClick={() => setConfirmDelete(entry.slug)}>
                        {t("gitmcp.delete")}
                      </Button>
                    </div>
                  )}
                </div>
                <div className="ui-mcp-row-actions">
                  <Switch checked={entry.enabled} onChange={() => void toggle(entry)} title={t("mcp.enableTitle")} />
                </div>
              </div>
            );
          })
        )}
        <div className="ui-skill-hint">{t("gitmcp.hint")}</div>
      </div>
    </div>
  );
}
