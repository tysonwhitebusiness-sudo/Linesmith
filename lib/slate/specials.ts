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
    ],
    notHeld: 'Lineup spot and wind direction relative to the park are not held.',
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
};

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
}

export interface ReceiptRow {
  rank: number;
  subjectName: string;
  team: string | null;
  opponent: string | null;
  /** null when the player did not play: that is neither a hit nor a miss. */
  hit: boolean | null;
  value: number | null;
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
            factors, frozen_at
     FROM slate_rankings
     WHERE sport = ? AND slate_date = ?::date
     ORDER BY ranking_id, rank`,
    [sport, date],
  );

  // Receipts: every GRADED row in the week before this slate. The ranking job
  // grades the frozen top five the next morning into `outcome`.
  const graded = await pgAll<Record<string, unknown>>(
    `SELECT ranking_id, slate_date::text AS slate_date, rank, subject_name, team, opponent, outcome
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
    const { percentiles, ...rest } = factors as { percentiles?: Record<string, number> } & Record<string, unknown>;
    const values: Record<string, number | null> = {};
    for (const [k, v] of Object.entries(rest)) values[k] = num(v);
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
    const g = receiptsBy.get(id) ?? [];
    const latest = g[0]?.slate_date ? String(g[0].slate_date) : null;
    const parse = (o: unknown) => (typeof o === 'string' ? JSON.parse(o) : (o ?? {})) as { played?: boolean; hit?: boolean; value?: number };
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
      },
    });
  }
  return out;
}
