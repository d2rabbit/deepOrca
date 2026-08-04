/**
 * @deeporca/memory — In-process L0-L3 memory pipeline.
 *
 * This package integrates TDAI Core (TencentDB Agent Memory) as an in-process
 * library, replacing the previous HTTP sidecar architecture. It provides:
 *
 * - L0: Raw conversation recording
 * - L1: Atomic fact extraction (LLM-powered)
 * - L2: Scene segmentation and accumulation
 * - L3: User persona generation
 *
 * The pipeline runs entirely within the Electron main process using the
 * bundled Node runtime — no external processes, no HTTP overhead.
 *
 * Integration with DeepOrca is via the `MemoryProvider` interface (defined
 * in @deeporca/core), which this package implements.
 */

// Public API — will be populated as implementation progresses.
// For now this is a placeholder export.

export const MEMORY_PACKAGE_VERSION = "0.1.34";
