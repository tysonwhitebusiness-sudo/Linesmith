/**
 * The Slate's Spotlights (S3).
 *
 * THE PHASE'S OWN PREMISE WAS WRONG, and the correction is the reason this file
 * reads candidates rather than a table. S3 says "read `slate_rankings` (M3)".
 * Measured 2026-09-20: that table holds four rankings across three sports —
 * `mlb-hr-of-the-day`, `mlb-most-strikeouts`, `nfl-anytime-td` and
 * `soccer-anytime-goalscorer`. Those are the SPECIALS pilot set (S4), not the
 * Spotlights. The two spotlights the spec asks every sport for — Hit-rate
 * leaders and Active streaks — have no rows there at all, and never did.
 *
 * They do not need any. Both are readings of the same candidate history the
 * props board is already holding, through the same `readForm` the table's own
 * L5/L10/Strk columns use. Deriving them here rather than from a second source
 * means a spotlight can never disagree with the table underneath it, which is
 * a stronger guarantee than a nightly job could give.
 *
 * NOTHING HERE IS A PREDICTION. A hit rate is a count of what happened. A
 * streak is a count of what happened in a row. Neither is compared to a price,
 * and neither is a claim about what happens next.
 */

import type { PickCandidate } from '../core/types';
import { readForm } from '../core/pickEngine';
import { isOk } from '../core/windowedStat';

/** One cell on a spotlight row: a number and how it should print. */
export interface SpotlightValue {
  text: string;
  /** 0..1, for the magnitude bar. Omitted where the number has no scale. */
  bar?: number;
}

export interface SpotlightRow {
  key: string;
  subjectId: string;
  subjectName: string;
  /** "Hits · Over 0.5" — what the rate is a rate OF. */
  market: string;
  /** "TB vs BOS" where the sport gives one. */
  context?: string | null;
  values: Record<string, SpotlightValue>;
  /**
   * The one-line "why", in the reader's words. It opens from the row rather
   * than sitting in a column: at half a 1440 screen, beside five factor
   * columns, a wrapping sentence was simply clipped.
   */
  why: string;
  href?: string | null;
}

export interface SpotlightColumn {
  key: string;
  label: string;
  /** Names the SOURCE, per the spec: every factor says where it came from. */
  info: string;
  numeric?: boolean;
}

export interface SpotlightCard {
  id: string;
  title: string;
  /** What the card is scoped to: "Last 10 games". */
  scope: string;
  columns: SpotlightColumn[];
  rows: SpotlightRow[];
  /** Under the table. Says what the numbers are, and what they are not. */
  caption: string;
  /** Shown instead of rows. Always says WHY, never just "nothing". */
  empty?: string;
}

/* -------------------------------------------------------------------------- */

const pct = (rate: number) => `${Math.round(rate * 100)}%`;

function marketOf(c: PickCandidate): string {
  const line = c.line != null ? ` ${c.line}` : '';
  return `${c.dimensionLabel} · ${c.categoryLabel}${line}`;
}

function contextOf(c: PickCandidate): string | null {
  const meta = c.subjectMeta as Record<string, unknown> | undefined;
  const team = typeof meta?.teamAbbrev === 'string' ? meta.teamAbbrev : typeof meta?.team === 'string' ? meta.team : null;
  const opp = typeof meta?.opponent === 'string' ? meta.opponent : typeof meta?.opponentName === 'string' ? meta.opponentName : null;
  if (team && opp) return `${team} vs ${opp}`;
  return team ?? opp ?? null;
}

function hrefOf(c: PickCandidate, sport: string, league?: string | null): string | null {
  if (!c.subjectId) return null;
  if (sport === 'soccer' || sport === 'tennis') return league ? `/${sport}/${league}/player/${c.subjectId}` : null;
  return `/${sport}/player/${c.subjectId}`;
}

export interface SpotlightOptions {
  sport: string;
  league?: string | null;
  /** How many rows a card shows. The spec's range is 5-10. */
  limit?: number;
  /** A rate needs a real window behind it; below this it is not a rate. */
  minSample?: number;
}

/**
 * What a "period" IS, per sport. `readForm` counts periods; for a team sport
 * that is a game, for golf a round and for tennis a match. Golf has 2,489
 * candidates today and no spotlight rows, because a golfer rarely has ten
 * rounds of the same hole held — and an empty state that says "games" would
 * be explaining the wrong thing.
 */
const PERIOD_NOUN: Record<string, { one: string; many: string }> = {
  golf: { one: 'round', many: 'rounds' },
  tennis: { one: 'match', many: 'matches' },
};

function periodNoun(sport: string): string {
  return (PERIOD_NOUN[sport] ?? { many: 'games' }).many;
}

/** Stripping an "s" gives "matche". Sports are not regular nouns. */
function periodNounSingular(sport: string): string {
  return (PERIOD_NOUN[sport] ?? { one: 'game' }).one;
}

/* -------------------------------------------------------------------------- */

/** One row per player. Ranked lists are read as a list of PEOPLE. */
function onePerSubject<T extends { subjectId: string }>(rows: T[], limit: number): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of rows) {
    if (seen.has(r.subjectId)) continue;
    seen.add(r.subjectId);
    out.push(r);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Hit-rate leaders — the best recent over-rate at today's line.
 *
 * WHY A MINIMUM SAMPLE IS THE WHOLE CARD. "100% in 2 of 2" outranks "80% in 8
 * of 10" on rate alone and says far less, so the sample is a column of its own
 * and a candidate under the minimum is not a leader at all.
 *
 * TWO THINGS RUNNING IT ON REAL DATA CHANGED. Three of the first five rows
 * were the same relief pitcher on three of his own markets, so it is one row
 * per player now. And a run of ties at 100% was being broken arbitrarily, so
 * they break on FORM — how far the recent window is above that player's own
 * rate across every game held. A player at 100% who is always at 100% is true
 * and dull; a player at 100% who is usually at 60% is the one worth the row.
 */
export function hitRateLeaders(candidates: PickCandidate[], opts: SpotlightOptions): SpotlightCard {
  const { sport, league, limit = 8, minSample = 8 } = opts;
  const window = 10;
  const seen = new Set<string>();
  const onePerSubjectGuard = (id: string) => (seen.has(id) ? false : (seen.add(id), true));
  const noun = periodNoun(sport);
  const one = periodNounSingular(sport);

  const rows: SpotlightRow[] = candidates
    .map((c) => ({ c, form: readForm(c, { window }) }))
    .filter((r) => isOk(r.form.recent) && r.form.recent.total >= minSample)
    .map((r) => {
      const recent = r.form.recent as Extract<typeof r.form.recent, { status: 'ok' }>;
      const baseline = r.form.baseline;
      return {
        c: r.c,
        recent,
        baselineRate: isOk(baseline) ? baseline.rate : null,
        streak: r.form.streak,
      };
    })
    .sort(
      (a, b) =>
        b.recent.rate - a.recent.rate ||
        (b.recent.rate - (b.baselineRate ?? b.recent.rate)) - (a.recent.rate - (a.baselineRate ?? a.recent.rate)) ||
        b.recent.total - a.recent.total,
    )
    .filter((r) => onePerSubjectGuard(r.c.subjectId))
    .slice(0, limit)
    .map((r) => ({
      key: `${r.c.subjectId}:${r.c.dimension}:${r.c.category}`,
      subjectId: r.c.subjectId,
      subjectName: r.c.subjectName,
      market: marketOf(r.c),
      context: contextOf(r.c),
      values: {
        rate: { text: pct(r.recent.rate), bar: r.recent.rate },
        sample: { text: `${r.recent.hits} of ${r.recent.total}` },
        season: { text: r.baselineRate == null ? '—' : pct(r.baselineRate) },
        streak: { text: r.streak === 0 ? '—' : r.streak > 0 ? `+${r.streak}` : String(r.streak) },
      },
      why:
        r.baselineRate == null
          ? `Cleared this line in ${r.recent.hits} of the last ${r.recent.total} ${noun}.`
          : r.recent.rate > r.baselineRate
            ? `Cleared this line in ${r.recent.hits} of the last ${r.recent.total} — above their own ${pct(r.baselineRate)} across every ${one} held.`
            : `Cleared this line in ${r.recent.hits} of the last ${r.recent.total}, against ${pct(r.baselineRate)} across every ${one} held.`,
      href: hrefOf(r.c, sport, league),
    }));

  return {
    id: 'hit-rate-leaders',
    title: 'Hit-rate leaders',
    scope: `Last ${window} ${noun}`,
    columns: [
      { key: 'rate', label: 'Hit rate', info: `The share of the last ${window} ${noun} in which this player cleared this line. Counted from the logs, not from a model.`, numeric: true },
      { key: 'sample', label: 'Sample', info: `How many of the last ${window} ${noun} are actually held. A rate needs at least ${minSample} of them to appear here at all.` },
      { key: 'season', label: 'All held', info: `The same rate across every ${one} held for this player, so the recent window has something to be compared against.`, numeric: true },
      { key: 'streak', label: 'Streak', info: `Consecutive most recent ${noun}. Positive is a run of clearing the line, negative a run of missing it.`, numeric: true },
    ],
    rows,
    caption: `A count of what happened in the last ${window} ${noun}. It is not a prediction, and it is not compared to a price.`,
    empty: `No player has ${minSample} of their last ${window} ${noun} held for a line on this slate yet.`,
  };
}

/**
 * Active streaks — a run of consecutive games the same way.
 *
 * Both directions, because a run of misses is the same fact as a run of hits
 * and hiding one of them would make the card an argument rather than a count.
 */
export function activeStreaks(candidates: PickCandidate[], opts: SpotlightOptions): SpotlightCard {
  const { sport, league, limit = 8, minSample = 5 } = opts;
  const minStreak = 5;
  const noun = periodNoun(sport);

  const all = candidates
    .map((c) => ({ c, form: readForm(c, { window: 10 }) }))
    .filter((r) => Math.abs(r.form.streak) >= minStreak && r.c.sampleSize >= minSample)
    // A RUN IS ONLY A RUN IF THE THING HAPPENS SOMETIMES. WTA's card came back
    // as eight rows of "Missed this line in each of the last 91 matches" on
    // "To Win a Set · Yes" — which is not a streak, it is the shape of that
    // sport's history: the category never matches, so every period is a miss
    // and the "run" is the whole record. A miss-run needs the player to have
    // cleared the line at least once ever, and a clear-run needs them to have
    // missed it at least once, or the number is a definition rather than form.
    .filter((r) => {
      const base = r.form.baseline;
      if (!isOk(base)) return false;
      return r.form.streak > 0 ? base.rate < 1 : base.rate > 0;
    })
    .sort((a, b) => Math.abs(b.form.streak) - Math.abs(a.form.streak) || b.c.sampleSize - a.c.sampleSize);

  // BOTH DIRECTIONS GET HALF THE CARD. Sorting on magnitude alone filled every
  // row with misses on the real slate — a player who never walks is on a
  // 29-game "streak" of not walking, which is structural rather than a run.
  // Splitting the card keeps it a count of what happened rather than an
  // argument for one side of it.
  const half = Math.ceil(limit / 2);
  const over = onePerSubject(all.filter((r) => r.form.streak > 0).map((r) => ({ ...r, subjectId: r.c.subjectId })), half);
  // Across the whole card, not per half: the same player turned up twice, once
  // for a run of clears and once for a run of misses on a different market.
  // Both were true and the card read as a mistake.
  const taken = new Set(over.map((r) => r.subjectId));
  const under = onePerSubject(
    all.filter((r) => r.form.streak < 0 && !taken.has(r.c.subjectId)).map((r) => ({ ...r, subjectId: r.c.subjectId })),
    limit - over.length,
  );

  const rows: SpotlightRow[] = [...over, ...under]
    .sort((a, b) => Math.abs(b.form.streak) - Math.abs(a.form.streak))
    .map((r) => {
      const isOver = r.form.streak > 0;
      const n = Math.abs(r.form.streak);
      return {
        key: `${r.c.subjectId}:${r.c.dimension}:${r.c.category}`,
        subjectId: r.c.subjectId,
        subjectName: r.c.subjectName,
        market: marketOf(r.c),
        context: contextOf(r.c),
        values: {
          streak: { text: `${isOver ? '+' : '−'}${n}`, bar: Math.min(1, n / 10) },
          direction: { text: isOver ? 'Cleared' : 'Missed' },
          games: { text: String(r.c.sampleSize) },
        },
        why: `${isOver ? 'Cleared' : 'Missed'} this line in each of the last ${n} ${noun}.`,
        href: hrefOf(r.c, sport, league),
      };
    });

  return {
    id: 'active-streaks',
    title: 'Active streaks',
    scope: `${minStreak}+ ${noun} in a row`,
    columns: [
      { key: 'streak', label: 'Run', info: `How many consecutive most recent ${noun} went the same way. Counted from the logs.`, numeric: true },
      { key: 'direction', label: 'Which way', info: 'Whether the run is of clearing the line or of missing it. Both are shown: a run of misses is the same fact as a run of hits.' },
      { key: 'games', label: 'Held', info: `How many ${noun} this player has in the history table at all, so a long run out of a short record is visible as one.`, numeric: true },
    ],
    rows,
    caption: `A count of consecutive ${noun}. A streak is what already happened; it says nothing about the next one.`,
    empty: `Nobody on this slate is on a run of ${minStreak} or more.`,
  };
}

/** Both universal spotlights, in the order the spec lists them. */
export function buildSpotlights(candidates: PickCandidate[], opts: SpotlightOptions): SpotlightCard[] {
  return [hitRateLeaders(candidates, opts), activeStreaks(candidates, opts)];
}
