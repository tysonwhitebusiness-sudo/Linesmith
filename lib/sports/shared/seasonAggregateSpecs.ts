/**
 * Per-sport season-aggregate specs — Phase 6.1b / 6.2b.
 *
 * EVERY `statKey` BELOW WAS MEASURED, NOT RECALLED. Each one was confirmed
 * present in `player_game_history.stats` for its sport by counting distinct
 * JSONB keys against the live database on 2026-08-30. That matters because a
 * misspelled key does not fail — `stats->>'wrongKey'` is `NULL`, `SUM` of it
 * is 0, and the stat ranks every entity equal-last with a straight face.
 *
 * The measured key sets:
 *
 * - **NHL** (21 keys): pim, toiMinutes, shifts, blockedShots, giveaways,
 *   assists, plusMinus, sog, goals, powerPlayGoals, takeaways, hits, points,
 *   faceoffWinningPctg — plus seven goalie-only keys (goalsAgainst,
 *   shotsAgainst, evenStrengthGoalsAgainst, shorthandedGoalsAgainst,
 *   powerPlayGoalsAgainst, saves, isGoalie) present on ~6% of rows.
 * - **NBA** (17 keys): points, rebounds, offensiveRebounds, defensiveRebounds,
 *   assists, steals, blocks, turnovers, fouls, plusMinus, minutes,
 *   fieldGoalsMade/Attempted, threePointFieldGoalsMade/Attempted,
 *   freeThrowsMade/Attempted.
 * - **Tennis** (8 keys, the whole vocabulary): is_major, is_qualifying,
 *   match_won, sets_won, sets_lost, games_won, games_lost, tiebreaks_played.
 *
 * GOALS AGAINST IS A REAL DEFENSIVE STAT AND WE HAVE IT. NHL's goalie rows
 * carry `goalsAgainst`/`saves`/`shotsAgainst`, so a team's defence can be
 * graded on what its goaltending actually allowed rather than on a proxy.
 * Summing across a team's goalies for the season is correct — a team plays
 * exactly one goalie at a time, so the season sum is the team's own total.
 *
 * WHAT IS DELIBERATELY ABSENT. NHL power play and penalty kill would need
 * situational time-on-ice, which these keys do not carry: `powerPlayGoals` is
 * a count with no denominator, so a PP *rate* cannot be derived and is not
 * declared. NHL therefore grades three units, not the four the plan sketched.
 * That is the "never fabricate a field to satisfy the type" rule doing its job
 * — the type can express a fourth unit, we simply do not have one.
 */

import type { SeasonAggregateSpec } from './seasonAggregates';

/**
 * NHL. 32 teams; `minGames: 20` keeps a team that has played a handful of
 * games out of a per-game rate ranking.
 */
export const NHL_SEASON_SPEC: SeasonAggregateSpec = {
  sport: 'nhl',
  groupBy: 'team_id',
  minGames: 20,
  stats: [
    { key: 'goalsFor', label: 'Goals/game', statKey: 'goals', decimals: 2, perGame: true, group: 'Offence' },
    { key: 'assists', label: 'Assists/game', statKey: 'assists', decimals: 2, perGame: true, group: 'Offence' },
    { key: 'shotsFor', label: 'Shots/game', statKey: 'sog', decimals: 1, perGame: true, group: 'Offence' },
    { key: 'powerPlayGoals', label: 'PP goals/game', statKey: 'powerPlayGoals', decimals: 2, perGame: true, group: 'Offence' },
    { key: 'goalsAgainst', label: 'Goals against/game', statKey: 'goalsAgainst', decimals: 2, perGame: true, lowerIsBetter: true, group: 'Defence' },
    { key: 'saves', label: 'Saves/game', statKey: 'saves', decimals: 1, perGame: true, group: 'Defence' },
    { key: 'blockedShots', label: 'Blocks/game', statKey: 'blockedShots', decimals: 1, perGame: true, group: 'Defence' },
    { key: 'takeaways', label: 'Takeaways/game', statKey: 'takeaways', decimals: 1, perGame: true, group: 'Defence' },
    { key: 'giveaways', label: 'Giveaways/game', statKey: 'giveaways', decimals: 1, perGame: true, lowerIsBetter: true, group: 'Discipline' },
    { key: 'hits', label: 'Hits/game', statKey: 'hits', decimals: 1, perGame: true, group: 'Discipline' },
    { key: 'pim', label: 'Penalty min/game', statKey: 'pim', decimals: 1, perGame: true, lowerIsBetter: true, group: 'Discipline' },
  ],
  units: [
    { key: 'offence', label: 'Offence', short: 'OFF', statKeys: ['goalsFor', 'assists', 'shotsFor', 'powerPlayGoals'] },
    { key: 'defence', label: 'Defence', short: 'DEF', statKeys: ['goalsAgainst', 'saves', 'blockedShots', 'takeaways'] },
    { key: 'discipline', label: 'Discipline', statKeys: ['giveaways', 'pim'] },
  ],
};

/**
 * NBA. `plusMinus` is deliberately not aggregated to a team level — summing
 * every player's plus/minus double-counts each possession by however many
 * players were on the floor, so the number would be meaningless.
 *
 * `minGames: 20` also does real filtering work here beyond small samples:
 * `player_game_history` carries three non-NBA `team_id`s (111386, 132374,
 * 132375 — All-Star and exhibition sides) with 2-3 games each. The floor
 * excludes them, which is why the pool measures 30 and not 33. Verified rather
 * than assumed.
 */
export const NBA_SEASON_SPEC: SeasonAggregateSpec = {
  sport: 'nba',
  groupBy: 'team_id',
  minGames: 20,
  stats: [
    { key: 'points', label: 'Points/game', statKey: 'points', decimals: 1, perGame: true, group: 'Offence' },
    { key: 'assists', label: 'Assists/game', statKey: 'assists', decimals: 1, perGame: true, group: 'Offence' },
    { key: 'fgMade', label: 'FG made/game', statKey: 'fieldGoalsMade', decimals: 1, perGame: true, group: 'Offence' },
    { key: 'threesMade', label: '3PT made/game', statKey: 'threePointFieldGoalsMade', decimals: 1, perGame: true, group: 'Offence' },
    { key: 'ftMade', label: 'FT made/game', statKey: 'freeThrowsMade', decimals: 1, perGame: true, group: 'Offence' },
    { key: 'rebounds', label: 'Rebounds/game', statKey: 'rebounds', decimals: 1, perGame: true, group: 'Rebounding' },
    { key: 'offRebounds', label: 'Off. rebounds/game', statKey: 'offensiveRebounds', decimals: 1, perGame: true, group: 'Rebounding' },
    { key: 'defRebounds', label: 'Def. rebounds/game', statKey: 'defensiveRebounds', decimals: 1, perGame: true, group: 'Rebounding' },
    { key: 'steals', label: 'Steals/game', statKey: 'steals', decimals: 1, perGame: true, group: 'Defence' },
    { key: 'blocks', label: 'Blocks/game', statKey: 'blocks', decimals: 1, perGame: true, group: 'Defence' },
    { key: 'turnovers', label: 'Turnovers/game', statKey: 'turnovers', decimals: 1, perGame: true, lowerIsBetter: true, group: 'Defence' },
    { key: 'fouls', label: 'Fouls/game', statKey: 'fouls', decimals: 1, perGame: true, lowerIsBetter: true, group: 'Defence' },
  ],
  units: [
    { key: 'offence', label: 'Offence', short: 'OFF', statKeys: ['points', 'assists', 'fgMade', 'threesMade'] },
    { key: 'defence', label: 'Defence', short: 'DEF', statKeys: ['steals', 'blocks', 'turnovers', 'fouls'] },
    { key: 'rebounding', label: 'Rebounding', short: 'REB', statKeys: ['rebounds', 'offRebounds', 'defRebounds'] },
  ],
};

/**
 * Tennis, per PLAYER — `groupBy: 'athlete_id'`, because all 271,964 tennis
 * rows carry a null `team_id` and a match is two players, not two teams.
 *
 * Everything here is derived from the eight keys we store, and nothing else.
 * `minGames: 10` is the pool floor: with 17,846 athletes on record, a player
 * with three matches ranking first on games-won rate would be a wrong number,
 * not a noisy one.
 *
 * TWO OF THE EIGHT KEYS ARE NOT USED HERE, AND ONE OF THEM IS DEAD.
 *
 * - **`is_major` is `0.0` on every tennis row, every season, both tours.**
 *   Measured 2026-08-30: `SUM((stats->>'is_major')::numeric)` is exactly 0
 *   across all 129,812 ATP and 142,152 WTA rows. The key exists and is always
 *   false, so the sport's real vocabulary is **seven** usable keys, not the
 *   eight the data-gap audit counted. It supported a "level of competition"
 *   ranking that would have shown every player tied at zero with an arbitrary
 *   rank each — a wrong number displayed, which is worse than a missing block.
 *   `is_qualifying` IS real (20,804 ATP / 23,590 WTA) and is used instead.
 * - **`tiebreaks_played` is real but has no polarity.** Every ranked row in
 *   this UI means "rank 1 is best"; more tiebreaks is neither. It is left out
 *   rather than ranked under an ordering it does not have.
 *
 * NOTE ON WHAT IS NOT HERE. Hold %, break %, break points saved, first- and
 * second-serve points won and return points won are **not** derivable from
 * these keys — they are match-summary stats we do not store. Phase 6.12 is to
 * confirm whether ESPN's tennis summary carries them; until it does, they are
 * absent rather than approximated. Serve placement and serve mix were cut
 * outright (operator, 2026-08-29) as point-level data needing a paid vendor.
 */
export const TENNIS_ATP_SEASON_SPEC: SeasonAggregateSpec = {
  sport: 'tennis_atp',
  groupBy: 'athlete_id',
  minGames: 10,
  stats: [
    { key: 'matchWinRate', label: 'Match win %', statKey: 'match_won', decimals: 3, perGame: true, group: 'Results' },
    { key: 'setsWon', label: 'Sets won/match', statKey: 'sets_won', decimals: 2, perGame: true, group: 'Results' },
    { key: 'setsLost', label: 'Sets lost/match', statKey: 'sets_lost', decimals: 2, perGame: true, lowerIsBetter: true, group: 'Results' },
    { key: 'gamesWon', label: 'Games won/match', statKey: 'games_won', decimals: 2, perGame: true, group: 'Games' },
    { key: 'gamesLost', label: 'Games lost/match', statKey: 'games_lost', decimals: 2, perGame: true, lowerIsBetter: true, group: 'Games' },
    { key: 'qualifying', label: 'Qualifying share', statKey: 'is_qualifying', decimals: 3, perGame: true, lowerIsBetter: true, group: 'Level' },
  ],
  units: [
    { key: 'results', label: 'Results', short: 'RES', statKeys: ['matchWinRate', 'setsWon', 'setsLost'] },
    { key: 'gameControl', label: 'Game control', short: 'GMS', statKeys: ['gamesWon', 'gamesLost'] },
  ],
  // Doubles pairings are stored as compound athlete ids and are 19% of ATP
  // rows — see `excludeCompoundIds`' own comment for the measurement.
  excludeCompoundIds: true,
};

/** WTA is structurally identical to ATP — same eight keys, its own ranking pool. */
export const TENNIS_WTA_SEASON_SPEC: SeasonAggregateSpec = { ...TENNIS_ATP_SEASON_SPEC, sport: 'tennis_wta' };

/**
 * Keyed by the value a route or adapter passes as `sport`. Tennis is split by
 * tour because a WTA player should not be ranked inside the ATP pool; the
 * caller supplies `tennis_atp`/`tennis_wta`, matching what
 * `player_game_history` itself stores. Same vocabulary trap CURRENT.md §4
 * flags: `pick_history.sport` is `'soccer'` while this table uses
 * `soccer_epl`/`soccer_mls`.
 */
export const SEASON_AGGREGATE_SPECS: Record<string, SeasonAggregateSpec> = {
  nhl: NHL_SEASON_SPEC,
  nba: NBA_SEASON_SPEC,
  tennis_atp: TENNIS_ATP_SEASON_SPEC,
  tennis_wta: TENNIS_WTA_SEASON_SPEC,
};

export const SEASON_AGGREGATE_SPORTS = Object.keys(SEASON_AGGREGATE_SPECS);
