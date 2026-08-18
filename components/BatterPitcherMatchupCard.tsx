'use client';

import { SubjectAvatar, TeamLogo, mlbHeadshotUrl } from './SubjectAvatar';
import type { OpposingStarterStat } from './PlayerDetail';
import { StatRankRow, TwoSidedStatRankRow } from './StatRankRow';

/**
 * A generic two-side matchup card, used for batter-vs-opposing-pitcher
 * (Player Detail, batter subject), pitcher-vs-opposing-lineup (Player
 * Detail, pitcher subject), and team-vs-opposing-pitcher (Team Detail).
 *
 * Two stat groups, because a batter and a pitcher genuinely don't have the
 * same stats to compare:
 *  - "Quality of contact" — the 4 Statcast rates both sides actually share
 *    (barrel%, exit velo, hard-hit%, whiff%), shown two-sided. Every
 *    rank/poolSize pair is already oriented so 1 = best-for-that-role by the
 *    adapter (a pitcher's rates are "allowed", lower is better pitching; a
 *    batter's or team's own are "produced", higher is better hitting), so
 *    no sign-flipping is needed to compare them directly.
 *  - "Season stats" — each side's own normal counting/rate stats (AVG/OBP/
 *    SLG/OPS/HR/RBI for a batter or team; ERA/WHIP/K/BB/H/HR-allowed/FIP/
 *    K-BB% for a pitcher), shown solo side by side — there's no "vs" framing
 *    here since a batter has no ERA and a pitcher has no RBI.
 *
 * Callers pass each side's *entire* ranked stat list in `subjectStats`/
 * `opponentStats` (quality-of-contact keys and season-stat keys mixed
 * together) — this component splits them by whether the key is one of the
 * 4 shared quality-of-contact keys, not by caller-declared role, so it stays
 * generic across batter/pitcher/team without extra branching.
 *
 * `subjectRoleLabel`/`opponentRoleLabel` ("Produces"/"Allows" by default)
 * label only the Quality of Contact rows — that's the one block where both
 * sides genuinely share the same stat, so "produces this / allows that"
 * is a real comparison. Season stats don't get the label: a pitcher's own
 * strikeout count isn't something he "allows", so applying the same
 * produces/allows framing there was actively misleading.
 *
 * No percentile ring, no stat-edge tally, no Scouting/Head-to-head/Rails
 * toggle — those all assumed a single symmetric stat pool the way the
 * two-*pitcher* `PitchingMatchupCard` genuinely has; this comparison doesn't,
 * so a plain two-section row-bar layout is the honest shape here.
 */

const QUALITY_STATS: Array<{ key: string; label: string }> = [
  { key: 'barrelPct', label: 'Barrel%' },
  { key: 'exitVelo', label: 'Avg exit velo' },
  { key: 'hardHitPct', label: 'Hard-hit%' },
  { key: 'whiffPct', label: 'Whiff%' },
];
const QUALITY_KEYS = new Set(QUALITY_STATS.map((s) => s.key));

function byKey(stats: OpposingStarterStat[]): Map<string, OpposingStarterStat> {
  return new Map(stats.map((s) => [s.key, s]));
}

export interface BatterPitcherMatchupProps {
  /** Defaults to 'Contact quality matchup' — set explicitly for a non-batter-vs-pitcher framing (e.g. a pitcher vs. the opposing lineup). */
  title?: string;
  subjectName: string;
  subjectHeadshotUrl?: string;
  subjectTeamAbbr?: string;
  subjectTeamLogoUrl?: string;
  /** Every ranked stat this side has — quality-of-contact keys and season-stat keys together. */
  subjectStats: OpposingStarterStat[];
  /** Defaults to 'Produces' — set to 'Allows' when the subject is the pitcher (e.g. "Pitcher vs. lineup" mode). */
  subjectRoleLabel?: string;

  opponentName: string;
  /** MLB person ID, when the opponent is a specific player (omit for a team-wide opponent, e.g. an opposing lineup). */
  opponentId?: number;
  /** Falls back to `mlbHeadshotUrl(opponentId)` when omitted — pass a team logo URL here instead for a team-wide opponent. */
  opponentHeadshotUrl?: string;
  opponentHand?: string;
  opponentTeamAbbr?: string;
  opponentTeamLogoUrl?: string;
  opponentStats: OpposingStarterStat[];
  /** Defaults to 'Allows'. */
  opponentRoleLabel?: string;
}

export function BatterPitcherMatchupCard({
  title = 'Contact quality matchup',
  subjectName,
  subjectHeadshotUrl,
  subjectTeamAbbr,
  subjectTeamLogoUrl,
  subjectStats,
  subjectRoleLabel = 'Produces',
  opponentName,
  opponentId,
  opponentHeadshotUrl,
  opponentHand,
  opponentTeamAbbr,
  opponentTeamLogoUrl,
  opponentStats,
  opponentRoleLabel = 'Allows',
}: BatterPitcherMatchupProps) {
  const subject = byKey(subjectStats);
  const opponent = byKey(opponentStats);

  const subjectSeasonStats = subjectStats.filter((s) => !QUALITY_KEYS.has(s.key));
  const opponentSeasonStats = opponentStats.filter((s) => !QUALITY_KEYS.has(s.key));
  const hasQuality = QUALITY_STATS.some((def) => subject.has(def.key) || opponent.has(def.key));
  const hasSeason = subjectSeasonStats.length > 0 || opponentSeasonStats.length > 0;

  return (
    <section className="lb-card overflow-hidden">
      <div className="bg-accent-soft px-3 py-1.5">
        <h2 className="text-[10.5px] font-bold uppercase tracking-wide text-masters">{title}</h2>
      </div>

      <div className="p-3">
        {/* Identity header — plain, no composite ring: a pitcher's 8-stat
            profile and a batter's 4-stat one aren't the same claim, so no
            single number here would mean the same thing on both sides. */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5 text-left">
            <SubjectAvatar name={subjectName} headshotUrl={subjectHeadshotUrl} size={40} />
            <div className="min-w-0">
              <TeamLogo logoUrl={subjectTeamLogoUrl} abbreviation={subjectTeamAbbr} size={13} />
              <div className="truncate text-emphasis font-bold leading-tight text-ink">{subjectName}</div>
            </div>
          </div>

          <div className="flex min-w-0 flex-row-reverse items-center gap-2.5 text-right">
            <SubjectAvatar name={opponentName} headshotUrl={opponentHeadshotUrl ?? mlbHeadshotUrl(opponentId)} size={40} />
            <div className="min-w-0">
              <div className="flex flex-row-reverse items-center">
                <TeamLogo logoUrl={opponentTeamLogoUrl} abbreviation={opponentTeamAbbr} size={13} />
              </div>
              <div className="truncate text-emphasis font-bold leading-tight text-ink">{opponentName}</div>
              {opponentHand ? <div className="text-label text-ink-faint">{opponentHand}HP</div> : null}
            </div>
          </div>
        </div>

        {/* Solo counting/rate stats — each side's own numbers, no "produces
            vs. allows" framing here: that comparison only holds for stats
            both sides actually share (e.g. a pitcher's own strikeout count
            isn't something he "allows"). That framing belongs on Quality of
            Contact below, where every stat genuinely is shared. */}
        {hasSeason ? (
          <div className="mt-3 border-t border-line pt-3">
            <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-wide text-ink-faint">Season stats</div>
            <div className="grid grid-cols-1 gap-x-5 gap-y-1.5 sm:grid-cols-2">
              <div className="space-y-1.5">
                {subjectSeasonStats.map((s) => (
                  <StatRankRow key={s.key} stat={s} />
                ))}
              </div>
              <div className="space-y-1.5">
                {opponentSeasonStats.map((s) => (
                  <StatRankRow key={s.key} stat={s} />
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {hasQuality ? (
          <div className="mt-3 border-t border-line pt-3">
            <div className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-ink-faint">Quality of contact</div>
            <div className="mb-1 grid grid-cols-[44px_1fr_1fr_44px] items-center gap-1.5">
              <span aria-hidden />
              <span className="text-[9px] font-semibold uppercase tracking-wide text-masters">{subjectRoleLabel}</span>
              <span className="text-right text-[9px] font-semibold uppercase tracking-wide text-masters">{opponentRoleLabel}</span>
              <span aria-hidden />
            </div>
            <div className="divide-y divide-line/50">
              {QUALITY_STATS.map((def) => (
                <TwoSidedStatRankRow key={def.key} label={def.label} subject={subject.get(def.key)} opponent={opponent.get(def.key)} />
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export default BatterPitcherMatchupCard;
