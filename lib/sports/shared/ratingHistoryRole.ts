/**
 * The rating block from a fetched trajectory — the pure half of Phase 6.14.
 *
 * ONE BUILDER, NOT ONE PER SPORT, for the same reason `conditionsRole.ts` is
 * one builder: an Elo rating is an Elo rating. Six team adapters call this with
 * their own hook result and nothing else differs — no sport supplies a
 * different axis, a different unit or a different caption, because the numbers
 * come from one table with one meaning.
 *
 * Client-safe: no fetching, no database. `teamRatingHistory.ts` is the
 * server-side half that produces the `TeamRatingHistory` this consumes.
 */

import type { TeamRatingHistory, TeamRatingHistoryData } from '@/lib/sports/shared/teamRatingShapes';

export interface RatingHistoryInput {
  /** `useTeamRatingHistory(...)`'s result. Structural, not an import of the hook's type. */
  state?: { history: TeamRatingHistory | null; loading: boolean };
  title?: string;
}

/**
 * `null` when there is no trajectory to draw — including while it is still
 * loading. A skeleton frame under "Rating history" for a sport that will turn
 * out to have none is a promise the data cannot keep, and every sport but MLB
 * has exactly one season of this.
 */
export function toRatingHistoryRole(input: RatingHistoryInput): TeamRatingHistoryData | null {
  const { state, title = 'Rating history' } = input;
  const history = state?.history ?? null;
  if (!history) return null;

  // A rating is a whole number in every league that keeps one; the fractional
  // part is model bookkeeping, not something a reader acts on.
  const now = Math.round(history.current);
  const change = Math.round(history.change);

  return {
    title,
    values: history.values,
    context: history.context,
    xLabels: history.xLabels,
    spanLabel: history.spanLabel,
    caption: [
      // "now" is only true when the drawn season IS the current one. Early in a
      // year the latest season is often a game or two old — saying "now" of a
      // rating that predates it would be a small, confident lie.
      history.isCurrentSeason ? `${now} now` : `${now} at the end of ${history.season}`,
      // SIGNED, ALWAYS. "23 across 2026" reads as a rating, not a move — and
      // the sign is the entire content of this number.
      history.isCurrentSeason
        ? `${change > 0 ? '+' : ''}${change} across ${history.season}`
        : `${change > 0 ? '+' : ''}${change} across the season`,
      `${history.gameCount} rated ${history.gameCount === 1 ? 'game' : 'games'}`,
      // Only worth saying when there is something behind the subject line;
      // for five of six sports there is not, and claiming otherwise would be
      // the fabricated depth the board warned against.
      history.context.length > 0
        ? `${history.context.length} earlier ${history.context.length === 1 ? 'season' : 'seasons'} behind`
        : null,
      // Name the newer season rather than quietly omitting it: a reader looking
      // at an August page needs to know the current campaign has started and is
      // simply too short to plot yet.
      history.newerSeasonGames > 0
        ? `${history.newerSeasonGames} ${history.newerSeasonGames === 1 ? 'game' : 'games'} since, too few to plot`
        : null,
    ]
      .filter(Boolean)
      .join(' · '),
    loading: state?.loading ?? false,
  };
}
