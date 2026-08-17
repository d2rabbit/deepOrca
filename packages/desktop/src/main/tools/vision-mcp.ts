/**
 * Vision MCP Server — desktop implementation of the vision seam.
 *
 * Built-in in-process MCP server that gives text-only LLMs (like DeepSeek)
 * the ability to understand images via a vision-capable proxy model
 * (Qwen-VL, GPT-4o, etc.). The vision model + endpoint are configured in
 * settings.json as `visionModel` and `visionEndpointId`.
 *
 * Exposes two tools:
 * - `vision_chat`: analyze/describe images with a natural language prompt
 * - `vision_ocr`: extract text content from an image (OCR)
 *
 * Injected at boot via `configureVisionServerBuilder(buildVisionServer)`.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v3";
import type { ZodRawShape } from "zod/v3";
import { readFileSync, existsSync } from "node:fs";
import { extname } from "node:path";
import { createVisionClient } from "@deeporca/core";

const SERVER_INFO = { name: "deeporca-vision", version: "0.1.0" };

// The SDK's registerTool generics are stricter than we need; rebind loosely.
type RegisterToolLoose = (
  name: string,
  config: { description?: string; inputSchema?: ZodRawShape },
  cb: (args: Record<string, unknown>) => CallToolResult | Promise<CallToolResult>
) => unknown;

function textResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

function errorResult(message: string): CallToolResult {
  return { content: [{ type: "text", text: `❌ ${message}` }], isError: true };
}

// ── Image source encoding ──────────────────────────────────────────────────

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
};

/**
 * Encode an image source into an OpenAI-compatible image URL.
 * Accepts: local file path, http(s) URL, or data: URL.
 */
function encodeImageSource(source: string): string {
  // Already a data URL or remote URL — pass through.
  if (source.startsWith("data:") || source.startsWith("http://") || source.startsWith("https://")) {
    return source;
  }

  // Local file path — read and base64-encode.
  if (!existsSync(source)) {
    throw new Error(`Image file not found: ${source}`);
  }

  const ext = extname(source).toLowerCase();
  const mime = MIME_BY_EXT[ext] ?? "image/png";
  const buffer = readFileSync(source);
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

// ── Core vision call ───────────────────────────────────────────────────────

interface VisionCallOptions {
  images: string[];
  text: string;
  maxTokens?: number;
  projectRoot: string;
}

async function callVisionModel(opts: VisionCallOptions): Promise<string> {
  const { client, model } = createVisionClient(opts.projectRoot);
  if (!client) {
    throw new Error("未配置视觉模型。请在「设置 → 模型」中选择一个支持视觉能力的模型。");
  }

  // Encode all image sources to OpenAI-compatible format.
  const encodedImages = opts.images.map((src) => {
    try {
      return encodeImageSource(src);
    } catch (err) {
      throw new Error(`图片编码失败 (${src}): ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const content: any[] = [
    ...encodedImages.map((url) => ({ type: "image_url", image_url: { url } })),
    { type: "text", text: opts.text },
  ];

  const response = await client.chat.completions.create({
    model,
    max_tokens: opts.maxTokens ?? 2048,
    messages: [{ role: "user", content }],
  });

  return response.choices[0]?.message?.content ?? "(视觉模型未返回内容)";
}

// ── Server builder ─────────────────────────────────────────────────────────

export function buildVisionServer(projectRoot: string): McpServer {
  const server = new McpServer(SERVER_INFO);
  const registerTool = server.registerTool.bind(server) as unknown as RegisterToolLoose;

  // Tool 1: vision_chat — analyze/describe images with a natural language prompt
  registerTool(
    "vision_chat",
    {
      description:
        "使用视觉模型分析图片内容并返回文本描述。当主模型（如 DeepSeek）不支持视觉时，通过此工具代理理解图片。" +
        "支持本地文件路径、HTTP(S) URL、base64 data URL。可传入多张图片进行对比分析。",
      inputSchema: {
        images: z.array(z.string()).describe("图片列表（本地路径 / URL / data:base64）"),
        text: z.string().describe("视觉理解提示词，例如「描述这张图片的布局」或「这个 UI 截图有什么问题」"),
      },
    },
    async (args) => {
      const images = args.images as string[];
      const text = args.text as string;
      if (!images || images.length === 0) {
        return errorResult("请至少提供一张图片。");
      }
      try {
        const result = await callVisionModel({ images, text, projectRoot });
        return textResult(result);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  // Tool 2: vision_ocr — extract text content from an image
  registerTool(
    "vision_ocr",
    {
      description:
        "使用视觉模型进行 OCR 文字识别，提取图片中的所有文本内容，保持原始排版。" +
        "适用于截图、文档扫描件、UI 截图中的文字提取。",
      inputSchema: {
        image: z.string().describe("图片路径 / URL / data:base64"),
      },
    },
    async (args) => {
      const image = args.image as string;
      if (!image) {
        return errorResult("请提供图片路径或 URL。");
      }
      try {
        const result = await callVisionModel({
          images: [image],
          text: "请提取这张图片中的所有文字内容，保持原始排版和层次结构。只输出识别到的文字，不要添加额外说明。",
          projectRoot,
        });
        return textResult(result);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    }
  );

  return server;
}
