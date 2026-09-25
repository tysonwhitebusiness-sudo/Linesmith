/**
 * The Slate's Specials (S4): odds-free rankings for the books' common promos,
 * with receipts.
 *
 * PYTHON WRITES, TYPESCRIPT RENDERS. `slate_rankings` is written by
 * `python-odds-service/src/slate_rankings.py` (M3) — the rank, the score, every
 * factor's raw value and its percentile, the freeze time and, the morning
 * after, what actually happened. Nothing here computes a ranking; it reads one.
 *
 * The one thing this file owns is the WORDS: each factor's column label and
 * the sentence naming its source. Those are declared in Python beside the
 * factor and mirrored here, and `tests/slate-specials.test.ts` parses the
 * Python file and fails if the two ever disagree — the same guard
 * `config-drift.test.ts` keeps on the bookmaker alias maps.
 *
 * NONE OF IT IS A PROBABILITY. The score is the mean of each factor's
 * percentile across today's pool, with EQUAL weights until a pre-registered
 * backtest sets them (M3), and every caption says both of those things.
 */

import { pgAll } from '../db/pgClient';

export interface SpecialFactorDef {
  key: string;
  label: string;
  info: string;
}

export interface SpecialRankingDef {
  id: string;
  title: string;
  /** The book promo this answers, in the book's own words. */
  promo: string;
  factors: SpecialFactorDef[];
  /** What the ranking would use and cannot, said on the card. */
  notHeld?: string;
}

/**
 * Mirrors `RANKINGS` in `slate_rankings.py`. Keep them identical — the test
 * reads the Python file and compares.
 *
 * The SPECIALS (`kind='special'`): a book's promo, ranked and graded the next
 * morning. The spotlights are the record below.
 */
export const SPECIAL_ONLY_RANKINGS: Record<string, SpecialRankingDef> = {
  'mlb-hr-of-the-day': {
    id: 'mlb-hr-of-the-day',
    title: 'HR of the day',
    promo: 'Player to hit a home run',
    factors: [
      { key: 'hr_per_pa', label: 'HR/PA', info: 'Share of plate appearances ending in a home run this season.' },
      { key: 'vs_hand_hr_pa', label: 'vs hand', info: 'The same share against the hand this starter throws (Statcast split).' },
      { key: 'starter_hr_per_start', label: 'SP HR allowed', info: 'Home runs the opposing starter has allowed per start.' },
      { key: 'park_factor', label: 'Park', info: 'Park run factor this season: 1.18 = 18% more runs than average.' },
      { key: 'opp_staff_hr_rate', label: 'Staff HR%', info: 'Share of games the opposing staff has allowed a home run.' },
      { key: 'temp_f', label: 'Temp', info: 'Temperature at first pitch (Open-Meteo); warm air carries. Roofed parks are left out.' },
      { key: 'wind_out', label: 'Wind out', info: 'Wind blowing out toward center at first pitch, mph; negative blows in. Roofed parks are left out.' },
    ],
    notHeld: 'Lineup spot is not held.',
  },
  'mlb-longest-hr': {
    id: 'mlb-longest-hr',
    title: 'Longest home run',
    promo: "Hit the day's longest home run",
    factors: [
      { key: 'barrel_pct', label: 'Barrel %', info: 'Share of balls in play hit 98+ mph at 26 to 30 degrees this season (Statcast).' },
      { key: 'max_ev', label: 'Max EV', info: 'The hardest-hit ball this season, mph (Statcast).' },
      { key: 'avg_hr_dist', label: 'Avg HR', info: "Average true distance of this season's home runs, feet (Statcast)." },
      { key: 'hr_430', label: '430+ HR', info: 'Home runs of 430 feet or more this season (Statcast).' },
      { key: 'sp_hr9', label: 'SP HR/9', info: 'Home runs per nine innings the opposing starter has allowed this season.' },
      { key: 'temp_f', label: 'Temp', info: 'Temperature at first pitch (Open-Meteo); warm air carries. Roofed parks are left out.' },
      { key: 'wind_out', label: 'Wind out', info: 'Wind blowing out toward center at first pitch, mph; negative blows in. Roofed parks are left out.' },
    ],
    notHeld: 'A park distance factor and the lineup spot are not held.',
  },
  'mlb-most-strikeouts': {
    id: 'mlb-most-strikeouts',
    title: 'Most strikeouts',
    promo: 'Most strikeouts on the slate',
    factors: [
      { key: 'projected_k', label: 'Proj K', info: "The MLB prop model's projected strikeouts for this start." },
      { key: 'k_per_start', label: 'K/start', info: 'Strikeouts per start this season.' },
      { key: 'opp_k_per_game', label: 'Opp K/G', info: "Strikeouts the opponent's batters take per game this season." },
    ],
  },
  'nfl-anytime-td': {
    id: 'nfl-anytime-td',
    title: 'Pick-3 anytime TD',
    promo: 'Pick 3 players to score a TD',
    factors: TD_FACTORS(),
    notHeld: 'Red-zone role is not held.',
  },
  'nfl-longest-reception': {
    id: 'nfl-longest-reception',
    title: 'Longest reception',
    promo: "Make the slate's longest catch",
    factors: [
      { key: 'adot', label: 'aDOT', info: 'Average air yards per target, last two seasons (nflverse play-by-play).' },
      { key: 'deep_tgt_pg', label: 'Deep tgt/G', info: 'Targets thrown 20+ air yards downfield, per game.' },
      { key: 'air_share', label: 'Air share', info: "Share of the team's air yards in the games the player played." },
      { key: 'yac_per_rec', label: 'YAC/rec', info: 'Yards after the catch per reception.' },
      { key: 'avg_long', label: 'Avg long', info: 'Average longest catch per game, last two seasons.' },
      { key: 'opp_20_allowed', label: 'Opp 20+/G', info: "Completions of 20+ yards the opponent's defense allows per game." },
    ],
    notHeld: "Coverage shell and the quarterback's deep accuracy are not held.",
  },
  'cfb-anytime-td': {
    id: 'cfb-anytime-td',
    title: 'Pick-3 anytime TD',
    promo: 'Pick 3 players to score a TD',
    factors: TD_FACTORS(),
    notHeld: 'CFB holds no position-group split, so the opponent factor is team-wide.',
  },
  'soccer-anytime-goalscorer': {
    id: 'soccer-anytime-goalscorer',
    title: 'Anytime goalscorer',
    promo: 'Anytime goalscorer',
    factors: [
      { key: 'goals_per_game', label: 'Goals/G', info: 'Goals per appearance, last two seasons.' },
      { key: 'shots_per_game', label: 'Shots/G', info: 'Shots per appearance.' },
      { key: 'sot_per_game', label: 'On target/G', info: 'Shots on target per appearance.' },
      { key: 'opp_goals_allowed', label: 'Opp allows/G', info: 'Goals the opponent concedes per game this season.' },
    ],
    notHeld: 'Penalty takers and confirmed lineups are not held.',
  },
  'nhl-two-goals': {
    id: 'nhl-two-goals',
    title: 'Two goals',
    promo: 'Player to score 2+ goals',
    factors: [
      { key: 'goals_pg', label: 'Goals/G', info: 'Goals per game, last two seasons.' },
      { key: 'sog_pg', label: 'Shots/G', info: 'Shots on goal per game.' },
      { key: 'multi_goal_rate', label: '2+ G games', info: 'Share of games with two or more goals, last two seasons.' },
      { key: 'pp_goals_pg', label: 'PP goals/G', info: 'Power-play goals per game.' },
      { key: 'toi', label: 'TOI', info: 'Average time on ice per game, minutes.' },
      { key: 'opp_ga_pg', label: 'Opp GA/G', info: 'Goals the opponent allows per game, last two seasons.' },
      { key: 'opp_save_pct', label: 'Opp SV%', info: "The opponent's team save percentage, last two seasons." },
    ],
    notHeld: 'Expected goals, power-play ice time and the confirmed starting goalie are not held.',
  },
};

/**
 * The SPOTLIGHTS (PY-B, `kind='spotlight'`): the same table, the same writer
 * and the same words, but never graded and never a book promo. They are
 * research flags — what is unusual about a player, a team or a game today —
 * so the research pages chip them and the Slate lists them beside the two
 * universal TS cards.
 *
 * They live in their own record only so `rankingKind()` can answer which kind
 * an id is from the registry itself rather than from a comment.
 */
export const SPOTLIGHT_RANKINGS: Record<string, SpecialRankingDef> = {
  // P12 §3 — odds research flags (python-odds-service/src/odds_flags.py). Facts
  // about how the market moved, every sport; never graded, never a pick.
  'odds-steam': {
    id: 'odds-steam', title: 'Steam', promo: 'Three or more books moved the line together',
    factors: [
      { key: 'steam_books', label: 'Books', info: "Books that moved this player's main line the same way within 30 minutes, the first mover included." },
      { key: 'steam_minutes', label: 'Minutes', info: 'Minutes from the first move to the last book in the run.' },
    ],
  },
  'odds-pulled': {
    id: 'odds-pulled', title: 'Pulled and reposted', promo: 'A book took its line down and put up a new one',
    factors: [{ key: 'repost_move', label: 'Moved', info: 'How far the book reposted the line from the main line it pulled.' }],
  },
  'odds-money-split': {
    id: 'odds-money-split', title: 'Money vs bets', promo: "DraftKings customers' money and bets 15+ points apart",
    factors: [{ key: 'money_gap', label: 'Gap', info: "DraftKings customers' money share against their bets share on one side, in points." }],
  },
  'odds-first-mover': {
    id: 'odds-first-mover', title: 'Pinnacle moved first', promo: 'Pinnacle led a move the market followed',
    factors: [
      { key: 'followers', label: 'Followed', info: 'Books that moved the same way after Pinnacle.' },
      { key: 'lead_min', label: 'Lead', info: 'Minutes Pinnacle moved before the first book followed.' },
    ],
  },
  'nfl-targets-vs-weak-pass-d': {
    id: 'nfl-targets-vs-weak-pass-d',
    title: 'Targets vs weak pass defences',
    promo: "Receivers against the day's softest secondaries",
    factors: [
      { key: 'targets_pg', label: 'Tgt/G', info: 'Targets per game, last two seasons (nflverse play-by-play).' },
      { key: 'target_share', label: 'Target share', info: "Share of the team's targets in the games the player played." },
      { key: 'opp_pass_allowed', label: 'Opp completions/G', info: "Completions the opponent's defence allows per game." },
    ],
  },
  'nfl-rushers-vs-weak-run-d': {
    id: 'nfl-rushers-vs-weak-run-d',
    title: 'Rushers vs the worst run defences',
    promo: "Backs against the day's softest run defences",
    factors: [
      { key: 'carries_pg', label: 'Carries/G', info: 'Rushing attempts per game, last two seasons.' },
      { key: 'yds_per_carry', label: 'Yds/carry', info: 'Yards per carry, last two seasons.' },
      { key: 'opp_rush_allowed', label: 'Opp rush yds/G', info: "Rushing yards the opponent's defence allows to backs per game." },
    ],
  },
  'nfl-role-changes': {
    id: 'nfl-role-changes', title: 'Role changes', promo: 'Used well above their season rate lately',
    factors: [{ key: 'role_up', label: 'Role up', info: 'Last-three usage over the season rate: touches (football), TOI (hockey), shots (soccer) or plate appearances (baseball).' }],
  },
  'nfl-back-in-lineup': {
    id: 'nfl-back-in-lineup', title: 'Back in the lineup', promo: "On yesterday's injury report, not today's",
    factors: [{ key: 'missed_days', label: 'Missed days', info: "Days on the injury report before today's return." }],
  },
  'nfl-teammate-out': {
    id: 'nfl-teammate-out', title: 'Teammate out, usage up', promo: "Who absorbs a starter's share",
    factors: [{ key: 'share_of_team', label: 'Team share', info: "Share of the team's production, with a teammate ruled out today." }],
  },
  'nfl-rest-travel': {
    id: 'nfl-rest-travel', title: 'Rest and travel', promo: 'Games on a short week',
    factors: [{ key: 'short_rest', label: 'Short rest', info: "The shorter side's days of rest in this matchup." }],
  },
  'nfl-revenge': {
    id: 'nfl-revenge', title: 'Revenge games', promo: 'Facing a team they used to play for',
    factors: [{ key: 'games_for_opp', label: 'Games for opp', info: 'Games the player played for the opponent earlier in their career.' }],
  },
  'nfl-milestones': {
    id: 'nfl-milestones', title: 'Milestone watch', promo: 'Within a game of a round number',
    factors: [{ key: 'gap', label: 'To milestone', info: "How far short of a round number, within one game's worth." }],
  },
  'cfb-rushers-vs-weak-run-d': {
    id: 'cfb-rushers-vs-weak-run-d', title: 'Rushers vs the worst run defences',
    promo: "Backs against the day's softest run defences",
    factors: [
      { key: 'carries_pg', label: 'Carries/G', info: 'Rushing attempts per game, last two seasons.' },
      { key: 'yds_per_carry', label: 'Yds/carry', info: 'Yards per carry, last two seasons.' },
      { key: 'opp_rush_allowed', label: 'Opp rush yds/G', info: "Rushing yards the opponent's defence allows to backs per game." },
    ],
    notHeld: 'CFB holds no position-group split, so the opponent factor is team-wide.',
  },
  'cfb-role-changes': {
    id: 'cfb-role-changes', title: 'Role changes', promo: 'Used well above their season rate lately',
    factors: [{ key: 'role_up', label: 'Role up', info: 'Last-three usage over the season rate: touches (football), TOI (hockey), shots (soccer) or plate appearances (baseball).' }],
  },
  'cfb-back-in-lineup': {
    id: 'cfb-back-in-lineup', title: 'Back in the lineup', promo: "On yesterday's injury report, not today's",
    factors: [{ key: 'missed_days', label: 'Missed days', info: "Days on the injury report before today's return." }],
  },
  'cfb-revenge': {
    id: 'cfb-revenge', title: 'Revenge games', promo: 'Facing a team they used to play for',
    factors: [{ key: 'games_for_opp', label: 'Games for opp', info: 'Games the player played for the opponent earlier in their career.' }],
  },
  'cfb-milestones': {
    id: 'cfb-milestones', title: 'Milestone watch', promo: 'Within a game of a round number',
    factors: [{ key: 'gap', label: 'To milestone', info: "How far short of a round number, within one game's worth." }],
  },
  'nhl-shot-volume': {
    id: 'nhl-shot-volume', title: 'Shot volume vs the most shots allowed',
    promo: "Shooters against the day's leakiest defences",
    factors: [
      { key: 'sog_pg', label: 'Shots/G', info: 'Shots on goal per game, last two seasons.' },
      { key: 'toi', label: 'TOI', info: 'Average time on ice per game, minutes.' },
      { key: 'shots_vs', label: 'Opp shots allowed/G', info: "Shots the opponent's defence allows per game." },
    ],
  },
  'nhl-role-changes': {
    id: 'nhl-role-changes', title: 'Role changes', promo: 'Used well above their season rate lately',
    factors: [{ key: 'role_up', label: 'Role up', info: 'Last-three usage over the season rate: touches (football), TOI (hockey), shots (soccer) or plate appearances (baseball).' }],
  },
  'nhl-back-in-lineup': {
    id: 'nhl-back-in-lineup', title: 'Back in the lineup', promo: "On yesterday's injury report, not today's",
    factors: [{ key: 'missed_days', label: 'Missed days', info: "Days on the injury report before today's return." }],
  },
  'nhl-teammate-out': {
    id: 'nhl-teammate-out', title: 'Teammate out, usage up', promo: "Who absorbs a starter's share",
    factors: [{ key: 'share_of_team', label: 'Team share', info: "Share of the team's production, with a teammate ruled out today." }],
  },
  'nhl-rest-travel': {
    id: 'nhl-rest-travel', title: 'Rest and travel', promo: 'Back-to-backs',
    factors: [{ key: 'short_rest', label: 'Short rest', info: "The shorter side's days of rest in this matchup." }],
  },
  'nhl-revenge': {
    id: 'nhl-revenge', title: 'Revenge games', promo: 'Facing a team they used to play for',
    factors: [{ key: 'games_for_opp', label: 'Games for opp', info: 'Games the player played for the opponent earlier in their career.' }],
  },
  'nhl-milestones': {
    id: 'nhl-milestones', title: 'Milestone watch', promo: 'Within a game of a round number',
    factors: [{ key: 'gap', label: 'To milestone', info: "How far short of a round number, within one game's worth." }],
  },
  'soccer-shot-takers': {
    id: 'soccer-shot-takers', title: 'Shot takers vs weak defences',
    promo: "Shooters against the day's leakiest sides",
    factors: [
      { key: 'shots_pg', label: 'Shots/G', info: 'Shots per appearance, last two seasons.' },
      { key: 'sot_pg', label: 'On target/G', info: 'Shots on target per appearance.' },
      { key: 'opp_shots_allowed', label: 'Opp shots allowed/G', info: 'Shots the opponent concedes per game.' },
    ],
  },
  'soccer-role-changes': {
    id: 'soccer-role-changes', title: 'Role changes', promo: 'Used well above their season rate lately',
    factors: [{ key: 'role_up', label: 'Role up', info: 'Last-three usage over the season rate: touches (football), TOI (hockey), shots (soccer) or plate appearances (baseball).' }],
  },
  'soccer-revenge': {
    id: 'soccer-revenge', title: 'Revenge games', promo: 'Facing a team they used to play for',
    factors: [{ key: 'games_for_opp', label: 'Games for opp', info: 'Games the player played for the opponent earlier in their career.' }],
  },
  'soccer-milestones': {
    id: 'soccer-milestones', title: 'Milestone watch', promo: 'Within a game of a round number',
    factors: [{ key: 'gap', label: 'To milestone', info: "How far short of a round number, within one game's worth." }],
  },
  'mlb-platoon-spots': {
    id: 'mlb-platoon-spots', title: 'Platoon spots', promo: 'Batters facing their good side',
    factors: [
      { key: 'slg_vs_hand', label: 'SLG vs hand', info: "Slugging against the starter's throwing hand (Statcast split)." },
      { key: 'park_factor', label: 'Park', info: 'Park run factor this season: 1.18 = 18% more runs than average.' },
    ],
  },
  'mlb-pitcher-k-spots': {
    id: 'mlb-pitcher-k-spots', title: 'Pitcher K spots', promo: 'Starters against strikeout-prone lineups',
    factors: [
      { key: 'k_per_9', label: 'K/9', info: 'Strikeouts per nine innings this season.' },
      { key: 'opp_k_pct', label: 'Opp K%', info: "Share of the opponent's plate appearances ending in a strikeout." },
    ],
  },
  'mlb-hr-parks': {
    id: 'mlb-hr-parks', title: 'HR-friendly parks today', promo: "The day's best home-run environments",
    factors: [
      { key: 'park_factor', label: 'Park', info: 'Park run factor this season: 1.18 = 18% more runs than average.' },
      { key: 'opp_staff_hr_rate', label: 'Staff HR%', info: 'Share of games the opposing staff has allowed a home run.' },
      { key: 'wind_out', label: 'Wind out', info: 'Wind blowing out toward center at first pitch, mph.' },
    ],
  },
  'mlb-role-changes': {
    id: 'mlb-role-changes', title: 'Role changes', promo: 'Used well above their season rate lately',
    factors: [{ key: 'role_up', label: 'Role up', info: 'Last-three usage over the season rate: touches (football), TOI (hockey), shots (soccer) or plate appearances (baseball).' }],
  },
  'mlb-back-in-lineup': {
    id: 'mlb-back-in-lineup', title: 'Back in the lineup', promo: "On yesterday's injury report, not today's",
    factors: [{ key: 'missed_days', label: 'Missed days', info: "Days on the injury report before today's return." }],
  },
  'mlb-hot-bat-cold-arm': {
    id: 'mlb-hot-bat-cold-arm', title: 'Hot bat vs cold arm', promo: 'A hot batter against a struggling starter',
    factors: [
      { key: 'hot_ops', label: 'Last-10 OPS', info: "On-base plus slugging over the batter's last ten games." },
      { key: 'opp_gs', label: 'Opp Game Score', info: "The opposing starter's average game score over his last three starts." },
    ],
  },
  'mlb-revenge': {
    id: 'mlb-revenge', title: 'Revenge games', promo: 'Facing a team they used to play for',
    factors: [{ key: 'games_for_opp', label: 'Games for opp', info: 'Games the player played for the opponent earlier in their career.' }],
  },
  'mlb-milestones': {
    id: 'mlb-milestones', title: 'Milestone watch', promo: 'Within a game of a round number',
    factors: [{ key: 'gap', label: 'To milestone', info: "How far short of a round number, within one game's worth." }],
  },

  // ---- SP-TEN and SP-GOLF: the two sports that are not team sports ----
  'tennis-form': {
    id: 'tennis-form', title: 'Form', promo: 'Who is winning right now',
    factors: [
      { key: 'win_rate', label: 'Last 10', info: 'Share of the last ten matches won, from the match log.' },
      { key: 'sets_rate', label: 'Set win %', info: 'Share of sets won across those matches.' },
      { key: 'games_rate', label: 'Game win %', info: 'Share of games won across those matches.' },
    ],
  },
  'tennis-serve-return': {
    id: 'tennis-serve-return', title: 'Serve vs return', promo: 'Who serves and returns best',
    factors: [
      { key: 'ace_rate', label: 'Ace %', info: 'Aces as a share of service points played, last two seasons.' },
      { key: 'first_win_pct', label: '1st serve won %', info: 'Points won behind a first serve, as a share of first serves in.' },
      { key: 'bp_saved_pct', label: 'BP saved %', info: 'Break points saved, as a share of break points faced on serve.' },
      { key: 'return_won_pct', label: 'Return pts won %', info: "Share of the opponent's service points won." },
    ],
    notHeld: 'WTA, and ATP since January 2026, come from charted matches only, so their samples are smaller.',
  },
  'tennis-surface-record': {
    id: 'tennis-surface-record', title: 'Surface record', promo: 'Records on the surface of the current swing',
    factors: [
      { key: 'surface_win_pct', label: 'On this surface', info: 'Share of matches won on the surface of the current swing, last two seasons (TML-Database).' },
      { key: 'surface_matches', label: 'Matches', info: 'How many matches that rate is drawn from. A rate needs a sample, so it is a column.' },
      { key: 'surface_hold_pct', label: 'Hold % here', info: 'Share of service games held on this surface.' },
    ],
    notHeld: 'WTA surface records are not held: the match table behind them is ATP-only.',
  },
  'golf-course-history': {
    id: 'golf-course-history', title: 'Course history', promo: 'Who has played this course well before',
    factors: [
      { key: 'best_finish', label: 'Best finish', info: 'Best finishing position at this course, across every event held.' },
      { key: 'avg_finish', label: 'Average finish', info: 'Mean finishing position at this course.' },
      { key: 'rounds_here', label: 'Events', info: 'How many events at this course are held for this player.' },
      { key: 'cuts_made_pct', label: 'Cuts made', info: 'Share of those events where the player made the cut.' },
    ],
    notHeld: 'Only events this app holds results for are counted, which is 2022 onward.',
  },
};

/**
 * Every ranking the Python job declares, of either kind. `readSpecials` and
 * `readFlags` each take their own half; this is what the drift guard compares
 * against `RANKINGS` in `slate_rankings.py`.
 */
export const SPECIAL_RANKINGS: Record<string, SpecialRankingDef> = { ...SPECIAL_ONLY_RANKINGS, ...SPOTLIGHT_RANKINGS };

/** Which kind an id is, from the registry rather than from a comment. */
export function rankingKind(id: string): 'special' | 'spotlight' {
  return id in SPOTLIGHT_RANKINGS ? 'spotlight' : 'special';
}

/** The graded "longest" rankings write the slate's real leader under this id. */
export const LEADER_ID = '__leader__';

function TD_FACTORS(): SpecialFactorDef[] {
  return [
    { key: 'td_per_game', label: 'TD/G', info: 'Rushing + receiving touchdowns per game, last two seasons.' },
    { key: 'team_share', label: 'Team TD share', info: "The player's share of the team's rushing + receiving touchdowns." },
    { key: 'opp_td_allowed', label: 'Opp TD/G', info: 'Touchdowns the opponent allows per game to this position group.' },
    { key: 'implied_points', label: 'Team pts', info: "The team's implied points from today's spread and total." },
  ];
}

/* -------------------------------------------------------------------------- */

export interface SpecialRow {
  rank: number;
  subjectId: string;
  subjectName: string;
  team: string | null;
  opponent: string | null;
  gameId: string | null;
  /** 0-100: the mean percentile across the factors that were measured. */
  score: number;
  /** Raw factor values, by key. A factor nobody measured is absent, not zero. */
  values: Record<string, number | null>;
  /** Each factor's percentile within today's pool, 0-100. */
  percentiles: Record<string, number>;
  frozenAt: string | null;
  /** The one-line why, written by Python from the two strongest factors. */
  read: string | null;
  /** The Wind cell's words ("Out 11", "Roof — may close"), MLB only. */
  windLabel: string | null;
  teamId: string | null;
  opponentId: string | null;
}

export interface ReceiptRow {
  rank: number;
  /** C5: the receipts table draws a face and a team mark, like every other row. */
  subjectId: string;
  subjectName: string;
  team: string | null;
  teamId: string | null;
  opponent: string | null;
  opponentId: string | null;
  /** null when the player did not play: that is neither a hit nor a miss. */
  hit: boolean | null;
  value: number | null;
  /** The stat line ("22 car · 118 yds · 1 TD", "Did not play"). */
  detail: string | null;
}

/** One graded slate's count, for the "last 7 slates" bars. */
export interface ReceiptSlate {
  date: string;
  hits: number;
  /** Players who actually played. A did-not-play is in neither number. */
  played: number;
}

/** A "longest" ranking's real leader on the graded slate, ranked by us or not. */
export interface ReceiptLeader {
  name: string;
  value: number;
  /** Our rank for the leader, or null when we did not rank them. */
  ourRank: number | null;
}

export interface SpecialRanking {
  def: SpecialRankingDef;
  slateDate: string;
  frozen: boolean;
  rows: SpecialRow[];
  receipts: {
    /** The most recent graded slate before this one, if there is one. */
    date: string | null;
    top5: ReceiptRow[];
    /** Across the last seven graded slates: top-5 players who did it, of those who played. */
    week: { hits: number; played: number; slates: number };
    /**
     * C5: the same seven slates, one entry each, newest first — the card draws
     * a bar per slate rather than one running total, because "9 of 31" hides
     * whether that was one good day or seven ordinary ones.
     */
    slates: ReceiptSlate[];
    leader: ReceiptLeader | null;
  };
}

export interface SpecialsData {
  sport: string;
  date: string;
  rankings: SpecialRanking[];
  fetchedAt: string;
}

/** `slate_rankings.sport` is granular for soccer, generic for everyone else. */
export function rankingSport(sport: string, league: string | null): string {
  if (sport === 'soccer') return `soccer_${league ?? 'epl'}`;
  return sport;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);

export async function readSpecials(sport: string, date: string): Promise<SpecialRanking[]> {
  const rows = await pgAll<Record<string, unknown>>(
    `SELECT ranking_id, slate_date::text AS slate_date, subject_id, rank, score, subject_name, team, opponent, game_id,
            factors, frozen_at, team_id, opponent_id
     FROM slate_rankings
     WHERE sport = ? AND slate_date = ?::date AND subject_id <> '${LEADER_ID}' AND kind = 'special'
     ORDER BY ranking_id, rank`,
    [sport, date],
  );

  // Receipts: every GRADED row in the week before this slate. The ranking job
  // grades the frozen top five the next morning into `outcome`.
  const graded = await pgAll<Record<string, unknown>>(
    `SELECT ranking_id, slate_date::text AS slate_date, rank, subject_id, subject_name, team, team_id,
            opponent, opponent_id, outcome
     FROM slate_rankings
     WHERE sport = ? AND slate_date < ?::date AND slate_date >= ?::date - 7
       AND rank <= 5 AND outcome IS NOT NULL
     ORDER BY slate_date DESC, ranking_id, rank`,
    [sport, date, date],
  );

  const byRanking = new Map<string, SpecialRow[]>();
  const frozenBy = new Map<string, boolean>();
  for (const r of rows) {
    const id = String(r.ranking_id);
    const factors = (r.factors ?? {}) as Record<string, unknown>;
    const { percentiles, _read, _wind_label, ...rest } = factors as {
      percentiles?: Record<string, number>;
      _read?: unknown;
      _wind_label?: unknown;
    } & Record<string, unknown>;
    const values: Record<string, number | null> = {};
    // `_`-prefixed keys are words for the card, never a factor value.
    for (const [k, v] of Object.entries(rest)) if (!k.startsWith('_')) values[k] = num(v);
    const list = byRanking.get(id) ?? [];
    list.push({
      rank: Number(r.rank),
      subjectId: String(r.subject_id),
      subjectName: String(r.subject_name ?? r.subject_id),
      team: r.team == null ? null : String(r.team),
      opponent: r.opponent == null ? null : String(r.opponent),
      gameId: r.game_id == null ? null : String(r.game_id),
      score: Number(r.score),
      values,
      percentiles: (percentiles ?? {}) as Record<string, number>,
      frozenAt: r.frozen_at == null ? null : new Date(String(r.frozen_at)).toISOString(),
      read: typeof _read === 'string' ? _read : null,
      windLabel: typeof _wind_label === 'string' ? _wind_label : null,
      teamId: r.team_id == null ? null : String(r.team_id),
      opponentId: r.opponent_id == null ? null : String(r.opponent_id),
    });
    byRanking.set(id, list);
    if (r.frozen_at != null) frozenBy.set(id, true);
  }

  const receiptsBy = new Map<string, Array<Record<string, unknown>>>();
  for (const g of graded) {
    const id = String(g.ranking_id);
    receiptsBy.set(id, [...(receiptsBy.get(id) ?? []), g]);
  }

  const out: SpecialRanking[] = [];
  for (const [id, list] of byRanking) {
    const def = SPECIAL_RANKINGS[id];
    // A ranking this app has no words for is not drawn: an unlabelled factor
    // column is exactly the assertion without a source the spec forbids.
    if (!def) continue;
    const all = receiptsBy.get(id) ?? [];
    const g = all.filter((x) => String(x.subject_id) !== LEADER_ID);
    // The latest graded slate, counting the leader row. Measured 2026-09-22:
    // `nfl-longest-reception` for 09-21 has a leader row and NO graded player
    // rows (the grader skips a row whose team's game has not landed in
    // `player_game_history` yet), and reading `latest` from player rows alone
    // threw away a real measurement of what happened.
    const latest = all[0]?.slate_date ? String(all[0].slate_date) : null;
    const parse = (o: unknown) =>
      (typeof o === 'string' ? JSON.parse(o) : (o ?? {})) as { played?: boolean; hit?: boolean; value?: number; detail?: string };
    const leaderRow = all.find((x) => String(x.subject_id) === LEADER_ID && String(x.slate_date) === latest);
    const lo = leaderRow ? (parse(leaderRow.outcome) as { leaderName?: string; value?: number; ourRank?: number | null }) : null;
    const leader: ReceiptLeader | null =
      lo && typeof lo.value === 'number' ? { name: String(lo.leaderName ?? ''), value: lo.value, ourRank: typeof lo.ourRank === 'number' ? lo.ourRank : null } : null;
    const top5 = g
      .filter((x) => String(x.slate_date) === latest)
      .map((x) => {
        const o = parse(x.outcome);
        return {
          rank: Number(x.rank),
          subjectId: String(x.subject_id),
          subjectName: String(x.subject_name ?? ''),
          team: x.team == null ? null : String(x.team),
          teamId: x.team_id == null ? null : String(x.team_id),
          opponent: x.opponent == null ? null : String(x.opponent),
          opponentId: x.opponent_id == null ? null : String(x.opponent_id),
          hit: o.played === false ? null : Boolean(o.hit),
          value: typeof o.value === 'number' ? o.value : null,
          detail: typeof o.detail === 'string' ? o.detail : null,
        };
      });
    const played = g.map((x) => parse(x.outcome)).filter((o) => o.played !== false);
    // One entry per graded slate, newest first: the bars the card draws.
    const bySlate = new Map<string, ReceiptSlate>();
    for (const x of g) {
      const o = parse(x.outcome);
      if (o.played === false) continue;
      const d = String(x.slate_date);
      const s = bySlate.get(d) ?? { date: d, hits: 0, played: 0 };
      s.played += 1;
      if (o.hit) s.hits += 1;
      bySlate.set(d, s);
    }
    out.push({
      def,
      slateDate: date,
      frozen: frozenBy.get(id) ?? false,
      rows: list,
      receipts: {
        date: latest,
        top5,
        week: { hits: played.filter((o) => o.hit).length, played: played.length, slates: new Set(g.map((x) => String(x.slate_date))).size },
        slates: [...bySlate.values()],
        leader,
      },
    });
  }
  return out;
}
