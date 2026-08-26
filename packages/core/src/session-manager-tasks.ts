// SessionManager layer — see session-manager-base.ts for the split rationale.
import * as crypto from "crypto";
import { buildThinkingRequestOptions } from "./common/openai-thinking";
import { getStableRuntimeContext, getTools } from "./prompt";
import { MAX_SUBAGENT_DEPTH } from "./session-constants";
import { SessionManagerLifecycle } from "./session-manager-lifecycle";
import { type BackgroundLlmTaskOptions, type BackgroundLlmTaskResult, type RunSubagentOptions } from "./actions";
import type { UserPromptContent, SkillInfo } from "./session-types";

export abstract class SessionManagerTasks extends SessionManagerLifecycle {
  /**
   * Build the user prompt for a subagent invocation (pure — extracted for
   * testing). arch-scan gets a domain-specific prompt; others reference the
   * skill name. The matched skill is force-loaded via UserPromptContent.skills
   * regardless, so this prompt is a fallback trigger, not the only loader.
   */
  protected buildSubagentPrompt(skill: string, input?: Record<string, unknown>, prompt?: string): string {
    if (prompt) return prompt;
    if (skill === "arch-scan") {
      const perspective = (input as { perspective?: string } | undefined)?.perspective;
      return perspective
        ? `Scan the codebase architecture focusing on ${perspective} and generate the architecture map: a Mermaid diagram document plus the layered HTML board, both persisted via save_archmap (never A2UI surfaces).`
        : "Scan the codebase architecture and generate the architecture map: a Mermaid diagram document plus the layered HTML board, both persisted via save_archmap (never A2UI surfaces).";
    }
    return `Execute the ${skill} skill for this project.`;
  }

  /**
   * Sessionless background LLM task (specs/index-knowledge-rework R2-2,
   * design B-1). Runs a skill-driven LLM tool-call loop WITHOUT any session:
   * no sessions-index entry, no message JSONL, no active-session switch, no
   * onAssistantMessage, no stream progress — nothing reaches the conversation
   * view. index.build-all's arch-scan stage runs here so a manual index build
   * can never leak a "Scan the codebase…" session into the sidebar or hijack
   * the main tab.
   *
   * Tool surface is deliberately narrow: built-in read/bash + the a2ui /
   * codegraph / serena MCP servers — everything the arch-scan skill consumes,
   * nothing user-facing (no write/edit, no AskUserQuestion/UpdatePlan).
   * On completion the A2UI arch-* surfaces are flushed to the target root's
   * `.deeporca/prototypes/`.
   *
   * Permissions — deliberate design decision (2026-08-23, user-confirmed,
   * design-r2.md §三 R3-4): this loop does NOT run the session permission
   * gate. Issuing the build instruction IS the blanket pre-approval for this
   * narrow tool surface — the user already explicitly asked for the build, so
   * its internal analysis steps (read/bash/a2ui) must not interrupt with
   * permission prompts. The blast radius stays bounded by the narrow tool
   * surface above, and the artifacts it produces (arch-* surfaces) display
   * exclusively in the Index & Knowledge module, never the conversation view.
   */
  async runBackgroundLlmTask(opts: BackgroundLlmTaskOptions): Promise<BackgroundLlmTaskResult> {
    const { client, model, baseURL, temperature, thinkingEnabled, reasoningEffort, debugLogEnabled } =
      this.createOpenAIClient();
    if (!client) {
      throw new Error("API key not found");
    }
    const targetRoot = opts.root || this.projectRoot;
    const taskId = `bg-${crypto.randomUUID()}`;
    const controller = new AbortController();
    // Adopt the owning action's cancellation signal (index.build-all forwards
    // ctx.signal): aborting it stops this loop at the next iteration boundary
    // instead of letting an 80-iteration scan run to completion.
    const adoptExternalAbort = () => controller.abort(opts.signal?.reason);
    if (opts.signal?.aborted) {
      controller.abort(opts.signal.reason);
    } else {
      opts.signal?.addEventListener("abort", adoptExternalAbort, { once: true });
    }
    // Snapshot the lifecycle + surface stamp so the completion flush writes
    // exactly what THIS task produced — arch surfaces lingering in the
    // process from an earlier task (e.g. another workspace root's build)
    // must not leak into this root's prototypes directory.
    const a2ui = this.currentA2uiLifecycle;
    const archFlushStamp = a2ui?.surfaceStamp?.();
    this.backgroundTaskIds.add(taskId);
    try {
      // Force-load the skill document as the task's instruction set.
      let skillPrompt: string | null = null;
      try {
        const skills = await this.listSkills();
        const skill = skills.find((s) => s.name === opts.skill);
        if (skill) {
          skillPrompt = await this.buildSkillPrompt(skill, opts.prompt);
        }
      } catch {
        // Skill scan failure is non-fatal — the task prompt still stands alone.
      }

      const messages: Array<Record<string, unknown>> = [
        {
          role: "system",
          content:
            "You are a non-interactive background analysis task inside DeepOrca. " +
            "Work autonomously to completion: never ask the user questions, never wait for input — " +
            "make reasonable assumptions and finish the task described below. " +
            "Your only lasting output is the tool-side artifacts you produce (e.g. the architecture map persisted via save_archmap); " +
            "your final text is a brief completion report to the orchestrator, not to a human.",
        },
        { role: "system", content: getStableRuntimeContext(this.projectRoot) },
      ];
      if (skillPrompt) {
        messages.push({ role: "system", content: skillPrompt });
      }
      messages.push({
        role: "user",
        content: opts.prompt ?? this.buildSubagentPrompt(opts.skill, opts.input, undefined),
      });

      // Narrow tool surface: read/bash built-ins + a2ui/codegraph/serena MCP.
      const ALLOWED_BUILTIN = new Set(["read", "bash"]);
      const ALLOWED_MCP = /^mcp__(a2ui|codegraph|serena)__/;
      const tools = getTools(this.getPromptToolOptions(), this.mcpToolDefinitions).filter(
        (t) => ALLOWED_BUILTIN.has(t.function.name) || ALLOWED_MCP.test(t.function.name)
      );

      const maxIterations = 80;
      let finalContent: string | null = null;
      let iterations = 0;
      for (let i = 0; i < maxIterations; i++) {
        this.throwIfAborted(controller.signal);
        iterations = i + 1;
        const response = await this.createChatCompletionStream(
          client,
          {
            model,
            ...(temperature !== undefined ? { temperature } : {}),
            messages,
            tools,
            ...buildThinkingRequestOptions(thinkingEnabled, baseURL, reasoningEffort, model),
          },
          { signal: controller.signal },
          taskId,
          {
            enabled: debugLogEnabled,
            location: "SessionManager.runBackgroundLlmTask",
            baseURL,
            params: { iteration: i, task: opts.skill },
          }
        );

        const message = response.choices?.[0]?.message;
        const content = typeof message?.content === "string" ? message.content : "";
        const toolCalls = this.normalizeLlmToolCalls(
          (message as { tool_calls?: unknown[] } | undefined)?.tool_calls ?? null
        );
        messages.push({
          role: "assistant",
          content,
          ...(toolCalls ? { tool_calls: toolCalls } : {}),
        });
        if (!toolCalls) {
          finalContent = content;
          break;
        }
        const executions = await this.toolExecutor.executeToolCalls(taskId, toolCalls, {
          shouldStop: () => controller.signal.aborted,
        });
        for (const exec of executions) {
          messages.push({ role: "tool", tool_call_id: exec.toolCallId, content: exec.content });
        }
        opts.onProgress?.(`${opts.skill}: ${i + 1} step${i === 0 ? "" : "s"}`);
      }
      return { content: finalContent, iterations };
    } finally {
      this.backgroundTaskIds.delete(taskId);
      opts.signal?.removeEventListener("abort", adoptExternalAbort);
      // Flush arch-* surfaces the task produced — they live in the A2UI server's
      // in-memory map and only persist on dispose otherwise. Prefix- and
      // stamp-scoped so neither the user's own design prototypes nor another
      // task's arch surfaces in the same directory are touched.
      try {
        a2ui?.persistSurfaces(targetRoot, "arch-", archFlushStamp);
      } catch {
        // best-effort flush
      }
    }
  }

  /**
   * Minimal Subagent runtime (roadmap §十 P2, spec §五). Runs an isolated
   * sub-session that force-loads the named skill and activates the LLM loop to
   * completion. The parent's active session is saved and restored so the UI
   * returns to it. The sub-session currently appears in the sidebar (marked by
   * its skill prompt) — UI isolation is a follow-up; this is the experimental
   * first step the roadmap describes ("先做桌面内受控实验").
   *
   * Re-entrancy: the engine is subagent-friendly — activateSession is keyed by
   * sessionId over Map<sessionId> state, so nested invocations don't collide.
   * Recursion is capped at MAX_SUBAGENT_DEPTH (deep review 2026-08-15, B6): a
   * mutually-recursive skill pair would otherwise nest unbounded LLM loops.
   */
  async runSubagent(opts: RunSubagentOptions): Promise<{ sessionId: string; content: string | null }> {
    if (this.subagentDepth >= MAX_SUBAGENT_DEPTH) {
      throw new Error(`Subagent recursion depth exceeded (>${MAX_SUBAGENT_DEPTH}) — mutually-recursive skills?`);
    }
    const previousActive = this.activeSessionId;
    // Silent mode: while set, newly created sub-sessions are flagged
    // isSilentSubagent (hidden from the list; renderer drops their streamed
    // messages). Cleared in finally so a thrown skill never leaves it on.
    const previousSilent = this.silentSubagentActive;
    if (opts.silent) {
      this.silentSubagentActive = true;
    }
    this.subagentDepth += 1;
    // Force-load the named skill (don't rely on auto-match alone).
    let skillInfo: SkillInfo | undefined;
    try {
      const skills = await this.listSkills();
      skillInfo = skills.find((s) => s.name === opts.skill);
    } catch {
      // Skill scan failure is non-fatal — the prompt still triggers auto-match.
    }
    const userPrompt: UserPromptContent = {
      text: this.buildSubagentPrompt(opts.skill, opts.input as Record<string, unknown> | undefined, opts.prompt),
      skills: skillInfo ? [{ ...skillInfo, isLoaded: false }] : undefined,
    };
    try {
      // createSession sets the sub-session active and runs its LLM loop to
      // completion (it calls activateSession internally).
      const subSessionId = await this.createSession(userPrompt);
      const msgs = this.listSessionMessages(subSessionId);
      const lastAssistant = [...msgs].reverse().find((m) => m.role === "assistant");
      const content = typeof lastAssistant?.content === "string" ? lastAssistant.content : null;
      if (opts.silent) {
        // Zero-residue guarantee (specs/index-knowledge-rework R2): delete the
        // sub-session entirely — index entry, message JSONL, in-memory state.
        // Silent runs are pipeline internals; persisting them only pollutes
        // the disk index and eats the MAX_SESSION_ENTRIES eviction pool.
        // BUT flush any artifacts the subagent produced first (A2UI surfaces
        // for arch-scan live in an in-memory Map that only persists on
        // manager dispose — deleting the session without flushing would lose
        // the architecture map the build was supposed to produce).
        try {
          this.currentA2uiLifecycle?.persistSurfaces(this.projectRoot);
        } catch {
          // best-effort flush
        }
        try {
          this.deleteSession(subSessionId);
        } catch {
          // best-effort — entry stays hidden via isSilentSubagent either way
        }
      }
      return { sessionId: subSessionId, content };
    } finally {
      // Restore the parent as the active session so the UI returns to it.
      this.activeSessionId = previousActive;
      this.silentSubagentActive = previousSilent;
      this.subagentDepth = Math.max(0, this.subagentDepth - 1);
    }
  }
}
