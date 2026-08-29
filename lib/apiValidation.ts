/**
 * Boundary validation for route parameters that reach a cache key or an
 * upstream URL — task 3.5, findings P4 H3 and P4 L1.
 *
 * WHAT WENT WRONG. Around twenty routes built a `snapshot_cache` key by
 * interpolating an unvalidated query or path parameter. Proven during the
 * audit: `?teamIds=888801,888802` created a permanent cache row and fired real
 * MLB API calls, unauthenticated, roughly a second each. `mlb:injuries` was
 * the worst of them because its key space is every *subset* of every integer,
 * not merely every integer.
 *
 * WHY VALIDATE RATHER THAN ENCODE. `encodeURIComponent` on the way to the
 * upstream URL (P4 L1's suggestion, and correct as far as it goes) stops path
 * traversal but does nothing about the cache row: `../` encoded is still a
 * distinct key, still written, still permanent. Rejecting the value at the
 * boundary fixes both, in one place, and turns a silent 200 into a 400 that
 * says what was wrong. Encoding downstream would also have meant touching
 * dozens of interpolation sites and hoping none was missed.
 *
 * These throw {@link BadRequest}, which route handlers turn into a 400.
 */

/** Thrown for an invalid parameter. Route handlers convert this to a 400. */
export class BadRequest extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BadRequest';
  }
}

/**
 * A numeric entity id — team, player, game.
 *
 * Bounded by digit count rather than by a per-sport allowlist. An allowlist is
 * stricter, but it needs a live fetch of every sport's roster to validate one
 * parameter, which puts an upstream call on the path of a request whose whole
 * problem was causing upstream calls. Nine digits comfortably covers every id
 * space in use (ESPN's are the longest, ~9) while collapsing the key space
 * from unbounded to something a cache can survive.
 *
 * A wrong-but-plausible id still reaches the upstream and still caches a miss.
 * That is a real remaining gap, and the mitigation is task 3.4's rate limit
 * rather than a bigger regex.
 */
export function entityId(raw: string | null | undefined, label = 'id'): string {
  const value = (raw ?? '').trim();
  if (!/^\d{1,9}$/.test(value)) {
    throw new BadRequest(`${label} must be a positive integer of at most 9 digits.`);
  }
  if (value === '0') throw new BadRequest(`${label} must not be zero.`);
  return value;
}

/** {@link entityId}, as a number. */
export function entityIdNum(raw: string | null | undefined, label = 'id'): number {
  return Number(entityId(raw, label));
}

/**
 * A comma-separated id list, deduplicated, sorted, and length-capped.
 *
 * The cap is the point. A key built from an uncapped list has a key space of
 * every subset of every id — combinatorial, not linear — so one caller can mint
 * unbounded permanent cache rows from a small set of valid ids. Sorting and
 * deduplicating also mean `110,142` and `142,110,110` share one row instead of
 * three, which several call sites were already doing by hand.
 */
export function entityIdList(raw: string | null | undefined, maxCount: number, label = 'ids'): string[] {
  const parts = (raw ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) throw new BadRequest(`${label} is required.`);
  if (parts.length > maxCount) {
    throw new BadRequest(`${label} accepts at most ${maxCount} value(s); got ${parts.length}.`);
  }
  const seen = new Set(parts.map((p) => entityId(p, label)));
  return [...seen].sort((a, b) => Number(a) - Number(b));
}

/** A value that must come from a known set — leagues, tours, scopes. */
export function oneOf<T extends string>(raw: string | null | undefined, allowed: readonly T[], label = 'value'): T {
  const value = (raw ?? '').trim();
  if (!(allowed as readonly string[]).includes(value)) {
    throw new BadRequest(`${label} must be one of: ${allowed.join(', ')}.`);
  }
  return value as T;
}

/** A bounded integer, for windows like `?days=30`. */
export function boundedInt(raw: string | null | undefined, min: number, max: number, fallback: number, label = 'value'): number {
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new BadRequest(`${label} must be an integer between ${min} and ${max}.`);
  }
  return n;
}

/** A four-digit season/year, bounded to values this app could hold data for. */
export function seasonYear(raw: string | null | undefined, fallback: number, label = 'season'): number {
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 2000 || n > 2100) {
    throw new BadRequest(`${label} must be a year between 2000 and 2100.`);
  }
  return n;
}

/**
 * An id that must exist in a known, finite set — task 3.5's real fix.
 *
 * {@link entityId} bounds the *shape* of an id, which stops traversal and
 * absurd lengths but not a well-formed value that simply is not real:
 * `?teamId=888801` is six digits and passes it, and that is precisely the
 * value the audit used to mint a permanent cache row and fire an upstream
 * call. Only membership in the real set rejects that.
 *
 * Use this wherever the set is finite, static and cheap to hold — MLB's 30
 * team ids, league and tour slugs. Where the set is large or genuinely dynamic
 * (players), `entityId` plus task 3.4's rate limit is the available answer, and
 * that gap is stated rather than papered over.
 */
export function knownId(raw: string | null | undefined, allowed: ReadonlySet<number>, label = 'id'): number {
  const value = entityIdNum(raw, label);
  if (!allowed.has(value)) {
    throw new BadRequest(`${label} ${value} is not a known ${label.replace(/Id$/, '')}.`);
  }
  return value;
}
