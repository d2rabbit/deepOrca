/**
 * A2UI desktop adapter — bridges the core seam to the A2UI MCP implementation.
 *
 * The implementation (a2ui-mcp.ts + a2ui-templates.ts) is self-contained with
 * its own surface state management. This adapter wraps it into the
 * A2uiLifecycle interface that core's session.ts consumes via the seam.
 */

import { buildA2uiServer, persistSurfaces, restoreSurfaces } from "./a2ui-mcp.js";
import type { A2uiLifecycle, A2uiServerBuilder } from "@deeporca/core";

export const a2uiServerBuilder: A2uiServerBuilder = (): A2uiLifecycle | null => {
  const server = buildA2uiServer();
  if (!server) return null;
  return {
    server,
    restoreSurfaces,
    persistSurfaces,
  };
};
