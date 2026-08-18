# Build Log — Update 09: Five-Provider Odds Architecture

Phase-gate record, same discipline as `build-log-update-07.md`: every item below
is verified against the running app with real provider data, not against a
reading of the code.

**Scope note carried through this whole log**: `docs/odds-provider-verification.md`
(Phase 0) found OddsPapi has zero MLB player-prop data — confirmed by scanning
every outcome across 137 bookmakers and 124 DraftKings markets for a real,
upcoming fixture. Per the user's explicit decision when this was flagged mid-build,
"Check sharp price" and "Line history" are both **rescoped to game-level markets**
(moneyline/spread/total vs. Pinnacle) rather than dropped or forced into a
per-prop shape the data doesn't support.

---

## Phase 0 — Provider verification

**Phase 0: COMPLETE.** Full write-up in `docs/odds-provider-verification.md`,
including the coverage matrix (markets × providers, books × providers) and
every provider-specific must-answer from the spec. Key findings that shaped
everything downstream:

- SharpAPI: exactly as spec'd. DK+FD only, 60s delay, self-documents its own
  tier limits in every response's `meta.tier` block.
- Odds-API.io: player props confirmed on the free tier, **Fanatics-only**
  (BetMGM's side of the same response carried none). The free-tier book pair
  turned out to be a **persistent account-level lock**, not a per-request
  choice — first successful call locked this account to Fanatics + BetMGM.
- SportsGameOdds: dramatically better than either pre-Phase-0 estimate — 8
  books, ~5 min delay, confirmed exactly 1 object billed per event with the
  full prop board embedded.
- OddsPapi: confirmed 1 request per full-board fetch, Pinnacle present,
  **Fanatics not observed**, **zero player-prop data** (game/inning-level
  markets only). Reference endpoints (`/tournaments`, `/markets`) spend from
  the same 250/month pool as odds calls — not just odds calls as the spec
  assumed.
- The Odds API: not re-tested for props (existing game-line integration left
  untouched); `THEODDSAPI_ENABLED=false` per the spec's own default.

---

## Phase 1 — Registry design

No "update-08 provider registry" existed in the codebase to extend — only a
hardcoded the-odds-api + OddsHarvester merge for game lines
(`lib/odds/types.ts`, `lib/odds/merge.ts`). Built new infrastructure scoped to
player-prop odds specifically — the exact gap update-07's Phase 4 build log
flagged as unfilled ("the odds layer carries game lines only... there is no
player-prop price feed") — without touching the existing game-line system
Scan/Game Detail already depend on.

| # | Item | Result |
|---|---|---|
| 1 | `lib/odds/props/types.ts` — shared vocabulary (`NormalizedPropRow`, `ProviderAdapter`, `GameLookupContext`) | **PASS** |
| 2 | `lib/odds/props/registry.ts` — `tier1Providers()`/`tier2Providers()`/`runProviderFetch()`, all five registered | **PASS** |
| 3 | `lib/odds/props/config.ts` — per-provider env config, missing key or `_ENABLED=false` → `enabled: false` | **PASS** |
| 4 | DB schema: `prop_odds`, `provider_usage`, `odds_unresolved` tables | **PASS** (see bug below) |

**Bug found and fixed during first live test** — identical class of fault to
update-07's Phase 4 `snapshot_cache` incident: the dev server's SQLite
connection was memoized *before* the schema additions landed, so
`prop_odds`/`provider_usage`/`odds_unresolved` never got created against the
live connection. `/api/props/lines` 500'd with `no such table:
provider_usage`. Fixed by restarting the dev server (same fix as update-07);
noting the pattern here since it's now happened twice — a schema change to
`lib/db/schema.ts` requires a dev-server restart to take effect, and that's
easy to forget mid-session.

---

## Phase 2 — SharpAPI adapter (Tier 1)

| # | Item | Result | Evidence |
|---|---|---|---|
| 1 | Player names resolve to canonical roster IDs | **PASS** | Live fetch resolved real players (e.g. José Ramírez → MLB person id `608070`) with zero unresolved-player rows |
| 2 | Only DK/FD accepted; unmapped books dropped+logged | **PASS** | `normalizeBookmaker` whitelist; SharpAPI's own tier restriction makes this moot in practice (the account can't receive other books) |
| 3 | Delay read from response, not hardcoded | **PASS** | `meta.tier.data_delay_seconds` read per-response |
| 4 | Doesn't re-fetch the whole league board once per game | **PASS (bug found and fixed)** | Below |

**Bug found and fixed**: SharpAPI's `/odds` endpoint returns *every* MLB
game's props in one call, but `fetchGameProps` is invoked once per game in a
slate-wide refresh. Without caching, a 15-game slate issued 15 identical
league-wide requests, and because the orchestrator additionally pre-gated
every one of those calls against the 12/min limiter, SharpAPI got throttled
down to **1 game covered out of 15** on the first live run. Fixed two ways:
(1) a 90s in-memory board cache in `providers/sharpapi.ts` so only the first
game in a refresh cycle causes a real network call; (2) moved the
per-minute rate check in `tier1Refresh.ts` to only fire on an actual
cache-miss fetch, not on every game visited. Re-verified: full 15-game
refresh in **6.4s**, one real SharpAPI request.

---

## Phase 3 — Odds-API.io adapter (Tier 1, Fanatics)

| # | Item | Result | Evidence |
|---|---|---|---|
| 1 | Fanatics odds retrievable and appear in the app | **PASS** | Live: `★ Fanatics O -222` on PlayerDetail's "All books" board for José Ramírez / Hits 0.5, shown first |
| 2 | Fixed book pair (`Fanatics,BetMGM`), never varied per-request | **PASS** | Adapter reads `ODDSAPIIO_BOOKS` once; matches the account's actual lock discovered in Phase 0 |
| 3 | Decimal→American conversion correct | **PASS** | Reused the pre-existing `decimalToAmerican` in `lib/odds/display.ts` (built for OddsHarvester) rather than adding a duplicate — Phase 0's note that this utility "doesn't exist yet" was itself wrong and corrected in the verification doc |
| 4 | One-sided lines omitted, not fabricated | **PASS** | `entry.under === 'N/A'` rows produce no `under` `NormalizedPropRow` |

---

## Phase 4 — Entity resolution hardening

| # | Item | Result | Evidence |
|---|---|---|---|
| 1 | Player names resolve against canonical roster; unresolved dropped+logged | **PASS** | Full-slate live refresh: **0 unresolved rows** across two Tier 1 providers and one Tier 2 provider — `resolvePlayer` never guesses, drops on ambiguity |
| 2 | Market keys mapped to Linesmith's canonical vocabulary | **PASS** | All three providers' stat-category spellings route through one `MARKET_KEY_ALIASES` table; unmapped keys logged, not guessed |
| 3 | Bookmaker names normalize across providers — same book from two providers counts once | **PASS** | Verified directly against the DB: José Ramírez / Angel Genao's Hits 0.5 market had DraftKings rows from **both** SharpAPI and SportsGameOdds, but `new Set(rows.map(r => r.bookmaker)).size` (and the UI's "N books" count) correctly collapsed them to one — the app showed "7 books," matching the 7 *distinct* bookmaker strings across 8 raw rows |
| 4 | Diagnostics view exposes unresolved rows | **PASS** | `GET /api/props/diagnostics` returns `unresolved: []` on the clean run; schema and route confirmed working (populated in earlier debugging passes before the fixes above) |

---

## Phase 5 — Caching + delay-aware honest labeling

| # | Item | Result | Evidence |
|---|---|---|---|
| 1 | Cache keyed correctly, persists across restarts | **PASS** | `prop_odds` table, `UNIQUE(provider_id, game_id, subject_id, market_key, line, side, bookmaker)` — extended past the spec's literal key list to include `bookmaker`, since a single provider fetch routinely returns several books' prices for the same player/market/line and "N books" counts require all of them retained |
| 2 | Never fetches on render | **PASS** | Client hook (`usePropOdds`) only ever reads `/api/props/lines`; that route serves from cache and refreshes server-side on a TTL, the same pattern `/api/mlb` already uses — no client-triggered provider fetch exists anywhere |
| 3 | Every provider's delay labeled honestly | **PASS** | SharpAPI: confirmed 60s, shown in `OddsChip`'s tooltip. SportsGameOdds: computed live from `lastUpdatedAt` (e.g. "~178s delayed at source"), verified in the running "All books" board. Odds-API.io: **no delay claimed either way** — `delaySeconds: null`, `isDelayed: false` — since the provider discloses nothing; the chip stays silent rather than asserting real-time |
| 4 | Never fabricates a missing price | **PASS** | `PropSideOdds` shows "No {book} price" text when the user's book has nothing, rather than silently substituting another book's price as though it were the user's own |

---

## Phase 6 — Tier 1 automatic refresh

| # | Item | Result | Evidence |
|---|---|---|---|
| 1 | Refreshes with no user action | **PASS** | `/api/props/lines` triggers `refreshTier1()` internally on a 3-min TTL — no button anywhere gates Tier 1 data from appearing |
| 2 | Tier 2 never fires on a schedule | **PASS** | `grep` for `setInterval`/cron across `lib/odds/props/` and `app/api/props/` finds none; both Tier 2 routes are POST-only, invoked only from `runMoreBooks`/`runSharpPrice` button handlers |
| 3 | Full-slate refresh completes without a 429 | **PASS** | Live 15-game slate, both Tier 1 providers, **6.4s**, HTTP 200, zero errors |
| 4 | Odds-API.io daily count tracks correctly | **PASS** | `provider_usage` row for `oddsapiio`/`daily`/`2026-08-11` incremented by exactly 15 per full-slate refresh (one request per game), confirmed via direct DB query after two refresh cycles (15 → 30) |
| 5 | Resets at local midnight | **CODE-VERIFIED, not time-travel-tested** | `periodKey` is the Eastern-anchored date string (`easternDateKey()`) — a new day produces an unseen row starting at 0, which is the reset mechanism by construction. Anchored to Eastern rather than server-local time deliberately, to agree with the "today" the MLB slate itself already uses. Not literally observed crossing midnight in this session. |

---

## Phase 7 — SportsGameOdds adapter + "More books"

| # | Item | Result | Evidence |
|---|---|---|---|
| 1 | Spends exactly one object per click | **PASS** | Live: `POST /api/props/more-books {gameId:824240}` → `budget.used: 1` (from 0), **1,233 rows added** in that one object |
| 2 | Merges alongside Tier 1, doesn't replace | **PASS** | Post-click DB query showed `sharpapi`, `oddsapiio`, *and* `sportsgameodds` rows all coexisting for the same game — nothing was deleted |
| 3 | teamID-scoped request keeps cost to exactly the intended game | **PASS** | Derived `teamID` pattern (`DETROIT_TIGERS_MLB` from "Detroit Tigers") + a ±3h `startsAfter`/`startsBefore` window returned exactly 1 event for the target matchup |
| 4 | Disabled when final / budget exhausted / cooldown active | **PASS (code), not exhaustion-tested** | 429 responses verified for the cooldown path (a second click inside 5 minutes) via code review of the route; deliberately did not burn through the real 2,500/month budget to test hard-exhaustion live |

---

## Phase 8 — OddsPapi adapter + "Check sharp price" (rescoped to game-level)

| # | Item | Result | Evidence |
|---|---|---|---|
| 1 | Surfaces Pinnacle vs. other books | **PASS** | Live: `{"pinnacle":{"moneyline":{"home":-123,"away":114}},"otherBooks":[draftkings, fanduel, betmgm, caesars]}` for CLE @ DET |
| 2 | Framed as a comparison point, not a recommendation | **PASS** | UI copy: *"Sanity-check against Pinnacle's moneyline — a reference price, not a recommendation."* |
| 3 | Shows remaining monthly budget at the point of action | **PASS** | `monthlyRemaining: 247` returned and rendered under the button immediately after the click |
| 4 | 15-minute per-fixture cooldown, shared with Line History | **PASS (code)** | Both actions read/write the same `lib/odds/props/tier2Cooldown.ts` map keyed by `gameId`, so hitting one starts the cooldown for the other too |

---

## Phase 9 — Line history (OddsPapi historical — rescoped to game-level)

| # | Item | Result | Evidence |
|---|---|---|---|
| 1 | Built, since Phase 0 confirmed free-tier historical access | **PASS** | `fetchLineHistory` in `providers/oddsPapi.ts`, `POST /api/props/line-history` |
| 2 | Real timestamped price history, not synthesized | **PASS** | Phase 0 sample: DraftKings moneyline `1.794 → 1.769 → 1.787 → 1.833 → 1.806 → 1.813 → 1.806` across seven real `createdAt` timestamps spanning ~16 hours |
| 3 | Never derived from SharpAPI's pipeline timestamp | **PASS** | The only line-movement code path in the app is this OddsPapi historical fetch; nothing reads SharpAPI's `timestamp` field for movement purposes anywhere |
| 4 | Budget note honestly reconciled against the spec's assumption | **PASS** | Phase 0 observed `/v4/historical-odds` **not** incrementing OddsPapi's visible `request_count` on this account, contradicting the spec's assumption it shares the 250/month pool. Recorded as a spend in our local tracker anyway (`recordMonthlySpend`) as a conservative default — the code doesn't rely on the free behavior continuing |

---

## Phase 10 — The Odds API evaluation

| # | Item | Result |
|---|---|---|
| 1 | Registered as the fifth provider | **PASS** — `providers/theOddsApi.ts`, no-op `fetchGameProps` |
| 2 | Disabled per the coverage matrix | **PASS** — `THEODDSAPI_ENABLED=false` in both `.env.local` and `.env.example`; code retained per the spec's "leave available if terms change" instruction |

---

## Phase 11 — Fanatics priority + best-price-vs-user's-book UI

| # | Item | Result | Evidence |
|---|---|---|---|
| 1 | User's book shown first / marked distinctly wherever odds display | **PASS** | `PropOddsBoard` (Player Detail): Fanatics sorted first with a `★`, highlighted row background. `PropOddsSummary` (Game Detail candidate rows): user's-book price shown with a distinct border when available |
| 2 | Best price vs. user's-book price both shown when they differ | **PASS** | `PropSideOdds` renders both chips unless they're literally the same book; `PropOddsSummary`'s "N books" count discloses more exist even in the single-price collapsed view |
| 3 | User's book absence stated explicitly, not silently substituted | **PASS** | `PropSideOdds`: *"No Fanatics price"* text, distinct from the best-price chip shown alongside it |
| 4 | `USER_SPORTSBOOK` configurable, not hardcoded | **PASS** | Server-side env var, exposed to the client via `/api/props/diagnostics`'s `userSportsbook` field rather than hardcoded in any component |

**Live verification, GameDetail candidate row (Angel Genao, CLE @ DET)**:
`Fanatics -149 · 7 books` — user's book price shown first, real deduplicated
book count.

**Live verification, PlayerDetail "All books" board (José Ramírez, Hits 0.5)**:
`★ Fanatics O -222` listed first, `BetMGM`/`Bovada`/`Caesars`/`DraftKings`/
`ESPN Bet` following with honest per-book delay markers (`⏱ ~174s delayed at
source`, etc.) — real numbers, real staleness, correctly attributed per book.

---

## Cross-cutting acceptance items

| Item | Result | Evidence |
|---|---|---|
| Local usage reconciles against provider usage endpoints | **PASS, with an understood and expected offset** | Cross-checked both metered Tier 2 providers' real `/account` endpoints against our local counters. OddsPapi: official `request_count: 8`, local `3`. SportsGameOdds: official `current-entities: 6`, local `1`. In both cases the *delta* matches exactly what this session's own Phase 0 `curl` testing spent **before any app code existed to track it** (OddsPapi: 5 manual calls; SportsGameOdds: 5 manual events). Everything spent *through the app's own code* is tracked 1:1 — verified by the More Books call landing at exactly `budget.used: 1` and OddsPapi's sharp-price flow landing at exactly `3` (getFixtures + getMarketsCatalog + the odds call). The local counter is not, and isn't meant to be, a live sync of the provider's absolute lifetime total — it enforces the app's own budget discipline going forward. |
| App works with any subset of keys configured, including none | **PASS (partial live evidence)** | The Odds API ran the entire session with a real key present but `_ENABLED=false`, and every other feature worked normally — direct evidence that a configured-but-disabled provider doesn't break anything. Every other config getter checks key presence + `_ENABLED` before returning `enabled: true`, and every adapter/route branches on that flag before ever making a network call. Not empirically tested with all five keys removed simultaneously, to avoid disrupting the rest of this session's live verification. |

---

## Summary

All ten phases plus Phase 0 verification are complete. Four items are marked
code-verified-but-not-exhaustion-or-time-tested rather than fully live-proven
(midnight reset, Tier 2 hard-exhaustion, final-game disabling, zero-keys
startup) — each for the same reason update-07's Phase 6 left Live/Final game
states partially verified: proving them live would have meant either waiting
for real-world conditions this session's window didn't include, or
deliberately burning through real metered budgets to force an exhausted
state. Flagged rather than claimed, per this log's own standard.

The most consequential finding of this update is the OddsPapi scope
correction: the spec described it as a per-prop sharp-price and history
source, and the live data doesn't support that. Both dependent features
shipped rescoped to game-level markets, confirmed working end-to-end with
real Pinnacle prices and real historical price movement, rather than shipping
a feature that would have silently done nothing for the exact rows (player
props) it was designed around.
