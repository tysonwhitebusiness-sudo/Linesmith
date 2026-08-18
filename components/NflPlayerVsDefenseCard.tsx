'use client';

import type { PlayerSeasonStats } from '@/lib/sports/nfl/nflverse';
import { SubjectAvatar, TeamLogo } from './SubjectAvatar';
import { StatRankRow } from './StatRankRow';
import type { OpposingStarterStat } from './PlayerDetail';

/**
 * A skill player's own stats vs. the opponent's real ranked defense-allowed
 * numbers in the matching group — the honest NFL translation of MLB's
 * batter-vs-pitcher matchup (there's no 1:1 player matchup in football; the
 * real opponent is a defense's whole position group, not one person).
 *
 * Originally built inline in `NflTeamDetail.tsx`'s player-matchup mode;
 * factored out here once `NflPlayerDetail.tsx` needed the identical card.
 *
 * Deliberately not `BatterPitcherMatchupCard`: that card's stat rows assume
 * a real league-wide rank on *both* sides, and no player-level rank source
 * exists yet for NFL (only the real 32-team defense ranks do) — so the
 * subject's own rows render as plain numbers rather than inventing a rank
 * that isn't real, per the same honesty rule `windowedStat.ts` enforces for
 * `insufficient` windows.
 */

/**
 * Which of the opponent's real defense-allowed groups a position's own
 * markets should be compared against — a list, not a single group, because
 * the Receiving group alone is thin (nflverse's team-week data only has one
 * real receiving-specific column, `receptions-allowed`; receiving yards/TDs
 * allowed are identical to pass-yards/TDs-allowed at the team level, since
 * every completion is a reception, so duplicating them as separate rows
 * would just repeat the same number under a different label). A WR/TE's
 * real outlook tracks the opponent's overall pass defense as much as their
 * raw catch-allowed rate, so both groups show; a QB only needs Passing.
 */
export const MATCHUP_GROUP_BY_POSITION: Record<string, string[]> = {
  QB: ['Passing'],
  RB: ['Rushing', 'Receiving'],
  FB: ['Rushing', 'Receiving'],
  WR: ['Passing', 'Receiving'],
  TE: ['Passing', 'Receiving'],
};

/** A skill player's own per-game rates for whichever category their position produces. */
export function playerMatchupRows(seasonStats: PlayerSeasonStats | null | undefined, position: string | null | undefined): Array<{ label: string; value: number; decimals: number }> {
  const s = seasonStats;
  if (!s || s.games === 0) return [];
  const perGame = (n: number) => n / s.games;
  switch (position) {
    case 'QB':
      return [
        { label: 'Pass Yds/Gm', value: perGame(s.passingYards), decimals: 1 },
        { label: 'Pass TD/Gm', value: perGame(s.passingTds), decimals: 2 },
        { label: 'Rush Yds/Gm', value: perGame(s.rushingYards), decimals: 1 },
      ];
    case 'RB':
    case 'FB':
      return [
        { label: 'Rush Yds/Gm', value: perGame(s.rushingYards), decimals: 1 },
        { label: 'Rush TD/Gm', value: perGame(s.rushingTds), decimals: 2 },
        { label: 'Rec/Gm', value: perGame(s.receptions), decimals: 1 },
      ];
    case 'WR':
    case 'TE':
      return [
        { label: 'Rec/Gm', value: perGame(s.receptions), decimals: 1 },
        { label: 'Rec Yds/Gm', value: perGame(s.receivingYards), decimals: 1 },
        { label: 'Rec TD/Gm', value: perGame(s.receivingTds), decimals: 2 },
      ];
    default:
      return [];
  }
}

export interface NflPlayerVsDefenseCardProps {
  title?: string;
  playerName: string;
  playerHeadshotUrl?: string;
  playerFallbackUrl?: string;
  playerTeamAbbr?: string;
  playerTeamLogoUrl?: string;
  ownRows: Array<{ label: string; value: number; decimals: number }>;
  opponentAbbr: string;
  opponentLogoUrl?: string;
  opponentStats: OpposingStarterStat[];
}

export function NflPlayerVsDefenseCard({
  title = 'Player matchup',
  playerName,
  playerHeadshotUrl,
  playerFallbackUrl,
  playerTeamAbbr,
  playerTeamLogoUrl,
  ownRows,
  opponentAbbr,
  opponentLogoUrl,
  opponentStats,
}: NflPlayerVsDefenseCardProps) {
  return (
    <section className="lb-card overflow-hidden">
      <div className="bg-accent-soft px-3 py-1.5">
        <h2 className="text-[10.5px] font-bold uppercase tracking-wide text-masters">{title}</h2>
      </div>
      <div className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5 text-left">
            <SubjectAvatar name={playerName} headshotUrl={playerHeadshotUrl} fallbackUrl={playerFallbackUrl} size={40} />
            <div className="min-w-0">
              <TeamLogo logoUrl={playerTeamLogoUrl} abbreviation={playerTeamAbbr} size={13} />
              <div className="truncate text-emphasis font-bold leading-tight text-ink">{playerName}</div>
            </div>
          </div>
          <div className="flex min-w-0 flex-row-reverse items-center gap-2.5 text-right">
            <SubjectAvatar name={`${opponentAbbr} defense`} headshotUrl={opponentLogoUrl} size={40} />
            <div className="min-w-0">
              <div className="flex flex-row-reverse items-center">
                <TeamLogo logoUrl={opponentLogoUrl} abbreviation={opponentAbbr} size={13} />
              </div>
              <div className="truncate text-emphasis font-bold leading-tight text-ink">{opponentAbbr} defense</div>
            </div>
          </div>
        </div>

        <div className="mt-3 border-t border-line pt-3">
          <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-wide text-ink-faint">Season stats</div>
          <div className="grid grid-cols-1 gap-x-5 gap-y-1.5 sm:grid-cols-2">
            <div className="space-y-1.5">
              {ownRows.length === 0 ? (
                <p className="text-[11px] text-ink-faint">No season stats yet.</p>
              ) : (
                ownRows.map((r) => (
                  <div key={r.label} className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="text-ink-faint">{r.label}</span>
                    <span className="font-semibold tabular-nums">{r.value.toFixed(r.decimals)}</span>
                  </div>
                ))
              )}
            </div>
            <div className="space-y-1.5">
              {opponentStats.map((s) => <StatRankRow key={s.key} stat={s} />)}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default NflPlayerVsDefenseCard;
