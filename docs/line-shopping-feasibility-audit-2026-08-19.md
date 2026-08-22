# Line-Shopping Feasibility Audit

**Read-only investigation. No code was changed.** Every claim below is cited to file:line; anywhere the code doesn't give a clear answer, that's stated explicitly as unverified rather than guessed.

---

## 1. Player props — current merge/precedence behavior

**Storage keeps every provider's row separately — nothing is discarded at write time.**

`writePropOdds` (`lib/db/client.ts:485-532`) writes to `prop_odds`, whose unique constraint is:
```sql
UNIQUE (provider_id, game_id, subject_id, market_key, line, side, bookmaker)
```
(`supabase/migrations/20260818201108_initial_schema.sql:183`)

`provider_id` is part of the conflict key, so SharpAPI's DraftKings row and Odds-API.io's DraftKings row for the same player/market/line are two distinct rows — the `ON CONFLICT ... DO UPDATE` (`client.ts:515-527`) only overwrites *the same provider's* prior fetch of *the same book*, never a different provider's price. This is a genuine multi-row, one-per-(provider, book) store.

**The read path returns everything, unfiltered.** `readPropOddsForGame`/`readPropOddsForSubject` (`client.ts:583-597`) have no `GROUP BY`, `DISTINCT ON`, aggregate, or window function — they `SELECT ... WHERE game_id = ? ORDER BY subject_id, market_key, bookmaker`, full stop. Every provider × book × side combination comes back.

**The API layer is a pure pass-through.** `app/api/props/lines/route.ts:26-46` does no merging or selection — it returns `{ rows: await readPropOddsForGame(...) }` (or per-subject) verbatim. Same for `app/api/props/scan-player/route.ts:27-28` and `app/api/props/more-books/route.ts:50-59` — the latter's own header comment states the intent directly: *"Merges SportsGameOdds rows alongside whatever Tier 1 already has — never replaces — so 'N books' counts and best-price comparisons see everything fetched"* (`more-books/route.ts:4-6`).

**`entityResolution.ts` never compares across providers.** It's a set of pure, single-value functions (`resolvePlayer`, `resolveMarketKey`, `normalizeBookmaker`, etc., `lib/odds/props/entityResolution.ts:65-273`) called once per provider's own raw rows during that provider's ingestion (`registry.ts:61-90`'s `runProviderFetch` handles exactly one adapter per call). There is no grouping/comparison step across providers anywhere before storage — so a "grouped by prop, all providers" view doesn't pre-exist in the pipeline; it isn't needed to, because storage itself never collapses rows in the first place.

**The one real precedence rule lives client-side, in `liveEdge.ts`, duplicated once.** `bestPrice()` (`lib/odds/props/liveEdge.ts:26-30`) is a `.reduce()` that picks the row with the highest `american_odds` for a side — explicit "highest price wins," not recency- or provider-priority-based:
```ts
export function bestPrice(rows: PropOddsRow[], side: string): PropOddsRow | null {
  const sided = rows.filter((r) => r.side === side);
  if (sided.length === 0) return null;
  return sided.reduce((best, r) => (r.americanOdds > best.americanOdds ? r : best));
}
```
`resolveCandidateEdge()` (`liveEdge.ts:60-107`) applies it as `mine ?? bestPrice(matched, side)` (`:66`) — the user's own configured sportsbook wins if present, otherwise the single highest payout across every provider/book. The identical pattern is duplicated in `components/PropOddsPanel.tsx:78`. This is the **same rule everywhere it's applied** — no code path was found using a different precedence (no SharpAPI-wins rule, no most-recent-fetch rule).

**`data_delay_seconds` is a staleness gate, not a precedence signal.** It's sourced only in `providers/sharpapi.ts:284`, stored as-is, and read downstream in exactly one decision point: `liveEdge.ts:79,86` — `tooStale = delaySeconds > 600`, which skips de-vig/edge computation on a candidate pair, not which provider's price gets shown. Everywhere else it's pure UI passthrough (`components/OddsChip.tsx:95-120`, `PropOddsPanel.tsx:88,144,149`). No use of `meta.tier` was found affecting read-time selection — `tier1Providers()`/`tier2Providers()` (`registry.ts:36-42`) govern fetch scheduling/budget, not display precedence.

**Bottom line: nothing is discarded.** The "losing" providers' prices are sitting in `prop_odds` right now and already reach the API response unfiltered — `bestPrice()` only picks one to *display* in the collapsed surfaces (Scan table/cards, Player Detail's header chip). This is the cheap-fix scenario the audit was checking for.

---

## 2. Game lines — current merge/precedence behavior

**The known asymmetry, confirmed and expanded.** `summariseOddsEvent()` (`lib/odds/oddsApi.ts:80-132`) iterates every book. Moneyline (`h2h`) genuinely compares all books and keeps the max American-odds price per side (`oddsApi.ts:93-104`) — home and away can end up attributed to different books, since each side is maximized independently. Spread/total instead gate on `!line.spread`/`!line.total` (`oddsApi.ts:106-127`) — first book encountered wins, every subsequent book's spread/total data is never even inspected.

**This looks unintentional, not deliberate.** The function's only doc comment (`oddsApi.ts:75-79`) describes generic best-of behavior — *"taking the best available price for each side so the number shown is one a user could actually have got somewhere"* — and says nothing about why spread/total should behave differently. No comment anywhere explains a rationale (e.g., spread point values differing across books making cross-book comparison harder). Read as an unexplained inconsistency, most likely a first-book placeholder that was never extended to match moneyline's logic.

**Unlike props, the raw per-book data for game lines genuinely is discarded — this is the opposite of the props finding.** The order of operations in `getMlbGameLines()` (`oddsApi.ts:138-231`) is: fetch raw `events` (`:201`) → immediately `events.map(summariseOddsEvent)` (`:202`) → persist only the collapsed result via `writeOddsCache` (`:204`). The `odds_cache` table (`supabase/migrations/20260818201108_initial_schema.sql:141-148`) stores one `payload` TEXT blob per cache key — already-collapsed `GameLine[]`, not per-bookmaker rows. The raw `events` array exists only transiently in memory between fetch and map; once collapsed, every non-selected book's spread/total price is gone and unrecoverable. (`game_odds_history`, logged from `gameOddsLog.ts:20-51`, doesn't rescue this either — its per-book detail comes only from a separate OddsHarvester sidecar, not from the-odds-api.com's discarded books.)

**The API route is a pass-through for the underlying issue.** `app/api/odds/game-lines/route.ts:6-19` just returns `getMlbGameLines()`'s result directly. The "unified" route, `app/api/odds/lines/route.ts`, does merge — but merges in a *different* dimension: it overlays OddsHarvester sidecar data on top of the-odds-api's already-collapsed fields via `mergeLines()` (`lib/odds/merge.ts:41-98`, called at `lines/route.ts:379`), seeding from the already-single-book-per-market `GameLine.moneyline`/`.total`/`.spread` (`merge.ts:47-62`). It never re-derives a true best-of for spread/total — the limitation passes through unchanged into what the frontend receives.

**De-vig runs after the collapse, never per-book, for game lines too.** `devigTwoWay` is called at `app/api/odds/lines/route.ts:159` (total) and `:246` (moneyline), both operating on the already-merged/collapsed `line.total`/`line.moneyline` fields — i.e., whatever `summariseOddsEvent` already picked. `oddsApi.ts` itself never imports `devig.ts`.

---

## 3. What actually renders in the UI today

All backend types already carry multi-book arrays — `PropOddsRow[]` (flat, one row per book) for props, `UnifiedGameLine.bookmakers: BookmakerOdds[]` and `GolfOutrightLine.prices: GolfOutrightPrice[]` for game lines and golf. Whether a given surface *shows* that array is a per-component choice, not a data-availability limit. 13 surfaces were found:

| # | Surface | Component | Data shape available | What it renders |
|---|---|---|---|---|
| 1 | Scan table (props) | `ScanTable.tsx:198-204,308` | `CandidateEdgeInfo` (already collapsed via `resolveCandidateEdge`) | one number |
| 2 | Scan cards (props) | `ScanCard.tsx:260-264` | same | one number |
| 3 | Player Detail header chip | `PlayerDetail.tsx:350,1196,1965` | single scalar | one number |
| 4 | Player Detail "today's line" | `PlayerDetail.tsx:1750-1768` | collapsed moneyline/total | one number/side |
| 5 | Player Detail **"All books" panel** | `PlayerDetail.tsx:1525-1558` → `PropOddsPanel.tsx:98-158` | `PropOddsRow[]`, grouped by book | **real per-book list** |
| 6 | Game Detail left rail | `GameDetail.tsx:646-706,692,1972` | `CandidateEdgeInfo` | one number |
| 7 | Game Detail "Add to picks" | `GameDetail.tsx:1578,1631-1658+` | `ProjectedLine` (`.bookmakers` populated but unread) | one number/side |
| 8 | Scan page game-lines toggle | `GameLinesView.tsx:95-191` | `ProjectedLine` (`.bookmakers` populated but unread) | one number/side |
| 9 | `GameLine.tsx` `BookmakerBreakdown` | `GameLine.tsx:128-311` | `BookmakerOdds[]`, real list — **but zero imports anywhere** | not rendered by any page |
| 10 | `PropOddsPanel.tsx`'s `PropSideOdds`/`PropOddsSummary` | `PropOddsPanel.tsx:20-95` | exported but **zero import sites** | not rendered anywhere |
| 11 | "More Books" trigger | `usePropOdds.ts:81-100` (`runMoreBooks`) | — | **no button anywhere calls it** |
| 12 | Golf Match Winner board | `TournamentLinesView.tsx:40-125` | `GolfOutrightLine.prices[]` populated (`golfLines.ts:147`) but only `.bestPrice` is read | one number |
| 13 | Golf player-detail odds | not located | — | unverified — presence/absence not confirmed |

Three findings worth flagging on their own:
- **Only one surface today (#5) actually shows a real line-shopping list**, and it already works off the same `prop_odds` data every other surface has access to.
- **A second, more polished per-book UI for game lines already exists and is fully built** (`GameLine.tsx`'s `BookmakerBreakdown` — colour-ranked, collapsible) but is completely unwired; confirmed independently by `docs/mlb-component-reusability-audit.md:52`, which separately documents it as orphaned.
- **The golf board's own code comment claims "book-compared"** (`TournamentLinesView.tsx:28-33`) but the render logic only reads `.bestPrice`, never the populated `.prices` array — the comment overstates what the component actually does.

---

## 4. Feasibility of showing all books instead of one price

**Props: this is close to a pure frontend change.** The API response (`/api/props/lines`) already returns the full `PropOddsRow[]` array — no schema or response-shape change needed. `PropOddsPanel.tsx:98-158`'s grouping logic (`byBook`, `:116-122`) is the reference implementation and could plausibly be reused or lifted for Game Detail's left rail or a Scan-table drill-down, rather than written fresh.

**Game lines: this requires a real backend change, not just surfacing.** Because `summariseOddsEvent()` collapses before `writeOddsCache` persists, the per-book spread/total data for the-odds-api.com's source is already gone by the time anything downstream runs — there's nothing to surface for those two markets without changing `oddsApi.ts` itself to persist (or at minimum compute and pass through) the full per-book breakdown before or alongside the collapse. Moneyline is closer — the comparison across books already happens, it just isn't retained per-book (only the winning book's price + `book` label survives into `GameLine.moneyline`). Note `UnifiedGameLine.bookmakers[]` and `ProjectedLine.bookmakers` *do* already carry a populated per-book array in the merged/projected shapes used downstream — that data comes from the OddsHarvester sidecar merge (`merge.ts`), not from the-odds-api.com's own books, so it's a separate, already-plumbed data source that two live surfaces (#7, #8) already receive but simply don't render.

**Provider-identity caveat, confirmed relevant.** ParlayAPI and Propline are each registered under two separate `ProviderId`s for independent budget tracking (per the earlier Phase 2 audit: `parlayapi`/`parlayapi_mlb`, `propline`/`propline_2`). Since `provider_id` is part of `prop_odds`'s unique key, a naive "show one row per provider" line-shopping view would display up to two rows for what's really the same underlying vendor/book if both identities are enabled and return the same bookmaker. A real "all books" view should group by `bookmaker` (as `PropOddsPanel.tsx` already does), not by `provider_id`, to avoid this — which the existing reference implementation already gets right by construction.

**Scan table's "best price" already matches the presumed intent — confirmed, not assumed.** `bestPrice()`'s `.reduce()` picks the row with the numerically highest `americanOdds` (`liveEdge.ts:26-30`) — this is the correct "best payout for the user" semantics for American odds and needs no change if the scan table stays single-price by design.

---

## 5. De-vig interaction

**De-vig runs after selection, everywhere it's used — never independently per-book.** For player props, `devigTwoWay` (`lib/odds/devig.ts:12-23`) is called in `liveEdge.ts:87` only after `chosen` has already been picked via `mine ?? bestPrice(...)` (`:66`), paired with the matching opposite-side row from the *same* bookmaker+provider (`:77`). For game lines, the same pattern holds — both call sites (`app/api/odds/lines/route.ts:159,246`) operate on the already-collapsed `line.total`/`line.moneyline` fields.

**Practical implication for a future line-shopping view**: today's de-vig computation can't be reused as-is to show accurate no-vig prices for every book side by side — it was only ever asked to de-vig one pair. Extending it per-book is mechanically simple (`devigTwoWay` is a pure, stateless function of two decimal-odds inputs — it has no dependency on the selection step, it's just never been called in a loop over multiple books). This is a small, additive change wherever it would be needed, not a redesign.

One unverified thread: `lib/odds/props/grading.ts:77` also calls `devigTwoWay` on an already-matched `pair` whose selection logic wasn't traced in this pass — flagged as unverified, likely low-relevance to line-shopping since grading is a backend/history concern, not a live display path.

---

## Recommendation

**Player props are already close to fully supporting line-shopping display — this is a surfacing problem, not a backend problem.** Storage retains every provider's row, the API returns them unfiltered, and a working reference UI (`PropOddsPanel.tsx`'s "All books" panel) already exists and is live on Player Detail. Extending "show all books" to Game Detail's left rail or a Scan-table drill-down is realistically a frontend task: reuse the existing grouping logic, group by `bookmaker` (not `provider_id`, given the ParlayAPI/Propline dual-identity caveat), and — if per-book no-vig prices are wanted — call the existing `devigTwoWay` per pair instead of once. None of this requires touching `entityResolution.ts`, `writePropOdds`, or the `prop_odds` schema.

**Game lines are the opposite case and need a real backend change.** `summariseOddsEvent()` collapses spread/total to the first book *before* anything is persisted — the per-book data for those two markets doesn't exist anywhere downstream to surface, because it was thrown away at collapse time, not filtered at display time. A line-shopping view for spread/total specifically requires changing `oddsApi.ts` to retain (or separately compute) the per-book breakdown before or alongside the existing collapse, and likely a shape change to what `writeOddsCache` persists. Moneyline is a smaller lift — the cross-book comparison already runs, it just needs to retain the losing books' prices rather than discarding them once the max is found.

**What looks deliberately built for single-best-price vs. what's incidental:**
- `liveEdge.ts`'s `bestPrice()` reduce is a deliberate, correct design choice for the compact surfaces (Scan table/cards) that are genuinely space-constrained — no reason to unwind this, it's the right call there and the audit confirms its "highest payout" semantics are already correct.
- The props read/write/API layers show no sign of ever having been built *for* single-price — they're incidentally single-price only because nothing yet reads the multi-row data any differently. This is the cheap, "already there" case the audit was checking for.
- `oddsApi.ts`'s spread/total first-book behavior is the one place that looks like an actual oversight rather than a deliberate constraint (see §2) — worth fixing on its own merits regardless of any line-shopping decision, since it currently means the game-lines de-vig and pick-lock logic downstream (`app/api/odds/lines/route.ts:159,246`) are computed against a not-necessarily-best spread/total price today, independent of any UI question.
- The already-built-but-orphaned `GameLine.tsx` component (finding #9) suggests someone already reached the same conclusion for game lines once and built the UI for it — it just never got wired in and (per §2) the backend behind it would need the collapse-before-persist issue fixed first for it to show real per-book spread/total data rather than only per-book moneyline.
