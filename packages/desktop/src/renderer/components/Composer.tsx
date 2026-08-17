import { memo, useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";
import type { FileMatch, SkillInfo } from "../../shared/ipc";
import { useI18n } from "../i18n";
import { FileMentionMenu } from "./FileMentionMenu";
import { Button, Switch, IconMagicWand } from "../ui/index";

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
  description: string;
};

const BUILTIN_SLASHES: SlashCandidate[] = [
  { kind: "builtin", name: "skills", label: "/skills", description: "Browse and toggle available skills" },
  { kind: "builtin", name: "model", label: "/model", description: "Switch model, thinking mode, or effort" },
  { kind: "builtin", name: "plan", label: "/plan", description: "Toggle Plan Mode on/off" },
  { kind: "builtin", name: "new", label: "/new", description: "Start a fresh conversation" },
  { kind: "builtin", name: "init", label: "/init", description: "Generate an AGENTS.md for this project" },
  { kind: "builtin", name: "resume", label: "/resume", description: "Pick a previous conversation" },
  { kind: "builtin", name: "continue", label: "/continue", description: "Continue current conversation" },
  { kind: "builtin", name: "undo", label: "/undo", description: "Restore to a previous checkpoint" },
  { kind: "builtin", name: "raw", label: "/raw", description: "Cycle reasoning display (collapse/expand/hide)" },
  { kind: "builtin", name: "mcp", label: "/mcp", description: "View MCP server status and tools" },
  { kind: "builtin", name: "exit", label: "/exit", description: "Quit DeepOrca" },
  { kind: "builtin", name: "settings", label: "/settings", description: "Open settings panel" },
  {
    kind: "builtin",
    name: "pm-design",
    label: "/pm-design",
    description: "PM-Design: create an interactive A2UI prototype",
  },
  {
    kind: "builtin",
    name: "pm-design-openui",
    label: "/pm-design-openui",
    description: "PM-Design (OpenUI Lang): prototype with compact syntax",
  },
  { kind: "builtin", name: "prototype", label: "/prototype", description: "Alias for /pm-design" },
  { kind: "builtin", name: "openui", label: "/openui", description: "Alias for /pm-design-openui" },
  {
    kind: "builtin",
    name: "deep-design",
    label: "/deep-design",
    description: "DeepDesign: generate a web design in .dd format",
  },
  { kind: "builtin", name: "design", label: "/design", description: "Alias for /deep-design" },
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
  const composerInnerRef = useRef<HTMLDivElement>(null);
  const [cursorPos, setCursorPos] = useState(0);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);

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
      description: s.description || "(no description)",
    }));
    return [...skillItems, ...BUILTIN_SLASHES];
  }, [skills]);

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

  // Slash matches
  const slashMatches = useMemo(() => {
    if (slashToken) return filterSlashCandidates(slashItems, slashToken);
    if (dollarToken) return filterSlashCandidates(BUILTIN_SLASHES, dollarToken);
    return [];
  }, [slashToken, dollarToken, slashItems]);

  // Auto-show/hide command menu on "/" or "$"
  useEffect(() => {
    if (slashMatches.length > 0 && !showFileMenu) {
      setShowSlashMenu(true);
      setSlashIndex((prev) => Math.min(prev, slashMatches.length - 1));
    } else if (!commandToken) {
      setShowSlashMenu(false);
    }
  }, [slashMatches, commandToken, showFileMenu]);

  // Auto-show/hide file mention menu on "@"
  useEffect(() => {
    if (atToken && !showSlashMenu) {
      setShowFileMenu(true);
      setFileQuery(atToken.token.slice(1));
      setFileTokenStart(atToken.start);
    } else if (!atToken) {
      setShowFileMenu(false);
      setFileQuery("");
      setFileTokenStart(-1);
    }
  }, [atToken, showSlashMenu]);

  // Auto-grow the textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  // Auto-focus the textarea when the composer becomes enabled (e.g. session switch)
  const prevDisabledRef = useRef(disabled);
  useEffect(() => {
    if (prevDisabledRef.current && !disabled) {
      textareaRef.current?.focus();
    }
    prevDisabledRef.current = disabled;
  }, [disabled]);

  const canSend = !busy && !disabled && !enhancing && (value.trim().length > 0 || selectedSkills.length > 0);

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
  function handleDragOver(e: React.DragEvent<HTMLDivElement>): void {
    if (!onAddImage) return;
    if (e.dataTransfer.types.includes("Files")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>): void {
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
        className={`ui-composer-card${planMode ? " plan-mode" : ""}${busy ? " busy" : ""}${canSend ? " ready" : ""}`}
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
                    <img src={url} alt={`Attached ${i + 1}`} />
                    <button className="remove-btn" onClick={() => onRemoveImage?.(i)} title={t("common.remove")}>
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
                        ✦
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

        {/* Input */}
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
          onPaste={handlePaste}
        />

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
