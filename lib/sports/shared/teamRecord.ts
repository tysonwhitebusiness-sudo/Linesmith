/**
 * One implementation of a team's record and its standing phrase, shared by
 * every sport's Team Detail adapter (R1b).
 *
 * Before this, `TeamDetail.tsx` built the whole line itself:
 *
 *     `${wins}-${losses}${divisionRank ? ` · ${divisionRank} in division` : ''}`
 *
 * — which is wrong in four separate ways and was wrong on screen:
 *   - NBA's adapter already put a full phrase in `divisionRank`, so the header
 *     read "4th seed, Eastern Conference **in division**";
 *   - NHL put its conference name there, giving "Eastern in division";
 *   - `ordinal(0)` printed "0th seed" out of season;
 *   - two sports don't have a two-number record at all — soccer draws and NHL
 *     overtime losses were silently folded into losses (F-B8, F-B11).
 *
 * So: the **adapter** owns the standing phrase (it is the only thing that knows
 * whether its sport ranks by division, conference or league table), and the
 * record is carried as data — `draws` and `otLosses` present only where that
 * sport really has them — and formatted here.
 */

/** `1` → "1st". Empty string for a missing, zero or non-finite rank: "0th seed" is not a standing. */
export function ordinal(rank: number | string | null | undefined): string {
  const n = typeof rank === 'string' ? Number(rank) : rank;
  if (n == null || !Number.isFinite(n) || n <= 0) return '';
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n}${suffix}`;
}

export interface TeamRecordCounts {
  wins: number;
  losses: number;
  /** Soccer only — a real third result. Its presence switches the format to W-D-L. */
  draws?: number;
  /** NHL only — a loss that still earns a point. Its presence switches the format to W-L-OTL. */
  otLosses?: number;
}

/**
 * "88-60" · "5-3-2" (soccer W-**D**-L) · "40-25-7" (NHL W-L-**OTL**).
 *
 * Soccer's draws sit in the middle and hockey's overtime losses sit last —
 * that is each sport's own published convention, not a formatting choice.
 * `draws` and `otLosses` are never both present.
 */
export function formatTeamRecord(r: TeamRecordCounts): string {
  if (r.draws != null) return `${r.wins}-${r.draws}-${r.losses}`;
  if (r.otLosses != null) return `${r.wins}-${r.losses}-${r.otLosses}`;
  return `${r.wins}-${r.losses}`;
}

/**
 * "2nd in AL Central". Returns `''` — meaning "render no standing at all" —
 * when the rank is missing, zero or unparseable, or when the sport publishes
 * no group name to put it in.
 *
 * `suffix` carries anything the sport adds after the group, already formatted
 * (soccer's points, for instance). It is dropped along with everything else
 * when there is no real rank.
 */
export function standingPhrase(rank: number | string | null | undefined, groupName: string | null | undefined, suffix?: string): string {
  const ord = ordinal(rank);
  if (!ord) return '';
  const group = groupName?.trim();
  const base = group ? `${ord} in ${group}` : ord;
  return suffix ? `${base} · ${suffix}` : base;
}

/**
 * Whether a record describes any games at all.
 *
 * Measured on a real offseason page: ESPN's NBA standings feed returns
 * `wins: 0, losses: 0` between seasons (its NHL equivalent keeps serving the
 * last completed season's real 55-16-11). So a record can be present and
 * still be nothing — labelling that `0-0` "Last season" states a result that
 * did not happen. Callers use this to show a status instead.
 */
export function hasPlayedGames(r: TeamRecordCounts): boolean {
  return r.wins + r.losses + (r.draws ?? 0) + (r.otLosses ?? 0) > 0;
}
