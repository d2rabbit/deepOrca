import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";
import type { FileMatch } from "../../shared/ipc";
import { api } from "../api";
import { useI18n } from "../i18n";
import { IconBook, IconFileOutline, IconFolderOutline, IconShield } from "../ui/icons";
import { reviewStorePath, wikiStorePath } from "../lib/generated-paths";

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
  /**
   * Registered workspace root — scopes the wiki-page / review-report groups
   * injected into the menu (2026-09-05 fix 1: these stores were excluded from
   * the filesystem scan, so the only way to reference them was the panels'
   * quote bridge). Absent → store groups are skipped (fail-open).
   */
  root?: string;
};

type StoreGroupItem = FileMatch & { kind: "wiki" | "review"; title: string };

export function FileMentionMenu({ open, query, onSelect, onClose, anchorRect, root }: Props): JSX.Element | null {
  const { t } = useI18n();
  const [items, setItems] = useState<FileMatch[]>([]);
  const [storeItems, setStoreItems] = useState<StoreGroupItem[]>([]);
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
      //
      // exhaustive-deps warns the ref may have changed by cleanup time and
      // suggests copying it into a local. That advice is wrong here: reading the
      // *current* value and bumping it is the whole mechanism — copying it would
      // increment a stale counter and stop invalidating anything.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      reqIdRef.current++;
    };
  }, [open, query]);

  // Store groups (fix 1): wiki pages + review reports as first-class mention
  // items. Refreshed whenever the menu opens; filtered by query locally.
  useEffect(() => {
    if (!open || !root) {
      setStoreItems([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const wiki: StoreGroupItem[] = await api
        .wikiListPages(root)
        .then((pages) =>
          pages.map((page) => ({
            path: wikiStorePath(root, page.path),
            type: "file" as const,
            kind: "wiki" as const,
            title: page.title,
          }))
        )
        .catch(() => [] as StoreGroupItem[]);
      const reviews: StoreGroupItem[] = await api
        .reviewListReports(root)
        .then((reports) =>
          reports.map((r) => ({
            path: reviewStorePath(root, r.id),
            type: "file" as const,
            kind: "review" as const,
            title: r.generatedAt ? `${r.generatedAt.slice(0, 10)}${r.status ? ` · ${r.status}` : ""}` : r.id,
          }))
        )
        .catch(() => [] as StoreGroupItem[]);
      if (!cancelled) setStoreItems([...wiki, ...reviews]);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, root]);

  const handleSelect = useCallback(
    (item: FileMatch) => {
      onSelect(item);
      onClose();
    },
    [onSelect, onClose]
  );

  // Combined list: store groups first (they are the scarcer, semantic refs),
  // then filesystem matches — query-filtered on path + title.
  const combined: FileMatch[] = useMemo(() => {
    const lowerQuery = query.trim().toLowerCase();
    const matchedStore = storeItems.filter(
      (item) =>
        !lowerQuery || item.path.toLowerCase().includes(lowerQuery) || item.title.toLowerCase().includes(lowerQuery)
    );
    return [...matchedStore, ...items];
  }, [query, storeItems, items]);

  // Keyboard navigation
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % Math.max(1, combined.length));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + combined.length) % Math.max(1, combined.length));
      } else if (e.key === "Enter" && combined.length > 0) {
        e.preventDefault();
        const item = combined[activeIndex];
        if (item) handleSelect(item);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, combined, activeIndex, handleSelect, onClose]);

  if (!open) return null;

  return (
    <div
      className="ui-file-mention-menu"
      style={anchorRect ? { maxHeight: Math.min(240, window.innerHeight - anchorRect.bottom - 20) } : undefined}
    >
      {loading && combined.length === 0 ? (
        <div className="ui-file-mention-loading">
          <span className="ui-file-mention-spinner" />
          {t("fileMenu.scanning")}
        </div>
      ) : combined.length === 0 ? (
        <div className="ui-file-mention-empty">{query ? t("fileMenu.noMatch") : t("fileMenu.typeToSearch")}</div>
      ) : (
        <>
          {/* Stale results stay visible while a new scan runs — replacing
              them with a spinner on every keystroke made the list flicker. */}
          {loading ? (
            <div className="ui-file-mention-loading ui-file-mention-refreshing">
              <span className="ui-file-mention-spinner" />
            </div>
          ) : null}
          {combined.map((item, i) => {
            const isStore = item.kind === "wiki" || item.kind === "review";
            // Store items carry absolute store paths — when the page has no
            // frontmatter title, fall back to the basename, never the whole
            // absolute path. Filesystem items show their workspace-relative
            // path as before.
            const display = isStore ? (item.title ?? item.path.split(/[\\/]/).pop() ?? item.path) : item.path;
            return (
              <button
                key={`${item.kind ?? "fs"}:${item.path}`}
                className={`ui-file-mention-option${i === activeIndex ? " active" : ""}${item.type === "directory" ? " is-dir" : ""}${isStore ? " is-store" : ""}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleSelect(item);
                }}
                onMouseEnter={() => setActiveIndex(i)}
              >
                <span className="ui-file-mention-icon">
                  {item.kind === "wiki" ? (
                    <IconBook />
                  ) : item.kind === "review" ? (
                    <IconShield />
                  ) : item.type === "directory" ? (
                    <IconFolderOutline />
                  ) : (
                    <IconFileOutline />
                  )}
                </span>
                <span className="ui-file-mention-path">{display}</span>
                <span className="ui-file-mention-type">
                  {item.kind === "wiki"
                    ? t("fileMenu.wiki")
                    : item.kind === "review"
                      ? t("fileMenu.review")
                      : item.type === "directory"
                        ? t("fileMenu.dir")
                        : (item.path.split(".").pop() ?? "")}
                </span>
              </button>
            );
          })}
        </>
      )}
    </div>
  );
}
