/**
 * The odds section's number formats, ported from the approved mockup's `fa` /
 * `fl` / `fln` / `ago` / `money` / `pct` (`docs/design/odds-rebuild/om-mock.js`)
 * so every card prints a price, a line and an age the same way. Pure.
 */

/** An American price: +105, -110, "—" for none. Fractional prices print rounded. */
export function fmtAmerican(a: number | null | undefined): string {
  if (a == null || Number.isNaN(a)) return '—';
  const r = Math.round(a);
  return (r > 0 ? '+' : '') + r;
}

/** A line: "66.5", "−4.5"; `signed` adds "+" to a positive spread. */
export function fmtLine(l: number | null | undefined, signed = false): string {
  if (l == null) return '';
  const s = String(+l.toFixed(1));
  return signed && l > 0 ? '+' + s : s;
}

/** An age in seconds: "<5 s", "42 s", "12 min", "3.5 h", "2 d". */
export function fmtAgo(s: number | null | undefined): string {
  if (s == null || !isFinite(s)) return '—';
  if (s < 5) return '<5 s';
  if (s < 60) return Math.round(s) + ' s';
  if (s < 3600) return Math.round(s / 60) + ' min';
  if (s < 86400) return (s / 3600).toFixed(s < 36000 ? 1 : 0).replace('.0', '') + ' h';
  return Math.round(s / 86400) + ' d';
}

export const secondsSince = (iso: string | null | undefined, now: number) =>
  iso ? Math.max(0, (now - Date.parse(iso)) / 1000) : null;

/** $1.2k, $3.4M. */
export function fmtMoney(v: number | null | undefined): string {
  if (v == null) return '—';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return '$' + (v / 1e3).toFixed(v >= 1e4 ? 0 : 1) + 'k';
  return '$' + Math.round(v);
}

export const fmtPct = (x: number, d = 1) => (x * 100).toFixed(d) + '%';

/** "10:26 AM" today, "Wed 1:05 PM" another day (Eastern: a slate is an Eastern day). */
export function fmtClock(iso: string | null | undefined, now: number): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const tz = 'America/New_York';
  const time = d.toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' });
  const day = d.toLocaleDateString('en-US', { timeZone: tz, weekday: 'short' });
  const today = new Date(now).toLocaleDateString('en-US', { timeZone: tz, weekday: 'short' });
  return day === today ? time : `${day} ${time}`;
}
