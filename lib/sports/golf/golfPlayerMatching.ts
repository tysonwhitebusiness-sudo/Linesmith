/**
 * Golfer identity resolution — canonical ID is ESPN's athlete id, the same id
 * every `PickCandidate.subjectId` for golf already uses (see espn.ts /
 * adapter.ts). Every other golf data source (SharpAPI's odds rows, PGA
 * Tour's own stats pages, a future screenshot import) speaks names, not ids,
 * so this is the one place that resolves a raw name into that canonical id —
 * mirrors `lib/odds/props/entityResolution.ts`'s MLB roster matching, but
 * golf has no team to scope a last-name fallback against: it's one flat
 * field, not two rosters.
 */

import type { SubjectSummary } from '../../core/types';

export interface GolfRosterEntry {
  espnId: string;
  name: string;
}

export interface GolfRosterIndex {
  byFullName: Map<string, GolfRosterEntry>;
  byLastName: Map<string, GolfRosterEntry[]>;
}

/** Strips accents, punctuation, suffixes and casing so name variants compare equal. */
function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // combining diacritics
    .replace(/\b(jr|sr|ii|iii|iv)\b\.?/gi, '')
    .replace(/[^a-zA-Z\s]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function lastNameOf(normalized: string): string {
  const parts = normalized.split(' ').filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

/** Build the match index from the live field — `SportSnapshot.subjects`, refreshed every scan cycle. */
export function buildGolfRosterIndex(subjects: SubjectSummary[]): GolfRosterIndex {
  const byFullName = new Map<string, GolfRosterEntry>();
  const byLastName = new Map<string, GolfRosterEntry[]>();

  for (const s of subjects) {
    const entry: GolfRosterEntry = { espnId: s.subjectId, name: s.subjectName };
    const normalized = normalizeName(s.subjectName);
    if (!normalized) continue;
    byFullName.set(normalized, entry);

    const last = lastNameOf(normalized);
    const bucket = byLastName.get(last);
    if (bucket) bucket.push(entry);
    else byLastName.set(last, [entry]);
  }

  return { byFullName, byLastName };
}

/**
 * Resolve a raw golfer name (from SharpAPI, PGA Tour's stats pages, or
 * anywhere else) to the ESPN athlete id the rest of the app already keys on.
 *
 * Exact normalized match first. Falls back to last-name-only when unique in
 * the current field (a provider abbreviating a first name, e.g. "M. Fitzpatrick"
 * vs "Matt Fitzpatrick") — unlike MLB's team-scoped fallback, there's no
 * second grouping to disambiguate against, so this only fires when exactly
 * one golfer in today's field shares that last name. Returns `null` (never a
 * guess) otherwise.
 */
export function resolveGolfer(rawName: string, index: GolfRosterIndex): GolfRosterEntry | null {
  const normalized = normalizeName(rawName);
  if (!normalized) return null;

  const exact = index.byFullName.get(normalized);
  if (exact) return exact;

  const last = lastNameOf(normalized);
  const candidates = index.byLastName.get(last);
  if (candidates && candidates.length === 1) return candidates[0];

  return null;
}

export interface UnresolvedGolfer {
  rawValue: string;
  context?: string;
}

export function unresolvedGolfer(rawValue: string, context?: string): UnresolvedGolfer {
  return { rawValue, context };
}
