/**
 * Path helpers for the renderer surfaces. One canonical basename — the
 * editor batch hand-rolled `path.split(/[\\/]/).pop()` in ten components;
 * a single implementation now keeps the separator policy (both / and \,
 * Windows-friendly) in one place.
 */

/** Final path segment ("a/b/c.ts" → "c.ts"; separators / and \ both split). */
export function fileBaseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}
