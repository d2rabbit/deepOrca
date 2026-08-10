import { useEffect, useRef, type RefObject } from "react";

/**
 * Keep the conversation's bottom padding in sync with the floating composer-dock's
 * actual height so the last message can never sit underneath the input.
 *
 * We measure the dock and write a CSS variable consumed by .ui-conversation's
 * padding-bottom. The +12px gap is a small breathing buffer so the last line
 * doesn't kiss the composer.
 *
 * Extracted from App.tsx verbatim. Returns the ref to attach to the dock element;
 * `mainView` is passed in because the dock is remounted when the view changes.
 */
export function useComposerDockHeight(mainView: string): RefObject<HTMLDivElement | null> {
  const composerDockRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = composerDockRef.current;
    if (!el) return;
    const apply = () => {
      const h = el.offsetHeight;
      document.documentElement.style.setProperty("--ui-composer-reserved", `${h + 12}px`);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => {
      ro.disconnect();
      document.documentElement.style.removeProperty("--ui-composer-reserved");
    };
  }, [mainView]);

  return composerDockRef;
}
