import type { ButtonHTMLAttributes, JSX, ReactNode } from "react";
import { cx } from "./class-names";

type RailProps = {
  children: ReactNode;
  className?: string;
};

/** Vertical icon rail (shell left edge). */
export function Rail({ children, className }: RailProps): JSX.Element {
  return <div className={cx("ui-rail", className)}>{children}</div>;
}

/** Brand mark shown at the top of the rail. */
export function RailBrand({ children }: { children: ReactNode }): JSX.Element {
  return <div className="ui-rail-brand">{children}</div>;
}

/** Flexible spacer to push rail buttons to the bottom. */
export function RailSpacer(): JSX.Element {
  return <div className="ui-rail-spacer" />;
}

type RailButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
  /** Show a small attention dot (e.g. permission pending). */
  badge?: boolean;
};

/** Single rail action; `active` highlights the current view. The `title` prop
 *  is rendered as a custom CSS tooltip (`data-tip`) instead of the tiny native
 *  one, so hints stay readable. */
export function RailButton({
  active = false,
  badge = false,
  className,
  type = "button",
  title,
  ...rest
}: RailButtonProps): JSX.Element {
  return (
    <button
      type={type}
      data-tip={title || undefined}
      className={cx("ui-rail-btn", active && "ui-rail-btn--active", badge && "ui-rail-btn--badge", className)}
      {...rest}
    />
  );
}
