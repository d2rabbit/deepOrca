/**
 * 功能层面测试（specs/model-vendor-profiles）——单测之上的引擎回路验证：
 * 真实 SessionManager + 录制网关跑完整 activateSession，断言**发出的请求
 * 形状**（思考形状/温度门控/探针同轮去补丁重发）；真实 vendored models.dev
 * 快照的数据驱动解析（G3 自有序/H4 折叠视图在真数据上成立）；真实 bash→
 * spill→read 工具回环；披露代理经 executor 分发。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { fileURLToPath } from "node:url";
import { SessionManager } from "../session";
import { configureModelCatalog, catalogLookupModel } from "../common/model-catalog";
import { resolveModelProfile } from "../common/model-profile";
import { resetWireOptimizationProbe } from "../common/model-probe";
import {
  createChatResponse,
  createSkillMatchingResponse,
  isSkillMatchingRequest,
  registerSessionTestCleanup,
  setHomeDir,
} from "./session-test-utils";
import { handleBashTool } from "../tools/bash-handler";
import { handleReadTool } from "../tools/read-handler";
import { ToolExecutor } from "../tools/executor";
import type { McpManager } from "../mcp/mcp-manager";

registerSessionTestCleanup();

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const FILLERS = Object.fromEntries(Array.from({ length: 19 }, (_, i) => [`filler-${i}`, { models: {} }]));

function syntheticCatalog(models: Record<string, unknown>): string {
  return JSON.stringify({ provider: { api: "https://provider.test/v1", models }, ...FILLERS });
}

type RecordedRequest = Record<string, unknown>;

/** 录制网关：skill-matching 拦截不入录制；其余按 handler 应答。 */
function createRecordingChatClient(handler: (request: RecordedRequest, index: number) => unknown): {
  client: unknown;
  requests: RecordedRequest[];
} {
  const requests: RecordedRequest[] = [];
  // baseURL 必须挂在 client 上（真实 OpenAI SDK 形态）——探针 origin 盖章
  // 从 client 内省读取，记账与查询的通道键一致性依赖它。
  const client = {
    baseURL: "https://api.example.com/v1",
    chat: {
      completions: {
        create: async (request: RecordedRequest) => {
          if (isSkillMatchingRequest(request)) {
            return createSkillMatchingResponse();
          }
          const index = requests.length;
          requests.push(request);
          return handler(request, index);
        },
      },
    },
  };
  return { client, requests };
}

interface ManagerOverrides {
  model?: string;
  temperature?: number;
  thinkingEnabled?: boolean;
}

function createEngine(projectRoot: string, client: unknown, overrides: ManagerOverrides = {}): SessionManager {
  return new SessionManager({
    projectRoot,
    createOpenAIClient: () => ({
      client: client as never,
      model: overrides.model ?? "test-model",
      baseURL: "https://api.example.com/v1",
      temperature: overrides.temperature,
      thinkingEnabled: overrides.thinkingEnabled ?? false,
    }),
    getResolvedSettings: () => ({ model: overrides.model ?? "test-model" }),
    renderMarkdown: (text) => text,
    onAssistantMessage: () => {},
  });
}

const THINKING_KEYS = ["thinking", "enable_thinking", "reasoning_effort", "reasoning", "chat_template_kwargs"] as const;

function hasThinkingKeys(request: RecordedRequest): boolean {
  return THINKING_KEYS.some((key) => key in request);
}

// ── 1. 探针引擎回路：可归因 400 → 记账 → 同轮去补丁重发 → 会话完成 ──────────

test("engine probe loop: attributable 400 re-issues the turn without any thinking keys and completes", async () => {
  const workspace = createTempDir("deeporca-func-probe-ws-");
  const home = createTempDir("deeporca-func-probe-home-");
  setHomeDir(home);
  resetWireOptimizationProbe();
  configureModelCatalog(
    syntheticCatalog({
      // effort-only 阶梯（无 none/off）→ thinkingMandatory=true → 画像携带补丁。
      "glm-5.3": {
        reasoning: true,
        tool_call: true,
        reasoning_options: [{ type: "effort", values: ["low", "high", "max"] }],
      },
    })
  );

  const attributable = Object.assign(new Error("Invalid parameter: reasoning_effort"), { status: 400 });
  const { client, requests } = createRecordingChatClient((request, index) => {
    if (index === 0) throw attributable;
    return createChatResponse("probe recovered", { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 });
  });
  const manager = createEngine(workspace, client, { model: "glm-5.3", temperature: 0.7, thinkingEnabled: false });

  const sessionId = await manager.createSession({ text: "hello" });
  const session = manager.getSession(sessionId);

  // 会话完成（同轮重发成功），probeFallback 提示后第二轮请求消费。
  assert.equal(session?.status, "completed");
  assert.ok(requests.length >= 2, `expected the patched request and the unpatched retry, got ${requests.length}`);

  // 首请求：mandatory 强制开思考（用户关思考也被抬升）→ glm 四拼写补丁全量。
  const first = requests[0]!;
  assert.equal((first.thinking as { type?: string })?.type, "enabled");
  assert.equal(first.enable_thinking, true);
  assert.equal(first.reasoning_effort, "high");
  assert.deepEqual(first.reasoning, { effort: "high" });
  // 白名单模型 + 目录未声明 temperature:false → 门不剥字段。
  assert.equal(first.temperature, 0.7);

  // 重发请求：veto 生效 → 不发任何思考键（round-4 H2/H3 统一矩阵）。
  const retry = requests[1]!;
  assert.equal(
    hasThinkingKeys(retry),
    false,
    `retry must carry no thinking keys, got: ${JSON.stringify(Object.keys(retry))}`
  );
  assert.equal(retry.temperature, 0.7, "only the rejected dimension is removed, unrelated fields stay");

  configureModelCatalog(null);
  resetWireOptimizationProbe();
});

// ── 2. 温度门控（引擎回路）：白名单剥字段 / 非白名单保留（G6）────────────────

test("engine temperature gate: whitelist temperature:false strips the field; non-whitelist keeps it", async () => {
  const workspace = createTempDir("deeporca-func-temp-ws-");
  const home = createTempDir("deeporca-func-temp-home-");
  setHomeDir(home);
  configureModelCatalog(
    syntheticCatalog({
      "kimi-k3": { reasoning: true, tool_call: true, temperature: false },
      "some-unknown-model": { reasoning: true, tool_call: true, temperature: false },
    })
  );

  // (a) kimi-k3（白名单，目录声明 temperature:false）→ 请求无 temperature。
  {
    const { client, requests } = createRecordingChatClient(() =>
      createChatResponse("ok-kimi", { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 })
    );
    const manager = createEngine(workspace, client, { model: "kimi-k3", temperature: 0.7 });
    const sessionId = await manager.createSession({ text: "hi" });
    assert.equal(manager.getSession(sessionId)?.status, "completed");
    assert.equal(requests[0]?.temperature, undefined, "whitelist + catalog temperature:false must strip the field");
  }

  // (b) 非白名单模型，目录同样声明 temperature:false → 字段保留（R7 画像层
  //     逐字节承诺，round-3 G6：门只对白名单生效）。
  {
    const { client, requests } = createRecordingChatClient(() =>
      createChatResponse("ok-unknown", { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 })
    );
    const manager = createEngine(workspace, client, { model: "some-unknown-model", temperature: 0.7 });
    const sessionId = await manager.createSession({ text: "hi" });
    assert.equal(manager.getSession(sessionId)?.status, "completed");
    assert.equal(requests[0]?.temperature, 0.7, "non-whitelist models keep today's conditional-send behavior");
  }

  configureModelCatalog(null);
});

// ── 3. 真实 vendored 快照的数据驱动功能面（文件缺席时跳过）───────────────────

const SNAPSHOT_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "desktop",
  "vendor",
  "models-dev",
  "api.json"
);

test(
  "real vendored snapshot: ranking, folded view and mandatory derivation hold on production data",
  { skip: !fs.existsSync(SNAPSHOT_PATH) },
  () => {
    configureModelCatalog(fs.readFileSync(SNAPSHOT_PATH, "utf8"));
    try {
      // G3：kimi-k3 必须取厂商自家（moonshotai）条目——toggle 在场 ⇒ 非强制。
      const kimi = resolveModelProfile({ model: "kimi-k3", catalogEntry: catalogLookupModel("kimi-k3") });
      assert.equal(kimi.matchedBy, "model");
      assert.equal(kimi.wire.thinkingMandatory, false, "vendor toggle declaration must win over reseller effort-only");

      // H4：minimax-m3（小写拼写）必须经折叠视图拿到厂商 1M 条目。
      const minimaxLower = catalogLookupModel("minimax-m3");
      assert.ok(minimaxLower, "lowercase minimax-m3 must resolve");
      assert.equal(minimaxLower?.contextTokens, 1_048_576, "folded view must surface the vendor's 1M entry");

      // glm-5.3：zhipuai effort-only（无 toggle/off）⇒ mandatory=true。
      const glm = resolveModelProfile({ model: "glm-5.3", catalogEntry: catalogLookupModel("glm-5.3") });
      assert.equal(glm.wire.thinkingMandatory, true);

      // agnes 双子均可解析且窗口 ≥512K。
      for (const model of ["agnes-2.5-flash", "agnes-3.0-flash"]) {
        const entry = catalogLookupModel(model);
        assert.ok(entry, `${model} must resolve from the snapshot`);
        assert.ok((entry?.contextTokens ?? 0) >= 500_000, `${model} window should be ~512K`);
      }

      // deepseek-flash：官方条目含 toggle ⇒ 可关。
      const deepseek = resolveModelProfile({
        model: "deepseek-flash",
        catalogEntry: catalogLookupModel("deepseek-flash"),
      });
      assert.equal(deepseek.wire.thinkingMandatory, false);

      // 白名单全表逐 id 可解析且 matchedBy=model（支持矩阵 → 注册表的功能面核对）。
      const whitelist: Array<[string, string]> = [
        ["deepseek-flash", "deepseek"],
        ["deepseek-v4-flash", "deepseek"],
        ["deepseek-v4-pro", "deepseek"],
        ["deepseek-v4-flash-vision-exp", "deepseek"],
        ["step-5-preview", "stepfun"],
        ["step-3.7-flash", "stepfun"],
        ["step-router-v1", "stepfun"],
        ["kimi-k3", "kimi"],
        ["kimi-k2.7-code", "kimi"],
        ["kimi-k2.7-code-highspeed", "kimi"],
        ["kimi-for-coding", "kimi"],
        ["MiniMax-M3", "minimax"],
        ["minimax-m3", "minimax"],
        ["qwen3.8-flash", "qwen"],
        ["qwen3.8-max", "qwen"],
        ["qwen3.8-plus", "qwen"],
        ["qwen3.8-max-preview", "qwen"],
        ["glm-5.3", "glm"],
        ["glm-5.3-flash", "glm"],
        ["glm-5.3-flashx", "glm"],
        ["glm-5.3-highspeed", "glm"],
        ["mimo-v2.5", "mimo"],
        ["mimo-v2.6-pro", "mimo"],
        ["agnes-2.5-flash", "agnes"],
        ["agnes-3.0-flash", "agnes"],
      ];
      for (const [model, vendor] of whitelist) {
        const profile = resolveModelProfile({ model, catalogEntry: catalogLookupModel(model) });
        assert.equal(profile.matchedBy, "model", model);
        assert.equal(profile.vendor, vendor, model);
      }
    } finally {
      configureModelCatalog(null);
    }
  }
);

// ── 4. spill → read 工具回环：真实 bash 截断落盘，read 取回尾部标记 ─────────

test("functional spill round trip: oversized bash output spills to disk and the read tool recovers the tail", async () => {
  const workspace = createTempDir("deeporca-func-spill-ws-");
  const context = {
    sessionId: "spill-s1",
    projectRoot: workspace,
    toolCall: { id: "t1", type: "function", function: { name: "bash", arguments: "{}" } },
  } as never;

  const bash = await handleBashTool(
    {
      command: `node -e "process.stdout.write('x'.repeat(40000)); process.stdout.write('\\\\nTAIL_MARKER_UNIQUE_9F3A');"`,
    },
    context
  );
  assert.equal(bash.ok, true, bash.error);
  const output = typeof bash.output === "string" ? bash.output : "";
  assert.match(output, /output truncated at 30000 chars/);
  // 反 dsh 截断语义：指针是唯一恢复杠杆。
  assert.doesNotMatch(output, /re-run/);
  const match = output.match(/full output saved to ([^\s]+) —/);
  assert.ok(match, `pointer must name the spill path: ${output.slice(-400)}`);
  const spillPath = match![1]!;
  assert.equal(fs.existsSync(spillPath), true, "spill artifact must exist on disk");

  // 模型按指针续读：read 工具取回完整原文（含尾部标记）。
  const read = await handleReadTool({ file_path: spillPath }, context);
  assert.equal(read.ok, true, read.error);
  const content = typeof read.output === "string" ? read.output : "";
  assert.match(content, /TAIL_MARKER_UNIQUE_9F3A/, "the spilled tail marker must be readable via the read tool");

  // 自忽略：spill 目录不被 git 追踪。
  assert.equal(fs.readFileSync(path.join(workspace, ".deeporca", "spill", ".gitignore"), "utf8"), "*\n");
});

// ── 5. 披露代理经 executor 分发：解析后真名存在性守卫 ────────────────────────

test("executor proxy dispatch: {tool, arguments} forwards to the real three-segment tool; malformed falls to unknown", async () => {
  const dispatched: Array<[string, Record<string, unknown>]> = [];
  const mcpManager = {
    isMcpTool: (name: string) => name.startsWith("mcp__"),
    hasMcpTool: (name: string) => name === "mcp__srv__real",
    // 真实管理器语义：未知名 → 结构化错误（而非无条件成功）。
    executeMcpTool: async (name: string, args: Record<string, unknown>) => {
      if (name !== "mcp__srv__real") {
        return { ok: false, name, error: `Unknown MCP tool: ${name}` };
      }
      dispatched.push([name, args]);
      return { ok: true, name, output: "mcp-ok" };
    },
  } as unknown as McpManager;
  const executor = new ToolExecutor(createTempDir("deeporca-func-proxy-"), undefined, mcpManager);

  // 合法代理调用：两段名 + {tool, arguments} → 真实三段名直连。
  const ok = await executor.executeToolCalls("s1", [
    { id: "p1", type: "function", function: { name: "mcp__srv", arguments: '{"tool":"real","arguments":{"a":1}}' } },
  ]);
  assert.equal(ok[0].result.ok, true);
  assert.deepEqual(dispatched, [["mcp__srv__real", { a: 1 }]]);

  // 畸形代理调用（解析后的真名不存在）→ 干净的 Unknown tool 错误。
  const bad = await executor.executeToolCalls("s1", [
    { id: "p2", type: "function", function: { name: "mcp__srv", arguments: '{"tool":"ghost"}' } },
  ]);
  assert.equal(bad[0].result.ok, false);
  // 真实管理器对该名字的报错是 "Unknown MCP tool: …"（结构化、零副作用）。
  assert.match(bad[0].result.error ?? "", /Unknown (MCP )?tool/);
  assert.equal(dispatched.length, 1, "no dispatch may happen for a non-existent resolved tool");
});
