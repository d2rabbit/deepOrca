// Module-centric deck panels: knowledge sources, plugins & MCP, code review,
// and design assets. The E3 placeholders (themes/notifications/settings/
// editor/shortcuts) became real components in their own files.
import { useEffect, useState, type JSX } from "react";
import { api } from "../../api";
import type {
  DesignArtifactMeta,
  KnowledgeStatusResponse,
  PluginMcpServer,
  ReviewProgressEvent,
} from "../../../shared/ipc";
import { useI18n } from "../../i18n";
import { GiIcon } from "../icons";

// ── 知识源：各源状态卡（codegraph/wiki/serena/agents/memory/routing） ──────
// State is a semantic CSS dot (theme-token colored), not an emoji.
const STATE_DOT: Record<string, string> = {
  indexed: "ok",
  empty: "idle",
  disabled: "off",
  stale: "warn",
};

export function SourcesPanel(): JSX.Element {
  const { t } = useI18n();
  const [status, setStatus] = useState<KnowledgeStatusResponse | null>(null);

  useEffect(() => {
    void api
      .knowledgeStatus()
      .then(setStatus)
      .catch(() => {});
  }, []);

  if (!status) return <div className="deck-empty">{t("deck.loading")}</div>;

  const entries = Object.entries(status) as Array<[string, KnowledgeStatusResponse["codegraph"]]>;

  return (
    <div className="deck-panel">
      {entries.map(([name, source]) => (
        <div key={name} className="deck-row static">
          <span className={`deck-sdot ${STATE_DOT[source.state] ?? "idle"}`} aria-hidden="true" />
          <span className="deck-row-main">{name}</span>
          <span className="deck-row-meta">
            {source.state}
            {typeof source.count === "number" ? ` · ${source.count}${source.unit ?? ""}` : ""}
          </span>
        </div>
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
