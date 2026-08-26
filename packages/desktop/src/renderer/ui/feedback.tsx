import type { HTMLAttributes, JSX } from "react";
import { cx } from "./class-names";

type StatusDotProps = HTMLAttributes<HTMLSpanElement> & {
  /** Session/tool status name; maps to a token-driven color modifier. */
  status?: string;
};

/** Small colored status indicator. */
export function StatusDot({ status, className, ...rest }: StatusDotProps): JSX.Element {
  return <span className={cx("ui-status-dot", status && `ui-status-dot--${status}`, className)} {...rest} />;
}
