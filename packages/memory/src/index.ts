/**
 * @deeporca/memory — In-process L0-L3 memory pipeline.
 *
 * Integrates TDAI Core (TencentDB Agent Memory) as an in-process library.
 * Provides cross-session semantic memory: L0 raw conversations → L1 atomic
 * facts → L2 scene segments → L3 user persona.
 *
 * Complementary to activity-frames (session-level behavioral context):
 *   - @deeporca/memory: "User prefers TypeScript and React across all projects"
 *   - activity-frames: "In the last 5 minutes, edited auth.ts and ran git commit"
 *
 * MIT License — see tdai/NOTICE.md for Tencent copyright attribution.
 */

export { MemoryManager } from "./memory-manager.js";
export { DeepOrcaHostAdapter, type DeepOrcaMemoryConfig } from "./adapter.js";
