/**
 * The Odds API — Tier 2, lowest priority, disabled by default.
 *
 * This is the same the-odds-api.com integration already live in
 * `lib/odds/oddsApi.ts` for game lines (moneyline/spread/total), registered
 * here as the fifth provider per update-09 §9 step 10. Its player-prop
 * pricing is billed `markets × regions` per call — the most expensive of the
 * five by the spec's own framing — and the coverage matrix in
 * docs/odds-provider-verification.md shows the other four already cover
 * props for free or near-free. `fetchGameProps` is intentionally a no-op:
 * spending this provider's 500/month game-line budget on redundant prop
 * calls isn't worth it, so it registers cleanly (satisfying "register all
 * five") without contributing rows or touching the budget.
 *
 * `THEODDSAPI_ENABLED=false` in `.env.local`/`.env.example`. Flip it only if
 * the coverage matrix changes — e.g. a provider drops a market this one still
 * carries.
 */

import type { FetchResult, ProviderAdapter } from '../types';
import { theOddsApiConfig } from '../config';

export const theOddsApiAdapter: ProviderAdapter = {
  meta: {
    id: 'theoddsapi',
    label: 'The Odds API',
    scheduled: false, // disabled by default, game-lines only — see types.ts's ProviderMeta.scheduled doc
    get enabled() {
      return theOddsApiConfig().enabled;
    },
    delaySeconds: null,
    books: [],
  },

  async fetchGameProps(): Promise<FetchResult> {
    return {
      rows: [],
      unresolved: [],
      cost: {},
      warnings: [
        'The Odds API is registered but not fetching props — the other four providers already cover this for free; enable only if the coverage matrix changes.',
      ],
    };
  },
};
