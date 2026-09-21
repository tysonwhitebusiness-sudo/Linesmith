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
 */
export const SPECIAL_RANKINGS: Record<string, SpecialRankingDef> = {
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
  subjectName: string;
  team: string | null;
  opponent: string | null;
  /** null when the player did not play: that is neither a hit nor a miss. */
  hit: boolean | null;
  value: number | null;
  /** The stat line ("22 car · 118 yds · 1 TD", "Did not play"). */
  detail: string | null;
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
     WHERE sport = ? AND slate_date = ?::date AND subject_id <> '${LEADER_ID}'
     ORDER BY ranking_id, rank`,
    [sport, date],
  );

  // Receipts: every GRADED row in the week before this slate. The ranking job
  // grades the frozen top five the next morning into `outcome`.
  const graded = await pgAll<Record<string, unknown>>(
    `SELECT ranking_id, slate_date::text AS slate_date, rank, subject_id, subject_name, team, opponent, outcome
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
    const latest = g[0]?.slate_date ? String(g[0].slate_date) : null;
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
          subjectName: String(x.subject_name ?? ''),
          team: x.team == null ? null : String(x.team),
          opponent: x.opponent == null ? null : String(x.opponent),
          hit: o.played === false ? null : Boolean(o.hit),
          value: typeof o.value === 'number' ? o.value : null,
          detail: typeof o.detail === 'string' ? o.detail : null,
        };
      });
    const played = g.map((x) => parse(x.outcome)).filter((o) => o.played !== false);
    out.push({
      def,
      slateDate: date,
      frozen: frozenBy.get(id) ?? false,
      rows: list,
      receipts: {
        date: latest,
        top5,
        week: { hits: played.filter((o) => o.hit).length, played: played.length, slates: new Set(g.map((x) => String(x.slate_date))).size },
        leader,
      },
    });
  }
  return out;
}
