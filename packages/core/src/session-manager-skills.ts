// SessionManager layer — see session-manager-base.ts for the split rationale.
import matter from "gray-matter";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { buildSkillDocumentsPrompt, getExtensionRoot } from "./prompt";
import { buildThinkingRequestOptions } from "./common/openai-thinking";
import { formatSessionPrompt } from "./common/session-prompts";
import { isChineseLocale } from "./session-helpers";
import { isSkillForCurrentPlatform } from "./session-mcp-hints";
import { SessionManagerDiagnostics } from "./session-manager-diagnostics";
import { SkillMatchCache } from "./common/skill-match-cache";
import { timedRoutingEvent } from "./routing";
import { type RouterBundle, renderShardedContent, shardSkillDocument } from "./routing";
import type {
  SkillInfo,
  BuiltinPluginInfo,
  BuiltinPluginGroup,
  McpServerConfigEntry,
  BuiltinPluginGroupManifest,
} from "./session-types";

export abstract class SessionManagerSkills extends SessionManagerDiagnostics {
  async identifyMatchingSkillNames(
    skills: SkillInfo[],
    userPrompt: string,
    options?: { signal?: AbortSignal; sessionId?: string }
  ): Promise<string[]> {
    this.throwIfAborted(options?.signal);
    let systemPrompt = `When users ask you to perform tasks, check if any of the available skills match the goal and situation. Skills provide specialized capabilities and domain knowledge.\n
Response in JSON format:
\`\`\`
{
  "skillNames": ["", ...],
  "multiIntent": false
}
\`\`\`\n
If none of the available skills match, respond with an empty array, i.e. \`{"skillNames": [], "multiIntent": false}\`.\n
Set "multiIntent" to true ONLY when the request clearly combines multiple distinct goals that need different skills (e.g. "generate slides AND run the tests"). Single-purpose requests, however complex, are multiIntent: false.\n
`;
    const simpleSkills = skills
      .filter((x) => !x.isLoaded && x.allowImplicitInvocation !== false)
      .map((x) => ({
        name: x.name,
        description: x.description,
        // R2 compositional metadata (optional; absent → behavior unchanged).
        categories: x.categories,
        inputs: x.inputs,
        outputs: x.outputs,
      }));
    if (simpleSkills.length === 0) {
      return [];
    }
    const candidateSkillNames = new Set(simpleSkills.map((skill) => skill.name));

    // Phase 3 / T3.2: identical prompt + identical candidate pool replays the
    // cached match (covers the deferred-permission re-send of the same prompt,
    // and any user retry of the same text) — zero embedding + zero LLM cost.
    const poolSignature = SkillMatchCache.poolSignature(simpleSkills);
    const cachedMatch = this.skillMatchCache.get(poolSignature, userPrompt);
    if (cachedMatch) {
      return cachedMatch;
    }

    // G1 routing: reduce the candidate pool via embedding recall before sending
    // to the flash LLM. Fail-open (null) → use full simpleSkills list.
    let pool: Array<{ name: string; description: string }> = simpleSkills;
    try {
      const { skillRouter } = await this.getRouters();
      if (skillRouter) {
        const shortlist = await timedRoutingEvent(
          "G1",
          () => skillRouter.shortlist(userPrompt, simpleSkills),
          (result) => (result && result.length > 0 ? "hit" : "skip"),
          { sessionId: options?.sessionId, counts: { candidates: simpleSkills.length } }
        );
        if (shortlist && shortlist.length > 0) {
          pool = shortlist;
        }
      }
    } catch {
      // Routing error → fail-open, use full pool.
    }

    const { client, baseURL, debugLogEnabled, model } = this.createBackgroundLlm();
    if (!client) {
      return [];
    }
    // Skill matching is a tiny classification task — route it to the family's
    // lightweight model with thinking explicitly disabled and a tight output
    // cap so it never burns pro-level reasoning tokens or adds avoidable latency.

    const agentInstructions = this.loadAgentInstructions();
    if (agentInstructions) {
      systemPrompt += `Use the current agent instructions as additional context when deciding which skills match:\n
<agent-instructions>
${agentInstructions}
</agent-instructions>\n
`;
    }
    systemPrompt += "The candidate skills are as follows:\n\n";
    systemPrompt += "```\n" + JSON.stringify(pool, null, 2) + "\n```";

    try {
      const response = await this.createChatCompletionStream(
        client,
        {
          model,
          temperature: 0.1,
          max_tokens: 256,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          response_format: { type: "json_object" },
          ...buildThinkingRequestOptions(false, baseURL, "max", model),
        },
        options?.signal ? { signal: options.signal } : undefined,
        options?.sessionId,
        {
          enabled: debugLogEnabled,
          location: "SessionManager.identifyMatchingSkillNames",
          baseURL,
          params: { purpose: "skill-matching", model, temperature: 0.1 },
        },
        { source: "auxiliary" }
      );
      this.throwIfAborted(options?.signal);

      const rawContent = response.choices?.[0]?.message?.content;
      const content = typeof rawContent === "string" ? rawContent : "";
      if (!content) {
        return [];
      }

      const parsed = JSON.parse(content);
      if (parsed && Array.isArray(parsed.skillNames)) {
        const skillNames = parsed.skillNames.filter(
          (skillName: unknown): skillName is string =>
            typeof skillName === "string" && candidateSkillNames.has(skillName)
        );
        // G3 compositional routing — gated on the multi-intent judgment made by
        // the SAME flash call above: single-intent turns pay zero extra calls
        // (previously every prompt ran an SAD decomposition first, and a
        // lower-confidence embedding-only path could short-circuit this
        // verified one).
        if (parsed.multiIntent === true) {
          const composed = await this.composeSkillRoute(userPrompt, simpleSkills, candidateSkillNames, options);
          if (composed && composed.length > 0) {
            const merged = [...new Set([...skillNames, ...composed])];
            this.skillMatchCache.set(poolSignature, userPrompt, merged);
            return merged;
          }
        }
        this.skillMatchCache.set(poolSignature, userPrompt, skillNames);
        return skillNames;
      }

      return [];
    } catch (error) {
      if (this.isAbortLikeError(error) || options?.signal?.aborted) {
        throw error;
      }
      return [];
    }
  }

  /**
   * G3 compositional routing (multi-intent only — gated by the multiIntent
   * judgment in identifyMatchingSkillNames). Decompose → retrieve → compose;
   * returns white-listed skill names, or null (fail-open) when the pipeline
   * declines or fails — the G1 result is then used unchanged. When a plan is
   * adopted, its step/DAG orchestration is injected as a hidden system message
   * so the composition (not just the flat skill list) reaches the agent.
   */
  protected async composeSkillRoute(
    userPrompt: string,
    simpleSkills: Array<{
      name: string;
      description: string;
      categories?: string[];
      inputs?: string[];
      outputs?: string[];
    }>,
    candidateSkillNames: Set<string>,
    options?: { signal?: AbortSignal; sessionId?: string }
  ): Promise<string[] | null> {
    try {
      const { skillRouter } = await this.getRouters();
      if (!skillRouter) return null;
      // R2: carry the frontmatter metadata contract into the Compose stage —
      // ioTypeCoercion/categoryJaccard become live instead of always zero.
      const compSkills = simpleSkills.map((s) => ({
        name: s.name,
        description: s.description,
        ...(s.categories ? { categories: s.categories } : {}),
        ...(s.inputs ? { inputTypes: s.inputs } : {}),
        ...(s.outputs ? { outputTypes: s.outputs } : {}),
      }));
      const decomposer = this.createSkillDecomposer(options);
      const plan = await timedRoutingEvent(
        "G3",
        () => skillRouter.composeRoute(userPrompt, compSkills, decomposer),
        (result) => (result && result.steps.length > 1 ? "hit" : "skip"),
        { sessionId: options?.sessionId, counts: { candidates: simpleSkills.length } }
      );
      if (!plan || plan.steps.length <= 1) return null;
      const matched = new Set<string>();
      for (const step of plan.steps) {
        // White-list filter — same anti-hallucination guarantee as the G1 path.
        if (step.skill && candidateSkillNames.has(step.skill.name)) {
          matched.add(step.skill.name);
        }
      }
      if (matched.size === 0) return null;
      const orchestration = this.renderOrchestrationPrompt(plan);
      if (orchestration && options?.sessionId) {
        this.appendSessionMessage(options.sessionId, this.buildSystemMessage(options.sessionId, orchestration));
      }
      return [...matched];
    } catch {
      return null; // fail-open to the G1 result
    }
  }

  /** Render a CompositionPlan as an execution-order hint for the agent. */
  protected renderOrchestrationPrompt(plan: {
    steps: Array<{ subTask?: { description?: string }; skill: { name: string } | null }>;
    dependencies: Array<[number, number]>;
  }): string | null {
    if (plan.steps.length === 0) return null;
    const lines = plan.steps
      .map(
        (s, i) =>
          `${i + 1}. ${s.subTask?.description ?? "(unnamed step)"}${s.skill ? ` — use the "${s.skill.name}" skill` : ""}`
      )
      .join("\n");
    const deps =
      plan.dependencies.length > 0
        ? `\nStep dependencies (earlier steps feed later ones): ${plan.dependencies
            .map(([from, to]) => `${from + 1} → ${to + 1}`)
            .join("; ")}`
        : "";
    return (
      `<orchestration-plan>\n` +
      `The user's request was decomposed into ${plan.steps.length} steps. ` +
      `Execute them in order unless the dependencies say otherwise:\n${lines}${deps}\n` +
      `</orchestration-plan>`
    );
  }

  /**
   * Rewrite a draft user prompt into a clearer, more actionable prompt.
   * Like skill matching, this is a lightweight single-turn task and is always
   * routed to the flash model with thinking disabled — it must never consume
   * pro-level reasoning tokens.
   */
  async enhancePrompt(draftPrompt: string, options?: { signal?: AbortSignal }): Promise<string> {
    this.throwIfAborted(options?.signal);
    const draft = draftPrompt.trim();
    if (!draft) {
      return draftPrompt;
    }

    const { client, baseURL, debugLogEnabled, model } = this.createBackgroundLlm();
    if (!client) {
      throw new Error(formatSessionPrompt("apiKeyMissingShort"));
    }

    const systemPrompt = `You are a prompt engineer for a coding agent. Rewrite the user's draft prompt so the agent can act on it precisely.

Rules:
- Keep the user's original intent, scope and language (Chinese stays Chinese, English stays English).
- Make the goal explicit; clarify vague verbs; keep any file paths, code identifiers, error messages and constraints verbatim.
- Structure multi-part requests as short numbered points when it helps.
- Do NOT invent requirements, do NOT ask questions, do NOT add explanations.
- Output ONLY the rewritten prompt text, no preamble, no quotes, no markdown fences.`;

    const response = await this.createChatCompletionStream(
      client,
      {
        model,
        temperature: 0.3,
        max_tokens: 2048,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: draft },
        ],
        ...buildThinkingRequestOptions(false, baseURL, "max", model),
      },
      options?.signal ? { signal: options.signal } : undefined,
      undefined,
      {
        enabled: debugLogEnabled,
        location: "SessionManager.enhancePrompt",
        baseURL,
        params: { purpose: "prompt-enhance", model, temperature: 0.3 },
      },
      { source: "auxiliary" }
    );
    this.throwIfAborted(options?.signal);

    const rawContent = response.choices?.[0]?.message?.content;
    const enhanced = typeof rawContent === "string" ? rawContent.trim() : "";
    return enhanced || draftPrompt;
  }

  protected getSkillScanRoots(): Array<{ root: string; displayRoot: string }> {
    const homeDir = os.homedir();
    return [
      { root: path.join(this.projectRoot, ".deeporca", "skills"), displayRoot: "./.deeporca/skills" },
      { root: path.join(this.projectRoot, ".deepcode", "skills"), displayRoot: "./.deepcode/skills" },
      { root: path.join(this.projectRoot, ".agents", "skills"), displayRoot: "./.agents/skills" },
      { root: path.join(homeDir, ".deeporca", "skills"), displayRoot: "~/.deeporca/skills" },
      { root: path.join(homeDir, ".deepcode", "skills"), displayRoot: "~/.deepcode/skills" },
      { root: path.join(homeDir, ".agents", "skills"), displayRoot: "~/.agents/skills" },
      { root: this.getBundledSkillsRoot(), displayRoot: "bundled:" },
    ];
  }

  protected getBundledSkillsRoot(): string {
    const extensionRoot = getExtensionRoot();
    const sourceRoot = path.join(extensionRoot, "templates", "skills", "bundled");

    // Source check keeps local development/tests on the checked-in templates.
    if (fs.existsSync(path.join(extensionRoot, "src", "session.ts")) && fs.existsSync(sourceRoot)) {
      return sourceRoot;
    }

    // In the published bundle, getExtensionRoot() resolves to dist/ and
    // bundled skills are copied to dist/bundled/ (not dist/templates/skills/bundled/).
    const distRoot = path.join(extensionRoot, "bundled");
    return fs.existsSync(distRoot) ? distRoot : sourceRoot;
  }

  /**
   * Resolve skill directories inside plugin packages. Each plugin package at
   * `templates/plugins/<pkg>/skills/<skill>/SKILL.md` contributes skills that
   * are tagged `pluginOwned: true` so the Skills tab can filter them out.
   */
  protected getPluginSkillRoots(): Array<{ root: string; displayRoot: string; pkgName: string }> {
    const extensionRoot = getExtensionRoot();
    const pluginsDir = path.join(extensionRoot, "templates", "plugins");
    const distPluginsDir = path.join(extensionRoot, "plugins");
    const base =
      fs.existsSync(distPluginsDir) && !fs.existsSync(path.join(extensionRoot, "src", "session.ts"))
        ? distPluginsDir
        : pluginsDir;
    if (!fs.existsSync(base)) return [];
    const roots: Array<{ root: string; displayRoot: string; pkgName: string }> = [];
    try {
      for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
        const pkgSkillsDir = path.join(base, entry.name, "skills");
        if (!fs.existsSync(pkgSkillsDir)) continue;
        roots.push({
          root: pkgSkillsDir,
          displayRoot: `plugin:${entry.name}`,
          pkgName: entry.name,
        });
      }
    } catch {
      // unreadable — skip
    }
    return roots;
  }

  async listSkills(sessionId?: string): Promise<SkillInfo[]> {
    const skillRoots = this.getSkillScanRoots();
    const enabledSkills = this.getResolvedSettings().enabledSkills ?? {};
    const skillsByName = new Map<string, SkillInfo>();

    const collectSkills = (root: string, displayRoot: string): SkillInfo[] => {
      if (!fs.existsSync(root)) {
        return [];
      }
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(root, { withFileTypes: true });
      } catch {
        return [];
      }

      const results: SkillInfo[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) {
          continue;
        }
        const skillName = entry.name;
        const skillPath = path.join(root, skillName, "SKILL.md");
        try {
          if (!fs.existsSync(skillPath)) {
            continue;
          }
          const stat = fs.statSync(skillPath);
          if (!stat.isFile()) {
            continue;
          }
        } catch {
          continue;
        }
        const displayPath =
          displayRoot === "bundled:" ? `bundled:${skillName}/SKILL.md` : `${displayRoot}/${skillName}/SKILL.md`;
        const skill = this.readSkillInfo(skillPath, displayPath, skillName);
        if (enabledSkills[skill.name] === false) {
          continue;
        }
        results.push(skill);
      }
      return results;
    };

    for (const { root, displayRoot } of skillRoots) {
      for (const skill of collectSkills(root, displayRoot)) {
        // Platform-conditional filtering: skills with known platform prefixes
        // are only loaded on matching OS. All other skills load on all platforms.
        if (!isSkillForCurrentPlatform(skill.name)) {
          continue;
        }
        if (!skillsByName.has(skill.name)) {
          skillsByName.set(skill.name, skill);
        }
      }
    }

    // Scan skills inside plugin packages (templates/plugins/<pkg>/skills/).
    // These are tagged pluginOwned so the Skills tab can hide them — they are
    // surfaced via the Plugins tab group cards instead. LLM auto-matching and
    // prompt injection still work exactly the same as standalone skills.
    for (const { root, displayRoot } of this.getPluginSkillRoots()) {
      for (const skill of collectSkills(root, displayRoot)) {
        if (!isSkillForCurrentPlatform(skill.name)) continue;
        if (!skillsByName.has(skill.name)) {
          skill.pluginOwned = true;
          skillsByName.set(skill.name, skill);
        }
      }
    }

    if (sessionId) {
      const loadedSkillKeys = this.getLoadedSkillKeys(sessionId);
      for (const skill of skillsByName.values()) {
        if (loadedSkillKeys.has(this.getSkillKey(skill)) || loadedSkillKeys.has(this.getSkillKeyByName(skill.name))) {
          skill.isLoaded = true;
        }
      }
    }

    return Array.from(skillsByName.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Containment gate for skill-doc reads (same threat model as the desktop's
   * archmap path pin): the resolved file must live inside one of the known
   * skill scan/plugin roots AND be named a SKILL.md document. Without this,
   * resolveSkillPath happily maps `~/`-prefixed or absolute display strings to
   * ANY filesystem path, turning this IPC-exposed reader into an
   * arbitrary-file-read primitive (settings.json holds plaintext API keys).
   */
  protected isTrustedSkillDocPath(candidate: string): boolean {
    if (!/(^|[\\/])SKILL(\.zh)?\.md$/i.test(candidate)) {
      return false;
    }
    let resolvedFile: string;
    try {
      resolvedFile = fs.realpathSync(candidate);
    } catch {
      return false;
    }
    const roots = [...this.getSkillScanRoots().map((r) => r.root), ...this.getPluginSkillRoots().map((r) => r.root)];
    for (const root of roots) {
      let realRoot: string;
      try {
        realRoot = fs.realpathSync(root);
      } catch {
        continue;
      }
      if (resolvedFile === realRoot || resolvedFile.startsWith(`${realRoot}${path.sep}`)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Read the raw SKILL.md markdown for a skill by its (display) `path` — the same
   * value surfaced on SkillInfo. The desktop plugin center renders this document.
   * Resolution reuses resolveSkillPath so bundled/home/project display paths all
   * map back to a real file (with the bundled-traversal guard preserved), and the
   * result is gated by isTrustedSkillDocPath so out-of-root paths read as empty.
   *
   * When `locale` is a Chinese variant (zh / zh-TW / zh-HK / zh-CN), a sibling
   * `SKILL.zh.md` is preferred if present, falling back to the original file.
   * Prompt injection should NOT pass a locale (it always uses the canonical doc).
   */
  readSkillDocument(skillPath: string, locale?: string): string {
    const basePath = this.resolveSkillPath(skillPath);
    if (!this.isTrustedSkillDocPath(basePath)) {
      return "";
    }
    if (isChineseLocale(locale)) {
      const zhPath = basePath.replace(/\.md$/i, ".zh.md");
      if (fs.existsSync(zhPath) && this.isTrustedSkillDocPath(zhPath)) {
        return fs.readFileSync(zhPath, "utf8");
      }
    }
    if (!fs.existsSync(basePath)) {
      return "";
    }
    return fs.readFileSync(basePath, "utf8");
  }

  // ── Orca Built-in Plugins ────────────────────────────────────────────────────

  /** Root directory containing built-in plugin folders. */
  protected getBuiltinPluginsRoot(): string {
    const extensionRoot = getExtensionRoot();
    const sourceRoot = path.join(extensionRoot, "templates", "plugins");

    // Source check keeps local development/tests on the checked-in templates.
    if (fs.existsSync(path.join(extensionRoot, "src", "session.ts")) && fs.existsSync(sourceRoot)) {
      return sourceRoot;
    }

    // In the published bundle, plugins are copied to dist/plugins/.
    const distRoot = path.join(extensionRoot, "plugins");
    return fs.existsSync(distRoot) ? distRoot : sourceRoot;
  }

  /**
   * List all built-in plugins. Plugin packages live at
   * `templates/plugins/<pkg>/` and may contain nested sub-plugins at
   * `templates/plugins/<pkg>/plugins/<sub>/plugin.json`.
   * We scan BOTH the top level (for packages that ARE plugins themselves) and
   * the nested `plugins/` subdirectory inside each package.
   */
  listBuiltinPlugins(): BuiltinPluginInfo[] {
    const root = this.getBuiltinPluginsRoot();
    if (!fs.existsSync(root)) {
      return [];
    }
    const plugins: BuiltinPluginInfo[] = [];

    const tryReadPlugin = (dir: string, entryName: string): void => {
      const manifestPath = path.join(dir, entryName, "plugin.json");
      try {
        if (!fs.existsSync(manifestPath)) return;
        const raw = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
        plugins.push({
          name: typeof raw.name === "string" ? raw.name : entryName,
          version: typeof raw.version === "string" ? raw.version : "1.0.0",
          description: typeof raw.description === "string" ? raw.description : "",
          category: typeof raw.category === "string" ? raw.category : "general",
          removable: false,
          path: `builtin-plugin:${entryName}`,
        });
      } catch {
        // skip
      }
    };

    try {
      const packages = fs.readdirSync(root, { withFileTypes: true });
      for (const pkgEntry of packages) {
        if (!pkgEntry.isDirectory() && !pkgEntry.isSymbolicLink()) continue;
        const pkgDir = path.join(root, pkgEntry.name);
        // Check if the package itself has a plugin.json (legacy flat layout)
        tryReadPlugin(root, pkgEntry.name);
        // Scan nested plugins/ subdirectory
        const nestedPluginsDir = path.join(pkgDir, "plugins");
        if (fs.existsSync(nestedPluginsDir)) {
          try {
            for (const subEntry of fs.readdirSync(nestedPluginsDir, { withFileTypes: true })) {
              if (!subEntry.isDirectory() && !subEntry.isSymbolicLink()) continue;
              tryReadPlugin(nestedPluginsDir, subEntry.name);
            }
          } catch {
            // unreadable — skip
          }
        }
      }
    } catch {
      // unreadable — return empty
    }
    return plugins.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Read the PLUGIN.md instruction document for a built-in plugin by its name.
   * Used by the desktop plugin detail pane and by prompt injection.
   *
   * When `locale` is a Chinese variant (zh / zh-TW / zh-HK / zh-CN), a sibling
   * `PLUGIN.zh.md` is preferred if present, falling back to the original file.
   * Prompt injection should NOT pass a locale (it always uses the canonical doc).
   */
  readBuiltinPluginDoc(pluginName: string, locale?: string): string {
    const root = this.getBuiltinPluginsRoot();
    const resolvedRoot = path.resolve(root);
    const tryRead = (p: string): string | null => {
      try {
        return fs.readFileSync(p, "utf8");
      } catch {
        return null;
      }
    };

    // Search candidate paths: top-level (legacy flat layout) and nested inside
    // any plugin package's plugins/ subdirectory.
    const candidates: string[] = [path.join(root, pluginName, "PLUGIN.md")];
    try {
      for (const pkgEntry of fs.readdirSync(root, { withFileTypes: true })) {
        if (!pkgEntry.isDirectory() && !pkgEntry.isSymbolicLink()) continue;
        const nestedDir = path.join(root, pkgEntry.name, "plugins", pluginName);
        candidates.push(path.join(nestedDir, "PLUGIN.md"));
      }
    } catch {
      // unreadable root — top-level candidate is enough
    }

    for (const candidate of candidates) {
      const resolvedPath = path.resolve(candidate);
      // Traversal guard
      if (!resolvedPath.startsWith(`${resolvedRoot}${path.sep}`) && resolvedPath !== resolvedRoot) {
        continue;
      }
      if (isChineseLocale(locale)) {
        const zhPath = resolvedPath.replace(/\.md$/i, ".zh.md");
        const zh = tryRead(zhPath);
        if (zh !== null) return zh;
      }
      const content = tryRead(resolvedPath);
      if (content !== null) return content;
    }
    return "";
  }

  /**
   * Resolve built-in plugin groups from `skill.plugin.md` files. Each plugin
   * package directory `templates/plugins/<pkg>/skill.plugin.md` defines one
   * group via YAML frontmatter (name, description, category, skills[], mcp[],
   * plugins[]). The skill/mcp/plugin arrays are matched against the live lists
   * to produce concrete group members.
   *
   * This is display-only metadata — it never affects loading, enabling, or
   * execution of skills/MCP/plugins.
   */
  listBuiltinPluginGroups(
    skills: SkillInfo[],
    mcpServers: McpServerConfigEntry[],
    builtinPlugins: BuiltinPluginInfo[]
  ): BuiltinPluginGroup[] {
    const root = this.getBuiltinPluginsRoot();
    if (!fs.existsSync(root)) return [];

    // Collect manifests from skill.plugin.md files.
    const manifests: BuiltinPluginGroupManifest[] = [];
    try {
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
        const pluginMdPath = path.join(root, entry.name, "skill.plugin.md");
        if (!fs.existsSync(pluginMdPath)) continue;
        try {
          const raw = fs.readFileSync(pluginMdPath, "utf8");
          const parsed = matter(raw);
          const data = parsed.data as Record<string, unknown>;
          // Extract skill names from frontmatter `skills` array (each item has {name, description})
          const skillItems = Array.isArray(data.skills) ? (data.skills as Array<Record<string, unknown>>) : [];
          const skillNames = skillItems.map((s) => (typeof s?.name === "string" ? s.name : "")).filter(Boolean);
          // Extract mcp names
          const mcpNames = Array.isArray(data.mcp) ? (data.mcp as string[]) : [];
          // Extract plugin names
          const pluginNames = Array.isArray(data.plugins) ? (data.plugins as string[]) : [];
          // Extract action ids (each item has {id, description} or is a string)
          const actionItems = Array.isArray(data.actions)
            ? (data.actions as Array<Record<string, unknown> | string>)
            : [];
          const actionIds = actionItems
            .map((a) => (typeof a === "string" ? a : typeof a?.id === "string" ? a.id : ""))
            .filter(Boolean);
          manifests.push({
            id: typeof data.name === "string" ? data.name : entry.name,
            name: typeof data.name === "string" ? data.name : entry.name,
            description: typeof data.description === "string" ? data.description : "",
            category: typeof data.category === "string" ? data.category : "general",
            icon: typeof data.icon === "string" ? data.icon : undefined,
            skills: skillNames.length > 0 ? skillNames : undefined,
            mcp: mcpNames.length > 0 ? mcpNames : undefined,
            plugins: pluginNames.length > 0 ? pluginNames : undefined,
            actions: actionIds.length > 0 ? actionIds : undefined,
          });
        } catch {
          // unreadable plugin.md — skip
        }
      }
    } catch {
      // unreadable dir — return empty
    }

    const matchName = (patterns: string[] | undefined, name: string): boolean => {
      if (!patterns) return false;
      return patterns.some((p) => {
        if (p.endsWith(":*")) return name.startsWith(p.slice(0, -1));
        if (p.endsWith("-*")) return name.startsWith(p.slice(0, -1));
        return p === name;
      });
    };

    const matchedSkills = new Set<string>();
    const matchedMcp = new Set<string>();
    const matchedPlugins = new Set<string>();
    const matchedActions = new Set<string>();

    // All registered action ids (for matching against group declarations).
    const allActionDefs = this.actionRegistry.toToolDefinitions();
    const allActionEntries = allActionDefs.map((d) => ({
      id: d.function.name,
      description: d.function.description ?? "",
    }));

    // Skills that are ALSO shipped as plugins — exclude from skills list to
    // avoid duplicate display within a group.
    const pluginNamesSet = new Set(builtinPlugins.map((p) => p.name));

    const groups: BuiltinPluginGroup[] = manifests.map((m) => {
      const groupSkills = skills.filter((s) => {
        if (pluginNamesSet.has(s.name)) return false;
        if (matchName(m.skills, s.name)) {
          matchedSkills.add(s.name);
          return true;
        }
        return false;
      });
      const groupMcp = mcpServers.filter((e) => {
        if (matchName(m.mcp, e.name)) {
          matchedMcp.add(e.name);
          return true;
        }
        return false;
      });
      const groupPlugins = builtinPlugins.filter((p) => {
        if (matchName(m.plugins, p.name)) {
          matchedPlugins.add(p.name);
          return true;
        }
        return false;
      });
      // Match actions by id prefix (e.g. "review.*" matches "review.run", "review.full").
      const groupActions = allActionEntries.filter((a) => {
        if (matchName(m.actions, a.id)) {
          matchedActions.add(a.id);
          return true;
        }
        return false;
      });
      return {
        id: m.id,
        name: m.name,
        description: m.description,
        category: m.category,
        icon: m.icon,
        platform: m.platform,
        skills: groupSkills,
        mcpServers: groupMcp,
        plugins: groupPlugins,
        actions: groupActions,
      };
    });

    // Catch-all "other" group for built-in items not claimed by any plugin package.
    const leftoverSkills = skills.filter((s) => !matchedSkills.has(s.name));
    const leftoverMcp = mcpServers.filter((e) => !matchedMcp.has(e.name));
    const leftoverPlugins = builtinPlugins.filter((p) => !matchedPlugins.has(p.name));
    const leftoverActions = allActionEntries.filter((a) => !matchedActions.has(a.id));
    if (leftoverSkills.length || leftoverMcp.length || leftoverPlugins.length || leftoverActions.length) {
      groups.push({
        id: "other",
        name: "Other",
        description: "Built-in items not assigned to a plugin package.",
        category: "other",
        skills: leftoverSkills,
        mcpServers: leftoverMcp,
        plugins: leftoverPlugins,
        actions: leftoverActions,
      });
    }

    return groups;
  }

  protected resolveSkillPath(skillPath: string): string {
    if (skillPath.startsWith("plugin:")) {
      // Plugin-owned skill: path format is "plugin:<pkgName>/<skillDir>/SKILL.md"
      const relativePath = skillPath.slice("plugin:".length);
      const sepIdx = relativePath.indexOf("/");
      if (sepIdx > 0) {
        const pkgName = relativePath.slice(0, sepIdx);
        const skillRelPath = relativePath.slice(sepIdx + 1);
        const pluginRoots = this.getPluginSkillRoots();
        const root = pluginRoots.find((r) => r.pkgName === pkgName);
        if (root) {
          const resolvedPath = path.resolve(root.root, skillRelPath);
          const resolvedRoot = path.resolve(root.root);
          if (resolvedPath === resolvedRoot || !resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)) {
            return path.join(root.root, "__invalid_plugin_skill__");
          }
          return resolvedPath;
        }
      }
      return path.join(os.homedir(), "__unresolved_plugin_skill__");
    }
    if (skillPath.startsWith("bundled:")) {
      const relativePath = skillPath.slice("bundled:".length);
      const root = this.getBundledSkillsRoot();
      const resolvedPath = path.resolve(root, relativePath);
      const resolvedRoot = path.resolve(root);
      if (resolvedPath === resolvedRoot || !resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)) {
        return path.join(root, "__invalid_bundled_skill__");
      }
      return resolvedPath;
    }
    if (skillPath.startsWith("~/")) {
      return path.join(os.homedir(), skillPath.slice(2));
    }
    if (skillPath.startsWith("~\\")) {
      return path.join(os.homedir(), skillPath.slice(2));
    }
    if (skillPath.startsWith("./")) {
      return path.join(this.projectRoot, skillPath.slice(2));
    }
    if (skillPath.startsWith(".\\")) {
      return path.join(this.projectRoot, skillPath.slice(2));
    }
    if (path.isAbsolute(skillPath)) {
      return skillPath;
    }
    return path.join(os.homedir(), skillPath);
  }

  protected async buildSkillPrompt(skill: SkillInfo, promptText?: string): Promise<string> {
    const skillPath = this.resolveSkillPath(skill.path);
    const content = fs.readFileSync(skillPath, "utf-8");
    // G3: large SKILL.md documents inject header + section index + the shards
    // recalled for THIS prompt instead of the full text (fail-open → full).
    const shardedContent = await this.maybeShardSkillContent(content, promptText);
    return buildSkillDocumentsPrompt([
      {
        name: skill.name,
        content: shardedContent ?? content,
        path: skillPath,
        skillFilePath: skillPath,
      },
    ]);
  }

  /**
   * G3 shard-recall (specs/skill-routing 目标表): returns the replacement
   * content for a LARGE skill, or null when the full content should be
   * injected (small doc, routing off, embedding unavailable, recall failure —
   * every path is fail-open by design).
   */
  protected async maybeShardSkillContent(content: string, promptText?: string): Promise<string | null> {
    if (!promptText || !promptText.trim()) return null;
    let bundle: RouterBundle;
    try {
      bundle = await this.getRouters();
    } catch {
      return null;
    }
    if (!bundle.shardRecaller || !this.shardConfig?.enabled) return null;
    const doc = shardSkillDocument(content, { minChars: this.shardConfig.minChars });
    if (!doc) return null;
    try {
      const picked = await bundle.shardRecaller.recall(promptText, doc, this.shardConfig.topK);
      return picked ? renderShardedContent(doc, picked) : null;
    } catch {
      return null;
    }
  }

  /**
   * Build the combined prompt from all built-in plugin packages. Each package's
   * `skill.plugin.md` body (markdown after frontmatter) is injected. Additionally,
   * any nested `plugins/<sub>/PLUGIN.md` files are included for backwards
   * compatibility with legacy plugin descriptors.
   */
  protected getBuiltinPluginPrompt(): string {
    const root = this.getBuiltinPluginsRoot();
    if (!fs.existsSync(root)) {
      return "";
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      return "";
    }

    const blocks: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) {
        continue;
      }
      const pkgDir = path.join(root, entry.name);

      // 1. Read skill.plugin.md body (primary — the package-level agent doc)
      const pluginMdPath = path.join(pkgDir, "skill.plugin.md");
      try {
        if (fs.existsSync(pluginMdPath)) {
          const raw = fs.readFileSync(pluginMdPath, "utf8");
          const parsed = matter(raw);
          const content = (parsed.content ?? "").trim();
          if (content) {
            const name = (parsed.data as Record<string, unknown>)?.name ?? entry.name;
            blocks.push(`<builtin-plugin name="${name}">
${content}
</builtin-plugin>`);
          }
        }
      } catch {
        // skip
      }

      // 2. Read nested plugins/<sub>/PLUGIN.md (sub-plugin descriptors)
      const nestedPluginsDir = path.join(pkgDir, "plugins");
      if (fs.existsSync(nestedPluginsDir)) {
        try {
          for (const sub of fs.readdirSync(nestedPluginsDir, { withFileTypes: true })) {
            if (!sub.isDirectory() && !sub.isSymbolicLink()) continue;
            const subDoc = path.join(nestedPluginsDir, sub.name, "PLUGIN.md");
            if (!fs.existsSync(subDoc)) continue;
            const content = fs.readFileSync(subDoc, "utf8").trim();
            if (content) {
              blocks.push(`<builtin-plugin name="${sub.name}">
${content}
</builtin-plugin>`);
            }
          }
        } catch {
          // skip
        }
      }
    }

    if (blocks.length === 0) {
      return "";
    }
    return `The following built-in plugins are always available. Use them when the task matches their capabilities:\n${blocks.join("\n\n")}`;
  }

  protected readSkillInfo(skillPath: string, displayPath: string, fallbackName: string): SkillInfo {
    const fallbackSkill: SkillInfo = {
      name: fallbackName.replace(/_/g, "-"),
      path: displayPath,
      description: "",
    };

    try {
      const skillMd = fs.readFileSync(skillPath, "utf8");
      const parsed = matter(skillMd);
      const metadata = parsed.data.metadata;
      const allowImplicitInvocation =
        metadata &&
        typeof metadata === "object" &&
        !Array.isArray(metadata) &&
        (metadata as Record<string, unknown>)["allow-implicit-invocation"] === false
          ? false
          : undefined;
      const stringList = (value: unknown): string[] | undefined => {
        if (!Array.isArray(value)) return undefined;
        const items = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
        return items.length > 0 ? items : undefined;
      };
      return {
        name:
          typeof parsed.data.name === "string" && parsed.data.name.trim()
            ? parsed.data.name.trim()
            : fallbackSkill.name,
        path: displayPath,
        description: typeof parsed.data.description === "string" ? parsed.data.description.trim() : "",
        allowImplicitInvocation,
        categories: stringList(parsed.data.categories),
        inputs: stringList(parsed.data.inputs),
        outputs: stringList(parsed.data.outputs),
      };
    } catch {
      return fallbackSkill;
    }
  }

  protected getSkillKey(skill: Pick<SkillInfo, "path">): string {
    return `path:${skill.path}`;
  }

  protected getSkillKeyByName(name: string): string {
    return `name:${name}`;
  }

  protected getLoadedSkillKeys(sessionId: string): Set<string> {
    const loadedSkillKeys = new Set<string>();
    for (const message of this.listSessionMessages(sessionId)) {
      if (message.role !== "system" || !message.meta?.skill) {
        continue;
      }
      loadedSkillKeys.add(this.getSkillKey(message.meta.skill));
      loadedSkillKeys.add(this.getSkillKeyByName(message.meta.skill.name));
    }
    return loadedSkillKeys;
  }

  protected dedupeSkills(skills?: SkillInfo[]): SkillInfo[] | undefined {
    if (!skills || skills.length === 0) {
      return undefined;
    }

    const dedupedSkills = new Map<string, SkillInfo>();
    for (const skill of skills) {
      if (!skill?.name || !skill?.path) {
        continue;
      }
      const key = this.getSkillKey(skill);
      const existingSkill = dedupedSkills.get(key);
      dedupedSkills.set(key, {
        ...existingSkill,
        ...skill,
        description: skill.description ?? existingSkill?.description ?? "",
        isLoaded: Boolean(existingSkill?.isLoaded || skill.isLoaded),
      });
    }

    return Array.from(dedupedSkills.values());
  }

  protected async normalizeSkills(skills?: SkillInfo[], sessionId?: string): Promise<SkillInfo[] | undefined> {
    const dedupedSkills = this.dedupeSkills(skills);
    if (!dedupedSkills || dedupedSkills.length === 0) {
      return undefined;
    }

    const availableSkills = await this.listSkills(sessionId);
    const availableSkillsByKey = new Map<string, SkillInfo>();
    for (const skill of availableSkills) {
      availableSkillsByKey.set(this.getSkillKey(skill), skill);
      availableSkillsByKey.set(this.getSkillKeyByName(skill.name), skill);
    }

    return dedupedSkills.map((skill) => {
      const matchedSkill =
        availableSkillsByKey.get(this.getSkillKey(skill)) ??
        availableSkillsByKey.get(this.getSkillKeyByName(skill.name));
      if (!matchedSkill) {
        return skill;
      }
      return {
        ...matchedSkill,
        ...skill,
        description: matchedSkill.description || skill.description,
        isLoaded: Boolean(matchedSkill.isLoaded || skill.isLoaded),
      };
    });
  }

  protected async appendSkillMessages(sessionId: string, skills?: SkillInfo[], promptText?: string): Promise<void> {
    if (!skills || skills.length === 0) {
      return;
    }

    for (const skill of skills) {
      if (skill.isLoaded) {
        continue;
      }
      const skillPrompt = await this.buildSkillPrompt(skill, promptText);
      const skillMessage = this.buildSkillMessage(sessionId, skillPrompt, skill);
      this.appendSessionMessage(sessionId, skillMessage);
      this.onAssistantMessage(skillMessage, true);
    }
  }
}
