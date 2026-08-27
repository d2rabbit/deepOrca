// SessionManager layer — see session-manager-base.ts for the split rationale.
import * as crypto from "crypto";
import * as path from "path";
import {
  buildPendingToolResumeSystemNote,
  buildPendingToolSynthesisContent,
  PENDING_TOOL_RESUME_MODE_DEFAULT,
  shouldSynthesizePendingToolCalls,
} from "./common/resume-synthesis";
import {
  estimateConversationTokens,
  STAGE_A_SKIP_HEADROOM,
  truncateToolResultForCompaction,
  validateCompactionPairing,
} from "./common/compaction";
import { accumulateUsage, accumulateUsagePerModel, getLastPromptTokens } from "./session-usage";
import { buildThinkingRequestOptions } from "./common/openai-thinking";
import { getSnippet, rebuildSessionStateFromHistory } from "./common/state";
import { describeLlmError, classifyLlmError } from "./common/llm-error";
import { detectBashSandboxBackend } from "./sandbox/backend/detect";
import { formatSessionPrompt } from "./common/session-prompts";
import {
  getCompactPrompt,
  getDefaultSkillPrompt,
  getMemoryPrompt,
  getStableRuntimeContext,
  getSystemPrompt,
  getTools,
} from "./prompt";
import { getCompactPromptTokenThreshold, resolveModelSpec } from "./common/model-capabilities";
import { getProjectSettingsPath, getUserSettingsPath } from "./settings";
import { grantOutsideRootsFlags, resolveGateRoot, safeRealPath, type PathGrant } from "./common/path-boundary";
import { killProcessTree } from "./common/process-tree";
import { launchNotifyScript } from "./common/notify";
import { MAX_SESSION_ENTRIES, COMPACTION_TEMPERATURE } from "./session-constants";
import { resolveScopeVerdict } from "./sandbox/policy";
import { SessionManagerPersistence } from "./session-manager-persistence";
import {
  type MessageToolPermission,
  type PermissionToolCall,
  type UserToolPermission,
  appendProjectAllowedPaths,
  appendProjectPermissionAllows,
  buildPermissionToolExecution,
  applyQuarantinePermissionClamp,
  describeToolPermissionRequest,
  hasUserPermissionReplies,
  parseToolCallForPermissions,
} from "./common/permissions";
import type { ToolCallExecution, ToolExecutionHooks } from "./tools/executor";
import type { BashSandboxSpawner } from "./common/tool-types";
import type { PermissionSettings } from "./settings";
import type { SandboxBackend, SandboxProbeResult } from "./sandbox/backend/interface";
import type {
  BashTimeoutAdjustment,
  SessionEntry,
  MessageMeta,
  SessionMessage,
  UserPromptContent,
} from "./session-types";

export abstract class SessionManagerLifecycle extends SessionManagerPersistence {
  getActiveSessionId(): string | null {
    return this.activeSessionId;
  }

  setActiveSessionId(sessionId: string | null): void {
    this.activeSessionId = sessionId;
  }

  addSessionSystemMessage(sessionId: string, content: string, visible?: boolean, meta?: MessageMeta): void {
    const message = this.buildSystemMessage(sessionId, content, null, visible, meta);
    if (sessionId) this.appendSessionMessage(sessionId, message);
    this.onAssistantMessage(message, false);
  }

  async handleUserPrompt(userPrompt: UserPromptContent): Promise<void> {
    const controller = new AbortController();
    this.activePromptController = controller;

    try {
      if (!this.activeSessionId || !this.getSession(this.activeSessionId)) {
        await this.createSession(userPrompt, controller);
      } else {
        await this.replySession(this.activeSessionId, userPrompt, controller);
      }
    } catch (error) {
      if (!this.isAbortLikeError(error) && !controller.signal.aborted) {
        throw error;
      }
    } finally {
      if (this.activePromptController === controller) {
        this.activePromptController = null;
      }
    }
  }

  async createSession(userPrompt: UserPromptContent, controller?: AbortController): Promise<string> {
    const signal = controller?.signal;
    this.throwIfAborted(signal);

    const sessionId = crypto.randomUUID();
    this.ensureFileHistorySession(sessionId);
    const now = new Date().toISOString();
    const index = this.loadSessionsIndex();
    const entry: SessionEntry = {
      id: sessionId,
      summary: userPrompt.text ? userPrompt.text.slice(0, 100) : "[Image Prompt]",
      assistantReply: null,
      assistantThinking: null,
      assistantRefusal: null,
      toolCalls: null,
      status: "pending",
      failReason: null,
      usage: null,
      usagePerModel: null,
      activeTokens: 0,
      // Silent subagent (runSubagent silent:true): hidden from list/stream.
      isSilentSubagent: this.silentSubagentActive || undefined,
      createTime: now,
      updateTime: now,
      processes: null,
      planMode: Boolean(userPrompt.planMode),
    };
    index.entries.push(entry);
    const sortedEntries = index.entries.slice().sort((a, b) => {
      const aTime = Date.parse(a.updateTime);
      const bTime = Date.parse(b.updateTime);
      if (Number.isNaN(aTime) || Number.isNaN(bTime)) {
        return b.updateTime.localeCompare(a.updateTime);
      }
      return bTime - aTime;
    });
    const keptEntries = sortedEntries.slice(0, MAX_SESSION_ENTRIES);
    const keptIds = new Set(keptEntries.map((item) => item.id));
    const droppedEntries = sortedEntries.filter((item) => !keptIds.has(item.id));
    index.entries = keptEntries;
    // Session creation is critical — flush immediately (not debounced).
    this.pendingIndex = index;
    this.flushSessionsIndex();
    for (const dropped of droppedEntries) {
      this.cleanupSessionResources(dropped.id, {
        removeMessages: true,
        processIds: this.getProcessIds(dropped.processes ?? null),
      });
    }

    const promptToolOptions = this.getPromptToolOptions();

    // System-message prefix — ordered MOST → LEAST stable so the DeepSeek prefix
    // cache (which keys on the contiguous leading bytes) shares the largest
    // possible stable head across sessions. The date/model line is intentionally
    // absent here: it varies day-to-day and per model switch, so it is injected
    // per-turn as a transient user-message tail (see activateSession) instead of
    // baked into this cache-stable prefix.
    //   1. base system prompt + tool docs        — immutable per build
    //   2. AGENTS.md standing instructions        — rarely change within a project
    //   3. default skill + built-in plugin docs   — stable per skill/plugin set
    //   4. machine-level workspace environment    — stable per machine/project
    const systemPrompt = getSystemPrompt(this.projectRoot, promptToolOptions);
    this.appendSessionMessage(sessionId, this.buildSystemMessage(sessionId, systemPrompt));

    const agentInstructions = this.loadAgentInstructions();
    if (agentInstructions) {
      this.appendSessionMessage(sessionId, this.buildSystemMessage(sessionId, agentInstructions));
    }

    const defaultSkillPrompt = getDefaultSkillPrompt({ enabledSkills: this.getResolvedSettings().enabledSkills });
    if (defaultSkillPrompt) {
      this.appendSessionMessage(sessionId, this.buildSystemMessage(sessionId, defaultSkillPrompt));
    }

    // Orca built-in plugins: always inject their instruction docs into the session.
    const builtinPluginPrompt = this.getBuiltinPluginPrompt();
    if (builtinPluginPrompt) {
      this.appendSessionMessage(sessionId, this.buildSystemMessage(sessionId, builtinPluginPrompt));
    }

    this.appendSessionMessage(sessionId, this.buildSystemMessage(sessionId, getStableRuntimeContext(this.projectRoot)));

    // Memory recall — inject cross-session memories before activation.
    // Uses a 2s race: if the Gateway responds fast, memories are injected
    // synchronously before the LLM sees the first message. If it's slow,
    // we proceed without memories rather than blocking session creation.
    if (this.memoryProvider?.isAvailable() && userPrompt.text) {
      try {
        const recall = await Promise.race([
          this.memoryProvider.recall(userPrompt.text, sessionId),
          new Promise<null>((r) => setTimeout(() => r(null), 2000)),
        ]);
        if (recall) {
          const memoryPrompt = getMemoryPrompt(recall);
          if (memoryPrompt) {
            this.appendSessionMessage(sessionId, this.buildSystemMessage(sessionId, memoryPrompt));
          }
        }
      } catch {
        // Memory recall must never block session creation.
      }
    }

    this.appendBehaviorContext(sessionId);

    this.appendPlanModeTransitionMessages(sessionId, false, Boolean(userPrompt.planMode));

    this.recordUserPromptCheckpoint(sessionId);
    const userMessage = this.buildUserMessage(sessionId, userPrompt);
    this.appendSessionMessage(sessionId, userMessage);

    if (userPrompt.text) {
      const skills = await this.listSkills();
      const skillNames = await this.identifyMatchingSkillNames(skills, userPrompt.text, { signal, sessionId });
      this.throwIfAborted(signal);
      const skillSet = new Set(skillNames);
      const matchedSkill = skills.filter((skill) => skillSet.has(skill.name));
      if (Array.isArray(userPrompt.skills)) {
        userPrompt.skills.push(...matchedSkill);
      } else if (matchedSkill.length > 0) {
        userPrompt.skills = matchedSkill;
      }
    }
    userPrompt.skills = await this.normalizeSkills(userPrompt.skills);
    this.throwIfAborted(signal);

    await this.appendSkillMessages(sessionId, userPrompt.skills, userPrompt.text);

    this.activeSessionId = sessionId;
    await this.activateSession(sessionId, controller);
    return sessionId;
  }

  async replySession(sessionId: string, userPrompt: UserPromptContent, controller?: AbortController): Promise<void> {
    const signal = controller?.signal;
    this.throwIfAborted(signal);
    // Release memory from previously active session's file-state caches.
    // Without this, every file ever read/written in every session stays in
    // memory until the session is explicitly deleted.
    if (this.activeSessionId && this.activeSessionId !== sessionId) {
      this.messageCache.delete(this.activeSessionId);
      // Note: we don't clearSessionState for the old session because the user
      // might switch back — but file-state maps grow large; a future enhancement
      // could use an LRU eviction policy here.
    }
    appendProjectPermissionAllows(this.projectRoot, userPrompt.alwaysAllows, {
      inheritedPermissions: this.getResolvedSettings().permissions,
    });
    // Path-level grants (task 14): persisted separately so a click can never
    // widen into a permanent whole-disk scope grant.
    appendProjectAllowedPaths(this.projectRoot, userPrompt.alwaysAllowPaths);
    const now = new Date().toISOString();
    const previousPlanMode = Boolean(this.getSession(sessionId)?.planMode);
    const nextPlanMode = Boolean(userPrompt.planMode);
    const updated = this.updateSessionEntry(sessionId, (entry) => ({
      ...entry,
      status: "pending",
      failReason: null,
      askPermissions: undefined,
      planMode: nextPlanMode,
      updateTime: now,
    }));

    if (!updated) {
      await this.createSession(userPrompt, controller);
      return;
    }

    this.appendPlanModeTransitionMessages(sessionId, previousPlanMode, nextPlanMode);

    if (hasUserPermissionReplies(userPrompt) && this.hasTrailingPendingToolCalls(sessionId)) {
      this.activeSessionId = sessionId;
      await this.activateSession(sessionId, controller, userPrompt);
      return;
    }

    if (this.isContinuePrompt(userPrompt)) {
      this.activeSessionId = sessionId;
      await this.activateSession(sessionId, controller, userPrompt);
      return;
    }

    this.ensureFileHistorySession(sessionId);
    const checkpoint = this.recordUserPromptCheckpoint(sessionId);
    if (checkpoint.changedFilePaths.length) {
      const content = `Note that the user manually modified these files:\n${checkpoint.changedFilePaths.join("\n")}`;
      this.appendSessionMessage(sessionId, this.buildSystemMessage(sessionId, content));
    }
    const userMessage = this.buildUserMessage(sessionId, userPrompt);
    this.appendSessionMessage(sessionId, userMessage);

    if (userPrompt.text) {
      const skills = await this.listSkills(sessionId);
      const skillNames = await this.identifyMatchingSkillNames(skills, userPrompt.text, { signal, sessionId });
      this.throwIfAborted(signal);
      const skillSet = new Set(skillNames);
      const matchedSkill = skills.filter((skill) => skillSet.has(skill.name));
      if (Array.isArray(userPrompt.skills)) {
        userPrompt.skills.push(...matchedSkill);
      } else if (matchedSkill.length > 0) {
        userPrompt.skills = matchedSkill;
      }
    }
    userPrompt.skills = await this.normalizeSkills(userPrompt.skills, sessionId);
    this.throwIfAborted(signal);

    await this.appendSkillMessages(sessionId, userPrompt.skills, userPrompt.text);
    this.activeSessionId = sessionId;
    await this.activateSession(sessionId, controller);
  }

  protected isContinuePrompt(userPrompt: UserPromptContent): boolean {
    return (
      typeof userPrompt.text === "string" &&
      userPrompt.text.trim() === "/continue" &&
      (!userPrompt.imageUrls || userPrompt.imageUrls.length === 0) &&
      (!userPrompt.skills || userPrompt.skills.length === 0)
    );
  }

  async activateSession(
    sessionId: string,
    controller?: AbortController,
    permissionPrompt?: UserPromptContent
  ): Promise<void> {
    const startedAt = Date.now();
    const { client, model, baseURL, temperature, thinkingEnabled, reasoningEffort, debugLogEnabled, notify, env } =
      this.createOpenAIClient();
    const now = new Date().toISOString();
    rebuildSessionStateFromHistory(sessionId, this.listSessionMessages(sessionId));

    if (!client) {
      this.updateSessionEntry(sessionId, (entry) => ({
        ...entry,
        status: "failed",
        failReason: "API key not found",
        updateTime: now,
      }));
      this.onAssistantMessage(
        this.buildAssistantMessage(
          sessionId,
          formatSessionPrompt("apiKeyMissing", {
            userPath: getUserSettingsPath(),
            projectPath: getProjectSettingsPath(this.projectRoot),
          }),
          null
        ),
        false
      );
      this.maybeNotifyTaskCompletion(sessionId, notify, startedAt, env);
      return;
    }

    const sessionController = controller ?? new AbortController();
    if (sessionController.signal.aborted) {
      this.updateSessionEntry(sessionId, (entry) => ({
        ...entry,
        status: "interrupted",
        failReason: "interrupted",
        updateTime: now,
      }));
      this.maybeNotifyTaskCompletion(sessionId, notify, startedAt, env);
      return;
    }

    this.updateSessionEntry(sessionId, (entry) => ({
      ...entry,
      status: "processing",
      updateTime: now,
    }));

    this.sessionControllers.set(sessionId, sessionController);
    // A fresh activation must not inherit a stale pause request from a previous run.
    this.pauseRequestedSessions.delete(sessionId);
    // Branch-level resume (task-tree P1): restore the bound branch as active.
    this.restoreTaskBranchForSession(sessionId);

    // The activation loop as a local closure: all loop state (iteration count,
    // pending tool calls, consumed permission replies) is per-run, so a failed
    // run can be replayed cleanly by the auto-recovery wrapper below.
    const runActivationLoop = async (): Promise<void> => {
      const maxIterations = 80000; // about 1K RMB cost
      let toolCalls: unknown[] | null = null;

      for (let iteration = 0; iteration < maxIterations; iteration++) {
        if (this.isInterrupted(sessionId)) {
          return;
        }

        if (this.consumePauseRequest(sessionId)) {
          this.markSessionPaused(sessionId);
          return;
        }

        const session = this.getSession(sessionId);
        if (session == null || session.status === "interrupted" || session.status === "failed") {
          return;
        }

        const pendingToolCallMessage = this.messageConverter.getTrailingPendingToolCallMessage(
          this.listSessionMessages(sessionId)
        );
        if (pendingToolCallMessage.toolCalls.length > 0) {
          const toolAppendResult = await this.appendToolMessages(sessionId, pendingToolCallMessage.toolCalls, {
            permissionOverrides: permissionPrompt?.permissions,
            messagePermissions: pendingToolCallMessage.message?.meta?.permissions,
          });
          await this.appendDeferredPermissionPrompt(sessionId, permissionPrompt, sessionController);
          // Permission replies are one-shot: do not reuse decisions or append the deferred user prompt again on later tool-call batches.
          permissionPrompt = undefined;
          if (this.isInterrupted(sessionId)) {
            return;
          }
          if (toolAppendResult.waitingForUser) {
            this.updateSessionEntry(sessionId, (entry) => ({
              ...entry,
              toolCalls: pendingToolCallMessage.toolCalls,
              status: "waiting_for_user",
              updateTime: new Date().toISOString(),
            }));
            return;
          }
        }

        // User override (settings.compactTokenThreshold) wins over the
        // per-model family registry default.
        const compactPromptTokenThreshold =
          this.getResolvedSettings().compactTokenThreshold ?? getCompactPromptTokenThreshold(model);
        if (session.activeTokens > compactPromptTokenThreshold) {
          const message = this.buildAssistantMessage(sessionId, formatSessionPrompt("compacting"), null);
          message.meta = { asThinking: true };
          this.onAssistantMessage(message, false);
          await this.compactSession(sessionId, sessionController.signal);
        }

        const messages = this.messageConverter.buildMessages(
          this.listSessionMessages(sessionId),
          thinkingEnabled,
          model
        );
        const thinkingOptions = buildThinkingRequestOptions(thinkingEnabled, baseURL, reasoningEffort, model);
        const response = await this.createChatCompletionStream(
          client,
          {
            model,
            ...(temperature !== undefined ? { temperature } : {}),
            messages,
            tools: getTools(this.getPromptToolOptions(), [
              ...(await this.getRoutedMcpTools(sessionId)),
              // defineAction LLM surface: registered actions appear as tools the
              // agent can call (e.g. system_ping). Dispatched in ToolExecutor.
              ...this.actionRegistry.toToolDefinitions(),
              // Memory provider retrieval tools (Phase 4 / T4.1): read-only
              // search over L1 memories / L0 conversations. Dispatched via the
              // executor's memory bridge; no permission gate (pure reads).
              ...(this.memoryProvider?.isAvailable() ? (this.memoryProvider.getToolDefinitions?.() ?? []) : []),
            ]),
            ...thinkingOptions,
          },
          { signal: sessionController.signal },
          sessionId,
          {
            enabled: debugLogEnabled,
            location: "SessionManager.activateSession",
            baseURL,
            params: { iteration, temperature, thinkingEnabled, reasoningEffort },
          }
        );

        const message = response.choices?.[0]?.message;
        const rawContent = message?.content;
        const content = typeof rawContent === "string" ? rawContent : "";
        const rawToolCalls = (message as { tool_calls?: unknown[] } | undefined)?.tool_calls ?? null;
        toolCalls = this.normalizeLlmToolCalls(rawToolCalls);
        const rawThinking = (message as { reasoning_content?: unknown } | undefined)?.reasoning_content;
        const thinking = typeof rawThinking === "string" ? rawThinking : null;
        const refusal = (message as { refusal?: string } | undefined)?.refusal ?? null;
        // const html = content ? this.renderMarkdown(content) : "";

        if (this.isInterrupted(sessionId)) {
          return;
        }
        const assistantMessage = this.buildAssistantMessage(
          sessionId,
          content,
          toolCalls,
          thinking,
          resolveModelSpec({ model }).reasoningField
        );
        // dsh P1-4: the permission check (and any future execution-layer
        // listeners) runs through the toolExecutionGate — first listener is the
        // built-in permission check below.
        const permissionPlan = toolCalls
          ? (this.toolExecutionGate.decide({ sessionId, toolCalls })?.payload ?? null)
          : null;
        if (permissionPlan) {
          assistantMessage.meta = {
            ...(assistantMessage.meta ?? {}),
            permissions: permissionPlan.permissions,
          };
        }
        this.appendSessionMessage(sessionId, assistantMessage);
        this.onAssistantMessage(assistantMessage, true);

        // Second pause checkpoint: pausing here leaves the tool calls pending, so a
        // later resume re-enters the loop and executes them via the trailing-pending path.
        if (this.consumePauseRequest(sessionId)) {
          this.markSessionPaused(sessionId);
          return;
        }

        let waitingForUser = false;
        const responseUsage = response.usage ?? null;
        if (toolCalls) {
          if (permissionPlan?.askPermissions.length) {
            this.updateSessionEntry(sessionId, (entry) => ({
              ...entry,
              assistantReply: content,
              assistantThinking: thinking,
              assistantRefusal: refusal,
              toolCalls,
              usage: accumulateUsage(entry.usage, responseUsage),
              usagePerModel: accumulateUsagePerModel(entry.usagePerModel, model, responseUsage),
              activeTokens: getLastPromptTokens(responseUsage),
              status: "ask_permission",
              failReason: null,
              askPermissions: permissionPlan.askPermissions,
              updateTime: new Date().toISOString(),
            }));
            return;
          }
          const toolAppendResult = await this.appendToolMessages(sessionId, toolCalls, {
            messagePermissions: permissionPlan?.permissions,
          });
          waitingForUser = toolAppendResult.waitingForUser;
        }

        if (this.isInterrupted(sessionId)) {
          return;
        }

        this.updateSessionEntry(sessionId, (entry) => ({
          ...entry,
          assistantReply: content,
          assistantThinking: thinking,
          assistantRefusal: refusal,
          toolCalls,
          usage: accumulateUsage(entry.usage, responseUsage),
          usagePerModel: accumulateUsagePerModel(entry.usagePerModel, model, responseUsage),
          activeTokens: getLastPromptTokens(responseUsage),
          status: refusal ? "failed" : waitingForUser ? "waiting_for_user" : toolCalls ? "processing" : "completed",
          failReason: refusal ? refusal : entry.failReason,
          askPermissions: undefined,
          updateTime: new Date().toISOString(),
        }));

        if (refusal) {
          return;
        }

        if (waitingForUser) {
          return;
        }

        if (!toolCalls) {
          return;
        }
      }

      this.updateSessionEntry(sessionId, (entry) => ({
        ...entry,
        status: "completed",
        updateTime: new Date().toISOString(),
      }));
      this.onAssistantMessage(
        this.buildAssistantMessage(
          sessionId,
          "The AI agent has taken several steps but hasn't reached a conclusion yet. Do you want to continue?",
          null
        ),
        false
      );
    };

    try {
      await this.runActivationLoopWithAutoRecovery(runActivationLoop, sessionId, sessionController);
    } catch (error) {
      const errMessage = describeLlmError(error);
      const aborted = this.isAbortLikeError(error) || sessionController.signal.aborted;
      this.updateSessionEntry(sessionId, (entry) => ({
        ...entry,
        status: aborted ? "interrupted" : "failed",
        failReason: aborted ? "interrupted" : errMessage,
        updateTime: new Date().toISOString(),
      }));

      if (!aborted) {
        this.onAssistantMessage(
          this.buildAssistantMessage(sessionId, formatSessionPrompt("requestFailed", { message: errMessage }), null),
          false
        );
      }
    } finally {
      if (this.sessionControllers.get(sessionId) === sessionController) {
        this.sessionControllers.delete(sessionId);
      }
      this.maybeNotifyTaskCompletion(sessionId, notify, startedAt, env);
      this.maybeSyncCodegraphIndex(sessionId);
      this.maybeSyncCrgIndex(sessionId);
      this.maybeSyncWikiIndex(sessionId);
      this.maybeRunDiagnosticsCheck(sessionId);
      this.maybeCaptureMemory(sessionId);
    }
  }

  /**
   * Run one activation loop with exactly one shot of automatic recovery:
   * a context-window overflow is compacted then retried, an idle-timeout
   * failure is retried as-is. Everything else — and any second failure —
   * keeps the original fail path. Aborts always propagate untouched, and
   * quota errors are never retried (retrying cannot fix an empty balance).
   */
  protected async runActivationLoopWithAutoRecovery(
    runLoop: () => Promise<void>,
    sessionId: string,
    sessionController: AbortController
  ): Promise<void> {
    try {
      await runLoop();
    } catch (error) {
      if (this.isAbortLikeError(error) || sessionController.signal.aborted) {
        throw error;
      }
      const category = classifyLlmError(error);
      if (category !== "CONTEXT_WINDOW_EXCEEDED" && category !== "TIMEOUT") {
        throw error;
      }
      if (this.isInterrupted(sessionId)) {
        return;
      }
      const notice = this.buildAssistantMessage(
        sessionId,
        category === "CONTEXT_WINDOW_EXCEEDED"
          ? formatSessionPrompt("compactRetryContextWindow")
          : formatSessionPrompt("compactRetryStalled"),
        null
      );
      notice.meta = { asThinking: true };
      this.onAssistantMessage(notice, false);
      if (category === "CONTEXT_WINDOW_EXCEEDED") {
        try {
          await this.compactSession(sessionId, sessionController.signal);
        } catch (compactionError) {
          if (this.isAbortLikeError(compactionError) || sessionController.signal.aborted) {
            throw compactionError;
          }
          // Compaction itself failed — surface the original overflow error.
          throw error;
        }
      }
      await runLoop();
    }
  }

  async compactSession(sessionId: string, signal?: AbortSignal): Promise<void> {
    this.throwIfAborted(signal);
    const { client: sessionClient, baseURL, debugLogEnabled, model: sessionModel } = this.createOpenAIClient();
    if (!sessionClient) {
      return;
    }
    // Compaction runs on the resolved background LLM (the family's fast/cheap
    // lightweight model — summarization does not need the pro model's full
    // reasoning capability).
    const { client, model } = this.createBackgroundLlm();
    if (!client) {
      return;
    }
    const thinkingEnabled = false;
    const reasoningEffort = undefined;
    const temperature = COMPACTION_TEMPERATURE;
    const sessionMessages = this.listSessionMessages(sessionId).filter((message) => !message.compacted);
    if (sessionMessages.length === 0) {
      return;
    }

    const startIndex = sessionMessages.findIndex((message) => message.role !== "system");
    if (startIndex === -1) {
      return;
    }

    const searchStart = Math.floor(startIndex + ((sessionMessages.length - startIndex) * 2) / 3);
    let endIndex = -1;
    for (let i = Math.max(searchStart, startIndex); i < sessionMessages.length; i += 1) {
      if (sessionMessages[i].role !== "tool") {
        endIndex = i;
        break;
      }
    }
    if (endIndex === -1 || endIndex <= startIndex) {
      return;
    }

    // Pairing guard (dsh P1-2): never summarize across a broken call/result
    // pairing — retry on the next trigger instead of corrupting history.
    if (!validateCompactionPairing(sessionMessages, startIndex, endIndex)) {
      return;
    }

    // Stage A (dsh P1-2): model-free pre-truncation of oversized tool results
    // in the range — deterministic, free, persisted immediately. When trimming
    // alone projects the context clearly back under the threshold, the LLM
    // summary is skipped for this round.
    const now = new Date().toISOString();
    let trimmed = false;
    for (let i = startIndex; i < endIndex; i += 1) {
      const message = sessionMessages[i];
      if (message.role !== "tool") {
        continue;
      }
      const truncated = truncateToolResultForCompaction(message.content);
      if (truncated !== null) {
        sessionMessages[i] = { ...message, content: truncated, updateTime: now };
        trimmed = true;
      }
    }
    if (trimmed) {
      this.saveSessionMessages(sessionId, sessionMessages);
      const threshold =
        this.getResolvedSettings().compactTokenThreshold ?? getCompactPromptTokenThreshold(sessionModel ?? model);
      if (estimateConversationTokens(sessionMessages) < threshold * STAGE_A_SKIP_HEADROOM) {
        // Stage A sufficed — skip the LLM summary. Reset the meter; the next
        // request re-measures (same contract as the post-summary path below).
        this.updateSessionEntry(sessionId, (entry) => ({ ...entry, activeTokens: 0, updateTime: now }));
        return;
      }
    }

    const compactPrompt = getCompactPrompt(sessionMessages.slice(startIndex, endIndex));
    const thinkingOptions = buildThinkingRequestOptions(thinkingEnabled, baseURL, reasoningEffort, model);
    const response = await this.createChatCompletionStream(
      client,
      {
        model,
        temperature,
        messages: [{ role: "user", content: compactPrompt }],
        ...thinkingOptions,
      },
      signal ? { signal } : undefined,
      sessionId,
      {
        enabled: debugLogEnabled,
        location: "SessionManager.compactSession",
        baseURL,
        params: { temperature, thinkingEnabled, reasoningEffort },
      }
    );
    this.throwIfAborted(signal);
    const rawLlmResponse = response.choices?.[0]?.message?.content;
    const llmResponse = typeof rawLlmResponse === "string" ? rawLlmResponse : "";
    const compactedSummary = llmResponse.replace(/<analysis>[\s\S]*?<\/analysis>/gi, "").trim();

    const responseUsage = response.usage ?? null;
    this.updateSessionEntry(sessionId, (entry) => ({
      ...entry,
      usage: accumulateUsage(entry.usage, responseUsage),
      usagePerModel: accumulateUsagePerModel(entry.usagePerModel, model, responseUsage),
      // The compaction request's prompt size says nothing about the session's
      // real context pressure — reset and let the next model request re-measure.
      activeTokens: 0,
      updateTime: now,
    }));

    for (let i = startIndex; i < endIndex; i += 1) {
      sessionMessages[i] = { ...sessionMessages[i], compacted: true, updateTime: now };
    }

    const summaryMessage: SessionMessage = {
      id: crypto.randomUUID(),
      sessionId,
      role: "system",
      content: `There are earlier parts of the conversation. Here is a summary: \n\n${compactedSummary}`,
      contentParams: null,
      messageParams: null,
      compacted: false,
      visible: false,
      createTime: now,
      updateTime: now,
      meta: {
        isSummary: true,
      },
    };
    sessionMessages.splice(endIndex, 0, summaryMessage);
    this.saveSessionMessages(sessionId, sessionMessages);
  }

  protected getPromptToolOptions(): { model: string; webSearchEnabled: boolean } {
    return {
      model: this.getResolvedSettings().model,
      webSearchEnabled: true,
    };
  }

  /**
   * Request a graceful pause of the active session. Unlike interrupt, this does
   * not abort the in-flight LLM request or kill processes — the loop stops at
   * the next checkpoint (before the next LLM call or before executing freshly
   * returned tool calls) and the session is marked "paused" so it can be
   * resumed later without losing any state.
   * Returns the session id the pause was requested for, or null when there is
   * no session currently running.
   */
  pauseActiveSession(): string | null {
    const sessionId = this.activeSessionId;
    if (!sessionId || !this.sessionControllers.has(sessionId)) {
      return null;
    }
    this.pauseRequestedSessions.add(sessionId);
    return sessionId;
  }

  /**
   * Resume a paused (or interrupted) session by re-entering the LLM loop.
   * Trailing pending tool calls left by a designed continuation (pause
   * checkpoint, permission reply) are executed by the loop's trailing-pending
   * path, so no work is lost. A run that ended *unexpectedly* (interrupt or
   * crash) is different: its trailing pending calls have unknown outcomes, so
   * they are synthesized as persisted placeholders instead of re-executed
   * (dsh P1-1; settings.resumePendingToolCalls="replay" restores the legacy
   * re-execution).
   */
  async resumeSession(sessionId: string): Promise<void> {
    const session = this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    if (this.sessionControllers.has(sessionId)) {
      // Already running — nothing to resume.
      return;
    }
    const resumeMode =
      (this.getResolvedSettings() as { resumePendingToolCalls?: "replay" | "synthesize" }).resumePendingToolCalls ??
      PENDING_TOOL_RESUME_MODE_DEFAULT;
    if (shouldSynthesizePendingToolCalls(session.status, resumeMode)) {
      this.synthesizePendingToolOutcomes(sessionId, session.status);
    }
    const controller = new AbortController();
    this.activePromptController = controller;
    try {
      this.activeSessionId = sessionId;
      await this.activateSession(sessionId, controller);
    } finally {
      if (this.activePromptController === controller) {
        this.activePromptController = null;
      }
    }
  }

  /**
   * Persist synthesized results for the trailing pending tool calls of an
   * unexpectedly ended run so the activation loop resumes with a complete
   * tool-call/result pairing instead of re-executing side effects whose
   * outcome is unknown. "interrupted" batches are provably not-started
   * (interrupts only land at pre-dispatch checkpoints); a stale "processing"
   * session may have died mid-flight, so its calls are marked
   * outcome-unknown (conservative).
   */
  protected synthesizePendingToolOutcomes(sessionId: string, status: string): number {
    const pending = this.messageConverter.getTrailingPendingToolCallMessage(this.listSessionMessages(sessionId));
    if (pending.toolCalls.length === 0) {
      return 0;
    }
    // The boot sweep remaps stale `processing` → `interrupted` so the UI gets
    // a resumable state — but that must NOT downgrade the synthesis kind:
    // the run died mid-flight with the previous process, so outcomes stay
    // unknown (the sweep stamps failReason with SWEEP_FAIL_REASON for
    // exactly this discrimination; user interrupts carry no such marker).
    const sweptByRestart = this.getSession(sessionId)?.failReason === SessionManagerPersistence.SWEEP_FAIL_REASON;
    const kind = status === "interrupted" && !sweptByRestart ? "not-started" : "outcome-unknown";
    let synthesized = 0;
    for (const toolCall of pending.toolCalls) {
      const parsed = parseToolCallForPermissions(toolCall);
      const toolCallId = parsed?.id;
      if (!toolCallId) {
        continue;
      }
      const toolFunction = this.messageConverter.findToolFunction(pending.toolCalls, toolCallId);
      const rawName = (toolFunction as { name?: unknown } | null)?.name;
      const toolMessage = this.buildToolMessage(
        sessionId,
        toolCallId,
        buildPendingToolSynthesisContent(kind, typeof rawName === "string" ? rawName : parsed.function.name),
        toolFunction
      );
      this.appendSessionMessage(sessionId, toolMessage);
      this.onAssistantMessage(toolMessage, true);
      synthesized += 1;
    }
    if (synthesized > 0) {
      this.appendSessionMessage(
        sessionId,
        this.buildSystemMessage(sessionId, buildPendingToolResumeSystemNote(synthesized))
      );
    }
    return synthesized;
  }

  protected consumePauseRequest(sessionId: string): boolean {
    return this.pauseRequestedSessions.delete(sessionId);
  }

  protected markSessionPaused(sessionId: string): void {
    this.updateSessionEntry(sessionId, (entry) => ({
      ...entry,
      status: "paused",
      failReason: null,
      updateTime: new Date().toISOString(),
    }));
  }

  interruptActiveSession(): void {
    const controller = this.activePromptController;
    if (controller && !controller.signal.aborted) {
      controller.abort();
    }

    const sessionId = this.activeSessionId;
    if (sessionId) {
      this.interruptSession(sessionId);
    }
  }

  interruptSession(sessionId: string): void {
    const session = this.getSession(sessionId);
    const processIds = this.getProcessIds(session?.processes ?? null);
    const killedPids: number[] = [];
    const failedPids: number[] = [];
    for (const pid of processIds) {
      const processControlKey = this.getProcessControlKey(sessionId, pid);
      this.processTimeoutControls.delete(processControlKey);
      this.liveProcessKeys.delete(processControlKey);
      if (killProcessTree(pid, "SIGKILL")) {
        killedPids.push(pid);
        continue;
      }
      failedPids.push(pid);
    }

    const controller = this.sessionControllers.get(sessionId);
    if (controller) {
      controller.abort();
      this.sessionControllers.delete(sessionId);
    }
    this.pauseRequestedSessions.delete(sessionId);

    const now = new Date().toISOString();
    this.updateSessionEntry(sessionId, (entry) => ({
      ...entry,
      status: "interrupted",
      failReason: "interrupted",
      processes: null,
      updateTime: now,
    }));

    const contentParts = ["Interrupted."];
    if (killedPids.length > 0) {
      contentParts.push(`Killed processes: ${killedPids.join(", ")}.`);
    }
    if (failedPids.length > 0) {
      contentParts.push(`Failed to kill processes: ${failedPids.join(", ")}.`);
    }

    this.onAssistantMessage(this.buildUserMessage(sessionId, { text: contentParts.join(" ") }), false);
  }

  protected isInterrupted(sessionId: string): boolean {
    return !this.sessionControllers.has(sessionId);
  }

  /**
   * Mark a session's permission as denied by the user.
   * Updates the session entry status and failReason so the denial is visible in the session list.
   */
  denySessionPermission(sessionId: string, reason?: string): void {
    const now = new Date().toISOString();
    this.updateSessionEntry(sessionId, (entry) => ({
      ...entry,
      status: "permission_denied",
      failReason: reason ?? "Permission denied by user",
      updateTime: now,
    }));
    // An explicit user denial is a terminal decision, not a high-frequency
    // streaming update — flush it like session create/delete rather than leaving
    // it in the debounce window, so a reload cannot come back up as "pending".
    this.flushSessionsIndex();
  }

  adjustActiveBashTimeout(deltaMs: number): BashTimeoutAdjustment | null {
    const sessionId = this.activeSessionId;
    if (!sessionId || !Number.isFinite(deltaMs)) {
      return null;
    }
    const session = this.getSession(sessionId);
    if (!session?.processes) {
      return null;
    }

    let selectedPid: string | null = null;
    for (const pid of session.processes.keys()) {
      if (this.processTimeoutControls.has(this.getProcessControlKey(sessionId, pid))) {
        selectedPid = pid;
      }
    }
    if (!selectedPid) {
      return null;
    }

    const control = this.processTimeoutControls.get(this.getProcessControlKey(sessionId, selectedPid));
    if (!control) {
      return null;
    }

    const current = control.getInfo();
    const next = control.setTimeoutMs(current.timeoutMs + deltaMs);
    this.updateSessionProcessTimeout(sessionId, selectedPid, next);
    return this.buildBashTimeoutAdjustment(selectedPid, next);
  }

  /**
   * Derive the per-call path capability from the permission layer's scope
   * classification (specs/sandbox/design.md §4.1, correction R2). Re-runs
   * describeToolPermissionRequest instead of consuming the permission plan:
   * any call reaching this point has already resolved to "allow"
   * (buildPermissionToolExecution blocked the rest), so an out-cwd scope in
   * the request IS the authorized dynamic grant — whether it came from the
   * persisted allow list, a one-time override, or a forced-ask approval.
   * Zero persistence dependency, so the resume/trailing-pending replay
   * paths (where no permissionPlan object exists) stay consistent by
   * construction. Returns undefined for non-file tools.
   */
  protected derivePathGrantForToolCall(sessionId: string, toolCall: PermissionToolCall): PathGrant | undefined {
    const name = toolCall.function.name;
    const isRead = name === "read" || name === "Read";
    const isWrite = name === "write" || name === "Write";
    const isEdit = name === "edit" || name === "Edit";
    if (!isRead && !isWrite && !isEdit) {
      return undefined;
    }
    const skillRoots = this.getSkillScanRoots().map((entry) => entry.root);
    const effectivePermissions = this.effectivePermissions();
    const allowedReadPaths = effectivePermissions?.allowedReadPaths ?? [];
    const allowedWritePaths = effectivePermissions?.allowedWritePaths ?? [];
    const request = describeToolPermissionRequest({
      sessionId,
      projectRoot: this.projectRoot,
      toolCall,
      readPermissionExemptPaths: [...skillRoots, ...allowedReadPaths],
      writePermissionExemptPaths: allowedWritePaths,
      resolveSnippetPath: (id, snippetId) => getSnippet(id, snippetId)?.filePath,
    });
    const projectRealRoot = safeRealPath(this.projectRoot) ?? path.resolve(this.projectRoot);
    // Same canonicalizer as the gate's candidates — see resolveGateRoot.
    const toRealRoot = (entry: string): string => resolveGateRoot(entry);
    const readRealRoots = [...skillRoots, ...allowedReadPaths]
      .map(toRealRoot)
      .filter((root) => root !== projectRealRoot);
    // Path-level always-allow grants become additional write roots (task 14):
    // the gate then admits exactly these trees — the booleans below stay
    // untouched (quarantine clamps them; §10.3).
    const writeRealRoots = allowedWritePaths.map(toRealRoot).filter((root) => root !== projectRealRoot);
    const flags = grantOutsideRootsFlags(request.scopes, this.isWorkspaceQuarantined());
    return {
      writeRoots: [projectRealRoot, ...writeRealRoots],
      readRoots: [projectRealRoot, ...readRealRoots],
      allowWriteOutsideRoots: flags.allowWriteOutsideRoots,
      allowReadOutsideRoots: flags.allowReadOutsideRoots,
    };
  }

  protected isWorkspaceQuarantined(): boolean {
    return this.getResolvedSettings().workspaceTrust === "quarantine";
  }

  /**
   * The single source of permission truth for plan-time evaluation AND the
   * exempt lists. Under quarantine this is the clamped shape (path grants
   * zeroed) — computing the exempts from the raw resolved settings would let
   * a quarantined repo's own settings file re-open its out-of-cwd paths
   * (review finding, 2026-08-16).
   */
  protected effectivePermissions(): Required<PermissionSettings> | undefined {
    const resolved = this.getResolvedSettings().permissions;
    return this.isWorkspaceQuarantined() ? applyQuarantinePermissionClamp(resolved) : resolved;
  }

  /**
   * P3 bash sandbox (design.md §4.5/§4.5 task 19): lazily constructed per
   * session on the first bash call, same extras channel as pathGrant. The
   * backend selection — active OR degraded — is written to the session's
   * audit log; degradation is never silent. The network clause is snapshotted
   * at construction; settings changes apply to new sessions.
   */
  protected deriveBashSandbox(sessionId: string, toolCall: PermissionToolCall): BashSandboxSpawner | undefined {
    const name = toolCall.function.name;
    if (name !== "bash" && name !== "Bash") {
      return undefined;
    }
    const cached = this.bashSandboxBySession.get(sessionId);
    if (cached) {
      return cached;
    }
    const { backend } = this.getOrCreateBashBackend(sessionId);
    const spawner: BashSandboxSpawner = {
      backend: backend.name,
      wrapShell: (shellPath, shellArgs, cwd) => {
        const wrapped = backend.wrapShell({ shellPath, shellArgs, cwd });
        return wrapped ? { argv: wrapped.argv, env: wrapped.env } : null;
      },
    };
    this.bashSandboxBySession.set(sessionId, spawner);
    return spawner;
  }

  /**
   * Backend construction + probe, cached per session. Shared by the
   * permission plan (quarantine needs probe availability BEFORE execution to
   * decide bash force-ask) and the execution wrapper.
   */
  protected getOrCreateBashBackend(sessionId: string): { backend: SandboxBackend; probe: SandboxProbeResult } {
    const cached = this.bashBackendBySession.get(sessionId);
    if (cached) {
      return cached;
    }
    const audit = this.getSessionAuditLog(sessionId);
    // Network on ⇒ allow, or ask (a declined ask never reaches execution;
    // an approved one did). Off ⇒ deny.
    const networkAllowed = resolveScopeVerdict("network", this.getResolvedSettings().permissions ?? {}) !== "deny";
    // Design §4.5: "profile 由 PathGrant 生成" — the sandbox honors the
    // session's path-level grants (allowedWritePaths/allowedReadPaths) so
    // bash is not strictly narrower than the file tools for the SAME user
    // grant (review finding, 2026-08-16). Scope-level write-out-cwd allows
    // stay OUT of the profile: the sandbox is a hard boundary — cross-boundary
    // bash needs go through path grants. Under quarantine effectivePermissions
    // zeroes the lists, so a quarantined repo cannot widen its own sandbox.
    const effectivePermissions = this.effectivePermissions();
    const grantedWriteRoots = (effectivePermissions?.allowedWritePaths ?? []).map((entry) => resolveGateRoot(entry));
    const grantedReadRoots = (effectivePermissions?.allowedReadPaths ?? []).map((entry) => resolveGateRoot(entry));
    const backend = detectBashSandboxBackend({
      projectRoot: this.projectRoot,
      networkAllowed,
      writeRoots: [safeRealPath(this.projectRoot) ?? path.resolve(this.projectRoot), ...grantedWriteRoots],
      extraReadRoots: [...this.getSkillScanRoots().map((entry) => entry.root), ...grantedReadRoots],
      onDegradation: (degradation) => {
        audit.appendSandboxBackend({
          backend: degradation.backend,
          outcome: "degraded",
          detail: degradation.detail,
        });
        this.onSandboxStatusChanged?.({
          sessionId,
          backend: degradation.backend,
          outcome: "degraded",
          detail: degradation.detail,
        });
      },
    });
    const probe = backend.probe();
    const outcome = probe.available ? "active" : "degraded";
    audit.appendSandboxBackend({ backend: backend.name, outcome, detail: probe.detail });
    this.onSandboxStatusChanged?.({ sessionId, backend: backend.name, outcome, detail: probe.detail });
    const entry = { backend, probe };
    this.bashBackendBySession.set(sessionId, entry);
    return entry;
  }

  protected async appendToolMessages(
    sessionId: string,
    toolCalls: unknown[],
    options: {
      permissionOverrides?: UserToolPermission[];
      messagePermissions?: MessageToolPermission[];
    } = {}
  ): Promise<{ waitingForUser: boolean }> {
    const hooks: ToolExecutionHooks = {
      onProcessStart: (pid, command) => {
        this.addSessionProcess(sessionId, pid, command);
        // P1 audit bus: every spawn (bash, WebSearch, …) is recorded.
        this.getSessionAuditLog(sessionId).appendProcessStart(command);
      },
      onProcessExit: (pid) => this.removeSessionProcess(sessionId, pid),
      onProcessStdout: (pid, chunk) => this.onProcessStdout?.(Number(pid), chunk),
      onProcessTimeoutControl: (pid, control) => this.setSessionProcessTimeoutControl(sessionId, pid, control),
      onBackgroundProcessComplete: (completion) => this.addBackgroundProcessCompletionMessage(sessionId, completion),
      onBeforeFileMutation: (filePath) => this.prepareFileMutationCheckpoint(sessionId, filePath),
      onAfterFileMutation: (filePath, source) => {
        this.recordFileMutationCheckpoint(sessionId, filePath);
        // P1 audit bus: mutations that actually happened (post-gate).
        this.getSessionAuditLog(sessionId).appendFileWrite(source ?? "unknown", filePath);
      },
      onPathGateVerdict: (record) => {
        // P1 audit bus: every gate verdict, denials included.
        const verdict = record.verdict;
        this.getSessionAuditLog(sessionId).appendPathGate({
          tool: record.tool,
          verdict: verdict.ok ? "allow" : "deny",
          scope: verdict.ok ? undefined : verdict.scope,
          filePath: record.filePath,
        });
      },
      shouldStop: () => this.isInterrupted(sessionId),
    };
    const parsedToolCalls = toolCalls
      .map((toolCall) => parseToolCallForPermissions(toolCall))
      .filter((toolCall): toolCall is PermissionToolCall => Boolean(toolCall));
    const toolExecutions: ToolCallExecution[] = [];
    for (const toolCall of parsedToolCalls) {
      if (hooks.shouldStop?.()) {
        break;
      }
      const blockedResult = buildPermissionToolExecution(toolCall, options);
      if (blockedResult) {
        toolExecutions.push(blockedResult);
        continue;
      }
      const pathGrant = this.derivePathGrantForToolCall(sessionId, toolCall);
      const bashSandbox = this.deriveBashSandbox(sessionId, toolCall);
      const executions = await this.toolExecutor.executeToolCalls(sessionId, [toolCall], hooks, {
        pathGrant,
        bashSandbox,
      });
      toolExecutions.push(...executions);
    }
    if (this.isInterrupted(sessionId)) {
      return { waitingForUser: false };
    }
    let waitingForUser = false;
    const followUpMessages: SessionMessage[] = [];
    for (const execution of toolExecutions) {
      if (execution.result.awaitUserResponse === true) {
        waitingForUser = true;
      }
      const toolFunction = this.messageConverter.findToolFunction(toolCalls, execution.toolCallId);
      const toolMessage = this.buildToolMessage(sessionId, execution.toolCallId, execution.content, toolFunction);
      this.appendSessionMessage(sessionId, toolMessage);
      this.onAssistantMessage(toolMessage, true);
      // Plan Mode → tree materialization (ONE-WAY, read-only per spec §十一:
      // the plan is the source of truth; the tree never writes back). When a
      // session is bound to a task tree, new plan checklist lines become step
      // nodes on the bound branch (matched by title — no duplicates).
      this.materializePlanToTaskTree(sessionId, toolFunction);
      // Decision-point probe (spec §3.2 step 1): when the agent asks the user
      // to choose between approaches, surface similar historical forks once
      // per session as a hidden hint — proposals only, never auto-forks.
      this.probeTaskRecallAtDecision(sessionId, toolFunction);

      for (const followUpMessage of execution.result.followUpMessages ?? []) {
        if (followUpMessage.role !== "system") {
          continue;
        }
        followUpMessages.push(
          this.buildSystemMessage(sessionId, followUpMessage.content, followUpMessage.contentParams ?? null)
        );
      }
    }

    for (const followUpMessage of followUpMessages) {
      this.appendSessionMessage(sessionId, followUpMessage);
    }
    return { waitingForUser };
  }

  protected cloneUserPromptForMeta(prompt: UserPromptContent): UserPromptContent {
    return {
      text: prompt.text,
      imageUrls: prompt.imageUrls ? [...prompt.imageUrls] : undefined,
      skills: prompt.skills ? prompt.skills.map((skill) => ({ ...skill })) : undefined,
      permissions: prompt.permissions ? prompt.permissions.map((permission) => ({ ...permission })) : undefined,
      alwaysAllows: prompt.alwaysAllows ? [...prompt.alwaysAllows] : undefined,
      alwaysAllowPaths: prompt.alwaysAllowPaths
        ? {
            write: prompt.alwaysAllowPaths.write ? [...prompt.alwaysAllowPaths.write] : undefined,
            read: prompt.alwaysAllowPaths.read ? [...prompt.alwaysAllowPaths.read] : undefined,
          }
        : undefined,
      planMode: prompt.planMode,
    };
  }

  protected hasTrailingPendingToolCalls(sessionId: string): boolean {
    return (
      this.messageConverter.getTrailingPendingToolCallMessage(this.listSessionMessages(sessionId)).toolCalls.length > 0
    );
  }

  protected async appendDeferredPermissionPrompt(
    sessionId: string,
    userPrompt: UserPromptContent | undefined,
    controller: AbortController
  ): Promise<void> {
    if (!userPrompt || this.isContinuePrompt(userPrompt)) {
      return;
    }
    const text = userPrompt.text ?? "";
    const hasUserContent =
      text.trim().length > 0 ||
      (Array.isArray(userPrompt.imageUrls) && userPrompt.imageUrls.length > 0) ||
      (Array.isArray(userPrompt.skills) && userPrompt.skills.length > 0);
    if (!hasUserContent) {
      return;
    }
    const signal = controller.signal;
    const userMessage = this.buildUserMessage(sessionId, userPrompt);
    this.appendSessionMessage(sessionId, userMessage);
    if (userPrompt.text) {
      const skills = await this.listSkills(sessionId);
      const skillNames = await this.identifyMatchingSkillNames(skills, userPrompt.text, { signal, sessionId });
      this.throwIfAborted(signal);
      const skillSet = new Set(skillNames);
      const matchedSkill = skills.filter((skill) => skillSet.has(skill.name));
      if (Array.isArray(userPrompt.skills)) {
        userPrompt.skills.push(...matchedSkill);
      } else if (matchedSkill.length > 0) {
        userPrompt.skills = matchedSkill;
      }
    }
    userPrompt.skills = await this.normalizeSkills(userPrompt.skills, sessionId);
    this.throwIfAborted(signal);
    await this.appendSkillMessages(sessionId, userPrompt.skills, userPrompt.text);
  }

  protected buildToolParamsSnippet(toolFunction: unknown | null): string {
    if (!toolFunction || typeof toolFunction !== "object") {
      return "";
    }
    const args = (toolFunction as { arguments?: unknown }).arguments;
    const toolName = (toolFunction as { name?: unknown }).name;
    if (typeof args !== "string") {
      return "";
    }
    const trimmed = args.trim();
    if (!trimmed) {
      return "";
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return this.formatToolParamsSnippet(
          typeof toolName === "string" ? toolName : null,
          parsed as Record<string, unknown>
        );
      }
    } catch {
      // fall back to raw string
    }
    return trimmed;
  }

  protected formatToolParamsSnippet(toolName: string | null, args: Record<string, unknown>): string {
    if (toolName === "bash") {
      const command = typeof args.command === "string" ? args.command.trim() : "";
      const description = typeof args.description === "string" ? args.description.trim() : "";
      if (command && description) {
        return `${command}  # ${description}`;
      }
      if (command) {
        return command;
      }
      if (description) {
        return description;
      }
    } else if (toolName === "UpdatePlan") {
      return typeof args.explanation === "string" ? args.explanation.trim() : "";
    } else if (toolName === "write") {
      return typeof args.file_path === "string" ? args.file_path.trim() : "";
    } else if (toolName === "edit") {
      const filePath = typeof args.file_path === "string" ? args.file_path.trim() : "";
      if (filePath) {
        return filePath;
      }
      return typeof args.snippet_id === "string" ? args.snippet_id.trim() : "";
    }

    const firstKey = Object.keys(args)[0];
    if (!firstKey) {
      return "";
    }

    const value = args[firstKey];
    const text = typeof value === "string" ? value : JSON.stringify(value);
    if (toolName === "read" && text.startsWith(this.projectRoot)) {
      return text.slice(this.projectRoot.length).replace(/^[\\/]/, "");
    }
    return text;
  }

  protected buildToolResultSnippet(content: string): string {
    const trimmed = content.trim();
    if (!trimmed) {
      return "";
    }

    const maxLength = 2000;

    try {
      const parsed = JSON.parse(content) as { output?: unknown };
      if (parsed.output !== undefined) {
        if (typeof parsed.output === "string") {
          return this.formatToolResultSnippet(parsed.output, maxLength);
        }
        return this.formatToolResultSnippet(JSON.stringify(parsed.output), maxLength);
      }
    } catch {
      // fall back to raw content
    }

    return this.formatToolResultSnippet(content, maxLength);
  }

  protected formatToolResultSnippet(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
      return value;
    }
    return `${value.slice(0, maxLength)}... (total ${value.length} chars)`;
  }

  protected isInvisibleExecution(content: string): boolean {
    if (!content.trim()) {
      return false;
    }
    try {
      const parsed = JSON.parse(content) as { name?: unknown; ok?: unknown };
      return parsed.name === "bash" && parsed.ok !== true;
    } catch {
      return false;
    }
  }

  protected maybeNotifyTaskCompletion(
    sessionId: string,
    notifyCommand: string | undefined,
    startedAt: number,
    configuredEnv: Record<string, string> = {}
  ): void {
    if (!notifyCommand) {
      return;
    }

    const session = this.getSession(sessionId);
    if (!session || (session.status !== "completed" && session.status !== "failed")) {
      return;
    }

    // Find the last assistant message body for the BODY env variable.
    let body: string | undefined;
    const messages = this.listSessionMessages(sessionId);
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg && msg.role === "assistant" && msg.content) {
        body = msg.content;
        break;
      }
    }

    launchNotifyScript(notifyCommand, Date.now() - startedAt, this.projectRoot, undefined, configuredEnv, {
      status: session.status,
      failReason: session.failReason ?? undefined,
      body,
      title: session.summary ?? undefined,
    });
  }
}
