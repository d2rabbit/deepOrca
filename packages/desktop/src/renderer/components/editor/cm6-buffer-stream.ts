// Buffer stream — the AI edit state machine driving the decoration domain
// (specs/editor-copilot B1, visual draft D4/D5/D10). One instance per
// workspace owns a run:
//
//   idle → streaming (del ghost first, then amber pending rows replayed at
//          a human cadence until the real chunk bridge lands in批次 C)
//        → review   (red ghost / green adds / hunk chip widget)
//        → applied  (decorations cleared, checkpoint recorded; ⌘Z rolls back)
//
// Every buffer write goes through the kernel's single view, so the undo
// stack covers each AI transaction — undo after apply IS the「整体回滚」.

import { Decoration, type DecorationSet, type EditorView } from "@codemirror/view";
import { RangeSet, type Range } from "@codemirror/state";

import { aiTransaction } from "./cm6-kernel";

import { api } from "../../api";
import { addAi, aiField, clearAi, pendingLineRanges, reviewRanges, setAi } from "./cm6-deco";
import { lineDiffGroups, spliceGroups, type DiffGroup } from "./cm6-diff";
import { languageIdForFile } from "./language-map";

export type PairPhase = "idle" | "streaming" | "review" | "applied";

export type PairStage = {
  /** Plan step currently running: 0 理解 / 1 方案 / 2 写入 / 3 验证. */
  step: number;
  /** Streaming row progress. */
  written: number;
  total: number;
};

export type PairRunResult = {
  content: string;
  /** First non-a2ui fenced block = replacement code for the selection. */
  code: string | null;
  /** ```a2ui fence = clarify form payload. */
  a2ui: string | null;
};

export type BufferStreamEvents = {
  onPhase(phase: PairPhase, detail?: { error?: string; clarify?: string; result?: PairRunResult }): void;
  onStage(stage: PairStage): void;
  /** Fired when an apply lands — the checkpoint strip appends a node; the
   *  post-apply content snapshot rides along for click-to-rollback (D10). */
  onCheckpoint(atIso: string, content: string, file: string): void;
  /** Live ±N statistics for the lane and the review bar. */
  onStats(stats: { added: number; removed: number }): void;
  /** Review-time diff groups (2026-09-06: 多 hunk 审阅) — ordered
   *  same/change runs between the original selection and the AI replacement;
   *  the review bar derives hunk navigation + the preview from them. */
  onHunks(groups: DiffGroup[]): void;
};

/** Live-stream flush cadence — coalesces chunk deltas into one txn. */
const STREAM_FLUSH_MS = 90;

export class BufferStream {
  private phase: PairPhase = "idle";
  /**
   * Root fixes (audit B1/B2/B3/B4/B7, 2026-09-05):
   * - insert tracking lives in the DECORATION set (kind "add"/"pending" line
   *   decorations auto-map through every transaction), never in raw line
   *   numbers — discard/excise always resolves the live span.
   * - docGeneration guard: a setDoc swap mid-run aborts the run instead of
   *   writing rows into the swapped-in document.
   * - the whole run preamble is guarded; every early exit resets the phase.
   * - flushTimer is an instance field so reset()/dispose() really cancels it.
   * - re-running while in review settles the previous block first.
   */
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private fileOfRun: string | null = null;
  /** Exact rows of the current review block — content identity for excise. */
  private reviewRows: string[] | null = null;
  /** Rows already streamed into the buffer (pre-finishReview). Excise falls
   *  back to these while the block has not settled into review — otherwise
   *  error/clarify/no-code/discard paths could never remove streamed rows. */
  private streamedRows: string[] = [];
  private offProgress: (() => void) | null = null;
  private locked = false;
  private generationAtStart = 0;
  /** Review diff state (2026-09-06 多 hunk): original selection rows, the
   *  selection's start line, the LCS groups vs the AI replacement, and the
   *  per-hunk accept decisions (default: all accepted). */
  private origLines: string[] | null = null;
  private selStartLine = 0;
  private reviewGroups: DiffGroup[] | null = null;
  private hunkAccepted: boolean[] = [];
  /** Monotonic run identity (root fix 2026-09-06): every async continuation
   *  of run() carries its own token and dies when it no longer matches — a
   *  stale invoke resolving AFTER discard/rollback/apply (or a newer run)
   *  can no longer write rows, steal the lock or overwrite decorations. */
  private runSeq = 0;

  constructor(
    private readonly view: () => EditorView | null,
    private readonly events: BufferStreamEvents,
    /** Doc-generation clock (kernel.docGeneration) — the B2 guard. */
    private readonly generation: () => number = () => 0,
    /** Lock hook (kernel.setReadOnly) — B6: canvas read-only while streaming. */
    private readonly lock: (flag: boolean) => void = () => {},
    /** File the kernel currently shows — the C4 apply/rollback guard. */
    private readonly currentFile: () => string | null = () => null
  ) {}

  get currentPhase(): PairPhase {
    return this.phase;
  }

  /** Opaque phase read — defeats TS's narrowing of `this.phase` across the
   *  mutating setPhase calls inside run() (the guard comparisons are real). */
  private isStreaming(): boolean {
    return this.phase === "streaming";
  }

  /** Launch a run against the current selection (visual draft D3→D4). */
  async run(opts: {
    file: string;
    selection: { text: string; startLine: number; endLine: number };
    instruction: string;
    /** Clarify-round answers (visual draft D12) — appended to the prompt. */
    clarification?: string;
    /** D11 context chips payload (@file lines) — forwarded to the agent. */
    extraContext?: string;
  }): Promise<void> {
    const view = this.view();
    if (!view || this.phase === "streaming") return;
    // B7: a previous block still awaiting review is settled first — its
    // decorations drive the excise, so nothing orphans in the buffer.
    if (this.phase === "review") this.discard();
    this.reset();
    // C2: allocate THIS run's token AFTER the reset bump — any continuation
    // still in flight from an older run now fails its identity check.
    const myRun = ++this.runSeq;
    this.fileOfRun = opts.file;
    this.setPhase("streaming");
    this.events.onStage({ step: 0, written: 0, total: 0 });
    this.generationAtStart = this.generation();
    this.lock(true);
    this.locked = true;

    // B3: the sync preamble (line lookups on a possibly-stale selection)
    // throws on out-of-range rows — settle to idle instead of wedging.
    let from: number;
    let to: number;
    let ghostRows: number;
    try {
      const doc = view.state.doc;
      const startLine = Math.min(Math.max(1, opts.selection.startLine), doc.lines);
      const endLine = Math.min(Math.max(startLine, opts.selection.endLine), doc.lines);
      // A stale selection pointing outside the doc is a hard error, not a
      // clamp — silently re-targeting it would ghost the wrong rows.
      if (startLine !== opts.selection.startLine || endLine !== opts.selection.endLine) {
        throw new Error("selection out of range (stale)");
      }
      from = doc.line(startLine).from;
      to = doc.line(endLine).to;
      ghostRows = endLine - startLine + 1;
      // Multi-hunk review: remember the exact original rows + their anchor —
      // the diff and the apply-time splice are computed against them.
      this.selStartLine = startLine;
      this.origLines = [];
      for (let no = startLine; no <= endLine; no += 1) this.origLines.push(doc.line(no).text);
    } catch (error) {
      this.unlock();
      this.setPhase("idle", { error: error instanceof Error ? error.message : String(error) });
      return;
    }
    // Ghost the outgoing rows before anything streams in — the replacement
    // intent is visible from the first pending row on. (The ghost is actually
    // dispatched at the streaming preamble below, right after the decoration
    // domain resets — a dispatch here would be wiped by that same reset.)
    this.events.onStats({ added: 0, removed: ghostRows });
    this.events.onStage({ step: 1, written: 0, total: 0 });

    let result: PairRunResult | null = null;

    // ── Chunk streaming (specs/editor-copilot C3) ──────────────────────────
    // Subscribe BEFORE the invoke: delta events start arriving while the
    // request is still in flight. Rows are parsed incrementally out of the
    // first non-a2ui code fence and flushed at a coalesced cadence; the
    // invoke's return value is authoritative for the final review state.
    // Run identity (root fix: explain + pair share this broadcast channel):
    // the renderer mints the runId, main echoes it on every event, and any
    // foreign run's deltas (a concurrent explain) are dropped here — the
    // old runSeq-only guard let explain prose pour into the fence buffer.
    const myRunId = `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const insertLineNo = opts.selection.endLine + 1;
    // B5: a selection touching EOF has to === doc.length — inserting at
    // to+1 is out of bounds and would splice onto the last ghost row. Clamp
    // and prefix the first row with a newline so AI rows start on their own
    // line — but ONLY when the doc does not already end with a newline (an
    // explicit trailing \n already opens a fresh empty line; a second one
    // desynced the apply/finishReview row arithmetic by +1).
    const docLength = view.state.doc.length;
    const atEnd = to >= docLength;
    const insertFrom = Math.min(to + 1, docLength);
    this.events.onStage({ step: 2, written: 0, total: 0 });
    this.clearDecorations();
    this.markGhost(from, to);

    let pos = insertFrom;
    let firstRow = true;
    let inserted = 0;
    let buffer = "";
    let failed = false;
    // REAL first-row landing line (root fix, paired with the B5 newline
    // change): `insertLineNo` is a snapshot guess that is off by one when the
    // doc ends with a newline (rows land INSIDE the trailing empty ghost
    // line) — finishReview's add decorations must anchor where rows actually
    // went, or excise/apply refuse to recognize the block.
    let firstAddLine = insertLineNo;
    const insertRow = (row: string): void => {
      const v = this.view();
      if (!v || this.phase !== "streaming" || this.runSeq !== myRun) return;
      // B2: the document was swapped (tab switch) — abort, never write into
      // the new doc. Decorations died with the old state; nothing to excise.
      if (this.generation() !== this.generationAtStart) {
        this.cancelRun();
        return;
      }
      // B5 (root fix): only an at-EOF selection on a doc WITHOUT a trailing
      // newline needs the visual separator — see the preamble comment above.
      const prefix = firstRow && atEnd && docLength > 0 && !v.state.doc.toString().endsWith("\n") ? "\n" : "";
      firstRow = false;
      const rowStart = pos + prefix.length;
      v.dispatch({
        changes: { from: pos, insert: `${prefix}${row}\n` },
        effects: addAi.of(pendingLineRanges(pos + prefix.length)),
        // E1: AI rows carry the annotation — the kernel skips onDocChanged,
        // so the draft (and the 800ms auto-save behind it) stays clean until
        // apply() syncs the final content.
        annotations: aiTransaction.of(true),
      });
      pos += prefix.length + row.length + 1;
      inserted += 1;
      if (inserted === 1) {
        firstAddLine = v.state.doc.lineAt(Math.min(rowStart, v.state.doc.length)).number;
      }
      // C3: record what actually landed — excise during streaming has no
      // reviewRows yet and falls back to this list.
      this.streamedRows.push(row);
      this.events.onStats({ added: inserted, removed: ghostRows });
    };
    const flush = (): void => {
      this.flushTimer = null;
      if (this.phase !== "streaming" || this.runSeq !== myRun) return; // settled elsewhere (cancelRun)
      const fence = extractFirstFence(buffer);
      if (!fence) return;
      while (inserted < fence.rows.length && this.phase === "streaming") {
        const before = inserted;
        insertRow(fence.rows[inserted]!);
        if (inserted === before && this.phase !== "streaming") break; // guard fired → settled
        if (inserted === before) break; // no progress — never spin
      }
    };
    const scheduleFlush = (): void => {
      if (!this.flushTimer) this.flushTimer = setTimeout(flush, STREAM_FLUSH_MS);
    };
    this.offProgress = api.onEditorAgentProgress((ev) => {
      if (failed || this.runSeq !== myRun) return;
      if (ev.runId !== myRunId) return; // foreign run (concurrent explain) — never ours
      if (ev.phase === "delta" && ev.text) {
        buffer += ev.text;
        scheduleFlush();
      } else if (ev.phase === "iteration") {
        // C2b: a new agent round began — every round's chunks land in the
        // same progress stream, so rows already previewed belong to the
        // PREVIOUS round's response. Excise them and restart the preview
        // so the review block never splices two rounds' content.
        buffer = "";
        if (inserted > 0) {
          this.exciseAiRows();
          // The excised round's rows are gone from the doc — they MUST also
          // leave the content-identity multiset, or a later excise (error /
          // discard on this round) would keep scanning past the block for
          // text that matches the OLD rows and eat user lines below it.
          this.streamedRows = [];
          this.clearDecorations();
          this.markGhost(from, to);
          pos = insertFrom;
          inserted = 0;
          firstRow = true;
        }
      } else if (ev.phase === "error") {
        failed = true;
        this.offProgress?.();
        this.offProgress = null;
        this.cancelFlush();
        // C3: rows already streamed must not survive the failure — excise
        // BEFORE clearing the decorations (they anchor the block scan).
        this.exciseAiRows();
        this.clearDecorations();
        this.unlock();
        this.setPhase("idle", { error: ev.error ?? "editor agent failed" });
      }
    });

    let res: Awaited<ReturnType<typeof api.editorAgentRun>>;
    try {
      res = await api.editorAgentRun({
        filePath: opts.file,
        startLine: opts.selection.startLine,
        endLine: opts.selection.endLine,
        selection: opts.selection.text,
        instruction: opts.clarification?.trim()
          ? `${opts.instruction}\n\n[clarification round — answers from the A2UI form]\n${opts.clarification}`
          : opts.instruction,
        lang: languageIdForFile(opts.file),
        extraContext: opts.extraContext,
        runId: myRunId,
      });
    } catch (error) {
      this.cancelRun();
      this.setPhase("idle", { error: error instanceof Error ? error.message : String(error) });
      return;
    }
    // C2: the run may have been discarded/rolled back (or superseded) while
    // the invoke was in flight — a stale continuation must not unsubscribe
    // the NEW run's progress listener or write its rows into the buffer.
    if (this.runSeq !== myRun) return;
    if (this.offProgress) {
      this.offProgress();
      this.offProgress = null;
    }
    this.cancelFlush();
    if (failed) return; // error path already settled the phase
    // B2: the doc swapped while the invoke was in flight — the streamed rows
    // (if any) died with the old state; settle without touching the new doc.
    if (this.generation() !== this.generationAtStart) {
      this.cancelRun();
      this.setPhase("idle");
      return;
    }
    if (!res.ok) {
      this.exciseAiRows();
      this.clearDecorations();
      this.unlock();
      this.setPhase("idle", { error: res.error });
      return;
    }
    result = splitResult(res.content);

    // Clarify round (D12): no code fence yet — excise anything the stream
    // already wrote (partial misreads) and hand the a2ui payload back.
    if (result.a2ui && !result.code) {
      this.exciseAiRows();
      this.clearDecorations();
      this.unlock();
      this.setPhase("idle", { clarify: result.a2ui });
      return;
    }
    if (!result.code) {
      this.exciseAiRows();
      this.clearDecorations();
      this.unlock();
      this.setPhase("idle", { result });
      return;
    }

    const finalRows = result.code.replace(/\n$/, "").split("\n");
    this.events.onStage({ step: 2, written: inserted, total: finalRows.length });
    // Complete the block synchronously: whatever the event stream already
    // wrote stays; missing rows land now (also the fallback path when the
    // progress channel never fired — e.g. stubbed tests).
    let aborted = false;
    while (inserted < finalRows.length) {
      if (!this.isStreaming() || this.runSeq !== myRun) {
        aborted = true;
        break;
      }
      const before = inserted;
      insertRow(finalRows[inserted]!);
      if (inserted === before) {
        aborted = true; // insertRow's generation/identity guard refused the write
        break;
      }
    }
    if (aborted || !this.isStreaming()) {
      // Settle any state the guard paths left behind (unlock etc.) — the
      // phase may have moved to idle through rollback/discard already, so
      // cancelRun is a no-op there but guarantees the lock is released.
      this.cancelRun();
      return;
    }
    this.unlock();
    this.finishReview({ ghostFrom: from, ghostTo: to, insertLineNo: firstAddLine, rows: finalRows });
  }

  /** Abort an in-flight run (doc swap / unmount / invoke throw) and SETTLE
   *  the phase to idle — every guard path calling this is terminal (re-audit
   *  #2/#3 root fix: previously the phase stayed "streaming", so the flush
   *  loop spun forever and later runs were permanently rejected). */
  private cancelRun(): void {
    this.runSeq += 1; // kill every in-flight continuation of the current run
    this.cancelFlush();
    if (this.offProgress) {
      this.offProgress();
      this.offProgress = null;
    }
    this.clearDecorations();
    this.unlock();
    this.clearReviewRows();
    if (this.phase === "streaming") this.setPhase("idle");
  }

  private clearReviewRows(): void {
    this.reviewRows = null;
    this.streamedRows = [];
    this.reviewGroups = null;
    this.hunkAccepted = [];
    this.origLines = null;
    this.selStartLine = 0;
  }

  private cancelFlush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  private unlock(): void {
    if (this.locked) {
      this.locked = false;
      this.lock(false);
    }
  }

  /**
   * B1 root fix: resolve the AI block's LIVE span from the decoration set
   * (add/pending line decorations auto-map through every transaction, so
   * user edits above or inside never desync the excise). Removes exactly the
   * decorated rows — user rows are untouched.
   */
  private exciseAiRows(): void {
    const view = this.view();
    if (!view) return;
    const deco = view.state.field(aiField, false);
    if (!deco) return;
    // C3: the block's content identity may still be the STREAMED rows
    // (finishReview has not run) — error/clarify/no-code/Esc paths excise
    // from the live preview, not from the settled review block.
    const rows = this.reviewRows ?? this.streamedRows;
    // Re-audit #23 root rework (final form): when the user splits a
    // decorated line, CM6's TrackBefore mapping hands the decoration to the
    // user's new line and STRIPS it from the AI row — so neither decoration
    // alone nor decoration+content can identify the block. The decorations
    // still bracket it faithfully: resolve the block's LIVE bounds from the
    // first/last surviving add|pending decoration, then excise by CONTENT
    // identity within those bounds — a line goes only when its text matches
    // a not-yet-consumed recorded AI row. User rows inside the block whose
    // text differs survive regardless of which line inherited the mark.
    const remaining = new Map<string, number>();
    for (const row of rows) {
      remaining.set(row, (remaining.get(row) ?? 0) + 1);
    }
    // The block START anchor: the first surviving add|pending decoration
    // (the ghost del decorations mark the selection it replaced — both are
    // stable against edits INSIDE the block). The block END cannot use the
    // last decoration (the split edge strips it from the final AI row), so
    // the scan runs forward through the document consuming the content
    // multiset until it is exhausted — an AI row is recognized by TEXT even
    // after losing its decoration.
    let firstNo = -1;
    deco.between(0, view.state.doc.length, (from: number, _to: number, d: { spec?: { kind?: string } }) => {
      const kind = d.spec?.kind;
      if (firstNo >= 0 || (kind !== "add" && kind !== "pending")) return;
      firstNo = view.state.doc.lineAt(from).number;
    });
    if (firstNo < 0) return;
    const lines: Array<{ from: number; to: number }> = [];
    let left = rows.length;
    for (let no = firstNo; no <= view.state.doc.lines && left > 0; no += 1) {
      const line = view.state.doc.line(no);
      const budget = remaining.get(line.text) ?? 0;
      if (budget <= 0) continue; // user row interleaved into the block — survives
      remaining.set(line.text, budget - 1);
      left -= 1;
      lines.push({ from: line.from, to: no < view.state.doc.lines ? line.to + 1 : line.to });
    }
    if (lines.length === 0 || left > 0) {
      // Could not re-find every AI row (heavy user re-edit) — nothing safe
      // to excise; leave the buffer intact rather than guess.
      return;
    }
    view.dispatch({
      changes: lines,
      annotations: aiTransaction.of(true),
    });
  }

  /** Review state: del ghost + add lines + interactive hunk chip (D5). */
  private finishReview(span: { ghostFrom: number; ghostTo: number; insertLineNo: number; rows: string[] }): void {
    const view = this.view();
    if (!view) {
      // B3: the host unmounted mid-run — reset instead of wedging "streaming".
      this.cancelRun();
      this.setPhase("idle");
      return;
    }
    this.reviewRows = span.rows;
    // 多 hunk 审阅 (2026-09-06): split the (original selection ↔ replacement)
    // pair into same/change runs, publish them for the review bar (navigation
    // + preview), and default every change hunk to ACCEPTED.
    this.reviewGroups = lineDiffGroups(this.origLines ?? [], span.rows);
    this.hunkAccepted = this.reviewGroups.map((g) => g.type === "change");
    this.events.onHunks(this.reviewGroups);
    this.events.onStage({ step: 3, written: span.rows.length, total: span.rows.length });
    const addStarts: number[] = [];
    let pos = view.state.doc.line(Math.min(span.insertLineNo, view.state.doc.lines)).from;
    for (const row of span.rows) {
      addStarts.push(pos);
      pos += row.length + 1;
    }
    view.dispatch({
      effects: setAi.of(
        rangesToSet(
          reviewRanges({
            chipLabel: "hunk 1",
            chipAt: span.ghostFrom,
            onAccept: () => this.apply(),
            onReject: () => this.discard(),
            del: { from: span.ghostFrom, to: span.ghostTo },
            addLines: addStarts,
          })
        )
      ),
    });
    this.setPhase("review");
  }

  /**
   * C4 guard: a run/review belongs to ONE file AND one doc generation. If the
   * view now shows another file (or the buffer moved on), the block is stale —
   * settle to idle WITHOUT touching the current doc (its decorations died with
   * the swap; the same-content tab switch case is covered by the file check).
   * Returns true when the stale settle consumed the call.
   */
  private settleStale(): boolean {
    const fileOfRun = this.fileOfRun;
    if (!fileOfRun) return false;
    // Hosts that never inject a file provider (tests, minimal hosts) cannot
    // take part in the file comparison — the generation clock still guards
    // cross-document contamination there.
    const shownFile = this.currentFile();
    const fileMismatch = shownFile !== null && fileOfRun !== shownFile;
    if (!fileMismatch && this.generation() === this.generationAtStart) return false;
    // Same-content tab switches leave the kernel state (and the block's
    // decorations) alive — excise the stale rows before tearing the run
    // down, so nobody inherits a half-applied block. A generation mismatch
    // (real setDoc swap) has no decorations left in the new state — the
    // excise is an automatic no-op there.
    this.exciseAiRows();
    this.cancelRun();
    this.setPhase("idle");
    return true;
  }

  /** Accept: decorations settle, checkpoint recorded (D10).
   *  2026-09-06 root fix + 多 hunk: acceptance previously left BOTH the
   *  ghosted original rows and the AI rows in the buffer (only the
   *  decorations were cleared). Acceptance now SPLICES the region —
   *  accepted hunks contribute their new lines, rejected hunks keep the
   *  original lines, unchanged runs pass through — so the applied buffer is
   *  exactly the reviewed result. */
  apply(): void {
    const view = this.view();
    if (!view || this.phase !== "review") return;
    // C4: the review block must still belong to the visible document —
    // applying a stale block would record a cross-file checkpoint.
    if (this.settleStale()) return;
    const doc = view.state.doc;
    const origCount = this.origLines?.length ?? 0;
    const inserted = this.reviewRows?.length ?? 0;
    let content: string;
    if (this.reviewGroups && origCount > 0) {
      // Root fix (paired with exciseAiRows' B1 discipline): apply must never
      // splice by the run's SNAPSHOT line numbers — the canvas unlocks in
      // review, so user edits above the block shift it live. Resolve the
      // block's LIVE span from the decoration domain: the first add/pending
      // decoration anchors the AI rows, the original ghost rows sit exactly
      // origCount lines above it, and the block ends where the AI content
      // multiset is exhausted (identical identity discipline to excise).
      const rows = this.reviewRows ?? [];
      const deco = view.state.field(aiField, false);
      let firstAdd = -1;
      let blockStart = -1;
      deco?.between(0, doc.length, (from: number, _to: number, d: { spec?: { kind?: string } }) => {
        const kind = d.spec?.kind;
        if (firstAdd < 0 && (kind === "add" || kind === "pending")) firstAdd = doc.lineAt(from).number;
        if (blockStart < 0 && kind === "del") blockStart = doc.lineAt(from).number;
      });
      let startLine: number;
      let endLine: number;
      if (firstAdd > 0) {
        // Block start = the LIVE ghost (del) anchor — NOT arithmetic against
        // firstAdd: when the doc ends with a newline the first AI row lands
        // INSIDE the trailing empty ghost line (same line number), so
        // `firstAdd - origCount` would reach above the block.
        startLine = blockStart >= 0 ? blockStart : Math.max(1, firstAdd - origCount); // no del deco left — arithmetic fallback
        const remaining = new Map<string, number>();
        for (const row of rows) remaining.set(row, (remaining.get(row) ?? 0) + 1);
        let left = rows.length;
        let lastNo = firstAdd - 1;
        for (let no = Math.max(firstAdd, startLine); no <= doc.lines && left > 0; no += 1) {
          const text = doc.line(no).text;
          const budget = remaining.get(text) ?? 0;
          if (budget <= 0) continue; // user row interleaved into the block — survives
          remaining.set(text, budget - 1);
          left -= 1;
          lastNo = no;
        }
        if (left > 0) {
          // Could not re-find every AI row (heavy user re-edit) — nothing
          // safe to splice; stay in review rather than guess.
          return;
        }
        endLine = lastNo;
      } else {
        // No live anchor left (a split edge stripped every add mark) — fall
        // back to the snapshot arithmetic. Off-by-one root fix: the block
        // spans [startLine .. startLine + origCount + inserted - 1]; the old
        // `+inserted` (no -1) swallowed the user line right after the block.
        startLine = Math.max(1, Math.min(this.selStartLine, doc.lines));
        endLine = Math.min(startLine + origCount + inserted - 1, doc.lines);
      }
      const from = doc.line(startLine).from;
      const to = doc.line(endLine).to;
      const replacement = spliceGroups(this.reviewGroups, this.hunkAccepted);
      view.dispatch({
        changes: { from, to, insert: replacement.join("\n") },
        annotations: aiTransaction.of(true),
      });
      content = view.state.doc.toString();
    } else {
      // Degraded path (no diff state — e.g. stubbed legacy flows): keep the
      // previous settle semantics.
      content = doc.toString();
      view.dispatch({ effects: clearAi.of(null) });
    }
    this.clearReviewRows();
    this.setPhase("applied");
    this.events.onCheckpoint(new Date().toISOString(), content, this.fileOfRun ?? "");
  }

  /** Per-hunk decision (review bar ✓/✕). Index = the i-th change hunk. */
  setHunkDecision(index: number, accepted: boolean): void {
    if (index >= 0 && index < this.hunkAccepted.length) this.hunkAccepted[index] = accepted;
  }

  hunkDecisions(): ReadonlyArray<boolean> {
    return this.hunkAccepted;
  }

  /** D10 rollback: restore a checkpoint's post-apply snapshot (AI-annotated
   *  so the draft gate stays closed — the workspace syncs after settling). */
  rollbackTo(content: string): void {
    const view = this.view();
    if (!view) return;
    // C2b/M3: a rollback is terminal for any in-flight run — the token bump
    // kills its continuation, the lock is released, pending rows and the
    // decoration domain are torn down before the doc is replaced. (The
    // workspace routes checkpoints to their owning file first, so the write
    // always targets the checkpoint's doc — including cross-file stale runs.)
    this.runSeq += 1;
    this.cancelFlush();
    if (this.offProgress) {
      this.offProgress();
      this.offProgress = null;
    }
    this.clearReviewRows();
    this.clearDecorations();
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: content },
      annotations: aiTransaction.of(true),
    });
    view.dispatch({ effects: clearAi.of(null) });
    this.unlock();
    // Re-audit #20: rolling back settles the state machine from ANY active
    // phase (review/streaming left a stale ReviewBar; applied left the
    // run-level "done" state while the buffer just moved backwards).
    if (this.phase !== "idle") this.setPhase("idle");
  }

  /** Reject / discard (Esc): excise the decorated AI block (B1 — the live
   *  decoration span, not stale line numbers), restore the buffer. */
  discard(): void {
    const view = this.view();
    if (!view) {
      this.setPhase("idle");
      return;
    }
    if (this.settleStale()) return;
    this.runSeq += 1; // kill the in-flight run's continuation (C2)
    if (this.phase === "review" || this.phase === "streaming") {
      this.exciseAiRows();
    }
    view.dispatch({ effects: clearAi.of(null) });
    this.unlock();
    this.setPhase("idle");
  }

  /** Hard reset without buffer surgery (error paths / unmount). */
  reset(): void {
    this.runSeq += 1;
    this.cancelFlush();
    if (this.offProgress) {
      this.offProgress();
      this.offProgress = null;
    }
    this.unlock();
    // Root fix (run() calls this right after a discard): the PREVIOUS run's
    // review state must not survive into the new one — a stale reviewRows
    // multiset would win the `reviewRows ?? streamedRows` fallback in
    // exciseAiRows and delete the OLD run's row texts out of the NEW run's
    // error/discard path.
    this.clearReviewRows();
  }

  dispose(): void {
    this.reset();
  }

  private markGhost(from: number, to: number): void {
    const view = this.view();
    if (!view) return;
    view.dispatch({
      effects: addAi.of([ghostLine(from), ghostMark(from, to)]),
    });
  }

  private clearDecorations(): void {
    this.view()?.dispatch({ effects: clearAi.of(null) });
  }

  private setPhase(phase: PairPhase, detail?: { error?: string; clarify?: string; result?: PairRunResult }): void {
    this.phase = phase;
    this.events.onPhase(phase, detail);
  }
}

/* ── decoration builders (ordering per cm6-deco header: line BEFORE mark) ── */

function ghostLine(pos: number): Range<Decoration> {
  return Decoration.line({ class: "ui-cm6-del-line", kind: "del" }).range(pos);
}
function ghostMark(from: number, to: number): Range<Decoration> {
  return Decoration.mark({ class: "ui-cm6-del", kind: "del" }).range(from, to);
}
function rangesToSet(ranges: Range<Decoration>[]): DecorationSet {
  return RangeSet.of(ranges, true);
}

/**
 * Incrementally extract complete rows from the first non-a2ui code fence in
 * a streaming buffer (spec C3): returns closed=false while the fence is still
 * open, with only the rows that are certainly complete (trailing partial row
 * dropped). Null before any fence opens.
 */
export function extractFirstFence(buffer: string): { rows: string[]; closed: boolean } | null {
  // B8 hardening: tolerate CRLF fences and an UNCLOSED a2ui block that
  // precedes the code fence. The old lazy strip could swallow the code
  // fence's opening backticks when the a2ui block never closed; stripping
  // line-wise from the a2ui opener to the first ``` line bounds the damage.
  const lines = buffer.split(/\r?\n/);
  const filtered: string[] = [];
  let skippingA2ui = false;
  for (const line of lines) {
    if (!skippingA2ui && /^```a2ui\s*$/.test(line.trim())) {
      skippingA2ui = true;
      continue;
    }
    if (skippingA2ui) {
      const t = line.trim();
      if (/^```[a-zA-Z0-9+#._-]/.test(t)) {
        // A LANGUAGE-tagGED fence while skipping: the a2ui block was never
        // closed — this line is the CODE fence opener, keep it (B8: the old
        // lazy strip swallowed exactly this case).
        skippingA2ui = false;
        filtered.push(line);
        continue;
      }
      if (/^```$/.test(t)) {
        skippingA2ui = false; // the a2ui block's own closer
      }
      continue;
    }
    filtered.push(line);
  }
  // H2: normalize CRLF (and stray \r) before line math — splitResult and the
  // review multiset both expect LF rows, otherwise the excise content-identity
  // lookup fails on CRLF replies.
  const noA2ui = filtered.join("\n").replace(/\r\n/g, "\n").replace(/\r/g, "");
  // Line-anchored opener (re-audit #15): fences start at a line boundary and
  // may carry trailing whitespace before the newline; mid-line backticks no
  // longer false-match. Character set widened for c++/c#/f#/objc++ (M8).
  const open = noA2ui.match(/(^|\n)```[a-zA-Z0-9+#._-]*[ \t]*\r?\n/);
  if (!open || open.index === undefined) return null;
  const openAt = open.index + open[1]!.length;
  const body = noA2ui.slice(openAt + open[0].length - open[1]!.length);
  const close = body.indexOf("\n```");
  if (close >= 0) return { rows: body.slice(0, close).split("\n"), closed: true };
  const rows = body.split("\n");
  rows.pop(); // trailing partial row
  // Empty fence body (immediate close) → closed with no rows (B8: avoids the
  // stray empty pending line AND reports closure correctly).
  if (rows.length === 0 || (rows.length === 1 && rows[0] === "")) {
    return { rows: [], closed: body.trim() === "```" };
  }
  return { rows, closed: false };
}

/** Split an editor-agent reply into prose / code fence / a2ui fence.
 *  H2: CRLF replies are normalized first so the fence regexes (which anchor
 *  the language tag against a bare \n) never fail on "\r\n" line endings. */
export function splitResult(content: string): PairRunResult {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "");
  // Fence grammar MUST mirror extractFirstFence exactly (root fix): the
  // opener is anchored to a line boundary and the closer must sit at a line
  // start — a mid-line ``` no longer closes the block. The old lazy
  // anywhere-``` closer could terminate the fence EARLIER than the streaming
  // extractor ever would, desyncing the streamed rows from finalRows and
  // breaking the excise content-identity multiset (orphan rows after discard).
  const fences = [...normalized.matchAll(/(^|\n)```([a-zA-Z0-9+#._-]*)[ \t]*\n([\s\S]*?)\n```/g)];
  const codeHit = fences.find((f) => (f[2] ?? "") !== "a2ui");
  const a2uiHit = normalized.match(/(^|\n)```a2ui[ \t]*\n([\s\S]*?)\n```/);
  return {
    content,
    code: codeHit ? (codeHit[3] ?? "").replace(/\n$/, "") : null,
    a2ui: a2uiHit ? (a2uiHit[2] ?? "").trim() : null,
  };
}
