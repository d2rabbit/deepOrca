// Memory config fingerprint (specs/model-fleet-adaptation D1 hot reload):
// a pure projection of everything startMemory() consumes — when the
// fingerprint of the resolved settings differs from the running manager's,
// reconcileMemory() rebuilds instead of silently serving the stale snapshot.
// Pure function + types only, so it is unit-testable without Electron.

import type { ResolvedDeepcodingSettings } from "@deeporca/core";
import { buildThinkingRequestOptions } from "@deeporca/core";

/** Everything startMemory() consumes that should trigger a rebuild on change. */
export function extractMemoryFingerprint(settings: ResolvedDeepcodingSettings, projectRoot: string): string {
  const secondaryModel = settings.secondaryModel || settings.model;
  return JSON.stringify([
    settings.secondaryBaseURL,
    settings.secondaryApiKey,
    secondaryModel,
    // The thinking envelope rides the fingerprint: a model switch that also
    // switches family changes the disabled-thinking wire shape.
    buildThinkingRequestOptions(false, settings.secondaryBaseURL, "max", secondaryModel),
    settings.memory?.embedding ?? "none",
    settings.memory?.retentionDays ?? 30,
    settings.memory?.everyNConversations ?? 10,
    projectRoot,
  ]);
}
