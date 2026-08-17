/**
 * Activity-Frames public API.
 */

export { buildActivityFramesServer, ACTIVITY_FRAMES_MCP_SERVER_NAME } from "./mcp";
export { ActivityDb, findDefaultDb } from "./db";
export { parseUrl } from "./entities";
export { segments, coverage, appLedger, cleanName, domain } from "./sessionize";
export { buildFrames, buildDay, buildRecent } from "./frames";
export {
  parseEpoch,
  localDayWindowUtc,
  hoursAgoWindowUtc,
  fmtLocalHms,
  fmtLocalHm,
  utcNowString,
  localDayString,
} from "./time";
export * from "./types";
export { collectSessionProfile } from "./collectors/session-collector";
export type { SessionProfile, ToolUsage, FileHotspot, WorkflowPattern } from "./collectors/session-collector";
export { collectGitProfile } from "./collectors/git-collector";
export type { GitProfile, GitCommit, GitFileHotspot } from "./collectors/git-collector";
export { collectShellProfile } from "./collectors/shell-collector";
export type { ShellProfile } from "./collectors/shell-collector";
export { collectFileProfile } from "./collectors/file-collector";
export type { FileProfile } from "./collectors/file-collector";
export { collectProfile, formatContextBlock, formatProfileJson } from "./collectors/aggregator";
export type { BehavioralProfile } from "./collectors/aggregator";
