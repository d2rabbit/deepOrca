import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";
import { createPortal } from "react-dom";

import { api } from "../../api";
import { useI18n } from "../../i18n";
import type { KnowledgeSymbol } from "../../../shared/ipc";
import type { Cm6KernelHandle } from "./cm6-kernel";
import { jumpToLine } from "./cm6-deco";
import { fileBaseName } from "../../ui/path-utils";

type Props = {
  kernel: React.RefObject<Cm6KernelHandle | null>;
  /** Open a file (workspace store) — the palette only requests. */
  onOpenFile(file: string): void;
  /** Active file for the `.` in-file symbol mode. */
  activeFile: string | null;
  /** Open the pair bar prefilled with a symbol intent (visual draft D15). */
  onAskSymbol(symbolName: string, line: number, file: string): void;
  /** Selection intents (D13): run the pair bar against the live selection. */
  onPairIntent(instruction: string): void;
  /** Explicit command targets — synthetic KeyboardEvents to the window would
   *  silently break the moment the workspace key listener grows a
   *  target/focus check. */
  onTogglePair(): void;
  onSave(): void;
  /** 「解释」 intent → floating card (never rewrites the buffer). */
  onExplain?(): void;
  /** First diagnostic line if any (D13 fix-diagnostics command). */
  diagnosticsFirstLine: number | null;
  onClose(): void;
  /** Initial mode prefill: "" commands / "@" files / "#" symbols / "." in-file. */
  prefill?: "" | "@" | "#" | ".";
};

type Row =
  | { kind: "cmd"; id: string; label: string; run(): void }
  | { kind: "file"; name: string; dir: string }
  | { kind: "sym"; name: string; kindTag: string; path: string; line: number };

/** fzf-style subsequence match (spec §6.3: prefix > camel > subsequence).
 *  Zero-dependency by design — three modes share this one scorer. */
function fuzzyScore(term: string, text: string): number {
  if (!term) return 1;
  const t = term.toLowerCase();
  const x = text.toLowerCase();
  if (x.startsWith(t)) return 1000 - x.length;
  let score = 0;
  let ti = 0;
  let prevHit = -2;
  for (let i = 0; i < x.length && ti < t.length; i += 1) {
    if (x[i] === t[ti]) {
      score += prevHit === i - 1 ? 6 : 3; // consecutive runs score higher
      if (i === 0 || /[^a-z0-9]/.test(x[i - 1] ?? "")) score += 4; // word/camel boundary
      prevHit = i;
      ti += 1;
    }
  }
  return ti === t.length ? score : -1;
}

/**
 * Editor palette (specs/editor-copilot C4, visual draft D13/D14/D15): one
 * fzf surface, mode by prefix — ⌘K commands · ⌘P/@ files · ⌘T/# workspace
 * symbols (codegraph index via knowledge:listSymbols) · ⌘⇧O/. in-file
 * symbols. Enter opens & jumps; the ✦ button turns a hit into an AI intent.
 */
export function EditorPalette({
  kernel,
  onOpenFile,
  activeFile,
  onAskSymbol,
  onPairIntent,
  onTogglePair,
  onSave,
  onExplain,
  diagnosticsFirstLine,
  onClose,
  prefill = "",
}: Props): JSX.Element {
  const { t } = useI18n();
  const [query, setQuery] = useState<string>(prefill);
  const [idx, setIdx] = useState(0);
  const [symbols, setSymbols] = useState<KnowledgeSymbol[]>([]);
  const [symbolFiles, setSymbolFiles] = useState<Map<string, string>>(new Map());
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Index symbols: fetch once per open (LIMIT 300 server-side; the palette
  // filters in-memory — the registered-root/degradation contract stays in
  // the existing knowledge:listSymbols handler). Root omitted = active root.
  useEffect(() => {
    let cancelled = false;
    void api
      .knowledgeListSymbols("", "")
      .then((rows) => {
        if (cancelled) return;
        setSymbols(Array.isArray(rows) ? rows : []);
        const files = new Map<string, string>();
        for (const r of rows) {
          if (!files.has(r.filePath)) files.set(r.filePath, r.name);
        }
        setSymbolFiles(files);
      })
      .catch(() => {
        if (!cancelled) setSymbols([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const mode: "cmd" | "file" | "sym" | "cur" = query.startsWith("@")
    ? "file"
    : query.startsWith("#")
      ? "sym"
      : query.startsWith(".")
        ? "cur"
        : "cmd";
  const term = query.slice(1).trim();

  const commands = useMemo<Array<{ id: string; label: string; run(): void }>>(
    () => [
      {
        id: "pair",
        label: t("editor.palette.cmd.pair"),
        run: onTogglePair,
      },
      {
        id: "save",
        label: t("editor.palette.cmd.save"),
        run: onSave,
      },
      // D13: the visual draft's AI command set. 解释 routes to the floating
      // explain card (never rewrites the buffer); 重构/fixDiag keep the pair
      // bar rewrite path. 补测试 left the inline agent (user ask 2026-09-06) —
      // multi-file asks ride the main session.
      {
        id: "ai-explain",
        label: t("editor.palette.cmd.explain"),
        run: () => (onExplain ? onExplain() : onPairIntent(t("editor.pair.intent.explain.prompt"))),
      },
      {
        id: "ai-refactor",
        label: t("editor.palette.cmd.refactor"),
        run: () => onPairIntent(t("editor.pair.intent.refactor.prompt")),
      },
      ...(diagnosticsFirstLine !== null
        ? [
            {
              id: "ai-fixdiag",
              label: t("editor.palette.cmd.fixDiag"),
              run: () => {
                const view = kernel.current?.view;
                if (!view) return;
                const line = view.state.doc.line(Math.min(diagnosticsFirstLine, view.state.doc.lines));
                view.dispatch({ selection: { anchor: line.from, head: line.to } });
                view.focus();
                onPairIntent(t("editor.palette.cmd.fixDiag.prompt"));
              },
            },
          ]
        : []),
    ],
    [t, onPairIntent, diagnosticsFirstLine, kernel, onTogglePair, onSave, onExplain]
  );

  const rows = useMemo<Row[]>(() => {
    if (mode === "cmd") {
      return commands
        .map((c) => ({ row: { kind: "cmd" as const, ...c }, s: fuzzyScore(term, c.label) }))
        .filter((x) => x.s >= 0)
        .sort((a, b) => b.s - a.s)
        .map((x) => x.row);
    }
    if (mode === "file") {
      return [...symbolFiles.entries()]
        .map(([path, anyName]) => {
          const name = fileBaseName(path);
          const dir = path.slice(0, path.length - name.length);
          return { row: { kind: "file" as const, name, dir }, s: fuzzyScore(term, name + dir) };
        })
        .filter((x) => x.s >= 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, 50)
        .map((x) => x.row);
    }
    const list = symbols.filter((s) => (mode === "cur" ? s.filePath === activeFile : true));
    return list
      .map((s) => ({
        row: { kind: "sym" as const, name: s.name, kindTag: s.kind, path: s.filePath, line: s.startLine },
        s2: fuzzyScore(term, s.name),
      }))
      .filter((x) => x.s2 >= 0)
      .sort((a, b) => b.s2 - a.s2)
      .slice(0, 50)
      .map((x) => x.row);
  }, [mode, term, commands, symbolFiles, symbols, activeFile]);

  useEffect(() => {
    setIdx(0);
  }, [query]);

  // Re-audit #21: async symbols arriving shrink the row list — clamp the
  // cursor so Enter always has a target and the highlight never dangles.
  useEffect(() => {
    if (idx >= rows.length && rows.length > 0) setIdx(rows.length - 1);
  }, [rows.length, idx]);

  const openRow = useCallback(
    (row: Row, opts?: { keepOpen?: boolean }): void => {
      const close = opts?.keepOpen ? () => undefined : onClose;
      if (row.kind === "cmd") {
        close();
        row.run();
        return;
      }
      if (row.kind === "file") {
        close();
        onOpenFile(row.dir + row.name);
        return;
      }
      close();
      const sameFile = activeFile !== null && row.path === activeFile;
      if (sameFile) {
        const view = kernel.current?.view;
        if (view) jumpToLine(view, row.line);
      } else {
        onOpenFile(row.path);
        // Jump after the doc swap lands. The swap runs in a passive effect
        // whose ordering against a single rAF is not guaranteed, so defer
        // TWO frames — the same discipline askSymbol uses (M7); a single
        // rAF can select the target line on the OLD document.
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const view = kernel.current?.view;
            if (view) jumpToLine(view, row.line);
          });
        });
      }
    },
    [onClose, onOpenFile, kernel, activeFile]
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIdx((n) => Math.min(n + 1, Math.max(0, rows.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIdx((n) => Math.max(0, n - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = rows[idx];
      if (row) openRow(row);
    } else if (e.key === "Tab") {
      // D14 preview: jump WITHOUT closing — cursor moves (same file) or the
      // file opens + jumps while the palette stays up for the next query.
      e.preventDefault();
      const row = rows[idx];
      if (row) openRow(row, { keepOpen: true });
    } else if (e.key === "Escape") {
      e.preventDefault();
      // Re-audit #5: stop propagation — the workspace's window-level Esc
      // guard would otherwise close the ACTIVE FILE behind the palette.
      e.stopPropagation();
      onClose();
    }
  };

  const modeLabel =
    mode === "file"
      ? t("editor.palette.mode.files")
      : mode === "sym"
        ? t("editor.palette.mode.symbols")
        : mode === "cur"
          ? t("editor.palette.mode.infile")
          : t("editor.palette.mode.cmds");

  return createPortal(
    <div className="ui-edpalette-veil" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ui-edpalette" role="dialog" aria-label={t("editor.palette.title")}>
        <input
          ref={inputRef}
          className="ui-edpalette-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t("editor.palette.placeholder")}
        />
        <div className="ui-edpalette-list">
          {mode !== "cmd" || term ? (
            <div className="ui-edpalette-mode">
              ⌕ {modeLabel}
              {symbols.length === 0 && mode !== "file" ? (
                <span className="dim"> · {t("editor.palette.noIndex")}</span>
              ) : null}
            </div>
          ) : null}
          {rows.length === 0 ? <div className="ui-edpalette-empty">{t("editor.palette.empty")}</div> : null}
          {rows.map((row, i) => (
            <div
              key={
                row.kind === "cmd" ? row.id : row.kind === "file" ? row.dir + row.name : row.path + row.line + row.name
              }
              className={`ui-edpalette-row${i === idx ? " on" : ""}`}
              onMouseEnter={() => setIdx(i)}
              onClick={() => openRow(row)}
            >
              {row.kind === "cmd" ? (
                <>
                  <span className="ic">⌘</span>
                  <span className="name">{row.label}</span>
                </>
              ) : row.kind === "file" ? (
                <>
                  <span className="ic">⌗</span>
                  <span className="name mono">{row.name}</span>
                  <span className="pos mono">{row.dir}</span>
                </>
              ) : (
                <>
                  <span className="ic kind" data-kind={row.kindTag}>
                    {row.kindTag.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="name mono">{row.name}</span>
                  <span className="pos mono">
                    {fileBaseName(row.path)}:{row.line}
                  </span>
                  <button
                    type="button"
                    className="ask"
                    title={t("editor.palette.ask")}
                    onClick={(e) => {
                      e.stopPropagation();
                      onClose();
                      onAskSymbol(row.name, row.line, row.path);
                    }}
                  >
                    ✦
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
        <div className="ui-edpalette-foot">
          <span>
            <kbd>↑↓</kbd> {t("editor.palette.kbd.select")}
          </span>
          <span>
            <kbd>⏎</kbd> {t("editor.palette.kbd.open")}
          </span>
          <span>
            <kbd>Esc</kbd> {t("editor.palette.kbd.close")}
          </span>
          <span className="dim">@ # .</span>
        </div>
      </div>
    </div>,
    document.body
  );
}
