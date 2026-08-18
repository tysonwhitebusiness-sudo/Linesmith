'use client';

import Link from 'next/link';
import type { SubjectSummary } from '@/lib/core/types';
import type { GolfOutrightLine } from '@/lib/odds/golfLines';
import { SubjectAvatar } from './SubjectAvatar';
import { OddsChip } from './OddsChip';
import { BookLogo } from './BookLogo';

/** "T22" / "22" / "1" -> 22 / 22 / 1. Null for anything else (CUT, WD, —). */
function parsePosition(position: string | undefined): number | null {
  if (!position) return null;
  const match = position.match(/^T?(\d+)$/i);
  return match ? Number(match[1]) : null;
}

function PositionBadge({ position }: { position: number | null }) {
  if (position == null) return null;
  if (position <= 5) {
    return <span className="lb-chip bg-good/10 text-good">Top 5</span>;
  }
  if (position <= 10) {
    return <span className="lb-chip bg-accent-soft text-masters">Top 10</span>;
  }
  return null;
}

/**
 * Match Winner board for the current PGA Tour event — the golf equivalent of
 * MLB's GameLinesView: a read-only, book-compared market list, not a
 * PickCandidate. There's no repeating pattern to scan for a field-wide
 * outright (unlike the hole-score prop), so this sits outside the Scan
 * table entirely, same reasoning as MLB's moneyline/total.
 *
 * Top 5 / Top 10 aren't priced — no configured provider carries golf place
 * markets (see lib/odds/golfLines.ts's header) — so those columns show the
 * golfer's actual live leaderboard position instead of inventing a market
 * comparison for a price that doesn't exist.
 */
export function TournamentLinesView({
  lines,
  subjects,
  eventName,
  loading,
  warnings,
}: {
  lines: GolfOutrightLine[];
  subjects: SubjectSummary[];
  eventName: string | null;
  loading: boolean;
  warnings: string[];
}) {
  const subjectById = new Map(subjects.map((s) => [s.subjectId, s]));

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
        No Match Winner odds available right now — check back as SharpAPI's board updates.
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

      {eventName ? <p className="px-1 text-[11px] text-ink-faint">{eventName} · Match Winner</p> : null}

      <div className="lb-card divide-y divide-line overflow-hidden">
        {lines.map((line) => {
          const subject = line.espnId ? subjectById.get(line.espnId) : undefined;
          const meta = subject?.meta as Record<string, unknown> | undefined;
          const position = parsePosition(typeof meta?.position === 'string' ? meta.position : undefined);
          const headshotUrl = typeof meta?.headshotUrl === 'string' ? meta.headshotUrl : undefined;
          const flagUrl = typeof meta?.flagUrl === 'string' ? meta.flagUrl : undefined;

          const row = (
            <div className="flex items-center gap-3 px-3 py-2">
              <SubjectAvatar name={line.golferName} headshotUrl={headshotUrl} fallbackUrl={flagUrl} size={28} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-ink">{line.golferName}</div>
                <div className="flex items-center gap-1.5 text-[11px] text-ink-faint">
                  {subject?.statusLine ?? 'Not in today\'s field'}
                  <PositionBadge position={position} />
                </div>
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
            <Link key={line.espnId} href={`/golf/player/${line.espnId}`} className="block hover:bg-accent-soft/20">
              {row}
            </Link>
          ) : (
            <div key={line.golferName}>{row}</div>
          );
        })}
      </div>
    </div>
  );
}

export default TournamentLinesView;
