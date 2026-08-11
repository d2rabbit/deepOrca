/**
 * Spawner host injection (design M2). core defines the {@link Spawner}
 * interface in `types.ts` and consumes it via the registry; the desktop host
 * calls {@link configureActionSpawner} at boot to inject a real
 * `ElectronNodeSpawner`. Tests inject a mock. This mirrors the existing
 * `configureCodegraphVendorRoot` / `configureCrgVersionRoot` host-injection
 * pattern and keeps core electron-free.
 */

import type { Spawner } from "./types";
import { NULL_SPAWNER } from "./types";

let injectedSpawner: Spawner | null = null;

/**
 * Inject the process-wide spawner the {@link ActionRegistry} uses when no
 * per-instance spawner is supplied. Called once at desktop boot.
 */
export function configureActionSpawner(spawner: Spawner | null): void {
  injectedSpawner = spawner;
}

/** The host-configured spawner, or {@link NULL_SPAWNER} if none injected. */
export function getActionSpawner(): Spawner {
  return injectedSpawner ?? NULL_SPAWNER;
}
