/**
 * 工具面收窄（specs/model-vendor-profiles P2.2 backlog 落地）。
 *
 * 定位：路由链的**同链后置阶段**，不是第二套路由——消费方
 * （session-manager-mcp.computeRoutedMcpTools）先经 RoutingFacade G2 选出
 * 本会话的相关工具，再把选剩的集合交给本模块做两件确定性的收窄：
 *
 *   ① 模态压制：当前模型原生多模态（catalog `multimodal: true`）时，
 *      vision MCP 的代理转述工具（vision_chat / vision_ocr）冗余——
 *      图片可直接进多模态消息，删掉回退上传面。
 *   ② MCP 披露：剩余工具 schema 估算 token 超过上下文窗口的披露预算
 *      （15%，ZCode 同值）时，把每个服务器的工具清单折叠成一个代理
 *      工具（`mcp__<server>`，参数 tool+arguments），描述只带工具名
 *      清单——披露面先到，调用时再展开。
 *
 * 两阶段都在会话冻结决策内（同一次 decideToolRoute 的产物一起冻结），
 * 保证 DeepSeek 前缀缓存的工具段跨轮稳定。纯函数、零依赖。
 */

import type { ToolDefinition } from "../prompt";

/** 披露预算：工具 schema 估算 token 占上下文窗口的最大比例（ZCode 同值）。 */
export const MCP_DISCLOSURE_BUDGET_RATIO = 0.15;

/** schema 估算：chars/4（与 token-counter 的 CJK 启发式同量级的粗估）。 */
export function estimateToolSurfaceTokens(tools: readonly ToolDefinition[]): number {
  let chars = 0;
  for (const tool of tools) chars += JSON.stringify(tool).length;
  return Math.ceil(chars / 4);
}

/** MCP 工具名约定 `mcp__<server>__<tool>`；非 MCP 名返回 null。 */
function mcpNameParts(name: string): { server: string; tool: string } | null {
  if (!name.startsWith("mcp__")) return null;
  const rest = name.slice("mcp__".length);
  const sep = rest.indexOf("__");
  if (sep <= 0 || sep === rest.length - 2) return null;
  return { server: rest.slice(0, sep), tool: rest.slice(sep + 2) };
}

/**
 * ① 模态压制：模型原生多模态时剔除 vision 代理服务器的工具。
 * 非多模态模型原样返回（该服务器本就是它的能力来源）。
 */
export function suppressRedundantModalityTools(
  tools: readonly ToolDefinition[],
  options: { modelMultimodal: boolean; visionServerName: string }
): ToolDefinition[] {
  if (!options.modelMultimodal) return [...tools];
  const prefix = `mcp__${options.visionServerName}__`;
  const filtered = tools.filter((tool) => !tool.function.name.startsWith(prefix));
  // 全被剔光说明工具面只有 vision——回退全量（空工具面比冗余更糟）。
  return filtered.length > 0 ? filtered : [...tools];
}

/**
 * ② MCP 披露：超预算时按服务器折叠为代理工具。返回 null = 未超预算，
 * 原集合直接可用（调用方据此避免无谓拷贝）。
 */
export function disclosureProxiesIfOverBudget(
  tools: readonly ToolDefinition[],
  options: { toolTokens: number; contextWindowTokens: number }
): ToolDefinition[] | null {
  const budget = options.contextWindowTokens * MCP_DISCLOSURE_BUDGET_RATIO;
  if (options.toolTokens <= budget) return null;

  const byServer = new Map<string, ToolDefinition[]>();
  const passthrough: ToolDefinition[] = [];
  for (const tool of tools) {
    const parts = mcpNameParts(tool.function.name);
    if (!parts) {
      passthrough.push(tool);
      continue;
    }
    const bucket = byServer.get(parts.server);
    if (bucket) bucket.push(tool);
    else byServer.set(parts.server, [tool]);
  }

  const proxies: ToolDefinition[] = [];
  for (const [server, serverTools] of byServer) {
    // 意图保真（审查 2026-09-23）：折叠丢掉的是参数 schema，不该连「每个
    // 工具是干什么的」一起丢——描述清单带每个工具的首句（截 120 字符），
    // 模型仍能选对工具、构造接近正确的参数；错误回包负责其余校正。
    const toolLines = serverTools.map((tool) => {
      const name = mcpNameParts(tool.function.name)?.tool ?? tool.function.name;
      const firstSentence = (tool.function.description ?? "").split(/[.\n]/)[0] ?? "";
      const clipped = firstSentence.length > 120 ? `${firstSentence.slice(0, 117)}...` : firstSentence;
      return clipped ? `- ${name}: ${clipped}` : `- ${name}`;
    });
    proxies.push({
      type: "function",
      function: {
        name: `mcp__${server}`,
        description:
          `Proxy for MCP server "${server}" — full parameter schemas are hidden to keep the ` +
          `request compact. Call with tool=<name> and arguments=<object>.\n` +
          `Available tools:\n${toolLines.join("\n")}`,
        parameters: {
          type: "object",
          properties: {
            tool: {
              type: "string",
              description: "Tool name from the list above.",
              enum: serverTools.map((tool) => mcpNameParts(tool.function.name)?.tool ?? tool.function.name),
            },
            arguments: { type: "object", description: "Arguments object forwarded to the underlying tool." },
          },
          required: ["tool"],
        },
      },
    });
  }
  // 单服务器且本来就不大——折叠无收益的极端不会发生（超预算才进来）；
  // 但若没有任何 MCP 工具可折叠，保持原集合。
  if (proxies.length === 0) return [...tools];
  return [...passthrough, ...proxies];
}

/**
 * 执行侧判定：`mcp__<server>`（两段式名字，非真实 MCP 工具名——真实名
 * 恒为三段式）是否应当作披露代理调用解析。
 */
export function asDisclosureProxyCall(
  toolName: string,
  args: Record<string, unknown>
): { server: string; tool: string; toolArguments: Record<string, unknown> } | null {
  if (!toolName.startsWith("mcp__")) return null;
  const rest = toolName.slice("mcp__".length);
  if (rest.includes("__")) return null; // 三段式 = 真实 MCP 工具名
  if (rest.length === 0) return null;
  const tool = args.tool;
  if (typeof tool !== "string" || tool.length === 0) return null;
  const toolArguments =
    args.arguments !== null && typeof args.arguments === "object" && !Array.isArray(args.arguments)
      ? (args.arguments as Record<string, unknown>)
      : {};
  return { server: rest, tool, toolArguments };
}
