import { useCallback, useEffect, useLayoutEffect, useRef, useState, type JSX, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { EditorView } from "@codemirror/view";

import { useI18n } from "../../i18n";
import { A2uiSurface } from "../../a2ui/A2uiSurface";
import { extractSurfaceId, getSurfaceModel } from "../../a2ui/processor";
import type { Cm6KernelHandle, Cm6SelectionInfo } from "./cm6-kernel";
import type { BufferStream, PairStage } from "./cm6-buffer-stream";
import { PAIR_PLAN_STEP_KEYS } from "./pair-i18n";

type Props = {
  file: string;
  kernel: RefObject<Cm6KernelHandle | null>;
  selection: Cm6SelectionInfo;
  stream: BufferStream;
  phase: "idle" | "streaming" | "review" | "applied";
  stage: PairStage;
  instruction: string;
  onInstructionChange(text: string): void;
  error: string | null;
  clarify: string | null;
  onDismissError(): void;
  /** A pending clarificaion round (the ✕ while the a2ui form is up). */
  onDismissClarify?(): void;
  /** 「解释」 intent → floating card; never rewrites the buffer. */
  onExplain?(): void;
  /** Controlled open state — the workspace owns the ⌘I toggle. */
  open: boolean;
  onClose(): void;
  /** 「到会话」旁路（注入主会话流式执行）— 沿用旧浮窗语义。 */
  onAskAgent?: (prompt: string) => void;
  /** Open workspace files for the D11 @file context chips. */
  openFiles: string[];
};

/**
 * Inline pair bar (specs/editor-copilot B3, visual draft D3/D4/D6/D11/D12):
 * anchored under the selection inside the editor host, portal-rendered so
 * the workspace chrome never clips it. Owns the intent input, quick-intent
 * chips, the streaming plan readout and the A2UI clarify form.
 */
export function PairBar({
  file,
  kernel,
  selection,
  stream,
  phase,
  stage,
  instruction,
  onInstructionChange,
  error,
  clarify,
  onDismissError,
  onDismissClarify,
  onExplain,
  open,
  onClose,
  onAskAgent,
  openFiles,
}: Props): JSX.Element | null {
  const { t } = useI18n();
  const barRef = useRef<HTMLDivElement | null>(null);
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null);
  // D11: context chips — each adds an @file line to the extraContext payload.
  const [ctxFiles, setCtxFiles] = useState<string[]>([]);
  const [ctxMenuOpen, setCtxMenuOpen] = useState(false);
  const extraContext = ctxFiles.length > 0 ? ctxFiles.map((f) => `@file ${f}`).join("\n") : undefined;

  const submit = useCallback((): void => {
    const text = instruction.trim();
    if (!text || !selection || phase === "streaming") return;
    onInstructionChange(text);
    void stream.run({ file, selection, instruction: text, extraContext });
  }, [instruction, selection, phase, stream, file, onInstructionChange, extraContext]);

  const submitClarify = useCallback(
    (answers: string): void => {
      if (!selection) return;
      void stream.run({
        file,
        selection,
        instruction: instruction.trim() || "继续",
        clarification: answers,
        extraContext,
      });
    },
    [stream, file, selection, instruction, extraContext]
  );

  // Re-anchor below the selection end (audit P1/P2 root fix):
  // - lineBlockAt works off the heightmap, so it is valid even when the
  //   coordsAtPos path returns null (line outside the viewport / layout not
  //   measured) — the bar never disappears or rides a stale anchor.
  // - the anchor tracks the SCROLLER (the element that actually scrolls),
  //   recomputed on a rAF-throttled scroll event instead of the non-scrolling
  //   host's (always-zero) scrollTop.
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  const recompute = useCallback((): void => {
    const view: EditorView | null = kernel.current?.view ?? null;
    const sel = selectionRef.current;
    if (!view || !sel) return;
    const line = view.state.doc.line(Math.min(sel.endLine, view.state.doc.lines));
    const host = view.dom.closest(".ui-editor-cm6-host") as HTMLElement | null;
    if (!host) return;
    const hostRect = host.getBoundingClientRect();
    const scrollerRect = view.scrollDOM.getBoundingClientRect();
    const block = view.lineBlockAt(line.from);
    // Viewport Y of the line's bottom — heightmap-based, valid whether or
    // not the line is currently rendered.
    const bottom = scrollerRect.top + block.top - view.scrollDOM.scrollTop + block.height;
    const top = Math.min(Math.max(bottom - hostRect.top + 6, 8), Math.max(8, host.clientHeight - 120));
    setAnchor((prev) => (prev && prev.top === top ? prev : { left: 64, top }));
  }, [kernel]);

  useLayoutEffect(() => {
    if (!open || !selection) return;
    recompute();
  }, [open, selection, kernel, recompute]);

  // Re-anchor while the user scrolls (rAF-throttled).
  useEffect(() => {
    if (!open || !selection) return;
    const view: EditorView | null = kernel.current?.view ?? null;
    if (!view) return;
    let scheduled = false;
    const onScroll = (): void => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        recompute();
      });
    };
    view.scrollDOM.addEventListener("scroll", onScroll);
    return () => view.scrollDOM.removeEventListener("scroll", onScroll);
  }, [open, selection, kernel, recompute]);

  // Re-audit #12: the ＋上下文 menu closes on any outside pointerdown —
  // previously only re-clicking ＋ or picking a file closed it.
  useEffect(() => {
    if (!ctxMenuOpen) return;
    const close = (e: PointerEvent): void => {
      if (!(e.target as HTMLElement | null)?.closest?.(".ui-edpair-ctxmenu, .ui-edpair-chip.add")) {
        setCtxMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [ctxMenuOpen]);

  // Re-audit #19: Esc inside the bar during a stream ABORTS the run (same
  // affordance as the canvas Esc) instead of merely hiding the bar and
  // leaving a locked read-only stream with no visible cancel.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      const target = e.target as HTMLElement | null;
      if (target?.closest?.(".ui-edpair-bar")) {
        e.stopPropagation();
        if (phase === "streaming" || phase === "review") stream.discard();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose, phase, stream]);

  if (!open || !selection) return null;

  const host = kernel.current?.view.dom.closest(".ui-editor-cm6-host") as HTMLElement | null;
  if (!host || !anchor) return null;

  const quickIntents: Array<{ label: string; text: string; onPick?: () => void }> = [
    // 解释 → floating card (2026-09-06 user ask): explanation NEVER rewrites
    // the buffer; 重构/优化它 stay on the inline rewrite path. 补测试/文档
    // were removed from the inline agent — multi-file asks ride the main
    // session (「到会话」 / the lane composer).
    {
      label: t("editor.pair.intent.explain"),
      text: t("editor.pair.intent.explain.prompt"),
      onPick: onExplain,
    },
    { label: t("editor.pair.intent.refactor"), text: t("editor.pair.intent.refactor.prompt") },
    // D6/D12 trigger: the deliberately-vague intent — the agent answers with
    // an a2ui clarify form instead of guessing.
    { label: t("editor.pair.intent.optimize"), text: t("editor.pair.intent.optimize.prompt") },
  ];

  return createPortal(
    <div ref={barRef} className="ui-edpair-bar" style={{ left: anchor.left, top: anchor.top }}>
      <div className="ui-edpair-head">
        <span className="ui-edpair-title">
          ✦ {t("editor.pair.title")} <span className="mono">{file.split(/[\\/]/).pop()}</span> L{selection.startLine}
          {selection.endLine !== selection.startLine ? `–${selection.endLine}` : ""}
        </span>
        <button
          type="button"
          className="ui-edpair-close"
          onClick={() => {
            // A pending clarify round must not linger in lane state after the
            // bar closes — the next ⌘I would show a stale form (D12).
            if (clarify) onDismissClarify?.();
            onClose();
          }}
          aria-label={t("common.close")}
        >
          ✕
        </button>
      </div>

      {clarify ? (
        <div className="ui-edpair-clarify">
          <div className="q">
            <span className="ic">◈</span>
            <span>{t("editor.pair.clarify.title")}</span>
          </div>
          <A2uiSurface
            messagesJson={clarify}
            surfaceId={extractSurfaceId(clarify) ?? undefined}
            onAction={(_sid, action) => {
              if (action !== "submit") return;
              const sid = extractSurfaceId(clarify) ?? "";
              const model = getSurfaceModel(sid);
              const answers: Record<string, unknown> = {};
              for (const key of ["answer", "choice", "value", "text", "input"]) {
                const v = model?.dataModel.get(key);
                if (v !== undefined && v !== "") answers[key] = v;
              }
              submitClarify(JSON.stringify(answers));
            }}
          />
        </div>
      ) : phase === "streaming" ? (
        <div className="ui-edpair-plan">
          {PAIR_PLAN_STEP_KEYS.map((key, i) => (
            <span key={key} className={`ui-edpair-step ${i < stage.step ? "done" : i === stage.step ? "doing" : ""}`}>
              <span className="dot">{i < stage.step ? "✓" : i + 1}</span>
              {t(key)}
            </span>
          ))}
          {stage.total > 0 ? (
            <span className="ui-edpair-live mono">
              {t("editor.pair.written", { written: String(stage.written), total: String(stage.total) })}
            </span>
          ) : null}
        </div>
      ) : phase === "review" || phase === "applied" ? (
        <div className="ui-edpair-done">
          <span className={phase === "applied" ? "ok done" : "ok"}>{phase === "applied" ? "✓" : "✦"}</span>
          <span>{phase === "applied" ? t("editor.pair.done.applied") : t("editor.pair.done.review")}</span>
          <span className="stat mono">
            <span className="add">+{stage.total}</span>
          </span>
          {phase === "review" ? (
            <button type="button" className="ui-edpair-reviewbtn" onClick={onClose}>
              {t("editor.pair.done.inCanvas")} <kbd>Tab</kbd>
            </button>
          ) : (
            <span className="mono hint">{t("editor.pair.done.rollbackHint")}</span>
          )}
        </div>
      ) : (
        <>
          <div className="ui-edpair-chips">
            <span className="ui-edpair-chip">
              <b>{t("editor.pair.ctx.selection")}</b> L{selection.startLine}
              {selection.endLine !== selection.startLine ? `–${selection.endLine}` : ""} ·{" "}
              {selection.text.split("\n").length} {t("editor.pair.ctx.lines")}
            </span>
            {ctxFiles.map((f) => (
              <span key={f} className="ui-edpair-chip">
                <b>@</b>
                {f.split(/[\\/]/).pop()}
                <button type="button" className="rm" onClick={() => setCtxFiles((xs) => xs.filter((x) => x !== f))}>
                  ✕
                </button>
              </span>
            ))}
            <span className="ui-edpair-chip add" onClick={() => setCtxMenuOpen((v) => !v)} role="button" tabIndex={0}>
              ＋ {t("editor.pair.ctx.add")}
            </span>
          </div>
          {ctxMenuOpen ? (
            <div className="ui-edpair-ctxmenu" role="menu">
              {openFiles
                .filter((f) => f !== file && !ctxFiles.includes(f))
                .slice(0, 8)
                .map((f) => (
                  <button
                    key={f}
                    type="button"
                    className="mi"
                    role="menuitem"
                    onClick={() => {
                      setCtxFiles((xs) => [...xs, f]);
                      setCtxMenuOpen(false);
                    }}
                  >
                    ⌗ <span className="mono">{f.split(/[\\/]/).pop()}</span>
                  </button>
                ))}
              {openFiles.filter((f) => f !== file && !ctxFiles.includes(f)).length === 0 ? (
                <div className="mi empty">{t("editor.pair.ctx.noFiles")}</div>
              ) : null}
            </div>
          ) : null}
          <textarea
            className="ui-edpair-input"
            rows={2}
            value={instruction}
            onChange={(e) => onInstructionChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={t("editor.pair.placeholder")}
            autoFocus
          />
          <div className="ui-edpair-foot">
            <div className="ui-edpair-intents">
              {quickIntents.map((qi) => (
                <button
                  key={qi.label}
                  type="button"
                  className="ui-edpair-intent"
                  onClick={() => {
                    if (qi.onPick) {
                      // Floating intents (解释) bypass the rewrite path —
                      // the answer lands in the floating card, not the buffer.
                      qi.onPick();
                      return;
                    }
                    onInstructionChange(qi.text);
                  }}
                >
                  {qi.label}
                </button>
              ))}
            </div>
            <span className="grow" />
            {onAskAgent ? (
              <button
                type="button"
                className="ui-edpair-ghost"
                onClick={() =>
                  onAskAgent(
                    `【编辑器选区指令】${file} L${selection.startLine}${
                      selection.endLine !== selection.startLine ? `-L${selection.endLine}` : ""
                    }\n\`\`\`\n${selection.text.slice(0, 4000)}\n\`\`\`\n${instruction}`
                  )
                }
              >
                {t("editor.pair.toChat")}
              </button>
            ) : null}
            <button type="button" className="ui-edpair-send" disabled={!instruction.trim()} onClick={submit}>
              {t("editor.pair.send")} <kbd>⌘⏎</kbd>
            </button>
          </div>
          {error ? (
            <div className="ui-error ui-edpair-error">
              {error}
              <button type="button" className="ui-edpair-ghost" onClick={onDismissError}>
                {t("common.close")}
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>,
    host
  );
}
