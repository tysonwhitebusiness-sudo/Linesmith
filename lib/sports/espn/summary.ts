/**
 * ESPN's game summary (`/summary?event=`) — ONE fetch, shared by every parser (R4 step 1).
 *
 * Before R4 eight modules fetched the same document independently (CFB, NBA ×3,
 * NFL ×2, soccer ×2), each keeping a different slice and discarding the rest.
 * R4 parses much more of it — win probability, drives, plays, pickcenter,
 * season series, injuries, rosters, commentary — and doing that through eight
 * separate fetches would multiply requests against a host we do not own. So
 * every summary read goes through here, and parsers take the returned JSON.
 *
 * CACHING, deliberately in-process and short:
 *  - **In-flight dedupe**: a game page runs several parsers at once; they share
 *    one request.
 *  - **Final games: 10 minutes.** The document no longer changes.
 *  - **Everything else: 5 seconds** — enough to collapse one page's burst,
 *    short enough that the live contract (routes that must not serve stale
 *    play-by-play) still holds.
 *  - **Not persisted to `snapshot_cache`.** A summary with play-by-play runs to
 *    hundreds of KB, and that table's growth is already a standing problem
 *    (CURRENT.md, Phase 5). Anything worth keeping for a finished game is kept
 *    PARSED, by the route that serves it, through `cachedRoute()`.
 *
 * Failure returns `null` (network error, timeout, non-2xx, bad JSON) and is never
 * cached, so a transient ESPN error cannot pin a page to nothing for 10 minutes.
 */

const BASE = 'https://site.api.espn.com/apis/site/v2/sports';
const FINAL_TTL_MS = 10 * 60_000;
const OPEN_TTL_MS = 5_000;
const MAX_ENTRIES = 64;
const TIMEOUT_MS = 15_000;

/** `football/nfl`, `football/college-football`, `basketball/nba`, `hockey/nhl`, `soccer/eng.1`, … */
export type EspnLeaguePath = `${'football' | 'basketball' | 'hockey' | 'soccer' | 'baseball'}/${string}`;

interface Entry {
  at: number;
  final: boolean;
  json: unknown;
}

const memo = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown | null>>();

function isFinal(json: unknown): boolean {
  const status = (json as { header?: { competitions?: Array<{ status?: { type?: { completed?: boolean } } }> } })?.header?.competitions?.[0]?.status?.type;
  return status?.completed === true;
}

export async function fetchEspnSummary<T = unknown>(leaguePath: EspnLeaguePath, eventId: string, now: () => number = Date.now): Promise<T | null> {
  const key = `${leaguePath}|${eventId}`;
  const hit = memo.get(key);
  if (hit && now() - hit.at < (hit.final ? FINAL_TTL_MS : OPEN_TTL_MS)) return hit.json as T;

  const pending = inflight.get(key);
  if (pending) return (await pending) as T | null;

  const request = (async () => {
    try {
      const res = await fetch(`${BASE}/${leaguePath}/summary?event=${encodeURIComponent(eventId)}`, { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) return null;
      const json: unknown = await res.json();
      memo.delete(key);
      memo.set(key, { at: now(), final: isFinal(json), json });
      while (memo.size > MAX_ENTRIES) memo.delete(memo.keys().next().value as string);
      return json;
    } catch {
      return null;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, request);
  return (await request) as T | null;
}

/**
 * `fetchEspnSummary` for a page that must tell "no such game" from "ESPN did
 * not answer" (R12d). The plain fetch folds a 404 and a timeout into one
 * `null`, which a game page read as "not found" whenever ESPN was slow (R11-F3;
 * seen on NHL). On a `null` this probes once: ESPN's own 404 is "not found"
 * (measured: a bogus event id is 404 on NBA, NFL and EPL), an answer now is
 * used, and anything else throws, so the route says "couldn't load".
 */
export async function fetchEspnSummaryStrict<T = unknown>(leaguePath: EspnLeaguePath, eventId: string): Promise<T | null> {
  const json = await fetchEspnSummary<T>(leaguePath, eventId);
  if (json != null) return json;
  const probe = await fetch(`${BASE}/${leaguePath}/summary?event=${encodeURIComponent(eventId)}`, { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) }).catch(() => null);
  if (probe?.status === 404) return null;
  if (probe?.ok) return (await probe.json()) as T;
  throw new Error(`ESPN summary unavailable for ${leaguePath} ${eventId}`);
}

/** Test hook: drop every cached summary. */
export function clearEspnSummaryCache(): void {
  memo.clear();
  inflight.clear();
}
