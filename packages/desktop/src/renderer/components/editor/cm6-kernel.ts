// CM6 kernel for the editor workspace (specs/editor-copilot A3).
// One EditorView serves all files: switching documents goes through
// `view.setState(EditorState.create(...))` which re-mounts the per-file
// extension set (language, decorations, listeners) and the undo stack.
// Scroll/cursor position is preserved across switches by restoring the
// previous selection head after the swap (the Monaco viewState equivalent).

import {
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
  crosshairCursor,
} from "@codemirror/view";
import { Annotation, Compartment, EditorState, type Extension } from "@codemirror/state";
import { defaultKeymap, history, historyField, historyKeymap, indentWithTab, redo, undo } from "@codemirror/commands";
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting,
  defaultHighlightStyle,
  HighlightStyle,
} from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { tags as t } from "@lezer/highlight";
import { forEachDiagnostic } from "@codemirror/lint";

import { cm6LanguageForFile } from "./language-map";
import { bumpHabit, habitBoost, habitCount, recordSeparatorCompletion } from "./completion-habit";
import { cm6LspExtensions } from "./cm6-lsp";
import { aiField, aiGutter } from "./cm6-deco";

export type Cm6Appearance = "light" | "dark";

export type Cm6SelectionInfo = {
  text: string;
  startLine: number;
  endLine: number;
} | null;

export type Cm6DocOptions = {
  file: string;
  doc: string;
  appearance: Cm6Appearance;
  /** Fires on every document-changing transaction (editor input). */
  onDocChanged(content: string): void;
  /** Fires on selection change; null when the selection collapses to empty. */
  onSelectionChanged?(sel: Cm6SelectionInfo): void;
  /** Fires on every cursor move (breadcrumbs): 1-based line + column of the
   *  selection head, empty selection included. */
  onCursorChanged?(line: number, col: number): void;
  /** Fires (debounced) when the lint diagnostics set changes (D7/⑦). */
  onDiagnosticsChanged?(summary: { errors: number; warnings: number; firstLine: number | null }): void;
  /** @internal Kernel-internal hooks (history cache, diagnostics debounce) —
   *  injected by mountEditorView; direct createEditorState callers omit. */
  __internal?: {
    refreshHistoryFlags(): void;
    scheduleDiagnostics(): void;
  };
  /** CM6 phrase table — localizes the built-in search/replace panel
   *  (2026-09-06 user ask: UI 统一化 + 文案国际化). */
  phrases?: Record<string, string>;
};

/* ── Theme: product tokens for chrome, fixed hex for syntax palette ── */

const chromeTheme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "13px",
    // Softened editor canvas (2026-09-06 user ask): never pure white/black —
    // tokens carry warm paper gray (light) / soft charcoal (dark).
    backgroundColor: "var(--editor-canvas-bg, var(--ui-bg))",
    color: "var(--ui-text)",
  },
  ".cm-scroller": {
    fontFamily: "var(--ui-font-mono)",
    lineHeight: "1.62",
    overflow: "auto",
  },
  ".cm-content": {
    caretColor: "var(--ui-accent)",
    padding: "8px 0 40vh 0",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-gutters": {
    backgroundColor: "var(--editor-gutter-bg, var(--ui-surface))",
    color: "var(--editor-canvas-num, var(--ui-text-faint))",
    border: "none",
    userSelect: "none",
  },
  ".cm-activeLine": { backgroundColor: "var(--ui-surface-hover)" },
  ".cm-activeLineGutter": {
    backgroundColor: "var(--ui-surface-hover)",
    color: "var(--ui-text-dim)",
  },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "var(--ui-accent-soft) !important",
  },
  ".cm-cursor": {
    borderLeftColor: "var(--ui-accent)",
    borderLeftWidth: "2px",
  },
  ".cm-matchingBracket": {
    backgroundColor: "var(--ui-accent-soft)",
    outline: "1px solid var(--ui-border)",
    color: "inherit",
  },
  ".cm-selectionMatch": { backgroundColor: "var(--ui-accent-soft)" },
  ".cm-panels": {
    backgroundColor: "var(--ui-surface-raised)",
    color: "var(--ui-text)",
  },
});

/** Orca dark syntax palette (carried from the visual draft's token board). */
const darkHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.controlKeyword], color: "#b197fc" },
  { tag: [t.string, t.special(t.string)], color: "#63e6be" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "#5a6a84", fontStyle: "italic" },
  { tag: [t.number, t.bool, t.null], color: "#ffa94d" },
  { tag: t.function(t.variableName), color: "#74c0fc" },
  { tag: [t.typeName, t.className, t.tagName], color: "#ffd43b" },
  { tag: [t.operator, t.punctuation, t.bracket], color: "#8b9bb4" },
  { tag: t.definition(t.variableName), color: "#e6f1ff" },
  { tag: t.link, color: "#74c0fc", textDecoration: "underline" },
]);

/** Light syntax palette (workbench light board). */
const lightHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.controlKeyword], color: "#9a36b8" },
  { tag: [t.string, t.special(t.string)], color: "#0ca678" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "#8590a0", fontStyle: "italic" },
  { tag: [t.number, t.bool, t.null], color: "#e8590c" },
  { tag: t.function(t.variableName), color: "#1c6fe0" },
  { tag: [t.typeName, t.className, t.tagName], color: "#b08c00" },
  { tag: [t.operator, t.punctuation, t.bracket], color: "#55606d" },
  { tag: t.definition(t.variableName), color: "#1b2129" },
  { tag: t.link, color: "#1c6fe0", textDecoration: "underline" },
]);

const appearanceCompartment = new Compartment();
/** Extra (async-loaded) extensions per document — LSP support lands here
 *  once the relay session is up; empty until then (fail-open). */
const docExtras = new Compartment();
const readOnlyCompartment = new Compartment();

/**
 * AI transaction marker (audit E1 root fix): BufferStream dispatches that
 * carry this annotation are the editor-agent writing rows into the canvas.
 * The kernel's doc-changed listener SKIPS them — AI rows live only in the
 * buffer until apply() syncs the final content into the draft, so the
 * auto-save chain (draft → dirty → 800ms write) can never persist
 * unreviewed AI output. Plain user transactions never carry the tag.
 */
export const aiTransaction = Annotation.define<boolean>();

function appearanceExtension(appearance: Cm6Appearance): Extension[] {
  return appearance === "dark"
    ? [EditorView.theme({}, { dark: true }), syntaxHighlighting(darkHighlight)]
    : [syntaxHighlighting(lightHighlight), syntaxHighlighting(defaultHighlightStyle)];
}

/** Common keywords across the languages the editor ships tokenizers for —
 *  used by the fallback completion source to type document words (a keyword
 *  badge must not look like a variable). Small by design: a false "keyword"
 *  is worse than a plain variable badge. */
const FALLBACK_KEYWORDS = new Set([
  "if",
  "else",
  "for",
  "while",
  "return",
  "break",
  "continue",
  "switch",
  "case",
  "default",
  "try",
  "catch",
  "finally",
  "throw",
  "guard",
  "defer",
  "class",
  "struct",
  "enum",
  "interface",
  "protocol",
  "extension",
  "impl",
  "func",
  "fn",
  "def",
  "function",
  "let",
  "var",
  "const",
  "static",
  "final",
  "public",
  "private",
  "internal",
  "protected",
  "override",
  "abstract",
  "import",
  "export",
  "from",
  "package",
  "module",
  "use",
  "include",
  "async",
  "await",
  "yield",
  "suspend",
  "fun",
  "match",
  "when",
  "where",
  "self",
  "this",
  "super",
  "nil",
  "null",
  "undefined",
  "true",
  "false",
  "type",
  "typedef",
  "namespace",
  "operator",
  "in",
  "is",
  "as",
  "not",
  "and",
  "or",
]);

/** Type priority for upgrades: once a word classifies as a function it stays
 *  a function even if another occurrence looks like a bare variable. */
const TYPE_RANK: Record<string, number> = { variable: 0, text: 0, constant: 1, class: 2, keyword: 3, function: 4 };

/**
 * Document-word completion (2026-09-06 user ask: Swift 等 LSP 覆盖不稳的语言
 * 也要有「基本的代码智能」). Collects identifiers from the current buffer —
 * attached ONLY when the LSP extension set came back empty, so real LSP
 * completions always win where a language server exists. Words are TYPED by
 * cheap context heuristics (call-site paren → function; leading uppercase →
 * class; ALL-CAPS → constant; keyword list → keyword; else variable) so the
 * popup's per-type icons stay meaningful on this source too.
 */
export function documentWordCompletion(
  context: import("@codemirror/autocomplete").CompletionContext
): import("@codemirror/autocomplete").CompletionResult | null {
  const word = context.matchBefore(/[\w$]+/);
  if (!word || (word.from === word.to && !context.explicit)) return null;
  const text = context.state.doc.toString();
  const seen = new Map<string, string>([[word.text, "variable"]]);
  const re = /[A-Za-z_$][\w$]{2,}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) && seen.size < 200) {
    const name = m[0];
    const existing = seen.get(name);
    if (existing !== undefined && existing !== "variable") continue; // already specifically typed
    // Look at what follows the occurrence for a call-paren (skip spaces).
    let k = re.lastIndex;
    while (text[k] === " " || text[k] === "\t") k += 1;
    let type = "variable";
    if (text[k] === "(") type = "function";
    else if (FALLBACK_KEYWORDS.has(name)) type = "keyword";
    else if (name.length > 1 && name === name.toUpperCase() && /[A-Z]/.test(name)) type = "constant";
    else if (/^[A-Z]/.test(name)) type = "class";
    const rank = TYPE_RANK[type] ?? 0;
    const curRank = TYPE_RANK[existing ?? "variable"] ?? 0;
    if (existing === undefined || rank > curRank) seen.set(name, type);
  }
  if (seen.size <= 1) return null;
  // 习惯性补全 (2026-09-06 user ask): frecency-boosted ranking + ★N badge +
  // an apply hook that records the accept, so the popup learns from use.
  const options = [...seen.entries()]
    .filter(([label]) => label !== word.text)
    .slice(0, 100)
    .map(([label, type]) => {
      const count = habitCount(label);
      const boost = habitBoost(label);
      return {
        label,
        type,
        ...(boost > 0 ? { boost } : {}),
        ...(count > 0 ? { detail: `\u2605${count}` } : {}),
        apply: (view: import("@codemirror/view").EditorView, _c: unknown, from: number, to: number): void => {
          bumpHabit(label);
          view.dispatch({ changes: { from, to, insert: label } });
        },
      };
    })
    .sort((a, b) => (b.boost ?? 0) - (a.boost ?? 0));
  if (options.length === 0) return null;
  return { from: word.from, options, validFor: /^[\w$]*$/ };
}

const wordCompletionExtension = autocompletion({
  override: [documentWordCompletion],
  activateOnTyping: true,
});

/** Build a complete EditorState for one file (fresh undo stack per doc). */
export function createEditorState(opts: Cm6DocOptions): EditorState {
  const language = cm6LanguageForFile(opts.file);
  return EditorState.create({
    doc: opts.doc,
    extensions: [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      foldGutter(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      bracketMatching(),
      closeBrackets(),
      autocompletion(),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      EditorView.lineWrapping,
      keymap.of([
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...foldKeymap,
        ...completionKeymap,
        indentWithTab,
      ]),
      aiField,
      aiGutter,
      // Localized search/replace panel labels (no-op when the theme omits it).
      ...(opts.phrases ? [EditorState.phrases.of(opts.phrases)] : []),
      chromeTheme,
      appearanceCompartment.of(appearanceExtension(opts.appearance)),
      language ?? [],
      docExtras.of([]),
      readOnlyCompartment.of(EditorState.readOnly.of(false)),
      EditorView.updateListener.of((update) => {
        if (update.transactions.length > 0) {
          opts.__internal?.refreshHistoryFlags();
          // Diagnostics-only transactions never touch the doc — schedule on
          // every transaction (debounced), not just docChanged.
          opts.__internal?.scheduleDiagnostics();
        }
        if (update.docChanged) {
          // E1 gate: AI-tagged transactions must not touch the draft. A mixed
          // update (user edit in the same tick) still notifies — user intent
          // always wins over the gate.
          const allAi =
            update.transactions.length > 0 &&
            update.transactions.filter((tr) => tr.docChanged).every((tr) => tr.annotation(aiTransaction) === true);
          if (!allAi) {
            opts.onDocChanged(update.state.doc.toString());
            // 习惯性补全 — typing collection: a separator keystroke FINISHES
            // the word before it; record it so habits build from plain
            // typing, not only popup accepts. AI rows never count (E1).
            for (const tr of update.transactions) {
              if (!tr.docChanged) continue;
              tr.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
                const inserted = tr.newDoc.sliceString(fromB, toB);
                if (inserted.length === 1 && !/[\w$]/.test(inserted)) {
                  recordSeparatorCompletion((f, t) => tr.newDoc.sliceString(f, t), fromB);
                }
              });
            }
          }
        }
        if (update.selectionSet) {
          const sel = update.state.selection.main;
          const headLine = update.state.doc.lineAt(sel.head);
          opts.onCursorChanged?.(headLine.number, sel.head - headLine.from + 1);
          if (opts.onSelectionChanged) {
            if (!sel.empty) {
              const from = update.state.doc.lineAt(sel.from);
              const to = update.state.doc.lineAt(sel.to);
              opts.onSelectionChanged({
                text: update.state.sliceDoc(sel.from, sel.to),
                startLine: from.number,
                endLine: to.number,
              });
            } else {
              opts.onSelectionChanged(null);
            }
          }
        }
      }),
    ],
  });
}

export type Cm6KernelHandle = {
  readonly view: EditorView;
  /** File the view currently shows — the C4 apply/rollback guard compares
   *  the run's file against this (the buffer may outlive a tab switch). */
  readonly currentFile: string;
  /** Swap the active document (fresh state; restores cursor head + scroll). */
  setDoc(file: string, doc: string): void;
  setAppearance(appearance: Cm6Appearance): void;
  /** Toggle read-only (audit B6 root fix): locked while an AI run streams. */
  setReadOnly(flag: boolean): void;
  /** (Re)load the LSP extension set for the active document (fire-and-forget). */
  refreshLsp(root: string): void;
  /** Monotonic per-view doc counter — bumps on every setDoc swap. The stream
   *  guards against writing into a swapped document with it (audit B2). */
  readonly docGeneration: number;
  undo(): boolean;
  redo(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Render-safe cached history flags (audit E5: no ref reads mid-render). */
  readonly historyFlags: { canUndo: boolean; canRedo: boolean };
  /** Replace the whole document (checkpoint rollback, D10) — the caller owns
   *  syncing the draft; the write itself is AI-annotated so it bypasses the
   *  doc-changed gate until the caller syncs. */
  setContent(content: string): void;
  /** Live diagnostics summary for the status bar (D7/⑦). */
  onDiagnosticsChanged?(summary: { errors: number; warnings: number; firstLine: number | null }): void;
  /** Current content (the workspace's draft source of truth stays in the hook). */
  content(): string;
  destroy(): void;
};

/** Mount the single workspace view into a host element. */
export function mountEditorView(parent: HTMLElement, opts: Cm6DocOptions): Cm6KernelHandle {
  let generation = 0;

  // E5: render-safe history flag cache — the workspace reads handle.historyFlags
  // instead of touching kernelRef mid-render.
  const flagsCache = { canUndo: false, canRedo: false };
  const historySnapshot = (target?: EditorView): void => {
    const v = target ?? viewRef;
    const h = v?.state.field(historyField, false) as
      | { done: readonly unknown[]; undone: readonly unknown[] }
      | undefined;
    flagsCache.canUndo = !!h && h.done.length > 0;
    flagsCache.canRedo = !!h && h.undone.length > 0;
  };

  // D7/⑦: debounced diagnostics summary pushed to the host (status bar).
  let diagTimer: ReturnType<typeof setTimeout> | null = null;
  let viewRef: EditorView | null = null;
  const pushDiagnostics = (): void => {
    const view = viewRef;
    if (!view) return;
    diagTimer = null;
    let errors = 0;
    let warnings = 0;
    let firstLine: number | null = null;
    forEachDiagnostic(view.state, (d, from) => {
      const sev = (d as { severity?: string }).severity;
      if (sev === "error") {
        errors += 1;
        if (firstLine === null) firstLine = view.state.doc.lineAt(from).number;
      } else if (sev === "warning") {
        warnings += 1;
        if (firstLine === null) firstLine = view.state.doc.lineAt(from).number;
      }
    });
    opts.onDiagnosticsChanged?.({ errors, warnings, firstLine });
  };

  const withInternal: Cm6DocOptions = {
    ...opts,
    __internal: {
      refreshHistoryFlags: (): void => historySnapshot(),
      scheduleDiagnostics: (): void => {
        if (diagTimer) clearTimeout(diagTimer);
        diagTimer = setTimeout(pushDiagnostics, 400);
      },
    },
  };
  let current: Cm6DocOptions = withInternal;
  const view = new EditorView({ parent, state: createEditorState(withInternal) });
  viewRef = view;

  const handle: Cm6KernelHandle = {
    view,
    get currentFile(): string {
      return current.file;
    },
    get docGeneration(): number {
      return generation;
    },
    get historyFlags(): { canUndo: boolean; canRedo: boolean } {
      return { ...flagsCache };
    },
    setDoc(file: string, doc: string): void {
      // Preserve cursor + approximate scroll across the swap (Monaco kept
      // per-path viewState; a single CM6 view re-anchors by head offset).
      const prevHead = view.state.selection.main.head;
      const prevLine = view.state.doc.lineAt(prevHead).number;
      const prevScroll =
        view.scrollDOM.scrollTop / Math.max(1, view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight);
      current = { ...current, file, doc };
      generation += 1;
      view.setState(createEditorState(current));
      const clampedLine = Math.min(prevLine, view.state.doc.lines);
      const anchor = view.state.doc.line(clampedLine).from;
      // K1 root fix: ONE scroll strategy — restore the normalized offset in a
      // single rAF (the old scrollIntoView-then-rAF pair fought for a frame).
      view.dispatch({ selection: { anchor } });
      const dom = view.scrollDOM;
      requestAnimationFrame(() => {
        dom.scrollTop = prevScroll * Math.max(0, dom.scrollHeight - dom.clientHeight);
      });
    },
    setAppearance(appearance: Cm6Appearance): void {
      current = { ...current, appearance };
      view.dispatch({
        effects: appearanceCompartment.reconfigure(appearanceExtension(appearance)),
      });
    },
    setReadOnly(flag: boolean): void {
      view.dispatch({
        effects: readOnlyCompartment.reconfigure(EditorState.readOnly.of(flag)),
      });
    },
    refreshLsp(root: string): void {
      const file = current.file;
      void cm6LspExtensions(root, file)
        .then((extensions) => {
          if (!view.dom.isConnected || current.file !== file) return;
          // 2026-09-06 user ask: a language WITHOUT a live LSP session still
          // gets basic code intelligence — document-word completion. Real
          // LSP extensions win whenever the attach produced them.
          view.dispatch({
            effects: docExtras.reconfigure(extensions.length ? extensions : [wordCompletionExtension]),
          });
        })
        // Fail-open: a rejected attach (IPC layer error, never the normal
        // `ok:false` path) must not surface as a floating rejection.
        .catch(() => {
          if (!view.dom.isConnected || current.file !== file) return;
          view.dispatch({ effects: docExtras.reconfigure([wordCompletionExtension]) });
        });
    },
    undo(): boolean {
      return undo(view);
    },
    redo(): boolean {
      return redo(view);
    },
    canUndo(): boolean {
      historySnapshot(view);
      return flagsCache.canUndo;
    },
    canRedo(): boolean {
      historySnapshot(view);
      return flagsCache.canRedo;
    },
    content(): string {
      return view.state.doc.toString();
    },
    setContent(content: string): void {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: content },
        annotations: aiTransaction.of(true),
      });
    },
    destroy(): void {
      if (diagTimer) clearTimeout(diagTimer);
      viewRef = null;
      view.destroy();
    },
  };
  historySnapshot(view);
  return handle;
}
