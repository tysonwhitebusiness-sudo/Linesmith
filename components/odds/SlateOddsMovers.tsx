'use client';

import { BookLogo, bookLabel } from '../BookLogo';
import { useLive } from './live';
import { Card, EmptyState, Tooltip, cx } from '../ui';
import { GameMark } from '../slate/SlateSubject';
import { droppingList, moneylineMovers, pulledList, steamMovers, type SlateOddsGame } from '@/lib/odds/section/slate';
import { fmtAmerican, fmtClock, fmtLine } from '@/lib/odds/section/format';

export interface SlateGameRef {
  label: string;
  href?: string | null;
  home?: string;
  /** slate-polish v4: both teams with their logos, for the logo-and-abbreviation game mark. */
  teams?: { away: { abbr: string; logoUrl?: string | null }; home: { abbr: string; logoUrl?: string | null } };
  /** The game has started: its live prices are dimmed and marked in the Market hub. */
  live?: boolean;
}

const MARKET: Record<string, string> = { ml: 'Moneyline', sp: 'Spread', tot: 'Total' };

/**
 * The Slate's game-line movers (odds build P8, O4; the mockup's
 * `slateMovers`): Biggest moves — steam on totals and spreads with its first
 * mover, and the moneylines that moved most at Pinnacle open → now — then
 * Dropping odds (plan L5: each market's median-book move in implied
 * probability, and how many books moved the same way) and Pulled lines. Moves
 * are facts about the market; nothing names an edge.
 *
 * slate-polish v4: games are their two logos, books are their logos (the first
 * mover named, the followers in the order they moved), and a move is coloured
 * by its DIRECTION — up green, down red, always with its arrow — never by
 * whether it is good for anyone.
 */
export function SlateOddsMovers({ games, refs, now }: { games: SlateOddsGame[]; refs: Map<string, SlateGameRef>; now?: number }) {
  const t = now ?? Date.now();
  const live = useLive();
  // P9: a steam row this page saw arrive slides in marked "just now" for two minutes.
  const justNow = (gameId: string, market: string, book: string, at: string) => {
    const seen = live.moveSeen(`${book}|${gameId}:fg|${market}|${at}`);
    return seen != null && Date.now() - seen <= 120_000;
  };
  const steam = steamMovers(games);
  const ml = moneylineMovers(games);
  const drop = droppingList(games);
  const pulls = pulledList(games);
  const name = (id: string) => refs.get(id)?.label ?? id;
  const link = (id: string) => {
    const r = refs.get(id);
    if (r?.teams) return <GameMark away={r.teams.away} home={r.teams.home} href={r.href} />;
    return r?.href ? <a className="font-semibold text-ink underline-offset-2 hover:underline" href={r.href}>{r.label}</a> : <b>{name(id)}</b>;
  };
  const dirInk = (d: number) => (d > 0 ? 'text-good-ink' : d < 0 ? 'text-bad-ink' : 'text-ink');
  const pts = (d: number) => `${d >= 0 ? '+' : '−'}${Math.abs(d * 100).toFixed(1)} pts`;
  return (
    <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
      <Card title="Biggest moves" scope="game lines · since open" dense
        caption="Steam: three or more books moving a line the same way within 45 minutes, led by the first mover. Market information, not a prediction.">
        {steam.length === 0 && ml.length === 0 ? (
          <EmptyState title="Nothing has moved yet" reason="No steam, and no moneyline has moved at Pinnacle since it opened." />
        ) : (
          <div className="space-y-3">
            {steam.length ? (
              <div>
                <p className="text-overline uppercase text-ink-muted">Steam · first mover</p>
                <ul className="mt-1 divide-y divide-line-soft">
                  {steam.map(s => (
                    <li key={`${s.gameId}|${s.market}|${s.t}`} className={`py-1.5 text-body-sm ${justNow(s.gameId, s.market, s.books[0], s.t) ? 'lb-row-new' : ''}`}>
                      <span className="flex items-baseline justify-between gap-2">{link(s.gameId)}<span className="text-label text-ink-muted">
                        {justNow(s.gameId, s.market, s.books[0], s.t) ? <b className="mr-1 text-good-ink">just now</b> : null}{fmtClock(s.t, t)}</span></span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-ink-secondary">
                        <span>
                          <b className="text-ink">{MARKET[s.market]}</b> {fmtLine(s.from, s.market === 'sp')} →{' '}
                          <b className={dirInk(s.dir)}>
                            {s.dir > 0 ? '▲' : '▼'} {fmtLine(s.to[0], s.market === 'sp')}
                          </b>
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <BookLogo bookId={s.books[0]} size={14} withLabel />
                          {s.books.slice(1).map((b) => (
                            <Tooltip key={b} content={bookLabel(b)}>
                              <span className="inline-flex"><BookLogo bookId={b} size={14} /></span>
                            </Tooltip>
                          ))}
                        </span>
                        <span className="text-label text-ink-muted">
                          in {Math.max(1, Math.round((Date.parse(s.times[s.times.length - 1]) - Date.parse(s.times[0])) / 60000))} min
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {ml.length ? (
              <div>
                <p className="text-overline uppercase text-ink-muted">Moneylines that moved most · open → now</p>
                <ul className="mt-1 divide-y divide-line-soft">
                  {ml.map(m => (
                    <li key={m.gameId} className="py-1.5 text-body-sm">
                      <span className="flex items-baseline justify-between gap-2">{link(m.gameId)}<span className="text-label text-ink-muted">opened {fmtClock(m.openedAt, t)}</span></span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-ink-secondary">
                        <span>{refs.get(m.gameId)?.home ?? 'Home'} {fmtAmerican(m.open)} → <b className={dirInk(m.d)}>{fmtAmerican(m.now)}</b></span>
                        <BookLogo bookId={m.book} size={14} withLabel />
                        <span className={cx('text-label font-semibold', dirInk(m.d))}>{m.d > 0 ? '▲' : '▼'} {pts(m.d)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}
      </Card>
      <div className="space-y-3">
        <Card title="Dropping odds" scope="open → now, across books" dense
          caption="The median book's move in implied probability since it opened (side: home, or over), and how many books moved the same way. Flagged openers are left out.">
          {drop.length ? (
            <ul className="divide-y divide-line-soft">
              {drop.map(d => (
                <li key={`${d.gameId}|${d.market}`} className="flex items-baseline justify-between gap-2 py-1.5 text-body-sm">
                  <span className="inline-flex min-w-0 items-center gap-2">{link(d.gameId)} <span className="text-ink-secondary">{MARKET[d.market]}</span></span>
                  <span className="shrink-0 tabular-nums">
                    <b className={dirInk(d.medianMove)}>{d.medianMove > 0 ? '▲' : '▼'} {pts(d.medianMove)}</b>{' '}
                    <span className="text-label text-ink-muted">{d.sameWay}/{d.books} books</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : <EmptyState title="No market has moved from its open" reason="Every book is still at its opening price, or no opener is held yet." />}
        </Card>
        <Card title="Pulled lines" scope="US, sharp and exchange books" dense>
          {pulls.length ? (
            <ul className="divide-y divide-line-soft">
              {pulls.map(p => (
                <li key={`${p.gameId}|${p.book}|${p.market}`} className="flex items-center justify-between gap-2 py-1.5 text-body-sm">
                  <span className="inline-flex min-w-0 items-center gap-2"><BookLogo bookId={p.book} size={14} withLabel /><span className="text-ink-muted">·</span>{link(p.gameId)}<span className="text-ink-secondary">{MARKET[p.market]}</span></span>
                  <span className="shrink-0 text-label text-ink-muted">{fmtClock(p.pulledAt, t)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No main line is pulled right now" reason="A line taken down and reposted at a new number is a move; a market a book stops offering altogether lands here with the time it went." />
          )}
        </Card>
      </div>
    </div>
  );
}
