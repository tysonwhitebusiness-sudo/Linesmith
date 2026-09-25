/**
 * How often each source class is polled (odds build P9 §3, plan §8 Revision 4):
 * the LiveDot's yardstick. A card is green while its newest reading is inside
 * twice its source's cadence, amber inside six times, grey beyond
 * (`freshness.liveState`). Pure.
 *
 * The numbers are the scraper's own poll rhythm per class, not a guess per
 * card: direct books and exchanges ~70 s, aggregators ~90 s, DraftKings
 * Network splits ~8 min, Sleeper pick counts ~15 min, Covers hourly.
 */

/**
 * The page's own refresh (§1): the spec's 30 s for player and game, raised to
 * 45 s by its own §4 rule — ten tabs at 30 s measured p95 1.3 s and a pool
 * queue of 4 (the laptop's dev server against the hosted database, after the
 * game page's light refresh); at 45 s, p95 1.08 s and a queue of 2. The
 * Slate stays at its route's 60 s TTL. See P9-live.md → Result.
 */
export const REFRESH_MS = { player: 45_000, game: 45_000, slate: 60_000 } as const;

export type SourceClass = 'direct' | 'aggregator' | 'dk_splits' | 'sleeper_picks' | 'covers';

export const CADENCE_S: Record<SourceClass, number> = {
  direct: 70,
  aggregator: 90,
  dk_splits: 480,
  sleeper_picks: 900,
  covers: 3600,
};

/** Sources that relay other books' prices rather than being the book (or exchange) itself. */
const AGGREGATORS = new Set([
  '4codds', 'actionnetwork', 'comparenbet', 'mbodds', 'oddstrader', 'scoresandodds', 'sao_consensus', 'theoddsgap',
  'vsin', 'steezanomics', 'oddsapiio', 'parlayapi', 'propline', 'sharpapi', 'sportsgameodds', 'oddsportal',
]);

/**
 * The class of a source, from its id as the tables store it (`scraper:pinnacle`,
 * `parlayapi`, `dknetwork`, …). `kind` separates Sleeper's pick counts (a
 * split) from its prices (a direct book).
 */
export function sourceClass(source: string, kind?: string): SourceClass {
  const s = source.replace(/^scraper:/, '');
  if (s === 'dknetwork') return 'dk_splits';
  if (s === 'covers') return 'covers';
  if (s === 'sleeper' && kind === 'pick_counts') return 'sleeper_picks';
  return AGGREGATORS.has(s) ? 'aggregator' : 'direct';
}

export function cadenceFor(source: string, kind?: string): number {
  return CADENCE_S[sourceClass(source, kind)];
}

/** A card showing several sources is as live as its slowest-polled one allows: the largest cadence among them. */
export function cadenceOf(sources: Iterable<string>): number {
  let c = 0;
  for (const s of sources) c = Math.max(c, cadenceFor(s));
  return c || CADENCE_S.direct;
}
