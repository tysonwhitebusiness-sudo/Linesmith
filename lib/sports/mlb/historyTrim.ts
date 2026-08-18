/**
 * Cuts the dominant cost out of /api/mlb's response.
 *
 * Two separate sources of duplication were stacked on top of each other:
 *
 * 1. Each of ~2,760 player-prop candidates carries its subject's full-season
 *    game log (up to ~120 games), and most of that log is a 15-field box
 *    score nobody reads except the player-detail page's gamelog table —
 *    which only ever shows the last 15 rows by default.
 * 2. A player typically appears in ~15-20 candidates (one per stat
 *    dimension — hits, total bases, walks, ...), and `period`/`periodLabel`/
 *    `raw` are IDENTICAL across all of them for the same game: only
 *    `result`/`category` actually differ by dimension. That box score and
 *    date label were being repeated once per dimension for no reason.
 *
 * The fix for both: build ONE shared per-player gamelog (periodLabel + raw,
 * with raw further trimmed the same way as before — full box score on the
 * most recent RECENT_RAW_WINDOW games, opponentId/isHome-only on older ones,
 * since those two fields alone drive head-to-head/venue stats across the
 * *entire* season — see ScanTable.tsx's H2H column and PlayerDetail.tsx's
 * filters), send it once per player instead of once per candidate, and trim
 * every candidate's own history down to just `{period, result, category}`.
 *
 * The client reconstructs the original self-contained shape once, right
 * after fetch (see useSnapshot.ts's `hydrateMlbSnapshot`), by merging each
 * candidate's minimal entries back with the shared gamelog on `period` — so
 * every component that reads `candidate.history` keeps working exactly as
 * it always did; none of them needed to change.
 *
 * The full, untrimmed version is still recoverable on demand beyond the
 * recent window — see app/api/mlb/player-gamelog/route.ts, which reads the
 * untrimmed copy the caller persists before any of this runs.
 */

import type { PickCandidate, HistoryEntry } from '../../core/types';

/** Matches PlayerDetail.tsx's default (untoggled) "last 15 games" view, plus a small buffer. */
const RECENT_RAW_WINDOW = 20;

export interface SharedGamelogEntry {
  periodLabel?: string;
  raw: unknown;
}

/** subjectId -> period -> shared (dimension-independent) fields. */
export type PlayerGamelogs = Record<string, Record<number, SharedGamelogEntry>>;

function trimmedRaw(raw: unknown, keepFull: boolean): unknown {
  if (keepFull) return raw;
  const r = raw as Record<string, unknown> | null | undefined;
  if (!r || typeof r !== 'object') return raw;
  return { opponentId: r.opponentId, isHome: r.isHome };
}

/**
 * One pass over the full candidates array: builds the shared per-player
 * gamelog (first candidate seen per subject wins — raw/periodLabel don't
 * vary by dimension for the same game) and returns candidates reduced to
 * their dimension-specific fields only. Must run on the FULL, untrimmed
 * candidates (i.e. before this module existed) — the caller should persist
 * that untrimmed copy first if app/api/mlb/player-gamelog's recovery path
 * needs it.
 */
export function dedupeHistoryForList(candidates: PickCandidate[]): { candidates: PickCandidate[]; playerGamelogs: PlayerGamelogs } {
  const playerGamelogs: PlayerGamelogs = {};

  const trimmed = candidates.map((c) => {
    if (c.sport !== 'mlb') return c;

    const cutoff = Math.max(0, c.history.length - RECENT_RAW_WINDOW);
    if (!playerGamelogs[c.subjectId]) {
      const shared: Record<number, SharedGamelogEntry> = {};
      c.history.forEach((entry, i) => {
        shared[entry.period] = { periodLabel: entry.periodLabel, raw: trimmedRaw(entry.raw, i >= cutoff) };
      });
      playerGamelogs[c.subjectId] = shared;
    }

    return {
      ...c,
      history: c.history.map((entry): HistoryEntry => ({ period: entry.period, result: entry.result, category: entry.category })),
    };
  });

  return { candidates: trimmed, playerGamelogs };
}
