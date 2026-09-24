import type { PickCandidate } from '@/lib/core/types';
import type { UnifiedGameLine } from '@/lib/odds/types';
import type { TodaysLineData } from '@/lib/sports/mlb/adapters/playerDetailAdapter';

/**
 * The player's game's line, from the same game_odds_book_lines read the game
 * page and the Slate use (/api/odds/lines). Sport-agnostic: every sport's
 * UnifiedGameLine.eventId is that sport's game id, the same id a candidate
 * carries as subjectMeta.gamePk. No model fields: the edges are MLB's model
 * and stay on model.todaysLine.
 *
 * P1 (odds workstream, 2026-09-24): every non-MLB player page said "No game
 * line yet" while its game page showed lines, because only MLB's adapter
 * filled model.todaysLine.
 *
 * `source` is the line's own writer (`UnifiedGameLine.source`), the value MLB
 * passes too: OddsChip reads it as provenance, and a table name such as
 * 'game_odds_book_lines' is not one, so every price rendered "Source not
 * recorded" (seen on the first render, 2026-09-24).
 */
export function todaysLineFromGameLines(
  lines: readonly UnifiedGameLine[] | null | undefined,
  gameId: string | undefined,
  playerSide: 'home' | 'away' | null = null,
): TodaysLineData | null {
  if (!gameId || !lines) return null;
  const line = lines.find((l) => l.eventId === gameId);
  if (!line) return null;
  const source = line.source ?? 'unknown';
  const ml = line.moneyline;
  const moneyline =
    ml && ml.home != null && ml.away != null && ml.book
      ? { away: ml.away, home: ml.home, book: ml.book, source }
      : null;
  const t = line.total;
  const total =
    t && t.point != null && t.overPrice != null && t.underPrice != null && t.book
      ? { point: t.point, overPrice: t.overPrice, underPrice: t.underPrice, book: t.book, source }
      : null;
  if (!moneyline && !total) return null;
  return {
    playerSide,
    moneyline,
    total,
    ...(line.liveScore ? { liveScore: line.liveScore } : {}),
    ...(line.livePeriod ? { livePeriod: line.livePeriod } : {}),
  };
}

/** The player's side of the game, from `subjectMeta.isHome`; null when the candidate does not say. */
export function gameSideOf(candidate: PickCandidate | null | undefined): 'home' | 'away' | null {
  const h = (candidate?.subjectMeta as Record<string, unknown> | undefined)?.isHome;
  return h === true ? 'home' : h === false ? 'away' : null;
}

/** A candidate's game id (`subjectMeta.gamePk`) as a string, or undefined. */
export function gamePkOf(candidate: PickCandidate | null | undefined): string | undefined {
  const pk = (candidate?.subjectMeta as Record<string, unknown> | undefined)?.gamePk;
  return typeof pk === 'number' || typeof pk === 'string' ? String(pk) : undefined;
}
