import { api } from "../../api";
import type { DesignSuiteChangeEvent } from "./types";

export const suiteApi = api;

/**
 * Suite mutations ride the real `onDesignChanged` IPC event, which main stamps
 * with `{ root, suiteId, versionId, change }`. The legacy root-only payload
 * (suiteId undefined) is for chat-side artifact panels and is ignored here.
 */
export function subscribeToSuiteChanges(callback: (event: DesignSuiteChangeEvent) => void): () => void {
  return api.onDesignChanged((event) => {
    if (event.suiteId) callback(event);
  });
}
