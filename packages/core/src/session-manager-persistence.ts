// SessionManager layer — see session-manager-base.ts for the split rationale.
// Despite the name this layer bundles five storage-adjacent clusters:
// 1. Sessions index + message JSONL persistence (debounced, see pendingIndex)
// 2. Undo targets + file-history checkpoints and restore
// 3. Message builders (system/skill/assistant/tool) + snippet state
// 4. Process registry + timeout controls + audit log
// 5. Knowledge sync (codegraph/wiki/crg/diagnostics/memory) + task-tree glue
// If it outgrows the file limit again, split clusters 4/5 out first.
import ejs from "ejs";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { AuditLog } from "./sandbox/audit";
import {
  BACKGROUND_FAILURE_LOG_TAIL_CHARS,
  PLAN_MODE_ON_STATUS_MESSAGE,
  PLAN_MODE_OFF_STATUS_MESSAGE,
} from "./session-constants";
import { clearSessionState } from "./common/state";
import { clearSessionWorkingDir } from "./tools/bash-handler";
import { extractErrorDiagnostics } from "./session-mcp-hints";
import { getCodegraphController } from "./actions/codegraph-controller";
import { getCrgController } from "./actions/crg-controller";
import { getExtensionRoot, getPlanModePrompt } from "./prompt";
import { getUserConfigRoot, getProjectCode } from "./common/app-dirs";
import { getWikiController } from "./actions/wiki-controller";
import { GitFileHistory, type FileHistoryCheckpointResult } from "./common/file-history";
import { isUsageRecord } from "./session-usage";
import { killProcessTree } from "./common/process-tree";
import { normalizeAskPermissions } from "./common/permissions";
import { readTextFileWithMetadata } from "./common/file-utils";
import { SERENA_MCP_SERVER_NAME } from "./common/serena-mcp";
import { SessionManagerBase } from "./session-manager-base";
import { SessionManagerSkills } from "./session-manager-skills";
import { TaskTreeService } from "./tasks/task-tree-service";
import { type ProcessTimeoutControl, type ProcessTimeoutInfo } from "./tools/executor";
import type {
  SessionStatus,
  ModelUsage,
  SessionProcessEntry,
  BashTimeoutAdjustment,
  SessionEntry,
  SessionsIndex,
  MessageMeta,
  SessionMessage,
  UndoTarget,
  UserPromptContent,
  SkillInfo,
} from "./session-types";

export abstract class SessionManagerPersistence extends SessionManagerSkills {
  /** Task trajectory service for the desktop panel bridge (read-only usage). */
  getTaskTreeServiceForPanel(): TaskTreeService | null {
    return this.getTaskTreeService();
  }

  /**
   * Behavioral-memory boot context (activity-frames pipeline B, opt-in via
   * settings.behaviorContext): prepend the compact "how this user works"
   * block as a hidden system message on session creation. Fail-open.
   */
  protected appendBehaviorContext(sessionId: string): void {
    try {
      if ((this.getResolvedSettings() as { behaviorContext?: boolean }).behaviorContext !== true) return;
      const block = this.buildBehaviorContext?.();
      if (!block || !block.trim()) return;
      this.appendSessionMessage(
        sessionId,
        this.buildSystemMessage(
          sessionId,
          `<behavior-context>\nHow this user usually works (behavioral memory summary):\n${block}\n</behavior-context>`
        )
      );
    } catch {
      // Fail-open: no behavioral context rather than a broken session start.
    }
  }

  /** Hidden system message channel for actions (lineage recycle, hints). Fail-open. */
  protected appendSessionSystemMessage(sessionId: string, text: string): void {
    try {
      if (!text.trim()) return;
      this.appendSessionMessage(sessionId, this.buildSystemMessage(sessionId, text));
    } catch {
      // Fail-open: messaging issues never break the calling action.
    }
  }

  /** Bind/unbind a session entry's taskRef (task.* actions call this via context). */
  protected setSessionTaskRef(sessionId: string, ref: { treeId: string; branch: string; nodeId: string } | null): void {
    try {
      this.updateSessionEntry(sessionId, (entry) => ({
        ...entry,
        ...(ref ? { taskRef: ref } : { taskRef: undefined }),
        updateTime: new Date().toISOString(),
      }));
    } catch {
      // Binding is best-effort — never block the task action.
    }
  }

  /**
   * Decision-point recall hint (spec §3.2 steps 1-4, minimal loop): when
   * AskUserQuestion executes in a tree-bound session and historical forks
   * resemble the decision, append a hidden <task-recall-hints> message so the
   * agent can offer a memory-seeded fork alongside the question. The human
   * still decides — nothing forks automatically.
   */
  protected probeTaskRecallAtDecision(sessionId: string, toolFunction: unknown | null): void {
    try {
      const fn = toolFunction as { name?: string; arguments?: string | Record<string, unknown> } | null;
      if (!fn || fn.name !== "AskUserQuestion") return;
      if (this.taskRecallHinted.has(sessionId)) return;
      this.taskRecallHinted.add(sessionId);
      const ref = this.getSession(sessionId)?.taskRef;
      if (!ref) return;
      let raw: unknown = null;
      if (typeof fn.arguments === "string") {
        raw = (JSON.parse(fn.arguments) as Record<string, unknown>)["questions"];
      } else if (fn.arguments && typeof fn.arguments === "object") {
        raw = (fn.arguments as Record<string, unknown>)["questions"];
      }
      const query =
        typeof raw === "string"
          ? raw
          : Array.isArray(raw)
            ? raw
                .map((q) =>
                  typeof q === "object" && q !== null
                    ? Object.values(q as Record<string, unknown>)
                        .filter((v) => typeof v === "string")
                        .join(" ")
                    : ""
                )
                .join(" ")
            : "";
      if (!query.trim()) return;
      const svc = this.getTaskTreeService();
      const candidates = svc?.recallAtDecision(query, { excludeTreeId: ref.treeId }) ?? [];
      if (candidates.length === 0) return;
      const lines = candidates
        .map(
          (c) =>
            `- task "${c.treeTitle}" forked "${c.branch}" (${Math.round(c.similarity * 100)}% similar) — why: ${c.forkWhy}; outcome: ${c.outcome}`
        )
        .join("\n");
      this.appendSessionSystemMessage(
        sessionId,
        `<task-recall-hints>\nSimilar historical forks exist for the current decision:\n${lines}\n` +
          `If the user's choice matches one of these directions, you may OFFER task.fork with a memorySnapshot ` +
          `(proposal only — the user must approve).\n</task-recall-hints>`
      );
    } catch {
      // Fail-open: the hint never breaks the question flow.
    }
  }

  /**
   * Plan Mode → task-tree materialization (spec §十一, one-way read-only).
   * Extracts checklist lines from an UpdatePlan call's `plan` argument and
   * appends the ones not yet present as step nodes on the session's bound
   * branch. Best-effort and fail-open: materialization issues never affect
   * the plan tool's own result.
   */
  protected materializePlanToTaskTree(sessionId: string, toolFunction: unknown | null): void {
    try {
      const fn = toolFunction as { name?: string; arguments?: string | Record<string, unknown> } | null;
      if (!fn || fn.name !== "UpdatePlan") return;
      const ref = this.getSession(sessionId)?.taskRef;
      if (!ref) return;
      let plan: unknown = null;
      if (typeof fn.arguments === "string") {
        plan = (JSON.parse(fn.arguments) as Record<string, unknown>)["plan"];
      } else if (fn.arguments && typeof fn.arguments === "object") {
        plan = (fn.arguments as Record<string, unknown>)["plan"];
      }
      if (typeof plan !== "string" || !plan.trim()) return;
      const lines = plan
        .split("\n")
        .map((line) => line.match(/^\s*[-*]\s+\[( |x)\]\s*(.+?)\s*$/))
        .filter((m): m is RegExpMatchArray => m !== null)
        .map((m) => m[2]!)
        .filter((title) => title.length > 0)
        .slice(0, 20);
      if (lines.length === 0) return;
      const svc = this.getTaskTreeService();
      if (!svc) return;
      // Switch to the bound branch for this materialization (P1: a session's
      // plan belongs to its bound branch, wherever the tree was left).
      svc.switchBranch(ref.treeId, ref.branch);
      const tree = svc.getTree(ref.treeId);
      if (!tree) return;
      const existing = new Set(tree.nodes.map((n) => n.title));
      for (const title of lines) {
        if (!existing.has(title)) {
          existing.add(title); // duplicates within one plan collapse too
          svc.appendStep(ref.treeId, { title, why: "Plan step (materialized one-way from UpdatePlan)." });
        }
      }
    } catch {
      // Fail-open: materialization must never break the plan tool flow.
    }
  }

  /**
   * Branch-level resume (specs/task-tree P1): when a session bound to a tree
   * branch activates, restore that branch as the tree's active branch so
   * subsequent task.step calls land where the session left off. Fail-open.
   */
  protected restoreTaskBranchForSession(sessionId: string): void {
    try {
      const ref = this.getSession(sessionId)?.taskRef;
      if (!ref) return;
      const svc = this.getTaskTreeService();
      svc?.switchBranch(ref.treeId, ref.branch);
    } catch {
      // Fail-open: a broken tree must not block session resume.
    }
  }

  /** Lazy task-tree service (created once per manager; null-safe). */
  protected getTaskTreeService(): TaskTreeService | null {
    if (!this.taskTreeServiceInstance) {
      this.taskTreeServiceInstance = new TaskTreeService(this.projectRoot);
    }
    return this.taskTreeServiceInstance;
  }

  listSessions(): SessionEntry[] {
    const index = this.loadSessionsIndex();
    // Silent subagent sessions never surface in the list (T2) — they are
    // internal pipeline runs, not user conversations.
    return index.entries.filter((entry) => !entry.isSilentSubagent);
  }

  /**
   * One-time boot reconciliation (reliability audit R-batch): entries
   * persisted as `processing` describe an activation loop that died with the
   * previous app process — left as-is, such sessions stranded behind a
   * "running" badge with neither Stop nor Resume wired, the only escape being
   * to blind-type a new message. Remapping to `interrupted` routes recovery
   * through the existing resume path (pending tool calls synthesized via
   * resume-synthesis). Direct flush so the remap survives an immediate
   * crash-on-next-boot; called from the base-constructor hook exactly once,
   * while no activation loop can be running.
   */
  /** Stamped by sweepStaleRunsAfterRestart; synthesizePendingToolOutcomes
   *  discriminates on it to keep swept runs on the conservative synthesis. */
  static readonly SWEEP_FAIL_REASON = "application restarted mid-run";

  protected override sweepStaleRunsAfterRestart(): void {
    const index = this.loadSessionsIndex();
    let changed = false;
    for (const entry of index.entries) {
      if (entry.status === "processing") {
        entry.status = "interrupted";
        entry.failReason = SessionManagerPersistence.SWEEP_FAIL_REASON;
        entry.updateTime = new Date().toISOString();
        changed = true;
      }
    }
    if (changed) {
      this.pendingIndex = index;
      try {
        this.flushSessionsIndex();
      } catch {
        // Keep pendingIndex — the next save/flush retries this snapshot.
      }
    }
  }

  getSession(sessionId: string): SessionEntry | null {
    const index = this.loadSessionsIndex();
    return index.entries.find((entry) => entry.id === sessionId) ?? null;
  }

  /**
   * Delete a session by its ID.
   * Removes the session entry from the index and cleans up associated resources
   * such as message files, in-memory state caches, working directory state,
   * session controllers, and tracked process timeout controls.
   * Returns true if the session was found and deleted, false otherwise.
   */
  deleteSession(sessionId: string): boolean {
    this.frozenToolRoutes.delete(sessionId);
    this.taskRecallHinted.delete(sessionId);
    const index = this.loadSessionsIndex();
    const targetEntry = index.entries.find((entry) => entry.id === sessionId) ?? null;
    const nextEntries = index.entries.filter((entry) => entry.id !== sessionId);
    if (nextEntries.length === index.entries.length) {
      return false;
    }

    index.entries = nextEntries;
    // Session deletion is critical — flush immediately (not debounced).
    this.pendingIndex = index;
    this.flushSessionsIndex();
    this.cleanupSessionResources(sessionId, {
      removeMessages: true,
      processIds: this.getProcessIds(targetEntry?.processes ?? null),
    });
    return true;
  }

  /**
   * Rename a session by updating its summary (display title).
   * Returns true if the session was found and renamed, false otherwise.
   */
  renameSession(sessionId: string, summary: string): boolean {
    const trimmed = summary.trim();
    if (!trimmed) {
      return false;
    }
    const entry = this.getSession(sessionId);
    if (!entry) {
      return false;
    }
    this.updateSessionEntry(sessionId, (existing) => ({
      ...existing,
      summary: trimmed,
      updateTime: new Date().toISOString(),
    }));
    return true;
  }

  listSessionMessages(sessionId: string): SessionMessage[] {
    // Check cache first — avoids re-reading + re-parsing the entire JSONL file
    // on every call (this method is invoked multiple times per loop iteration).
    const cached = this.messageCache.get(sessionId);
    if (cached) {
      return cached;
    }

    const messagePath = this.getSessionMessagesPath(sessionId);
    if (!fs.existsSync(messagePath)) {
      return [];
    }

    const raw = fs.readFileSync(messagePath, "utf8");
    const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
    const messages: SessionMessage[] = [];
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as SessionMessage;
        messages.push(this.normalizeSessionMessage(parsed));
      } catch {
        // ignore malformed line
      }
    }
    this.messageCache.set(sessionId, messages);
    return messages;
  }

  listUndoTargets(sessionId: string): UndoTarget[] {
    return this.listSessionMessages(sessionId)
      .map((message, index) => ({ message, index }))
      .filter(({ message }) => this.isUndoTargetMessage(message))
      .map(({ message, index }) => ({
        message,
        index,
        canRestoreCode: Boolean(
          message.checkpointHash && this.canRestoreCheckpointHash(sessionId, message.checkpointHash)
        ),
      }));
  }

  restoreSessionConversation(sessionId: string, messageId: string): SessionMessage[] {
    const messages = this.listSessionMessages(sessionId);
    const targetIndex = messages.findIndex((message) => message.id === messageId);
    if (targetIndex === -1) {
      throw new Error("Selected message was not found in this session.");
    }

    const keptMessages = messages.slice(0, targetIndex);
    this.saveSessionMessages(sessionId, keptMessages);
    const now = new Date().toISOString();
    const latestAssistant = [...keptMessages].reverse().find((message) => message.role === "assistant");
    const latestAssistantParams = latestAssistant?.messageParams as
      | { tool_calls?: unknown[]; reasoning_content?: string }
      | null
      | undefined;

    this.updateSessionEntry(sessionId, (entry) => ({
      ...entry,
      assistantReply: latestAssistant?.content ?? null,
      assistantThinking:
        typeof latestAssistantParams?.reasoning_content === "string" ? latestAssistantParams.reasoning_content : null,
      assistantRefusal: null,
      toolCalls: null,
      status: "completed",
      failReason: null,
      processes: null,
      updateTime: now,
    }));
    return keptMessages;
  }

  restoreSessionCode(sessionId: string, messageId: string): void {
    const message = this.listSessionMessages(sessionId).find((item) => item.id === messageId);
    if (!message) {
      throw new Error("Selected message was not found in this session.");
    }
    if (!message.checkpointHash) {
      throw new Error("Selected message has no code checkpoint.");
    }
    this.restoreCheckpointHash(sessionId, message.checkpointHash);
  }

  protected normalizeSessionMessage(message: SessionMessage): SessionMessage {
    if (message.role !== "tool") {
      return message;
    }

    const nextMeta = message.meta ? { ...message.meta } : undefined;
    const normalizedParamsMd = this.buildToolParamsSnippet(nextMeta?.function ?? null);
    if (nextMeta && normalizedParamsMd) {
      nextMeta.paramsMd = normalizedParamsMd;
    }

    const normalizedResultMd = typeof message.content === "string" ? this.buildToolResultSnippet(message.content) : "";
    if (nextMeta && normalizedResultMd) {
      nextMeta.resultMd = normalizedResultMd;
    }

    return {
      ...message,
      visible: typeof message.content === "string" ? !this.isInvisibleExecution(message.content) : message.visible,
      meta: nextMeta,
    };
  }

  protected getProjectStorage(): {
    projectCode: string;
    projectDir: string;
    sessionsIndexPath: string;
  } {
    const projectCode = getProjectCode(this.projectRoot);
    const projectDir = path.join(getUserConfigRoot(), "projects", projectCode);
    const sessionsIndexPath = path.join(projectDir, "sessions-index.json");
    return { projectCode, projectDir, sessionsIndexPath };
  }

  protected getFileHistory(): GitFileHistory {
    return new GitFileHistory(this.projectRoot, this.getFileHistoryGitDir());
  }

  protected getFileHistoryGitDir(): string {
    const { projectDir } = this.getProjectStorage();
    return path.join(projectDir, "file-history", ".git");
  }

  protected ensureFileHistorySession(sessionId: string): string | undefined {
    return this.getFileHistory().ensureSession(sessionId);
  }

  protected getCurrentCheckpointHash(sessionId: string): string | undefined {
    return this.getFileHistory().getCurrentCheckpointHash(sessionId);
  }

  protected recordUserPromptCheckpoint(sessionId: string): FileHistoryCheckpointResult {
    return this.getFileHistory().recordTrackedFilesCheckpoint(sessionId, "User prompt checkpoint");
  }

  protected prepareFileMutationCheckpoint(sessionId: string, filePath: string): void {
    const fileHistory = this.getFileHistory();
    const previousHash = fileHistory.ensureSession(sessionId);
    if (!previousHash) {
      return;
    }
    this.updateLatestUserCheckpointHash(sessionId, undefined, previousHash);
    const nextHash = fileHistory.recordCheckpoint(sessionId, [filePath], "Pre-mutation checkpoint");
    if (nextHash && nextHash !== previousHash) {
      this.updateLatestUserCheckpointHash(sessionId, previousHash, nextHash);
    }
  }

  protected recordFileMutationCheckpoint(sessionId: string, filePath: string): void {
    const fileHistory = this.getFileHistory();
    fileHistory.ensureSession(sessionId);
    fileHistory.recordCheckpoint(sessionId, [filePath], "File mutation checkpoint");
    // Remember that this turn changed files so we can refresh the CodeGraph index
    // once the turn settles (see maybeSyncCodegraphIndex).
    this.codegraphDirtySessions.add(sessionId);
    // Same for the CRG graph (see maybeSyncCrgIndex).
    this.crgDirtySessions.add(sessionId);
    // Same for the wiki (see maybeSyncWikiIndex).
    this.wikiDirtySessions.add(sessionId);
    // Track mutated files for post-edit diagnostics (see maybeRunDiagnosticsCheck).
    let files = this.diagnosticsDirtyFiles.get(sessionId);
    if (!files) {
      files = new Set();
      this.diagnosticsDirtyFiles.set(sessionId, files);
    }
    files.add(filePath);
    // Stamp the mutation time so the knowledge dashboard can flag stale indices.
    this.knowledgeFreshness.lastMutation = new Date().toISOString();
  }

  /**
   * After a task turn ends, run an incremental CodeGraph index update if this turn
   * mutated files. Fire-and-forget; the SDK's sync() is concurrent-safe (FileLock).
   */
  protected maybeSyncCodegraphIndex(sessionId: string): void {
    if (!this.codegraphDirtySessions.delete(sessionId)) {
      return;
    }
    // Freshness is stamped when the sync SETTLES, not when it is fired —
    // an at-fire stamp keeps lying for the whole (possibly failed) run.
    void getCodegraphController()
      ?.sync(this.projectRoot)
      .then(() => {
        this.knowledgeFreshness.codegraphSync = new Date().toISOString();
      })
      .catch(() => {
        // Sync failures leave the previous stamp — the dashboard stays honest.
      });
  }

  /**
   * After a task turn ends, run an incremental wiki update if this turn
   * mutated files. Fire-and-forget; the wiki controller's update() is
   * safe to call frequently (OpenWiki --update is diff-based, skips when
   * nothing changed).
   */
  protected maybeSyncWikiIndex(sessionId: string): void {
    if (!this.wikiDirtySessions.delete(sessionId)) {
      return;
    }
    void getWikiController()
      ?.update(this.projectRoot)
      .then(() => {
        this.knowledgeFreshness.wikiSync = new Date().toISOString();
      })
      .catch(() => {
        // Update failures leave the previous stamp.
      });
  }

  /**
   * After a task turn ends, run an incremental CRG graph rebuild if this turn
   * mutated files. Fire-and-forget and gated on the project being CRG-enabled;
   * runCrgSync no-ops otherwise.
   */
  protected maybeSyncCrgIndex(sessionId: string): void {
    if (!this.crgDirtySessions.delete(sessionId)) {
      return;
    }
    void getCrgController()
      ?.sync(this.projectRoot)
      .then(() => {
        this.knowledgeFreshness.crgSync = new Date().toISOString();
      })
      .catch(() => {
        // Sync failures leave the previous stamp.
      });
  }

  /** Knowledge-source freshness timestamps for the desktop dashboard. */
  getKnowledgeFreshness(): {
    lastMutation?: string;
    codegraphSync?: string;
    wikiSync?: string;
    crgSync?: string;
  } {
    return { ...this.knowledgeFreshness };
  }

  /**
   * After a task turn ends, check diagnostics for mutated files via Serena's
   * `get_diagnostics_for_file` MCP tool. Fire-and-forget; if error-level
   * diagnostics are found, a system message is appended so the agent can
   * self-correct in the next turn. Silently skips when Serena is not connected.
   */
  protected maybeRunDiagnosticsCheck(sessionId: string): void {
    const dirtyFiles = this.diagnosticsDirtyFiles.get(sessionId);
    if (!dirtyFiles || dirtyFiles.size === 0) return;
    this.diagnosticsDirtyFiles.delete(sessionId);

    // Check if Serena MCP is connected.
    const serenaConnected = this.mcpManager.getStatus().some((s) => s.name === SERENA_MCP_SERVER_NAME && s.connected);
    if (!serenaConnected) return;

    // Fire-and-forget diagnostics check for each mutated file.
    void (async () => {
      for (const filePath of dirtyFiles) {
        try {
          const result = await this.executeMcpTool(SERENA_MCP_SERVER_NAME, "get_diagnostics_for_file", {
            file_path: filePath,
          });
          const diagnostics = extractErrorDiagnostics(result);
          if (diagnostics.length > 0) {
            const message = `⚠️ 编辑后诊断检查发现 ${diagnostics.length} 个错误（${filePath}）：\n${diagnostics.map((d) => `- ${d}`).join("\n")}`;
            const now = new Date().toISOString();
            this.appendSessionMessage(sessionId, {
              id: `diag-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              sessionId,
              role: "system",
              content: message,
              contentParams: null,
              messageParams: null,
              compacted: false,
              visible: true,
              createTime: now,
              updateTime: now,
            });
          }
        } catch {
          // Diagnostics check is best-effort; ignore failures.
        }
      }
    })();
  }

  /**
   * After a task turn ends, capture the conversation into the memory Gateway.
   * Fire-and-forget — memory capture must never break the session loop.
   * Extracts the user prompt text + last assistant response and sends them
   * to the TDAM Gateway for L0 storage and pipeline processing.
   */
  protected maybeCaptureMemory(sessionId: string): void {
    if (!this.memoryProvider?.isAvailable()) {
      return;
    }
    const messages = this.listSessionMessages(sessionId);
    if (messages.length < 2) {
      return;
    }
    // Find the last user message and the last assistant message, and capture
    // them as structured records so the provider can persist them to L0.
    // Passing the actual messages (not just flat text) is required: the TDAI
    // L0 recorder only writes entries found in `messages[]`, so without these
    // the pipeline captures nothing and recall stays permanently empty.
    let userText = "";
    let assistantText = "";
    let lastUser: SessionMessage | undefined;
    let lastAssistant: SessionMessage | undefined;
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (!msg) continue;
      const text = msg.content ?? "";
      if (msg.role === "user" && !userText) {
        userText = text;
        lastUser = msg;
      }
      if (msg.role === "assistant" && !assistantText) {
        assistantText = text;
        lastAssistant = msg;
      }
      if (userText && assistantText) break;
    }
    if (!userText || !assistantText) {
      return;
    }
    const captureMessages: Array<{
      role: "user" | "assistant" | "system";
      content: string;
      id?: string;
      timestamp?: number;
    }> = [];
    for (const msg of [lastUser, lastAssistant]) {
      if (!msg || !msg.content || !msg.content.trim()) continue;
      const ts = Date.parse(msg.createTime);
      captureMessages.push({
        role: msg.role as "user" | "assistant",
        content: msg.content,
        id: msg.id,
        timestamp: Number.isNaN(ts) ? Date.now() : ts,
      });
    }
    // Lineage closure (task-tree recycle channel): <task-lineage> and
    // <task-recall-hints> are hidden SYSTEM messages the plain user/assistant
    // pair above never includes. Phase 4 / T4.3: they now travel under their
    // REAL role — persisted to L0 for conversation search, but excluded from
    // L1 fact extraction (the memory pipeline filters non-dialogue roles).
    // Previously they were appended to assistantText / faked as assistant
    // messages, so the extractor read internal XML hints as things the
    // assistant had said.
    const lineageTail = messages
      .filter(
        (m) =>
          m.role === "system" &&
          !m.compacted &&
          typeof m.content === "string" &&
          (m.content.includes("<task-lineage>") || m.content.includes("<task-recall-hints>"))
      )
      .slice(-3);
    for (const msg of lineageTail) {
      const content = msg.content ?? "";
      if (!content.trim()) continue;
      const ts = Date.parse(msg.createTime);
      captureMessages.push({
        role: "system",
        content,
        id: msg.id,
        timestamp: Number.isNaN(ts) ? Date.now() : ts,
      });
    }
    void this.memoryProvider
      .capture({ userText, assistantText, sessionKey: sessionId, sessionId, messages: captureMessages })
      .catch(() => {
        // Swallow — best-effort memory capture.
      });
  }

  protected updateLatestUserCheckpointHash(
    sessionId: string,
    previousHash: string | undefined,
    nextHash: string
  ): void {
    const messages = this.listSessionMessages(sessionId);
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (!message || !this.isUndoTargetMessage(message)) {
        continue;
      }
      if (message.checkpointHash && message.checkpointHash !== previousHash) {
        return;
      }
      messages[index] = {
        ...message,
        checkpointHash: nextHash,
        updateTime: new Date().toISOString(),
      };
      this.saveSessionMessages(sessionId, messages);
      return;
    }
  }

  protected canRestoreCheckpointHash(sessionId: string, checkpointHash: string): boolean {
    return this.getFileHistory().canRestore(sessionId, checkpointHash);
  }

  protected restoreCheckpointHash(sessionId: string, checkpointHash: string): void {
    this.getFileHistory().restore(sessionId, checkpointHash);
  }

  protected isUndoTargetMessage(message: SessionMessage): boolean {
    return message.role === "user" && message.visible && !message.compacted;
  }

  protected ensureProjectDir(): string {
    const { projectDir } = this.getProjectStorage();
    fs.mkdirSync(projectDir, { recursive: true });
    return projectDir;
  }

  protected loadSessionsIndex(): SessionsIndex {
    // A debounced write may still be in flight — until it lands, the in-memory
    // copy is authoritative and the file on disk is stale. Reading the file here
    // would not only return pre-update state to getSession()/listSessions(), it
    // would make consecutive updateSessionEntry() calls inside one debounce
    // window each rebase on the *stale* disk copy and silently drop the earlier
    // update (usage accumulation runs ~17x per streaming turn, so that loss is
    // permanent, not just briefly visible).
    //
    // Returned as a shallow copy so callers keep the snapshot semantics they had
    // when every read hit the disk — they may replace `entries` (createSession,
    // deleteSession) without mutating the pending index behind our back.
    //
    // Deliberately NOT re-normalized: pending entries are already in memory form
    // (`processes` is a Map, produced by normalizeSessionEntry on the way in), and
    // normalizeSessionEntry expects the on-disk shape — its deserializeProcesses
    // uses Object.entries(), which yields [] for a Map and would silently drop
    // every tracked process.
    if (this.pendingIndex) {
      return {
        version: 1,
        entries: [...this.pendingIndex.entries],
        originalPath: this.pendingIndex.originalPath || this.projectRoot,
      };
    }

    const { sessionsIndexPath } = this.getProjectStorage();
    this.ensureProjectDir();

    if (!fs.existsSync(sessionsIndexPath)) {
      return { version: 1, entries: [], originalPath: this.projectRoot };
    }

    try {
      const raw = fs.readFileSync(sessionsIndexPath, "utf8");
      const parsed = JSON.parse(raw) as SessionsIndex;
      const entries = Array.isArray(parsed.entries)
        ? parsed.entries.map((entry) => this.normalizeSessionEntry(entry))
        : [];
      return {
        version: 1,
        entries,
        originalPath: parsed.originalPath || this.projectRoot,
      };
    } catch {
      return { version: 1, entries: [], originalPath: this.projectRoot };
    }
  }

  protected saveSessionsIndex(index: SessionsIndex): void {
    // A disposed manager lost its instance to reload()/window recreation; any
    // late update (e.g. the abort catch stamping "interrupted") must not
    // rebase the authoritative state onto a stale snapshot — the replacement
    // manager owns the index from here on.
    if (this.disposed) return;
    // Stash the latest index — the debounced write will pick it up.
    this.pendingIndex = index;
    if (this.indexWriteTimer) return;
    this.indexWriteTimer = setTimeout(() => {
      this.indexWriteTimer = null;
      try {
        this.flushSessionsIndex();
      } catch {
        // A failed background write must not crash the process. State is NOT
        // lost: flushSessionsIndex keeps pendingIndex on failure, so the next
        // save re-arms this timer and the next terminal op (create/delete/deny/
        // dispose) re-flushes — and rethrows — explicitly.
      }
    }, SessionManagerBase.INDEX_WRITE_DELAY);
  }

  /** Force-write the pending index immediately (clears any debounce timer). */
  protected flushSessionsIndex(): void {
    if (this.indexWriteTimer) {
      clearTimeout(this.indexWriteTimer);
      this.indexWriteTimer = null;
    }
    if (!this.pendingIndex || this.disposed) return;
    const index = this.pendingIndex;
    const { sessionsIndexPath } = this.getProjectStorage();
    this.ensureProjectDir();
    const normalized = {
      version: 1,
      entries: index.entries.map((entry) => ({
        ...entry,
        processes: this.serializeProcesses(entry.processes),
      })),
      originalPath: this.projectRoot,
    };
    // Compact JSON, no indent: pretty-printing doubled the payload of an
    // already heavy snapshot (up to MAX_SESSION_ENTRIES full last-turn
    // bodies/thinking/toolCalls), and this runs on the host main thread.
    // Thinking is additionally capped for persistence only — the full text
    // lives in the JSONL transcript and no consumer reads it back from the
    // index (renderer never touches the field; plan extraction uses the
    // untruncated assistantReply, which stays intact).
    for (const entry of normalized.entries) {
      if (entry.assistantThinking && entry.assistantThinking.length > SessionManagerBase.INDEX_THINKING_SNIPPET_CHARS) {
        entry.assistantThinking = `${entry.assistantThinking.slice(0, SessionManagerBase.INDEX_THINKING_SNIPPET_CHARS)}…`;
      }
    }
    const content = JSON.stringify(normalized);
    const tmpPath = `${sessionsIndexPath}.tmp.${process.pid}.${crypto.randomUUID()}`;
    try {
      // Write beside the target and rename only after the complete payload is
      // present. This preserves the last valid index if the process or disk
      // fails halfway through a write.
      fs.writeFileSync(tmpPath, content, { encoding: "utf8", mode: 0o600 });
      if (process.platform !== "win32") {
        fs.chmodSync(tmpPath, 0o600);
      }
      fs.renameSync(tmpPath, sessionsIndexPath);
      // Durable only now: clear the in-memory snapshot AFTER the rename lands.
      // Clearing earlier meant a write failure (disk full, AV/indexer locking
      // the rename on Windows) discarded the authoritative state — subsequent
      // reads fell back to the stale on-disk file and rebased future updates
      // on it, permanently losing everything accumulated since the last good
      // write (usage accounting, permission_denied — the exact corruption the
      // loadSessionsIndex comment warns about).
      this.pendingIndex = null;
    } catch (error) {
      try {
        fs.rmSync(tmpPath, { force: true });
      } catch {
        // Preserve the original persistence error.
      }
      // Keep pendingIndex: it is still the source of truth, and a later
      // flush retries this exact snapshot instead of the stale disk copy.
      throw error;
    }
  }

  protected getSessionMessagesPath(sessionId: string): string {
    const { projectDir } = this.getProjectStorage();
    return path.join(projectDir, `${sessionId}.jsonl`);
  }

  /** P1 audit bus: one hash-chained JSONL log per session (fail-open writer). */
  protected getSessionAuditLog(sessionId: string): AuditLog {
    let log = this.sessionAuditLogs.get(sessionId);
    if (!log) {
      const { projectDir } = this.getProjectStorage();
      log = AuditLog.open(path.join(projectDir, "audit", `${sessionId}.jsonl`), sessionId);
      this.sessionAuditLogs.set(sessionId, log);
    }
    return log;
  }

  protected removeSessionMessages(sessionIds: string[]): void {
    for (const sessionId of sessionIds) {
      this.sessionAuditLogs.delete(sessionId);
      this.bashSandboxBySession.delete(sessionId);
      this.bashBackendBySession.delete(sessionId);
      const { projectDir } = this.getProjectStorage();
      const auditPath = path.join(projectDir, "audit", `${sessionId}.jsonl`);
      try {
        if (fs.existsSync(auditPath)) {
          fs.unlinkSync(auditPath);
        }
      } catch {
        // ignore delete failures
      }
      const messagePath = this.getSessionMessagesPath(sessionId);
      try {
        if (fs.existsSync(messagePath)) {
          fs.unlinkSync(messagePath);
        }
      } catch {
        // ignore delete failures
      }
    }
  }

  protected cleanupSessionResources(
    sessionId: string,
    options: { removeMessages: boolean; processIds?: number[] }
  ): void {
    const processIds = options.processIds ?? [];
    for (const pid of processIds) {
      const processControlKey = this.getProcessControlKey(sessionId, pid);
      if (!this.processTimeoutControls.has(processControlKey) && !this.liveProcessKeys.has(processControlKey)) {
        continue;
      }

      this.killTrackedProcess(processControlKey, pid);
    }

    clearSessionState(sessionId);
    clearSessionWorkingDir(sessionId);
    const controller = this.sessionControllers.get(sessionId);
    if (controller && !controller.signal.aborted) {
      controller.abort();
    }
    this.sessionControllers.delete(sessionId);
    if (options.removeMessages) {
      this.removeSessionMessages([sessionId]);
    }
  }

  protected appendSessionMessage(sessionId: string, message: SessionMessage): void {
    this.ensureProjectDir();
    const messagePath = this.getSessionMessagesPath(sessionId);
    // Restrictive perms (deep review 2026-08-15, C2): transcripts carry user
    // code and tool output — same 0600 treatment settings.json already gets.
    fs.appendFileSync(messagePath, `${JSON.stringify(message)}\n`, { encoding: "utf8", mode: 0o600 });
    // Mirror the append into the live cache instead of invalidating it:
    // deleting here made the very next listSessionMessages call (invoked at
    // the top of every activation-loop iteration) re-read + re-parse the
    // ENTIRE JSONL from disk, O(session bytes) per streamed tool round for
    // zero correctness benefit — disk stays the source of truth either way.
    const cached = this.messageCache.get(sessionId);
    if (cached) {
      cached.push(this.normalizeSessionMessage(message));
    }
  }

  protected saveSessionMessages(sessionId: string, messages: SessionMessage[]): void {
    this.ensureProjectDir();
    const messagePath = this.getSessionMessagesPath(sessionId);
    const payload = messages.map((message) => JSON.stringify(message)).join("\n");
    // Temp-then-rename (same pattern as flushSessionsIndex): the full
    // rewrites of a transcript are compaction, undo/restore, and the
    // checkpoint-hash stamp on write/edit. Opening with
    // 'w' truncated FIRST, so a crash or ENOSPC mid-write permanently deleted
    // the tail of the conversation — exactly the messages that had NOT been
    // compacted away.
    const tmpPath = `${messagePath}.tmp.${process.pid}.${crypto.randomUUID()}`;
    try {
      fs.writeFileSync(tmpPath, payload ? `${payload}\n` : "", { encoding: "utf8", mode: 0o600 });
      if (process.platform !== "win32") {
        fs.chmodSync(tmpPath, 0o600);
      }
      fs.renameSync(tmpPath, messagePath);
    } catch (error) {
      try {
        fs.rmSync(tmpPath, { force: true });
      } catch {
        // Preserve the original persistence error.
      }
      throw error;
    }
    // Update cache with the saved array (avoids a disk re-read).
    this.messageCache.set(sessionId, messages);
  }

  protected updateSessionEntry(sessionId: string, updater: (entry: SessionEntry) => SessionEntry): SessionEntry | null {
    const index = this.loadSessionsIndex();
    const entryIndex = index.entries.findIndex((entry) => entry.id === sessionId);
    if (entryIndex === -1) {
      return null;
    }

    const updated = updater({ ...index.entries[entryIndex] });
    index.entries[entryIndex] = updated;
    this.saveSessionsIndex(index);
    this.onSessionEntryUpdated?.(updated);
    return updated;
  }

  protected buildUserMessage(sessionId: string, prompt: UserPromptContent): SessionMessage {
    const now = new Date().toISOString();
    const imageParams =
      prompt.imageUrls
        ?.filter((url) => Boolean(url))
        .map((url) => ({
          type: "image_url",
          image_url: { url },
        })) ?? [];

    return {
      id: crypto.randomUUID(),
      sessionId,
      role: "user",
      content: prompt.text ?? "",
      contentParams: imageParams.length > 0 ? imageParams : null,
      messageParams: null,
      compacted: false,
      visible: true,
      createTime: now,
      updateTime: now,
      meta: { userPrompt: this.cloneUserPromptForMeta(prompt) },
      checkpointHash: this.getCurrentCheckpointHash(sessionId),
    };
  }

  protected appendPlanModeTransitionMessages(sessionId: string, wasEnabled: boolean, isEnabled: boolean): void {
    if (wasEnabled === isEnabled) {
      return;
    }

    if (isEnabled) {
      const prompt = getPlanModePrompt();
      if (prompt) {
        this.appendSessionMessage(sessionId, this.buildSystemMessage(sessionId, prompt));
      }
      this.appendSessionMessage(sessionId, this.buildSystemMessage(sessionId, PLAN_MODE_ON_STATUS_MESSAGE()));
      return;
    }

    this.appendSessionMessage(sessionId, this.buildSystemMessage(sessionId, PLAN_MODE_OFF_STATUS_MESSAGE()));
  }

  protected renderInitCommandPrompt(): string {
    const templatePath = path.join(getExtensionRoot(), "templates", "prompts", "init_command.md.ejs");
    const template = fs.readFileSync(templatePath, "utf8");
    return ejs.render(template, {
      agentsMdFile: this.getEffectiveProjectAgentsMdFile(),
    });
  }

  protected getEffectiveProjectAgentsMdFile(): string | null {
    return this.loadProjectAgentInstructions()?.displayPath ?? null;
  }

  protected loadProjectAgentInstructions(): { content: string; displayPath: string } | null {
    const candidatePaths = [
      {
        absolutePath: path.join(this.projectRoot, ".deeporca", "AGENTS.md"),
        displayPath: "./.deeporca/AGENTS.md",
      },
      {
        absolutePath: path.join(this.projectRoot, ".deepcode", "AGENTS.md"),
        displayPath: "./.deepcode/AGENTS.md",
      },
      {
        absolutePath: path.join(this.projectRoot, "AGENTS.md"),
        displayPath: "./AGENTS.md",
      },
    ];

    for (const candidatePath of candidatePaths) {
      const content = this.readNonEmptyFile(candidatePath.absolutePath);
      if (content) {
        return {
          content,
          displayPath: candidatePath.displayPath,
        };
      }
    }

    return null;
  }

  protected readNonEmptyFile(filePath: string): string | null {
    try {
      if (!fs.existsSync(filePath)) {
        return null;
      }
      const content = fs.readFileSync(filePath, "utf8").trim();
      return content || null;
    } catch {
      return null;
    }
  }

  protected loadAgentInstructions(): string | null {
    const projectInstructions = this.loadProjectAgentInstructions();
    if (projectInstructions) {
      return projectInstructions.content;
    }

    return (
      this.readNonEmptyFile(path.join(os.homedir(), ".deeporca", "AGENTS.md")) ??
      this.readNonEmptyFile(path.join(os.homedir(), ".deepcode", "AGENTS.md"))
    );
  }

  protected buildSystemMessage(
    sessionId: string,
    content: string,
    contentParams: unknown | null = null,
    visible = false,
    meta?: MessageMeta
  ): SessionMessage {
    const now = new Date().toISOString();
    return {
      id: crypto.randomUUID(),
      sessionId,
      role: "system",
      content,
      contentParams,
      messageParams: null,
      compacted: false,
      visible,
      createTime: now,
      updateTime: now,
      meta,
    };
  }

  protected buildSkillMessage(sessionId: string, content: string, skill: SkillInfo): SessionMessage {
    const now = new Date().toISOString();
    return {
      id: crypto.randomUUID(),
      sessionId,
      role: "system",
      content,
      contentParams: null,
      messageParams: null,
      compacted: false,
      visible: true,
      createTime: now,
      updateTime: now,
      meta: { skill: { ...skill, isLoaded: true } },
    };
  }

  protected buildAssistantMessage(
    sessionId: string,
    content: string | null,
    toolCalls: unknown[] | null,
    reasoningContent?: string | null,
    reasoningField: string = "reasoning_content"
  ): SessionMessage {
    const now = new Date().toISOString();
    const hasReasoningContent = reasoningContent != null;
    const messageParams: Record<string, unknown> | null = toolCalls || hasReasoningContent ? {} : null;
    if (toolCalls) {
      messageParams!.tool_calls = toolCalls;
    }
    if (hasReasoningContent) {
      messageParams![reasoningField] = reasoningContent;
    }
    return {
      id: crypto.randomUUID(),
      sessionId,
      role: "assistant",
      content,
      contentParams: null,
      messageParams,
      compacted: false,
      visible: (content || reasoningContent || "").trim() ? true : false,
      createTime: now,
      updateTime: now,
      meta: toolCalls ? { asThinking: true } : undefined,
    };
  }

  protected generateToolCallId(): string {
    return crypto.randomBytes(16).toString("hex");
  }

  protected normalizeLlmToolCalls(rawToolCalls: unknown[] | null | undefined): unknown[] | null {
    if (!Array.isArray(rawToolCalls) || rawToolCalls.length === 0) {
      return null;
    }

    return rawToolCalls.map((toolCall) => {
      if (!toolCall || typeof toolCall !== "object" || Array.isArray(toolCall)) {
        return toolCall;
      }

      const record = toolCall as Record<string, unknown>;
      const id = typeof record.id === "string" ? record.id.trim() : "";
      if (id) {
        return toolCall;
      }

      return {
        ...record,
        id: this.generateToolCallId(),
      };
    });
  }

  protected buildToolMessage(
    sessionId: string,
    toolCallId: string,
    content: string,
    toolFunction: unknown | null
  ): SessionMessage {
    const now = new Date().toISOString();
    const paramsMd = this.buildToolParamsSnippet(toolFunction);
    const resultMd = this.buildToolResultSnippet(content);
    const isInvisibleExecution = this.isInvisibleExecution(content);
    return {
      id: crypto.randomUUID(),
      sessionId,
      role: "tool",
      content,
      contentParams: null,
      messageParams: { tool_call_id: toolCallId },
      compacted: false,
      visible: !isInvisibleExecution,
      createTime: now,
      updateTime: now,
      meta: {
        function: toolFunction ?? undefined,
        paramsMd,
        resultMd,
      },
    };
  }

  protected addSessionProcess(sessionId: string, processId: string | number, command: string): void {
    const now = new Date().toISOString();
    this.liveProcessKeys.add(this.getProcessControlKey(sessionId, processId));
    this.updateSessionEntry(sessionId, (entry) => {
      const processes = new Map(entry.processes ?? []);
      processes.set(String(processId), { startTime: now, command });
      return {
        ...entry,
        processes,
        updateTime: now,
      };
    });
  }

  protected addBackgroundProcessCompletionMessage(
    sessionId: string,
    completion: {
      command: string;
      outputPath: string;
      ok: boolean;
      exitCode: number | null;
      signal: string | null;
      error?: string;
      completedAtMs: number;
      startedAtMs: number;
    }
  ): void {
    const status = completion.ok ? "completed" : "failed";
    const exitText =
      completion.exitCode !== null
        ? `exit code ${completion.exitCode}`
        : completion.signal
          ? `signal ${completion.signal}`
          : completion.error || "unknown status";
    const durationMs = Math.max(0, completion.completedAtMs - completion.startedAtMs);
    const baseContent =
      `Background command "${completion.command}" ${status} with ${exitText} ` +
      `after ${this.formatBackgroundDuration(durationMs)}. Output: ${completion.outputPath}`;
    const logTail = completion.ok ? null : this.buildBackgroundFailureLogTailSlice(completion.outputPath);
    const content = logTail ? `${baseContent}\n${logTail}` : baseContent;
    this.addSessionSystemMessage(sessionId, content, true);
  }

  protected buildBackgroundFailureLogTailSlice(outputPath: string): string | null {
    const tail = this.readTextFileTail(outputPath, BACKGROUND_FAILURE_LOG_TAIL_CHARS);
    if (!tail || !tail.content) {
      return null;
    }
    const prefix = tail.truncated ? `(${tail.totalBytes} bytes)...\n` : "";
    return [
      `<background_task_failure_log path="${outputPath}">`,
      `${prefix}${tail.content}`,
      "</background_task_failure_log>",
    ].join("\n");
  }

  protected readTextFileTail(
    filePath: string,
    maxChars: number
  ): { content: string; totalBytes: number; truncated: boolean } | null {
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile() || stat.size <= 0) {
        return null;
      }
      const content = readTextFileWithMetadata(filePath).content;
      return {
        content: content.slice(-maxChars).trimEnd(),
        totalBytes: stat.size,
        truncated: content.length > maxChars,
      };
    } catch {
      return null;
    }
  }

  protected formatBackgroundDuration(durationMs: number): string {
    if (durationMs < 1000) {
      return `${durationMs}ms`;
    }
    const seconds = Math.round(durationMs / 1000);
    if (seconds < 60) {
      return `${seconds}s`;
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  }

  protected removeSessionProcess(sessionId: string, processId: string | number): void {
    const now = new Date().toISOString();
    const processControlKey = this.getProcessControlKey(sessionId, processId);
    this.processTimeoutControls.delete(processControlKey);
    this.liveProcessKeys.delete(processControlKey);
    this.updateSessionEntry(sessionId, (entry) => {
      const processes = new Map(entry.processes ?? []);
      processes.delete(String(processId));
      return {
        ...entry,
        processes: processes.size > 0 ? processes : null,
        updateTime: now,
      };
    });
  }

  protected setSessionProcessTimeoutControl(
    sessionId: string,
    processId: string | number,
    control: ProcessTimeoutControl | null
  ): void {
    const key = this.getProcessControlKey(sessionId, processId);
    if (!control) {
      this.processTimeoutControls.delete(key);
      return;
    }

    this.processTimeoutControls.set(key, control);
    this.updateSessionProcessTimeout(sessionId, processId, control.getInfo());
  }

  protected updateSessionProcessTimeout(sessionId: string, processId: string | number, info: ProcessTimeoutInfo): void {
    const now = new Date().toISOString();
    this.updateSessionEntry(sessionId, (entry) => {
      const processes = new Map(entry.processes ?? []);
      const pid = String(processId);
      const processInfo = processes.get(pid);
      if (!processInfo) {
        return entry;
      }
      processes.set(pid, {
        ...processInfo,
        timeoutMs: info.timeoutMs,
        deadlineAt: new Date(info.deadlineAtMs).toISOString(),
        timedOut: info.timedOut,
      });
      return {
        ...entry,
        processes,
        updateTime: now,
      };
    });
  }

  protected buildBashTimeoutAdjustment(processId: string, info: ProcessTimeoutInfo): BashTimeoutAdjustment {
    return {
      processId,
      timeoutMs: info.timeoutMs,
      deadlineAt: new Date(info.deadlineAtMs).toISOString(),
      timedOut: info.timedOut,
    };
  }

  protected getProcessControlKey(sessionId: string, processId: string | number): string {
    return `${sessionId}:${String(processId)}`;
  }

  protected killLiveProcesses(): void {
    for (const processControlKey of Array.from(this.liveProcessKeys)) {
      const processId = this.getProcessIdFromControlKey(processControlKey);
      if (processId === null) {
        this.liveProcessKeys.delete(processControlKey);
        continue;
      }
      this.killTrackedProcess(processControlKey, processId);
    }
  }

  protected killTrackedProcess(processControlKey: string, processId: number): void {
    const killedGroup = killProcessTree(processId, "SIGKILL");
    if (!killedGroup) {
      try {
        process.kill(processId, "SIGKILL");
      } catch {
        // Ignore process-kill failures during cleanup.
      }
    }
    this.processTimeoutControls.delete(processControlKey);
    this.liveProcessKeys.delete(processControlKey);
  }

  protected getProcessIdFromControlKey(processControlKey: string): number | null {
    const separatorIndex = processControlKey.lastIndexOf(":");
    const rawProcessId = separatorIndex >= 0 ? processControlKey.slice(separatorIndex + 1) : processControlKey;
    const processId = Number(rawProcessId);
    return Number.isInteger(processId) && processId > 0 ? processId : null;
  }

  protected getProcessIds(processes: Map<string, SessionProcessEntry> | null): number[] {
    if (!processes) {
      return [];
    }
    const ids: number[] = [];
    for (const pid of processes.keys()) {
      const parsed = Number(pid);
      if (Number.isInteger(parsed) && parsed > 0) {
        ids.push(parsed);
      }
    }
    return ids;
  }

  protected normalizeSessionEntry(entry: unknown): SessionEntry {
    const value = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
    return {
      id: typeof value.id === "string" ? value.id : crypto.randomUUID(),
      summary: typeof value.summary === "string" ? value.summary : null,
      assistantReply: typeof value.assistantReply === "string" ? value.assistantReply : null,
      assistantThinking: typeof value.assistantThinking === "string" ? value.assistantThinking : null,
      assistantRefusal: typeof value.assistantRefusal === "string" ? value.assistantRefusal : null,
      toolCalls: Array.isArray(value.toolCalls) ? value.toolCalls : null,
      status: this.normalizeSessionStatus(value.status),
      failReason: typeof value.failReason === "string" ? value.failReason : null,
      usage: (value.usage as ModelUsage) ?? null,
      usagePerModel: this.normalizeUsagePerModel(value),
      activeTokens: typeof value.activeTokens === "number" ? value.activeTokens : 0,
      createTime: typeof value.createTime === "string" ? value.createTime : new Date().toISOString(),
      updateTime: typeof value.updateTime === "string" ? value.updateTime : new Date().toISOString(),
      processes: this.deserializeProcesses(value.processes),
      askPermissions: normalizeAskPermissions(value.askPermissions),
      planMode: value.planMode === true,
      taskRef: this.normalizeTaskRef(value.taskRef),
    };
  }

  protected normalizeTaskRef(value: unknown): { treeId: string; branch: string; nodeId: string } | undefined {
    if (!value || typeof value !== "object") return undefined;
    const ref = value as Record<string, unknown>;
    if (
      typeof ref.treeId === "string" &&
      typeof ref.branch === "string" &&
      typeof ref.nodeId === "string" &&
      /^[0-9a-f-]{36}$/i.test(ref.treeId)
    ) {
      return { treeId: ref.treeId, branch: ref.branch, nodeId: ref.nodeId };
    }
    return undefined;
  }

  protected normalizeSessionStatus(status: unknown): SessionStatus {
    if (
      status === "failed" ||
      status === "pending" ||
      status === "processing" ||
      status === "waiting_for_user" ||
      status === "completed" ||
      status === "interrupted" ||
      status === "ask_permission" ||
      status === "permission_denied"
    ) {
      return status;
    }
    return "pending";
  }

  protected normalizeUsagePerModel(entry: Record<string, unknown>): Record<string, ModelUsage> | null {
    if (!Object.prototype.hasOwnProperty.call(entry, "usagePerModel")) {
      return null;
    }
    if (!isUsageRecord(entry.usagePerModel)) {
      return null;
    }
    const usagePerModel: Record<string, ModelUsage> = {};
    for (const [model, usage] of Object.entries(entry.usagePerModel)) {
      if (!model || !isUsageRecord(usage)) {
        continue;
      }
      usagePerModel[model] = usage as ModelUsage;
    }
    return usagePerModel;
  }

  protected deserializeProcesses(value: unknown): Map<string, SessionProcessEntry> | null {
    if (!value || typeof value !== "object") {
      return null;
    }
    const processes = new Map<string, SessionProcessEntry>();
    for (const [pid, entry] of Object.entries(value as Record<string, unknown>)) {
      if (!pid) {
        continue;
      }
      if (typeof entry === "string") {
        // Backward compatibility for old format where just stored start time
        processes.set(pid, { startTime: entry, command: "Running process..." });
      } else if (typeof entry === "object" && entry !== null) {
        const obj = entry as {
          startTime?: unknown;
          command?: unknown;
          timeoutMs?: unknown;
          deadlineAt?: unknown;
          timedOut?: unknown;
        };
        const startTime = typeof obj.startTime === "string" ? obj.startTime : new Date().toISOString();
        const command = typeof obj.command === "string" ? obj.command : "Running process...";
        processes.set(pid, {
          startTime,
          command,
          timeoutMs: typeof obj.timeoutMs === "number" ? obj.timeoutMs : undefined,
          deadlineAt: typeof obj.deadlineAt === "string" ? obj.deadlineAt : undefined,
          timedOut: typeof obj.timedOut === "boolean" ? obj.timedOut : undefined,
        });
      }
    }
    return processes.size > 0 ? processes : null;
  }

  protected serializeProcesses(
    processes: Map<string, SessionProcessEntry> | null
  ): Record<string, SessionProcessEntry> | null {
    if (!processes || processes.size === 0) {
      return null;
    }
    const serialized: Record<string, SessionProcessEntry> = {};
    for (const [pid, entry] of processes.entries()) {
      serialized[pid] = entry;
    }
    return serialized;
  }
}
