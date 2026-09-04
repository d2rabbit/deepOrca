/**
 * Motion orchestration base (docs/research/2026-09-03-motion-react-animation-
 * prestudy §9 P0). Two house rules from the research §7 adoption boundaries:
 *
 * 1. 编排归 Motion，装饰归 CSS — enter/exit, layout shifts, cascades,
 *    interruptible feedback → Motion; infinite/ambient loops (breathing,
 *    pulse, scan lines) → CSS. Never let both control the same property of
 *    the same element.
 * 2. `m` components + LazyMotion strict — importing the full `motion` object
 *    is FORBIDDEN house-wide (~34KB eager payload; strict mode throws as a
 *    backstop). Take `m` from this file only.
 *
 * `loadFeatures` is a dynamic import so the animation feature set lands in
 * its own chunk after first paint, not in the entry bundle.
 */
import { LazyMotion, MotionConfig, m, AnimatePresence, type Transition } from "motion/react";
import type { JSX } from "react";

export { AnimatePresence, m };

/** Load the animation feature set once, on first m-component mount. The
 * returned feature-bundle type is motion's own; annotating it manually just
 * invites drift. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const loadFeatures = (): Promise<any> => import("motion/react").then((mod) => mod.domAnimation);

/** House duration/ease token — matches the existing cubic-bezier(0.16,1,0.3,1) feel. */
export const springToken: Transition = { duration: 0.32, ease: [0.16, 1, 0.3, 1] };

/** App-wide wrapper: strict LazyMotion + reduced-motion respect. Mount once at the renderer root. */
export function MotionProvider({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <LazyMotion features={loadFeatures} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}
