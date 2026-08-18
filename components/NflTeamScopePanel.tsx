'use client';

import type { PickCandidate } from '@/lib/core/types';
import { candidateKey } from '@/lib/core/types';
import type { UnifiedGameLine } from '@/lib/odds/types';
import { OddsChip } from './OddsChip';
import { TeamLogo, nflTeamLogoUrl } from './SubjectAvatar';

/**
 * NFL's team-scope rail content — the honest equivalent of GameDetail's
 * `TeamScopePanel`, which is hardcoded Good-Bets-only copy ("below bar")
 * that doesn't fit NFL (no graded history to gate against, per LeftRail's
 * `goodBetsGated={false}`). Lists the game's real team-level candidates
 * (moneyline/total/team total, both sides) with real odds pulled from the
 * shared `gameLine`, honest "No price yet" per-row when one isn't posted —
 * nothing here is Good-Bets-gated, so no "below bar" framing anywhere.
 */
export function NflTeamScopePanel({
  rawTeamCandidates,
  gameLine,
  homeAbbr,
  onAdd,
  pickedKeys,
}: {
  rawTeamCandidates: PickCandidate[];
  gameLine: UnifiedGameLine | null;
  homeAbbr: string;
  onAdd?: (candidate: PickCandidate, oddsInfo?: { americanOdds: string; source: string }) => void;
  pickedKeys?: Set<string>;
}) {
  if (rawTeamCandidates.length === 0) {
    return <p className="p-4 text-center text-dense text-ink-faint">No team-level line yet.</p>;
  }

  return (
    <div className="flex flex-col divide-y divide-line/60">
      {rawTeamCandidates.map((c) => {
        const meta = (c.subjectMeta ?? {}) as Record<string, unknown>;
        const teamAbbr = typeof meta.team === 'string' ? meta.team : '';
        const isHomeTeam = teamAbbr === homeAbbr;

        let american: number | null = null;
        if (c.dimension === 'moneyline') {
          american = isHomeTeam ? gameLine?.moneyline?.home ?? null : gameLine?.moneyline?.away ?? null;
        } else if (c.dimension === 'game-total') {
          american = c.category === 'under' ? gameLine?.total?.underPrice ?? null : gameLine?.total?.overPrice ?? null;
        }

        const label = c.dimension === 'game-total' ? `${c.dimensionLabel} ${c.line}` : `${teamAbbr} ${c.dimensionLabel}${c.dimension === 'team-total-points' ? ` ${c.line}` : ''}`;
        const picked = pickedKeys?.has(candidateKey(c)) ?? false;

        return (
          <div key={candidateKey(c)} className="flex items-center justify-between gap-2 px-3 py-2.5 text-dense">
            <span className="flex min-w-0 items-center gap-2">
              <TeamLogo logoUrl={nflTeamLogoUrl(teamAbbr)} abbreviation={teamAbbr} size={20} />
              <span className="truncate">{label}</span>
            </span>
            <div className="flex shrink-0 items-center gap-2">
              {american != null ? (
                <OddsChip price={american} source="odds-api" />
              ) : (
                <span className="text-[10.5px] text-ink-faint">No price yet</span>
              )}
              {onAdd ? (
                <button
                  type="button"
                  onClick={() => onAdd(c, american != null ? { americanOdds: String(american), source: 'odds-api' } : undefined)}
                  className="lb-btn-primary rounded-md bg-masters px-2 py-1 text-[10.5px] font-semibold text-white"
                >
                  {picked ? 'On slip ✓' : 'Add'}
                </button>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default NflTeamScopePanel;
