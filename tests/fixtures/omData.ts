/**
 * The approved odds mockup's frozen snapshot (`docs/design/odds-rebuild/om-data.js`,
 * real scraper rows at 2026-09-24 17:18 UTC) as `OddsMarket`s, for the P8
 * fixture tests. The mockup keeps quotes as tuples
 * [book, side, line, price, since, source, checkedAgeS, 'main'|'alt', extra]
 * with "checked" as seconds before the snapshot; here it becomes an absolute
 * time, the shape the live payload carries.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import type { HistPoint, OddsMarket, OddsQuote, OpenerRow, SteamRow, MoveRow } from '@/lib/odds/section/types';

type Tuple = [string, string, number | null, number, string, string, number | null, string, Record<string, unknown> | null];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = any;

let cached: Raw | null = null;
export function om(): Raw {
  if (cached) return cached;
  const src = readFileSync(join(process.cwd(), 'docs', 'design', 'odds-rebuild', 'om-data.js'), 'utf8');
  const sandbox: { window: { OM?: Raw } } = { window: {} };
  runInNewContext(src, sandbox);
  cached = sandbox.window.OM;
  return cached;
}

/** '2026-09-24 17:05' (UTC) -> ISO. */
export const iso = (t: string) => new Date(t.replace(' ', 'T') + (t.length <= 16 ? ':00Z' : 'Z')).toISOString();

export function asOf(): string {
  return iso(om().asof.replace('T', ' '));
}

export function toMarket(key: string, m: Raw): OddsMarket {
  const base = Date.parse(asOf());
  const cur: OddsQuote[] = (m.cur as Tuple[]).map(c => ({
    book: c[0], side: c[1], line: c[2], price: c[3], since: iso(c[4]), source: c[5],
    checkedAt: c[6] == null ? null : new Date(base - c[6] * 1000).toISOString(),
    main: c[7] === 'main', extra: c[8] ?? null,
  }));
  const hist: Record<string, HistPoint[]> = {};
  for (const [k, h] of Object.entries(m.hist ?? {}) as [string, [string, number | null, number | null, number | null][]][]) {
    hist[k] = h.map(p => [iso(p[0]), p[1], p[2], p[3]]);
  }
  const open: Record<string, OpenerRow> = {};
  for (const [k, o] of Object.entries(m.open ?? {}) as [string, [string, number | null, number | null, number | null]][]) {
    open[k] = { at: iso(o[0]), line: o[1], priceA: o[2], priceB: o[3] };
  }
  const moves: MoveRow[] = (m.moves ?? []).map((x: [string, string, number, number]) => [iso(x[0]), x[1], x[2], x[3]]);
  const steam: SteamRow[] = (m.steam ?? []).map((s: SteamRow) => ({ ...s, t: iso(s.t), times: s.times.map(iso) }));
  return { key, cur, hist, open, moves, steam };
}

export const nflMarket = (key: string) => toMarket(key, om().nfl.markets[key]);
export const propMarket = (player: string, key: string) => toMarket(key, om().nfl.players[player].markets[key]);
