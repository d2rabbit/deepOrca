/**
 * LLM tool dispatch bridge (design M5). Maps an agent-emitted tool call back to
 * the originating action and awaits its result. This is the seam the future
 * session.ts / ToolExecutor integration calls: when the LLM emits a tool call
 * whose name matches a registered action's tool name, route it here.
 *
 * Two adapters will call `ActionRegistry.execute` — this bridge (LLM surface)
 * and the future desktop IPC bridge (UI surface). That pair is what makes the
 * registry seam real.
 */

import type { ActionRegistry } from "./registry";
import type { ExecuteOptions } from "./registry";
import { ActionError } from "./types";

export interface DispatchResult {
  readonly ok: true;
  readonly output: unknown;
}

/**
 * Execute the action backing `toolName`. Throws {@link ActionError} (caller
 * surfaces it as a tool-error result to the LLM) if the tool name is unknown or
 * the action fails.
 */
export async function dispatchToolCall(
  registry: ActionRegistry,
  toolName: string,
  input: unknown,
  opts: ExecuteOptions = {}
): Promise<DispatchResult> {
  const actionId = registry.actionIdForToolName(toolName);
  if (!actionId) {
    throw new ActionError("ACTION_NOT_FOUND", toolName, `No action registered for tool "${toolName}"`);
  }
  const handle = registry.execute<unknown, unknown>(actionId, input, opts);
  const output = await handle.result;
  return { ok: true, output };
}
