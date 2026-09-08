import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";
import { createPortal } from "react-dom";
import { api } from "../../api";
import { useI18n } from "../../i18n";
import { FileIcon, IconButton } from "../../ui/index";
import { IconUndo, IconRedo } from "../../ui/icons";
import type { EditorWorkspaceStore } from "../../hooks/use-editor-workspace";
import { usePairLane } from "../../hooks/use-pair-lane";
import { EditorTabBar } from "./EditorTabBar";
import { mountEditorView, type Cm6KernelHandle, type Cm6SelectionInfo } from "./cm6-kernel";
import { EditorView } from "@codemirror/view";
import { BufferStream } from "./cm6-buffer-stream";
import { cm6LspShutdown } from "./cm6-lsp";
import { languageIdForFile } from "./language-map";
import { PairBar } from "./PairBar";
import { EditorReviewBar } from "./EditorReviewBar";
import { CheckpointStrip } from "./CheckpointStrip";
import { EditorStatusBar } from "./EditorStatusBar";
import { LanePanel } from "./LanePanel";
import { EditorPalette } from "./EditorPalette";
import { ExplainCard } from "./ExplainCard";
import { EditorReviewPreview } from "./EditorReviewPreview";
import { BinaryFileViewer } from "./BinaryFileViewer";
import { fileBaseName } from "../../ui/path-utils";

/** Enclosing-symbol heuristic for the breadcrumb trail — one declaration
 *  keyword per line; the nearest match at/above the cursor wins. */
const DECL_RE =
  /^\s*(?:export\s+|default\s+|abstract\s+|declare\s+|public\s+|private\s+|internal\s+|static\s+|final\s+|override\s+)*(?:async\s+)?(?:function\s*\*?|class|interface|enum|struct|protocol|extension|impl|trait|def|func|fn|type|const|let|var)\s+([A-Za-z_$][\w$]*)/;

type Props = {
  store: EditorWorkspaceStore;
  /** Current appearance for the CM6 theme compartment. */
  appearance: "light" | "dark";
  /** Guarded in App (dirty confirm) — the workspace only requests. */
  onRequestCloseFile: (file: string) => void;
  onContentChange: (file: string, content: string) => void;
  onSaved: (file: string, content: string) => void;
  /** 「到会话」旁路（选区指令注入主会话流式执行）。 */
  onAskAgent?: (prompt: string) => void;
};

/**
 * Editor workspace — CM6 kernel + pair canvas (specs/editor-copilot A5/B).
 * One CodeMirror view serves all files: sub-tab switches go through
 * `kernel.setDoc` which swaps the whole EditorState (fresh undo stack +
 * restored cursor/scroll). React-side state (drafts/dirty per file) stays in
 * the workspace store hook. The AI pair surfaces (PairBar ⌘I / review bar /
 * checkpoint strip / status bar) drive the shared decoration domain through
 * one BufferStream instance per mount.
 */

/** Kernel mount sentinel when no file is open yet — INTERNAL ONLY: never a
 * real path and never rendered (the status bar shows "—" for no file); it
 * only seeds `kernel.currentFile` until the first setDoc lands. */
const MOUNT_SENTINEL_FILE = ".scratch-mount";

export function EditorWorkspace({
  store,
  appearance,
  onRequestCloseFile,
  onContentChange,
  onSaved,
  onAskAgent,
}: Props): JSX.Element {
  const { t } = useI18n();
  const { openFiles, activeFile, drafts, fileStates } = store;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const kernelRef = useRef<Cm6KernelHandle | null>(null);
  const [kernelReady, setKernelReady] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [, setHistoryTick] = useState(0); // re-render for undo/redo disabled states
  const [selection, setSelection] = useState<Cm6SelectionInfo>(null);
  // Breadcrumbs (2026-09-06 user ask): cursor position + enclosing symbol.
  const [cursor, setCursor] = useState<{ line: number; col: number }>({ line: 1, col: 1 });
  const [crumbSymbol, setCrumbSymbol] = useState<string | null>(null);
  // Editor context menu (2026-09-06 user ask): viewport anchor, null = closed.
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  // 多 hunk 审阅 (2026-09-06): chips mirror + navigation + preview state.
  const [hunkChips, setHunkChips] = useState<Array<{ index: number; accepted: boolean }>>([]);
  const [currentHunk, setCurrentHunk] = useState(0);
  const [previewOpen, setPreviewOpen] = useState(false);
  // Visual-draft status bar: workspace git branch + last manual save time.
  const [gitBranch, setGitBranch] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);

  const state = activeFile ? fileStates.get(activeFile) : undefined;
  const draft = activeFile ? drafts.get(activeFile) : undefined;
  const dirty = Boolean(activeFile && state?.loaded && draft !== state?.saved);
  const fileName = activeFile ? fileBaseName(activeFile) : "";

  const activeFileRef = useRef(activeFile);
  activeFileRef.current = activeFile;
  const onContentChangeRef = useRef(onContentChange);
  onContentChangeRef.current = onContentChange;

  const showBody = Boolean(activeFile && state?.loaded && !state.error && !state.binary && draft !== undefined);

  // ── Pair canvas wiring (B 批)：one BufferStream per view mount ──
  const lane = usePairLane();
  const [pairOpen, setPairOpen] = useState(false);
  const [laneOpen, setLaneOpen] = useState(true);
  const [diagnostics, setDiagnostics] = useState<{ errors: number; warnings: number; firstLine: number | null }>({
    errors: 0,
    warnings: 0,
    firstLine: null,
  });
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [palettePrefill, setPalettePrefill] = useState<"" | "@" | "#" | ".">("");
  const streamRef = useRef<BufferStream | null>(null);
  const laneEventsRef = useRef(lane.events);
  laneEventsRef.current = lane.events;
  // Latest-scope refs for the window-level key handler (⌘\ / ⌘⌫ need the
  // CURRENT lane state without re-registering the listener per render).
  const laneStateRef = useRef(lane.state);
  laneStateRef.current = lane.state;
  const storeRef = useRef(store);
  storeRef.current = store;

  const openPalette = useCallback((prefill: "" | "@" | "#" | "." = ""): void => {
    setPalettePrefill(prefill);
    setPaletteOpen(true);
  }, []);

  useEffect(() => {
    // The stream reaches the view through the kernel ref (alive whenever the
    // host is mounted) — construct lazily on first need, dispose on unmount.
    return () => {
      streamRef.current?.dispose();
      streamRef.current = null;
    };
  }, []);

  const getStream = useCallback((): BufferStream => {
    if (!streamRef.current) {
      streamRef.current = new BufferStream(
        () => kernelRef.current?.view ?? null,
        laneEventsRef.current,
        // B2 guard clock + B6 lock hook (kernel-side root fixes).
        () => kernelRef.current?.docGeneration ?? 0,
        (flag) => kernelRef.current?.setReadOnly(flag),
        // C4: the file the kernel CURRENTLY shows — apply/rollback refuse to
        // act on a block whose run belongs to another tab.
        () => activeFileRef.current
      );
    }
    return streamRef.current;
  }, []);

  // Selecting rows opens the pair bar (visual draft D3); ⌘I toggles it too.
  useEffect(() => {
    if (selection && lane.state.phase === "idle") setPairOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection?.startLine, selection?.endLine]);

  // E2: a selection belongs to ONE file — switching sub-tabs drops it so a
  // stale (possibly identical-content) selection can never run against the
  // next file.
  useEffect(() => {
    setSelection(null);
  }, [activeFile]);

  // E1 tail: applying a run syncs the buffer into the draft exactly once —
  // until then AI rows live only in the editor (auto-save stays clean). The
  // sync targets the CHECKPOINT's file (not the active tab), and only when
  // the kernel still shows it — a stale apply can never write A's content
  // into B's draft (C4).
  const appliedFor = useRef<string | null>(null);
  useEffect(() => {
    if (lane.state.phase !== "applied") return;
    const kernel = kernelRef.current;
    const cp = lane.state.checkpoints.at(-1);
    const file = cp?.file ?? activeFileRef.current;
    // Identity = the checkpoint's OWN timestamp, never `checkpoints.length`
    // — the list caps at MAX_CHECKPOINTS, so past the cap every apply
    // re-derived the SAME key and the draft sync was permanently skipped
    // (applied AI edits silently vanished on the next tab switch).
    const applyKey = `${file}::${cp?.atIso ?? ""}`;
    if (!file || !kernel || appliedFor.current === applyKey) return;
    if (kernel.currentFile !== file) return; // wrong tab — the swap path re-syncs
    appliedFor.current = applyKey;
    onContentChangeRef.current(file, kernel.content());
  }, [lane.state.phase, lane.state.checkpoints]);

  // LSP sessions are per-workspace-lifetime here — drop them on unmount
  // (audit C-a wiring: cm6LspShutdown previously had zero callers).
  useEffect(() => () => cm6LspShutdown(), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && !e.shiftKey && e.key.toLowerCase() === "i") {
        e.preventDefault();
        setPairOpen((v) => !v);
        return;
      }
      // ⌘K deliberately NOT bound here — it belongs to the app-level command
      // palette; the editor palette opens through its dedicated header /
      // status-bar buttons (and ⌘P/⌘T/⌘⇧O below).
      if (mod && !e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        openPalette("@");
        return;
      }
      if (mod && !e.shiftKey && e.key.toLowerCase() === "t") {
        e.preventDefault();
        openPalette("#");
        return;
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        openPalette(".");
        return;
      }
      // Visual-draft keyboard principle (键盘为第五原则): ⌘\ toggles the pair
      // lane; ⌘⌫ rolls the buffer back to the LAST checkpoint (整体回滚).
      if (mod && e.key === "\\") {
        e.preventDefault();
        setLaneOpen((v) => !v);
        return;
      }
      if (mod && e.key === "Backspace") {
        const cps = laneStateRef.current.checkpoints;
        if (cps.length === 0) return;
        e.preventDefault();
        const cp = cps[cps.length - 1]!;
        if (cp.file && cp.file !== activeFileRef.current) {
          storeRef.current.openFile(cp.file);
          return;
        }
        getStream().rollbackTo(cp.content);
        const file = activeFileRef.current;
        const kernel = kernelRef.current;
        if (file && kernel) onContentChangeRef.current(file, kernel.content());
        return;
      }
      // E4: review-key interception is scoped to the editor surfaces — a Tab
      // pressed in the chat composer (or any input outside) must keep its
      // normal browser behavior instead of applying AI changes.
      const target = e.target as HTMLElement | null;
      const insideEditor = Boolean(target?.closest?.(".ui-editor-cm6-wrap, .ui-edpair-bar"));
      if (insideEditor && lane.state.phase === "review") {
        if (e.key === "Tab") {
          e.preventDefault();
          getStream().apply();
        } else if (mod && e.key === "Enter") {
          e.preventDefault();
          getStream().apply();
        } else if (e.key === "Escape") {
          if (target?.closest?.(".ui-edpair-bar")) return; // bar owns its Esc
          e.preventDefault();
          getStream().discard();
        }
      } else if (insideEditor && lane.state.phase === "streaming" && e.key === "Escape") {
        // E3: Esc during a stream cancels the run — never falls through to
        // the file-close guard while AI rows are mid-flight.
        if (target?.closest?.(".ui-edpair-bar")) return;
        e.preventDefault();
        getStream().discard();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lane.state.phase, getStream, openPalette]);

  // Visual-draft status bar ⑂: the workspace git branch (fail-open — a
  // non-repo workspace simply omits the item).
  useEffect(() => {
    let cancelled = false;
    void api
      .gitCurrentBranch()
      .then((b) => {
        if (!cancelled) setGitBranch(typeof b === "string" && b.trim() ? b.trim() : null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [activeFile]);

  // D7/⑦: the diagnostics pill jumps to the first diagnostic AND selects
  // its row — the selection opens the pair bar, so「AI 修复」is one ⌘⏎ away.
  const jumpToDiagnostics = useCallback((): void => {
    const kernel = kernelRef.current;
    if (!kernel || diagnostics.firstLine === null) return;
    const view = kernel.view;
    const line = view.state.doc.line(Math.min(diagnostics.firstLine, view.state.doc.lines));
    view.dispatch({
      selection: { anchor: line.from, head: line.to },
      effects: EditorView.scrollIntoView(line.from, { y: "center" }),
    });
    view.focus();
  }, [diagnostics.firstLine]);

  // D15: asking about a symbol from the palette selects its row — the pair
  // bar renders against a real selection even when the user had none.
  const askSymbol = useCallback(
    (name: string, lineNo: number, file: string): void => {
      const select = (): void => {
        const kernel = kernelRef.current;
        if (!kernel) return;
        const view = kernel.view;
        const line = view.state.doc.line(Math.min(lineNo, view.state.doc.lines));
        view.dispatch({ selection: { anchor: line.from, head: line.to } });
      };
      if (file !== activeFile) {
        // Re-audit #11: a cross-file symbol opens its tab first — the doc
        // swap (and the E2 selection reset) lands before we select, so the
        // selection targets the NEW document instead of vanishing.
        store.openFile(file);
        requestAnimationFrame(() => requestAnimationFrame(select));
      } else {
        select();
      }
      setPairOpen(true);
      lane.setInstruction(`${t("editor.palette.askPrefill")} ${name} (L${lineNo})`);
    },
    [activeFile, store, lane, t]
  );

  const toggleLane = useCallback((): void => setLaneOpen((v) => !v), []);

  // 2026-09-06 user ask: 「解释」 NEVER rewrites the buffer. The explain run
  // bypasses BufferStream entirely — no decorations, no lock, no draft gate —
  // and its prose answer lands in the floating ExplainCard. Blocked while a
  // pair run streams (the broadcast progress events would cross-contaminate
  // the run's fence buffer).
  const runExplain = useCallback((): void => {
    const file = activeFileRef.current;
    const sel = selection;
    if (!file || !sel?.text.trim()) return;
    if (lane.state.phase === "streaming" || lane.state.explain?.busy) return;
    lane.beginExplain();
    void api
      .editorAgentRun({
        filePath: file,
        startLine: sel.startLine,
        endLine: sel.endLine,
        selection: sel.text,
        instruction: t("editor.pair.explain.instruction"),
        lang: languageIdForFile(file),
      })
      .then((res) => {
        if (res.ok) lane.settleExplain({ content: res.content });
        else lane.settleExplain({ error: res.error });
      })
      .catch((error) => {
        lane.settleExplain({ error: error instanceof Error ? error.message : String(error) });
      });
  }, [selection, lane, t]);

  // AI-pending tab dot: review state on the active file.
  const aiPendingFiles = useMemo(() => {
    const set = new Set<string>();
    if (activeFile && (lane.state.phase === "streaming" || lane.state.phase === "review")) set.add(activeFile);
    return set;
  }, [activeFile, lane.state.phase]);

  // Mount the single CM6 view once the host div exists (it is conditionally
  // rendered below — first open may happen after this component mounts);
  // destroying on host unmount (all files closed) re-mounts on next open.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const kernel = mountEditorView(host, {
      file: activeFileRef.current ?? MOUNT_SENTINEL_FILE,
      doc: "",
      appearance,
      // Localized built-in search/replace panel (2026-09-06 user ask).
      phrases: {
        Find: t("editor.search.find"),
        Replace: t("editor.search.replace"),
        next: t("editor.search.next"),
        previous: t("editor.search.previous"),
        all: t("editor.search.all"),
        "match case": t("editor.search.matchCase"),
        regexp: t("editor.search.regexp"),
        "by word": t("editor.search.byWord"),
        replace: t("editor.search.replaceBtn"),
        "replace all": t("editor.search.replaceAll"),
        close: t("editor.search.close"),
      },
      onDocChanged: (content) => {
        const file = activeFileRef.current;
        if (file) onContentChangeRef.current(file, content);
        setHistoryTick((n) => n + 1);
      },
      onSelectionChanged: (sel) => setSelection(sel),
      onCursorChanged: (line, col) => {
        setCursor({ line, col });
        // Nearest declaration at/above the cursor — cheap bounded scan that
        // powers the breadcrumb's trailing symbol segment.
        const view = kernelRef.current?.view;
        if (!view) return;
        const doc = view.state.doc;
        const scanFrom = Math.max(1, Math.min(line, doc.lines) - 400);
        for (let no = Math.min(line, doc.lines); no >= scanFrom; no -= 1) {
          const m = DECL_RE.exec(doc.line(no).text);
          if (m?.[1]) {
            setCrumbSymbol(m[1]);
            return;
          }
        }
        setCrumbSymbol(null);
      },
      onDiagnosticsChanged: (summary) => setDiagnostics(summary),
    });
    kernelRef.current = kernel;
    setKernelReady(true);
    return () => {
      kernel.destroy();
      kernelRef.current = null;
      setKernelReady(false);
      // The decorations (and the doc they lived in) died with the kernel —
      // settle any streaming/reviewing run NOW instead of letting it guard
      // against a dead view. Paired with the cross-mount generation clock:
      // a remount can never re-issue the stale run's numbers, and the
      // settled phase keeps later runs from being rejected.
      streamRef.current?.discard();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showBody]);

  // Sub-tab switch / first load: swap the whole state for the active file.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  useEffect(() => {
    const kernel = kernelRef.current;
    if (!kernel || !kernelReady || !activeFile) return;
    const content = draftRef.current;
    if (content === undefined) return;
    // C4 root fix: decide by FILE identity, never by content — two tabs with
    // identical content must still swap the kernel state (currentFile, undo
    // stack, generation), or a review block + apply could write file A's
    // content into file B and auto-save it. The skip therefore requires BOTH
    // the file AND the content to match: same-file typing (draft mirrors the
    // editor) skips, a file change always re-sets, and the first load of a
    // file (kernel mounted with its name but an empty doc) still loads.
    if (kernel.currentFile === activeFile && kernel.view.state.doc.toString() === content) return;
    kernel.setDoc(activeFile, content);
  }, [activeFile, kernelReady, state?.loaded]);

  // Appearance swaps reconfigure the theme compartment in place.
  useEffect(() => {
    kernelRef.current?.setAppearance(appearance);
  }, [appearance, kernelReady]);

  // LSP intelligence per active document (D 批): fetch the workspace root
  // once, then refresh the LSP extension set on every doc swap. Fail-open —
  // a null root (or a failed attach inside) leaves syntax-only editing.
  useEffect(() => {
    if (!kernelReady || !activeFile) return;
    let cancelled = false;
    void api
      .getProjectRoot()
      .then((root) => {
        if (cancelled || !root) return;
        kernelRef.current?.refreshLsp(root);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [kernelReady, activeFile]);

  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // E6 re-audit fix: the retry must call the LATEST handleSave (its captured
  // `saving===true` would otherwise re-enter the requeue branch forever — a
  // 400ms livelock that never flushed). The ref is reassigned every render.
  const handleSaveRef = useRef<() => Promise<void>>(async () => {});
  const handleSave = useCallback(async (): Promise<void> => {
    const file = activeFile;
    const content = file ? drafts.get(file) : undefined;
    if (!file || content === undefined) return;
    if (saving) {
      // Requeue once through the ref — the deferred call re-reads state.
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      retryTimerRef.current = setTimeout(() => void handleSaveRef.current(), 400);
      return;
    }
    setSaving(true);
    setSaveError(null);
    let result: Awaited<ReturnType<typeof api.editorWriteFile>>;
    try {
      result = await api.editorWriteFile(file, content);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
      return;
    } finally {
      setSaving(false);
    }
    if (!result.ok) {
      setSaveError(result.error ?? t("editor.writeError"));
      return;
    }
    onSaved(file, content);
    // Checkpoint-strip baseline (visual draft): 「基线 · 你最后一次手动保存」.
    setLastSavedAt(new Date().toISOString());
  }, [activeFile, drafts, saving, t, onSaved]);

  handleSaveRef.current = handleSave;

  // E6: an unmounted workspace must not fire a deferred save IPC.
  useEffect(
    () => () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    },
    []
  );

  // 多 hunk chips mirror: rebuild whenever a run settles into review — the
  // accepted flags read the stream's own decision state (default all true).
  useEffect(() => {
    if (lane.state.phase !== "review" || !lane.state.hunks) {
      setHunkChips([]);
      return;
    }
    let idx = 0;
    const decisions = getStream().hunkDecisions();
    setHunkChips(
      lane.state.hunks
        .filter((g) => g.type === "change")
        .map(() => {
          const chip = { index: idx, accepted: decisions[idx] ?? true };
          idx += 1;
          return chip;
        })
    );
    setCurrentHunk(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lane.state.phase, lane.state.hunks]);

  // Context menu closes on ANY outside pointerdown / keypress.
  useEffect(() => {
    if (!ctxMenu) return;
    const close = (): void => setCtxMenu(null);
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", close, true);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("keydown", close, true);
    };
  }, [ctxMenu]);

  // ⌘S saves the active file; Esc asks App to close it (App owns the dirty
  // guard). While focus is inside the editor the editor owns Esc — never
  // yank the file from under a completion popup.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        void handleSave();
        return;
      }
      if (e.key === "Escape" && activeFile) {
        const target = e.target as HTMLElement | null;
        if (target?.closest?.(".cm-editor")) return;
        // An active pair run owns Esc (cancel) — the close-file guard stays
        // out of its way until the run settles (audit E3).
        if (lane.state.phase === "streaming" || lane.state.phase === "review") return;
        onRequestCloseFile(activeFile);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleSave, activeFile, onRequestCloseFile, lane.state.phase]);

  // Auto-save (user ask 2026-09-05): debounce 800ms after the last edit.
  // The explicit save button is gone — undo/redo icons replace it in the
  // header. ⌘S still force-flushes immediately for muscle memory.
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!dirty) return;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => void handleSave(), 800);
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
      // M5 root fix: switching AWAY from a dirty file must flush THAT file.
      // `handleSaveRef.current()` here would be the NEW tab's closure (the
      // render body reassigned the ref before this cleanup ran) — it saved
      // tab B while A's debounced edits stayed unwritten. Write this effect
      // instance's OWN `activeFile`/`draft` (exactly its deps) directly.
      // On unmount activeFileRef.current === activeFile, so the guard stays
      // closed there (E6: no deferred save IPC from an unmounted workspace).
      if (activeFile && activeFileRef.current !== activeFile && dirty && draft !== undefined) {
        void api
          .editorWriteFile(activeFile, draft)
          .then((res) => {
            if (res.ok) onSaved(activeFile, draft);
          })
          .catch(() => undefined);
      }
    };
    // `dirty` derives from draft/activeFile (re-adding it changes nothing) and
    // `handleSave` is latest-closure through handleSaveRef — including either
    // would re-arm the debounce on unrelated renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, activeFile]);

  const handleUndo = useCallback((): void => {
    kernelRef.current?.undo();
    setHistoryTick((n) => n + 1);
  }, []);
  const handleRedo = useCallback((): void => {
    kernelRef.current?.redo();
    setHistoryTick((n) => n + 1);
  }, []);

  return (
    <div className="ui-editor-workspace">
      <EditorTabBar
        files={openFiles}
        activeFile={activeFile}
        dirtyFiles={store.dirtyFilesSet}
        aiPendingFiles={aiPendingFiles}
        onSelect={store.setActiveFile}
        onCloseRequest={onRequestCloseFile}
      />
      {/* Breadcrumb trail (2026-09-06 user ask, visual draft header): every
          path segment › … › file › enclosing-symbol › L:col. */}
      {activeFile ? (
        <div className="ui-editor-crumbs">
          {activeFile
            .split(/[\\/]/)
            .filter(Boolean)
            .map((seg, i, all) => (
              <span key={`${seg}-${i}`} className="crumb-wrap">
                {i === all.length - 1 ? <FileIcon name={seg} /> : null}
                <span className={`crumb${i === all.length - 1 ? " file" : ""}`}>{seg}</span>
                <span className="sep">›</span>
              </span>
            ))}
          {crumbSymbol ? (
            <span className="crumb-wrap">
              <span className="crumb sym">{crumbSymbol}</span>
              <span className="sep">›</span>
            </span>
          ) : null}
          <span className="pos mono">
            L{cursor.line}:{cursor.col}
          </span>
        </div>
      ) : null}
      <div className="ui-editor-overlay-head">
        <span className="ui-editor-overlay-title" title={activeFile ?? undefined}>
          {activeFile ? <FileIcon name={fileName} /> : null}
          {fileName}
          {dirty ? <span className="ui-editor-dirty-badge">{t("editor.dirty")}</span> : null}
        </span>
        <div className="ui-editor-overlay-actions">
          {/* Dedicated editor triggers (2026-09-06 user ask): 行内协作 / 命令 /
              结对栏 mirror the visual draft's header pills. 命令 opens the
              editor palette — ⌘K itself stays with the app-level palette. */}
          <button type="button" className="ui-editor-head-btn" onClick={() => setPairOpen((v) => !v)}>
            ✦ {t("editor.head.pair")} <kbd>⌘I</kbd>
          </button>
          <button type="button" className="ui-editor-head-btn" onClick={() => openPalette("")}>
            ⌘ {t("editor.head.commands")}
          </button>
          <button type="button" className={`ui-editor-head-btn${laneOpen ? " on" : ""}`} onClick={toggleLane}>
            ▤ {t("editor.head.lane")}
          </button>
          <IconButton
            onClick={handleUndo}
            disabled={!kernelRef.current?.historyFlags.canUndo}
            aria-label={t("editor.undo")}
            title={t("editor.undo")}
          >
            <IconUndo />
          </IconButton>
          <IconButton
            onClick={handleRedo}
            disabled={!kernelRef.current?.historyFlags.canRedo}
            aria-label={t("editor.redo")}
            title={t("editor.redo")}
          >
            <IconRedo />
          </IconButton>
          {saving ? <span className="ui-editor-autosave-hint">{t("editor.autoSaving")}</span> : null}
          {activeFile ? (
            <IconButton
              onClick={() => onRequestCloseFile(activeFile)}
              aria-label={t("common.close")}
              title={t("common.close")}
            >
              ✕
            </IconButton>
          ) : null}
        </div>
      </div>
      <div className="ui-editor-overlay-body">
        {!activeFile || !state ? (
          <div className="ui-editor-empty">{t("editor.empty")}</div>
        ) : state.loading ? (
          <div className="ui-editor-empty">
            <span className="ui-spinner" /> {t("editor.loading")}
          </div>
        ) : state.error ? (
          <div className="ui-editor-empty ui-editor-error">{state.error}</div>
        ) : state.binary ? (
          // Binary fallback preview (specs/artifact-landing 链路 A) — replaces
          // the bare "cannot edit" placeholder.
          <BinaryFileViewer file={activeFile} />
        ) : draft === undefined ? (
          <div className="ui-editor-empty">{t("editor.empty")}</div>
        ) : (
          <div className={`ui-editor-canvas${laneOpen ? " with-lane" : ""}`}>
            <div
              className="ui-editor-cm6-wrap"
              onContextMenu={(e) => {
                // Custom editor context menu (2026-09-06 user ask) — replaces
                // the bare webview menu with pair/clipboard/selection actions.
                e.preventDefault();
                setCtxMenu({ x: e.clientX, y: e.clientY });
              }}
            >
              <div ref={hostRef} className="ui-editor-cm6-host" data-has-selection={selection ? "true" : undefined} />
              {kernelReady && activeFile && selection ? (
                <PairBar
                  file={activeFile}
                  kernel={kernelRef}
                  selection={selection}
                  stream={getStream()}
                  phase={lane.state.phase}
                  stage={lane.state.stage}
                  instruction={lane.state.instruction}
                  onInstructionChange={lane.setInstruction}
                  error={lane.state.error}
                  clarify={lane.state.clarify}
                  onDismissError={lane.dismissError}
                  onDismissClarify={lane.dismissClarify}
                  onExplain={runExplain}
                  explainBusy={lane.state.explain?.busy ?? false}
                  open={pairOpen}
                  onClose={() => setPairOpen(false)}
                  onAskAgent={onAskAgent}
                  openFiles={openFiles}
                />
              ) : null}
              {lane.state.phase === "review" ? (
                <EditorReviewBar
                  added={lane.state.stats.added}
                  removed={lane.state.stats.removed}
                  hunks={hunkChips}
                  currentHunk={currentHunk}
                  onPrevHunk={() => setCurrentHunk((c) => Math.max(0, c - 1))}
                  onNextHunk={() => setCurrentHunk((c) => Math.min(hunkChips.length - 1, c + 1))}
                  onToggleHunk={(index, accepted) => {
                    getStream().setHunkDecision(index, accepted);
                    setHunkChips((chips) => chips.map((c) => (c.index === index ? { ...c, accepted } : c)));
                  }}
                  onPreview={() => setPreviewOpen(true)}
                  onApply={() => {
                    setPreviewOpen(false);
                    getStream().apply();
                  }}
                  onDiscard={() => {
                    setPreviewOpen(false);
                    getStream().discard();
                  }}
                />
              ) : null}
            </div>
            {laneOpen ? (
              <LanePanel
                lane={lane.state}
                file={activeFile}
                openFiles={openFiles}
                onOpenFile={(f) => store.setActiveFile(f)}
                onToggle={() => setLaneOpen(false)}
                onAskAgent={onAskAgent}
              />
            ) : null}
          </div>
        )}
      </div>
      {paletteOpen ? (
        <EditorPalette
          kernel={kernelRef}
          activeFile={activeFile}
          onOpenFile={(file) => store.openFile(file)}
          onAskSymbol={(name, line, file) => askSymbol(name, line, file)}
          onPairIntent={(instruction) => {
            setPairOpen(true);
            lane.setInstruction(instruction);
          }}
          onTogglePair={() => setPairOpen((v) => !v)}
          onSave={() => void handleSave()}
          onExplain={runExplain}
          diagnosticsFirstLine={diagnostics.firstLine}
          onClose={() => setPaletteOpen(false)}
          prefill={palettePrefill}
        />
      ) : null}
      <CheckpointStrip
        checkpoints={lane.state.checkpoints}
        baselineAt={lastSavedAt}
        onRollback={(cp) => {
          // Same-file only (re-audit #4): a checkpoint belongs to the file it
          // was applied to — cross-file rollback would write A's snapshot
          // into B's draft and auto-save it.
          if (cp.file && cp.file !== activeFile) {
            store.openFile(cp.file);
            return; // open the owning tab first; the node re-clicks there
          }
          getStream().rollbackTo(cp.content);
          const file = activeFileRef.current;
          const kernel = kernelRef.current;
          if (file && kernel) onContentChangeRef.current(file, kernel.content());
        }}
      />
      <EditorStatusBar
        lane={lane.state}
        file={activeFile}
        branch={gitBranch}
        diagnostics={diagnostics}
        onJumpDiagnostics={jumpToDiagnostics}
        onOpenPalette={() => openPalette("")}
        onToggleLane={toggleLane}
        laneOpen={laneOpen}
      />
      <ExplainCard explain={lane.state.explain} file={activeFile} onDismiss={lane.dismissExplain} />
      {previewOpen && lane.state.hunks ? (
        <EditorReviewPreview
          groups={lane.state.hunks}
          currentHunk={currentHunk}
          onClose={() => setPreviewOpen(false)}
        />
      ) : null}
      {ctxMenu
        ? createPortal(
            <div
              className="ui-edctx"
              style={{ left: ctxMenu.x, top: ctxMenu.y }}
              onPointerDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                disabled={!selection}
                onClick={() => {
                  setCtxMenu(null);
                  setPairOpen(true);
                }}
              >
                ✦ {t("editor.ctx.pair")} <kbd>⌘I</kbd>
              </button>
              <button
                type="button"
                disabled={!selection}
                onClick={() => {
                  setCtxMenu(null);
                  runExplain();
                }}
              >
                ◌ {t("editor.ctx.explain")}
              </button>
              <button
                type="button"
                disabled={!selection}
                onClick={() => {
                  setCtxMenu(null);
                  setPairOpen(true);
                  lane.setInstruction(t("editor.pair.intent.refactor.prompt"));
                }}
              >
                ⟲ {t("editor.ctx.refactor")}
              </button>
              <button
                type="button"
                disabled={!selection}
                onClick={() => {
                  setCtxMenu(null);
                  setPairOpen(true);
                  lane.setInstruction(t("editor.pair.intent.optimize.prompt"));
                }}
              >
                ↑ {t("editor.ctx.optimize")}
              </button>
              <button
                type="button"
                disabled={!selection || !onAskAgent}
                onClick={() => {
                  setCtxMenu(null);
                  onAskAgent?.(
                    `【编辑器选区指令】${activeFile} L${selection?.startLine}${
                      selection && selection.endLine !== selection.startLine ? `-L${selection.endLine}` : ""
                    }\n\`\`\`\n${selection?.text.slice(0, 4000) ?? ""}\n\`\`\`\n${lane.state.instruction}`
                  );
                }}
              >
                ⇱ {t("editor.ctx.toSession")}
              </button>
              <div className="hr" />
              <button
                type="button"
                disabled={!selection}
                onClick={() => {
                  setCtxMenu(null);
                  if (selection) void navigator.clipboard.writeText(selection.text).catch(() => undefined);
                }}
              >
                {t("editor.ctx.copy")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setCtxMenu(null);
                  const view = kernelRef.current?.view;
                  if (!view) return;
                  void navigator.clipboard
                    .readText()
                    .then((text) => {
                      if (!text) return;
                      view.dispatch({ changes: { from: view.state.selection.main.head, insert: text } });
                      view.focus();
                    })
                    .catch(() => undefined);
                }}
              >
                {t("editor.ctx.paste")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setCtxMenu(null);
                  const view = kernelRef.current?.view;
                  if (!view) return;
                  view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
                  view.focus();
                }}
              >
                {t("editor.ctx.selectAll")}
              </button>
            </div>,
            document.body
          )
        : null}
      {saveError ? <div className="ui-error ui-editor-save-error">{saveError}</div> : null}
    </div>
  );
}
