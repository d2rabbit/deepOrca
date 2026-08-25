import { useEffect, useRef, useState, type JSX, type RefObject } from "react";

/**
 * "On this page" TOC — heading extraction + scrollspy (reading-shell ideas
 * adopted from the Oink Hugo theme's shell/nav contracts, pgsty/oink.pgsty.com,
 * Apache-2.0). Shared by the wiki page view, the AGENTS document view, and the
 * arch-map board so every long surface in the knowledge module reads like a
 * site, not a file dump.
 *
 * StreamdownView does not run rehype-slug, so headings get ids assigned in a
 * post-render pass; duplicate slugs are de-duplicated with a counter. The
 * scrollspy listens on the closest scroll container (and window, captured, so
 * nested scrollers are covered) — the last heading whose top passed the
 * viewport line wins.
 */

export type TocEntry = { id: string; text: string; level: number };

export function useHeadingToc(
  ref: RefObject<HTMLElement | null>,
  dep: unknown,
  opts?: { selector?: string; idPrefix?: string; scrollerClosest?: string; textOf?: (el: HTMLElement) => string }
): { toc: TocEntry[]; activeId: string } {
  const selector = opts?.selector ?? "h2, h3";
  const idPrefix = opts?.idPrefix ?? "toc";
  const scrollerClosest = opts?.scrollerClosest ?? ".ui-knowledge-wiki-preview";
  const textOfRef = useRef(opts?.textOf);
  textOfRef.current = opts?.textOf;
  const [toc, setToc] = useState<TocEntry[]>([]);
  const [activeId, setActiveId] = useState("");

  useEffect(() => {
    const doc = ref.current;
    if (!doc) return;
    const headings = Array.from(doc.querySelectorAll<HTMLElement>(selector));
    const slugCount = new Map<string, number>();
    const entries: TocEntry[] = [];
    for (const h of headings) {
      const text = textOfRef.current?.(h) ?? (h.textContent ?? "").trim();
      if (!text) continue;
      let slug = text
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, "-")
        .replace(/^-+|-+$/g, "");
      if (!slug) slug = "sec";
      const n = slugCount.get(slug) ?? 0;
      slugCount.set(slug, n + 1);
      if (n > 0) slug = `${slug}-${n}`;
      if (!h.id) h.id = `${idPrefix}-${slug}`;
      const levelMatch = /^H(\d)$/.exec(h.tagName);
      entries.push({ id: h.id, text, level: levelMatch ? Number(levelMatch[1]) : 2 });
    }
    setToc(entries);
    setActiveId(entries[0]?.id ?? "");
  }, [dep, ref, selector, idPrefix]);

  useEffect(() => {
    if (toc.length === 0) return;
    const doc = ref.current;
    if (!doc) return;
    const onScroll = (): void => {
      const headings = toc
        .map((e) => doc.querySelector<HTMLElement>(`#${CSS.escape(e.id)}`))
        .filter((el): el is HTMLElement => el != null);
      let current = headings[0]?.id ?? "";
      for (const el of headings) {
        if (el.getBoundingClientRect().top <= 96) current = el.id;
      }
      setActiveId(current);
    };
    onScroll();
    const scroller = doc.closest(scrollerClosest);
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    scroller?.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll, { capture: true } as EventListenerOptions);
      scroller?.removeEventListener("scroll", onScroll);
    };
  }, [toc, ref, scrollerClosest]);

  return { toc, activeId };
}

/** Renders the TOC rail; jump is a callback so hosts can smooth-scroll. */
export function TocNav({
  entries,
  activeId,
  label,
  onJump,
  className,
}: {
  entries: TocEntry[];
  activeId: string;
  label: string;
  onJump: (id: string) => void;
  className?: string;
}): JSX.Element | null {
  const lastActive = useRef(activeId);
  if (activeId) lastActive.current = activeId;
  if (entries.length === 0) return null;
  return (
    <nav className={className ? `ui-wiki-toc ${className}` : "ui-wiki-toc"} aria-label={label}>
      <div className="ui-wiki-toc-label">{label}</div>
      {entries.map((e) => (
        <a
          key={e.id}
          href={`#${e.id}`}
          className={`ui-wiki-toc-item level-${e.level}${lastActive.current === e.id ? " active" : ""}`}
          onClick={(ev) => {
            ev.preventDefault();
            onJump(e.id);
          }}
        >
          {e.text}
        </a>
      ))}
    </nav>
  );
}
