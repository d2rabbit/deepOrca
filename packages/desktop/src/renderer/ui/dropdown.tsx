import { useEffect, useRef, useState, type JSX } from "react";
import { cx } from "./class-names";

export type DropdownOption = {
  value: string;
  label: string;
};

type DropdownSelectProps = {
  /** Controlled current value; the trigger shows the matching option's label. */
  value: string;
  options: readonly DropdownOption[];
  onSelect: (value: string) => void;
  /** Accessibility label + hover tooltip on the trigger. */
  title: string;
  /** Extra classes for the trigger button (e.g. "ui-topbar-model"). */
  triggerClassName?: string;
};

/**
 * Smooth dropdown select — same click-to-open / click-option-to-choose
 * interaction as a native <select>, but with an animated popup so the
 * expansion feels fluid instead of snapping in at OS speed. The menu stays
 * mounted and transitions opacity/transform/visibility, so both enter and
 * exit animate without unmount jank. Dismissal matches native affordances:
 * outside press or Escape.
 */
export function DropdownSelect({
  value,
  options,
  onSelect,
  title,
  triggerClassName,
}: DropdownSelectProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="ui-dd" ref={rootRef}>
      <button
        type="button"
        className={cx("ui-dd-trigger", triggerClassName, open && "ui-dd-trigger--open")}
        data-tip={current?.label || title}
        aria-label={title}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {current?.label ?? value}
        <span className="ui-dd-caret" aria-hidden />
      </button>
      <div className={cx("ui-dd-menu", open && "ui-dd-menu--open")} role="listbox">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="option"
            aria-selected={option.value === value}
            className={cx("ui-dd-item", option.value === value && "ui-dd-item--selected")}
            onClick={() => {
              setOpen(false);
              onSelect(option.value);
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
