import { useEffect, useState, type JSX } from "react";
import { createPortal } from "react-dom";

type TipState = {
  text: string;
  /** Viewport coords + preferred side, resolved at hover time. */
  style: CSSProperties;
};

type CSSProperties = React.CSSProperties;

/**
 * Global [data-tip] tooltip — one fixed-position portal for every consumer
 * (rail buttons, sidebar row actions). Replaces the old CSS `::after` tips,
 * which absolute-positioned inside the element and got clipped by scrolling
 * containers (the rail is `overflow-y: auto`, so its right-edge tips never
 * became visible).
 *
 * Placement: elements hugging the left edge (the rail) get the tip to their
 * right, vertically centered; everything else gets it above, horizontally
 * centered (below instead when already at the top of the viewport).
 */
export function GlobalTooltip(): JSX.Element | null {
  const [tip, setTip] = useState<TipState | null>(null);

  useEffect(() => {
    const hide = () => setTip(null);

    const onOver = (event: MouseEvent) => {
      const target = event.target as Element | null;
      const host = target?.closest?.("[data-tip]") as HTMLElement | null;
      const text = host?.getAttribute("data-tip")?.trim();
      if (!host || !text) {
        hide();
        return;
      }
      const rect = host.getBoundingClientRect();
      const nearLeftEdge = rect.left < 80;
      let style: CSSProperties;
      if (nearLeftEdge) {
        style = {
          left: Math.round(rect.right + 10),
          top: Math.round(rect.top + rect.height / 2),
          transform: "translateY(-50%)",
        };
      } else {
        const above = rect.top >= 44;
        style = above
          ? {
              left: Math.round(rect.left + rect.width / 2),
              top: Math.round(rect.top - 8),
              transform: "translateX(-50%) translateY(-100%)",
            }
          : {
              left: Math.round(rect.left + rect.width / 2),
              top: Math.round(rect.bottom + 8),
              transform: "translateX(-50%)",
            };
      }
      setTip({ text, style });
    };

    document.addEventListener("mouseover", onOver);
    document.addEventListener("mousedown", hide);
    document.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      document.removeEventListener("mouseover", onOver);
      document.removeEventListener("mousedown", hide);
      document.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, []);

  if (!tip) return null;
  return createPortal(
    <div className="ui-gtip" role="tooltip" style={tip.style}>
      {tip.text}
    </div>,
    document.body
  );
}
