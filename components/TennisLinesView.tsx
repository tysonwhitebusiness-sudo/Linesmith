'use client';

import Link from 'next/link';
import type { TennisTour } from '@/lib/core/types';
import type { TennisOutrightLine } from '@/lib/odds/tennisLines';
import { SubjectAvatar } from './SubjectAvatar';
import { OddsChip } from './OddsChip';
import { BookLogo } from './BookLogo';

/**
 * Tournament Winner board — tennis's counterpart to golf's
 * `TournamentLinesView`. Real, confirmed live: SharpAPI carries this market
 * for both tours, ATP under `market_type=outright`, WTA under
 * `tournament_winner` (see lib/odds/tennisLines.ts's header for why those
 * differ) — this component doesn't care which, it just renders whatever
 * `getTennisTournamentLines` already resolved.
 */
export function TennisLinesView({
  tour,
  lines,
  eventName,
  loading,
  warnings,
}: {
  tour: TennisTour;
  lines: TennisOutrightLine[];
  eventName: string | null;
  loading: boolean;
  warnings: string[];
}) {
  if (loading && lines.length === 0) {
    return (
      <div className="space-y-1.5">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="lb-card h-12 animate-pulse" />
        ))}
      </div>
    );
  }

  if (lines.length === 0) {
    return (
      <p className="p-8 text-center text-sm text-ink-muted">
        No Tournament Winner odds available right now — check back as SharpAPI's board updates.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {warnings.length > 0 ? (
        <div className="lb-card border-warn/30 bg-warn/5 p-2 text-[11px] text-warn">
          {warnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
        </div>
      ) : null}

      {eventName ? <p className="px-1 text-[11px] text-ink-faint">{eventName} · Tournament Winner</p> : null}

      <div className="lb-card divide-y divide-line overflow-hidden">
        {lines.map((line) => {
          const row = (
            <div className="flex items-center gap-3 px-3 py-2">
              <SubjectAvatar name={line.playerName} size={28} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-ink">{line.playerName}</div>
              </div>
              {line.bestPrice ? (
                <div className="flex flex-col items-end gap-0.5">
                  <OddsChip price={line.bestPrice.americanOdds} source="sharpapi" best size="md" />
                  <BookLogo bookId={line.bestPrice.bookmaker} size={11} withLabel />
                </div>
              ) : (
                <span className="text-[11px] text-ink-faint">—</span>
              )}
            </div>
          );

          return line.espnId ? (
            <Link key={line.espnId} href={`/tennis/${tour}/player/${encodeURIComponent(line.espnId)}`} className="block hover:bg-accent-soft/20">
              {row}
            </Link>
          ) : (
            <div key={line.playerName}>{row}</div>
          );
        })}
      </div>
    </div>
  );
}

export default TennisLinesView;
