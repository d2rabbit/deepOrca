// SessionManager layer — see session-manager-base.ts for the split rationale.
//
// Depth lane (specs/depth-lane §2.4–§2.5): the staged deliberation flow that a
// `lane === "deep"` session enters when `complexityGate.depthLaneEnabled` is
// on. Sits at the TAIL of the layer chain (Tasks → Depth → SessionManager).
//
// Stage map (each stage is fail-open — an orchestration failure degrades to
// the S1 single-loop answer, never to a lost turn):
//   S1    context compilation — the EXISTING prompt chain + main activation
//         loop, plus the Gate Directive riding the transient turn tail;
//   S1.5  evidence gate — deterministic evidence count first, flash judgment
//         as fallback, one bounded read-only top-up loop when insufficient;
//   S2    divergence — runSubagent({silent:true}) × (K−1) + one main-session
//         stance call, each producing path + confidence + key assumptions;
//   S3    adversarial test — ONE red-team subagent attacking the K candidates
//         (counterexamples / ignored constraints / irreversible risks);
//   S4    fusion — a single orchestration call; convergence = confidence
//         spread < 15% or rounds > maxRounds;
//   S5    verdict output — the depth decision report reusing the
//         <proposed_plan> block contract shape, 结论先行 at the top.
//
// Hard budgets (§2.5): maxPaths ≤ 3 (v1 K=2), maxRounds ≤ 3, the evidence
// top-up sub-loop reuses runBackgroundLlmTask's 80-iteration cap. Abort
// propagates via AbortController + throwIfAborted between every stage.
//
// TODO(specs/depth-lane P2.3): 遥测口径（轻轨追问率 = 10 分钟内新消息 +
// embedding 余弦相似；重轨负反馈率 = 6 语言正则 + 1 星反馈）与设置面板只读
// 展示 — 依赖 P0 观察数据先行，本期只落 lane 分布与成本（gate.ts
// summarizeLaneTelemetry + usage-ledger source "depth-lane"）。
// TODO(specs/depth-lane P2.4): autoTune 公式（新阈值 = 旧阈值 + 追问率*0.5 −
// 负反馈率*0.5，±5 步进、钳制 [30,70]、审计日志）——默认关闭，未实现。

import { setMaxListeners } from "node:events";
import { renderDepthLanePrompt, type DepthLanePromptVars } from "./prompt";
import { buildThinkingRequestOptions } from "./common/openai-thinking";
import { SessionManagerTasks } from "./session-manager-tasks";

/** The staged flow's own budget constants (design §2.5 — hard ceiling). */
export const DEPTH_LANE_MAX_PATHS = 3;
export const DEPTH_LANE_MAX_ROUNDS = 3;
/** v1 divergence width: main path + ONE silent subagent (design §2.4 S2 现值取 2). */
export const DEPTH_LANE_V1_PATHS = 2;
/** Confidence spread (percentage points) below which paths count as converged. */
export const DEPTH_LANE_CONVERGENCE_SPREAD = 15;
/** Deterministic evidence gate: minimum distinct evidence-bearing tool results. */
export const DEPTH_LANE_EVIDENCE_MIN_RESULTS = 2;
/** Content-level retry budget for the staged flow's strict-JSON aux calls. */
const DEPTH_CONTENT_RETRY_BUDGET = 1;
/** Character cap for digests carried into staged-flow prompts. */
const DIGEST_MAX_CHARS = 4000;

/** Synthetic skill tag for depth-lane subagents (no SKILL.md exists — the
 *  prompt fully drives the sub-session; runSubagent tolerates a missing skill). */
const DEPTH_LANE_SKILL_TAG = "depth-lane";

/** One divergence path (S2) or fused judgment (S4). */
type DepthPath = {
  stance: string;
  path: string;
  confidence: number;
  keyAssumptions: string[];
  risks: string[];
};

type RedTeamFinding = {
  brokenPaths: string[];
  ignoredConstraints: string[];
  irreversibleRisks: string[];
  verdict: string | null;
};

type FusionJudgment = {
  judgment: string;
  confidence: number;
  disagreements: string[];
  keyAssumptions: string[];
  risks: string[];
  nextSteps: string[];
};

/** Per-session depth run state (in-memory only; the lane itself is persisted). */
type DepthRunState = {
  round: number;
  paths: DepthPath[];
  redTeam: RedTeamFinding | null;
  fusion: FusionJudgment | null;
  converged: boolean;
  /** Extra evidence collected by the S1.5 top-up, fed into later prompts. */
  topUpEvidence: string | null;
};

export abstract class SessionManagerDepth extends SessionManagerTasks {
  // NOTE: `laneContexts` (verdict details per session) is owned by the
  // lifecycle layer — createSession stamps it at the skill-matching point.

  /** Live staged-flow state per session (guards against accidental re-entry). */
  private readonly depthRuns = new Set<string>();

  // ── Transient turn-tail injection (P0.6 + S1 Gate Directive) ───────────────
  //
  // Every lane instruction rides the SAME transient per-turn tail mechanism as
  // the date/model line (OpenAIMessageConverter.applyTurnTail): appended to
  // the last user message at conversion time, never written to the JSONL,
  // never part of the cache-stable system prefix. With the gate disabled this
  // override is byte-identically absent.

  protected override buildCurrentTurnTail(model: string): string {
    const base = super.buildCurrentTurnTail(model);
    const laneTail = this.buildLaneTurnTail();
    return laneTail ? `${base}\n\n${laneTail}` : base;
  }

  /** Lane directive for the ACTIVE session; "" whenever the gate is off/unknown. */
  protected buildLaneTurnTail(): string {
    const gate = this.getComplexityGate();
    if (!gate.enabled) return "";
    const sessionId = this.activeSessionId;
    if (!sessionId) return "";
    const session = this.getSession(sessionId);
    if (!session || session.isSilentSubagent) return "";
    if (session.lane === "express") {
      const verdict = this.laneContexts.get(sessionId) ?? null;
      const riskNote = (verdict?.tpcr?.R ?? 0) > 0;
      return this.renderLaneFragment(
        { kind: "express", riskNote },
        // Inline fail-open (template unreadable): semantics preserved verbatim.
        riskNote
          ? "本回合为快速模式：基于当前上下文直接作答，无需多路径推演；若涉及金钱/安全/声誉，请提示用户可切换深度模式。"
          : "本回合为快速模式：基于当前上下文直接作答，无需多路径推演、无需模拟多方博弈；信息不足时照实说明并建议切换深度模式。"
      );
    }
    if (session.lane === "deep") {
      // P0 observation mode: a deep verdict WITHOUT depthLaneEnabled only
      // records the lane — the prompt stays status-quo (zero behavior change).
      if (!gate.depthLaneEnabled) return "";
      return this.buildGateDirective(sessionId);
    }
    return "";
  }

  /** S1 Gate Directive: only non-zero dimensions appear (design §2.4). */
  private buildGateDirective(sessionId: string): string {
    const verdict = this.laneContexts.get(sessionId) ?? null;
    const dims = verdict?.tpcr ?? null;
    const vars: DepthLanePromptVars = {
      kind: "gate-directive",
      dims: dims
        ? { T: dims.T || undefined, P: dims.P || undefined, C: dims.C || undefined, R: dims.R || undefined }
        : undefined,
    };
    return this.renderLaneFragment(
      vars,
      "网关提示：本任务经复杂度评分进入深度车轨（deep lane）。请对长期利益冲突、因果分叉与不可逆风险做显式推演，并对每个高风险结论给出可回退的护栏。"
    );
  }

  /** Template render with inline fail-open fallback (skill-matching pattern). */
  private renderLaneFragment(vars: DepthLanePromptVars, fallback: string): string {
    return renderDepthLanePrompt(vars) ?? fallback;
  }

  // ── Staged flow entry (called from createSession via maybeRunDepthLane) ────

  /**
   * Depth-lane hook invoked by createSession after the S1 prompt chain is
   * assembled (the base no-op declaration lives in session-manager-lifecycle
   * so that layer can call it). Returns true when the staged flow ran — S1's
   * activation happens INSIDE it; false = normal single-loop activation.
   */
  protected override async maybeRunDepthLane(sessionId: string, controller?: AbortController): Promise<boolean> {
    const gate = this.getComplexityGate();
    if (!gate.enabled || !gate.depthLaneEnabled) return false;
    const session = this.getSession(sessionId);
    if (!session || session.lane !== "deep" || session.isSilentSubagent) return false;
    if (this.depthRuns.has(sessionId)) return false; // re-entry guard
    this.depthRuns.add(sessionId);
    // The staged flow chains ~11 abort listeners onto one signal (stages +
    // subagents + top-up) — lift Node's default-10 leak warning (real-run
    // finding, 2026-09-04 GVGL verification).
    if (controller?.signal) setMaxListeners(20, controller.signal);
    try {
      await this.runDepthLane(sessionId, controller);
      return true;
    } finally {
      this.depthRuns.delete(sessionId);
    }
  }

  /** The 5-stage state machine. Every stage boundary checks the abort signal. */
  /** X.3: relay a stage transition to the host seam — best-effort only. */
  private emitStage(
    sessionId: string,
    stage: "s1" | "s1.5" | "s2" | "s3" | "s4" | "s5" | "done",
    extra?: { round?: number; totalRounds?: number; detail?: string; done?: boolean }
  ): void {
    try {
      this.onDepthLaneProgress?.({ sessionId, stage, ...extra });
    } catch {
      // Observability must never break the lane.
    }
  }

  private async runDepthLane(sessionId: string, controller?: AbortController): Promise<void> {
    const gate = this.getComplexityGate();
    const userTask = this.getDepthLaneUserTask(sessionId);
    const state: DepthRunState = {
      round: 0,
      paths: [],
      redTeam: null,
      fusion: null,
      converged: false,
      topUpEvidence: null,
    };

    // Abort plumbing for S2+: S1 reuses the caller's controller directly
    // (activateSession registers it in sessionControllers); the later stages
    // adopt it into a dedicated controller so interruptSession(sessionId)
    // kills the staged flow at the next stage boundary.
    const stageController = new AbortController();
    const adoptExternalAbort = () => stageController.abort(controller?.signal?.reason);
    if (controller?.signal.aborted) {
      stageController.abort(controller.signal.reason);
    } else {
      controller?.signal?.addEventListener("abort", adoptExternalAbort, { once: true });
    }

    try {
      // ── S1 情境编译：the existing chain + main ReAct loop (Gate Directive
      // rides the turn tail via buildLaneTurnTail). Evidence IS the loop's
      // tool activity.
      this.emitStage(sessionId, "s1");
      await this.activateSession(sessionId, controller);
      this.throwIfAborted(stageController.signal);
      // NOTE: the controller-map-based isInterrupted() is unusable here — S1
      // may legitimately leave no controller registered (clean completion
      // drops it), so the interrupt signal is read from the entry status.
      const s1Status = this.getSession(sessionId)?.status;
      if (s1Status === "interrupted") return;
      if (s1Status !== "completed") {
        // The loop paused for the user (ask_permission / waiting_for_user).
        // v1 does not persist mid-flight staging state — degrade gracefully:
        // keep the S1 answer, note that staging ended early.
        this.addSessionSystemMessage(sessionId, "深度模式：首轮交互需要用户输入，推演阶段（S2–S5）本轮跳过。");
        return;
      }

      // ── S1.5 证据闸：deterministic first, flash fallback, one bounded top-up.
      const evidenceCount = this.countSessionEvidence(sessionId);
      this.emitStage(sessionId, "s1.5", { detail: `evidence=${evidenceCount}` });
      let sufficient = evidenceCount >= DEPTH_LANE_EVIDENCE_MIN_RESULTS;
      if (!sufficient) {
        const flashVerdict = await this.judgeEvidenceSufficiency(userTask, stageController.signal);
        // Flash fail-open (null) → assume sufficient: an unverifiable judgment
        // must not burn a supplementary retrieval loop.
        sufficient = flashVerdict !== false;
      }
      if (!sufficient) {
        state.topUpEvidence = await this.runEvidenceTopUp(sessionId, userTask, stageController.signal);
      }
      this.throwIfAborted(stageController.signal);

      // S2+ stages run under the stage controller so interrupts land.
      this.sessionControllers.set(sessionId, stageController);

      const k = Math.max(1, Math.min(gate.maxPaths, DEPTH_LANE_V1_PATHS, DEPTH_LANE_MAX_PATHS));
      const maxRounds = Math.min(gate.maxRounds, DEPTH_LANE_MAX_ROUNDS);

      // ── S2 → S3 → S4 with the convergence back-edge (P2.2).
      while (state.round < maxRounds) {
        state.round += 1;
        this.emitStage(sessionId, "s2", { round: state.round, totalRounds: maxRounds, detail: `paths=${k}` });
        state.paths = await this.runDivergence(sessionId, userTask, k, state, stageController.signal);
        this.throwIfAborted(stageController.signal);
        if (k > 1) {
          this.emitStage(sessionId, "s3", { round: state.round, totalRounds: maxRounds });
          state.redTeam = await this.runRedTeam(userTask, state.paths, stageController.signal);
        } else {
          state.redTeam = null;
        }
        this.throwIfAborted(stageController.signal);
        this.emitStage(sessionId, "s4", { round: state.round, totalRounds: maxRounds });
        state.fusion = await this.runFusion(userTask, state, stageController.signal);
        this.throwIfAborted(stageController.signal);
        state.converged = isConverged(state.paths);
        if (state.converged) break;
        // 不收敛 → 带对抗反馈回 S2 重生成（轮次上限硬性，永不死循环）。
      }

      // ── S5 判定输出.
      this.emitStage(sessionId, "s5", {
        round: state.round,
        totalRounds: maxRounds,
        detail: state.converged ? "converged" : "round-cap",
      });
      this.emitDepthAnswer(sessionId, userTask, state);
      this.emitStage(sessionId, "done", { done: true });
    } catch (error) {
      if (this.isAbortLikeError(error) || stageController.signal.aborted) {
        // Clean stop: the interrupt path has already stamped status.
        return;
      }
      // Orchestration failure fails open to the S1 answer — never lose the turn.
      this.addSessionSystemMessage(
        sessionId,
        `深度模式编排失败，已回退到首轮单循环结果（${error instanceof Error ? error.message : String(error)}）。`
      );
      this.updateSessionEntry(sessionId, (entry) => ({
        ...entry,
        status: entry.status === "completed" ? entry.status : "completed",
        updateTime: new Date().toISOString(),
      }));
    } finally {
      controller?.signal?.removeEventListener("abort", adoptExternalAbort);
      if (this.sessionControllers.get(sessionId) === stageController) {
        this.sessionControllers.delete(sessionId);
      }
    }
  }

  // ── S1 helpers ──────────────────────────────────────────────────────────────

  /** The staged flow's task statement: the session's first user message. */
  private getDepthLaneUserTask(sessionId: string): string {
    const message = this.listSessionMessages(sessionId).find((m) => m.role === "user");
    return typeof message?.content === "string" ? message.content.trim().slice(0, DIGEST_MAX_CHARS) : "";
  }

  /**
   * Deterministic evidence count: distinct evidence-bearing tool results
   * (read / bash / WebSearch / WebFetch) in the session's message history.
   * The S1 ReAct loop's tool activity IS the evidence trail.
   */
  private countSessionEvidence(sessionId: string): number {
    const evidenceTools = new Set(["read", "bash", "WebSearch", "WebFetch"]);
    let count = 0;
    for (const message of this.listSessionMessages(sessionId)) {
      if (message.role !== "tool" || typeof message.content !== "string") continue;
      try {
        const parsed = JSON.parse(message.content) as { ok?: unknown; name?: unknown };
        if (parsed?.ok === true && typeof parsed.name === "string" && evidenceTools.has(parsed.name)) {
          count += 1;
        }
      } catch {
        // Non-JSON tool payload — not evidence-shaped, skip.
      }
    }
    return count;
  }

  /** Flash fallback for the evidence gate: true/false, or null (fail-open). */
  private async judgeEvidenceSufficiency(userTask: string, signal?: AbortSignal): Promise<boolean | null> {
    this.throwIfAborted(signal);
    const summary = userTask.slice(0, 500);
    return this.judgeViaLlm<boolean>(
      `Does the agent have enough gathered evidence to deliberate this task multi-path (files read, search results)? Task: ${summary}`,
      ["true", "false"] as const,
      {
        schema: {
          describe: 'boolean — respond {"choice": true} or {"choice": false}',
          validate: (parsed) => {
            const choice = (parsed as { choice?: unknown } | null)?.choice;
            return choice === true || choice === false ? choice : null;
          },
        },
      }
    );
  }

  /**
   * S1.5 top-up: ONE bounded read-only retrieval sub-loop via the sessionless
   * background task runtime (80-iteration cap, narrow tool face — §2.4/§2.5).
   * Returns the findings digest (null on failure — fail-open continues).
   */
  private async runEvidenceTopUp(sessionId: string, userTask: string, signal?: AbortSignal): Promise<string | null> {
    try {
      const result = await this.runBackgroundLlmTask({
        skill: DEPTH_LANE_SKILL_TAG,
        profile: "review",
        prompt: `Gather the MISSING evidence needed for a multi-path deliberation of this task. Read the relevant files and search as needed, then summarize ONLY what you found (facts, constraints, numbers) — no recommendations.\n\nTask:\n${userTask}`,
        signal,
      });
      const content = typeof result.content === "string" ? result.content.trim() : "";
      if (content) {
        this.addSessionSystemMessage(sessionId, `深度车轨 S1.5 补充检索完成（${result.iterations} 轮）。`);
      }
      return content || null;
    } catch (error) {
      if (this.isAbortLikeError(error)) throw error;
      return null; // fail-open — the staged flow continues on the S1 evidence
    }
  }

  /** Compact digest of the S1-compiled context for staged-flow prompts. */
  private buildEvidenceDigest(sessionId: string, state: DepthRunState): string {
    const parts: string[] = [];
    const messages = this.listSessionMessages(sessionId);
    const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
    if (lastAssistant?.content) {
      parts.push(`First-pass analysis:\n${lastAssistant.content}`);
    }
    if (state.topUpEvidence) {
      parts.push(`Supplementary evidence:\n${state.topUpEvidence}`);
    }
    return parts.join("\n\n").slice(0, DIGEST_MAX_CHARS) || "(no evidence gathered)";
  }

  // ── S2 分歧生成 ─────────────────────────────────────────────────────────────

  /**
   * K divergence paths: the MAIN session contributes one stance via a single
   * aux call; K−1 silent subagents (runSubagent silent:true, zero residue)
   * carry the remaining stances. K=1 is the serial degeneration (S3 skipped).
   */
  private async runDivergence(
    sessionId: string,
    userTask: string,
    k: number,
    state: DepthRunState,
    signal?: AbortSignal
  ): Promise<DepthPath[]> {
    const stances =
      k >= 2
        ? [
            "乐观（optimist）：主张积极推进，寻找最大化收益的路径",
            "保守（conservative）：主张最小化不可逆风险，寻找可回退的路径",
          ]
        : ["中立（neutral）：平衡推进与风险的路径"];
    const evidenceDigest = this.buildEvidenceDigest(sessionId, state);
    const adversarialFeedback = state.redTeam
      ? `Previous-round red-team findings to answer (do NOT repeat the broken paths):\n${formatRedTeamForPrompt(state.redTeam)}`
      : undefined;

    const paths: DepthPath[] = [];
    for (let index = 0; index < stances.length; index += 1) {
      this.throwIfAborted(signal);
      const stance = stances[index]!;
      const prompt =
        this.renderLaneFragment(
          { kind: "divergence", stance, userTask, evidenceDigest },
          fallbackDivergencePrompt(stance, userTask, evidenceDigest)
        ) + (adversarialFeedback ? `\n\n${adversarialFeedback}` : "");
      if (index === 0) {
        // Main-session path: one aux call on the background LLM.
        const parsed = await this.callDepthLlmJson(prompt, signal);
        if (parsed) {
          paths.push(normalizeDepthPath(parsed, stance));
        }
      } else {
        // Silent subagent path: zero residue (deleted on completion).
        const result = await this.runSubagent({ skill: DEPTH_LANE_SKILL_TAG, prompt, silent: true });
        const content = typeof result.content === "string" ? result.content : "";
        const parsed = parseFirstJsonObject(content);
        if (parsed) {
          paths.push(normalizeDepthPath(parsed, stance));
        }
      }
    }
    return paths;
  }

  // ── S3 对抗测试 ─────────────────────────────────────────────────────────────

  /** ONE red-team subagent over the K candidates (P2.1). Null = fail-open skip. */
  private async runRedTeam(userTask: string, paths: DepthPath[], signal?: AbortSignal): Promise<RedTeamFinding | null> {
    if (paths.length === 0) return null;
    // Pre-flight the boundary so an abort does not burn the subagent run.
    this.throwIfAborted(signal);
    const candidatesDigest = paths
      .map((p, i) => `[${i + 1}] ${p.stance}\n${p.path}\nAssumptions: ${p.keyAssumptions.join("; ")}`)
      .join("\n\n");
    const prompt = this.renderLaneFragment(
      { kind: "red-team", userTask, candidatesDigest },
      fallbackRedTeamPrompt(userTask, candidatesDigest)
    );
    try {
      const result = await this.runSubagent({ skill: DEPTH_LANE_SKILL_TAG, prompt, silent: true });
      const content = typeof result.content === "string" ? result.content : "";
      const parsed = parseFirstJsonObject(content);
      if (!parsed) return null;
      return {
        brokenPaths: stringArrayOf(parsed.brokenPaths),
        ignoredConstraints: stringArrayOf(parsed.ignoredConstraints),
        irreversibleRisks: stringArrayOf(parsed.irreversibleRisks),
        verdict: typeof parsed.verdict === "string" ? parsed.verdict : null,
      };
    } catch (error) {
      if (this.isAbortLikeError(error)) throw error;
      return null; // fail-open — S4 fuses without adversarial input
    }
  }

  // ── S4 融合校准 ─────────────────────────────────────────────────────────────

  /** Single orchestration fusion call. Null on failure → S5 reports 未收敛. */
  private async runFusion(
    userTask: string,
    state: DepthRunState,
    signal?: AbortSignal
  ): Promise<FusionJudgment | null> {
    if (state.paths.length === 0) return null;
    const pathsDigest = state.paths
      .map(
        (p, i) =>
          `[${i + 1}] ${p.stance} (confidence ${p.confidence})\n${p.path}\nAssumptions: ${p.keyAssumptions.join("; ")}`
      )
      .join("\n\n");
    const prompt = this.renderLaneFragment(
      {
        kind: "fusion",
        userTask,
        pathsDigest,
        adversarialDigest: state.redTeam ? formatRedTeamForPrompt(state.redTeam) : undefined,
        round: state.round,
      },
      fallbackFusionPrompt(userTask, pathsDigest, state.round)
    );
    const parsed = await this.callDepthLlmJson(prompt, signal);
    if (!parsed) return null;
    return {
      judgment: typeof parsed.judgment === "string" ? parsed.judgment : "",
      confidence: clampConfidence(parsed.confidence),
      disagreements: stringArrayOf(parsed.disagreements),
      keyAssumptions: stringArrayOf(parsed.keyAssumptions),
      risks: stringArrayOf(parsed.risks),
      nextSteps: stringArrayOf(parsed.nextSteps),
    };
  }

  /**
   * The staged flow's strict-JSON aux call: background LLM, thinking off,
   * ≤ 1 content-level retry, transport failure → null (fail-open). Billed to
   * the usage ledger as source "depth-lane" so the staged flow's cost is
   * visible per design §2.5.
   */
  private async callDepthLlmJson(prompt: string, signal?: AbortSignal): Promise<Record<string, unknown> | null> {
    this.throwIfAborted(signal);
    const { client, baseURL, debugLogEnabled, model } = this.createBackgroundLlm();
    if (!client) return null;
    for (let attempt = 0; attempt <= DEPTH_CONTENT_RETRY_BUDGET; attempt += 1) {
      try {
        const response = await this.createChatCompletionStream(
          client,
          {
            model,
            temperature: 0.2,
            max_tokens: 2048,
            messages: [
              {
                role: "system",
                content:
                  "You are a deep-deliberation stage of a coding agent. Respond with EXACTLY the JSON object requested — no prose, no markdown fences.",
              },
              { role: "user", content: prompt },
            ],
            response_format: { type: "json_object" },
            ...buildThinkingRequestOptions(false, baseURL, "max", model),
          },
          signal ? { signal } : undefined,
          undefined,
          {
            enabled: debugLogEnabled,
            location: "SessionManager.runDepthLane",
            baseURL,
            params: { purpose: "depth-lane", model, attempt },
          },
          { source: "depth-lane" }
        );
        const content = response.choices?.[0]?.message?.content;
        if (typeof content !== "string" || !content.trim()) continue; // content-level
        const parsed = parseFirstJsonObject(content);
        if (parsed) return parsed;
        // unparseable JSON — content-level, retry within budget
      } catch (error) {
        if (this.isAbortLikeError(error)) throw error;
        return null; // transport-level — no retry here
      }
    }
    return null;
  }

  // ── S5 判定输出 ─────────────────────────────────────────────────────────────

  /**
   * The depth decision report: reuses the `<proposed_plan>` block contract
   * shape (renderer already special-cases it), 结论先行 at the top. The
   * irreversibility arbitration point (P2.1's user gate) is the red-team's
   * irreversible-risk list surfaced at the TOP of 风险与红线 — the staged flow
   * only PRODUCES a report, so flagging there is the honest v1 arbitration
   * (nothing irreversible executes inside the lane itself).
   */
  /**
   * S5 output (2026-09-05 redesign, user ask): the deep lane is an INTERNAL
   * execution strategy — routing adjudicates quick vs deep, multi-path
   * deliberation runs backstage — but the DELIBERATION RESULTS are part of
   * the answer the user reads. No <proposed_plan> wrapper, no formal
   * "decision report" artifact: the fusion judgment leads as the answer,
   * followed by the multi-path comparison, key risks and next steps as
   * well-structured markdown. Renders through the normal markdown pipeline.
   */
  private emitDepthAnswer(sessionId: string, userTask: string, state: DepthRunState): void {
    const fusion = state.fusion;
    const now = new Date().toISOString();

    let answer: string;
    if (fusion?.judgment) {
      answer = fusion.judgment;
    } else if (state.paths.length > 1) {
      const pathSummary = state.paths
        .map((p) => `- **${p.stance.split("（")[0]}**：${p.path.slice(0, 200)}（置信度 ${p.confidence}%）`)
        .join("\n");
      answer = `经过多路推演，各方尚未完全收敛，以下是各条路线的结论与依据，供你综合判断：\n\n${pathSummary}`;
    } else {
      answer = state.paths[0]?.path ?? "深度推演未能产出结论，请重试或补充信息。";
    }

    if (state.paths.length > 1) {
      answer += `\n\n**推演路径对比：**\n${state.paths
        .map((p) => {
          const stance = p.stance.split("（")[0];
          const assumptions = p.keyAssumptions
            .slice(0, 2)
            .map((a) => a.slice(0, 80))
            .join("；");
          return `- **${stance}**（置信度 ${p.confidence}%）— ${p.path.slice(0, 160)}${assumptions ? `\n  前提：${assumptions}` : ""}`;
        })
        .join("\n")}`;
      if (fusion?.disagreements.length) {
        answer += `\n\n**分歧点：**\n${fusion.disagreements.map((d) => `- ${d}`).join("\n")}`;
      }
    }

    const irreversible = state.redTeam?.irreversibleRisks ?? [];
    const otherRisks = fusion?.risks ?? state.paths[0]?.risks ?? [];
    if (irreversible.length > 0) {
      answer += `\n\n⚠️ **不可逆操作 — 需要你确认后再执行：**\n${irreversible.map((r) => `- ${r}`).join("\n")}`;
    }
    if (otherRisks.length > 0) {
      answer += `\n\n**风险提示：**\n${otherRisks.map((r) => `- ${r}`).join("\n")}`;
    }

    if (fusion?.nextSteps.length) {
      answer += `\n\n**建议的下一步：**\n${fusion.nextSteps.map((st, i) => `${i + 1}. ${st}`).join("\n")}`;
    }

    if (!state.converged && fusion?.judgment) {
      answer += "\n\n（注：多路推演未完全收敛，以上为基于现有证据的最佳判断，关键决策建议保留人工复核。）";
    }

    const message = this.buildAssistantMessage(sessionId, answer, null);
    this.appendSessionMessage(sessionId, message);
    this.onAssistantMessage(message, true);
    this.updateSessionEntry(sessionId, (entry) => ({
      ...entry,
      status: "completed",
      failReason: null,
      updateTime: now,
    }));

    // Auto-register to the task trajectory (user ask 2026-09-05): every deep
    // run IS a task — the multi-path deliberation record belongs in the task
    // tree automatically, not behind a manual button. Best-effort: a broken
    // tree store must never fail the answer itself.
    try {
      const svc = this.getTaskTreeService();
      if (svc) {
        const userTaskShort = userTask.slice(0, 120) || "Deep run";
        const treeId = svc.createTree(userTaskShort, {
          why: "Deep run auto-registration (multi-path deliberation)",
          branchName: "deep",
        });
        if (treeId) {
          svc.bindSession(treeId, "deep", sessionId);
          // Append the deliberation outcome as a step node so the trajectory
          // carries the paths/confidence/risks without the user doing anything.
          svc.appendStep(treeId, {
            title: answer.slice(0, 120) || "Deliberation result",
            why: state.converged
              ? `Converged after ${state.round} round(s); ${state.paths.length} path(s).`
              : `Unconverged after ${state.round} round(s); see answer for per-path views.`,
            artifactRefs: [],
          });
          // Stamp the session entry so the session tree / history view can
          // find the trajectory (same taskRef contract as manual task flows).
          this.updateSessionEntry(sessionId, (entry) => ({
            ...entry,
            taskRef: { treeId, branch: "deep", nodeId: treeId },
            updateTime: now,
          }));
        }
      }
    } catch {
      // fail-open — the answer is already delivered; trajectory is best-effort
    }
  }
}

// ── Pure helpers (module-private, unit-testable shape) ──────────────────────

/** Convergence: normalized confidence spread (max − min) strictly below 15. */
function isConverged(paths: DepthPath[]): boolean {
  if (paths.length < 2) return true; // K=1 serial degeneration is trivially converged
  const confidences = paths.map((p) => p.confidence);
  return Math.max(...confidences) - Math.min(...confidences) < DEPTH_LANE_CONVERGENCE_SPREAD;
}

function clampConfidence(value: unknown): number {
  const raw = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : NaN;
  if (Number.isNaN(raw)) return 50;
  return Math.max(0, Math.min(100, raw));
}

/** Strict-ish array-of-strings extraction for staged-flow JSON fields. */
function stringArrayOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, 5);
}

function normalizeDepthPath(parsed: Record<string, unknown>, stance: string): DepthPath {
  return {
    stance,
    path: typeof parsed.path === "string" && parsed.path.trim() ? parsed.path.trim() : "(empty path)",
    confidence: clampConfidence(parsed.confidence),
    keyAssumptions: stringArrayOf(parsed.keyAssumptions),
    risks: stringArrayOf(parsed.risks),
  };
}

/** Extract the first balanced JSON object from a (possibly fenced/prose-wrapped) string. */
function parseFirstJsonObject(content: string): Record<string, unknown> | null {
  const trimmed = content.trim();
  const asObject = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  const direct = asObject(tryParseJson(trimmed));
  if (direct) return direct;
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) {
    const parsed = asObject(tryParseJson(fenced[1].trim()));
    if (parsed) return parsed;
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const parsed = asObject(tryParseJson(trimmed.slice(start, end + 1)));
    if (parsed) return parsed;
  }
  return null;
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function formatRedTeamForPrompt(redTeam: RedTeamFinding): string {
  const lines: string[] = [];
  if (redTeam.brokenPaths.length > 0) lines.push(`Broken paths: ${redTeam.brokenPaths.join("; ")}`);
  if (redTeam.ignoredConstraints.length > 0)
    lines.push(`Ignored constraints: ${redTeam.ignoredConstraints.join("; ")}`);
  if (redTeam.irreversibleRisks.length > 0) lines.push(`Irreversible risks: ${redTeam.irreversibleRisks.join("; ")}`);
  if (redTeam.verdict) lines.push(`Verdict: ${redTeam.verdict}`);
  return lines.join("\n") || "(no findings)";
}

// ── Inline prompt fallbacks (template-unreadable fail-open path) ─────────────

function fallbackDivergencePrompt(stance: string, userTask: string, evidenceDigest: string): string {
  return (
    `You are one independent reasoning path in a multi-path deliberation. Stance: ${stance}.\n\n` +
    `User task:\n${userTask}\n\nEvidence so far:\n${evidenceDigest}\n\n` +
    `Respond with EXACTLY one JSON object: {"path": "...", "confidence": <0-100>, "keyAssumptions": ["..."], "risks": ["..."]}`
  );
}

function fallbackRedTeamPrompt(userTask: string, candidatesDigest: string): string {
  return (
    `You are the red-team adversary. Break the candidate paths, do not improve them.\n\n` +
    `User task:\n${userTask}\n\nCandidates:\n${candidatesDigest}\n\n` +
    `Respond with EXACTLY one JSON object: {"brokenPaths": ["..."], "ignoredConstraints": ["..."], "irreversibleRisks": ["..."], "verdict": "survivors|all-broken"}`
  );
}

function fallbackFusionPrompt(userTask: string, pathsDigest: string, round: number): string {
  return (
    `You are the orchestrator fusing deliberation results (round ${round}).\n\n` +
    `User task:\n${userTask}\n\nCandidates:\n${pathsDigest}\n\n` +
    `Respond with EXACTLY one JSON object: {"judgment": "...", "confidence": <0-100>, "disagreements": ["..."], "keyAssumptions": ["..."], "risks": ["..."], "nextSteps": ["..."]}`
  );
}
