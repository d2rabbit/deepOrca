/**
 * WikiCliController — desktop Adapter for WikiController.
 *
 * Spawns the vendored `openwiki` CLI (LangChain DeepAgents app). The CLI
 * lives at `packages/desktop/vendor/openwiki/dist/cli.js` with its own
 * isolated node_modules (187MB — kept vendored to avoid pulling @langchain/*
 * into DeepOrca's dependency graph).
 *
 * LLM credentials ride the "openai-compatible" provider env keys
 * (OPENAI_COMPATIBLE_API_KEY / OPENAI_COMPATIBLE_BASE_URL + OPENWIKI_PROVIDER)
 * so the CLI speaks Chat Completions against gateway endpoints — the bare
 * OPENAI_* keys resolve to the "openai" provider, which pins the Responses
 * API and whose gateway shims can drop a turn's function_call item (see the
 * attemptEnv comment in run()). Language is derived from the app locale and
 * passed via the `--language` CLI flag so wiki pages are generated in the
 * user's language.
 *
 * The --print flag is used to get structured output (progress + result) on
 * stdout instead of the interactive TUI.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execFileSync } from "node:child_process";
import type { WikiController, WikiResult, ControllerProgress, SpawnTrackedResult } from "@deeporca/core";
import { getSerenaController, spawnTracked } from "@deeporca/core";
import { readWikiCompletionMarker } from "./wiki-marker";
import {
  recoverOrphanedStage,
  hasWikiStore,
  discardStage,
  copyStoreToStage,
  promoteStage,
  WIKI_STORE_DIR,
} from "./wiki-staging";

const CONNECTOR_CONFIG_DIR = path.join(os.homedir(), ".openwiki", "connectors", "custom-mcp");
const CONNECTOR_CONFIG_FILE = path.join(CONNECTOR_CONFIG_DIR, "config.json");
const SERENA_CONNECTOR_DIR = path.join(os.homedir(), ".openwiki", "connectors", "serena-mcp");
const SERENA_CONNECTOR_FILE = path.join(SERENA_CONNECTOR_DIR, "config.json");

/**
 * Hard cap on one wiki run. The CLI's --print mode buffers ALL stdout until
 * exit, so a wedged child is indistinguishable from a slow one for the whole
 * run — without a cap the build spinner can run forever (real-machine report:
 * "half an hour and wiki still not done"). Default 60 min; override with
 * DEEPORCA_WIKI_TIMEOUT_MS (milliseconds).
 */
const WIKI_TIMEOUT_MS = Number(process.env.DEEPORCA_WIKI_TIMEOUT_MS ?? "") || 60 * 60 * 1000;

/**
 * Count .md pages under <root>/openwiki modified since `sinceMs`. openwiki
 * writes pages incrementally while its agent works, so mtimes are the only
 * REAL progress signal available mid-run — the heartbeat surfaces this count
 * ("已生成 N 个页面") instead of a bare elapsed timer. Returns -1 when the
 * tree can't be read (early init, permission error).
 */
function countRecentWikiPages(root: string, sinceMs: number): number {
  const stack: string[] = [path.join(root, "openwiki")];
  let count = 0;
  try {
    // Guard bounds the walk: openwiki trees are tens of dirs, not millions.
    for (let guard = 0; stack.length > 0 && guard < 2000; guard++) {
      const dir = stack.pop();
      if (!dir) break;
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        if (ent.name.startsWith(".")) continue;
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) stack.push(p);
        else if (ent.isFile() && ent.name.endsWith(".md")) {
          try {
            if (fs.statSync(p).mtimeMs >= sinceMs) count++;
          } catch {
            // File raced away mid-stat — ignore.
          }
        }
      }
    }
    return count;
  } catch {
    return -1;
  }
}

/**
 * Content-weight threshold separating a real topic page from a hollow one:
 * healthy pages run 3-5KB+ (non-git probe 2026-08-28), a frontmatter-only
 * skeleton is <100B. Exit codes and completion markers both lie (exit 0 +
 * status "complete" over a 37-byte skeleton, real-machine 2026-08-28) —
 * content weight is the only trustworthy "did it produce anything" signal.
 * Kept in sync with hasExistingWikiArtifacts (core index-build) and the
 * status page counter (main knowledgeStatus), same 512B line everywhere.
 */
const SUBSTANTIAL_PAGE_BYTES = 512;

/** Substantial wiki topic pages currently on disk (always-written index.md
 *  excluded; thin frontmatter-only files don't count) — the "did the run
 *  actually produce anything" check. */
function countSubstantialWikiPages(root: string): number {
  try {
    const dir = path.join(root, "openwiki");
    let count = 0;
    const stack = [dir];
    while (stack.length > 0) {
      const d = stack.pop()!;
      for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, ent.name);
        if (ent.isDirectory()) stack.push(p);
        else if (ent.isFile() && ent.name.endsWith(".md") && ent.name !== "index.md") {
          try {
            if (fs.statSync(p).size > SUBSTANTIAL_PAGE_BYTES) count++;
          } catch {
            // File raced away mid-stat — ignore.
          }
        }
      }
    }
    return count;
  } catch {
    return 0;
  }
}

/** Does the repo have at least one commit? The wiki generator leans on git
 *  history (its first narrated step); a repo with an unborn HEAD starves it
 *  into writing only the bare skeleton — deterministic, and user-fixable by
 *  committing, so the failure hint must say THAT, not "change model". */
function repoHasCommits(root: string): boolean {
  try {
    execFileSync("git", ["-C", root, "rev-parse", "--verify", "HEAD"], { stdio: "ignore", windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate the completion marker's gitHead before an update run; delete the
 * marker when it is garbage. Exported for the wiki-marker guard test.
 *
 * The update prompt drives the agent with `git log <gitHead>..HEAD`; a head
 * that isn't a commit SHA (the no-git-init era recorded git's ERROR TEXT
 * there, real-machine 2026-08-28) makes every one of those commands fail and
 * the update no-ops while reporting success — the wiki silently rots. With
 * the marker gone, the prompt's documented fallback kicks in ("If no prior
 * gitHead exists, inspect recent history selectively"). Returns true when a
 * healing deletion happened.
 */
export function ensureSaneWikiMarker(root: string): boolean {
  const markerPath = path.join(root, "openwiki", ".last-update.json");
  try {
    const parsed = JSON.parse(fs.readFileSync(markerPath, "utf-8")) as { gitHead?: unknown };
    const head = parsed.gitHead;
    if (typeof head === "string" && /^[0-9a-f]{40}$/i.test(head.trim())) return false;
    fs.rmSync(markerPath, { force: true });
    return true;
  } catch {
    // Absent or unparsable — the "no marker" path is already the sane one.
    return false;
  }
}

export class WikiCliController implements WikiController {
  constructor(
    private opts: {
      vendorEntry: string;
      nodeRunner: string;
      electronRunAsNode?: boolean;
      getProjectRoot?: () => string;
      getLlmCreds?: () => { apiKey?: string; baseURL?: string; model?: string };
      /** Auxiliary model creds (settings → 辅助模型). When the primary model's
       *  LLM stream dies mid-generation, the automatic retry switches here —
       *  gateway stream limits are often model/channel specific, so the same
       *  model would hit the same wall. */
      getAuxLlmCreds?: () => { apiKey?: string; baseURL?: string; model?: string } | null;
      getLanguage?: () => string | undefined;
    }
  ) {}

  isAvailable(): boolean {
    try {
      return fs.statSync(this.opts.vendorEntry).isFile();
    } catch {
      return false;
    }
  }

  async init(root: string, onProgress?: (p: ControllerProgress) => void): Promise<WikiResult> {
    return this.serialized(root, async () => {
      this.configureCodegraphConnector(root);
      this.configureSerenaConnector(root);
      // Staging lifecycle (see wiki-staging.ts): the CLI only ever writes the
      // disposable openwiki/ stage; a validated stage is promoted into the
      // canonical deepwiki/ store. A legacy openwiki/ (pre-staging era, no
      // store yet) is adopted as the store; a stage orphaned while a store
      // already exists is crash debris and discarded per the documented
      // "rm stage → init" step (review round 4: init used to run the CLI over
      // the leftover mixture).
      if (!recoverOrphanedStage(root)) discardStage(root);
      let result: WikiResult;
      try {
        result = await this.run("init", root, onProgress);
      } catch (err) {
        discardStage(root);
        throw err;
      }
      // Promote OUTSIDE the catch (review round 7 — the round-6 fix landed on
      // update() but init() was missed): if promote itself throws (rename
      // fails after the store rm), the validated stage is the ONLY remaining
      // copy — it must survive for recoverOrphanedStage to re-promote.
      promoteStage(root);
      discardStage(root);
      return result;
    });
  }

  /** True when the store marker's gitHead equals the repo HEAD AND the
   *  working tree is clean — the CLI's commit-diff update has nothing to do.
   *  CHEAP GATE (3142ee25 premise: auto-sync calls update() after EVERY
   *  mutating turn; without this each call pays rm + full store copy + spawn). */
  private noChangeFastPath(root: string): boolean {
    try {
      const markerRaw = JSON.parse(fs.readFileSync(path.join(root, WIKI_STORE_DIR, ".last-update.json"), "utf-8")) as {
        gitHead?: unknown;
      };
      const head = markerRaw.gitHead;
      if (typeof head !== "string" || !/^[0-9a-f]{40}$/i.test(head)) return false;
      const dirty = execFileSync("git", ["-C", root, "status", "--porcelain"], {
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
      }).toString();
      if (dirty.trim().length > 0) return false;
      const current = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
      })
        .toString()
        .trim();
      return current.toLowerCase() === head.toLowerCase();
    } catch {
      return false;
    }
  }

  /**
   * Per-root lifecycle mutex (review round 4): the staging steps
   * (discard/copy/promote) are unserialized rm/rename chains — two
   * overlapping runs on the same root could interleave into "store deleted,
   * stage raced away, catch discards the stage" = BOTH gone. Overlap is real:
   * the auto-sync hook fires update() fire-and-forget and bypasses the build
   * job manager's dedup. Serialize all controller runs per root in-process.
   */
  private readonly rootRuns = new Map<string, Promise<unknown>>();
  private async serialized<T>(root: string, body: () => Promise<T>): Promise<T> {
    const prev = this.rootRuns.get(root) ?? Promise.resolve();
    const run = prev.then(body, body);
    // The stored chain is always-settled so the NEXT caller never inherits a
    // rejection; deletion is by the stored promise's identity.
    const settled = run.then(
      () => undefined,
      () => undefined
    );
    this.rootRuns.set(root, settled);
    try {
      return await run;
    } finally {
      if (this.rootRuns.get(root) === settled) this.rootRuns.delete(root);
    }
  }

  async update(root: string, onProgress?: (p: ControllerProgress) => void): Promise<WikiResult> {
    // No canonical store → FAIL FAST, never fall back to init here (review
    // round 4): the no-store fallback looked like it served the build button,
    // but the AUTO-SYNC hook (maybeSyncWikiIndex) also calls update()
    // fire-and-forget after every file-mutating agent turn — with the
    // fallback, any wiki-less project silently launched a full multi-minute
    // LLM generation on an ordinary edit. The build flow routes init itself
    // (index-build's hasExistingWikiArtifacts); a direct update on a
    // store-less project gets an actionable error instead.
    if (!hasWikiStore(root)) {
      throw new Error("no canonical deepwiki/ store — run a full build (wiki.init) first");
    }
    // CHEAP no-change gate BEFORE any mutex/staging cost (3142ee25 premise —
    // auto-sync fires after EVERY mutating turn): clean tree + marker already
    // documents HEAD → the CLI's commit-diff has nothing to do. Skip all.
    if (this.noChangeFastPath(root)) {
      onProgress?.({
        message:
          "wiki update: git HEAD 未变化且工作区干净，跳过增量运行 / no changes since the last documented commit — skipped",
      });
      return { ok: true };
    }
    return this.serialized(root, async () => {
      this.configureCodegraphConnector(root);
      this.configureSerenaConnector(root);
      // Stage a COPY of the canonical store: the update mutates only the copy,
      // so a bad run (hollow exit, dialect drop, moderation kill) can never
      // damage the last-known-good wiki.
      discardStage(root);
      copyStoreToStage(root);
      // The update prompt drives the agent with `git log <marker.gitHead>..HEAD`.
      // A garbage head (the no-git era recorded git's ERROR TEXT there,
      // real-machine 2026-08-28) makes every such command fail and the agent
      // no-ops — the wiki silently goes stale while builds keep "succeeding".
      // Healing = deleting the STAGE's marker (the store keeps its own until
      // promotion): the prompt then takes its documented "no prior gitHead"
      // branch (selective full-history pass).
      const healed = ensureSaneWikiMarker(root);
      if (healed) {
        onProgress?.({
          message: `wiki update: 检测到无效的 .last-update.json（gitHead 非法），已重置增量基线 / invalid completion marker reset`,
        });
      }
      let result: WikiResult;
      try {
        result = await this.run("update", root, onProgress);
      } catch (err) {
        discardStage(root);
        throw err;
      }
      // Same promote-outside-catch rule as init: if promote itself throws,
      // the validated stage is the ONLY remaining copy — it must survive for
      // recoverOrphanedStage to re-promote (review round 6, total-loss window).
      promoteStage(root);
      // openwiki/ is a TEMP stage (user directive 2026-08-30: 生成后只保留
      // deepwiki) — sweep any residue the CLI's exit path recreated.
      discardStage(root);
      return result;
    });
  }

  /**
   * The CLI's code-mode ingestion drops a GitHub Actions scheduler
   * (.github/workflows/openwiki-update.yml) into every repo it runs in — a
   * parallel updater that writes openwiki/ directly (bypassing the deepwiki
   * store), carries a stale provider env block baked at generation time, and
   * opens PRs touching AGENTS.md/CLAUDE.md. The desktop app IS the update
   * driver here, so the stage lifecycle deletes the scheduler the run just
   * dropped. A PRE-EXISTING file (git-tracked in projects that opted into
   * the scheduled refresh) is left alone — review round 4: the unconditional
   * delete silently dirtied tracked trees.
   */
  private cleanCodeModeArtifacts(root: string, preexisting: boolean): void {
    if (preexisting) return;
    try {
      const wf = path.join(root, ".github", "workflows", "openwiki-update.yml");
      if (fs.existsSync(wf)) fs.rmSync(wf, { force: true });
      const wfDir = path.join(root, ".github", "workflows");
      try {
        if (fs.existsSync(wfDir) && fs.readdirSync(wfDir).length === 0) fs.rmdirSync(wfDir);
      } catch {
        // not empty / raced — leave it
      }
    } catch {
      // never fatal
    }
  }

  /**
   * Write OpenWiki connector config so the wiki agent can consume CodeGraph MCP
   * as a knowledge source during wiki generation. Only writes when:
   *   1. A `.codegraph/` index exists in the project (stage 1 completed).
   *   2. CodeGraph's npm-shim.js is resolvable.
   * Non-fatal — wiki proceeds without CodeGraph context on any failure.
   */
  private configureCodegraphConnector(root: string): void {
    try {
      if (!fs.existsSync(path.join(root, ".codegraph"))) return;
      let shimPath: string;
      try {
        const pkgPath = require.resolve("@colbymchenry/codegraph/package.json");
        shimPath = path.join(path.dirname(pkgPath), "npm-shim.js");
        if (!fs.existsSync(shimPath)) return;
      } catch {
        return;
      }
      const config = {
        enabled: true,
        mode: "mcp-stdio",
        transport: {
          type: "stdio" as const,
          command: this.opts.nodeRunner,
          args: [shimPath, "serve", "--mcp"],
        },
        allowedTools: [
          "codegraph_explore",
          "codegraph_search",
          "codegraph_callers",
          "codegraph_callees",
          "codegraph_impact",
        ],
      };
      fs.mkdirSync(CONNECTOR_CONFIG_DIR, { recursive: true });
      fs.writeFileSync(CONNECTOR_CONFIG_FILE, JSON.stringify(config, null, 2), "utf8");
    } catch {
      // Non-fatal: wiki generation proceeds without CodeGraph context.
    }
  }

  /**
   * Write OpenWiki connector config for Serena MCP so the wiki agent can consume
   * Serena's symbol-level data (get_symbols_overview, find_symbol, find_referencing_symbols)
   * during wiki generation. Only writes when:
   *   1. A `.serena/` directory exists in the project.
   *   2. The SerenaController is injected and can build a server config.
   * Non-fatal — wiki proceeds without Serena context on any failure.
   */
  private configureSerenaConnector(root: string): void {
    try {
      if (!fs.existsSync(path.join(root, ".serena"))) return;
      const serenaController = getSerenaController();
      if (!serenaController) return;
      const serenaConfig = serenaController.buildMcpServerConfig(root);
      if (!serenaConfig) return;

      const config = {
        enabled: true,
        mode: "mcp-stdio",
        transport: {
          type: "stdio" as const,
          command: serenaConfig.command,
          args: serenaConfig.args,
        },
        env: serenaConfig.env ?? {},
        allowedTools: ["get_symbols_overview", "find_symbol", "find_referencing_symbols", "get_diagnostics_for_file"],
      };
      fs.mkdirSync(SERENA_CONNECTOR_DIR, { recursive: true });
      fs.writeFileSync(SERENA_CONNECTOR_FILE, JSON.stringify(config, null, 2), "utf8");
    } catch {
      // Non-fatal: wiki generation proceeds without Serena context.
    }
  }

  private async run(
    mode: "init" | "update",
    root: string,
    onProgress?: (p: ControllerProgress) => void
  ): Promise<WikiResult> {
    if (!this.isAvailable()) {
      throw new Error("OpenWiki is not bundled (vendor entry missing)");
    }

    const env: Record<string, string> = {};
    if (this.opts.electronRunAsNode) {
      env.ELECTRON_RUN_AS_NODE = "1";
    }

    // Inject LLM creds from project settings if available. NOTE: openwiki
    // reads OPENWIKI_MODEL_ID (not OPENWIKI_MODEL) — the wrong env name used
    // to leave the CLI on its built-in default model, which the configured
    // OpenAI-compatible endpoint (DeepSeek) rejects with a 400.
    const creds = this.opts.getLlmCreds?.();
    // Auxiliary model (settings → 辅助模型) for the stream-death retry below.
    // Usable only when actually configured, resolvable, and NOT the same
    // endpoint+model as the primary — switching to a twin would just hit the
    // same wall again.
    const auxCreds = this.opts.getAuxLlmCreds?.() ?? null;
    const auxUsable = Boolean(
      auxCreds &&
      auxCreds.model &&
      (auxCreds.apiKey || auxCreds.baseURL) &&
      (auxCreds.model !== (creds?.model ?? "") || auxCreds.baseURL !== creds?.baseURL)
    );

    // Use --print for structured non-interactive output (no TUI). Language is
    // a CLI flag (openwiki has no OPENWIKI_LANGUAGE env) so wiki pages are
    // generated in the user's language (BCP-47 from the app locale).
    const flag = mode === "init" ? "--init" : "--update";
    const args = [this.opts.vendorEntry, flag, "--print"];
    const lang = this.opts.getLanguage?.();
    if (lang) {
      args.push("--language", lang);
    }
    onProgress?.({ message: `wiki ${mode} started`, percent: 10 });

    // openwiki --print buffers ALL agent output and writes it at exit — during
    // a long run (10+ minutes on a large repo) stdout is completely silent.
    // The 20s heartbeat counts pages actually written so far from the
    // filesystem ("已生成 N 个页面" is real forward progress, not a ticking
    // timer) and watches openwiki's completion marker: .last-update.json with
    // status "complete" is the CLI's final act and authoritative even if the
    // process then hangs on exit — finishOk force-settles success then
    // (real-machine report: "wiki finished but the status never changed").
    let markerSeenAt = 0;
    let markerModel: string | undefined;

    // "terminated" (undici: connection aborted mid-stream) used to kill a
    // whole multi-minute generation with no recovery — the LLM gateway drops
    // long streams around the 5-minute mark (real-machine 2026-08-28: died
    // at 286s with minutes of work in flight). One automatic rerun: pages
    // are written incrementally, so a rerun either completes or fails with
    // the same localized hint — never worse than failing outright.
    const MAX_ATTEMPTS = 2;
    // Snapshot the code-mode workflow's pre-existence: the CLI regenerates
    // .github/workflows/openwiki-update.yml on every run, but a file that
    // existed BEFORE belongs to the project (git-tracked in some repos —
    // deleting it silently dirtied their trees; review round 4). Only the
    // copy THIS run dropped gets cleaned.
    const codeModeWorkflowPreexisting = fs.existsSync(path.join(root, ".github", "workflows", "openwiki-update.yml"));
    try {
      for (let attempt = 1; ; attempt++) {
        const startedAtMs = Date.now();
        markerSeenAt = 0;
        markerModel = undefined;

        // Attempt 1 runs the primary model; the retry (when the auxiliary
        // model is configured and distinct) switches to it.
        const switching = attempt > 1 && auxUsable;
        const active = switching ? auxCreds! : creds;
        const attemptEnv: Record<string, string> = { ...env };
        // Route through openwiki's "openai-compatible" provider (Chat
        // Completions), NOT the bare "openai" provider. Credential env
        // OPENAI_API_KEY resolves the provider to "openai", whose model factory
        // pins useResponsesApi=true — the CLI then speaks the Responses API,
        // and gateway SHIMS of that API can stream a first turn without its
        // function_call item (StepFun step_plan, real-machine 2026-08-29:
        // "I'll start by exploring…" text-only turn → LangGraph END → exit 0
        // in 4s, zero pages, repeatedly). The compatible provider defaults to
        // Chat Completions — the transport the app's own chat loop uses
        // against these endpoints all day — and OPENWIKI_PROVIDER pins the
        // resolution explicitly so stray OPENAI_* keys can't flip it back.
        // OPENWIKI_MODEL_ID is provider-independent (resolveModelId).
        if (active?.apiKey) attemptEnv.OPENAI_COMPATIBLE_API_KEY = active.apiKey;
        if (active?.baseURL) attemptEnv.OPENAI_COMPATIBLE_BASE_URL = active.baseURL;
        attemptEnv.OPENWIKI_PROVIDER = "openai-compatible";
        // 继承主模型 (2026-08-30): the model id always comes from settings —
        // the primary for attempt 1, the explicitly-configured auxiliary for
        // the retry. No hardcoded fallback: an unfunded default model once
        // hijacked the retry and failed it with 402. No model at all is a
        // fail-closed configuration error, not a reason to guess.
        if (!active?.model) {
          // Config error, not a hollow run — verbatim text only; the wiki-empty
          // hint's fix copy ("try another model") would mislead here.
          throw new Error("wiki: no LLM model configured (settings → model) — cannot run");
        }
        attemptEnv.OPENWIKI_MODEL_ID = active.model;

        let result: SpawnTrackedResult;
        try {
          result = await spawnTracked({
            label: `wiki ${mode}`,
            command: this.opts.nodeRunner,
            args,
            cwd: root,
            env: attemptEnv,
            timeoutMs: WIKI_TIMEOUT_MS,
            heartbeatMs: 20_000,
            onHeartbeat: ({ elapsedSecs, finishOk }) => {
              const marker = readWikiCompletionMarker(root, startedAtMs - 5000);
              if (marker?.status === "complete") {
                if (markerSeenAt === 0) {
                  markerSeenAt = Date.now();
                  markerModel = marker.model;
                  onProgress?.({ message: `wiki ${mode} 完成标记已收到（status: complete），等待 CLI 退出…` });
                } else if (Date.now() - markerSeenAt > 60_000) {
                  // Work is DONE and recorded; only the exit is wedged (typically
                  // pipe-inherited MCP connector children). Force-finish success —
                  // a hung exit must never mask a completed wiki. Bilingual
                  // progress lines (zh · en) — the console shows both, matching
                  // the build pipeline's bilingual contract.
                  onProgress?.({
                    message: `wiki ${mode} 退出卡住超过 60s，强制结束，构建按完成处理 / exit stuck >60s — force-killed, treated as complete`,
                  });
                  finishOk("完成标记已确认，强制结束卡住的退出 / completion marker confirmed, stuck exit force-killed");
                }
                return null;
              }
              const pages = countRecentWikiPages(root, startedAtMs - 5000);
              const pageText = pages >= 0 ? ` · 已生成 ${pages} 页 / ${pages} pages written` : "";
              onProgress?.({
                message:
                  `wiki ${mode} 运行中 ${elapsedSecs}s / running ${elapsedSecs}s${pageText}` +
                  " · 读取符号索引加速生成，LLM 阶段无进度流请耐心等待 / using the symbol index, no LLM progress stream",
              });
              return null;
            },
            onStdoutLine: (line) => onProgress?.({ message: `wiki: ${line.slice(0, 120)}` }),
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (message.includes("超时")) {
            // Fix hint rides along as a machine-readable token — the renderer's
            // build-error formatter translates it into the UI locale (main has
            // no i18n runtime; see renderer/lib/build-error.ts).
            throw new Error(`${message} [hint:wiki-timeout]`);
          }
          throw err;
        }

        if (result.forcedOk || result.code === 0 || markerSeenAt > 0) {
          // A clean exit that produced ZERO substantial pages is not a success
          // — it is the signature of an agent whose tool calls never landed
          // (LangChain × /responses dialect mismatch, real-machine 2026-08-28:
          // exit 0 in 6s with an empty skeleton index), or of a hollow run that
          // wrote only frontmatter-only stubs. Content weight decides — exit
          // codes and "complete" markers both lie. Covers update too (same
          // date: an update over a skeleton-only dir exited 0 in 14s
          // "successfully").
          // Mode-scoped (review round 4): in UPDATE mode the stage was
          // pre-seeded from the store, so a TOTAL page count can never be zero
          // — the guard below was structurally dead there. Strict hollow-run
          // protection applies to INIT (stage built from nothing); UPDATE
          // instead measures what THIS run wrote (zero new pages over a real
          // store is a legitimate no-change pass, not a hollow run).
          const hollowRun =
            mode === "init"
              ? countSubstantialWikiPages(root) === 0
              : countRecentWikiPages(root, startedAtMs - 5000) === 0 && !markerSeenAt;
          if (hollowRun && mode === "init") {
            // Stochastic LLM/gateway flake, not a deterministic error — one
            // automatic retry (aux model when configured and distinct) beats
            // bouncing the user back to the build button (real-machine
            // 2026-08-29: three consecutive hollow exits, then a clean full
            // run on the fourth identical spawn).
            if (attempt < MAX_ATTEMPTS) {
              onProgress?.({
                message:
                  `wiki ${mode} 空跑（exit 0 但零实质页面），自动重试` +
                  (auxUsable ? `（切换辅助模型 ${auxCreds?.model}）` : "") +
                  ` / hollow run (exit 0, zero pages) — retrying`,
              });
              continue;
            }
            const hint = repoHasCommits(root) ? "wiki-empty" : "wiki-git";
            throw new Error(`openwiki finished without any substantive wiki pages [hint:${hint}]`);
          }
          if (mode === "update" && hollowRun) {
            onProgress?.({
              message: `wiki update 无新页面且无完成标记（可能是空跑，已按现状推进）/ update wrote nothing new and no completion marker — possibly hollow, promoted as-is`,
            });
          }
          const exitNote =
            result.forcedOk || (result.code !== 0 && markerSeenAt > 0)
              ? `（${result.forcedNote ?? "完成标记已确认 / completion marker confirmed"}）`
              : "";
          // The CLI records status "interrupted" when its run is cut short
          // (gateway content moderation 451 on the final pass, real-machine
          // 2026-08-29): topic pages are already on disk — the build succeeds —
          // but the landing page may be an unfinalized skeleton. Say so; the
          // next incremental build (marker gitHead is valid) completes it.
          let warning: string | undefined;
          const finalMarker = readWikiCompletionMarker(root, startedAtMs - 5000);
          if (finalMarker?.status === "interrupted") {
            warning =
              "wiki run was interrupted late (likely gateway content moderation) — pages were written, the landing page may be unfinalized; the next incremental build completes it";
            onProgress?.({
              message: `wiki ${mode} 后段中断（页面已产出，落地页未收尾，下次构建增量补全）/ run interrupted late — next build finalizes`,
            });
          }
          onProgress?.({ message: `wiki ${mode} complete${exitNote}`, percent: 100 });
          // Try to parse model from stdout output (--print mode).
          const modelMatch = result.stdout.match(/model[:\s]+([^\s,]+)/i);
          return { ok: true, model: markerModel ?? modelMatch?.[1] ?? attemptEnv.OPENWIKI_MODEL_ID, warning };
        }

        // Audit 2026-08-26: a bare "openwiki exited 1: terminated" was
        // unactionable — "terminated" is LangChain's network-error pattern
        // (undici connection aborted). The localized fix hint (model +
        // settings pointers; secrets never printed) is embedded as a
        // structured token the renderer translates — a second-stage
        // translation, because the LLM itself may be what's broken.
        const stderrMsg = result.stderr ? result.stderr.slice(0, 500) : "";
        // "Request timed out." is the OpenAI SDK's request-level timeout
        // (APIConnectionTimeoutError) — as transient as a mid-stream cut, and
        // the pattern the 2026-08-28 failure actually shipped with.
        const netFail =
          /^(terminated|fetch failed|Request timed out|Network request failed|The Internet connection appears to be offline)/i.test(
            result.stderr.trimStart()
          );
        if (netFail && attempt < MAX_ATTEMPTS) {
          onProgress?.({
            message: switching
              ? `wiki ${mode} 网络中断（LLM 流被断开），自动切换辅助模型 ${auxCreds?.model} 重试 / network drop — retrying on auxiliary model`
              : `wiki ${mode} 网络中断（LLM 流被断开），自动重试 / network drop — retrying (${attempt}/${MAX_ATTEMPTS - 1})`,
          });
          continue;
        }
        const modelId = attemptEnv.OPENWIKI_MODEL_ID;
        // 402 / "Insufficient Balance" is a DETERMINISTIC account state, not a
        // transient failure — retrying cannot help. Surface it loudly: the
        // signature also feeds the renderer's model-fault dialog, and the
        // hint token carries a bilingual fix pointer (real-machine
        // 2026-08-30: an unfunded auxiliary model failed silently).
        const balanceFail = /\b402\b|insufficient balance/i.test(result.stderr);
        if (balanceFail) {
          throw new Error(
            `openwiki exited ${result.code}: LLM account has insufficient balance (model ${modelId}) — ` +
              `top up the endpoint or switch models in settings / 余额不足，请充值或在设置中更换模型 ` +
              `[hint:wiki-balance model=${modelId}]${stderrMsg ? ` · ${stderrMsg.slice(0, 200)}` : ""}`
          );
        }
        const hint = netFail ? ` [hint:wiki-network${modelId ? ` model=${modelId}` : ""}]` : "";
        throw new Error(
          `openwiki exited ${result.code}${result.signal ?? ""}${stderrMsg ? `: ${stderrMsg}` : ""}${hint}`
        );
      }
    } finally {
      this.cleanCodeModeArtifacts(root, codeModeWorkflowPreexisting);
    }
  }
}
