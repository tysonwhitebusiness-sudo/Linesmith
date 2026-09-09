/**
 * Phase 4.6 — NFL's adapter onto the shared `StatsBoardData`.
 *
 * The interface is declared by NHL (`lib/sports/nhl/adapters/statsBoardAdapter.ts`)
 * because NHL was ported onto this board first; per CLAUDE.md the first sport
 * owns the type and every other sport imports it rather than redeclaring it.
 *
 * TWO THINGS ARE GENUINELY DIFFERENT FOR NFL, and both are measured rather
 * than stylistic.
 *
 * 1. **THE SUBJECT ID IS RE-NAMESPACED HERE.** `prop_model_cache.subject_id`
 *    holds the BARE ESPN athlete id (`4678006`) for every sport, which is what
 *    `player_game_history` keys on and what keeps the cache canonical. Scan's
 *    NFL candidates carry ESPN's namespaced form instead, built by
 *    `lib/sports/multiSport/teamSportEspn.ts` as `espn:${espnSport}:${id}` —
 *    and NFL's `espnSport` is **football**, not **nfl**, so the real value is
 *    `espn:football:4678006` even though `lib/sports/nfl/adapter.ts` documents
 *    it as `espn:nfl:`.
 *
 *    `useProjections` joins a candidate to its projection on
 *    `subjectId|dimension`, so the two forms must match or every NFL row
 *    silently fails to join — no error, just an empty model column. The prefix
 *    is applied here, in the sport's own adapter, because that is where a
 *    sport-specific id shape belongs.
 *
 * 2. **NO NFL MARKET CARRIES A PROBABILITY, AND NONE MAY UNTIL PHASE 4.5.**
 *    Every NFL calibration is persisted `probability_ok = false`, so the
 *    serving pipe writes `model_prob`, `line` and `league_baseline` NULL on
 *    every row and asserts it. NFL's entire prop archive is one season, dense
 *    only Sept-Nov 2025 — at MLB's cutoff its largest market has 42 held-out
 *    rows — so the gate cannot run until the 2026 season produces them.
 *
 *    Under Phase 2's rule a row with no probability still appears, still shows
 *    a projection, and ranks WITHIN its own market; it simply takes no global
 *    position. `hasProbability` therefore reads false for every NFL market,
 *    which is the correct state rather than a degraded one.
 *
 * WHAT IS DELIBERATELY ABSENT AND MUST STAY ABSENT: edge, market probability,
 * implied probability, prop score, grade, expected value, price. Same rule the
 * NHL header states and `tests/stats-board-no-edge.test.ts` asserts.
 */
import type {
  StatsBoardData,
  StatsBoardMarket,
  StatsBoardRow,
} from '@/lib/sports/nhl/adapters/statsBoardAdapter';

/** The wire shape `/api/nfl/projections` returns, straight off `readNflProjections`. */
export interface NflProjectionApiRow {
  subjectId: string;
  subjectName: string | null;
  teamAbbr: string | null;
  gameId: string;
  dimension: string;
  projection: number | null;
  modelProb: number | null;
  line: number | null;
  projectedToi: number | null;
  sampleSize: number | null;
  leagueBaseline: number | null;
  computedAt: string;
}

/**
 * The five markets Phase 4 fitted, with the unit each projection is measured
 * in. A dimension absent from this map is not rendered — the same gate NHL's
 * adapter applies, so a market that appears in the cache before it has been
 * fitted cannot reach a board by accident.
 *
 * `volumeLabel` is the OPPORTUNITY the rate is per, and it genuinely differs by
 * market: receptions and receiving yards are per target, rushing yards per
 * carry, anytime touchdown per touch (targets + carries, which beat per-game on
 * SELECT in Phase 4.4b). Carries is its own opportunity, which is why its
 * league rate is exactly 1.000 — see `predict/nfl_markets.py`.
 */
const NFL_MARKETS: Record<string, { label: string; unit: string; volumeLabel: string }> = {
  receptions: { label: 'Receptions', unit: 'rec', volumeLabel: 'Targets' },
  'receiving-yards': { label: 'Receiving yards', unit: 'yds', volumeLabel: 'Targets' },
  carries: { label: 'Carries', unit: 'car', volumeLabel: 'Carries' },
  'rushing-yards': { label: 'Rushing yards', unit: 'yds', volumeLabel: 'Carries' },
  'anytime-td': { label: 'Anytime touchdown', unit: 'TD', volumeLabel: 'Touches' },
};

const MARKET_ORDER = [
  'receiving-yards',
  'receptions',
  'rushing-yards',
  'carries',
  'anytime-td',
];

/** ESPN's namespace for NFL athletes. `football`, not `nfl` — see the header. */
const ESPN_NFL_PREFIX = 'espn:football:';

/** The cache's bare id in the form Scan's candidates carry. */
export function toScanSubjectId(bareId: string): string {
  return bareId.includes(':') ? bareId : `${ESPN_NFL_PREFIX}${bareId}`;
}

export function toNflStatsBoardData(
  rows: NflProjectionApiRow[],
  asOf: string | null,
): StatsBoardData {
  const byMarket = new Map<string, StatsBoardRow[]>();

  for (const r of rows) {
    if (!NFL_MARKETS[r.dimension]) continue;
    if (r.projection == null) continue;
    const list = byMarket.get(r.dimension) ?? [];
    list.push({
      subjectId: toScanSubjectId(r.subjectId),
      // NFL carries no name in the cache: `athlete_crosswalk` holds zero NFL
      // rows with a non-null name, so joining for one would drop rows and still
      // render them nameless. Scan takes the name from the CANDIDATE and uses
      // this row only for the model's columns, so the id is a harmless
      // placeholder rather than something a reader ever sees.
      subjectName: r.subjectName ?? r.subjectId,
      teamAbbr: r.teamAbbr,
      gameId: r.gameId,
      projection: r.projection,
      // Null on every NFL row until 4.5 — see the header. Written as the same
      // conditional NHL uses rather than a hardcoded null, so this needs no
      // edit on the day a market earns one.
      probability: r.modelProb,
      line: r.modelProb == null ? null : r.line,
      volume: r.projectedToi,
      sampleSize: r.sampleSize ?? 0,
      leagueBaseline: r.modelProb == null ? null : r.leagueBaseline,
    });
    byMarket.set(r.dimension, list);
  }

  const markets: StatsBoardMarket[] = [];
  for (const key of MARKET_ORDER) {
    const list = byMarket.get(key);
    if (!list || list.length === 0) continue;
    // The board's whole claim is the ordering, so the sort IS the product.
    list.sort((a, b) => b.projection - a.projection);
    markets.push({
      key,
      label: NFL_MARKETS[key].label,
      unit: NFL_MARKETS[key].unit,
      volumeLabel: NFL_MARKETS[key].volumeLabel,
      volumeUnit: '',
      // Every row in a market shares a calibration verdict, so the first row is
      // the market's state rather than a sample. False for all five today.
      hasProbability: list[0].probability != null,
      rows: list,
    });
  }

  return {
    sport: 'nfl',
    sportLabel: 'NFL',
    asOf,
    markets,
    // An empty board is a real state with a real cause, and it says which.
    // NFL's is not an offseason: the slate resolver takes every rostered player
    // on a team with a scheduled game in the next fourteen days, so an empty
    // board means either no games are scheduled or nobody cleared the
    // four-prior-games minimum.
    emptyReason: markets.length === 0
      ? 'No NFL games scheduled, or no player has four prior games yet.'
      : null,
  };
}
