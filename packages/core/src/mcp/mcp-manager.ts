import { createHash } from "crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolResultSchema, ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import type { McpServerConfig } from "../settings";
import { getEnvVar } from "../common/app-dirs";

const mcpTimeoutEnv = getEnvVar("MCP_TIMEOUT");
const MCP_STARTUP_TIMEOUT_MS = mcpTimeoutEnv ? parseInt(mcpTimeoutEnv, 10) : 30_000;
const MCP_CALL_TOOL_TIMEOUT_MS = 60_000;
const API_TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;
const API_TOOL_NAME_MAX_LENGTH = 64;
// Safety valve for pagination loops (SDK returns one page at a time with nextCursor).
const MAX_PAGES = 100;
// Size of the per-server stderr ring buffer, in bytes. Matches the legacy
// McpClient: large enough to surface a startup diagnostic, small enough to
// bound memory. We keep the tail (most recent) bytes.
const STDERR_RING_BUFFER_BYTES = 4096;

type McpToolEntry = {
  serverName: string;
  originalName: string;
  namespacedName: string;
  definition: McpToolDefinition;
  client: Client;
};

export type McpToolDefinition = {
  name: string;
  description?: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
};

export type McpPromptDefinition = {
  name: string;
  description?: string;
  arguments?: Array<{ name: string; description?: string; required?: boolean }>;
};

export type McpResourceDefinition = {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
};

// Minimal, locally-typed view of the SDK CallToolResult. The SDK's
// z.objectOutputType resolves `content` to `unknown` in the .d.ts, so we cast
// to this shape after the SDK has validated the response at runtime.
type CallToolResult = {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
  /** Custom metadata returned by the tool (SDK uses "passthrough" mode). */
  metadata?: Record<string, unknown>;
};

export type McpServerStatus = {
  name: string;
  status: "starting" | "ready" | "failed" | "reconnecting";
  connected: boolean;
  error?: string;
  toolCount: number;
  tools: string[];
  promptCount: number;
  prompts: string[];
  resourceCount: number;
  resources: string[];
};

function buildMcpNamespacedName(
  serverName: string,
  toolName: string,
  usedNames: ReadonlySet<string> = new Set()
): string {
  const rawName = buildRawMcpNamespacedName(serverName, toolName);
  const sanitizedName = `mcp__${sanitizeApiToolNamePart(serverName)}__${sanitizeApiToolNamePart(toolName)}`;
  let candidate = fitApiToolName(sanitizedName, rawName);
  if (!usedNames.has(candidate)) {
    return candidate;
  }

  const hash = hashToolName(rawName);
  candidate = fitApiToolNameWithSuffix(sanitizedName, `_${hash}`);
  if (!usedNames.has(candidate)) {
    return candidate;
  }

  for (let index = 2; ; index += 1) {
    candidate = fitApiToolNameWithSuffix(sanitizedName, `_${hash}_${index}`);
    if (!usedNames.has(candidate)) {
      return candidate;
    }
  }
}

// Metadata kept alongside each SDK Client: the StdioClientTransport (for async
// teardown) and the server name the client belongs to. We track connectivity
// ourselves because the SDK Client does not expose an isConnected() method.
type ManagedClient = {
  client: Client;
  transport: StdioClientTransport | InMemoryTransport;
  serverName: string;
  // Tail of the server's stderr output (most recent STDERR_RING_BUFFER_BYTES).
  // Captured while draining so a startup failure that writes a diagnostic to
  // stderr then exits can surface in the failed-status error message.
  stderrBuffer: string;
};

export class McpManager {
  private clients: ManagedClient[] = [];
  private connectedServers = new Set<string>();
  private tools: McpToolEntry[] = [];
  private prompts: Array<{
    serverName: string;
    namespacedName: string;
    definition: McpPromptDefinition;
    client: Client;
  }> = [];
  private resources: Array<{
    serverName: string;
    namespacedName: string;
    definition: McpResourceDefinition;
    client: Client;
  }> = [];
  private initialized = false;
  private disposed = false;
  private intentionallyClosing = new Set<string>();
  // Names of in-process servers (A2UI, activity-frames) successfully registered
  // via connectInProcessServer(). These are NOT in serverConfigs (that map only
  // holds stdio configs), so crash detection must key off this set instead.
  private inProcessServers = new Set<string>();
  private configuredServerNames: string[] = [];
  private serverStatuses: McpServerStatus[] = [];
  private onToolsListChanged: (() => void) | null = null;
  private onStatusChanged: (() => void) | null = null;
  private serverConfigs: Record<string, McpServerConfig> = {};

  prepare(servers?: Record<string, McpServerConfig>): void {
    if (!servers || Object.keys(servers).length === 0) return;
    this.disposed = false;

    for (const name of Object.keys(servers)) {
      if (!this.configuredServerNames.includes(name)) {
        this.configuredServerNames.push(name);
      }
      if (this.serverStatuses.some((status) => status.name === name)) {
        continue;
      }
      this.setStatus({
        name,
        status: "starting",
        connected: false,
        toolCount: 0,
        tools: [],
        promptCount: 0,
        prompts: [],
        resourceCount: 0,
        resources: [],
      });
    }
  }

  async initialize(servers?: Record<string, McpServerConfig>): Promise<void> {
    if (this.initialized || this.disposed) return;
    this.initialized = true;

    if (!servers || Object.keys(servers).length === 0) return;

    this.serverConfigs = servers;
    this.prepare(servers);

    for (const [name, config] of Object.entries(servers)) {
      if (this.disposed) break;
      await this.connectServer(name, config);
    }
  }

  async reconnect(name: string, config?: McpServerConfig): Promise<void> {
    if (this.disposed) return;
    const effectiveConfig = config ?? this.serverConfigs[name];
    if (!effectiveConfig) return;
    if (config) {
      this.serverConfigs[name] = config;
    }

    this.setStatus({
      name,
      status: "reconnecting",
      connected: false,
      error: "Reconnecting...",
      toolCount: 0,
      tools: [],
      promptCount: 0,
      prompts: [],
      resourceCount: 0,
      resources: [],
    });

    await this.connectServer(name, effectiveConfig);
  }

  /**
   * Connect an in-process MCP server (e.g. A2UI) using InMemoryTransport.
   * This avoids spawning a subprocess — the server runs in the same Node
   * process, communicating over a linked pair of in-memory transports.
   */
  async connectInProcessServer(
    name: string,
    server: { connect(transport: InMemoryTransport): Promise<void> }
  ): Promise<void> {
    if (this.disposed) return;

    this.pruneDisconnectedClients();
    this.tools = this.tools.filter((t) => t.serverName !== name);
    this.prompts = this.prompts.filter((p) => p.serverName !== name);
    this.resources = this.resources.filter((r) => r.serverName !== name);

    try {
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await server.connect(serverTransport);

      const client = new Client({ name: "deeporca", version: "0.1.0" }, { capabilities: {} });
      await this.connectWithTimeout(client, clientTransport, MCP_STARTUP_TIMEOUT_MS);

      if (this.disposed) {
        await client.close().catch(() => {});
        return;
      }

      const managed: ManagedClient = {
        client,
        transport: clientTransport,
        serverName: name,
        stderrBuffer: "",
      };

      // Set up crash detection — same guard as stdio servers. When the
      // manager intentionally closes the transport in disconnect()/removeServer(),
      // it adds the name to `intentionallyClosing` first so the close event
      // is NOT mistaken for a crash.
      client.onclose = () => {
        this.connectedServers.delete(name);
        if (this.intentionallyClosing.has(name)) {
          this.inProcessServers.delete(name);
          return;
        }
        // In-process servers are not tracked in serverConfigs (that map only
        // holds stdio configs); use inProcessServers to gate crash detection.
        if (!this.disposed && this.inProcessServers.has(name)) {
          this.inProcessServers.delete(name);
          this.onServerCrash(name, `In-process MCP server "${name}" closed unexpectedly`);
        }
      };

      this.clients.push(managed);
      this.connectedServers.add(name);
      this.inProcessServers.add(name);

      const serverTools = await this.listAllTools(client);
      if (this.disposed) return;
      const toolNamespacedNames: string[] = [];
      const usedToolNames = new Set(this.tools.map((tool) => tool.namespacedName));
      for (const tool of serverTools) {
        const namespacedName = buildMcpNamespacedName(name, tool.name, usedToolNames);
        usedToolNames.add(namespacedName);
        this.tools.push({
          serverName: name,
          originalName: tool.name,
          namespacedName,
          definition: tool,
          client,
        });
        toolNamespacedNames.push(namespacedName);
      }

      this.setStatus({
        name,
        status: "ready",
        connected: true,
        toolCount: serverTools.length,
        tools: toolNamespacedNames,
        promptCount: 0,
        prompts: [],
        resourceCount: 0,
        resources: [],
      });
    } catch (err) {
      // Clean up the half-registered client if it was already pushed.
      // Same pattern as connectServer's catch block.
      const idx = this.clients.findIndex((c) => c.serverName === name);
      if (idx >= 0) {
        const leaked = this.clients.splice(idx, 1)[0];
        if (leaked) await this.silentlyClose(leaked);
      }
      this.connectedServers.delete(name);
      this.inProcessServers.delete(name);
      this.tools = this.tools.filter((t) => t.serverName !== name);
      const message = err instanceof Error ? err.message : String(err);
      this.setStatus({
        name,
        status: "failed",
        connected: false,
        error: message,
        toolCount: 0,
        tools: [],
        promptCount: 0,
        prompts: [],
        resourceCount: 0,
        resources: [],
      });
    }
  }

  private async connectServer(name: string, config: McpServerConfig): Promise<void> {
    if (this.disposed) return;

    // Clean up stale entries from previous connection attempts.
    this.pruneDisconnectedClients();
    this.tools = this.tools.filter((t) => t.serverName !== name);
    this.prompts = this.prompts.filter((p) => p.serverName !== name);
    this.resources = this.resources.filter((r) => r.serverName !== name);

    let managed: ManagedClient | null = null;
    try {
      managed = this.createManagedClient(name, config);
      // SDK connect() runs the initialize/initialized handshake but has no
      // built-in timeout — race against MCP_STARTUP_TIMEOUT_MS so a hanging
      // server cannot block startup indefinitely.
      await this.connectWithTimeout(managed.client, managed.transport, MCP_STARTUP_TIMEOUT_MS);
      if (this.disposed) {
        await this.silentlyClose(managed);
        return;
      }
      this.clients.push(managed);
      this.connectedServers.add(name);
      const { client } = managed;

      const serverTools = await this.listAllTools(client);
      if (this.disposed) return;
      const toolNamespacedNames: string[] = [];
      const usedToolNames = new Set(this.tools.map((tool) => tool.namespacedName));
      for (const tool of serverTools) {
        const namespacedName = buildMcpNamespacedName(name, tool.name, usedToolNames);
        usedToolNames.add(namespacedName);
        this.tools.push({
          serverName: name,
          originalName: tool.name,
          namespacedName,
          definition: tool,
          client,
        });
        toolNamespacedNames.push(namespacedName);
      }

      let serverPrompts: McpPromptDefinition[] = [];
      try {
        serverPrompts = await this.listAllPrompts(client);
      } catch {
        // server may not support prompts
      }
      if (this.disposed) return;
      const promptNamespacedNames: string[] = [];
      for (const prompt of serverPrompts) {
        const namespacedName = `mcp__${name}__${prompt.name}`;
        this.prompts.push({
          serverName: name,
          namespacedName,
          definition: prompt,
          client,
        });
        promptNamespacedNames.push(namespacedName);
      }

      let serverResources: McpResourceDefinition[] = [];
      try {
        serverResources = await this.listAllResources(client);
      } catch {
        // server may not support resources
      }
      if (this.disposed) return;
      const resourceNamespacedNames: string[] = [];
      for (const resource of serverResources) {
        const namespacedName = `mcp__${name}__${resource.name}`;
        this.resources.push({
          serverName: name,
          namespacedName,
          definition: resource,
          client,
        });
        resourceNamespacedNames.push(namespacedName);
      }

      this.setStatus({
        name,
        status: "ready",
        connected: true,
        toolCount: serverTools.length,
        tools: toolNamespacedNames,
        promptCount: serverPrompts.length,
        prompts: promptNamespacedNames,
        resourceCount: serverResources.length,
        resources: resourceNamespacedNames,
      });
    } catch (err) {
      if (managed) {
        await this.silentlyClose(managed);
      }
      const rawMessage = err instanceof Error ? err.message : String(err);
      // Surface any stderr the server wrote before failing — mirrors the old
      // McpClient's withStderr(): if the buffer captured something, append it so
      // startup diagnostics (e.g. "mcp startup boom") reach status.error.
      const stderr = managed?.stderrBuffer.trim();
      const message = stderr ? `${rawMessage}. stderr: ${stderr}` : rawMessage;
      this.setStatus({
        name,
        status: "failed",
        connected: false,
        error: message,
        toolCount: 0,
        tools: [],
        promptCount: 0,
        prompts: [],
        resourceCount: 0,
        resources: [],
      });
    }
  }

  // Build a StdioClientTransport + Client pair for one MCP server.
  //
  // Windows spawn approach: the SDK's StdioClientTransport uses cross-spawn
  // internally (shell:false). cross-spawn resolves bare commands (npx, …) via
  // PATHEXT on Windows itself, so we pass config.command + config.args directly
  // rather than the joined-string form produced by createMcpSpawnSpec (which is
  // tailored for Node's child_process + shell:true and would double-handle
  // quoting). createMcpSpawnSpec is still used by codegraph/crg for their own
  // (non-SDK) spawns — we deliberately do NOT reuse it here.
  private createManagedClient(name: string, config: McpServerConfig): ManagedClient {
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: mergeEnv(process.env, config.env),
      cwd: config.cwd,
      stderr: "pipe",
    });

    // The holder is allocated first so the stderr handler below can close over
    // it and accumulate bytes into the same buffer read on the failure path.
    const managed: ManagedClient = {
      client: undefined as unknown as Client,
      transport,
      serverName: name,
      stderrBuffer: "",
    };

    // Drain stderr while keeping the most recent ~4KB in a ring buffer.
    //
    // With `stderr: "pipe"` the SDK pipes child.stderr into a PassThrough with
    // no consumer; a PassThrough buffers to its 16KB highWaterMark then pauses
    // the producer, which — for a verbose-stderr server (logs, deprecation
    // warnings, stack traces) — fills the OS pipe buffer, blocks the server's
    // process.stderr.write(), and silently hangs it. The old McpClient consumed
    // stderr into a 4KB ring buffer to avoid exactly this. We keep that
    // behavior AND retain the tail so a server that writes a diagnostic to
    // stderr and exits can surface it in the failed-status error message (the
    // regression in a3310ff discarded the bytes entirely). The transport
    // exposes `stderr` as a ready-to-read PassThrough immediately on
    // construction, so attaching now also captures any early output.
    transport.stderr?.on("data", (chunk: Buffer) => {
      managed.stderrBuffer = appendStderrRing(managed.stderrBuffer, chunk);
    });

    const client = new Client({ name: "deeporca", version: "0.1.0" }, { capabilities: {} });
    managed.client = client;

    // Crash / disconnect detection: the SDK Protocol base class exposes a
    // public `onclose` callback that fires whenever the transport closes —
    // including when the server process exits unexpectedly. StdioClientTransport
    // wires its child process `close` event into transport.onclose, and
    // Protocol.connect forwards that to client.onclose. We use it (plus the
    // intentionallyClosing flag) to distinguish crashes from intentional
    // teardown in disconnect().
    client.onclose = () => {
      this.connectedServers.delete(name);
      if (this.intentionallyClosing.has(name)) {
        return;
      }
      if (!this.disposed && this.serverConfigs[name]) {
        this.onServerCrash(name, `MCP server "${name}" connection closed unexpectedly`);
      }
    };

    // The server notifies us its tool list changed; re-fetch it.
    client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
      this.refreshServerTools(name, client).catch(() => {});
    });

    return managed;
  }

  private connectWithTimeout(
    client: Client,
    transport: StdioClientTransport | InMemoryTransport,
    timeoutMs: number
  ): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Timed out after ${timeoutMs}ms waiting for MCP server to initialize`)),
        timeoutMs
      );
    });
    return Promise.race([client.connect(transport), timeout]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  }

  private async listAllTools(client: Client): Promise<McpToolDefinition[]> {
    const tools: McpToolDefinition[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const result = await client.listTools(cursor ? { cursor } : undefined);
      for (const tool of result.tools ?? []) {
        tools.push(adaptSdkTool(tool));
      }
      cursor = typeof result.nextCursor === "string" && result.nextCursor ? result.nextCursor : undefined;
      if (!cursor) {
        return tools;
      }
    }
    throw new Error("MCP server returned too many tools/list pages");
  }

  private async listAllPrompts(client: Client): Promise<McpPromptDefinition[]> {
    const prompts: McpPromptDefinition[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const result = await client.listPrompts(cursor ? { cursor } : undefined);
      for (const prompt of result.prompts ?? []) {
        prompts.push(adaptSdkPrompt(prompt));
      }
      cursor = typeof result.nextCursor === "string" && result.nextCursor ? result.nextCursor : undefined;
      if (!cursor) {
        return prompts;
      }
    }
    throw new Error("MCP server returned too many prompts/list pages");
  }

  private async listAllResources(client: Client): Promise<McpResourceDefinition[]> {
    const resources: McpResourceDefinition[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const result = await client.listResources(cursor ? { cursor } : undefined);
      for (const resource of result.resources ?? []) {
        resources.push(adaptSdkResource(resource));
      }
      cursor = typeof result.nextCursor === "string" && result.nextCursor ? result.nextCursor : undefined;
      if (!cursor) {
        return resources;
      }
    }
    throw new Error("MCP server returned too many resources/list pages");
  }

  private onServerCrash(name: string, reason: string): void {
    if (this.disposed) return;
    this.pruneDisconnectedClients();
    this.tools = this.tools.filter((t) => t.serverName !== name);
    this.prompts = this.prompts.filter((p) => p.serverName !== name);
    this.resources = this.resources.filter((r) => r.serverName !== name);
    this.onToolsListChanged?.();
    this.setStatus({
      name,
      status: "failed",
      connected: false,
      error: reason,
      toolCount: 0,
      tools: [],
      promptCount: 0,
      prompts: [],
      resourceCount: 0,
      resources: [],
    });
  }

  // SDK Client has no isConnected(); we track connectivity via connectedServers
  // and drop entries whose server is no longer connected.
  private pruneDisconnectedClients(): void {
    this.clients = this.clients.filter((entry) => this.connectedServers.has(entry.serverName));
  }

  // Fire-and-forget close that never throws — used on error/cleanup paths.
  private async silentlyClose(managed: ManagedClient): Promise<void> {
    this.intentionallyClosing.add(managed.serverName);
    try {
      await managed.client.close();
    } catch {
      // ignore — best-effort teardown
    }
    try {
      await managed.transport.close();
    } catch {
      // ignore — best-effort teardown
    } finally {
      this.intentionallyClosing.delete(managed.serverName);
    }
  }

  getStatus(): McpServerStatus[] {
    const result = [...this.serverStatuses];
    const knownNames = new Set(result.map((s) => s.name));
    for (const name of this.configuredServerNames) {
      if (!knownNames.has(name)) {
        result.push({
          name,
          status: "starting",
          connected: false,
          toolCount: 0,
          tools: [],
          promptCount: 0,
          prompts: [],
          resourceCount: 0,
          resources: [],
        });
      }
    }
    return result;
  }

  getMcpToolDefinitions(): Array<{
    type: "function";
    function: {
      name: string;
      description: string;
      parameters: {
        type: "object";
        properties: Record<string, unknown>;
        required?: string[];
        additionalProperties?: boolean;
      };
    };
  }> {
    return this.tools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.namespacedName,
        description: this.buildMcpToolDescription(t),
        parameters: {
          type: "object" as const,
          properties: t.definition.inputSchema.properties,
          required: t.definition.inputSchema.required,
          ...(t.definition.inputSchema.additionalProperties !== undefined
            ? { additionalProperties: t.definition.inputSchema.additionalProperties }
            : {}),
        },
      },
    }));
  }

  isMcpTool(name: string): boolean {
    return name.startsWith("mcp__");
  }

  async executeMcpTool(
    name: string,
    args: Record<string, unknown>,
    timeoutMs = MCP_CALL_TOOL_TIMEOUT_MS
  ): Promise<{ ok: boolean; name: string; output?: string; error?: string; metadata?: Record<string, unknown> }> {
    const tool = this.tools.find((t) => t.namespacedName === name);
    if (!tool) {
      return { ok: false, name, error: `Unknown MCP tool: ${name}` };
    }

    try {
      const result = (await tool.client.callTool({ name: tool.originalName, arguments: args }, CallToolResultSchema, {
        timeout: timeoutMs,
      })) as CallToolResult;
      const text = result.content
        .filter((c) => c.type === "text" && c.text)
        .map((c) => c.text ?? "")
        .join("\n");
      // Extract embedded resources (e.g. A2UI JSON) — preserve their mimeType
      // and text so the renderer can detect and render them.
      const metadata: Record<string, unknown> = {};
      for (const c of result.content) {
        if (c.type === "resource") {
          const res = c as { resource?: { mimeType?: string; text?: string } };
          const resource = res.resource;
          if (resource?.mimeType === "application/a2ui+json" && resource.text) {
            metadata.a2ui = resource.text;
          }
        }
      }
      // Pass through any custom metadata the tool returned directly (e.g.
      // render_openui returns metadata.openui with the OpenUI Lang code).
      // The MCP SDK uses "passthrough" mode on CallToolResultSchema so these
      // custom fields survive callTool() validation.
      if (result.metadata && typeof result.metadata === "object") {
        Object.assign(metadata, result.metadata as Record<string, unknown>);
      }
      return {
        ok: !result.isError,
        name,
        output: text || JSON.stringify(result.content),
        ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
      };
    } catch (err) {
      return {
        ok: false,
        name,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async getMcpPrompt(
    name: string,
    args: Record<string, unknown>
  ): Promise<{ ok: boolean; name: string; output?: string; error?: string }> {
    const prompt = this.prompts.find((p) => p.namespacedName === name);
    if (!prompt) {
      return { ok: false, name, error: `Unknown MCP prompt: ${name}` };
    }

    try {
      // SDK getPrompt expects Record<string, string> arguments; coerce the
      // unknown values (the manager's public contract uses Record<string, unknown>).
      const stringArgs: Record<string, string> = {};
      for (const [key, value] of Object.entries(args)) {
        stringArgs[key] = typeof value === "string" ? value : JSON.stringify(value);
      }
      const result = await prompt.client.getPrompt({ name: prompt.definition.name, arguments: stringArgs });
      const text = result.messages
        .filter(
          (m): m is { role: "user" | "assistant"; content: { type: "text"; text: string } } => m.content.type === "text"
        )
        .filter((m) => Boolean(m.content.text))
        .map((m) => `[${m.role}] ${m.content.text}`)
        .join("\n");
      return {
        ok: true,
        name,
        output: text || JSON.stringify(result),
      };
    } catch (err) {
      return {
        ok: false,
        name,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async readMcpResource(
    name: string,
    uri: string
  ): Promise<{ ok: boolean; name: string; output?: string; error?: string }> {
    const resource = this.resources.find((r) => r.namespacedName === name);
    if (!resource) {
      return { ok: false, name, error: `Unknown MCP resource: ${name}` };
    }

    try {
      const result = await resource.client.readResource({ uri });
      const text = result.contents
        .filter((c): c is Extract<typeof c, { text: string }> => "text" in c && Boolean(c.text))
        .map((c) => c.text)
        .join("\n");
      return {
        ok: true,
        name,
        output: text || JSON.stringify(result.contents),
      };
    } catch (err) {
      return {
        ok: false,
        name,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // Kept synchronous to preserve the public contract. SDK close() is async, so
  // we fire-and-forget it; the Client/transport tear themselves down in the
  // background and we clear local state immediately.
  disconnect(): void {
    this.disposed = true;
    for (const entry of this.clients) {
      this.intentionallyClosing.add(entry.serverName);
      void entry.client.close().catch(() => {});
      void entry.transport.close().catch(() => {});
    }
    this.clients = [];
    this.connectedServers.clear();
    this.intentionallyClosing.clear();
    this.inProcessServers.clear();
    this.tools = [];
    this.prompts = [];
    this.resources = [];
    this.serverStatuses = [];
    this.configuredServerNames = [];
    this.serverConfigs = {};
    this.initialized = false;
  }

  private async refreshServerTools(serverName: string, client: Client): Promise<void> {
    const serverTools = await this.listAllTools(client);
    this.tools = this.tools.filter((t) => t.serverName !== serverName);
    const toolNamespacedNames: string[] = [];
    const usedToolNames = new Set(this.tools.map((tool) => tool.namespacedName));
    for (const tool of serverTools) {
      const namespacedName = buildMcpNamespacedName(serverName, tool.name, usedToolNames);
      usedToolNames.add(namespacedName);
      this.tools.push({
        serverName,
        originalName: tool.name,
        namespacedName,
        definition: tool,
        client,
      });
      toolNamespacedNames.push(namespacedName);
    }
    const existing = this.serverStatuses.find((s) => s.name === serverName);
    if (existing) {
      existing.toolCount = serverTools.length;
      existing.tools = toolNamespacedNames;
    }
    this.onToolsListChanged?.();
  }

  setOnToolsListChanged(handler: () => void): void {
    this.onToolsListChanged = handler;
  }

  setOnStatusChanged(handler: () => void): void {
    this.onStatusChanged = handler;
  }

  private setStatus(status: McpServerStatus): void {
    if (this.disposed) return;
    const index = this.serverStatuses.findIndex((s) => s.name === status.name);
    if (index === -1) {
      this.serverStatuses.push(status);
    } else {
      this.serverStatuses[index] = status;
    }
    this.onStatusChanged?.();
  }

  private buildMcpToolDescription(tool: McpToolEntry): string {
    const description = tool.definition.description?.trim();
    const source = `${tool.serverName}: ${tool.originalName}`;
    if (!description) {
      return source;
    }
    if (tool.namespacedName === buildRawMcpNamespacedName(tool.serverName, tool.originalName)) {
      return description;
    }
    return `${description}\nMCP source: ${source}`;
  }
}

function buildRawMcpNamespacedName(serverName: string, toolName: string): string {
  return `mcp__${serverName}__${toolName}`;
}

// Append a stderr chunk to the ring buffer, keeping only the most recent
// STDERR_RING_BUFFER_BYTES. Decode as UTF-8 (stderr is human-readable text);
// truncating the head is fine — we only need the tail to surface the most
// recent diagnostic.
function appendStderrRing(prev: string, chunk: Buffer): string {
  const next = prev + chunk.toString("utf8");
  return next.length > STDERR_RING_BUFFER_BYTES ? next.slice(next.length - STDERR_RING_BUFFER_BYTES) : next;
}

// Build a Record<string, string> env (dropping any undefined values that
// process.env carries) merged with per-server overrides. The SDK transport
// requires a Record<string, string>.
function mergeEnv(base: NodeJS.ProcessEnv, overrides?: Record<string, string>): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (typeof value === "string") {
      merged[key] = value;
    }
  }
  if (overrides) {
    for (const [key, value] of Object.entries(overrides)) {
      merged[key] = value;
    }
  }
  return merged;
}

// Adapt SDK Tool/Prompt/Resource shapes into the local definition types used by
// the manager's state. The SDK marks inputSchema.properties as optional and
// values as `object`; we coerce to the non-optional Record<string, unknown>
// shape that getMcpToolDefinitions serializes to the LLM (matching the legacy
// McpClient behavior — properties defaults to {} when absent).
function adaptSdkTool(tool: { name: string; description?: string; inputSchema: unknown }): McpToolDefinition {
  const schema = (tool.inputSchema ?? {}) as {
    type?: "object";
    properties?: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: {
      type: "object",
      properties: schema.properties ?? {},
      ...(schema.required ? { required: schema.required } : {}),
      ...(schema.additionalProperties !== undefined ? { additionalProperties: schema.additionalProperties } : {}),
    },
  };
}

function adaptSdkPrompt(prompt: {
  name: string;
  description?: string;
  arguments?: Array<{ name: string; description?: string; required?: boolean }>;
}): McpPromptDefinition {
  return {
    name: prompt.name,
    description: prompt.description,
    ...(prompt.arguments ? { arguments: prompt.arguments } : {}),
  };
}

function adaptSdkResource(resource: {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}): McpResourceDefinition {
  return {
    uri: resource.uri,
    name: resource.name,
    description: resource.description,
    ...(resource.mimeType ? { mimeType: resource.mimeType } : {}),
  };
}

function sanitizeApiToolNamePart(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9_-]/g, "_");
  return sanitized || "unnamed";
}

function fitApiToolName(name: string, rawName: string): string {
  if (API_TOOL_NAME_PATTERN.test(name) && name.length <= API_TOOL_NAME_MAX_LENGTH) {
    return name;
  }
  return fitApiToolNameWithSuffix(name, `_${hashToolName(rawName)}`);
}

function fitApiToolNameWithSuffix(name: string, suffix: string): string {
  const maxPrefixLength = API_TOOL_NAME_MAX_LENGTH - suffix.length;
  const prefix = name.slice(0, Math.max(1, maxPrefixLength));
  return `${prefix}${suffix}`;
}

function hashToolName(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}
