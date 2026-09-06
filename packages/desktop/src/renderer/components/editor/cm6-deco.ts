// AI decoration domain for the CM6 kernel (specs/editor-copilot A4).
// Ported from the validated proof (designs/proof-codemirror6.html): one
// StateField holding a RangeSet of Decorations that maps automatically
// through every transaction (`deco.map(tr.changes)`), so streaming inserts
// never need hand-maintained ranges (the Monaco deltaDecorations gap).
//
// RangeSet ordering contract (learned in the proof, keep in mind when
// building ranges): same-`from` ranges must be sorted by startSide ascending
// — block widget (side:-1 ⇒ BlockBefore ≈ -4e8) < line (-2e8) < mark
// (non-inclusive start ≈ 5e8). Always emit [widget, line, mark] at one pos.

import { Decoration, EditorView, gutter, GutterMarker, WidgetType, type DecorationSet } from "@codemirror/view";
import { RangeSet, StateEffect, StateField, type Range } from "@codemirror/state";

/** Incrementally accumulate decorations (streaming: one row per step). */
export const addAi = StateEffect.define<Range<Decoration>[]>();
/** Replace the whole set (phase switch: pending → review state). */
export const setAi = StateEffect.define<DecorationSet>();
/** Clear the domain (applied / discarded). */
export const clearAi = StateEffect.define<null>();

export const aiField = StateField.define<DecorationSet>({
  create: () => RangeSet.empty,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(clearAi)) deco = RangeSet.empty;
      else if (e.is(setAi)) deco = e.value;
      else if (e.is(addAi)) deco = deco.update({ add: e.value });
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** Gutter dot on any line carrying an AI decoration (pending/add/del). */
class AiMarker extends GutterMarker {
  constructor(private readonly kind: AiKind) {
    super();
  }
  toDOM(): HTMLElement {
    const s = document.createElement("span");
    s.className = "ui-cm6-ai-gutt";
    s.textContent = this.kind === "del" ? "−" : this.kind === "add" ? "+" : "·";
    return s;
  }
}
type AiKind = "pending" | "add" | "del" | "hunk";

export const aiGutter = gutter({
  class: "ui-cm6-ai-gutter",
  lineMarker(view, line) {
    const deco = view.state.field(aiField);
    let hit: AiKind | null = null;
    deco.between(line.from, line.to, (_f, _t, d) => {
      hit = (d.spec?.kind as AiKind) ?? hit;
    });
    return hit ? new AiMarker(hit) : null;
  },
});

/** Hunk chip — interactive block widget rendered between lines (review state). */
let hunkWidgetSeq = 0;

export class HunkChipWidget extends WidgetType {
  /** Monotonic id — eq compares it so a new run's chip NEVER reuses the
   *  previous widget's DOM (and its stale accept/reject closures). */
  readonly id: number = (hunkWidgetSeq += 1);

  constructor(
    readonly label: string,
    private readonly onAccept: () => void,
    private readonly onReject: () => void
  ) {
    super();
  }
  toDOM(): HTMLElement {
    const d = document.createElement("span");
    d.className = "ui-cm6-hunk";
    const label = document.createElement("b");
    label.textContent = this.label;
    const ok = document.createElement("button");
    ok.type = "button";
    ok.className = "ok";
    ok.textContent = "✓";
    const no = document.createElement("button");
    no.type = "button";
    no.className = "no";
    no.textContent = "✕";
    ok.addEventListener("click", (e) => {
      e.stopPropagation();
      this.onAccept();
    });
    no.addEventListener("click", (e) => {
      e.stopPropagation();
      this.onReject();
    });
    d.append(label, ok, no);
    return d;
  }
  eq(other: HunkChipWidget): boolean {
    return other.id === this.id;
  }
  ignoreEvent(): boolean {
    return false; // let the buttons receive clicks
  }
}

/** Pending (streaming) line + first-char mark, proof-validated ordering. */
export function pendingLineRanges(pos: number): Range<Decoration>[] {
  return [
    Decoration.line({ class: "ui-cm6-pending-line", kind: "pending" }).range(pos),
    Decoration.mark({ class: "ui-cm6-pending", kind: "pending", inclusiveStart: true }).range(pos, pos + 1),
  ];
}

/** Review-state decorations for one AI edit block (del ghost + add lines + chip). */
export function reviewRanges(opts: {
  chipLabel: string;
  chipAt: number;
  onAccept: () => void;
  onReject: () => void;
  del?: { from: number; to: number } | null;
  addLines?: number[];
}): Range<Decoration>[] {
  // Ordering: widget (BlockBefore) must come FIRST at the same `from`.
  const ranges: Range<Decoration>[] = [
    Decoration.widget({
      widget: new HunkChipWidget(opts.chipLabel, opts.onAccept, opts.onReject),
      block: true,
      side: -1,
      kind: "hunk",
    }).range(opts.chipAt),
  ];
  if (opts.del) {
    ranges.push(
      Decoration.line({ class: "ui-cm6-del-line", kind: "del" }).range(opts.del.from),
      Decoration.mark({ class: "ui-cm6-del", kind: "del" }).range(opts.del.from, opts.del.to)
    );
  }
  for (const pos of opts.addLines ?? []) {
    ranges.push(Decoration.line({ class: "ui-cm6-add-line", kind: "add" }).range(pos));
  }
  return ranges;
}

/** Quick-navigation jump: scroll target line into view + accent pulse.
 *  Stateless — the pulse is a transient DOM class on the line element, so it
 *  never disturbs the AI decoration set. */
export function jumpToLine(view: EditorView, line: number): void {
  const max = view.state.doc.lines;
  const target = Math.max(1, Math.min(line, max));
  const l = view.state.doc.line(target);
  view.dispatch({
    selection: { anchor: l.from },
    effects: EditorView.scrollIntoView(l.from, { y: "center" }),
  });
  const dom = view.domAtPos(l.from);
  const el = dom.node.nodeType === Node.ELEMENT_NODE ? (dom.node as HTMLElement) : dom.node.parentElement;
  const lineEl = el?.classList.contains("cm-line") ? el : (el?.parentElement ?? null);
  if (lineEl?.classList.contains("cm-line")) {
    lineEl.classList.add("ui-cm6-jump");
    window.setTimeout(() => lineEl.classList.remove("ui-cm6-jump"), 1400);
  }
}
