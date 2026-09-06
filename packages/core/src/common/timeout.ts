/**
 * Deadline race helper for fail-open lookups: resolve null when the promise is
 * slow (or itself fails), never reject, never block the caller past `ms`.
 * Same pattern as the session-creation memory recall race
 * (session-manager-lifecycle), extracted so action seams can share it.
 */

export function withTimeoutNull<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([promise.catch(() => null), deadline]).finally(() => clearTimeout(timer));
}
