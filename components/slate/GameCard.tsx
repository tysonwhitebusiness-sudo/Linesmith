'use client';

import { Avatar, Button, Chip, Tooltip, cx } from '@/components/ui';
import { useTeamColors } from '../useTeamColors';
import { teamColor } from '@/lib/sports/shared/teamColors';
import { BookLogo, bookLabel } from '../BookLogo';
import type { SlateGameCard, SlateMarket, SlateTeam } from '@/lib/sports/shared/slateShapes';
import { SlateGameOdds } from '../odds/SlateGameOdds';
import { EdgeDot } from '../odds/EdgeCard';
import type { SlateOddsGame } from '@/lib/odds/section/slate';

/**
 * One game on the Slate (S1, `slate-sheet-cards.md` §3.1).
 *
 * It is a `Card`, not a table row, and it never asks which sport it is: MLB's
 * probable starters, CFB's poll rank and soccer's draw column all arrive as
 * fields the adapter either set or did not. A field the sport has nothing for
 * is not drawn at all — not drawn as a dash, which reads as "none offered"
 * rather than "we do not have it".
 *
 * THE MODEL ROW CARRIES NO PROBABILITY unless the register says the model is
 * gated, and today none of them are. The adapter decides; this only prints
 * what it was given. The ring is D9's: it marks the rare pick that goes
 * AGAINST the market favourite, because the Elo picks the favourite on 95-100%
 * of games and a ring on all of them would be a green mark that reads as a
 * recommendation.
 */

function TeamRow({ team, live }: { team: SlateTeam; live: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <Avatar kind="logo" label={team.name} src={team.logoUrl ?? undefined} size={36} decorative />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-1.5">
          {team.rank != null ? <span className="text-label font-semibold text-ink-muted tabular-nums">#{team.rank}</span> : null}
          <span className="truncate text-body-sm font-semibold text-ink">{team.name}</span>
          {team.record ? <span className="shrink-0 text-label text-ink-muted tabular-nums">{team.record}</span> : null}
        </div>
        {team.note ? <p className="truncate text-label text-ink-muted">{team.note}</p> : null}
      </div>
      {team.score != null ? (
        <span className={cx('shrink-0 text-title tabular-nums', live ? 'text-ink' : 'text-ink-secondary')}>{team.score}</span>
      ) : null}
    </div>
  );
}

function MarketCell({ label, market }: { label: string; market: SlateMarket | null | undefined }) {
  if (!market) return null;
  return (
    <div className="min-w-0 flex-1">
      <p className="text-overline uppercase text-ink-muted">{label}</p>
      {/* With too few books to call anything a consensus, the best price IS
          the number — printing a dash above it would hide the one real
          quote there is. */}
      <p className="truncate text-body font-semibold text-ink tabular-nums">{market.consensus ?? market.best?.price ?? '—'}</p>
      {market.best ? (
        <p className="truncate text-label text-ink-muted">
          {market.consensus ? (
            <>
              best <span className="tabular-nums text-ink-secondary">{market.best.price}</span> {market.best.book}
            </>
          ) : (
            market.best.book
          )}
        </p>
      ) : null}
      {market.books ? (
        <p className="text-label text-ink-muted tabular-nums">
          {market.books} book{market.books === 1 ? '' : 's'}
        </p>
      ) : null}
    </div>
  );
}

export function GameCard({ card, sport, odds, edgeCount = 0 }: {
  card: SlateGameCard;
  sport: string;
  odds?: SlateOddsGame | null;
  /** P11: market edges passing every gate on this game (Python's `market_edges`): a dot, nothing computed here. */
  edgeCount?: number;
}) {
  const live = card.status === 'live';
  const colors = useTeamColors(sport, null);
  const awayColor = teamColor(colors, { abbr: card.away.abbr ?? card.away.name })?.primary;
  const homeColor = teamColor(colors, { abbr: card.home.abbr ?? card.home.name })?.primary;
  // Every book quoting any of this game's lines, for the footer's marks.
  const allBooks = [...new Set([...(card.lines?.spread?.booksList ?? []), ...(card.lines?.total?.booksList ?? []), ...(card.lines?.moneyline?.booksList ?? [])])];
  return (
    <section className="flex min-w-0 flex-col overflow-hidden rounded-card border border-line-soft bg-card shadow-card">
      {/* C4: a 5px stripe split into the two teams' primaries. */}
      <div aria-hidden className="flex h-[5px] shrink-0">
        <span className="flex-1" style={{ background: awayColor ?? 'var(--line)' }} />
        <span className="flex-1" style={{ background: homeColor ?? 'var(--line)' }} />
      </div>
      <header className="flex items-center justify-between gap-2 px-4 pb-2 pt-3">
        {live ? (
          <span className="flex items-center gap-1.5 text-label font-semibold text-bad-ink">
            <span aria-hidden className="size-1.5 rounded-full bg-bad" />
            LIVE · {card.statusText}
          </span>
        ) : (
          <Chip tone="neutral" size="sm">
            {card.statusText}
          </Chip>
        )}
        {card.venue || edgeCount ? (
          <span className="flex min-w-0 items-center gap-1.5 truncate text-label text-ink-muted">
            {card.venue ? <span className="truncate">{card.venue}</span> : null}
            {edgeCount ? <EdgeDot title={`${edgeCount} market ${edgeCount === 1 ? 'edge passes' : 'edges pass'} every gate`} /> : null}
          </span>
        ) : null}
      </header>

      <div className="space-y-2 px-4 pb-3">
        <TeamRow team={card.away} live={live} />
        <TeamRow team={card.home} live={live} />
      </div>

      {/* O4: the odds block (every book, the sharp price, splits) where the
          game has one; the adapter's lines otherwise. */}
      {odds && odds.books > 0 ? (
        <SlateGameOdds odds={odds} away={card.away.abbr ?? card.away.name} home={card.home.abbr ?? card.home.name}
          colors={[awayColor, homeColor]} live={live} />
      ) : card.lines ? (
        <div className="flex gap-3 border-t border-line-soft px-4 py-3">
          <MarketCell label="Spread" market={card.lines.spread} />
          <MarketCell label="Total" market={card.lines.total} />
          <MarketCell label="Moneyline" market={card.lines.moneyline} />
          <MarketCell label="Draw" market={card.lines.draw} />
        </div>
      ) : null}

      {card.model ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-line-soft px-4 py-2.5">
          <Tooltip content={<div className="max-w-[260px]">{card.model.note}</div>}>
            <span
              className={cx(
                'cursor-help rounded-md px-1.5 py-0.5 text-overline font-semibold',
                // D9's ring: only where the pick differs from the market
                // favourite. Everywhere else it is a plain label.
                card.model.againstFavourite ? 'bg-good/10 text-good-ink ring-1 ring-good/30 ring-inset' : 'bg-card-sunk text-ink-secondary',
              )}
            >
              Model
            </span>
          </Tooltip>
          <span className="text-body-sm font-semibold text-ink">{card.model.pick}</span>
          {card.model.percent ? <span className="text-body-sm tabular-nums text-ink">{card.model.percent}</span> : null}
          {card.model.detail ? <span className="text-label text-ink-muted">{card.model.detail}</span> : null}
          {card.model.againstFavourite ? (
            <Chip tone="good" size="sm">
              Against the favourite
            </Chip>
          ) : null}
        </div>
      ) : null}

      {card.context && card.context.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 border-t border-line-soft px-4 py-2.5">
          {card.context.map((c) => (
            <Chip key={c} tone="neutral" size="sm">
              {c}
            </Chip>
          ))}
        </div>
      ) : null}

      <footer className="mt-auto flex items-center justify-between gap-2 border-t border-line-soft px-2 py-1.5">
        {allBooks.length > 0 ? (
          <span className="flex items-center gap-1.5 px-2">
            <span className="flex -space-x-1">
              {allBooks.slice(0, 6).map((b) => (
                <Tooltip key={b} content={bookLabel(b)}>
                  <span className="grid size-[18px] place-items-center rounded-full bg-card ring-1 ring-line">
                    <BookLogo bookId={b} size={12} />
                  </span>
                </Tooltip>
              ))}
            </span>
            <span className="text-label tabular-nums text-ink-muted">{allBooks.length} book{allBooks.length === 1 ? '' : 's'}</span>
          </span>
        ) : (
          <span />
        )}
        <span className="flex items-center gap-2">
          {card.propCount ? <span className="text-label tabular-nums text-ink-muted">{card.propCount} props</span> : null}
          {card.href ? (
            <Button variant="tertiary" size="sm" href={card.href}>
              Research →
            </Button>
          ) : null}
        </span>
      </footer>
    </section>
  );
}
