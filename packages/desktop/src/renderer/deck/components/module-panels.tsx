// Module-centric deck panels: knowledge sources (list → detail, E6.3),
// plugins & MCP, code review, and design assets.
import { useEffect, useState, type JSX } from "react";
import { api } from "../../api";
import type {
  CodegraphIndexEntry,
  DesignArtifactMeta,
  KnowledgeSourceStatus,
  KnowledgeStatusResponse,
  PluginMcpServer,
  ReviewProgressEvent,
  WikiPageEntry,
} from "../../../shared/ipc";
import { useI18n } from "../../i18n";
import { GiIcon } from "../icons";

// ── 知识源：列表 → 详情二级页（各源真实统计 + 重建动作） ────────────────────
// State is a semantic CSS dot (theme-token colored), not an emoji.
const STATE_DOT: Record<string, string> = {
  indexed: "ok",
  empty: "idle",
  disabled: "off",
  stale: "warn",
};

/** Sources with a real rebuild action behind the detail view. */
function rebuildAction(name: string): {
  labelKey: "deck.sources.rebuild" | "deck.sources.update";
  run(): Promise<{ ok: boolean; error?: string }>;
} | null {
  if (name === "codegraph") {
    return {
      labelKey: "deck.sources.rebuild",
      run: () => api.codegraphReindex(".").catch(() => ({ ok: false })),
    };
  }
  if (name === "openwiki") {
    return { labelKey: "deck.sources.update", run: () => api.wikiUpdate().catch(() => ({ ok: false })) };
  }
  return null;
}

function SourceDetail(props: { name: string; source: KnowledgeSourceStatus; onBack(): void }): JSX.Element {
  const { t } = useI18n();
  const [workspaces, setWorkspaces] = useState<CodegraphIndexEntry[] | null>(null);
  const [pages, setPages] = useState<WikiPageEntry[] | null>(null);
  const [busy, setBusy] = useState(false);
  const action = rebuildAction(props.name);

  useEffect(() => {
    if (props.name === "codegraph") {
      void api
        .codegraphList()
        .then(setWorkspaces)
        .catch(() => setWorkspaces([]));
    } else if (props.name === "openwiki") {
      void api
        .wikiListPages()
        .then(setPages)
        .catch(() => setPages([]));
    }
  }, [props.name]);

  const rebuild = () => {
    if (!action || busy) return;
    setBusy(true);
    void action.run().finally(() => setBusy(false));
  };

  return (
    <div className="deck-panel">
      <div className="deck-sub-head">
        <button type="button" className="deck-sub-back" onClick={props.onBack}>
          ‹ {t("deck.sources.back")}
        </button>
        <span className="deck-sub-title">{props.name}</span>
        <span className={`deck-wo-tag ${props.source.state === "indexed" ? "g" : "a"}`}>{props.source.state}</span>
      </div>
      <div className="deck-row static">
        <span className="deck-row-main">{t("deck.sources.count")}</span>
        <span className="deck-row-meta">
          {typeof props.source.count === "number" ? `${props.source.count}${props.source.unit ?? ""}` : "—"}
        </span>
      </div>
      {props.source.lastSync ? (
        <div className="deck-row static">
          <span className="deck-row-main">{t("deck.sources.lastSync")}</span>
          <span className="deck-row-meta">{props.source.lastSync.slice(0, 16).replace("T", " ")}</span>
        </div>
      ) : null}
      {props.source.detail ? (
        <div className="deck-row static">
          <span className="deck-row-main">{t("deck.sources.detail")}</span>
          <span className="deck-row-meta">{props.source.detail}</span>
        </div>
      ) : null}
      {workspaces
        ? workspaces.map((ws) => (
            <div key={ws.root} className="deck-row static">
              <span className="deck-row-main">{ws.label}</span>
              <span className="deck-row-meta">{ws.initialized ? "✓" : "—"}</span>
            </div>
          ))
        : null}
      {pages
        ? pages.slice(0, 20).map((page) => (
            <div key={page.path} className="deck-row static">
              <span className="deck-row-main">{page.title}</span>
              <span className="deck-row-meta">{page.path}</span>
            </div>
          ))
        : null}
      {action ? (
        <div className="deck-panel-ops">
          <button type="button" className="deck-op primary" disabled={busy} onClick={rebuild}>
            {busy ? t("deck.review.running") : t(action.labelKey)}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function SourcesPanel(): JSX.Element {
  const { t } = useI18n();
  const [status, setStatus] = useState<KnowledgeStatusResponse | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    void api
      .knowledgeStatus()
      .then(setStatus)
      .catch(() => {});
  }, []);

  if (!status) return <div className="deck-empty">{t("deck.loading")}</div>;

  const entries = Object.entries(status) as Array<[string, KnowledgeSourceStatus]>;

  if (selected) {
    const source = entries.find(([name]) => name === selected)?.[1];
    if (source) return <SourceDetail name={selected} source={source} onBack={() => setSelected(null)} />;
  }

  return (
    <div className="deck-panel">
      {entries.map(([name, source]) => (
        <button key={name} type="button" className="deck-row linked" onClick={() => setSelected(name)}>
          <span className={`deck-sdot ${STATE_DOT[source.state] ?? "idle"}`} aria-hidden="true" />
          <span className="deck-row-main">{name}</span>
          <span className="deck-row-meta">
            {source.state}
            {typeof source.count === "number" ? ` · ${source.count}${source.unit ?? ""}` : ""} ›
          </span>
        </button>
      ))}
    </div>
  );
}

// ── 插件与 MCP：服务器清单 + 启停 ──────────────────────────────────────────
export function PluginsPanel(): JSX.Element {
  const { t } = useI18n();
  const [servers, setServers] = useState<PluginMcpServer[] | null>(null);

  const refresh = () => {
    void api
      .pluginMcpList()
      .then(setServers)
      .catch(() => setServers([]));
  };
  useEffect(refresh, []);

  if (!servers) return <div className="deck-empty">{t("deck.loading")}</div>;
  if (servers.length === 0) return <div className="deck-empty">{t("deck.plugins.empty")}</div>;

  const toggle = (name: string, enabled: boolean) => {
    void api
      .pluginSetMcpEnabled(name, enabled)
      .then(refresh)
      .catch(() => {});
  };

  return (
    <div className="deck-panel">
      {servers.map((server) => (
        <div key={server.name} className="deck-row static">
          <span className="deck-row-main">
            {server.name}
            <span className="deck-row-sub">{server.command}</span>
          </span>
          <span className="deck-row-ops">
            <button
              type="button"
              className={`deck-op${server.enabled ? "" : " primary"}`}
              onClick={() => toggle(server.name, !server.enabled)}
            >
              {server.enabled ? t("deck.plugins.disable") : t("deck.plugins.enable")}
            </button>
          </span>
        </div>
      ))}
    </div>
  );
}

// ── 代码审查：可用性检查 + 运行 + 流式输出 ─────────────────────────────────
export function ReviewPanel(): JSX.Element {
  const { t } = useI18n();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState("");

  useEffect(() => {
    void api
      .reviewCheckAvailable()
      .then((result) => setAvailable(result.available))
      .catch(() => setAvailable(false));
  }, []);

  useEffect(() => {
    const off = api.onReviewProgress((event: ReviewProgressEvent) => {
      setOutput((prev) => prev + (event.chunk ?? ""));
      if (event.done) setRunning(false);
    });
    return off;
  }, []);

  if (available === null) return <div className="deck-empty">{t("deck.loading")}</div>;
  if (!available) return <div className="deck-empty">{t("deck.review.unavailable")}</div>;

  const run = () => {
    setOutput("");
    setRunning(true);
    void api.reviewRun().then((result) => {
      if (!result.ok) {
        setOutput((prev) => prev + (result.error ?? ""));
        setRunning(false);
      }
    });
  };

  return (
    <div className="deck-panel">
      <div className="deck-panel-ops">
        <button type="button" className="deck-op primary" disabled={running} onClick={run}>
          {running ? t("deck.review.running") : t("deck.review.run")}
        </button>
      </div>
      {output ? <pre className="deck-proc-output">{output}</pre> : null}
    </div>
  );
}

// ── 设计资产：工件清单（打开走经典层的设计预览，E3 再接入 Deck 焦点卡） ────
export function AssetsPanel(): JSX.Element {
  const { t } = useI18n();
  const [artifacts, setArtifacts] = useState<DesignArtifactMeta[] | null>(null);

  useEffect(() => {
    void api
      .designList()
      .then(setArtifacts)
      .catch(() => setArtifacts([]));
  }, []);

  if (!artifacts) return <div className="deck-empty">{t("deck.loading")}</div>;
  if (artifacts.length === 0) return <div className="deck-empty">{t("deck.assets.empty")}</div>;

  return (
    <div className="deck-panel">
      {artifacts.map((artifact) => (
        <div key={artifact.id} className="deck-row static">
          <GiIcon id={artifact.pipeline === "openui" ? "target" : "ruler"} />
          <span className="deck-row-main">{artifact.title}</span>
          <span className="deck-row-meta">{artifact.updatedAt.slice(0, 16).replace("T", " ")}</span>
        </div>
      ))}
    </div>
  );
}
