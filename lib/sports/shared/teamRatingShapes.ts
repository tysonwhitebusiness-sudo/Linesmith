/**
 * The database-free half of the team rating-history block — Phase 6.14.
 *
 * Split out for the reason `targetMapShapes.ts` and `pitchProfileShapes.ts`
 * are: `teamRatingHistory.ts` value-imports `pgAll` and client-reachable code
 * must not.
 *
 * ===================== THE SPORT KEY IS NOT OPTIONAL =====================
 *
 * `team_elo_history.team_id` IS NOT UNIQUE ACROSS SPORTS. Measured on the live
 * table: **43 team ids are shared by up to four sports, covering 27,591 rows**
 * — id 25 alone carries 241 rows split across CFB, NBA, NFL and NHL, because
 * four different leagues all number their teams from 1.
 *
 * TypeScript's existing readers (`getCurrentElo`, `getLatestEloBeforeSeason`,
 * `getMostRecentEloGame` in `lib/db/client.ts`) filter on `team_id` ALONE.
 * That is currently harmless and only by luck: their only callers are MLB's,
 * and MLB uses MLBAM ids (108–158) which happen not to collide. Python already
 * got this right — `db.py` filters `WHERE sport = $1 AND team_id = $2`, with a
 * comment saying the sport is "Required, not defaulted". Anything reading this
 * table for the other six sport keys must do the same, or it will render one
 * league's rating on another league's page.
 * =========================================================================
 *
 * ==================== THE SPAN IS LABELLED, NOT FAKED ====================
 *
 * Depth here is wildly uneven and that is a fact about the data, not a gap to
 * paper over: MLB has 78,554 rows back to 2010; every other sport has a single
 * season (NFL 736 rows, EPL 780). The design board's instruction was "a shorter
 * x-axis with the real span labelled, not a fabricated backfill", and this is
 * where that is honoured — `spanLabel` says what actually exists.
 *
 * PRIOR SEASONS ARE CONTEXT, NOT THE SUBJECT. The subject line is the most
 * recent season game-by-game; earlier seasons ride behind it as `SeriesChart`'s
 * receded grey `context` series, which is exactly what that prop was built for.
 * A sport with one season simply has no context lines, and the same component
 * renders both without knowing which sport it is looking at.
 *
 * ALIGNMENT IS BY GAME INDEX, NOT DATE. Season over season, game 40 belongs
 * beside game 40; a date axis would stack a 162-game baseball season against a
 * 17-game football one and mean nothing. `SeriesChart` builds its x scale from
 * `values.length` and reuses it for every context line, so all series MUST be
 * the same length — a longer context line would run straight off the frame.
 * Every series is therefore padded to the longest with `NaN`, which `linePath`
 * breaks the line on rather than interpolating across.
 * =========================================================================
 */

import type { SoccerLeague, Sport } from '@/lib/core/types';

/** One rated game. `elo` is the rating AFTER that game. */
export interface TeamRatingRow {
  season: number;
  gameDate: string;
  elo: number;
  gamesPlayed: number;
}

export interface TeamRatingHistory {
  /** The most recent season, game by game. The emphasis line. */
  values: number[];
  /** Earlier seasons, oldest first, each padded to `values.length`. */
  context: number[][];
  /** Parallel to `values`. Empty where the current season has not reached that game. */
  xLabels: string[];
  /** The subject season. */
  season: number;
  /** Every season present, ascending. */
  seasons: number[];
  /** "2010–2026 · 17 seasons" or "2025 only" — the real span, never a rounded claim. */
  spanLabel: string;
  /** Rated games in the subject season. */
  gameCount: number;
  /** The team's rating at the end of the subject season, and its move across it. */
  current: number;
  change: number;
  /**
   * False when a NEWER season exists but is too thin to draw — see the
   * subject-season note below. `newerSeasonGames` is how many games it has.
   */
  isCurrentSeason: boolean;
  newerSeasonGames: number;
}

/**
 * App sport (+ soccer's league) to the `sport` value this table actually
 * stores. Soccer is TWO keys here, matching `LEAGUE_TO_SPORT_KEY` in
 * `lib/sports/soccer/adapter.ts` — the handoff's standing warning that
 * different tables use different sport vocabularies applies directly:
 * `pick_history` says `soccer`, this table says `soccer_epl`.
 */
export function eloSportKey(sport: Sport, league?: SoccerLeague | null): string | null {
  if (sport === 'soccer') return league ? `soccer_${league}` : null;
  if (sport === 'mlb' || sport === 'nfl' || sport === 'cfb' || sport === 'nba' || sport === 'nhl') return sport;
  // Tennis and golf have no team concept — 271,964 tennis rows carry a null
  // team_id by construction. No key, no fetch, no block.
  return null;
}

/** Valid `sport` values for the route to accept. Bounded before reaching a cache key (task 3.5). */
export const ELO_SPORT_KEYS = ['mlb', 'nfl', 'cfb', 'nba', 'nhl', 'soccer_epl', 'soccer_mls'] as const;

function spanLabelFor(seasons: number[]): string {
  if (seasons.length === 0) return 'No rated games';
  if (seasons.length === 1) return `${seasons[0]} only`;
  return `${seasons[0]}–${seasons[seasons.length - 1]} · ${seasons.length} seasons`;
}

/**
 * `null` when there is nothing plottable. Two rated games is the floor —
 * `SeriesChart` itself treats fewer than two finite values as empty, so
 * returning a one-point "history" would render an empty frame under a heading
 * that promises a trajectory.
 */
export function toTeamRatingHistory(rows: readonly TeamRatingRow[]): TeamRatingHistory | null {
  if (rows.length === 0) return null;

  const bySeason = new Map<number, TeamRatingRow[]>();
  for (const row of rows) {
    if (!Number.isFinite(row.elo)) continue;
    const bucket = bySeason.get(row.season);
    if (bucket) bucket.push(row);
    else bySeason.set(row.season, [row]);
  }
  if (bySeason.size === 0) return null;

  const seasons = [...bySeason.keys()].sort((a, b) => a - b);
  for (const season of seasons) {
    // Chronological within a season. `gamesPlayed` is the authority rather than
    // the date: a doubleheader puts two games on one date, and sorting by date
    // alone would leave their order to the query planner.
    bySeason.get(season)!.sort((a, b) => a.gamesPlayed - b.gamesPlayed || a.gameDate.localeCompare(b.gameDate));
  }

  // THE SUBJECT IS THE LATEST SEASON THAT IS ACTUALLY A TRAJECTORY, which is
  // not always the latest season. Measured: on 2026-08-30 every EPL team had
  // exactly ONE game in the 2026 season and a full 38 in 2025. Taking "most
  // recent season" literally rendered no block at all for a team with a
  // complete season of history behind it — and that is the ordinary state of
  // every league for the opening weeks of every year, not an edge case.
  //
  // A newer, thinner season is not silently dropped: `isCurrentSeason` and
  // `newerSeasonGames` carry it so the caption can say which season is drawn.
  const drawableSeasons = seasons.filter((s) => bySeason.get(s)!.length >= 2);
  if (drawableSeasons.length === 0) return null;
  const subjectSeason = drawableSeasons[drawableSeasons.length - 1];
  const subjectRows = bySeason.get(subjectSeason)!;
  const newerSeasons = seasons.filter((s) => s > subjectSeason);

  // Every series shares one length — see this file's alignment note. Only the
  // seasons actually drawn count towards it; a newer one-game season must not
  // stretch the axis it is not on.
  const drawn = seasons.filter((s) => s <= subjectSeason);
  const width = Math.max(...drawn.map((s) => bySeason.get(s)!.length));
  const pad = (series: TeamRatingRow[]): number[] => {
    const out = new Array<number>(width).fill(NaN);
    series.forEach((r, i) => {
      out[i] = r.elo;
    });
    return out;
  };

  const values = pad(subjectRows);
  const xLabels = new Array<string>(width).fill('');
  subjectRows.forEach((r, i) => {
    xLabels[i] = `Game ${r.gamesPlayed}`;
  });

  const first = subjectRows[0].elo;
  const last = subjectRows[subjectRows.length - 1].elo;

  return {
    values,
    context: drawn.slice(0, -1).map((s) => pad(bySeason.get(s)!)),
    xLabels,
    season: subjectSeason,
    seasons: drawn,
    spanLabel: spanLabelFor(drawn),
    gameCount: subjectRows.length,
    current: last,
    // The move ACROSS the subject season, not against a 1500 baseline: a team
    // that started the year at 1580 and sits at 1560 is down, even though it is
    // still well above average.
    change: last - first,
    isCurrentSeason: newerSeasons.length === 0,
    newerSeasonGames: newerSeasons.reduce((n, s) => n + bySeason.get(s)!.length, 0),
  };
}

/**
 * The rating block as the component consumes it — Phase 6.14's role shape.
 *
 * Pre-shaped rather than passing `TeamRatingHistory` straight through: the
 * adapter owns the labelling and the formatting, the component owns the frame.
 * Same division as `SpatialGridRole`, and for the same reason — a
 * component-side default is what made one page print `.717` and `0.796` for
 * the same statistic.
 */
export interface TeamRatingHistoryData {
  title: string;
  values: number[];
  context: number[][];
  xLabels: string[];
  /** "2010-2026 · 17 seasons" — the real span, stated rather than implied by the axis. */
  spanLabel: string;
  /** "1587 now · +23 across 2026 · 141 games". */
  caption: string;
  loading: boolean;
}
