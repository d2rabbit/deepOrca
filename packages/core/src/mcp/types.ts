/**
 * MCP 类型兼容层。重映射官方 SDK 类型到 DeepOrca 历史名称，
 * 让 executor/index.ts 等外部消费者迁移期间 import 不破。
 * 类型来自 @modelcontextprotocol/sdk/types.js（1.22.0）。
 *
 * 注意：subpath import（`@modelcontextprotocol/sdk/types.js`）是必需的，
 * 1.22.0 的 package.json `exports` 中 bare specifier 不导出 types 子路径。
 */
import type {
  BlobResourceContents as SdkBlobResourceContents,
  Prompt as SdkPrompt,
  PromptArgument as SdkPromptArgument,
  PromptMessage as SdkPromptMessage,
  Resource as SdkResource,
  TextResourceContents as SdkTextResourceContents,
  Tool as SdkTool,
} from "@modelcontextprotocol/sdk/types.js";

export type McpToolDefinition = SdkTool;
export type McpPromptDefinition = SdkPrompt;
export type McpPromptArgument = SdkPromptArgument;
export type McpPromptMessage = SdkPromptMessage;
export type McpResourceDefinition = SdkResource;
export type McpResourceContent = SdkTextResourceContents | SdkBlobResourceContents;
