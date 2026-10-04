/**
 * The four windows a PM asks "what shipped" over. Rolling ones end now; the
 * calendar month is the last whole month on the office clock.
 */

export const WINDOWS = [
  { key: '24h', label: 'last 24 hours' },
  { key: '7d', label: 'last 7 days' },
  { key: '30d', label: 'last 30 days' },
  { key: 'month', label: 'last month' },
] as const;

export type WindowKey = (typeof WINDOWS)[number]['key'];

const ROLLING = new Map<string, number>([['24h', 86400], ['7d', 7 * 86400], ['30d', 30 * 86400]]);

export const OFFICE_TZ = 'America/New_York';

export function isWindowKey(s: string): s is WindowKey {
  return WINDOWS.some((w) => w.key === s);
}

/** Seconds `tz` sits ahead of UTC at instant `t`. */
function offsetAt(t: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
  }).formatToParts(new Date(t * 1000));
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const wall = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second')) / 1000;
  return wall - t;
}

/** The UTC instant of local midnight on the first of `month` (0-based, may overflow). */
function monthStart(year: number, month: number, tz: string): number {
  const naive = Date.UTC(year, month, 1) / 1000;
  return naive - offsetAt(naive - offsetAt(naive, tz), tz);
}

export interface Span {
  key: WindowKey;
  label: string;
  /** Epoch seconds, inclusive. */
  from: number;
  /** Epoch seconds, exclusive. */
  to: number;
}

export function windowSpan(key: WindowKey, t: number, tz = OFFICE_TZ): Span {
  const label = WINDOWS.find((w) => w.key === key)?.label ?? key;
  const rolling = ROLLING.get(key);
  if (rolling !== undefined) return { key, label, from: t - rolling, to: t };
  const local = new Date((t + offsetAt(t, tz)) * 1000);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  const name = new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return { key, label: name, from: monthStart(y, m - 1, tz), to: monthStart(y, m, tz) };
}
