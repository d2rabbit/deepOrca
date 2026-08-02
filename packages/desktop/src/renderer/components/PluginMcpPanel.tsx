import { useCallback, useEffect, useState, type JSX } from "react";
import type { BuiltinPluginGroup, PluginMcpServer, SkillInfo } from "../../shared/ipc";
import { api } from "../api";
import { useI18n, type MessageKey } from "../i18n";
import { Button, Input, StatusDot, Switch } from "../ui/index";
import type { PluginSelection } from "./PluginDetail";

/**
 * Look up the localized display name/description for a built-in item. Falls back
 * to the raw value when no i18n entry exists.
 *
 * Two key prefixes exist in the i18n catalog:
 *  - `builtin.<name>.<field>`   → individual plugins and bundled skills
 *  - `builtin-plugin.<id>.<field>` → plugin group cards (code-intelligence, flutter-dev, …)
 *
 * i18n rule: zh/zh-TW/zh-HK show Simplified Chinese; en/ja/ko show English.
 */
export function builtinLabel(
  t: (key: MessageKey) => string,
  name: string,
  field: "name" | "desc",
  fallback: string
): string {
  // Try individual-item key first, then group key.
  const itemKey = `builtin.${name}.${field}` as MessageKey;
  const itemValue = t(itemKey);
  if (itemValue !== itemKey) return itemValue;
  const groupKey = `builtin-plugin.${name}.${field}` as MessageKey;
  const groupValue = t(groupKey);
  return groupValue === groupKey ? fallback : groupValue;
}

/** A skill is "built-in" (shipped with the product) when its path is bundled:. */
export function isBundledSkill(skill: SkillInfo): boolean {
  return skill.path.startsWith("bundled:");
}

type Props = {
  skills: SkillInfo[];
  selectedSkills: string[];
  onToggleSkill: (name: string) => void;
  onRefreshSkills?: () => void | Promise<void>;
  selected: PluginSelection | null;
  onSelect: (selection: PluginSelection) => void;
};

type Section = "mcp" | "skills" | "plugins";

/** Curated stdio MCP servers. Clicking a preset only pre-fills the add form —
 *  the user still reviews the command and presses Add, so nothing auto-runs. */
type McpPreset = { name: string; command: string; args: string };
const MCP_PRESETS: McpPreset[] = [
  { name: "filesystem", command: "npx", args: "-y @modelcontextprotocol/server-filesystem ." },
  { name: "memory", command: "npx", args: "-y @modelcontextprotocol/server-memory" },
  { name: "sequential-thinking", command: "npx", args: "-y @modelcontextprotocol/server-sequential-thinking" },
];

/**
 * VSCode-style left-panel plugin module (items 5 & 8): MCP servers are managed
 * here (add / remove / enable-disable), with the built-in CodeGraph server
 * always listed and disable-only. Skills attach/detach live under a second tab.
 */
export function PluginMcpPanel({
  skills,
  selectedSkills,
  onToggleSkill,
  onRefreshSkills,
  selected,
  onSelect,
}: Props): JSX.Element {
  const { t } = useI18n();
  const [section, setSection] = useState<Section>("mcp");
  const [servers, setServers] = useState<PluginMcpServer[]>([]);
  const [groups, setGroups] = useState<BuiltinPluginGroup[]>([]);
  const [adding, setAdding] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [env, setEnv] = useState("");

  const reload = useCallback(async () => {
    setServers(await api.pluginMcpList());
  }, []);

  const reloadGroups = useCallback(async () => {
    setGroups(await api.pluginBuiltinGroups());
  }, []);

  useEffect(() => {
    void reload();
    void reloadGroups();
    return api.onMcpStatusChanged(() => {
      void reload();
      void reloadGroups();
    });
  }, [reload, reloadGroups]);

  const toggle = useCallback(
    async (srv: PluginMcpServer) => {
      await api.pluginSetMcpEnabled(srv.name, !srv.enabled);
      await reload();
    },
    [reload]
  );

  const remove = useCallback(
    async (srv: PluginMcpServer) => {
      await api.pluginRemoveMcpServer(srv.name);
      await reload();
    },
    [reload]
  );

  void remove;

  const applyPreset = useCallback((preset: McpPreset) => {
    setName(preset.name);
    setCommand(preset.command);
    setArgs(preset.args);
    setEnv("");
    setAdding(true);
  }, []);

  const save = useCallback(async () => {
    const n = name.trim();
    const c = command.trim();
    if (!n || !c) return;
    const argv = args.split(/\s+/).filter(Boolean);
    const envMap: Record<string, string> = {};
    for (const line of env.split("\n")) {
      const idx = line.indexOf("=");
      if (idx > 0) envMap[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
    await api.pluginUpsertMcpServer(
      n,
      c,
      argv.length > 0 ? argv : undefined,
      Object.keys(envMap).length > 0 ? envMap : undefined
    );
    setName("");
    setCommand("");
    setArgs("");
    setEnv("");
    setAdding(false);
    await reload();
  }, [args, command, env, name, reload]);

  const refreshSkills = useCallback(async () => {
    if (!onRefreshSkills) return;
    setRefreshing(true);
    try {
      await onRefreshSkills();
    } finally {
      setRefreshing(false);
    }
  }, [onRefreshSkills]);

  return (
    <div className="ui-side-panel">
      <div className="ui-side-panel-head">
        <span>{t("plugins.title")}</span>
      </div>
      <div className="ui-tabs">
        <button className={`ui-tab${section === "mcp" ? " active" : ""}`} onClick={() => setSection("mcp")}>
          {t("plugins.mcpSection")}
        </button>
        <button className={`ui-tab${section === "skills" ? " active" : ""}`} onClick={() => setSection("skills")}>
          {t("plugins.skillsSection")}
        </button>
        <button className={`ui-tab${section === "plugins" ? " active" : ""}`} onClick={() => setSection("plugins")}>
          {t("plugins.builtinSection")}
        </button>
      </div>

      <div className="ui-side-panel-body">
        {section === "mcp" ? (
          <>
            {servers
              .filter((srv) => !srv.builtin)
              .map((srv) => {
                const isSel = selected?.kind === "mcp" && selected.name === srv.name;
                return (
                  <div
                    key={srv.name}
                    className={`ui-mcp-row${srv.enabled ? "" : " disabled"}${isSel ? " selected" : ""}`}
                  >
                    <button
                      type="button"
                      className="ui-mcp-row-main"
                      onClick={() => onSelect({ kind: "mcp", name: srv.name })}
                    >
                      <span className="ui-mcp-row-name">
                        {srv.status ? <StatusDot status={srv.status.status} /> : <StatusDot />}
                        {srv.name}
                        {srv.builtin ? <span className="ui-mcp-badge">{t("mcp.builtin")}</span> : null}
                      </span>
                      <span className="ui-plugin-item-desc">
                        {srv.builtin ? srv.name : `${srv.command} ${srv.args}`}
                      </span>
                      <div className="ui-plugin-item-tags">
                        <span className="ui-plugin-tag accent">mcp</span>
                        {srv.builtin ? (
                          <span className="ui-plugin-tag">built-in</span>
                        ) : (
                          <span className="ui-plugin-tag">custom</span>
                        )}
                      </div>
                    </button>
                    <div className="ui-mcp-row-actions">
                      <Switch checked={srv.enabled} onChange={() => void toggle(srv)} title={t("mcp.enableTitle")} />
                    </div>
                  </div>
                );
              })}

            {/* Built-in MCP servers (codegraph, CRG, gitmcp:*) live only in the
                Plugins tab group cards — the MCP tab shows user-defined servers. */}

            {adding ? (
              <div className="ui-mcp-add-form">
                <Input type="text" placeholder={t("mcp.name")} value={name} onChange={(e) => setName(e.target.value)} />
                <Input
                  type="text"
                  placeholder={t("mcp.command")}
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                />
                <Input type="text" placeholder={t("mcp.args")} value={args} onChange={(e) => setArgs(e.target.value)} />
                <textarea
                  className="ui-mcp-env"
                  placeholder={t("mcp.env")}
                  value={env}
                  onChange={(e) => setEnv(e.target.value)}
                />
                <div className="ui-mcp-add-actions">
                  <Button size="sm" variant="primary" onClick={() => void save()}>
                    {t("mcp.save")}
                  </Button>
                  <Button size="sm" variant="subtle" onClick={() => setAdding(false)}>
                    {t("common.cancel")}
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <Button size="sm" onClick={() => setAdding(true)}>
                  ＋ {t("mcp.add")}
                </Button>
                <div className="ui-mcp-presets">
                  <span className="ui-mcp-presets-label">{t("plugins.mcp.presets")}</span>
                  {MCP_PRESETS.map((preset) => (
                    <button
                      key={preset.name}
                      type="button"
                      className="ui-mcp-preset"
                      title={`${preset.command} ${preset.args}`}
                      onClick={() => applyPreset(preset)}
                    >
                      {preset.name}
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        ) : section === "skills" ? (
          (() => {
            // Bundled skills are shown under the Plugins tab as built-in items;
            // the Skills tab only lists user-authored skills.
            const userSkills = skills.filter((s) => !isBundledSkill(s));
            return (
              <>
                <div className="ui-skill-toolbar">
                  <span className="ui-skill-toolbar-count">{userSkills.length}</span>
                  {onRefreshSkills ? (
                    <Button size="sm" variant="subtle" onClick={() => void refreshSkills()} disabled={refreshing}>
                      ↻ {t("scm.refresh")}
                    </Button>
                  ) : null}
                </div>
                {userSkills.length === 0 ? (
                  <div className="ui-side-panel-empty">{t("plugins.skills.none")}</div>
                ) : (
                  userSkills.map((skill) => {
                    const isSel = selected?.kind === "skill" && selected.name === skill.name;
                    return (
                      <div key={skill.name} className={`ui-plugin-item${isSel ? " selected" : ""}`}>
                        <button
                          type="button"
                          className="ui-plugin-item-main"
                          onClick={() => onSelect({ kind: "skill", name: skill.name })}
                        >
                          <div className="ui-plugin-item-header">
                            <span className="ui-plugin-item-name">{skill.name}</span>
                            {skill.isLoaded ? <span className="ui-mcp-badge">{t("plugins.skills.loaded")}</span> : null}
                          </div>
                          {skill.description ? <span className="ui-plugin-item-desc">{skill.description}</span> : null}
                          <div className="ui-plugin-item-tags">
                            <span className="ui-plugin-tag">skill</span>
                            {skill.path.startsWith("bundled:") ? (
                              <span className="ui-plugin-tag accent">bundled</span>
                            ) : (
                              <span className="ui-plugin-tag">local</span>
                            )}
                          </div>
                        </button>
                        <Switch
                          checked={selectedSkills.includes(skill.name)}
                          onChange={() => onToggleSkill(skill.name)}
                          title={t("plugins.skills.attach")}
                        />
                      </div>
                    );
                  })
                )}
                <div className="ui-skill-hint">{t("plugins.skills.locations")}</div>
              </>
            );
          })()
        ) : (
          (() => {
            // Plugins tab: built-in items grouped into plugin cards. Each card
            // bundles related skills, MCP servers, and plugin descriptors that
            // belong to the same tool/service. Clicking opens the group detail.
            const nonEmpty = groups.filter(
              (g) => g.skills.length > 0 || g.mcpServers.length > 0 || g.plugins.length > 0
            );
            return (
              <>
                {nonEmpty.length === 0 ? (
                  <div className="ui-side-panel-empty">{t("plugins.builtin.none")}</div>
                ) : (
                  nonEmpty.map((group) => {
                    const isSel = selected?.kind === "group" && selected.name === group.id;
                    const stats: string[] = [];
                    if (group.skills.length > 0) stats.push(`${group.skills.length} ${t("plugins.group.skills")}`);
                    if (group.mcpServers.length > 0) stats.push(`${group.mcpServers.length} ${t("plugins.group.mcp")}`);
                    if (group.plugins.length > 0) stats.push(`${group.plugins.length} ${t("plugins.group.plugins")}`);
                    return (
                      <div key={group.id} className={`ui-plugin-group-card${isSel ? " selected" : ""}`}>
                        <button
                          type="button"
                          className="ui-plugin-item-main"
                          onClick={() => onSelect({ kind: "group", name: group.id })}
                        >
                          <div className="ui-plugin-item-header">
                            <span className="ui-plugin-item-name">{builtinLabel(t, group.id, "name", group.name)}</span>
                            <span className="ui-mcp-badge builtin">{t("plugins.builtin.badge")}</span>
                          </div>
                          <span className="ui-plugin-item-desc">
                            {builtinLabel(t, group.id, "desc", group.description)}
                          </span>
                          {stats.length > 0 ? <div className="ui-plugin-group-stats">{stats.join(" · ")}</div> : null}
                        </button>
                      </div>
                    );
                  })
                )}
                <div className="ui-skill-hint">{t("plugins.builtin.hint")}</div>
              </>
            );
          })()
        )}
      </div>
    </div>
  );
}
