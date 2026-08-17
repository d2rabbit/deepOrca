/**
 * Vision MCP Seam — the injection point for the built-in vision MCP plugin.
 *
 * Core defines this seam; Desktop injects the concrete `buildVisionServer`
 * implementation at boot (same pattern as CrgController / ReviewController /
 * CodegraphController / WikiController). The implementation lives in Desktop
 * because it makes OpenAI-compatible API calls to a vision model endpoint.
 *
 * When a vision model is configured in settings and this seam is injected,
 * the session manager connects the returned in-process MCP server, exposing
 * `vision_chat` and `vision_ocr` tools that the agent can call.
 */

export const VISION_MCP_SERVER_NAME = "vision";

/** A server builder returns an object compatible with connectInProcessServer. */
export interface VisionServerLike {
  connect(transport: unknown): Promise<void>;
}

export type VisionServerBuilder = (projectRoot: string) => VisionServerLike;

let builder: VisionServerBuilder | null = null;

export function configureVisionServerBuilder(b: VisionServerBuilder | null): void {
  builder = b;
}

export function getVisionServerBuilder(): VisionServerBuilder | null {
  return builder;
}
