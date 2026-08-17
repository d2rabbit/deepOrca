/**
 * defineAction — ergonomic sugar over {@link ActionRegistry.register} (design
 * M4). Deliberately shallow: it introduces no new seam, just lets action
 * modules read as `defineAction(def, run)` at the top of a file.
 */

import type { ActionDefinition, ActionRun } from "./types";
import type { ActionRegistry } from "./registry";

export function defineAction<I, O>(
  registry: ActionRegistry,
  def: ActionDefinition<I>,
  run: ActionRun<I, O>
): ActionDefinition<I> {
  registry.register(def, run);
  return def;
}
