import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX } from "react";
import type { FileMatch, SkillInfo } from "../../shared/ipc";
import { useI18n, type MessageKey } from "../i18n";
import { isCompleteStoreRef, splitStoreRefSegments } from "../lib/store-refs";
import { FileMentionMenu } from "./FileMentionMenu";
import { Button, IconBook, IconMagicWand, IconPencil, IconShield, IconSparkle, IconTerminal, Switch } from "../ui/index";

type Props = {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  /** Gracefully pause the running task at the next checkpoint. */
  onPause?: () => void;
  /** Resume a paused/interrupted task. */
  onResume?: () => void;
  /** True when the active session can be resumed (paused/interrupted). */
  canResume?: boolean;
  /** Rewrite the draft via the flash model (magic-wand button). */
  onEnhance?: () => void;
  /** True while a prompt enhancement request is in flight. */
  enhancing?: boolean;
  busy: boolean;
  disabled: boolean;
  planMode: boolean;
  onTogglePlan: () => void;
  skills: SkillInfo[];
  selectedSkills: string[];
  onToggleSkill: (name: string) => void;
  statusText: string | null;
  errorText: string | null;

  /** Callback when a slash command is selected from the autocomplete. */
  onSlashCommand?: (command: string) => void;
  /** Attached images (data-URLs). */
  imageUrls?: string[];
  /** Remove an attached image. */
  onRemoveImage?: (index: number) => void;
  /** Add an image (data-URL) from clipboard paste or drag-drop. */
  onAddImage?: (dataUrl: string) => void;
};

type SlashCandidate = {
  kind: "skill" | "builtin";
  name: string;
  label: string;
  /** Builtin descriptions resolve through i18n; skills use their own text. */
  description: string;
};

type BuiltinSlash = {
  kind: "builtin";
  name: string;
  label: string;
  descKey: MessageKey;
};

const BUILTIN_SLASHES: BuiltinSlash[] = [
  { kind: "builtin", name: "skills", label: "/skills", descKey: "slash.desc.skills" },
  { kind: "builtin", name: "model", label: "/model", descKey: "slash.desc.model" },
  { kind: "builtin", name: "plan", label: "/plan", descKey: "slash.desc.plan" },
  { kind: "builtin", name: "new", label: "/new", descKey: "slash.desc.new" },
  { kind: "builtin", name: "init", label: "/init", descKey: "slash.desc.init" },
  { kind: "builtin", name: "resume", label: "/resume", descKey: "slash.desc.resume" },
  { kind: "builtin", name: "continue", label: "/continue", descKey: "slash.desc.continue" },
  { kind: "builtin", name: "undo", label: "/undo", descKey: "slash.desc.undo" },
  { kind: "builtin", name: "raw", label: "/raw", descKey: "slash.desc.raw" },
  { kind: "builtin", name: "mcp", label: "/mcp", descKey: "slash.desc.mcp" },
  { kind: "builtin", name: "exit", label: "/exit", descKey: "slash.desc.exit" },
  { kind: "builtin", name: "settings", label: "/settings", descKey: "slash.desc.settings" },
  { kind: "builtin", name: "pm-design", label: "/pm-design", descKey: "slash.desc.pmDesign" },
  { kind: "builtin", name: "pm-design-openui", label: "/pm-design-openui", descKey: "slash.desc.pmDesignOpenui" },
  { kind: "builtin", name: "prototype", label: "/prototype", descKey: "slash.desc.prototype" },
  { kind: "builtin", name: "openui", label: "/openui", descKey: "slash.desc.openui" },
  { kind: "builtin", name: "deep-design", label: "/deep-design", descKey: "slash.desc.deepDesign" },
  { kind: "builtin", name: "design", label: "/design", descKey: "slash.desc.design" },
];

/** Detect a token (starting with /, $ or @) at or before the cursor. */
function getCurrentToken(text: string, cursor: number): { token: string; start: number } | null {
  let start = cursor;
  while (start > 0 && !/\s/.test(text[start - 1] ?? "")) {
    start -= 1;
  }
  const token = text.slice(start, cursor);
  if (token.startsWith("/") || token.startsWith("$") || token.startsWith("@")) {
    return { token, start };
  }
  return null;
}

function filterSlashCandidates(items: SlashCandidate[], token: string): SlashCandidate[] {
  const query = token.slice(1).toLowerCase();
  if (!query) return items;
  return items.filter((item) => item.name.toLowerCase().includes(query));
}

// Memoized: all props are stable references from App (state slices + useCallback
// handlers), so App-level stream/busy ticks don't re-render the composer.
export const Composer = memo(function Composer(props: Props): JSX.Element {
  const {
    value,
    onChange,
    onSend,
    onStop,
    onPause,
    onResume,
    canResume = false,
    onEnhance,
    enhancing = false,
    busy,
    disabled,
    planMode,
    onTogglePlan,
    skills,
    selectedSkills,
    onToggleSkill,
    statusText,
    errorText,
    onSlashCommand,
    imageUrls = [],
    onRemoveImage,
    onAddImage,
  } = props;
  const { t } = useI18n();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const composerInnerRef = useRef<HTMLDivElement>(null);
  const [cursorPos, setCursorPos] = useState(0);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);
  // Drag-over highlight while image files hover above the card. A depth
  // counter is needed because dragenter/dragleave fire on every child the
  // pointer crosses — a plain boolean flickers.
  const [dragOver, setDragOver] = useState(false);
  const dragDepthRef = useRef(0);

  // File mention state
  const [showFileMenu, setShowFileMenu] = useState(false);
  const [fileQuery, setFileQuery] = useState("");
  const [fileTokenStart, setFileTokenStart] = useState(-1);

  // Undo/redo stacks for the textarea
  const undoStackRef = useRef<string[]>([]);
  const redoStackRef = useRef<string[]>([]);
  const skipUndoRecordRef = useRef(false);

  // Prompt history for Up/Down arrow navigation.
  const promptHistoryRef = useRef<string[]>([]);
  const [historyCursor, setHistoryCursor] = useState(-1);
  const draftBeforeHistoryRef = useRef<string | null>(null);

  // Build slash candidates from skills + builtins
  const slashItems = useMemo<SlashCandidate[]>(() => {
    const skillItems: SlashCandidate[] = skills.map((s) => ({
      kind: "skill" as const,
      name: s.name,
      label: `/${s.name}`,
      description: s.description || t("slash.noDescription"),
    }));
    return [...skillItems, ...BUILTIN_SLASHES.map((b) => ({ ...b, description: t(b.descKey) }))];
  }, [skills, t]);

  // Detect token (slash or at) at cursor
  const currentToken = useMemo(() => getCurrentToken(value, cursorPos), [value, cursorPos]);

  const slashToken = useMemo(() => (currentToken?.token.startsWith("/") ? currentToken.token : null), [currentToken]);
  // `$` opens a dedicated built-in-command menu (same UI as `/`, builtins only).
  const dollarToken = useMemo(() => (currentToken?.token.startsWith("$") ? currentToken.token : null), [currentToken]);
  const commandToken = slashToken ?? dollarToken;
  const atToken = useMemo(
    () => (currentToken?.token.startsWith("@") ? { token: currentToken.token, start: currentToken.start } : null),
    [currentToken]
  );
  // A COMPLETED store reference (a quoted wiki page / review report) is not a
  // file-mention query — keep the @ menu closed over it ("没有匹配的文件" over
  // a finished reference was pure noise, user report 2026-09-02).
  const atMentionToken = useMemo(() => (atToken && !isCompleteStoreRef(atToken.token) ? atToken : null), [atToken]);

  // Slash matches
  const slashMatches = useMemo(() => {
    if (slashToken) return filterSlashCandidates(slashItems, slashToken);
    if (dollarToken) {
      const builtins: SlashCandidate[] = BUILTIN_SLASHES.map((b) => ({ ...b, description: t(b.descKey) }));
      return filterSlashCandidates(builtins, dollarToken);
    }
    return [];
  }, [slashToken, dollarToken, slashItems, t]);

  // Auto-show/hide command menu on "/" or "$"
  useEffect(() => {
    if (slashMatches.length > 0 && !showFileMenu) {
      setShowSlashMenu(true);
      setSlashIndex((prev) => Math.min(prev, slashMatches.length - 1));
    } else if (!commandToken) {
      setShowSlashMenu(false);
    }
  }, [slashMatches, commandToken, showFileMenu]);

  // Auto-show/hide file mention menu on "@" — except over a completed store
  // reference, which is a finished citation, not a query.
  useEffect(() => {
    if (atMentionToken && !showSlashMenu) {
      setShowFileMenu(true);
      setFileQuery(atMentionToken.token.slice(1));
      setFileTokenStart(atMentionToken.start);
    } else if (!atMentionToken) {
      setShowFileMenu(false);
      setFileQuery("");
      setFileTokenStart(-1);
    }
  }, [atMentionToken, showSlashMenu]);

  // Auto-grow the textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  // ── Store-reference highlighting (user ask 2026-09-02: 输入框内的引用渲染
  // 要有专属标记) ─────────────────────────────────────────────────────────────
  // A plain textarea cannot render inline chips, so a transparent MIRROR layer
  // stacks above it (pointer-events: none) with identical text metrics and
  // draws pill markers over @…/.deeporca/… tokens. The textarea text stays
  // fully editable underneath — the pills are pure presentation, so IME
  // composition, undo and the send path are untouched.
  const refSegments = useMemo(() => (value ? splitStoreRefSegments(value) : []), [value]);
  const hasRefChip = useMemo(() => refSegments.some((s) => s.kind === "ref"), [refSegments]);

  // Copy the textarea's computed text metrics onto the mirror so the pills
  // land exactly under the raw tokens — themes may override padding/fonts on
  // .ui-prompt, so the values are read at runtime, not hardcoded.
  useLayoutEffect(() => {
    const ta = textareaRef.current;
    const mirror = mirrorRef.current;
    if (!ta || !mirror) return;
    const sync = (): void => {
      const cs = window.getComputedStyle(ta);
      for (const prop of [
        "fontFamily",
        "fontSize",
        "fontWeight",
        "fontStyle",
        "lineHeight",
        "letterSpacing",
        "paddingTop",
        "paddingRight",
        "paddingBottom",
        "paddingLeft",
        "borderTopWidth",
        "borderRightWidth",
        "borderBottomWidth",
        "borderLeftWidth",
        "boxSizing",
        "textIndent",
      ] as const) {
        mirror.style[prop] = cs[prop];
      }
      mirror.style.width = `${ta.clientWidth}px`;
      mirror.scrollTop = ta.scrollTop;
      mirror.scrollLeft = ta.scrollLeft;
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(ta);
    return () => ro.disconnect();
  }, [hasRefChip]);

  const syncMirrorScroll = useCallback((): void => {
    const ta = textareaRef.current;
    const mirror = mirrorRef.current;
    if (ta && mirror) {
      mirror.scrollTop = ta.scrollTop;
      mirror.scrollLeft = ta.scrollLeft;
    }
  }, []);

  // Auto-focus the textarea when the composer becomes enabled (e.g. session switch)
  const prevDisabledRef = useRef(disabled);
  useEffect(() => {
    if (prevDisabledRef.current && !disabled) {
      textareaRef.current?.focus();
    }
    prevDisabledRef.current = disabled;
  }, [disabled]);

  const canSend =
    !busy && !disabled && !enhancing && (value.trim().length > 0 || selectedSkills.length > 0 || imageUrls.length > 0);

  const applySlash = useCallback(
    (item: SlashCandidate) => {
      if (item.kind === "skill") {
        onToggleSkill(item.name);
        // Remove the command token ("/" or "$") from text
        const slashIdx = value.lastIndexOf("/", cursorPos - 1);
        const dollarIdx = value.lastIndexOf("$", cursorPos - 1);
        const idx = Math.max(slashIdx, dollarIdx);
        if (idx >= 0) {
          onChange(value.slice(0, idx) + value.slice(cursorPos));
        }
      } else {
        onSlashCommand?.(item.name);
      }
      setShowSlashMenu(false);
      textareaRef.current?.focus();
    },
    [value, cursorPos, onChange, onToggleSkill, onSlashCommand]
  );

  const applyFileMention = useCallback(
    (item: FileMatch) => {
      if (fileTokenStart < 0) return;
      const before = value.slice(0, fileTokenStart);
      const after = value.slice(cursorPos);
      const insertion = item.type === "directory" ? item.path + "/" : item.path;
      skipUndoRecordRef.current = true;
      onChange(`${before}@${insertion}${after ? " " + after : ""}`);
      setShowFileMenu(false);
      textareaRef.current?.focus();
    },
    [value, fileTokenStart, cursorPos, onChange]
  );

  function pushUndo(text: string): void {
    if (skipUndoRecordRef.current) {
      skipUndoRecordRef.current = false;
      return;
    }
    undoStackRef.current.push(text);
    if (undoStackRef.current.length > 200) {
      undoStackRef.current = undoStackRef.current.slice(-200);
    }
    redoStackRef.current = [];
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    // ═══ IME composition guard (CJK input) ═══
    // While an IME composition is active (pinyin/kana/hangul candidates on
    // screen) the OS fires real keydowns for Enter/arrows/Escape — Enter
    // COMMITS the candidate and must never send a half-composed prompt,
    // Escape cancels the composition (not the running task), and the
    // arrows walk candidates (not prompt history).
    if (e.nativeEvent.isComposing) return;

    // ═══ File mention menu navigation ═══
    if (showFileMenu) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        return; // handled by FileMentionMenu internally via mouseEnter
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setShowFileMenu(false);
        return;
      }
      // Enter defers to the menu (it inserts the highlighted file via its own
      // window listener). Sending here would BOTH fire the half-typed prompt
      // and let the menu's stale closure re-insert the path into the cleared
      // draft — so the send branch below must not run while the menu is open.
      if (e.key === "Enter") {
        e.preventDefault();
        return;
      }
    }

    // ═══ Slash menu navigation ═══
    if (showSlashMenu && slashMatches.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashIndex((i) => (i + 1) % slashMatches.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashIndex((i) => (i - 1 + slashMatches.length) % slashMatches.length);
        return;
      }
      if (e.key === "Tab" || e.key === "Enter") {
        e.preventDefault();
        applySlash(slashMatches[slashIndex]!);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setShowSlashMenu(false);
        return;
      }
    }

    // ═══ Undo/Redo (Cmd+Z / Cmd+Shift+Z) ═══
    if ((e.metaKey || e.ctrlKey) && e.key === "z") {
      e.preventDefault();
      if (e.shiftKey) {
        // Redo
        const next = redoStackRef.current.pop();
        if (next !== undefined) {
          undoStackRef.current.push(value);
          onChange(next);
        }
      } else {
        // Undo
        const prev = undoStackRef.current.pop();
        if (prev !== undefined) {
          redoStackRef.current.push(value);
          onChange(prev);
        }
      }
      return;
    }

    // Plan mode toggle via Shift+Tab
    if (e.shiftKey && e.key === "Tab") {
      e.preventDefault();
      onTogglePlan();
      return;
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!busy && !disabled && canSend) {
        // Save to prompt history before sending
        const trimmed = value.trim();
        if (trimmed) {
          promptHistoryRef.current = [...promptHistoryRef.current.slice(-49), trimmed];
        }
        setHistoryCursor(-1);
        draftBeforeHistoryRef.current = null;
        onSend();
      }
      return;
    }

    if (e.key === "Escape" && busy) {
      e.preventDefault();
      onStop();
      return;
    }

    // ═══ Prompt history navigation (Up/Down arrow) ═══
    // Only activate when no menu is open and cursor is at start (Up) or end (Down) of text.
    if (e.key === "ArrowUp" && !showSlashMenu && !showFileMenu) {
      const history = promptHistoryRef.current;
      if (history.length > 0) {
        const textarea = textareaRef.current;
        const atStart = textarea ? textarea.selectionStart === 0 && textarea.selectionEnd === 0 : true;
        if (atStart || value === "") {
          e.preventDefault();
          const prevCursor = historyCursor === -1 ? history.length : historyCursor;
          const nextCursor = Math.max(0, prevCursor - 1);
          if (historyCursor === -1) {
            draftBeforeHistoryRef.current = value;
          }
          setHistoryCursor(nextCursor);
          onChange(history[nextCursor] ?? "");
          return;
        }
      }
    }
    if (e.key === "ArrowDown" && !showSlashMenu && !showFileMenu && historyCursor !== -1) {
      e.preventDefault();
      const history = promptHistoryRef.current;
      const nextCursor = Math.min(history.length, historyCursor + 1);
      if (nextCursor === history.length) {
        onChange(draftBeforeHistoryRef.current ?? "");
        setHistoryCursor(-1);
        draftBeforeHistoryRef.current = null;
      } else {
        setHistoryCursor(nextCursor);
        onChange(history[nextCursor] ?? "");
      }
      return;
    }
  }

  function handleSelect(e: React.SyntheticEvent<HTMLTextAreaElement>): void {
    setCursorPos(e.currentTarget.selectionStart ?? 0);
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>): void {
    pushUndo(value);
    onChange(e.target.value);
    setCursorPos(e.target.selectionStart ?? 0);
  }

  // ── Image paste (Ctrl+V with image in clipboard) ──────────────────────────
  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>): void {
    if (!onAddImage) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === "string") {
            onAddImage(reader.result);
          }
        };
        reader.readAsDataURL(file);
        return;
      }
    }
    // No image in clipboard — let default text paste proceed.
  }

  // ── Drag & drop image files onto the composer card ────────────────────────
  function hasFiles(e: React.DragEvent<HTMLDivElement>): boolean {
    return e.dataTransfer?.types.includes("Files") ?? false;
  }

  function handleDragEnter(e: React.DragEvent<HTMLDivElement>): void {
    if (!onAddImage || !hasFiles(e)) return;
    e.preventDefault();
    dragDepthRef.current += 1;
    setDragOver(true);
  }

  function handleDragLeave(): void {
    if (!onAddImage) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragOver(false);
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>): void {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>): void {
    dragDepthRef.current = 0;
    setDragOver(false);
    if (!onAddImage) return;
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;
    let handled = false;
    for (const file of files) {
      if (file.type.startsWith("image/")) {
        handled = true;
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === "string") {
            onAddImage(reader.result);
          }
        };
        reader.readAsDataURL(file);
      }
    }
    if (handled) e.preventDefault();
  }

  return (
    <div className="ui-composer" ref={composerInnerRef}>
      {/* Slash command autocomplete menu */}
      {showSlashMenu && slashMatches.length > 0 ? (
        <div className="ui-slash-menu">
          {slashMatches.map((item, i) => (
            <button
              key={item.label}
              className={`ui-slash-option${i === slashIndex ? " active" : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                applySlash(item);
              }}
              onMouseEnter={() => setSlashIndex(i)}
            >
              <span className="ui-slash-label">
                {item.label}
                {item.kind === "skill" ? (selectedSkills.includes(item.name) ? " ✓" : "") : ""}
              </span>
              <span className="ui-slash-desc">{item.description}</span>
            </button>
          ))}
        </div>
      ) : null}

      {/* File mention (@) autocomplete menu */}
      {showFileMenu ? (
        <FileMentionMenu
          open={showFileMenu}
          query={fileQuery}
          onSelect={applyFileMention}
          onClose={() => setShowFileMenu(false)}
        />
      ) : null}

      {/* Unified floating composer card: attachments → input → toolbar */}
      <div
        className={`ui-composer-card${planMode ? " plan-mode" : ""}${busy ? " busy" : ""}${canSend ? " ready" : ""}${
          dragOver ? " drag-over" : ""
        }`}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {/* Plan mode badge */}
        {planMode ? <span className="ui-composer-plan-badge">{t("composer.planMode") || "Plan"}</span> : null}
        {/* Attachments zone: images + selected skill chips */}
        {imageUrls.length > 0 || selectedSkills.length > 0 ? (
          <div className="ui-composer-attachments">
            {imageUrls.length > 0 ? (
              <div className="ui-image-attachments">
                {imageUrls.map((url, i) => (
                  <div key={i} className="ui-image-attachment">
                    <img src={url} alt={t("composer.imageAlt", { n: i + 1 })} />
                    <button
                      className="remove-btn"
                      onClick={() => onRemoveImage?.(i)}
                      title={t("common.remove")}
                      aria-label={t("common.remove")}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
            {selectedSkills.length > 0 ? (
              <div className="ui-skill-chips">
                {selectedSkills.map((name) => {
                  const info = skills.find((s) => s.name === name);
                  return (
                    <div key={name} className="ui-composer-skill-card" title={info?.description || name}>
                      <span className="ui-composer-skill-card-icon" aria-hidden="true">
                        <IconSparkle />
                      </span>
                      <div className="ui-composer-skill-card-main">
                        <span className="ui-composer-skill-card-name">{name}</span>
                        {info?.description ? (
                          <span className="ui-composer-skill-card-desc">{info.description}</span>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        className="ui-composer-skill-card-remove"
                        onClick={() => onToggleSkill(name)}
                        title={t("composer.removeSkill")}
                        aria-label={t("composer.removeSkill")}
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Input (+ reference-highlight mirror layer) */}
        <div className="ui-prompt-wrap">
          {hasRefChip ? (
            <div ref={mirrorRef} className="ui-prompt-mirror" aria-hidden>
              {refSegments.map((seg, i) => {
                if (seg.kind === "text") return <span key={i}>{seg.text}</span>;
                // The cover span repeats the RAW token (transparent ink) so the
                // mirror's metrics match the textarea character-for-character,
                // and its opaque card-colored fill hides the raw path the
                // textarea paints underneath (user report 2026-09-02: the old
                // label-only pill leaked the rest of the absolute path). The
                // chip is ATOMIC — a caret inside the token only lights the
                // chip's accent ring, the raw path never shows; deleting the
                // token drops the chip back to plain text naturally.
                const editing = cursorPos >= seg.ref.start && cursorPos <= seg.ref.end;
                return (
                  <span key={i} className={`ui-prompt-ref-cover ${seg.ref.kind}${editing ? " editing" : ""}`}>
                    <span className={`ui-prompt-ref-chip ${seg.ref.kind}${editing ? " editing" : ""}`}>
                      {seg.ref.kind === "wiki" ? (
                        <IconBook />
                      ) : seg.ref.kind === "review" ? (
                        <IconShield />
                      ) : seg.ref.kind === "cmd" ? (
                        <IconTerminal />
                      ) : seg.ref.kind === "skill" ? (
                        <IconSparkle />
                      ) : (
                        <IconPencil />
                      )}
                      {seg.ref.label}
                    </span>
                    {seg.ref.raw}
                  </span>
                );
              })}
              {value.endsWith("\n") ? <span>{"\u200b"}</span> : null}
            </div>
          ) : null}
          <textarea
            ref={textareaRef}
            className="ui-prompt"
            rows={1}
            placeholder={
              disabled
                ? t("composer.respondAbove")
                : planMode
                  ? t("composer.planPlaceholder") || "Describe the plan..."
                  : t("composer.askPlaceholder")
            }
            value={value}
            disabled={disabled}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onSelect={handleSelect}
            onClick={handleSelect}
            onScroll={syncMirrorScroll}
            onPaste={handlePaste}
          />
        </div>

        {/* Bottom toolbar: plan toggle + status · hint + send/stop */}
        <div className="ui-composer-toolbar">
          <div className="ui-composer-toolbar-left">
            <Switch checked={planMode} onChange={onTogglePlan} label={t("composer.planMode")} />
            {busy || errorText || statusText ? (
              <span className="ui-status-strip">
                {busy ? (
                  <span className="ui-thinking-dots">
                    <span />
                    <span />
                    <span />
                  </span>
                ) : null}
                {errorText ? (
                  <span className="err-strip">{errorText}</span>
                ) : statusText ? (
                  <span>{statusText}</span>
                ) : null}
              </span>
            ) : null}
          </div>
          <div className="ui-composer-toolbar-right">
            {value.length > 0 ? (
              <span className={`ui-composer-charcount${value.length > 2000 ? " warn" : ""}`}>{value.length}</span>
            ) : null}
            <span className="ui-composer-hint">
              {planMode ? t("composer.planHint") || "Type a plan request · Shift+Tab to toggle" : t("composer.hint")}
            </span>
            {busy ? (
              <>
                {onPause ? (
                  <Button size="sm" onClick={onPause} title={t("composer.pausing")}>
                    {t("composer.pause")}
                  </Button>
                ) : null}
                <Button variant="danger" size="sm" onClick={onStop}>
                  {t("composer.stop")}
                </Button>
              </>
            ) : (
              <>
                {onEnhance ? (
                  <Button
                    size="sm"
                    icon
                    className={`ui-composer-enhance${enhancing ? " enhancing" : ""}`}
                    onClick={onEnhance}
                    disabled={enhancing || disabled || value.trim().length === 0}
                    title={enhancing ? t("composer.enhancing") : t("composer.enhance")}
                    aria-label={t("composer.enhance")}
                  >
                    <IconMagicWand />
                  </Button>
                ) : null}
                {canResume && onResume ? (
                  <Button variant="primary" size="sm" onClick={onResume} disabled={disabled}>
                    {t("composer.resume")}
                  </Button>
                ) : null}
                <Button variant="primary" size="sm" onClick={onSend} disabled={!canSend}>
                  {t("composer.send")}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});
