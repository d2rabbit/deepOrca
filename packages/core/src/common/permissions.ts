import * as fs from "fs";
import * as path from "path";
import type { DeepcodingSettings, PermissionScope, PermissionSettings } from "../settings";
import { getProjectConfigRoot } from "./app-dirs";
import { isAbsoluteFilePath, normalizeFilePath } from "./state";

export type BashPermissionScope = Exclude<PermissionScope, "mcp"> | "unknown";

export type PermissionDecision = "allow" | "deny" | "ask";

export type UserToolPermission = {
  toolCallId: string;
  permission: "allow" | "deny";
};

export type MessageToolPermission = {
  toolCallId: string;
  permission: PermissionDecision;
};

export type AskPermissionScope = PermissionScope | "unknown";

export type AskPermissionRequest = {
  toolCallId: string;
  scopes: AskPermissionScope[];
  name: string;
  command: string;
  description?: string;
};

export type PermissionToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type PermissionToolExecution = {
  toolCallId: string;
  content: string;
  result: {
    ok: boolean;
    name: string;
    output?: string;
    error?: string;
    metadata?: Record<string, unknown>;
    awaitUserResponse?: boolean;
    followUpMessages?: Array<{ role: "system"; content: string; contentParams?: unknown | null }>;
  };
};

export type PermissionPlan = {
  permissions: MessageToolPermission[];
  askPermissions: AskPermissionRequest[];
};

export type ComputeToolCallPermissionsOptions = {
  sessionId: string;
  projectRoot: string;
  toolCalls: unknown[];
  settings?: Required<PermissionSettings>;
  /**
   * Force-ask: unconditionally overrides allow, INCLUDING explicit user
   * grants (allow-list entries). Used by plan mode — "touch nothing".
   */
  forceAskScopes?: readonly PermissionScope[];
  /**
   * Force-ask: only overrides allows that come from the defaultMode fallback
   * ("allowAll"), never a user's explicit allow-list grant. Used to narrow
   * allowAll's implicit coverage of out-of-cwd write/delete (decision
   * 2026-08-15, specs/sandbox/design.md §4.2) without breaking the
   * "always allow" button.
   */
  forceAskDefaultedScopes?: readonly PermissionScope[];
  readPermissionExemptPaths?: string[];
  resolveSnippetPath?: (sessionId: string, snippetId: string) => string | null | undefined;
};

export function parseToolCallForPermissions(toolCall: unknown): PermissionToolCall | null {
  if (!toolCall || typeof toolCall !== "object") {
    return null;
  }
  const record = toolCall as {
    id?: unknown;
    type?: unknown;
    function?: { name?: unknown; arguments?: unknown };
  };
  if (typeof record.id !== "string" || !record.function || typeof record.function !== "object") {
    return null;
  }
  if (typeof record.function.name !== "string") {
    return null;
  }
  return {
    id: record.id,
    type: "function",
    function: {
      name: record.function.name,
      arguments: typeof record.function.arguments === "string" ? record.function.arguments : "",
    },
  };
}

export function buildPermissionToolExecution(
  toolCall: PermissionToolCall,
  options: {
    permissionOverrides?: UserToolPermission[];
    messagePermissions?: MessageToolPermission[];
  }
): PermissionToolExecution | null {
  const permission = resolveToolCallPermission(toolCall.id, options);
  if (permission === "allow") {
    return null;
  }
  if (permission === "deny") {
    return buildSyntheticToolExecution(
      toolCall,
      "User denied the required permission for this tool call. Do not try to bypass this decision."
    );
  }
  return buildSyntheticToolExecution(
    toolCall,
    "The user has not authorized this tool call yet. Retry only if the permission is still necessary."
  );
}

export function resolveToolCallPermission(
  toolCallId: string,
  options: {
    permissionOverrides?: UserToolPermission[];
    messagePermissions?: MessageToolPermission[];
  }
): PermissionDecision {
  const override = options.permissionOverrides?.find((item) => item.toolCallId === toolCallId);
  if (override?.permission === "allow" || override?.permission === "deny") {
    return override.permission;
  }
  const messagePermission = options.messagePermissions?.find((item) => item.toolCallId === toolCallId);
  if (
    messagePermission?.permission === "allow" ||
    messagePermission?.permission === "deny" ||
    messagePermission?.permission === "ask"
  ) {
    return messagePermission.permission;
  }
  return "allow";
}

export function buildSyntheticToolExecution(toolCall: PermissionToolCall, error: string): PermissionToolExecution {
  const result = {
    ok: false,
    name: toolCall.function.name,
    error,
  };
  return {
    toolCallId: toolCall.id,
    content: JSON.stringify(result, null, 2),
    result,
  };
}

export function computeToolCallPermissions(options: ComputeToolCallPermissionsOptions): PermissionPlan {
  const permissions: MessageToolPermission[] = [];
  const askPermissions: AskPermissionRequest[] = [];

  for (const rawToolCall of options.toolCalls) {
    const toolCall = parseToolCallForPermissions(rawToolCall);
    if (!toolCall) {
      continue;
    }
    const request = describeToolPermissionRequest({
      sessionId: options.sessionId,
      projectRoot: options.projectRoot,
      toolCall,
      readPermissionExemptPaths: options.readPermissionExemptPaths,
      resolveSnippetPath: options.resolveSnippetPath,
    });
    const evaluatedPermission = evaluatePermissionScopes(request.scopes, options.settings);
    const forcedAskScopes =
      evaluatedPermission === "deny"
        ? []
        : mergeAskScopes(
            getAllowedForcedAskScopes(request.scopes, options.settings, options.forceAskScopes),
            getAllowedDefaultedForcedAskScopes(request.scopes, options.settings, options.forceAskDefaultedScopes)
          );
    const permission = forcedAskScopes.length > 0 ? "ask" : evaluatedPermission;
    permissions.push({ toolCallId: toolCall.id, permission });
    if (permission === "ask") {
      const askScopes = mergeAskScopes(
        getPermissionScopesRequiringAsk(request.scopes, options.settings),
        forcedAskScopes
      );
      askPermissions.push({
        toolCallId: toolCall.id,
        scopes: askScopes.length > 0 ? askScopes : request.scopes,
        name: request.name,
        command: request.command,
        description: request.description,
      });
    }
  }

  return { permissions, askPermissions };
}

function getAllowedForcedAskScopes(
  scopes: AskPermissionScope[],
  settings: Required<PermissionSettings> | undefined,
  forceAskScopes: readonly PermissionScope[] | undefined
): PermissionScope[] {
  if (!forceAskScopes?.length) {
    return [];
  }

  return scopes.filter(
    (scope): scope is PermissionScope =>
      scope !== "unknown" && forceAskScopes.includes(scope) && evaluatePermissionScopes([scope], settings) === "allow"
  );
}

/**
 * The defaulted-only twin of {@link getAllowedForcedAskScopes}: a scope
 * qualifies only when its allow verdict comes from the defaultMode fallback,
 * not from an explicit allow-list grant. This is what lets the baseline narrow
 * allowAll's implicit coverage without breaking the "always allow" button
 * (an explicit grant survives; see specs/sandbox/design.md §4.2(a)).
 */
function getAllowedDefaultedForcedAskScopes(
  scopes: AskPermissionScope[],
  settings: Required<PermissionSettings> | undefined,
  forceAskDefaultedScopes: readonly PermissionScope[] | undefined
): PermissionScope[] {
  if (!forceAskDefaultedScopes?.length) {
    return [];
  }

  return scopes.filter(
    (scope): scope is PermissionScope =>
      scope !== "unknown" &&
      forceAskDefaultedScopes.includes(scope) &&
      isDefaultedAllow(scope, settings) &&
      evaluatePermissionScopes([scope], settings) === "allow"
  );
}

/** Whether a scope's allow verdict stems from the defaultMode fallback rather
 * than an explicit allow-list grant (deny/ask entries short-circuit first). */
export function isDefaultedAllow(
  scope: PermissionScope,
  settings: Required<PermissionSettings> = {
    allow: [],
    deny: [],
    ask: [],
    defaultMode: "allowAll",
  }
): boolean {
  return (
    !settings.deny.includes(scope) &&
    !settings.ask.includes(scope) &&
    !settings.allow.includes(scope) &&
    settings.defaultMode === "allowAll"
  );
}

/**
 * Scopes that `defaultMode: "allowAll"` no longer implicitly covers
 * (decision 2026-08-15, specs/sandbox/design.md §4.2(c)). Deliberately only
 * the out-cwd pair: in-cwd write/delete is the agent's daily work (including
 * it would defeat allowAll), `mutate-git-log` is destructive but undoable via
 * the file-history checkpoint, and `read-out-cwd` is covered by the P0 gate +
 * audit instead (adding it would prompt on every config/global-skill read).
 */
export const DEFAULT_FORCE_ASK_DEFAULTED_SCOPES = [
  "write-out-cwd",
  "delete-out-cwd",
] as const satisfies readonly PermissionScope[];

function mergeAskScopes(existing: AskPermissionScope[], forced: readonly AskPermissionScope[]): AskPermissionScope[] {
  return [...existing, ...forced.filter((scope) => !existing.includes(scope))];
}

export function describeToolPermissionRequest(options: {
  sessionId: string;
  projectRoot: string;
  toolCall: PermissionToolCall;
  readPermissionExemptPaths?: string[];
  resolveSnippetPath?: (sessionId: string, snippetId: string) => string | null | undefined;
}): AskPermissionRequest {
  const name = options.toolCall.function.name;
  const args = parseToolArgumentsForPermissions(options.toolCall.function.arguments);

  if (name === "read" || name === "Read") {
    const filePath = typeof args.file_path === "string" ? args.file_path : "";
    return {
      toolCallId: options.toolCall.id,
      name,
      command: formatToolPathCommand("read", filePath),
      scopes:
        filePath && !isPathInAnyDirectory(options.projectRoot, filePath, options.readPermissionExemptPaths)
          ? [isPathInProject(options.projectRoot, filePath) ? "read-in-cwd" : "read-out-cwd"]
          : [],
    };
  }

  if (name === "write" || name === "Write") {
    const filePath = typeof args.file_path === "string" ? args.file_path : "";
    return {
      toolCallId: options.toolCall.id,
      name,
      command: formatToolPathCommand("write", filePath),
      scopes: filePath ? [isPathInProject(options.projectRoot, filePath) ? "write-in-cwd" : "write-out-cwd"] : [],
    };
  }

  if (name === "edit" || name === "Edit") {
    const filePath = resolveEditPermissionPath(options.sessionId, args, options.resolveSnippetPath);
    return {
      toolCallId: options.toolCall.id,
      name,
      command: formatToolPathCommand("edit", filePath),
      scopes: filePath
        ? [isPathInProject(options.projectRoot, filePath) ? "write-in-cwd" : "write-out-cwd"]
        : ["write-out-cwd"],
    };
  }

  if (name === "bash" || name === "Bash") {
    const command = typeof args.command === "string" ? args.command : "bash";
    const description = typeof args.description === "string" ? args.description : undefined;
    // The model's declared sideEffects are a HINT, not a security boundary —
    // a prompt-injected or careless model can declare `[]` on a `rm -rf`.
    // Infer the command's side effects from its text and union with the
    // declared scopes. Inference can only ever ADD risk, never remove it, so
    // this closes the under-reporting hole without breaking legitimate
    // over-reporting.
    const declared = parseBashSideEffects(args.sideEffects);
    const inferred = inferBashSideEffects(command);
    return {
      toolCallId: options.toolCall.id,
      name: "bash",
      command,
      description,
      scopes: unionBashScopes(declared, inferred),
    };
  }

  if (name === "WebSearch") {
    const query = typeof args.query === "string" ? args.query : "WebSearch";
    return {
      toolCallId: options.toolCall.id,
      name,
      command: query,
      scopes: ["network"],
    };
  }

  if (name.startsWith("mcp__")) {
    return {
      toolCallId: options.toolCall.id,
      name,
      command: name,
      scopes: ["mcp"],
    };
  }

  return {
    toolCallId: options.toolCall.id,
    name,
    command: name,
    scopes: [],
  };
}

export function evaluatePermissionScopes(
  scopes: AskPermissionScope[],
  settings: Required<PermissionSettings> = {
    allow: [],
    deny: [],
    ask: [],
    defaultMode: "allowAll",
  }
): PermissionDecision {
  if (scopes.includes("unknown") && settings.defaultMode !== "allowAll") {
    return "ask";
  }
  if (scopes.length === 0) {
    return "allow";
  }
  const permissionScopes = scopes.filter((scope): scope is PermissionScope => scope !== "unknown");
  if (permissionScopes.some((scope) => settings.deny.includes(scope))) {
    return "deny";
  }
  if (permissionScopes.some((scope) => settings.ask.includes(scope))) {
    return "ask";
  }
  if (permissionScopes.every((scope) => settings.allow.includes(scope))) {
    return "allow";
  }
  return settings.defaultMode === "askAll" ? "ask" : "allow";
}

export function getPermissionScopesRequiringAsk(
  scopes: AskPermissionScope[],
  settings: Required<PermissionSettings> = {
    allow: [],
    deny: [],
    ask: [],
    defaultMode: "allowAll",
  }
): AskPermissionScope[] {
  const result: AskPermissionScope[] = [];
  for (const scope of scopes) {
    if (scope === "unknown") {
      if (settings.defaultMode !== "allowAll") {
        result.push(scope);
      }
      continue;
    }
    if (settings.deny.includes(scope)) {
      continue;
    }
    if (settings.ask.includes(scope)) {
      result.push(scope);
      continue;
    }
    if (settings.allow.includes(scope)) {
      continue;
    }
    if (settings.defaultMode === "askAll") {
      result.push(scope);
    }
  }
  return result;
}

export function parseBashSideEffects(value: unknown): AskPermissionScope[] {
  const validScopes = new Set<AskPermissionScope>([
    "read-in-cwd",
    "read-out-cwd",
    "write-in-cwd",
    "write-out-cwd",
    "delete-in-cwd",
    "delete-out-cwd",
    "query-git-log",
    "mutate-git-log",
    "network",
    "unknown",
  ]);
  if (!Array.isArray(value)) {
    return ["unknown"];
  }
  const scopes: AskPermissionScope[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !validScopes.has(item as AskPermissionScope)) {
      return ["unknown"];
    }
    const scope = item as AskPermissionScope;
    if (!scopes.includes(scope)) {
      scopes.push(scope);
    }
  }
  if (scopes.includes("unknown")) {
    return ["unknown"];
  }
  // An empty declared array is NOT normalised to ["unknown"] here. Doing so
  // would discard the concrete scopes inferred from the command text (see
  // unionBashScopes) — a `rm -rf` with `sideEffects: []` must still pick up
  // the inferred delete scopes. The union step below guarantees that an empty
  // declared array never short-circuits to "allow": if neither the model nor
  // the inference produced a concrete scope, the union returns ["unknown"].
  return scopes;
}

/**
 * Conservatively infer permission scopes from the bash command text itself,
 * rather than trusting the model's declared `sideEffects`.
 *
 * This is NOT a shell parser and is deliberately conservative: it only flags
 * high-confidence patterns (deletions, git-history mutation, output
 * redirection, well-known network/install tools). Anything it cannot classify
 * returns `["unknown"]` so the caller can merge it with the declared scopes and
 * let the normal permission policy decide. The goal is to catch the obvious
 * "model declares `sideEffects: []` on `rm -rf`" case, not to be a complete
 * static analysis of shell.
 *
 * The returned scopes are unioned with the model's declared scopes (see
 * {@link unionBashScopes}) — inference can only ever ADD risk, never remove it.
 */
export function inferBashSideEffects(command: string): AskPermissionScope[] {
  if (!command || !command.trim()) {
    return ["unknown"];
  }
  const scopes = new Set<AskPermissionScope>();

  // Tokenise on whitespace and shell metacharacters. We only need a coarse
  // view — exact quoting/escaping does not change which tool is invoked.
  const tokens = command.split(/[\s|;&<>()`$]+/).filter(Boolean);
  const lower = command.toLowerCase();

  // Deletion commands (high confidence).
  const deleteRe = /\b(rm|rmdir|del|erase|unlink|shred|trash)\b/;
  if (deleteRe.test(lower) || /(^|[\s=])-delete\b/.test(lower)) {
    scopes.add("delete-in-cwd");
    // rm can obviously target files outside the cwd too; flag both.
    scopes.add("delete-out-cwd");
  }

  // Raw block-device / file-wrecking utilities (deep review 2026-08-15, B1):
  // none of these matched any previous pattern.
  if (/\b(dd|truncate|mkfs(\.[a-z0-9]+)?|wipefs|fdisk|sfdisk|parted)\b/.test(lower)) {
    scopes.add("delete-out-cwd");
    scopes.add("write-out-cwd");
  }

  // Inline-code interpreters (`python -c`, `node -e`, `perl -e`, sh -lc …):
  // the payload is opaque to any tokeniser and can do ANYTHING — classify as
  // out-of-cwd destructive rather than merely "unknown" so non-allowAll
  // policies intercept it (previously returned [] and sailed through).
  if (
    /\b(python3?|node|deno|bun|perl|ruby|php|lua|osascript|bash|sh|zsh|dash|ksh|powershell|pwsh)\b[^|;&]*\s(-c|-e|-lc|-rc|--eval|--command)\b/.test(
      lower
    ) ||
    // Decoded-payload pipes: `echo …| base64 -d | sh`, `… | openssl enc -d | sh`.
    /\b(base64|openssl|xxd|uudecode)\b[^|]*\|/.test(lower) ||
    // Pipe into a shell with no args executes the upstream output as code.
    /\|\s*(env\s+)?(ba|z|da|k|fish|c|tc)?sh\b/.test(lower)
  ) {
    scopes.add("delete-out-cwd");
    scopes.add("write-out-cwd");
  }

  // Git history mutation (high confidence — these rewrites are irreversible).
  const gitHistoryMutationRe =
    /\bgit\s+(commit\s+--amend|rebase|reset\s+--hard|filter-branch|reflog\s+expire|gc\s+--prune=now)\b/;
  if (gitHistoryMutationRe.test(lower)) {
    scopes.add("mutate-git-log");
  }
  // `git commit` (non-amend) creates history.
  if (/\bgit\s+commit\b/.test(lower) && !/\bgit\s+commit\s+--amend\b/.test(lower)) {
    scopes.add("mutate-git-log");
  }

  // Output redirection → file write.
  if (/>>?/.test(command)) {
    scopes.add("write-in-cwd");
    scopes.add("write-out-cwd");
  }

  // tee explicitly writes to a file.
  if (/\btee\b/.test(lower)) {
    scopes.add("write-in-cwd");
    scopes.add("write-out-cwd");
  }

  // Network tools (high confidence).
  const networkTools = new Set([
    "curl",
    "wget",
    "nc",
    "netcat",
    "ssh",
    "scp",
    "sftp",
    "rsync",
    "ftp",
    "telnet",
    "http",
    "https",
    "ping",
    "dig",
    "nslookup",
    "tracert",
    "tracepath",
  ]);
  for (const tok of tokens) {
    const bare = tok.replace(/^.*\//, ""); // strip path prefix (e.g. /usr/bin/curl)
    if (networkTools.has(bare.toLowerCase())) {
      scopes.add("network");
      break;
    }
  }

  // Package managers / installers (high confidence — they mutate the
  // filesystem outside the cwd and/or hit the network).
  const installTools = new Set([
    "npm",
    "npx",
    "yarn",
    "pnpm",
    "pip",
    "pip3",
    "pipx",
    "uv",
    "uvx",
    "poetry",
    "brew",
    "apt",
    "apt-get",
    "yum",
    "dnf",
    "pacman",
    "choco",
    "winget",
    "gem",
    "cargo",
  ]);
  for (const tok of tokens) {
    const bare = tok.replace(/^.*\//, "");
    if (installTools.has(bare.toLowerCase())) {
      // install subcommand specifically — but be conservative and flag any
      // invocation of these tools, since `npm run`/`pip ...` still executes
      // arbitrary lifecycle scripts.
      scopes.add("write-in-cwd");
      scopes.add("network");
      break;
    }
  }

  // PowerShell / cmd.exe invocation — too broad to classify conservatively.
  if (/\b(powershell|pwsh|cmd|cmd\.exe)\b/i.test(command)) {
    return Array.from(scopes).length > 0 ? Array.from(scopes) : ["unknown"];
  }

  // Subshell / command substitution / backticks — the inner command is opaque
  // to a tokeniser, so we cannot safely classify the whole thing.
  if (/[()`$]/.test(command)) {
    scopes.add("unknown");
  }

  // Pipe chains — the downstream command may add side effects we can't see in
  // isolation, so flag as unknown unless we already found concrete scopes.
  if (/[|]/.test(command) && command.split("|").length - 1 > 0) {
    // Only add unknown if we found nothing concrete; if we already detected
    // e.g. rm, the delete scopes dominate.
    if (scopes.size === 0) {
      scopes.add("unknown");
    }
  }

  // When no danger pattern and no opacity construct matched, return [] (no
  // additional inferred risk), NOT ["unknown"]. A benign-looking command like
  // `rg TODO src` should let the model's declared scopes stand; the
  // `unionBashScopes([], []) -> ["unknown"]` rule is what catches the empty-
  // array attack vector at the union step. The regression this avoids: a
  // command that the model correctly classifies as read-only must not be
  // downgraded to unknown just because the inference found no danger pattern.
  return Array.from(scopes);
}

/**
 * Combine the model-declared bash scopes with the inferred scopes.
 *
 * Union semantics: inference can only ever ADD risk, never remove it.
 *  - If either side explicitly contains `unknown` (the model admits it cannot
 *    classify, or the inference hit an opaque construct), `unknown` dominates
 *    and the result is `["unknown"]` — the command is unclassifiable.
 *  - Otherwise the two concrete scope lists are unioned.
 *  - If the union is empty (the model declared `[]` AND inference produced
 *    nothing concrete), the result is `["unknown"]`. A bash command can never
 *    credibly claim "absolutely no side effects", so an empty union must NOT
 *    short-circuit to "allow".
 */
export function unionBashScopes(declared: AskPermissionScope[], inferred: AskPermissionScope[]): AskPermissionScope[] {
  if (declared.includes("unknown") || inferred.includes("unknown")) {
    return ["unknown"];
  }
  const merged = new Set<AskPermissionScope>([...declared, ...inferred]);
  if (merged.size === 0) {
    return ["unknown"];
  }
  return Array.from(merged);
}

export function parseToolArgumentsForPermissions(rawArguments: string): Record<string, unknown> {
  if (!rawArguments) {
    return {};
  }
  try {
    const parsed = JSON.parse(rawArguments);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function resolveEditPermissionPath(
  sessionId: string,
  args: Record<string, unknown>,
  resolveSnippetPath?: (sessionId: string, snippetId: string) => string | null | undefined
): string {
  const filePath = typeof args.file_path === "string" ? args.file_path : "";
  if (filePath) {
    return filePath;
  }
  const snippetId = typeof args.snippet_id === "string" ? args.snippet_id : "";
  return snippetId ? (resolveSnippetPath?.(sessionId, snippetId) ?? "") : "";
}

export function formatToolPathCommand(toolName: string, filePath: string): string {
  return filePath ? `${toolName} ${filePath}` : toolName;
}

export function isPathInProject(projectRoot: string, filePath: string): boolean {
  const normalized = normalizeFilePath(filePath);
  const absolutePath = isAbsoluteFilePath(normalized) ? normalized : path.resolve(projectRoot, normalized);
  // Hardening (deep review 2026-08-15, B3): a symlink planted INSIDE the
  // project could point at /etc while lexical resolution still classifies the
  // target as in-project (and thus pre-allowed). When both ends exist, prefer
  // the real paths; fall back to the lexical answer when realpath fails
  // (file not created yet / permissions), preserving prior behavior.
  const realPath = safeRealPath(absolutePath);
  const realRoot = safeRealPath(projectRoot);
  if (realPath && realRoot) {
    const realRelative = path.relative(realRoot, realPath);
    if (realRelative === "" || (!realRelative.startsWith("..") && !path.isAbsolute(realRelative))) {
      return true;
    }
    // realpath resolved and clearly escapes — trust it over the lexical answer.
    if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
      return false;
    }
  }
  const relative = path.relative(path.resolve(projectRoot), path.resolve(absolutePath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function safeRealPath(target: string): string | null {
  try {
    return fs.realpathSync(target);
  } catch {
    return null;
  }
}

export function isPathInAnyDirectory(
  projectRoot: string,
  filePath: string,
  directories: string[] | undefined
): boolean {
  if (!directories?.length) {
    return false;
  }

  const normalized = normalizeFilePath(filePath);
  const absolutePath = isAbsoluteFilePath(normalized) ? normalized : path.resolve(projectRoot, normalized);
  for (const directory of directories) {
    const normalizedDirectory = normalizeFilePath(directory);
    const absoluteDirectory = isAbsoluteFilePath(normalizedDirectory)
      ? normalizedDirectory
      : path.resolve(projectRoot, normalizedDirectory);
    const relative = path.relative(path.resolve(absoluteDirectory), path.resolve(absolutePath));
    if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
      return true;
    }
  }
  return false;
}

export function hasUserPermissionReplies(value: { permissions?: unknown; alwaysAllows?: unknown }): boolean {
  return Boolean(
    (Array.isArray(value.permissions) && value.permissions.length > 0) ||
    (Array.isArray(value.alwaysAllows) && value.alwaysAllows.length > 0)
  );
}

export function appendProjectPermissionAllows(
  projectRoot: string,
  scopes: PermissionScope[] | undefined,
  options: { inheritedPermissions?: Required<PermissionSettings> } = {}
): void {
  if (!Array.isArray(scopes) || scopes.length === 0) {
    return;
  }
  const validScopes = new Set<PermissionScope>([
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
  ]);
  const nextScopes = scopes.filter((scope) => validScopes.has(scope));
  if (nextScopes.length === 0) {
    return;
  }
  const settingsPath = path.join(getProjectConfigRoot(projectRoot), "settings.json");
  let settings: DeepcodingSettings = {};
  try {
    if (fs.existsSync(settingsPath)) {
      const parsed = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        settings = parsed as DeepcodingSettings;
      }
    }
  } catch {
    settings = {};
  }

  const existingPermissions = settings.permissions;
  const permissions: PermissionSettings = existingPermissions
    ? { ...existingPermissions }
    : options.inheritedPermissions
      ? {
          allow: [...options.inheritedPermissions.allow],
          deny: [...options.inheritedPermissions.deny],
          ask: [...options.inheritedPermissions.ask],
          defaultMode: options.inheritedPermissions.defaultMode,
        }
      : {};

  const currentAllow = Array.isArray(permissions.allow) ? permissions.allow : [];
  const allow = [...currentAllow];
  for (const scope of nextScopes) {
    if (!allow.includes(scope)) {
      allow.push(scope);
    }
  }
  const currentDeny = Array.isArray(permissions.deny) ? permissions.deny : undefined;
  const currentAsk = Array.isArray(permissions.ask) ? permissions.ask : undefined;
  const deny = currentDeny ? currentDeny.filter((scope) => !nextScopes.includes(scope)) : permissions.deny;
  const ask = currentAsk ? currentAsk.filter((scope) => !nextScopes.includes(scope)) : permissions.ask;
  const changed =
    allow.length !== currentAllow.length ||
    (currentDeny ? (deny as PermissionScope[]).length !== currentDeny.length : false) ||
    (currentAsk ? (ask as PermissionScope[]).length !== currentAsk.length : false);
  if (existingPermissions && !changed) {
    return;
  }
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(
    settingsPath,
    `${JSON.stringify(
      {
        ...settings,
        permissions: {
          ...permissions,
          deny,
          ask,
          allow,
        },
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

export function normalizeAskPermissions(value: unknown): AskPermissionRequest[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const result: AskPermissionRequest[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const record = item as Record<string, unknown>;
    if (typeof record.toolCallId !== "string" || typeof record.name !== "string") {
      continue;
    }
    const scopes = Array.isArray(record.scopes)
      ? record.scopes.filter((scope): scope is AskPermissionScope => isAskPermissionScope(scope))
      : [];
    result.push({
      toolCallId: record.toolCallId,
      scopes,
      name: record.name,
      command: typeof record.command === "string" ? record.command : record.name,
      description: typeof record.description === "string" ? record.description : undefined,
    });
  }
  return result.length > 0 ? result : undefined;
}

export function isAskPermissionScope(value: unknown): value is AskPermissionScope {
  return (
    value === "read-in-cwd" ||
    value === "read-out-cwd" ||
    value === "write-in-cwd" ||
    value === "write-out-cwd" ||
    value === "delete-in-cwd" ||
    value === "delete-out-cwd" ||
    value === "query-git-log" ||
    value === "mutate-git-log" ||
    value === "network" ||
    value === "mcp" ||
    value === "unknown"
  );
}
