/**
 * The X (matchup-favorability) signal's one real rule, shared across every
 * sport — Phase B of docs/x-signal-remaining-sports-gameplan-2026-08-27.md.
 * Extracted from lib/sports/mlb/adapter.ts's own matchupSplit() (the
 * "against" branch: a defense/opponent that allows the MOST of a stat,
 * bottom third of its own real pool, is the favorable matchup for the
 * subject's over-prop) and lib/sports/nfl/adapter.ts's own
 * matchupFavorableFor(), which this replaces so there's exactly one real
 * implementation of the tercile rule instead of two that could drift.
 *
 * `rank` is always "1 = best defense" (fewest allowed) convention — every
 * real caller's own rank field (nflverse's NflverseTeamStatLine.rank,
 * CfbTeamDefenseAllowed's passingRank/etc., NbaTeamDefenseAllowed's
 * guardRank/etc., NhlTeamDefenseAllowed's forwardRank/etc.,
 * UnderstatTeamDefense.rank) already uses this convention, confirmed by
 * reading each one rather than assumed.
 */
export function favorableFromRank(rank: number, poolSize: number): boolean | null {
  if (rank > (poolSize * 2) / 3) return true; // bottom third — allows the most, favorable for the over
  if (rank <= poolSize / 3) return false; // top third — stingy, unfavorable
  return null; // real middle third — genuinely too average to call either way
}

/**
 * Shared client-side merge shape for CFB/NBA/NHL (Phase B/C/D/E of docs/
 * x-signal-remaining-sports-gameplan-2026-08-27.md) — the same idiom
 * Phase 1's mergeModelData (components/usePickHistoryModelData.ts) uses
 * for pick_history, generalized here since matching a candidate to its
 * real opponent-defense row is genuinely different per sport (CFB: fuzzy
 * name match + per-stat rank; NBA/NHL: abbr match + position-group rank)
 * — `resolve` closes over whichever already-fetched team-defense array
 * and matching logic that sport needs, this function just does the
 * common "apply it, merge into subjectMeta" part once. `resolve`
 * returning `undefined` (not `null`) means "this candidate has nothing
 * to say yet" (e.g. the team-defense fetch hasn't resolved) — the
 * candidate is returned completely unchanged rather than gaining a
 * `matchupFavorable: undefined` key; a real `null` result (data present,
 * genuinely uncallable — an unmapped dimension or a real middle-third
 * rank) does get written, matching every other sport's own convention.
 */
export function mergeMatchupFavorable<C extends { subjectMeta?: Record<string, unknown> }>(
  candidates: C[],
  resolve: (candidate: C) => boolean | null | undefined,
): C[] {
  return candidates.map((c) => {
    const favorable = resolve(c);
    if (favorable === undefined) return c;
    return { ...c, subjectMeta: { ...(c.subjectMeta ?? {}), matchupFavorable: favorable } };
  });
}
