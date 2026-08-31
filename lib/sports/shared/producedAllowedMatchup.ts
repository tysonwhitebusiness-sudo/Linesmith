/**
 * The game page's team-matchup card, built from the season rollup read from
 * both ends — Phase 6.15.
 *
 * WHAT THIS SOLVES. `GameMatchupData` was filled by MLB (starter vs lineup),
 * NFL, CFB and soccer, and `null` on NBA, NHL and tennis. The three that had
 * it and are not MLB all build the same thing: this team's own production
 * against what the other team ALLOWS. The blocker for NBA and NHL was never
 * the shape — it was that nothing computed an "allowed" side for them.
 *
 * IT DID NOT NEED A NEW SOURCE. `player_game_history.opponent_id` is non-null
 * on 100% of rows in every sport, so grouping the identical rows by who was
 * played AGAINST is what a team gave up. `toAllowedSpec` does exactly that and
 * inverts every stat's polarity; see its doc comment for why the inversion is
 * blanket rather than per-stat. Verified end to end before this file was
 * written: NBA's stingiest defence comes out at 107.1 points allowed per game
 * ranked 1st, its leakiest at 126.0 ranked 30th, and the team forcing the most
 * turnovers ranks 1st rather than last.
 *
 * WHY NOT `teamDefenseAllowed.ts`. NBA and NHL each have one, and CFB's game
 * adapter is built on its equivalent. They are live ESPN scrapes; NBA's own
 * header says it is UNVERIFIED against a real response, and all three sports
 * are out of season today, so a card built on them could not be checked at
 * all. This reads a table we own, for a season that has actually been played.
 * CFB and soccer keep theirs — they work, and CFB's carries a real allowed
 * split this rollup has no equivalent for at the position-group level.
 *
 * ONLY THE OFFENSIVE UNIT'S STATS APPEAR. A card pairing all twelve NBA stats
 * against all twelve allowed ones is a table, not a matchup. The caller names
 * the unit whose stats frame the question ("offence"), and both sides use the
 * SAME stat keys, so the card lines a produced row up with the allowed row
 * beneath it instead of showing two unrelated lists.
 */

import type { EntitySeasonAggregate, SeasonAggregateSpec } from './seasonAggregateShapes';
import type { OpposingStarterStat } from '@/components/PlayerDetail';
import type { BatterPitcherMatchupProps } from '@/components/BatterPitcherMatchupCard';

export interface MatchupSide {
  abbr: string;
  name: string;
  logoUrl?: string;
  /** This side's own production. */
  produced: EntitySeasonAggregate | null | undefined;
  /** What this side allows — the `opponent_id` rollup for the same entity. */
  allowed: EntitySeasonAggregate | null | undefined;
}

/** The `tabs`/`teamAway`/`teamHome` subset of `GameMatchupData` this builds. */
export interface ProducedAllowedMatchup {
  tabs: Array<{ key: string; label: string }>;
  teamAway: BatterPitcherMatchupProps | null;
  teamHome: BatterPitcherMatchupProps | null;
}

function pick(agg: EntitySeasonAggregate | null | undefined, keys: readonly string[]): OpposingStarterStat[] {
  if (!agg) return [];
  const wanted = new Set(keys);
  return agg.stats.filter((s) => wanted.has(s.key));
}

function oneSide(
  subject: MatchupSide,
  opponent: MatchupSide,
  keys: readonly string[],
): BatterPitcherMatchupProps | null {
  const subjectStats = pick(subject.produced, keys);
  const opponentStats = pick(opponent.allowed, keys);
  // Both halves must be real. One side alone is a season-stats list, not a
  // matchup, and the card would render a heading claiming a comparison that is
  // not on screen.
  if (subjectStats.length === 0 || opponentStats.length === 0) return null;
  return {
    // NAMED BY DIRECTION. Two cards with the same heading is a defect this
    // family already had once — see CFB's adapter, where both read "Team
    // matchup" and nothing said which way round either was.
    title: `${subject.abbr} offense vs ${opponent.abbr} defense`,
    subjectName: subject.name,
    subjectHeadshotUrl: subject.logoUrl,
    subjectTeamAbbr: subject.abbr,
    subjectTeamLogoUrl: subject.logoUrl,
    subjectStats,
    subjectRoleLabel: 'Produces',
    opponentName: `${opponent.abbr} defense`,
    opponentHeadshotUrl: opponent.logoUrl,
    opponentTeamAbbr: opponent.abbr,
    opponentTeamLogoUrl: opponent.logoUrl,
    opponentStats,
    opponentRoleLabel: 'Allows',
  };
}

/**
 * `null` when neither direction has both halves — the component then renders
 * nothing rather than an empty card, which is what `GameDetailData.matchup`'s
 * `null` already means everywhere else.
 *
 * `unitKey` names the spec unit whose stats frame the card. A unit key the
 * spec does not declare yields no stats and therefore `null`, rather than
 * silently falling back to every stat in the spec.
 */
export function toProducedAllowedMatchup(
  spec: SeasonAggregateSpec,
  unitKey: string,
  away: MatchupSide,
  home: MatchupSide,
): ProducedAllowedMatchup | null {
  const keys = spec.units.find((u) => u.key === unitKey)?.statKeys ?? [];
  if (keys.length === 0) return null;
  const teamAway = oneSide(away, home, keys);
  const teamHome = oneSide(home, away, keys);
  if (!teamAway && !teamHome) return null;
  return { tabs: [{ key: 'team', label: 'Team' }], teamAway, teamHome };
}
