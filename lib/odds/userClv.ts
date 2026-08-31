/**
 * Closing Line Value for the USER's own bets — Phase 6.21.
 *
 * ============== THE MODEL SIDE ALREADY EXISTS. THIS IS THE OTHER ONE ==============
 *
 * `/api/diagnostics/clv`, `predict/clv_backtest.py` and the hourly
 * `clvSummaryJob` already report CLV for the MODEL's picks, and
 * `db.get_closing_price` already defines "the close" and documents why it beats
 * a timer-based snapshot. None of that answers the question a bettor asks about
 * their own slip, which is what this does.
 *
 * IT IS IN TYPESCRIPT, NOT PYTHON, AND THAT IS THE OWNERSHIP RULE. `bets` is one
 * of the four user tables `docs/table-ownership.md` keeps in TypeScript — it is
 * request-scoped and session-authenticated. Reading two history tables from here
 * does not move any writer.
 *
 * ============== THE SAME DEFINITION, DELIBERATELY ==============
 *
 * The close is **the last real observed price for that market and side at the
 * same book the bet was placed at, strictly before the game starts** — read from
 * the observation log, never from a periodic snapshot, because a snapshot is
 * "near the close" and CLV is precisely a claim about the close.
 *
 * CLV is a **plain implied-probability difference, close minus entry, at the
 * same book**, matching `clv_backtest.py` verbatim so a user's number and the
 * model's are the same kind of number. Its own header gives the reason and it
 * holds here: comparing one book's two prices over time mostly cancels that
 * book's vig, which does not move much game to game. A fully de-vigged version
 * is a disclosed refinement, not a correction.
 *
 * POSITIVE MEANS THE BETTOR BEAT THE CLOSE — they took a longer price than the
 * market settled on. It is the sign convention the model report already prints.
 *
 * ============== SAME BOOK, OR NOTHING ==============
 *
 * A price at DraftKings compared against a close at Pinnacle measures the gap
 * between two books, not the movement of one. A bet whose own book never priced
 * the close returns `null` and is reported as unmeasured rather than compared
 * against a book the bettor never used. Book names are matched
 * case-insensitively: the same nominal book is written with inconsistent casing
 * by different writers, which `get_closing_price` documents having hit for real.
 */

import { pgAll } from '@/lib/db/pgClient';

/** American odds -> implied probability. `null` for a price that cannot be read. */
export function impliedProbability(americanOdds: number | null | undefined): number | null {
  if (americanOdds == null || !Number.isFinite(americanOdds) || americanOdds === 0) return null;
  return americanOdds > 0 ? 100 / (americanOdds + 100) : -americanOdds / (-americanOdds + 100);
}

export interface ClosingPrice {
  americanOdds: number;
  observedAt: string;
  bookmaker: string;
}

/**
 * The close for a GAME market. TypeScript twin of `db.get_closing_price`, same
 * query and the same ordering tiebreak on `id` for two rows sharing a timestamp.
 */
export async function closingGamePrice(
  eventId: string,
  market: string,
  side: string,
  before: string,
  bookmaker: string,
): Promise<ClosingPrice | null> {
  const rows = await pgAll<{ american_odds: number; observed_at: Date | string; bookmaker: string }>(
    `SELECT american_odds, observed_at, bookmaker
       FROM game_odds_history
      WHERE event_id = ? AND market = ? AND side = ?
        AND LOWER(bookmaker) = LOWER(?) AND observed_at < ?
      ORDER BY observed_at DESC, id DESC
      LIMIT 1`,
    [eventId, market, side, bookmaker, before],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    americanOdds: Number(r.american_odds),
    observedAt: (r.observed_at instanceof Date ? r.observed_at : new Date(r.observed_at)).toISOString(),
    bookmaker: r.bookmaker,
  };
}

/**
 * The close for a PROP. There was no equivalent of this on either side — the
 * model only ever bets game markets, so `get_closing_price` covers game markets
 * only, and a user's slip is mostly props.
 *
 * THE LINE IS PART OF THE KEY, and matched with `IS NOT DISTINCT FROM` rather
 * than `=` so a genuinely line-less market pins to its own rows instead of
 * returning nothing. Same rule `readLineHistory` documents. Without it, a bet
 * on 5.5 would silently close against whatever alternate line the book last
 * quoted.
 */
export async function closingPropPrice(
  gameId: string,
  subjectId: string,
  marketKey: string,
  line: number | null,
  side: string,
  before: string,
  bookmaker: string,
): Promise<ClosingPrice | null> {
  const rows = await pgAll<{ american_odds: number; observed_at: Date | string; bookmaker: string }>(
    `SELECT american_odds, observed_at, bookmaker
       FROM prop_odds_history
      WHERE game_id = ? AND subject_id = ? AND market_key = ? AND side = ?
        AND line IS NOT DISTINCT FROM ?
        AND LOWER(bookmaker) = LOWER(?) AND observed_at < ?
      ORDER BY observed_at DESC, id DESC
      LIMIT 1`,
    [gameId, subjectId, marketKey, side, line, bookmaker, before],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    americanOdds: Number(r.american_odds),
    observedAt: (r.observed_at instanceof Date ? r.observed_at : new Date(r.observed_at)).toISOString(),
    bookmaker: r.bookmaker,
  };
}

/**
 * Best-effort game start time for a set of game ids.
 *
 * COVERAGE IS PARTIAL AND THAT IS REPORTED, NOT PAPERED OVER. Measured
 * 2026-08-31: `game_picks.game_id` resolves a `commence_time` for **116 of the
 * 559 events** in `game_odds_history`, because that table only holds games the
 * model actually priced. `pick_history` carries the same column for props.
 *
 * A bet whose start time cannot be resolved comes back `no-reference-time` and
 * is excluded from the average rather than measured against the wrong instant.
 * Using `submitted_at` as the reference instead would compare a bet against a
 * price from the moment it was placed, which is its own entry price, and would
 * report a CLV near zero for everybody.
 */
export async function resolveGameStartTimes(gameIds: readonly string[]): Promise<Map<string, string>> {
  const ids = [...new Set(gameIds.filter(Boolean))];
  if (ids.length === 0) return new Map();
  const placeholders = ids.map(() => '?').join(', ');
  const rows = await pgAll<{ game_id: string; commence_time: Date | string }>(
    `SELECT game_id, commence_time FROM game_picks
      WHERE game_id IN (${placeholders}) AND commence_time IS NOT NULL
     UNION ALL
     SELECT game_id, commence_time FROM pick_history
      WHERE game_id IN (${placeholders}) AND commence_time IS NOT NULL`,
    [...ids, ...ids],
  );
  const out = new Map<string, string>();
  for (const r of rows) {
    const iso = (r.commence_time instanceof Date ? r.commence_time : new Date(r.commence_time)).toISOString();
    // First writer wins; both tables carry the same instant for a game they
    // both know about, and a disagreement is not worth a tiebreak nobody can
    // adjudicate.
    if (!out.has(r.game_id)) out.set(r.game_id, iso);
  }
  return out;
}

/** Why one bet could not be measured — shown to the reader instead of a zero. */
export type ClvUnmeasured =
  | 'no-bookmaker'
  | 'no-entry-price'
  | 'no-closing-price'
  | 'no-reference-time';

export interface BetClv {
  betId: string;
  entryOdds: number | null;
  closing: ClosingPrice | null;
  /** Close implied minus entry implied. Positive = the bettor beat the close. */
  clvProbPoints: number | null;
  unmeasured: ClvUnmeasured | null;
}

/** The fields of a `bets` row this needs. Structural, so a caller can pass a wider row. */
export interface BetForClv {
  id: string | number;
  sport: string;
  game_id: string | null;
  subject_id: string | null;
  dimension: string | null;
  category: string | null;
  line: number | null;
  american_odds: number | null;
  bookmaker: string | null;
  submitted_at: string | Date | null;
}

/**
 * `before` — the reference instant the close is measured against.
 *
 * NOT `submitted_at`. The close is the last price before the GAME starts, and a
 * bet placed three days early would otherwise be compared against a price from
 * three days early, which is its own entry price and would report a CLV of
 * roughly zero for everyone. The caller supplies the game's start time; a bet
 * whose game start is unknown is reported unmeasured rather than measured
 * against the wrong instant.
 */
export async function computeBetClv(bet: BetForClv, gameStartsAt: string | null): Promise<BetClv> {
  const betId = String(bet.id);
  const entryOdds = bet.american_odds == null ? null : Number(bet.american_odds);

  if (!bet.bookmaker) return { betId, entryOdds, closing: null, clvProbPoints: null, unmeasured: 'no-bookmaker' };
  if (entryOdds == null || !Number.isFinite(entryOdds)) {
    return { betId, entryOdds: null, closing: null, clvProbPoints: null, unmeasured: 'no-entry-price' };
  }
  if (!gameStartsAt) return { betId, entryOdds, closing: null, clvProbPoints: null, unmeasured: 'no-reference-time' };

  const side = bet.category ?? 'over';
  const closing =
    bet.subject_id && bet.game_id && bet.dimension
      ? await closingPropPrice(bet.game_id, bet.subject_id, bet.dimension, bet.line, side, gameStartsAt, bet.bookmaker)
      : bet.game_id && bet.dimension
        ? await closingGamePrice(bet.game_id, bet.dimension, side, gameStartsAt, bet.bookmaker)
        : null;

  if (!closing) return { betId, entryOdds, closing: null, clvProbPoints: null, unmeasured: 'no-closing-price' };

  const entryP = impliedProbability(entryOdds);
  const closeP = impliedProbability(closing.americanOdds);
  if (entryP == null || closeP == null) {
    return { betId, entryOdds, closing, clvProbPoints: null, unmeasured: 'no-closing-price' };
  }

  return { betId, entryOdds, closing, clvProbPoints: closeP - entryP, unmeasured: null };
}

export interface ClvSummary {
  betsConsidered: number;
  betsMeasured: number;
  meanClvProbPoints: number | null;
  medianClvProbPoints: number | null;
  positiveClvRate: number | null;
  /** Why the unmeasured ones were unmeasured, so the page can say rather than imply. */
  unmeasuredReasons: Record<string, number>;
}

/**
 * MEASURED BETS ONLY IN THE AVERAGE. Treating an unmeasured bet as zero CLV
 * pulls the mean toward zero in proportion to how BADLY covered the history is,
 * which reads as "you are exactly average" — the most misleading possible
 * summary of missing data.
 */
export function summariseClv(rows: readonly BetClv[]): ClvSummary {
  const measured = rows.filter((r): r is BetClv & { clvProbPoints: number } => r.clvProbPoints != null);
  const values = measured.map((r) => r.clvProbPoints).sort((a, b) => a - b);
  const reasons: Record<string, number> = {};
  for (const r of rows) if (r.unmeasured) reasons[r.unmeasured] = (reasons[r.unmeasured] ?? 0) + 1;

  return {
    betsConsidered: rows.length,
    betsMeasured: values.length,
    meanClvProbPoints: values.length ? values.reduce((s, v) => s + v, 0) / values.length : null,
    medianClvProbPoints: values.length ? values[Math.floor(values.length / 2)] : null,
    positiveClvRate: values.length ? values.filter((v) => v > 0).length / values.length : null,
    unmeasuredReasons: reasons,
  };
}
