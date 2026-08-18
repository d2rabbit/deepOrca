import { useCallback, useEffect, useMemo, useState, type JSX } from "react";
import type { BuiltinPluginGroup, BuiltinPluginInfo, PluginMcpServer, SkillInfo } from "../../shared/ipc";
import { api } from "../api";
import { tOr, useI18n, type Translate } from "../i18n";
import { renderMarkdown } from "../markdown";
import { Button, StatusDot, Switch } from "../ui/index";
import { builtinLabel, isBundledSkill } from "./PluginMcpPanel";

/** Which plugin the workspace detail pane is showing. */
export type PluginSelection = { kind: "mcp" | "skill" | "plugin" | "group"; name: string };

type Props = {
  selection: PluginSelection | null;
  skills: SkillInfo[];
  selectedSkills: string[];
  onToggleSkill: (name: string) => void;
  onBack: () => void;
};

/** Derived provenance for an MCP server, inferred from its launch command. */
type McpSource = {
  label: string;
  registryUrl?: string;
  repoUrl?: string;
  author?: string;
};

// Curated repo/author metadata for well-known package scopes. MCP stdio configs
// carry no authorship, so we only claim it where the scope is unambiguous.
const KNOWN_SCOPES: Record<string, { repoUrl: string; author: string }> = {
  "@modelcontextprotocol": {
    repoUrl: "https://github.com/modelcontextprotocol/servers",
    author: "Anthropic · Model Context Protocol",
  },
};

function firstPackageArg(args: string): string | undefined {
  for (const tok of args.split(/\s+/).filter(Boolean)) {
    if (tok.startsWith("-")) continue;
    return tok;
  }
  return undefined;
}

/** Best-effort provenance from `command`/`args` — npm, PyPI, or a local binary. */
function deriveMcpSource(command: string, args: string): McpSource {
  const base = (command.trim().split(/[\\/]/).pop() ?? command).toLowerCase();

  if (["npx", "npm", "pnpm", "bunx", "node"].includes(base)) {
    const pkg = firstPackageArg(args);
    if (pkg && !/\.(m?js|cjs|ts)$/.test(pkg)) {
      const scope = pkg.startsWith("@") ? pkg.slice(0, pkg.indexOf("/")) : undefined;
      const known = scope ? KNOWN_SCOPES[scope] : undefined;
      return {
        label: `npm · ${pkg}`,
        registryUrl: `https://www.npmjs.com/package/${pkg}`,
        repoUrl: known?.repoUrl,
        author: known?.author,
      };
    }
  }

  if (["uvx", "uv", "pipx", "python", "python3"].includes(base)) {
    // `uv tool run --from <spec> ...` — the spec is the real package reference;
    // firstPackageArg would misleadingly return "tool". Strip any ==version pin.
    const tokens = args.split(/\s+/).filter(Boolean);
    const fromIdx = tokens.indexOf("--from");
    const fromSpec = fromIdx >= 0 ? tokens[fromIdx + 1] : undefined;
    if (fromSpec) {
      const pkg = fromSpec.split("==")[0];
      return { label: `PyPI · ${pkg}`, registryUrl: `https://pypi.org/project/${pkg}/` };
    }
    const pkg = firstPackageArg(args);
    if (pkg) return { label: `PyPI · ${pkg}`, registryUrl: `https://pypi.org/project/${pkg}/` };
  }

  if (command.includes("/") || command.includes("\\") || command.startsWith(".")) {
    return { label: command };
  }
  return { label: command };
}

/** Human label for where a skill's SKILL.md lives, from its display path. */
function skillSourceLabel(t: Translate, path: string): string {
  if (path.startsWith("bundled:")) return t("plugins.source.bundled");
  if (path.startsWith("~/") || path.startsWith("~\\")) return t("plugins.source.home");
  if (path.startsWith("./") || path.startsWith(".\\")) return t("plugins.source.project");
  return path;
}

/** Drop the YAML frontmatter block so only the readable body is rendered. */
function stripFrontmatter(md: string): string {
  if (!md.startsWith("---")) return md;
  const end = md.indexOf("\n---", 3);
  if (end === -1) return md;
  const after = md.indexOf("\n", end + 1);
  return after === -1 ? "" : md.slice(after + 1);
}

/**
 * Plugin detail pane — unified four-section layout shared by all kinds:
 *   hero card → capabilities → actions → documentation.
 * The left list carries only summary info; this pane carries the full picture.
 */
export function PluginDetail({ selection, skills, selectedSkills, onToggleSkill }: Props): JSX.Element {
  const { t, locale } = useI18n();
  const [servers, setServers] = useState<PluginMcpServer[]>([]);
  const [doc, setDoc] = useState<string>("");
  const [docError, setDocError] = useState(false);

  const reloadServers = useCallback(async () => setServers(await api.pluginMcpList()), []);

  useEffect(() => {
    void reloadServers();
    return api.onMcpStatusChanged(() => void reloadServers());
  }, [reloadServers]);

  const skill = useMemo(
    () => (selection?.kind === "skill" ? (skills.find((s) => s.name === selection.name) ?? null) : null),
    [selection, skills]
  );

  useEffect(() => {
    if (!skill) {
      setDoc("");
      setDocError(false);
      return;
    }
    let cancelled = false;
    setDoc("");
    setDocError(false);
    api
      .pluginReadSkillDoc(skill.path, locale)
      .then((md) => {
        if (!cancelled) setDoc(md);
      })
      .catch(() => {
        if (!cancelled) setDocError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [skill, locale]);

  if (!selection) {
    return (
      <div className="ui-plugin-detail">
        <div className="ui-plugin-detail-empty">{t("plugins.detail.empty")}</div>
      </div>
    );
  }

  // ── Skill detail (user-authored OR bundled) ──────────────────────────────
  if (selection.kind === "skill") {
    if (!skill) {
      return (
        <div className="ui-plugin-detail">
          <div className="ui-plugin-detail-empty">{t("plugins.detail.empty")}</div>
        </div>
      );
    }
    const bundled = isBundledSkill(skill);
    const attached = selectedSkills.includes(skill.name);
    const displayName = bundled ? builtinLabel(t, skill.name, "name", skill.name) : skill.name;
    const displayDesc = bundled ? builtinLabel(t, skill.name, "desc", skill.description) : skill.description;
    return (
      <div className="ui-plugin-detail">
        {/* Hero card */}
        <header className="ui-detail-hero">
          <div className="ui-detail-hero-title">
            <span className="ui-detail-hero-name">{displayName}</span>
            {bundled ? <span className="ui-mcp-badge builtin">{t("plugins.builtin.badge")}</span> : null}
            {!bundled && skill.isLoaded ? <span className="ui-mcp-badge">{t("plugins.skills.loaded")}</span> : null}
          </div>
          {displayDesc ? <p className="ui-detail-hero-lead">{displayDesc}</p> : null}
          <dl className="ui-detail-meta">
            <div className="ui-detail-meta-row">
              <dt>{t("plugins.detail.source")}</dt>
              <dd>{skillSourceLabel(t, skill.path)}</dd>
            </div>
            <div className="ui-detail-meta-row">
              <dt>{t("plugins.detail.path")}</dt>
              <dd className="ui-plugin-mono">{skill.path}</dd>
            </div>
          </dl>
        </header>

        {/* Actions */}
        {bundled ? (
          <section className="ui-detail-actions">
            <span className="ui-detail-readonly">{t("plugins.builtin.readonly")}</span>
          </section>
        ) : (
          <section className="ui-detail-actions">
            <label className="ui-plugin-detail-toggle">
              <span>{t("plugins.skills.attach")}</span>
              <Switch checked={attached} onChange={() => onToggleSkill(skill.name)} />
            </label>
          </section>
        )}

        {/* Documentation */}
        <section className="ui-detail-doc">
          <h3>{t("plugins.detail.doc")}</h3>
          {docError ? (
            <div className="ui-plugin-detail-empty">{t("plugins.detail.docError")}</div>
          ) : (
            <div className="ui-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(stripFrontmatter(doc)) }} />
          )}
        </section>
      </div>
    );
  }

  // ── Built-in plugin group detail ─────────────────────────────────────────
  if (selection.kind === "group") {
    return <PluginGroupDetail groupId={selection.name} />;
  }

  // ── Built-in plugin detail (browser-skill) ───────────────────────────────
  if (selection.kind === "plugin") {
    return <BuiltinPluginDetail name={selection.name} />;
  }

  // ── MCP server detail ────────────────────────────────────────────────────
  const server = servers.find((s) => s.name === selection.name) ?? null;
  if (!server) {
    return (
      <div className="ui-plugin-detail">
        <div className="ui-plugin-detail-empty">{t("plugins.detail.empty")}</div>
      </div>
    );
  }

  const source = deriveMcpSource(server.command, server.args);
  const status = server.status;
  const hasCaps =
    !!status &&
    ((status.tools?.length ?? 0) > 0 || (status.prompts?.length ?? 0) > 0 || (status.resources?.length ?? 0) > 0);

  const setEnabled = async (enabled: boolean) => {
    await api.pluginSetMcpEnabled(server.name, enabled);
    await reloadServers();
  };
  const remove = async () => {
    await api.pluginRemoveMcpServer(server.name);
    await reloadServers();
  };

  return (
    <div className="ui-plugin-detail">
      {/* Hero card */}
      <header className="ui-detail-hero">
        <div className="ui-detail-hero-title">
          {status ? <StatusDot status={status.status} /> : <StatusDot />}
          <span className="ui-detail-hero-name">{server.name}</span>
          {server.builtin ? <span className="ui-mcp-badge">{t("mcp.builtin")}</span> : null}
        </div>
        <dl className="ui-detail-meta">
          <div className="ui-detail-meta-row">
            <dt>{t("mcp.command")}</dt>
            <dd className="ui-plugin-mono">
              {server.command} {server.args}
            </dd>
          </div>
          <div className="ui-detail-meta-row">
            <dt>{t("plugins.detail.source")}</dt>
            <dd>
              {source.label}
              {source.author ? ` · ${source.author}` : ""}
            </dd>
          </div>
          {source.registryUrl ? (
            <div className="ui-detail-meta-row">
              <dt>{t("plugins.detail.repository")}</dt>
              <dd className="ui-plugin-mono">{source.registryUrl}</dd>
            </div>
          ) : null}
          {server.env.trim() ? (
            <div className="ui-detail-meta-row">
              <dt>{t("mcp.env")}</dt>
              <dd className="ui-plugin-mono">{server.env}</dd>
            </div>
          ) : null}
        </dl>
      </header>

      {/* Capabilities */}
      <section className="ui-detail-caps">
        <h3>{t("plugins.detail.capabilities")}</h3>
        {hasCaps ? (
          <div className="ui-plugin-caps">
            {status!.tools?.length ? (
              <div className="ui-plugin-cap-group">
                <span className="ui-plugin-cap-label">
                  {t("plugins.detail.tools")} · {status!.tools.length}
                </span>
                <div className="ui-plugin-cap-list">
                  {status!.tools.map((tool) => (
                    <span key={tool} className="ui-plugin-cap-chip">
                      {tool}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
            {status!.prompts?.length ? (
              <div className="ui-plugin-cap-group">
                <span className="ui-plugin-cap-label">
                  {t("plugins.detail.prompts")} · {status!.prompts.length}
                </span>
                <div className="ui-plugin-cap-list">
                  {status!.prompts.map((p) => (
                    <span key={p} className="ui-plugin-cap-chip">
                      {p}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
            {status!.resources?.length ? (
              <div className="ui-plugin-cap-group">
                <span className="ui-plugin-cap-label">
                  {t("plugins.detail.resources")} · {status!.resources.length}
                </span>
                <div className="ui-plugin-cap-list">
                  {status!.resources.map((r) => (
                    <span key={r} className="ui-plugin-cap-chip">
                      {r}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="ui-plugin-detail-empty">{t("plugins.detail.noCapabilities")}</div>
        )}
      </section>

      {/* Actions */}
      <section className="ui-detail-actions">
        <label className="ui-plugin-detail-toggle">
          <span>{t("mcp.enableTitle")}</span>
          <Switch checked={server.enabled} onChange={() => void setEnabled(!server.enabled)} />
        </label>
        {server.builtin ? null : (
          <Button size="sm" variant="subtle" onClick={() => void remove()} title={t("mcp.removeTitle")}>
            {t("common.remove")}
          </Button>
        )}
      </section>
    </div>
  );
}

/** Detail pane for a built-in plugin (non-removable). */
function BuiltinPluginDetail({ name }: { name: string }): JSX.Element {
  const { t, locale } = useI18n();
  const [info, setInfo] = useState<BuiltinPluginInfo | null>(null);
  const [doc, setDoc] = useState("");
  const [docError, setDocError] = useState(false);

  // Load plugin metadata first.
  useEffect(() => {
    let cancelled = false;
    api
      .pluginBuiltinList()
      .then((list) => {
        if (!cancelled) setInfo(list.find((p) => p.name === name) ?? null);
      })
      .catch(() => {
        /* noop – info stays null */
      });
    return () => {
      cancelled = true;
    };
  }, [name, locale]);

  const displayName = builtinLabel(t, name, "name", name);
  const displayDesc = builtinLabel(t, name, "desc", info?.description ?? "");

  // Once info is available, derive the directory name from `path` (format:
  // "builtin-plugin:<dirName>") so the doc read is correct even when the
  // manifest name differs from the folder name.
  useEffect(() => {
    if (!info) return;
    let cancelled = false;
    const dirName = info.path.replace(/^builtin-plugin:/, "");
    setDoc("");
    setDocError(false);
    api
      .pluginBuiltinReadDoc(dirName, locale)
      .then((md) => {
        if (!cancelled) setDoc(md);
      })
      .catch(() => {
        if (!cancelled) setDocError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [info, locale]);

  return (
    <div className="ui-plugin-detail">
      {/* Hero card */}
      <header className="ui-detail-hero">
        <div className="ui-detail-hero-title">
          <span className="ui-detail-hero-name">{displayName}</span>
          <span className="ui-mcp-badge builtin">{t("plugins.builtin.badge")}</span>
        </div>
        {displayDesc ? <p className="ui-detail-hero-lead">{displayDesc}</p> : null}
        <dl className="ui-detail-meta">
          <div className="ui-detail-meta-row">
            <dt>{t("plugins.detail.source")}</dt>
            <dd>{info ? `v${info.version} · ${tOr(t, `plugins.category.${info.category}`, info.category)}` : ""}</dd>
          </div>
        </dl>
      </header>

      {/* Actions — built-in items are read-only */}
      <section className="ui-detail-actions">
        <span className="ui-detail-readonly">{t("plugins.builtin.readonly")}</span>
      </section>

      {/* Documentation */}
      <section className="ui-detail-doc">
        <h3>{t("plugins.detail.doc")}</h3>
        {docError ? (
          <div className="ui-plugin-detail-empty">{t("plugins.detail.docError")}</div>
        ) : doc ? (
          <div className="ui-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(doc) }} />
        ) : null}
      </section>
    </div>
  );
}

/**
 * Detail pane for a built-in plugin group — the unified "plugin card". Lists the
 * skills, MCP servers, and plugin descriptors bundled into this group as
 * read-only member sections (all built-in items are non-removable).
 */
function PluginGroupDetail({ groupId }: { groupId: string }): JSX.Element {
  const { t } = useI18n();
  const [group, setGroup] = useState<BuiltinPluginGroup | null>(null);

  // Fetch the group on mount/groupId change, guarding against the stale-response
  // race: rapidly selecting group A then B fires both pluginBuiltinGroups()
  // requests; if A resolves last it would overwrite B. The cancelled flag now
  // actually gates the setState (earlier code set it but reload() ignored it).
  useEffect(() => {
    let cancelled = false;
    setGroup(null);
    void (async () => {
      try {
        const list = await api.pluginBuiltinGroups();
        if (cancelled) return;
        setGroup(list.find((g) => g.id === groupId) ?? null);
      } catch {
        /* noop */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [groupId]);

  if (!group) {
    return (
      <div className="ui-plugin-detail">
        <div className="ui-plugin-detail-empty">{t("plugins.detail.empty")}</div>
      </div>
    );
  }

  const displayName = builtinLabel(t, group.id, "name", group.name);
  const displayDesc = builtinLabel(t, group.id, "desc", group.description);
  const hasMembers = group.skills.length > 0 || group.mcpServers.length > 0 || group.plugins.length > 0;

  return (
    <div className="ui-plugin-detail">
      {/* Hero card */}
      <header className="ui-detail-hero">
        <div className="ui-detail-hero-title">
          <span className="ui-detail-hero-name">{displayName}</span>
          <span className="ui-mcp-badge builtin">{t("plugins.builtin.badge")}</span>
        </div>
        {displayDesc ? <p className="ui-detail-hero-lead">{displayDesc}</p> : null}
        <dl className="ui-detail-meta">
          <div className="ui-detail-meta-row">
            <dt>{t("plugins.detail.source")}</dt>
            <dd>{tOr(t, `plugins.category.${group.category}`, group.category)}</dd>
          </div>
        </dl>
      </header>

      {/* Actions — built-in groups are read-only */}
      <section className="ui-detail-actions">
        <span className="ui-detail-readonly">{t("plugins.builtin.readonly")}</span>
      </section>

      {/* Members — each skill / plugin (CLI) / MCP server gets its own card
          with a description and a provenance note. */}
      {hasMembers ? (
        <section className="ui-detail-caps">
          {group.plugins.length > 0 ? (
            <div className="ui-plugin-cap-group">
              <span className="ui-plugin-cap-label">
                {t("plugins.detail.includesPlugins")} · {group.plugins.length}
              </span>
              <div className="ui-member-list">
                {group.plugins.map((p) => {
                  const desc = builtinLabel(t, p.name, "desc", p.description);
                  return (
                    <div key={p.name} className="ui-member-row">
                      <div className="ui-member-head">
                        <span className="ui-member-name">{builtinLabel(t, p.name, "name", p.name)}</span>
                        <span className="ui-member-type">{t("plugins.detail.memberCli")}</span>
                      </div>
                      {desc ? <div className="ui-member-desc">{desc}</div> : null}
                      <div className="ui-member-src">
                        {t("plugins.detail.source")}: {t("plugins.detail.sourceBundled")} · v{p.version} ·{" "}
                        {tOr(t, `plugins.category.${p.category}`, p.category)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
          {group.skills.length > 0 ? (
            <div className="ui-plugin-cap-group">
              <span className="ui-plugin-cap-label">
                {t("plugins.detail.includesSkills")} · {group.skills.length}
              </span>
              <div className="ui-member-list">
                {group.skills.map((s) => {
                  const desc = builtinLabel(t, s.name, "desc", s.description);
                  // Provenance: plugin:<pkg>/… → the owning plugin package;
                  // anything else in a built-in group is bundled with the app.
                  const source = s.path.startsWith("plugin:")
                    ? t("plugins.detail.sourcePackage", { name: s.path.slice("plugin:".length).split("/")[0] ?? "" })
                    : t("plugins.detail.sourceBundled");
                  return (
                    <div key={s.name} className="ui-member-row">
                      <div className="ui-member-head">
                        <span className="ui-member-name">{builtinLabel(t, s.name, "name", s.name)}</span>
                        <span className="ui-member-type">{t("plugins.detail.memberSkill")}</span>
                      </div>
                      {desc ? <div className="ui-member-desc">{desc}</div> : null}
                      <div className="ui-member-src">
                        {t("plugins.detail.source")}: {source}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
          {group.mcpServers.length > 0 ? (
            <div className="ui-plugin-cap-group">
              <span className="ui-plugin-cap-label">
                {t("plugins.detail.includesMcp")} · {group.mcpServers.length}
              </span>
              <div className="ui-member-list">
                {group.mcpServers.map((m) => {
                  // gitmcp:* entries share the generic GitMCP description.
                  const descName = m.name.startsWith("gitmcp:") ? "gitmcp" : m.name;
                  const desc = builtinLabel(t, descName, "desc", "");
                  const derived = deriveMcpSource(m.config.command, (m.config.args ?? []).join(" "));
                  // The derived label is only informative when it names a
                  // package (npm/PyPI); a raw binary path adds nothing here.
                  const informative = /^(npm|PyPI) · /.test(derived.label);
                  const source = informative
                    ? `${t("plugins.detail.sourceBundled")} · ${derived.label}`
                    : t("plugins.detail.sourceBundled");
                  return (
                    <div key={m.name} className="ui-member-row">
                      <div className="ui-member-head">
                        <StatusDot status={m.status} />
                        <span className="ui-member-name">{m.name}</span>
                        <span className="ui-member-type">{t("plugins.detail.memberMcp")}</span>
                      </div>
                      {desc ? <div className="ui-member-desc">{desc}</div> : null}
                      <div className="ui-member-src">
                        {t("plugins.detail.source")}: {source}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
