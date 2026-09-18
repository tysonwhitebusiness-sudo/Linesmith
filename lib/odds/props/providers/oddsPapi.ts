/**
 * OddsPapi — Tier 2, sharp reference (Pinnacle) + free historical, GAME-LEVEL ONLY.
 *
 * Verified live in docs/odds-provider-verification.md § 4: scanning every
 * outcome across 137 bookmakers and 124 DraftKings markets for a real,
 * upcoming, odds-available MLB fixture found **zero** rows with a
 * `playerName`, and the market catalog actually returned was exclusively
 * game/inning-level (moneyline, handicap/spread, totals, inning results).
 * The spec framed OddsPapi as a per-prop sharp-price and history source;
 * that isn't what the live data supports, so `fetchGameProps` (the
 * `ProviderAdapter` shape every other provider fills with prop rows) is
 * intentionally a no-op here — it registers cleanly but contributes nothing
 * to the props feed, rather than silently guessing at a mapping that isn't
 * there. The real features — `fetchSharpPrice` and `fetchLineHistory` — are
 * separate exports working against game lines, used directly by the
 * Game Detail "Check sharp price" / "Line history" actions.
 *
 * Two more Phase-0 findings shape this file:
 *  - Reference endpoints (`/tournaments`, `/markets`, `/fixtures`) spend from
 *    the same 250/month budget as odds calls, so the MLB tournament ID (109)
 *    and the market-ID→name map are captured as constants here rather than
 *    re-fetched at runtime.
 *  - `/v4/historical-odds` did **not** increment the visible `request_count`
 *    in Phase 0 testing, contradicting the spec's assumption that it draws
 *    from the same pool. Treated as a bonus, not relied upon — a cooldown is
 *    still applied as a courtesy, and the odds call this feature also makes
 *    (to get current prices alongside history) is still budgeted normally.
 */

import type { FetchResult, ProviderAdapter } from '../types';
import { oddsPapiConfig } from '../config';

export const oddsPapiAdapter: ProviderAdapter = {
  meta: {
    id: 'oddspapi',
    label: 'OddsPapi',
    scheduled: false, // click-only (sharp-price/line-history) — see types.ts's ProviderMeta.scheduled doc
    get enabled() {
      return oddsPapiConfig().enabled;
    },
    delaySeconds: null,
    books: ['pinnacle', 'draftkings', 'fanduel', 'betmgm', 'caesars'],
  },

  async fetchGameProps(): Promise<FetchResult> {
    return {
      rows: [],
      unresolved: [],
      cost: {},
      warnings: [
        'OddsPapi carries no MLB player-prop data (confirmed in Phase 0 verification) — it contributes game-level sharp-price and line-history features only, not props.',
      ],
    };
  },
};
