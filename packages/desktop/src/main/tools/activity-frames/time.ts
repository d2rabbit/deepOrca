/**
 * Timezone / DST helpers — port of activity_frames/_time.py.
 *
 * The critical function is `localDayWindowUtc`: it resolves a local calendar
 * day to a [start, end) UTC window, correctly handling DST transitions by
 * applying the offset independently at each day boundary.
 */

/**
 * Parse an ISO-8601 timestamp to epoch seconds (with fractional part).
 * Returns 0.0 for invalid/truncated input.
 */
export function parseEpoch(ts: string): number {
  if (!ts || ts.length < 19) return 0.0;
  try {
    const base = ts.slice(0, 19); // "YYYY-MM-DDTHH:MM:SS"
    // Parse as UTC (the DB stores UTC timestamps).
    const year = parseInt(base.slice(0, 4), 10);
    const month = parseInt(base.slice(5, 7), 10);
    const day = parseInt(base.slice(8, 10), 10);
    const hour = parseInt(base.slice(11, 13), 10);
    const minute = parseInt(base.slice(14, 16), 10);
    const second = parseInt(base.slice(17, 19), 10);
    // Date.UTC gives milliseconds since epoch in UTC.
    const ms = Date.UTC(year, month - 1, day, hour, minute, second);
    if (isNaN(ms)) return 0.0;
    let epoch = ms / 1000;
    // Fractional seconds.
    if (ts[19] === ".") {
      let fracStr = "";
      for (let i = 20; i < ts.length; i++) {
        const c = ts[i];
        if (c >= "0" && c <= "9") fracStr += c;
        else break;
      }
      if (fracStr) epoch += parseFloat("0." + fracStr);
    }
    return epoch;
  } catch {
    return 0.0;
  }
}

/** Current UTC time as "YYYY-MM-DDTHH:MM:SS". */
export function utcNowString(): string {
  return formatUtc(new Date());
}

/** Format a Date to UTC "YYYY-MM-DDTHH:MM:SS". */
export function formatUtc(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const h = String(d.getUTCHours()).padStart(2, "0");
  const min = String(d.getUTCMinutes()).padStart(2, "0");
  const s = String(d.getUTCSeconds()).padStart(2, "0");
  return `${y}-${m}-${day}T${h}:${min}:${s}`;
}

/**
 * Today's local date as "YYYY-MM-DD".
 */
export function localDayString(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Convert a local day string ("YYYY-MM-DD") to a [start, end) UTC window.
 *
 * Each boundary is resolved independently using the local timezone offset
 * in effect on that specific date. This correctly handles DST transitions
 * (23-hour or 25-hour days).
 *
 * Returns ["YYYY-MM-DDTHH:MM:SS", "YYYY-MM-DDTHH:MM:SS"] in UTC.
 */
export function localDayWindowUtc(day: string): [string, string] {
  const m = day.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error(`Invalid day format: ${day}`);
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const dayNum = parseInt(m[3], 10);
  // Construct start and end as local midnight, then convert to UTC.
  // new Date(y, m, d) creates a local-time Date.
  const startLocal = new Date(year, month - 1, dayNum, 0, 0, 0);
  const endLocal = new Date(year, month - 1, dayNum + 1, 0, 0, 0);
  return [formatUtc(startLocal), formatUtc(endLocal)];
}

/**
 * Hours-ago window: [now - hours, now) in UTC.
 */
export function hoursAgoWindowUtc(hours: number): [string, string] {
  const now = Date.now();
  const startMs = now - hours * 3600 * 1000;
  return [formatUtc(new Date(startMs)), formatUtc(new Date(now))];
}

/**
 * Format an epoch as local "HH:MM".
 * Returns "?" for invalid epochs.
 */
export function fmtLocalHm(epoch: number): string {
  if (epoch <= 0) return "?";
  const d = new Date(epoch * 1000);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

/**
 * Format an epoch as local "HH:MM:SS".
 * Returns "?" for invalid epochs.
 */
export function fmtLocalHms(epoch: number): string {
  if (epoch <= 0) return "?";
  const d = new Date(epoch * 1000);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}
