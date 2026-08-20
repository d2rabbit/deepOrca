import type { DesktopApi } from "../shared/ipc";
import { instrumentCorePath } from "./lib/core-path-metrics";

declare global {
  interface Window {
    deeporca: DesktopApi;
  }
}

// instrumentCorePath wraps every call transparently and feeds the §6
// experiment metrics (core-path funnel, both layouts) — the shared seam, so
// classic components stay untouched (deck plan isolation red line).
export const api: DesktopApi = instrumentCorePath(window.deeporca);
