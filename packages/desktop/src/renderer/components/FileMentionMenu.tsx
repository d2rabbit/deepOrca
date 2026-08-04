import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import type { FileMatch } from "../../shared/ipc";
import { api } from "../api";

/** SVG icon for a directory folder. */
function FolderIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <path
        d="M1.5 3.5A1 1 0 0 1 2.5 2.5h3.586a1 1 0 0 1 .707.293l1.414 1.414a1 1 0 0 0 .707.293h4.586a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-8z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** SVG icon for a file document. */
function FileIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <path
        d="M3.5 2.5h6l3 3v7a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M9.5 2.5v3h3" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

type Props = {
  /** Whether the menu is visible (based on @ token detection). */
  open: boolean;
  /** The current partial query after @. */
  query: string;
  /** Called when a file/directory is selected. */
  onSelect: (item: FileMatch) => void;
  /** Called to close the menu. */
  onClose: () => void;
  /** Cursor position for placement. */
  anchorRect?: DOMRect | null;
};

export function FileMentionMenu({ open, query, onSelect, onClose, anchorRect }: Props): JSX.Element | null {
  const [items, setItems] = useState<FileMatch[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Monotonic request id: an in-flight scanFiles whose id no longer matches the
  // latest is stale (user typed more / menu closed) and its result is discarded
  // so an older, slower query can't overwrite a newer one.
  const reqIdRef = useRef(0);

  // Fetch files when query changes (debounced)
  useEffect(() => {
    if (!open || !query.trim()) {
      setItems([]);
      return;
    }

    setLoading(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const myReqId = ++reqIdRef.current;
    debounceRef.current = setTimeout(async () => {
      try {
        const results = await api.scanFiles(query);
        // Discard stale results: a newer keystroke may have fired another scan,
        // or the menu may have closed.
        if (myReqId !== reqIdRef.current) return;
        setItems(results);
        setActiveIndex(0);
      } catch {
        if (myReqId !== reqIdRef.current) return;
        setItems([]);
      } finally {
        if (myReqId === reqIdRef.current) {
          setLoading(false);
        }
      }
    }, 150);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      // Invalidate any in-flight request when the effect re-runs (query/open
      // changed) so its late-arriving result won't overwrite the newer state.
      reqIdRef.current++;
    };
  }, [open, query]);

  const handleSelect = useCallback(
    (item: FileMatch) => {
      onSelect(item);
      onClose();
    },
    [onSelect, onClose]
  );

  // Keyboard navigation
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % Math.max(1, items.length));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + items.length) % Math.max(1, items.length));
      } else if (e.key === "Enter" && items.length > 0) {
        e.preventDefault();
        const item = items[activeIndex];
        if (item) handleSelect(item);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, items, activeIndex, handleSelect, onClose]);

  if (!open) return null;

  return (
    <div
      className="ui-file-mention-menu"
      style={anchorRect ? { maxHeight: Math.min(240, window.innerHeight - anchorRect.bottom - 20) } : undefined}
    >
      {loading ? (
        <div className="ui-file-mention-loading">
          <span className="ui-file-mention-spinner" />
          Scanning…
        </div>
      ) : items.length === 0 ? (
        <div className="ui-file-mention-empty">{query ? "No matching files" : "Type to search files…"}</div>
      ) : (
        items.map((item, i) => (
          <button
            key={item.path}
            className={`ui-file-mention-option${i === activeIndex ? " active" : ""}${item.type === "directory" ? " is-dir" : ""}`}
            onMouseDown={(e) => {
              e.preventDefault();
              handleSelect(item);
            }}
            onMouseEnter={() => setActiveIndex(i)}
          >
            <span className="ui-file-mention-icon">{item.type === "directory" ? <FolderIcon /> : <FileIcon />}</span>
            <span className="ui-file-mention-path">{item.path}</span>
            <span className="ui-file-mention-type">
              {item.type === "directory" ? "dir" : (item.path.split(".").pop() ?? "")}
            </span>
          </button>
        ))
      )}
    </div>
  );
}
