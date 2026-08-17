/**
 * L1 Memory Extractor: extracts structured memories from L0 conversation messages
 * using a single LLM call with JSON-mode structured output.
 *
 * v3: Aligned with Kenty's prompt — scene segmentation + memory extraction in one call,
 * followed by batch conflict detection.
 *
 * Pipeline:
 * 1. Read recent messages from L0 (split into background + new)
 * 2. Call LLM to extract scene-segmented memories
 * 3. Deterministic output validation (unknown-reference reset, droppable-content
 *    filter, in-batch dedup, fabricated-date visibility)
 * 4. Batch conflict detection against existing records
 * 5. Write to L1 JSONL files
 */

import type { ConversationMessage } from "../conversation/l0-recorder.js";
import { EXTRACT_MEMORIES_SYSTEM_PROMPT, formatExtractionPrompt } from "../prompts/l1-extraction.js";
import { batchDedup } from "./l1-dedup.js";
import { writeMemory, generateMemoryId } from "./l1-writer.js";
import type { ExtractedMemory, MemoryRecord, MemoryType, DedupDecision } from "./l1-writer.js";
import { CleanContextRunner } from "../../utils/clean-context-runner.js";
import { sanitizeJsonForParse, shouldExtractL1 } from "../../utils/sanitize.js";
import type { IMemoryStore } from "../store/types.js";
import type { EmbeddingService } from "../store/embedding.js";
import { report } from "../report/reporter.js";
import type { LLMRunner } from "../types.js";

interface Logger {
  debug?: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

const TAG = "[memory-tdai][l1-extractor]";

// ============================
// Types
// ============================

/** A scene segment with its extracted memories (LLM output) */
interface SceneSegment {
  scene_name: string;
  message_ids: string[];
  memories: Array<{
    content: string;
    type: string;
    priority: number;
    source_message_ids: string[];
    metadata: Record<string, unknown>;
  }>;
}

export interface L1ExtractionResult {
  /** Whether extraction succeeded */
  success: boolean;
  /** Number of memories extracted */
  extractedCount: number;
  /** Number of memories actually stored (after dedup) */
  storedCount: number;
  /** The memory records that were stored */
  records: MemoryRecord[];
  /** Scene names detected during extraction */
  sceneNames: string[];
  /** Last scene name (for continuity in next extraction) */
  lastSceneName?: string;
}

// ============================
// Core function
// ============================

/**
 * Run the full L1 extraction pipeline on conversation messages.
 *
 * @param messages - Filtered conversation messages (from L0 or directly from hook)
 * @param sessionKey - The session key
 * @param baseDir - Base data directory (~/.openclaw/memory-tdai/)
 * @param config - OpenClaw config (for LLM access)
 * @param options - Extraction options
 * @param logger - Optional logger
 */
export async function extractL1Memories(params: {
  messages: ConversationMessage[];
  sessionKey: string;
  sessionId?: string;
  baseDir: string;
  config: unknown;
  options?: {
    /** Max new messages to send in one extraction call */
    maxMessagesPerExtraction?: number;
    /** Max background messages for context */
    maxBackgroundMessages?: number;
    /** Enable conflict detection */
    enableDedup?: boolean;
    /** Max memories extracted per call */
    maxMemoriesPerSession?: number;
    /** LLM model override */
    model?: string;
    /** Previous scene name for continuity */
    previousSceneName?: string;
    /** Vector store for cosine similarity candidate recall */
    vectorStore?: IMemoryStore;
    /** Embedding service for computing query vectors */
    embeddingService?: EmbeddingService;
    /** Top-K candidates for conflict recall (default: 5) */
    conflictRecallTopK?: number;
    /** Override embedding timeout for capture-path calls (milliseconds) */
    embeddingTimeoutMs?: number;
    /**
     * Host-neutral LLM runner. When provided, used instead of creating
     * a CleanContextRunner (decouples from OpenClaw runtime).
     */
    llmRunner?: LLMRunner;
  };
  logger?: Logger;
  /** Plugin instance ID for metric reporting (optional — metrics skipped if absent) */
  instanceId?: string;
}): Promise<L1ExtractionResult> {
  const { messages, sessionKey, sessionId, baseDir, config, logger, instanceId: metricInstanceId } = params;
  const options = params.options ?? {};
  const maxNewMessages = options.maxMessagesPerExtraction ?? 10;
  const maxBgMessages = options.maxBackgroundMessages ?? 5;
  const enableDedup = options.enableDedup ?? true;
  const maxMemoriesPerSession = options.maxMemoriesPerSession ?? 10;

  if (messages.length === 0) {
    logger?.debug?.(`${TAG} No messages to extract from`);
    return { success: true, extractedCount: 0, storedCount: 0, records: [], sceneNames: [] };
  }

  const l1StartMs = Date.now();

  // Quality gate: filter messages through L1 extraction rules (length, symbols,
  // prompt injection, etc.) before sending to the LLM. L0 deliberately captures
  // everything; the strict filtering happens here at L1 stage.
  const qualifiedMessages = messages.filter((m) => shouldExtractL1(m.content));
  if (qualifiedMessages.length < messages.length) {
    logger?.debug?.(
      `${TAG} L1 quality filter: ${messages.length} → ${qualifiedMessages.length} messages ` +
        `(${messages.length - qualifiedMessages.length} filtered out)`
    );
  }

  if (qualifiedMessages.length === 0) {
    logger?.debug?.(`${TAG} All messages filtered out by L1 quality gate`);
    return { success: true, extractedCount: 0, storedCount: 0, records: [], sceneNames: [] };
  }

  // Split messages into background (older) + new (recent)
  const newMessages = qualifiedMessages.slice(-maxNewMessages);
  const bgEndIdx = qualifiedMessages.length - newMessages.length;
  const backgroundMessages =
    bgEndIdx > 0 ? qualifiedMessages.slice(Math.max(0, bgEndIdx - maxBgMessages), bgEndIdx) : [];

  logger?.debug?.(
    `${TAG} Extracting from ${newMessages.length} new messages (+ ${backgroundMessages.length} background) [${qualifiedMessages.length} qualified from ${messages.length} input]`
  );

  // Step 1: LLM extraction (scene segmentation + memory extraction)
  let scenes: SceneSegment[];
  try {
    scenes = await callLlmExtraction({
      newMessages,
      backgroundMessages,
      previousSceneName: options.previousSceneName,
      config,
      logger,
      model: options.model,
      llmRunner: options.llmRunner,
    });
    logger?.debug?.(`${TAG} LLM detected ${scenes.length} scene(s)`);
  } catch (err) {
    logger?.error(`${TAG} LLM extraction failed: ${err instanceof Error ? err.message : String(err)}`);
    return { success: false, extractedCount: 0, storedCount: 0, records: [], sceneNames: [] };
  }

  // Flatten all memories across scenes, applying the deterministic output
  // validators (unknown reference reset, droppable-content filter, in-batch
  // dedup, fabricated-date visibility). Failures degrade per-memory, never
  // blocking the whole extraction.
  const knownMessageIds = new Set<string>();
  for (const m of [...backgroundMessages, ...newMessages]) {
    if (m.id) knownMessageIds.add(m.id);
  }
  const sourceTexts = [...backgroundMessages, ...newMessages].flatMap((m) =>
    typeof m.timestamp === "number" && Number.isFinite(m.timestamp)
      ? [m.content, new Date(m.timestamp).toISOString()]
      : [m.content]
  );
  const allExtracted: ExtractedMemory[] = [];
  const seenContents = new Set<string>();
  const sceneNames: string[] = [];

  for (const scene of scenes) {
    sceneNames.push(scene.scene_name);
    for (const mem of scene.memories) {
      const memType = normalizeType(mem.type);
      if (!memType) {
        logger?.warn?.(`${TAG} Skipping memory with invalid type "${mem.type}"`);
        continue;
      }
      if (isDroppableContent(mem.content)) {
        logger?.warn?.(`${TAG} Validator: dropping non-atomic/empty content (${mem.content.length} chars)`);
        continue;
      }
      if (seenContents.has(mem.content)) {
        logger?.debug?.(`${TAG} Validator: dropping exact in-batch duplicate`);
        continue;
      }
      seenContents.add(mem.content);
      const rawIds = Array.isArray(mem.source_message_ids) ? mem.source_message_ids : [];
      const sourceIds = sanitizeSourceMessageIds(rawIds, knownMessageIds);
      if (sourceIds.length !== rawIds.length) {
        logger?.warn?.(`${TAG} Validator: reset ${rawIds.length - sourceIds.length} hallucinated source_message_ids`);
      }
      const fabricated = findFabricatedDates(mem.content, sourceTexts);
      if (fabricated.length > 0) {
        // Soft signal — kept, not dropped (the event is likely real even when
        // the precision is invented); visible via logger for prompt iteration.
        logger?.warn?.(
          `${TAG} Validator: fabricated-precision dates ${fabricated.join(", ")} in "${mem.content.slice(0, 60)}"`
        );
      }
      allExtracted.push({
        content: mem.content,
        type: memType,
        priority: typeof mem.priority === "number" ? mem.priority : 50,
        source_message_ids: sourceIds,
        metadata: mem.metadata ?? {},
        scene_name: scene.scene_name,
      });
    }
  }

  logger?.debug?.(`${TAG} Total extracted memories: ${allExtracted.length} across ${scenes.length} scene(s)`);

  if (allExtracted.length === 0) {
    return {
      success: true,
      extractedCount: 0,
      storedCount: 0,
      records: [],
      sceneNames,
      lastSceneName: sceneNames[sceneNames.length - 1],
    };
  }

  // Limit per session
  let extracted = allExtracted;
  if (extracted.length > maxMemoriesPerSession) {
    logger?.debug?.(`${TAG} Limiting from ${extracted.length} to ${maxMemoriesPerSession} memories per session`);
    extracted = extracted.slice(0, maxMemoriesPerSession);
  }

  // Assign temporary IDs to extracted memories (needed for batch dedup)
  const memoriesWithIds = extracted.map((m) => ({
    ...m,
    record_id: generateMemoryId(),
  }));

  // Step 2: Batch Conflict Detection + Write
  let storedRecords: MemoryRecord[];

  if (enableDedup) {
    try {
      const decisions = await batchDedup({
        memories: memoriesWithIds,
        config,
        logger,
        model: options.model,
        vectorStore: options.vectorStore,
        embeddingService: options.embeddingService,
        conflictRecallTopK: options.conflictRecallTopK,
        embeddingTimeoutMs: options.embeddingTimeoutMs,
        llmRunner: options.llmRunner,
      });

      storedRecords = await applyDecisions({
        memoriesWithIds,
        decisions,
        baseDir,
        sessionKey,
        sessionId,
        logger,
        vectorStore: options.vectorStore,
        embeddingService: options.embeddingService,
      });
    } catch (err) {
      logger?.warn?.(
        `${TAG} Batch dedup failed, storing all as new: ${err instanceof Error ? err.message : String(err)}`
      );
      storedRecords = await storeAllDirectly(
        memoriesWithIds,
        baseDir,
        sessionKey,
        sessionId,
        logger,
        options.vectorStore,
        options.embeddingService
      );
    }
  } else {
    storedRecords = await storeAllDirectly(
      memoriesWithIds,
      baseDir,
      sessionKey,
      sessionId,
      logger,
      options.vectorStore,
      options.embeddingService
    );
  }

  logger?.info(`${TAG} Extraction complete: extracted=${extracted.length}, stored=${storedRecords.length}`);

  // ── l1_extraction metric ──
  if (metricInstanceId && logger) {
    // Build type distribution of stored memories
    const memoriesByType: Record<string, number> = {};
    for (const r of storedRecords) {
      memoriesByType[r.type] = (memoriesByType[r.type] ?? 0) + 1;
    }
    report("l1_extraction", {
      sessionKey,
      inputMessageCount: messages.length,
      memoriesExtracted: extracted.length,
      memoriesStored: storedRecords.length,
      memoriesStoredContent: storedRecords.map((r) => ({
        content: r.content,
        type: r.type,
        scene: r.scene_name ?? null,
      })),
      memoriesByType,
      totalDurationMs: Date.now() - l1StartMs,
      success: true,
      error: null,
    });
  }

  return {
    success: true,
    extractedCount: extracted.length,
    storedCount: storedRecords.length,
    records: storedRecords,
    sceneNames,
    lastSceneName: sceneNames[sceneNames.length - 1],
  };
}

// ============================
// LLM call
// ============================

/**
 * Call LLM to extract scene-segmented memories from conversation messages.
 */
async function callLlmExtraction(params: {
  newMessages: ConversationMessage[];
  backgroundMessages: ConversationMessage[];
  previousSceneName?: string;
  config: unknown;
  logger?: Logger;
  model?: string;
  /** Host-neutral LLM runner — when provided, used instead of CleanContextRunner. */
  llmRunner?: LLMRunner;
}): Promise<SceneSegment[]> {
  const { newMessages, backgroundMessages, previousSceneName, config, logger, model, llmRunner } = params;

  const userPrompt = formatExtractionPrompt({
    newMessages,
    backgroundMessages,
    previousSceneName,
  });

  // [l1-debug] ENTRY — what are we about to ask the LLM to extract?
  logger?.debug?.(
    `${TAG} [l1-debug] ENTRY taskId=l1-extraction, newMsgs=${newMessages.length}, bgMsgs=${backgroundMessages.length}, userPromptLen=${userPrompt.length}, sysPromptLen=${EXTRACT_MEMORIES_SYSTEM_PROMPT.length}, model=${model ?? "(default)"}, previousSceneName=${previousSceneName ? JSON.stringify(previousSceneName) : "(none)"}, runnerKind=${llmRunner ? "llmRunner" : "CleanContextRunner"}`
  );

  let result: string;

  if (llmRunner) {
    // Use the host-neutral LLMRunner interface
    result = await llmRunner.run({
      prompt: userPrompt,
      systemPrompt: EXTRACT_MEMORIES_SYSTEM_PROMPT,
      taskId: "l1-extraction",
      timeoutMs: 180_000,
    });
  } else {
    // Fallback: create CleanContextRunner (OpenClaw path)
    const runner = new CleanContextRunner({
      config,
      modelRef: model,
      enableTools: false,
      logger,
    });

    result = await runner.run({
      prompt: userPrompt,
      systemPrompt: EXTRACT_MEMORIES_SYSTEM_PROMPT,
      taskId: "l1-extraction",
      timeoutMs: 180_000,
    });
  }

  return parseExtractionResult(result, logger);
}

/**
 * Parse the LLM's JSON response into SceneSegment array.
 * Expected format: [{scene_name, message_ids, memories: [...]}]
 */
function parseExtractionResult(raw: string, logger?: Logger): SceneSegment[] {
  try {
    // Strip markdown code block wrappers if present
    let cleaned = raw.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
    }

    // Try to extract JSON array
    const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
    if (!arrayMatch) {
      logger?.warn?.(`${TAG} No JSON array found in extraction response`);
      // [l1-debug] NO_JSON — dump the full raw so we can see what the LLM actually said
      const rawPreview = raw.slice(0, 2048);
      logger?.warn?.(
        `${TAG} [l1-debug] NO_JSON taskId=l1-extraction, rawLen=${raw.length}, cleanedLen=${cleaned.length}, rawFull=${JSON.stringify(rawPreview)}${raw.length > 2048 ? `…(+${raw.length - 2048})` : ""}`
      );
      return [];
    }

    // Sanitize control characters inside JSON string literals that LLM may produce
    const sanitized = sanitizeJsonForParse(arrayMatch[0]);
    const parsed = JSON.parse(sanitized) as unknown[];

    if (!Array.isArray(parsed)) {
      logger?.warn?.(`${TAG} Extraction response is not an array`);
      return [];
    }

    const scenes: SceneSegment[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const s = item as Record<string, unknown>;

      scenes.push({
        scene_name: typeof s.scene_name === "string" ? s.scene_name : "未知情境",
        message_ids: Array.isArray(s.message_ids) ? s.message_ids.map(String) : [],
        memories: Array.isArray(s.memories)
          ? (s.memories as Array<Record<string, unknown>>)
              .filter(
                (m) => m && typeof m === "object" && typeof m.content === "string" && (m.content as string).length > 0
              )
              .map((m) => ({
                content: String(m.content),
                type: String(m.type ?? "episodic"),
                priority: typeof m.priority === "number" ? m.priority : 50,
                source_message_ids: Array.isArray(m.source_message_ids) ? m.source_message_ids.map(String) : [],
                metadata: (m.metadata && typeof m.metadata === "object" ? m.metadata : {}) as Record<string, unknown>,
              }))
          : [],
      });
    }

    return scenes;
  } catch (err) {
    logger?.warn?.(`${TAG} Failed to parse extraction result: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

// ============================
// Write helpers
// ============================

/**
 * Apply batch dedup decisions — write memories according to their decisions.
 */
async function applyDecisions(params: {
  memoriesWithIds: Array<ExtractedMemory & { record_id: string }>;
  decisions: DedupDecision[];
  baseDir: string;
  sessionKey: string;
  sessionId?: string;
  logger?: Logger;
  vectorStore?: IMemoryStore;
  embeddingService?: EmbeddingService;
}): Promise<MemoryRecord[]> {
  const { memoriesWithIds, decisions, baseDir, sessionKey, sessionId, logger, vectorStore, embeddingService } = params;
  const storedRecords: MemoryRecord[] = [];

  // Build a map from record_id → decision
  const decisionMap = new Map<string, DedupDecision>();
  for (const d of decisions) {
    decisionMap.set(d.record_id, d);
  }

  for (const memoryWithId of memoriesWithIds) {
    const decision = decisionMap.get(memoryWithId.record_id) ?? {
      record_id: memoryWithId.record_id,
      action: "store" as const,
      target_ids: [],
    };

    try {
      const record = await writeMemory({
        memory: memoryWithId,
        decision,
        baseDir,
        sessionKey,
        sessionId,
        logger,
        vectorStore,
        embeddingService,
      });

      if (record) {
        storedRecords.push(record);
      }
    } catch (err) {
      logger?.warn?.(
        `${TAG} Write failed for memory "${memoryWithId.content.slice(0, 50)}...": ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return storedRecords;
}

/**
 * Store all memories directly (no dedup).
 */
async function storeAllDirectly(
  memoriesWithIds: Array<ExtractedMemory & { record_id: string }>,
  baseDir: string,
  sessionKey: string,
  sessionId: string | undefined,
  logger?: Logger,
  vectorStore?: IMemoryStore,
  embeddingService?: EmbeddingService
): Promise<MemoryRecord[]> {
  const storedRecords: MemoryRecord[] = [];

  for (const memoryWithId of memoriesWithIds) {
    try {
      const record = await writeMemory({
        memory: memoryWithId,
        decision: {
          record_id: memoryWithId.record_id,
          action: "store",
          target_ids: [],
        },
        baseDir,
        sessionKey,
        sessionId,
        logger,
        vectorStore,
        embeddingService,
      });
      if (record) {
        storedRecords.push(record);
      }
    } catch (err) {
      logger?.warn?.(
        `${TAG} Write failed for memory "${memoryWithId.content.slice(0, 50)}...": ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return storedRecords;
}

// ============================
// Output validators (deterministic, zero-LLM)
// ============================

/**
 * Drop source_message_ids that reference messages the LLM was never shown —
 * hallucinated references are removed while the VALID subset is kept (an
 * all-hallucinated array becomes []). (Output-validator analog of "facts may
 * only reference the frozen entity table"; enforced post-generation instead
 * of via retry.)
 */
export function sanitizeSourceMessageIds(ids: readonly string[], known: ReadonlySet<string>): string[] {
  const valid = ids.filter((id) => known.has(id));
  return valid.length === ids.length ? [...ids] : valid;
}

/** Content is droppable when empty after trim, >500 chars (non-atomic blob), or contains no letter/digit at all. */
export function isDroppableContent(content: string): boolean {
  const trimmed = content.trim();
  return trimmed.length === 0 || trimmed.length > 500 || !/[\p{L}\p{N}]/u.test(trimmed);
}

// (?!\d) instead of \b: an ISO timestamp's date prefix ("2026-08-17T10:40")
// has a word char (T) right after the day, so \b would never match it and
// timestamp-derived dates could never be recognized as source truth.
const FULL_DATE_RE = /\b(\d{4})-(\d{2})-(\d{2})(?!\d)/g;
const CN_FULL_DATE_RE = /(\d{4})年(\d{1,2})月(\d{1,2})日/g;

function collectDateTriples(text: string): Set<string> {
  const triples = new Set<string>();
  for (const m of text.matchAll(FULL_DATE_RE)) triples.add(`${m[1]}-${Number(m[2])}-${Number(m[3])}`);
  for (const m of text.matchAll(CN_FULL_DATE_RE)) triples.add(`${m[1]}-${Number(m[2])}-${Number(m[3])}`);
  return triples;
}

/** Full-precision date literals (both notations) present in a text. */
function collectDateLiterals(text: string): Array<{ literal: string; triple: string }> {
  const out: Array<{ literal: string; triple: string }> = [];
  for (const m of text.matchAll(FULL_DATE_RE)) {
    out.push({ literal: m[0], triple: `${m[1]}-${Number(m[2])}-${Number(m[3])}` });
  }
  for (const m of text.matchAll(CN_FULL_DATE_RE)) {
    out.push({ literal: m[0], triple: `${m[1]}-${Number(m[2])}-${Number(m[3])}` });
  }
  return out;
}

/**
 * Full-precision dates that appear in an extracted memory but nowhere in the
 * source messages — BOTH notations are scanned on BOTH sides (content
 * "2025年3月1日" matches source "2025-03-01" and vice versa). Message
 * timestamps count as source data: the prompt explicitly tells the model to
 * derive absolute dates from them, so a date derived from a timestamp is NOT
 * fabrication. Remaining suspects are logged by the caller; dropping is
 * deliberately NOT done here (recall safety first: a memory whose date is
 * wrong is still likely right about the event itself).
 */
export function findFabricatedDates(content: string, sourceTexts: readonly string[]): string[] {
  const sourceTriples = new Set<string>();
  for (const text of sourceTexts) {
    for (const triple of collectDateTriples(text)) sourceTriples.add(triple);
  }
  const fabricated: string[] = [];
  const seen = new Set<string>();
  for (const { literal, triple } of collectDateLiterals(content)) {
    if (!sourceTriples.has(triple) && !seen.has(literal)) {
      seen.add(literal);
      fabricated.push(literal);
    }
  }
  return fabricated;
}

// ============================
// Helpers
// ============================

const VALID_TYPES: MemoryType[] = ["persona", "episodic", "instruction"];

function normalizeType(raw: string): MemoryType | null {
  const lower = raw.toLowerCase().trim();
  if (VALID_TYPES.includes(lower as MemoryType)) {
    return lower as MemoryType;
  }
  // Handle legacy type names
  if (lower === "episode") return "episodic";
  if (lower === "instruct") return "instruction";
  if (lower === "preference") return "persona"; // fold preference into persona
  return null;
}
