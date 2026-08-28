'use client';

import type { DrawMatch } from '@/lib/sports/tennis/schedule';
import { SubjectAvatar } from './SubjectAvatar';

/**
 * The tennis schedule page's header strip — tennis has never had a strip on
 * any page (`AppShell.tsx` renders `DateGameStrip`/`GolferStrip` for every
 * other sport but never tennis), and a plain two-column list of matches felt
 * like the page needed *something* to scan at a glance the way golf's field
 * strip does. Scoped to just this page rather than added to `AppShell`,
 * matching golf's own `GolferStrip` (only ever used on golf's own pages).
 *
 * Live matches first, then upcoming — a finished draw's page isn't where you
 * come to re-watch completed matches, so this only ever surfaces the two
 * states worth a glance at a live event.
 */
export function TennisMatchStrip({ matches, onSelectMatch }: { matches: DrawMatch[]; onSelectMatch?: (matchId: string) => void }) {
  const relevant = matches
    .filter((m) => !m.completed)
    .sort((a, b) => (a.state === 'in' && b.state !== 'in' ? -1 : b.state === 'in' && a.state !== 'in' ? 1 : Date.parse(a.date) - Date.parse(b.date)));

  if (relevant.length === 0) {
    return (
      <div className="border-t border-line bg-ink/[0.02] py-2 text-center text-[11px] text-ink-faint">
        No live or upcoming matches in this draw
      </div>
    );
  }

  return (
    <div className="lb-scroll-x flex items-center gap-1.5 border-t border-line bg-ink/[0.02] px-3 py-2">
      {relevant.slice(0, 20).map((m) => {
        const scoreLine = m.state === 'in' ? m.home.sets.map((s) => s.value).join('-') + ' / ' + m.away.sets.map((s) => s.value).join('-') : null;
        return (
          <button
            key={m.matchId}
            type="button"
            onClick={() => onSelectMatch?.(m.matchId)}
            className="flex w-[190px] shrink-0 flex-col justify-center gap-1 rounded-xl border border-line bg-card px-2.5 py-1.5 text-left shadow-card transition-all duration-150 hover:-translate-y-0.5 hover:border-masters/30 hover:shadow-card-hover"
          >
            <span className="flex items-center justify-between gap-1">
              {m.state === 'in' ? <span className="lb-chip bg-good/10 text-good">Live</span> : <span className="text-[9px] font-semibold uppercase tracking-wide text-ink-faint">{m.round}</span>}
              {scoreLine ? <span className="text-[10px] font-bold tabular-nums text-ink">{scoreLine}</span> : null}
            </span>
            <span className="flex items-center gap-1.5">
              <SubjectAvatar name={m.home.name} headshotUrl={undefined} fallbackUrl={m.home.flagUrl ?? undefined} size={16} />
              <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-ink">{m.home.name}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <SubjectAvatar name={m.away.name} headshotUrl={undefined} fallbackUrl={m.away.flagUrl ?? undefined} size={16} />
              <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-ink">{m.away.name}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

export default TennisMatchStrip;
