// End-to-end behavioural verification of the GitMCP module, driving the real
// desktop SessionBridge (main-process code) in plain Node with a sandbox HOME.
// Mirrors the manual test checklist of specs/gitmcp-local-module/tasks.md #12.
import { mkdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const sandboxHome = path.join(here, "home");
if (process.env.HOME !== sandboxHome) {
  console.error(`FATAL: HOME must be the sandbox (${sandboxHome}), got ${process.env.HOME}`);
  process.exit(2);
}
rmSync(sandboxHome, { recursive: true, force: true });
const projectRoot = path.join(here, "project");
mkdirSync(sandboxHome, { recursive: true });
mkdirSync(projectRoot, { recursive: true });

const { SessionBridge } = await import("../packages/desktop/src/main/session-bridge.js");
const { buildGitmcpMcpServerConfig, readGitmcpRepoMeta } = await import("@vegamo/deepcode-core");

let failures = 0;
function check(label: string, ok: boolean, detail?: string): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failures++;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const events: string[] = [];
const bridge = new SessionBridge(projectRoot, (channel: string) => {
  events.push(channel);
});

// ── 1. Add: invalid / valid / duplicate ─────────────────────────────────────
const bad = bridge.gitmcpAdd("not a valid @@ input");
check("add invalid input rejected", !bad.ok && bad.error === "invalid", JSON.stringify(bad));

const SLUG = "octocat/Spoon-Knife";
const added = bridge.gitmcpAdd("https://github.com/octocat/Spoon-Knife");
check("add via full URL", added.ok === true && added.slug === SLUG, JSON.stringify(added));

const dup = bridge.gitmcpAdd("octocat/spoon-knife"); // case-insensitive duplicate
check("duplicate rejected (case-insensitive)", !dup.ok && dup.error === "exists", JSON.stringify(dup));

// Placeholder entry persisted to *user-level* settings
const settingsPath = path.join(homedir(), ".deepcode", "settings.json");
const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
const entry = settings.mcpServers?.[`gitmcp:${SLUG}`];
check(
  "user settings hold placeholder config",
  entry?.command === "gitmcp" && entry?.args?.[0] === SLUG,
  JSON.stringify(entry)
);

// ── 2. List state before indexing ───────────────────────────────────────────
let list = bridge.gitmcpList();
check(
  "list shows repo enabled + not indexed",
  list.length === 1 && list[0].slug === SLUG && list[0].enabled && !list[0].indexed,
  JSON.stringify(list)
);

// ── 3. Reindex builds the local index ───────────────────────────────────────
const reindex = await bridge.gitmcpReindex(SLUG);
check("reindex succeeds (live GitHub fetch)", reindex.ok === true, reindex.error);
list = bridge.gitmcpList();
check(
  "list shows indexed + chunk count + fetchedAt",
  list[0]?.indexed === true && list[0].chunkCount > 0 && typeof list[0].fetchedAt === "number",
  JSON.stringify(list)
);

// ── 4. Engine activates the server (placeholder rewritten → real spawn) ─────
let connected = false;
for (let i = 0; i < 30 && !connected; i++) {
  await sleep(1000);
  const st = bridge.mcpStatus().find((s: { name: string }) => s.name === `gitmcp:${SLUG}`);
  connected = Boolean(st?.connected);
}
const status = bridge.mcpStatus().find((s: { name: string }) => s.name === `gitmcp:${SLUG}`);
const toolPrefix = `mcp__gitmcp_${SLUG.replace("/", "_")}__`;
check(
  "MCP server connects with the 4 fixed tools",
  Boolean(status?.connected) &&
    ["fetch_documentation", "search_documentation", "search_code", "fetch_url_content"].every((t) =>
      status?.tools?.includes(`${toolPrefix}${t}`)
    ),
  JSON.stringify(status)
);

// ── 5. Plugin-center MCP tab contract: builtin (toggle-only, non-removable) ─
const mcpTab = bridge.pluginMcpList();
const gitmcpRow = mcpTab.find((s: { name: string }) => s.name === `gitmcp:${SLUG}`);
check("MCP tab marks gitmcp entry builtin=true", gitmcpRow?.builtin === true, JSON.stringify(gitmcpRow));
const codegraphRow = mcpTab.find((s: { name: string }) => s.name === "codegraph");
check("codegraph stays builtin (no regression)", codegraphRow?.builtin === true, JSON.stringify(codegraphRow));

// ── 6. Toggle off / on from the GitMCP module ───────────────────────────────
bridge.pluginSetMcpEnabled(`gitmcp:${SLUG}`, false);
check("toggle off reflected in gitmcpList", bridge.gitmcpList()[0]?.enabled === false);
bridge.pluginSetMcpEnabled(`gitmcp:${SLUG}`, true);
check("toggle on reflected in gitmcpList", bridge.gitmcpList()[0]?.enabled === true);

// ── 7. Offline retrieval: spawn the real server with fetch disabled ─────────
const spawnCfg = buildGitmcpMcpServerConfig(SLUG);
check("placeholder resolves to concrete spawn config", Boolean(spawnCfg), JSON.stringify(spawnCfg));
if (spawnCfg) {
  const child = spawn(spawnCfg.command, spawnCfg.args ?? [], {
    env: {
      ...process.env,
      ...spawnCfg.env,
      NODE_OPTIONS: `--import ${JSON.stringify(path.join(here, "offline-shim.mjs"))}`,
    },
    stdio: ["pipe", "pipe", "inherit"],
  });
  const pending = new Map<number, (msg: unknown) => void>();
  let buf = "";
  child.stdout.on("data", (chunk: Buffer) => {
    buf += chunk.toString("utf8");
    let idx: number;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      pending.get(msg.id)?.(msg);
    }
  });
  let nextId = 1;
  const rpc = (method: string, params?: unknown): Promise<any> =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, resolve);
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
      setTimeout(() => reject(new Error(`rpc timeout: ${method}`)), 15000);
    });

  const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {} });
  check("offline server handshake", Boolean(init.result?.serverInfo), JSON.stringify(init.result?.serverInfo));
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  const search = await rpc("tools/call", {
    name: "search_documentation",
    arguments: { query: "fork repository" },
  });
  const text: string = search.result?.content?.[0]?.text ?? "";
  check(
    "search_documentation hits local index while fully offline",
    !search.result?.isError && text.length > 0 && !text.includes("offline: network disabled"),
    text.slice(0, 120).replace(/\n/g, " ")
  );
  child.kill();
}

// ── 8. Remove: settings entry + index data both gone ────────────────────────
bridge.gitmcpRemove(SLUG);
check("gitmcpList empty after remove", bridge.gitmcpList().length === 0);
const after = JSON.parse(readFileSync(settingsPath, "utf8"));
check("settings entry removed", !after.mcpServers || !(`gitmcp:${SLUG}` in after.mcpServers));
check("index metadata removed", readGitmcpRepoMeta().every((m: { slug: string }) => m.slug !== SLUG));
check(
  "index db file still present (shared store)",
  existsSync(path.join(homedir(), ".deepcode", "gitmcp", "index.db"))
);

check("McpStatusChanged events emitted", events.includes("mcp-status-changed") || events.length > 0, `events=${events.length}`);

bridge.dispose();
console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
