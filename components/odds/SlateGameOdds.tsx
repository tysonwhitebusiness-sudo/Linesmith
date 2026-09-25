'use client';

import { BookLogo } from '../BookLogo';
import { LiveDot } from '../ui';
import { SplitBar } from './SharpPrices';
import { fmtAmerican, fmtLine, fmtMoney } from '@/lib/odds/section/format';
import type { SlateOddsGame } from '@/lib/odds/section/slate';

/**
 * The odds block on a Slate game card (odds build P8, O4; the mockup's
 * `slateGames`): best moneyline per side with its book, a "Sharp prices" row
 * with its own live dot (Pinnacle's two prices and the no-vig split in the
 * two teams' colours), the consensus total and where it opened, how the home
 * moneyline moved since open, then labelled rows for DraftKings customers'
 * money and bets (a 15-point gap reads "split") and Kalshi's 24-hour volume.
 * No edge (P11). Sport-agnostic: the card passes the abbreviations and colours.
 */
export function SlateGameOdds({ odds, away, home, colors, live, now }: {
  odds: SlateOddsGame;
  away: string;
  home: string;
  colors?: [string | null | undefined, string | null | undefined];
  live?: boolean;
  now?: number;
}) {
  const t = now ?? Date.now();
  const pin = odds.pinnacle;
  const mv = odds.moved;
  const split = odds.dk && odds.dk.money != null && odds.dk.bets != null && Math.abs(odds.dk.money - odds.dk.bets) >= 15;
  const best = (q: SlateOddsGame['ml']['home'], abbr: string) => (
    <div className="flex min-w-0 items-center justify-between gap-2">
      <span className="text-label text-ink-muted">Best {abbr}</span>
      <span className="inline-flex items-center gap-1.5">
        <b className="tabular-nums text-ink">{fmtAmerican(q?.price)}</b>
        {q ? <BookLogo bookId={q.book} size={14} /> : null}
      </span>
    </div>
  );
  return (
    <div className="space-y-2 border-t border-line-soft px-4 py-3 text-body-sm">
      <div className="grid grid-cols-2 gap-x-4">
        {best(odds.ml.away, away)}
        {best(odds.ml.home, home)}
      </div>
      <div className="rounded-md bg-card-sunk px-2.5 py-2">
        <div className="flex items-center justify-between gap-2">
          <b className="text-label text-ink">Sharp prices</b>
          {pin?.checkedAt ? <LiveDot checkedAt={pin.checkedAt} cadenceS={70} now={t} /> : null}
        </div>
        {pin ? (
          <>
            <div className="mt-1 flex items-center gap-1.5">
              <BookLogo bookId="pinnacle" size={14} />
              <span className="text-label text-ink-secondary">Pinnacle</span>
              <span className="ml-auto tabular-nums">{away} <b>{fmtAmerican(pin.away)}</b> · {home} <b>{fmtAmerican(pin.home)}</b></span>
            </div>
            <SplitBar p={1 - pin.fairHome} labels={[away, home]} colors={colors} />
          </>
        ) : (
          <p className="mt-1 text-label text-ink-muted">No sharp price{live ? ' — in play' : ''}</p>
        )}
      </div>
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <span className="text-label text-ink-muted">Total</span>
        <span className="tabular-nums">
          <b>{fmtLine(odds.total.line) || '—'}</b>
          {odds.total.open != null && odds.total.line != null && odds.total.open !== odds.total.line ? <span className="text-ink-muted"> (opened {fmtLine(odds.total.open)})</span> : null}
        </span>
        <span className="text-label text-ink-muted">Moved</span>
        <span className="tabular-nums">
          {mv ? (
            <span className="inline-flex items-center gap-1">
              {home} {fmtAmerican(mv.open)} → <b>{fmtAmerican(mv.now)}</b>{mv.open === mv.now ? <span className="text-ink-muted">flat</span> : null}
              <BookLogo bookId={mv.book} size={12} />
            </span>
          ) : '—'}
        </span>
      </div>
      {odds.dk || odds.kalshi24h != null ? (
        <div className="space-y-1 border-t border-line-soft pt-2">
          {odds.dk ? (
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-label text-ink-muted">
                <BookLogo bookId="draftkings" size={12} /> DK customers, {home}
                {split ? <span className="font-semibold text-warn-ink">split</span> : null}
              </span>
              <span className="tabular-nums text-label"><b>{odds.dk.money ?? '—'}%</b> money · <b>{odds.dk.bets ?? '—'}%</b> bets</span>
            </div>
          ) : null}
          {odds.kalshi24h != null ? (
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-label text-ink-muted"><BookLogo bookId="kalshi" size={12} /> Kalshi, traded in 24 h</span>
              <b className="tabular-nums text-label">{fmtMoney(odds.kalshi24h)}</b>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
