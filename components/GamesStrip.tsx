'use client';

import type { SlateGame } from '@/lib/odds/matching';
import { liveFor } from '@/lib/odds/matching';

/**
 * The slate as a horizontal slider, in its own bar beneath the top bar.
 *
 * It does two jobs at once and that is deliberate: it is the fastest way into a
 * game's detail page, and it is the Games filter. Those were previously two
 * pieces of state that could disagree — the strip could show one game selected
 * while the filter dropdown held another. Selection now lives in one place
 * (the filter's `gamePks`) and this component is told what's selected rather
 * than remembering it.
 */

export function teamLogoUrl(teamId: number): string {
  return `https://www.mlbstatic.com/team-logos/${teamId}.svg`;
}

export function formatGameTime(isoDate: string | undefined): string {
  if (!isoDate) return 'TBD';
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return 'TBD';
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/** Split "PHI @ STL" into [away, home]. */
export function splitAbbrevs(matchup: string): [string, string] {
  const parts = matchup.split('@').map((p) => p.trim());
  return parts.length === 2 ? [parts[0], parts[1]] : [matchup, ''];
}

export interface GamesStripProps {
  games: SlateGame[];
  /** Null means "All". String accepted for sports whose gamePk is a non-numeric-looking id (none currently — NFL's ESPN event ids happen to be digit strings, coerced to number below same as MLB). */
  selectedGamePk: number | string | null;
  /** Called with null for the All chip. */
  onSelectGame: (gamePk: number | null) => void;
  /** Called when a card should take the user to that game's page. */
  onNavigateToGame?: (gamePk: number) => void;
  /** Resolves a team's logo by abbreviation for sports without a numeric `awayTeamId`/`homeTeamId` (NFL's `SlateGame` cast never carries one — `TeamMark`'s default `teamId`-keyed MLB CDN lookup silently rendered nothing). Falls back to the existing `teamId` path when omitted, so MLB is unaffected. */
  logoFor?: (abbreviation: string) => string | undefined;
}

export function GamesStrip({ games, selectedGamePk, onSelectGame, onNavigateToGame, logoFor }: GamesStripProps) {
  if (games.length === 0) {
    return (
      <div className="border-t border-line bg-ink/[0.02] py-2 text-center text-[11px] text-ink-faint">
        No games scheduled
      </div>
    );
  }

  // Chronological by first pitch. A live game keeps its slot rather than
  // jumping to the front — the slate's shape is what makes a card findable
  // twice, and reordering under the user costs more than the emphasis gains.
  const ordered = [...games].sort((a, b) => String(a.firstPitch ?? '').localeCompare(String(b.firstPitch ?? '')));

  return (
    <div className="lb-scroll-x flex gap-1.5 border-t border-line bg-ink/[0.02] px-3 py-1.5">
      <button
        type="button"
        onClick={() => onSelectGame(null)}
        aria-pressed={selectedGamePk == null}
        className={`flex shrink-0 items-center rounded-lg px-3 text-[11px] font-semibold transition-colors ${
          selectedGamePk == null
            ? 'bg-masters text-white shadow-card'
            : 'border border-line bg-card text-ink-muted hover:border-masters/30'
        }`}
      >
        All
      </button>

      {ordered.map((game) => {
        const gamePk = Number(game.gamePk);
        if (!Number.isFinite(gamePk)) return null;

        const selected = selectedGamePk != null && Number(selectedGamePk) === gamePk;
        const isFinal = /final|completed|game over/i.test(game.state ?? '');
        const isLive = !isFinal && /live|in progress|manager challenge|delayed/i.test(game.state ?? '');
        const [awayAbbrev, homeAbbrev] = splitAbbrevs(game.matchup ?? '');
        const live = liveFor({ game, awayAbbrev, homeAbbrev } as never);
        const score = live.liveScore ? `${live.liveScore.away}–${live.liveScore.home}` : null;

        return (
          <button
            key={gamePk}
            type="button"
            onClick={() => (onNavigateToGame ? onNavigateToGame(gamePk) : onSelectGame(gamePk))}
            aria-pressed={selected}
            className={`flex w-[104px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg border px-1.5 py-1 leading-tight transition-colors ${
              selected
                ? 'border-masters bg-accent-soft text-masters'
                : 'border-line bg-card text-ink-muted hover:border-masters/30'
            }`}
          >
            <span className="flex items-center gap-1 text-[11px] font-semibold">
              {logoFor ? (
                <TeamMark logoUrl={logoFor(awayAbbrev)} />
              ) : game.awayTeamId ? (
                <TeamMark teamId={game.awayTeamId} />
              ) : null}
              <span>{awayAbbrev}</span>
              <span className="text-[9px] font-normal text-ink-faint">@</span>
              <span>{homeAbbrev}</span>
              {logoFor ? (
                <TeamMark logoUrl={logoFor(homeAbbrev)} />
              ) : game.homeTeamId ? (
                <TeamMark teamId={game.homeTeamId} />
              ) : null}
            </span>

            <span className="text-[10px]">
              {isLive ? (
                <span className="inline-flex items-center gap-1 font-semibold text-good">
                  <span className="inline-block h-1.5 w-1.5 animate-lb-pulse rounded-full bg-good" />
                  {score ?? formatGameTime(game.firstPitch)}
                  {live.livePeriod ? <span className="font-normal opacity-70">{live.livePeriod}</span> : null}
                </span>
              ) : isFinal ? (
                <span className="text-ink-faint">
                  {score ? `${score} ` : ''}Final
                </span>
              ) : (
                <span className="text-ink-faint">{formatGameTime(game.firstPitch)}</span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** A logo that removes itself rather than leaving a broken-image gap. Pass either `teamId` (MLB's numeric CDN) or a pre-resolved `logoUrl` (every other sport, via a caller-supplied `logoFor`). */
export function TeamMark({ teamId, logoUrl }: { teamId?: number; logoUrl?: string }) {
  const src = logoUrl ?? (teamId != null ? teamLogoUrl(teamId) : undefined);
  if (!src) return null;
  return (
    <img
      src={src}
      alt=""
      className="h-3.5 w-3.5 shrink-0"
      onError={(e) => {
        (e.currentTarget as HTMLImageElement).style.display = 'none';
      }}
    />
  );
}

export default GamesStrip;
