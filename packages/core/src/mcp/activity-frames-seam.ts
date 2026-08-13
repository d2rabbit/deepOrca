/**
 * Activity-Frames MCP Seam — the injection point for the built-in Activity-Frames
 * behavioral-memory MCP server.
 *
 * Core defines this seam; Desktop injects the concrete server builder at boot.
 * The implementation (DB access, frame collectors, MCP tools) lives in Desktop.
 */

export const ACTIVITY_FRAMES_MCP_SERVER_NAME = "activity-frames";

export interface ActivityFramesServerLike {
  connect(transport: unknown): Promise<void>;
}

export type ActivityFramesServerBuilder = (
  captureDbPath: string | undefined,
  projectRoot: string
) => ActivityFramesServerLike;

let builder: ActivityFramesServerBuilder | null = null;

export function configureActivityFramesServerBuilder(b: ActivityFramesServerBuilder | null): void {
  builder = b;
}

export function getActivityFramesServerBuilder(): ActivityFramesServerBuilder | null {
  return builder;
}
