import { useEffect, useState, type JSX } from "react";
import type {
  EditableSettings,
  PermissionDecision,
  PermissionScope,
  ReasoningEffort,
  SerializableSessionEntry,
  WorkspaceSessions,
} from "../../shared/ipc";
import { api } from "../api";
import { useI18n, type Locale, type MessageKey } from "../i18n";
import { Button, Checkbox, Field, Input, Select } from "../ui/index";
import { availableThemes, type Theme } from "../lib/appearance";
import {
  aggregateByTimeWindow,
  aggregateByWorkspace,
  aggregateUsage,
  cacheHitRate,
  formatExact,
  formatTokens,
} from "../lib/token-usage";

type Props = {
  initial: EditableSettings;
  initialTab?: string;
  sessions: SerializableSessionEntry[];
  onSave: (next: EditableSettings) => void;
  onClose: () => void;
  /** Platform string (e.g. "win32") — scopes which themes are offered. */
  platform: string;
  /** Currently active theme. */
  theme: Theme;
  /** Called when the user picks a theme in the General tab. */
  onSelectTheme: (theme: Theme) => void;
};

type Tab = "connection" | "language" | "model" | "permissions" | "tokens" | "about";

const TABS: { id: Tab; labelKey: MessageKey }[] = [
  { id: "connection", labelKey: "settings.tab.connection" },
  { id: "language", labelKey: "settings.general" },
  { id: "model", labelKey: "settings.tab.model" },
  { id: "permissions", labelKey: "settings.tab.permissions" },
  { id: "tokens", labelKey: "settings.tab.tokens" },
  { id: "about", labelKey: "settings.tab.about" },
];

const TAB_ICONS: Record<Tab, string> = {
  connection: "⌁",
  language: "◐",
  model: "✦",
  permissions: "⊘",
  tokens: "▥",
  about: "ℹ",
};

const PERMISSION_SCOPES: PermissionScope[] = [
  "read-in-cwd",
  "read-out-cwd",
  "write-in-cwd",
  "write-out-cwd",
  "delete-in-cwd",
  "delete-out-cwd",
  "query-git-log",
  "mutate-git-log",
  "network",
  "mcp",
];

const DECISIONS: PermissionDecision[] = ["default", "allow", "ask", "deny"];

const REASONING_OPTIONS: ReasoningEffort[] = ["max", "high"];

const LOCALE_OPTIONS: Locale[] = ["zh", "zh-TW", "zh-HK", "en", "ja", "ko"];

/** DeepOrca desktop changelog. */
const CHANGELOG: { version: string; date: string; changes: string[] }[] = [
  {
    version: "v0.1.0",
    date: "2026-07",
    changes: [
      "基于 DeepOrca 核心引擎构建的 Electron 桌面客户端。",
      "新增 Aqua(macOS 原生)、Metro/Fluent(Windows 8 磁贴骨架)双主题体系。",
      "建立语义化 design-token 系统(--ui-* 变量),为后续主题切换奠定基础。",
    ],
  },
  {
    version: "v0.2.0",
    date: "2026-07",
    changes: [
      "CLI 能力全面移植到桌面端,新增进程输出面板、文件提及菜单。",
      "消息渲染现代化:支持思考过程、代码高亮、diff 覆盖层、可折叠工具卡。",
      "新增 Token 消耗分析面板(工作区维度统计 + bento 网格)。",
    ],
  },
  {
    version: "v0.3.0",
    date: "2026-07",
    changes: [
      "重塑品牌为 Orca,新增内置插件系统(BrowserSkill 等),与 Skills/MCP 并列的第三扩展类型。",
      "新增毛玻璃(Glass)主题,Linux 默认、macOS 可选。",
    ],
  },
  {
    version: "v0.4.0",
    date: "2026-07",
    changes: [
      "新增 Fusion 主题:融合 Win8 磁贴多彩配色 × Win11 玻璃呼吸色 × 磁铁按钮质感,Windows 专属。",
      "设置面板新增「常规」Tab,内置平台感知的主题选择(Windows: Metro/Fusion)。",
      "索引库 rail 图标独立化(☷);启动不再将当前目录强行注入为空工作区。",
    ],
  },
  {
    version: "v0.5.0",
    date: "2026-07",
    changes: [
      "集成 Monaco Editor 代码编辑器:语法高亮、智能提示、内嵌文件编辑。",
      "新增本地 GitMCP 模块:SQLite FTS5 全文索引 + BM25 排序,内置文档/代码检索工具。",
      "集成 Open Code Review 代码审查面板与 Glass Prism 主题。",
      "仓库迁移至 GitHub 主仓库并以 master 为主干分支;上线 GitHub Pages 官网与 CI 工作流。",
    ],
  },
  {
    version: "v0.6.0",
    date: "2026-07",
    changes: [
      "性能自迭代:消息 Markdown 渲染结果缓存 + 消息组件 memo 化,长会话与空闲时 CPU 占用显著下降。",
      "加载动画心跳仅在任务进行中运行;流式输出期间侧边栏刷新节流至 1.5s/次,大幅减少 IPC 往返。",
      "稳定性加固:IPC 错误统一归一化为可读信息;启动/切换工作区失败不再静默卡死,错误直接展示在输入区。",
      "资源回收:代码审查/Wiki 后台进程随应用退出自动终止,不再残留。",
      "顶栏修复:模型与思考模式下拉框按内容自适应宽度,窄窗口下不再截断文案。",
    ],
  },
];

/** Settings surface rendered inline in the main area (no modal shell). */
export function SettingsPanel({
  initial,
  initialTab,
  sessions,
  onSave,
  onClose,
  platform,
  theme,
  onSelectTheme,
}: Props): JSX.Element {
  const { t, locale, setLocale } = useI18n();
  const [s, setS] = useState<EditableSettings>(initial);
  const isTab = (v: string | undefined): v is Tab => TABS.some((item) => item.id === v);
  const [tab, setTab] = useState<Tab>(isTab(initialTab) ? initialTab : "connection");
  const [showKey, setShowKey] = useState(false);
  const [tree, setTree] = useState<WorkspaceSessions | null>(null);

  // Load the full workspace tree for the token analytics tab (all workspaces).
  useEffect(() => {
    if (tab !== "tokens" || tree) return;
    let cancelled = false;
    void (async () => {
      const data = await api.listWorkspaceSessions();
      if (!cancelled) setTree(data);
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, tree]);

  function patch(partial: Partial<EditableSettings>): void {
    setS((prev) => ({ ...prev, ...partial }));
  }

  function setPermission(scope: PermissionScope, decision: PermissionDecision): void {
    setS((prev) => {
      const permissions = { ...prev.permissions };
      if (decision === "default") {
        delete permissions[scope];
      } else {
        permissions[scope] = decision;
      }
      return { ...prev, permissions };
    });
  }

  return (
    <div className="ui-settings-panel">
      <div className="ui-settings-panel-head">
        <span className="ui-settings-panel-title">{t("settings.title")}</span>
        <div className="ui-settings-panel-actions">
          <Button variant="primary" size="sm" onClick={() => onSave(s)}>
            {t("common.save")}
          </Button>
          <Button size="sm" onClick={onClose}>
            {t("common.close")}
          </Button>
        </div>
      </div>

      <div className="ui-settings-layout">
        <nav className="ui-settings-nav" aria-label={t("settings.title")}>
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`ui-settings-nav-item${tab === item.id ? " active" : ""}`}
              aria-current={tab === item.id ? "page" : undefined}
              onClick={() => setTab(item.id)}
            >
              <span className="ui-settings-nav-icon" aria-hidden="true">
                {TAB_ICONS[item.id]}
              </span>
              <span>{t(item.labelKey)}</span>
            </button>
          ))}
        </nav>

        <div className="ui-settings-main">
          <div className="ui-settings-target">
            {t("settings.savingTo")} <code>{s.saveTargetPath}</code> (
            {s.saveTarget === "project" ? t("settings.target.project") : t("settings.target.user")})
          </div>

          <div className="ui-settings-body">
            {tab === "connection" ? (
              <>
                <section className="ui-settings-section">
                  <div className="ui-settings-section-title">{t("settings.tab.connection")}</div>
                  <Field
                    label={t("settings.apiKey")}
                    hint={s.hasEnvApiKey ? t("settings.envOverride") : undefined}
                    hintWarn
                  >
                    <div className="ui-row-inline">
                      <Input
                        type={showKey ? "text" : "password"}
                        value={s.apiKey}
                        placeholder="sk-…"
                        autoComplete="off"
                        onChange={(e) => patch({ apiKey: e.target.value })}
                      />
                      <Button variant="ghost" size="sm" onClick={() => setShowKey((v) => !v)}>
                        {showKey ? t("common.hide") : t("common.show")}
                      </Button>
                    </div>
                  </Field>

                  <Field label={t("settings.baseUrl")} hint={t("settings.baseUrlHint")}>
                    {/* Endpoint is locked to DeepSeek's first-party API in this
                       release — shown read-only so the user knows where requests go. */}
                    <Input type="text" value="https://api.deepseek.com" disabled readOnly />
                  </Field>

                  <Field label={t("settings.model")}>
                    <Input
                      type="text"
                      value={s.model}
                      placeholder="deepseek-v4-pro"
                      onChange={(e) => patch({ model: e.target.value })}
                    />
                  </Field>

                  <Field label={t("settings.temperature")} hint={t("settings.temperatureHint")}>
                    <Input
                      type="text"
                      value={s.temperature}
                      placeholder={t("settings.temperaturePlaceholder")}
                      onChange={(e) => patch({ temperature: e.target.value })}
                    />
                  </Field>
                </section>
              </>
            ) : null}

            {tab === "language" ? (
              <>
                <section className="ui-settings-section">
                  <div className="ui-settings-section-title">{t("settings.language")}</div>
                  <div className="ui-lang-grid" role="radiogroup" aria-label={t("settings.language")}>
                    {LOCALE_OPTIONS.map((code) => (
                      <button
                        key={code}
                        type="button"
                        role="radio"
                        aria-checked={locale === code}
                        className={`ui-lang-chip${locale === code ? " active" : ""}`}
                        onClick={() => setLocale(code)}
                      >
                        {t(`lang.${code}` as MessageKey)}
                      </button>
                    ))}
                  </div>
                </section>

                <section className="ui-settings-section">
                  <div className="ui-settings-section-title">{t("settings.theme")}</div>
                  <div className="ui-lang-grid" role="radiogroup" aria-label={t("settings.theme")}>
                    {availableThemes(platform).map((id) => (
                      <button
                        key={id}
                        type="button"
                        role="radio"
                        aria-checked={theme === id}
                        className={`ui-lang-chip${theme === id ? " active" : ""}`}
                        onClick={() => onSelectTheme(id)}
                      >
                        {t(`theme.${id}` as MessageKey)}
                      </button>
                    ))}
                  </div>
                </section>
              </>
            ) : null}

            {tab === "model" ? (
              <section className="ui-settings-section">
                <div className="ui-settings-section-title">{t("settings.tab.model")}</div>
                <Field>
                  <Checkbox
                    checked={s.thinkingEnabled}
                    onChange={(e) => patch({ thinkingEnabled: e.target.checked })}
                    label={t("settings.thinkingMode")}
                  />
                </Field>

                {s.thinkingEnabled ? (
                  <Field label={t("settings.reasoningEffort")}>
                    <Select
                      value={s.reasoningEffort}
                      onChange={(e) => patch({ reasoningEffort: e.target.value as ReasoningEffort })}
                    >
                      {REASONING_OPTIONS.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ) : null}

                <Field>
                  <Checkbox
                    checked={s.telemetryEnabled}
                    onChange={(e) => patch({ telemetryEnabled: e.target.checked })}
                    label={t("settings.telemetry")}
                  />
                </Field>

                <Field>
                  <Checkbox
                    checked={s.debugLogEnabled}
                    onChange={(e) => patch({ debugLogEnabled: e.target.checked })}
                    label={t("settings.debugLog")}
                  />
                </Field>
              </section>
            ) : null}

            {tab === "permissions" ? (
              <section className="ui-settings-section">
                <div className="ui-settings-section-title">{t("settings.tab.permissions")}</div>
                <Field label={t("settings.defaultMode")} hint={t("settings.permHint")}>
                  <Select
                    value={s.permissionDefaultMode}
                    onChange={(e) =>
                      patch({ permissionDefaultMode: e.target.value as EditableSettings["permissionDefaultMode"] })
                    }
                  >
                    <option value="allowAll">{t("settings.allowAll")}</option>
                    <option value="askAll">{t("settings.askAll")}</option>
                  </Select>
                </Field>

                <div className="ui-perm-list">
                  {PERMISSION_SCOPES.map((scope) => (
                    <div className="ui-perm-row" key={scope}>
                      <div className="ui-perm-label">
                        <div>{t(`permScope.${scope}.label` as MessageKey)}</div>
                        <div className="ui-field-hint">{t(`permScope.${scope}.hint` as MessageKey)}</div>
                      </div>
                      <Select
                        value={s.permissions[scope] ?? "default"}
                        onChange={(e) => setPermission(scope, e.target.value as PermissionDecision)}
                      >
                        {DECISIONS.map((d) => (
                          <option key={d} value={d}>
                            {t(`decision.${d}` as MessageKey)}
                          </option>
                        ))}
                      </Select>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {tab === "tokens" ? <TokenAnalytics tree={tree} fallbackSessions={sessions} /> : null}

            {tab === "about" ? (
              <>
                <section className="ui-settings-section">
                  <div className="ui-settings-section-title">{t("about.title")}</div>
                  <p className="ui-about-desc">{t("about.intro")}</p>
                  <p className="ui-about-desc">{t("about.detail")}</p>
                </section>

                <section className="ui-settings-section">
                  <div className="ui-settings-section-title">{t("about.changelog")}</div>
                  <div className="ui-changelog">
                    {/* Newest release first — the latest changes are what users came to read. */}
                    {[...CHANGELOG].reverse().map((entry) => (
                      <div key={entry.version} className="ui-changelog-entry">
                        <div className="ui-changelog-head">
                          <span className="ui-changelog-version">{entry.version}</span>
                          <span className="ui-changelog-date">{entry.date}</span>
                        </div>
                        <ul className="ui-changelog-list">
                          {entry.changes.map((change, idx) => (
                            <li key={idx}>{change}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </section>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function TokenBars({
  rows,
  max,
}: {
  rows: { label: string; value: number; model?: boolean }[];
  max: number;
}): JSX.Element {
  return (
    <div className="ui-token-bars">
      {rows.map((row) => (
        <div key={row.label} className="ui-token-bar-row" title={formatExact(row.value)}>
          <span className="ui-token-bar-label" title={row.label}>
            {row.label}
          </span>
          <span className="ui-token-bar-track">
            <span
              className={`ui-token-bar-fill${row.model ? " model" : ""}`}
              style={{ width: `${(row.value / max) * 100}%` }}
            />
          </span>
          <span className="ui-token-bar-value">{formatTokens(row.value)}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Token analytics: a bento-style grid (headline total + prompt/completion/reqs
 * metrics, a time-dimension breakdown and a model-dimension breakdown), plus a
 * per-workspace table underneath.
 */
function TokenAnalytics({
  tree,
  fallbackSessions,
}: {
  tree: WorkspaceSessions | null;
  fallbackSessions: SerializableSessionEntry[];
}): JSX.Element {
  const { t } = useI18n();
  const allSessions = tree ? tree.workspaces.flatMap((w) => w.sessions) : fallbackSessions;
  const agg = aggregateUsage(allSessions);
  const windows = aggregateByTimeWindow(allSessions);
  const wsRows = tree ? aggregateByWorkspace(tree) : [];
  const timeMax = Math.max(1, windows.last5h.total, windows.today.total, windows.thisWeek.total);
  const modelMax = Math.max(1, ...agg.perModel.map((m) => m.total));

  const timeRows = [
    { label: t("tokens.last5h"), value: windows.last5h.total },
    { label: t("tokens.today"), value: windows.today.total },
    { label: t("tokens.thisWeek"), value: windows.thisWeek.total },
  ];
  const modelRows = agg.perModel.map((m) => ({ label: m.model, value: m.total, model: true }));

  return (
    <>
      <div className="ui-token-note">{t("tokens.approxNote")}</div>

      <div className="ui-bento">
        <div className="ui-bento-cell ui-bento-hero">
          <div className="ui-bento-hero-value" title={formatExact(agg.totals.total)}>
            {formatTokens(agg.totals.total)}
          </div>
          <div className="ui-bento-hero-label">{t("tokens.colTotal")}</div>
          <div className="ui-bento-hero-sub">{t("tokens.cacheHitRate", { n: cacheHitRate(agg.totals) })}</div>
        </div>
        <div className="ui-bento-cell">
          <div className="ui-bento-metric" title={formatExact(agg.totals.prompt)}>
            {formatTokens(agg.totals.prompt)}
          </div>
          <div className="ui-bento-metric-label">{t("tokens.prompt")}</div>
        </div>
        <div className="ui-bento-cell">
          <div className="ui-bento-metric" title={formatExact(agg.totals.completion)}>
            {formatTokens(agg.totals.completion)}
          </div>
          <div className="ui-bento-metric-label">{t("tokens.completion")}</div>
        </div>
        <div className="ui-bento-cell">
          <div className="ui-bento-metric">{formatExact(agg.totals.reqs)}</div>
          <div className="ui-bento-metric-label">{t("tokens.requests")}</div>
        </div>

        <div className="ui-bento-cell ui-bento-wide">
          <div className="ui-bento-cell-title">{t("tokens.byTime")}</div>
          <TokenBars rows={timeRows} max={timeMax} />
        </div>

        <div className="ui-bento-cell ui-bento-wide">
          <div className="ui-bento-cell-title">{t("tokens.perModel")}</div>
          {modelRows.length === 0 ? (
            <div className="ui-field-hint">{t("tokens.emptyHint")}</div>
          ) : (
            <TokenBars rows={modelRows} max={modelMax} />
          )}
        </div>
      </div>

      <div className="ui-usage-section-title">{t("tokens.byWorkspace")}</div>
      {wsRows.length === 0 ? (
        <div className="ui-field-hint">{t("tokens.emptyHint")}</div>
      ) : (
        <table className="ui-usage-table">
          <thead>
            <tr>
              <th>{t("tokens.colWorkspace")}</th>
              <th className="num">{t("tokens.colPrompt")}</th>
              <th className="num">{t("tokens.colCompletion")}</th>
              <th className="num">{t("tokens.colTotal")}</th>
              <th className="num">{t("tokens.colReqs")}</th>
            </tr>
          </thead>
          <tbody>
            {wsRows.map((row) => (
              <tr key={row.root}>
                <td className="ui-mono" title={row.root}>
                  {row.label}
                </td>
                <td className="num" title={formatExact(row.prompt)}>
                  {formatTokens(row.prompt)}
                </td>
                <td className="num" title={formatExact(row.completion)}>
                  {formatTokens(row.completion)}
                </td>
                <td className="num" title={formatExact(row.total)}>
                  {formatTokens(row.total)}
                </td>
                <td className="num">{formatExact(row.reqs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
