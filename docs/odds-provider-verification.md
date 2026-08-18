# Odds Provider Verification — Update 09

Phase 0 deliverable. Every finding below is from a **live API call made during this
session** (2026-08-11) against the real MLB slate, using the real keys configured in
`.env.local`. Nothing here is copied from provider documentation without a
corresponding live call confirming it — where docs and live behavior disagreed, live
behavior wins and the doc claim is flagged.

Test fixture used throughout, where a single fixture was needed: **Cleveland
Guardians @ Detroit Tigers**, first pitch 2026-08-11T22:40Z. This is the same game
already used to verify update-07's Game Detail page, which made cross-checking
player names/rosters easy.

---

## Coverage matrix — MLB player-prop markets

Columns are providers actually reachable with props data. OddsPapi and The Odds API
are excluded from this matrix (see their sections — neither returned any player-prop
row for this fixture).

| Market (Linesmith canonical) | SharpAPI | Odds-API.io (Fanatics) | SportsGameOdds |
|---|:---:|:---:|:---:|
| Hits | ✅ | ✅ | ✅ (`batting_hits`) |
| Total Bases | ❌ | ✅ | ✅ (`batting_totalBases`) |
| Home Runs | ✅ | ✅ | ✅ (`batting_homeRuns`) |
| RBIs | ✅ | ✅ | ✅ (`batting_RBI`) |
| Runs | ✅ | ✅ | ❌ not observed |
| Walks (BB) | ❌ | ❌ not observed | ✅ (`batting_basesOnBalls`) |
| Batter Strikeouts | ❌ | ❌ not observed | ✅ (`batting_strikeouts`) |
| Pitcher Strikeouts | ❌ | ❌ not observed | ✅ (`pitching_strikeouts`) |
| Hits + Runs + RBIs | ✅ | ✅ | ✅ (`batting_hits+runs+rbi`) |
| Doubles | ✅ | ❌ not observed | ✅ (`batting_doubles`) |
| Triples | ❌ | ❌ not observed | ✅ (`batting_triples`) |
| Singles | ❌ | ❌ not observed | ✅ (`batting_singles`) |
| Stolen Bases | ❌ | ❌ not observed | ✅ (`batting_stolenBases`) |
| Earned Runs (pitcher) | ✅ | ❌ not observed | ✅ (`pitching_earnedRuns`) |
| Hits Allowed (pitcher) | ❌ | ❌ not observed | ✅ (`pitching_hits`) |
| Pitcher Outs | ❌ | ❌ not observed | ✅ (`pitching_outs`) |
| Pitcher Win | ❌ | ❌ not observed | ✅ (`pitching_win`) |
| First Home Run | ❌ | ❌ not observed | ✅ (`batting_firstHomeRun`) |
| Walks allowed (pitcher) | ❌ | ❌ not observed | ✅ (`pitching_basesOnBalls`) |

**Reading this table**: "❌ not observed" means the market didn't appear for *this*
fixture in *this* response — for SharpAPI specifically it may mean simply that this
game's slate hadn't posted that market at fetch time, not that the provider never
carries it (SharpAPI's `/sports` catalog is broader than any one game's live board).
SportsGameOdds is the clear breadth leader: 19 stat categories in one request. Route
by this table, but re-verify per-market when wiring a specific column — a market
missing from one game isn't proof it's missing from the provider.

## Coverage matrix — bookmakers per provider

| Bookmaker | SharpAPI | Odds-API.io | SportsGameOdds | OddsPapi | The Odds API (existing) |
|---|:---:|:---:|:---:|:---:|:---:|
| DraftKings | ✅ | — (not selected) | ✅ | ✅ | not tested (see §5) |
| FanDuel | ✅ | — (not selected) | ✅ | ✅ | not tested |
| **Fanatics** | ❌ (tier-restricted) | ✅ (locked slot) | ❌ | ❌ not observed | not tested |
| BetMGM | ❌ (tier-restricted) | ✅ (locked slot) | ✅ | ✅ | not tested |
| **Pinnacle** | ❌ (tier-restricted, confirmed `403`) | ❌ (paid-only) | ❌ | ✅ | not tested |
| Caesars | ❌ | not selected (available) | ✅ | ✅ | not tested |
| ESPN Bet | ❌ | not selected | ✅ | not checked | not tested |
| Bovada | ❌ | not selected | ✅ | not checked | not tested |
| PointsBet | ❌ | not selected | ✅ | not checked | not tested |
| Unibet | ❌ | not selected | ✅ | not checked | not tested |
| 130+ others (soccer-heavy, mostly non-US) | ❌ | not selected | ❌ | ✅ (137 total) | not tested |

**Overlap that matters for entity resolution (§6 of the spec)**: DraftKings and
FanDuel each arrive from **two** live sources (SharpAPI + SportsGameOdds).
BetMGM arrives from **three** (Odds-API.io + SportsGameOdds + OddsPapi). A naive
"N books surveyed" count that doesn't normalize bookmaker names by provider-specific
slug (`draftkings` vs `DraftKings` vs `dk`, etc.) would double- or triple-count these.

---

## 1. SharpAPI

**Base URL**: `https://api.sharpapi.io/api/v1`
**Auth**: `X-API-Key: sk_live_...` header.

- Filter is `sport=baseball&league=mlb` — **not** `sport=baseball_mlb` as the spec's
  shorthand might suggest. The API's own 400 error names the correct value.
- **Every response includes a `meta.tier` block that self-documents the account's
  actual limits**: `{"tier":{"name":"free","data_delay_seconds":60,"books":["draftkings","fanduel"],"requests_per_minute":12}}`.
  This is better than hardcoding constants — the adapter should read delay/books/rate
  from this field per-response rather than trusting only the env var defaults, so a
  plan upgrade is reflected automatically.
- **Confirmed**: requesting `sportsbook=pinnacle` returns exactly the documented
  shape:
  ```json
  {"error":{"code":"tier_restricted","details":{"allowed":["draftkings","fanduel"],"field":"sportsbook","requested":["pinnacle"],"required_tier":"sharp"},"message":"the requested sportsbooks require sharp tier or higher; your current plan is free"}}
  ```
  HTTP 403. The adapter must treat this as a **terminal, non-retryable** state for
  that sportsbook — retrying wastes the 12/min budget on a request that can never
  succeed on this plan.
- **MLB player props confirmed live**: `is_player_prop=true` filter returns real
  rows, e.g. Zach McKinstry / doubles / line 0.5 / DraftKings `+600` / FanDuel
  `+600`. Response carries both `odds_american` and `odds_decimal` plus
  `odds_probability` (vig-included implied probability) — no conversion needed.
  `player_name` and `stat_category` are separate fields, not a combined string.
- Pagination: `limit=500` request returned exactly 200 rows (server-side cap) for
  one game's player props across 8 stat categories. Plan accordingly — one game can
  exceed a single page; the adapter needs to page or scope tightly per market.
- Delay verified structurally (via `meta.tier.data_delay_seconds`), not by
  independently timing prices against a ground truth — 60s is what the provider
  states about itself, taken at face value per the spec's own framing of SharpAPI's
  timestamp as pipeline-refresh time, not price-change time.

**Verdict**: works exactly as spec'd. Zero surprises. Highest-confidence adapter to build first.

---

## 2. Odds-API.io

**Base URL**: `https://api.odds-api.io/v3`
**Auth**: `apiKey` query parameter.

- Event discovery: `GET /events?sport=baseball&apiKey=...` returns real MLB games
  under `league.slug === "usa-mlb"`. No separate "search by team" needed for the
  adapter — the existing MLB game's team names line up directly.
- **Critical operational finding, not in the spec**: the free tier's "choose any 2
  books" is a **persistent account-level selection, not a per-request choice**. The
  first successful `bookmakers=` request **locks in** that pair. A later request
  naming a third book returns:
  ```json
  {"error":"Access denied. You're allowed max 2 bookmakers. Allowed: BetMGM, Fanatics. To reset your selections, use PUT /bookmakers/selected/clear?apiKey=..."}
  ```
  HTTP 403. This account is now permanently locked to **Fanatics + BetMGM** — which
  happens to match the spec's own suggested config, so no action needed, but the
  adapter must **not** attempt to vary `bookmakers=` per request. It's a one-time
  setup constant, not a request parameter in practice.
- **Player props on the free tier — confirmed yes**, and specifically for Fanatics:
  the `/odds` response's `bookmakers.Fanatics` array includes a `"Player Props"`
  market alongside `ML`/`Spread`/`Totals`. Sample row: `{"label":"Zach McKinstry
  (Hits+Runs+RBIs)","hdp":3.5,"over":"6.25","under":"N/A"}`.
  - **The player name and stat type arrive as one combined string** —
    `"Zach McKinstry (Hits+Runs+RBIs)"` — needing a parse step, unlike SharpAPI's
    separate `player_name`/`stat_category` fields. Entity resolution must split on
    the trailing parenthetical.
  - One-sided lines are common (`"under":"N/A"`) — matches the existing `OddsPair`
    component's behavior of omitting rather than fabricating the missing side.
  - **BetMGM's response for this same fixture had no `"Player Props"` market at
    all** — only `ML`/`Spread`/`Totals`/`Both Teams To Score`/`First Team To
    Score`/`Team Total Home`/`Team Total Away`. Whether this is "BetMGM doesn't post
    props on Odds-API.io" or "not posted for this specific game" is unresolved —
    treat Odds-API.io player props as **Fanatics-only** until proven otherwise on a
    second game.
- Odds are **decimal**, not American (`"home":"1.80","away":"2.05"` for the
  moneyline) — needs `decimalToAmerican` conversion. Already exists in
  `lib/odds/display.ts` (added for OddsHarvester's per-book breakdown, which is
  also decimal) — no new conversion utility needed, just reuse it here.
- No delay field anywhere in the response. Unlike SharpAPI, this provider doesn't
  self-disclose latency — label it honestly as "delay not disclosed" rather than
  assuming real-time.

**Verdict**: works, with two adapter-shaping findings the spec didn't anticipate —
the locked book pair, and Fanatics-only prop coverage.

---

## 3. SportsGameOdds

**Base URL**: `https://api.sportsgameodds.com/v2` (not `v1` — `v1` returns
`403 "Your API key does not have access to this version"` on this account).
**Auth**: `X-Api-Key` header (query param `apiKey` also documented as valid).

- `GET /account/usage` **before** any other call:
  `tier: "amateur"`, `per-minute max-requests: 10`, `per-month max-entities: 2500`,
  `current-entities: 0`. Matches the spec's numbers exactly.
- `GET /events?leagueID=MLB&oddsAvailable=true&limit=5` returns **5 events, each with
  a full embedded `odds` object** — 1,072 individual odd entries for the Tigers/
  Guardians game alone, covering game lines and every player prop in one payload.
  **No separate per-event odds call is needed or possible to scope smaller** — the
  event object *is* the odds object.
- **Object-cost check, as the spec required**: usage called again after the 5-event
  fetch showed `current-entities: 5`. **Exactly 1 object per event**, matching the
  spec's assumed budget model precisely — no rescoping needed.
- **Book count and delay — resolved, and better than either conflicting source
  claimed**: 8 books observed with live prices (`fanduel`, `pointsbet`, `unibet`,
  `draftkings`, `espnbet`, `betmgm`, `caesars`, `bovada`), each with its own
  `lastUpdatedAt`. Freshest timestamp was `16:30:43Z` against a fetch at
  `16:35:51Z` — **roughly 5 minutes of delay**, not the ~10 minutes one of the two
  conflicting sources suggested, and nowhere near "80+ books" the other source
  claimed (that's presumably a higher paid tier).
- Response includes **both** `fairOdds` (no-vig, useful) and `bookOdds`, plus a full
  `byBookmaker` breakdown with `deeplink` URLs for draftkings/caesars/betmgm/fanduel.
  Odds are American strings (`"-165"`) — no conversion needed.
- 19 distinct `statID` categories observed for this one game (see coverage matrix)
  — the broadest single-provider market list of the five.

**Verdict**: the free "amateur" tier is dramatically more generous than either
conflicting secondary source suggested. Budget math is simple and confirmed:
**1 object per event, full props included**, so a single "More books" click costs
exactly 1 unit regardless of how many props render from it.

---

## 4. OddsPapi

**Base URL**: `https://api.oddspapi.io`
**Auth**: `apiKey` query parameter.

- `GET /v4/account`: `plan: "free"`, `request_limit: 250`, `request_count` starts
  at whatever the account has already accumulated (was 3 at the start of this
  session — a prior check, likely from the account-creation flow itself).
- **Budget finding the spec didn't anticipate: reference endpoints count too.**
  `/v4/tournaments` and `/v4/markets` each incremented `request_count` by 1, same as
  an actual odds call. The spec frames the 250/month budget as being about odds
  fetches specifically ("~8 requests/day" for the *feature*); in practice, **any**
  call against this API spends from the same pool, including ones needed just to
  resolve a fixture ID or a market-name lookup. **Static reference data (market ID →
  name mappings, tournament IDs) must be captured once and hardcoded/cached in Line
  Buddy's own code, never re-fetched at runtime** — re-deriving the market catalog
  from `/v4/markets` on every cold start would burn a real fraction of the monthly
  budget on data that doesn't change.
- **Full-board request confirmed as exactly 1**: `request_count` went `3 → 4` after
  one `GET /v4/odds?fixtureId=...&verbosity=3` call. Response was **4.18 MB** of
  JSON for a single fixture across 137 bookmakers — this needs field-level
  extraction on receipt, never stored or re-parsed whole.
- **Pinnacle: confirmed present** (`bookmakerOdds.pinnacle` exists with real market
  data).
- **Fanatics: not present** in this fixture's board — contradicts the spec's
  framing of OddsPapi as uniquely including "Pinnacle and Fanatics." Flagged as a
  spec/reality mismatch rather than silently working around it. The account-level
  `/v4/account` bookmaker-capability list shows `fanatics: {has_player_props:
  false}` — but so does *every other book in that list, including draftkings*,
  which we know has odds — so that particular field appears to be a static
  plan-tier flag unrelated to actual per-fixture coverage, not a reliable signal
  either way.
- **Player props: zero found.** Searched every outcome in DraftKings' 124 markets
  and every market key present across all 137 bookmakers for this fixture; **no
  entry anywhere carried a non-null `playerName`**, and the market names actually
  present were exclusively game/inning-level (`Winner`, `Over Under (incl. extra
  innings)`, `Handicap`, all nine `[N]th Inning Result`, `Team 1/2 Odd Even`, etc.).
  OddsPapi's own static market catalog for baseball (794 markets) *does* list
  player-shaped market names ("Over Under Hits", "Over Under Total Bases", "Over
  Under Runs Batted In", etc.) — but **none of those market IDs appeared in the
  actual returned board for this real, upcoming, odds-available fixture.** Either
  MLB player props aren't populated on this plan, aren't populated for this
  particular game/bookmaker combination, or aren't populated at all on OddsPapi
  regardless of plan. This is the single most consequential finding in this
  document — see "Scope change" below.
- **Historical odds — confirmed real, and unexpectedly free.**
  `GET /v4/historical-odds?fixtureId=...&bookmakers=pinnacle,draftkings,fanduel`
  (the `bookmakers` param is **required**, capped at 3 — an unfiltered request
  returns `400 TOO_MANY_BOOKMAKERS`) returned 1.24 MB of genuine timestamped price
  history — e.g. DraftKings' moneyline moved `1.794 → 1.769 → 1.787 → 1.833 → 1.806
  → 1.813 → 1.806` across seven `createdAt` timestamps from `2026-08-10T20:23Z` to
  `2026-08-11T13:03Z`. **`request_count` did not change after this call** (stayed
  at 5 before and after, confirmed by re-checking `/v4/account`). The spec assumes
  historical draws from the same 250/month pool; **this account's behavior
  contradicts that** — historical calls appear to be unmetered, or metered
  separately from the counter this endpoint exposes. Documented as observed, not
  guaranteed permanent — the line-history feature should still apply a cooldown as
  a courtesy/safety margin, but doesn't need to be as fearful of it as the spec
  assumes.
- Odds arrive with `price` (decimal), `priceAmerican`, and `priceFractional` all
  provided directly — best of the five for format convenience.

**Verdict — scope change from the spec**: OddsPapi is confirmed excellent for
**game-level** sharp reference (Pinnacle, 137 books) and **game-level** historical
line movement, both free. It has **no observed MLB player-prop coverage**, which
means:
- **Section 3 & 4 & 8's "Check sharp price" feature is rescoped to game-level markets
  only** (moneyline/spread/total vs. Pinnacle) — it cannot sanity-check a player
  prop against Pinnacle, because there is no Pinnacle player-prop price to check
  against. The UI copy must say this plainly rather than silently doing nothing when
  a prop is selected.
- **Section 4's "Line history" feature is similarly scoped to game lines**, not
  player props — an honest scope reduction, not a broken feature.

---

## 5. The Odds API (existing integration — `THEODDSAPI_KEY` / `ODDS_API_KEY`)

Already live in the app via `lib/odds/oddsApi.ts`, powering Game Detail's
moneyline/spread/total display (confirmed working in update-07's Phase 6
verification). **Not re-tested for player props in this session**, deliberately —
its billing model (`markets × regions` per call) makes props meaningfully more
expensive than any of the other four, all four of which already cover props for
free or near-free, and spending its 500/month game-line budget on an exploratory
props call wasn't worth the cost against what's already answered.

Per the spec's own instruction ("mark it disabled in config rather than removing
the code"), `THEODDSAPI_ENABLED=false` is set in both `.env.local` and
`.env.example`. The coverage matrix above already shows four free/cheap providers
covering everything this one would add for props, and its existing game-line role
is untouched and continues to work exactly as before this update.

---

## Summary of scope changes from the spec, going into implementation

1. **OddsPapi has no player-prop data for MLB.** "Check sharp price" and "Line
   history" both become **game-level-only** features, not per-prop features. This
   is a real, load-bearing correction — implementing them as spec'd (framed as
   prop-level sharp comparison) would have shipped a feature that silently does
   nothing useful for the exact rows (player props) it was designed around.
2. **Odds-API.io's book pair is locked, not chosen per request.** The adapter
   configures `bookmakers=Fanatics,BetMGM` once and never varies it.
3. **Odds-API.io player props are Fanatics-only** in what's been observed —
   BetMGM's side of the same response carried no props market.
4. **SportsGameOdds is materially better than expected**: 8 books, ~5 min delay,
   confirmed 1 object/event, 19 stat categories. No rescoping needed — better than
   the pessimistic branch of the pre-Phase-0 uncertainty.
5. **OddsPapi's request budget is spent by reference calls too**, not just odds
   calls — static catalogs (markets, tournaments) must be cached in Linesmith's own
   code rather than fetched live.
6. **Decimal-to-American odds conversion is needed** (Odds-API.io is decimal-only)
   — turned out `lib/odds/display.ts` already has `decimalToAmerican` (built for
   OddsHarvester's decimal breakdown), so the new prop adapters just reuse it.

All five acceptance-check must-answers from section 8 of the spec are answered
above: Odds-API.io props (yes, Fanatics-only), Fanatics retrievable (yes),
SportsGameOdds object cost (confirmed 1/event), OddsPapi full-board cost (confirmed
1) and Pinnacle/Fanatics presence (Pinnacle yes, Fanatics no), SharpAPI DK/FD-only
plus graceful sharp-book handling (confirmed, exact error shape captured above).

---

## Addendum — team-level markets (Phase 0 for team props)

Live-checked (same CLE @ DET fixture) whether the four real providers carry
**team-total-runs** — the one team prop every provider was checked against,
since it's also what `extractTeamResults` (built for Game Detail's Last-5-Games)
already gives us real per-game history for, making it the cheapest team market
to seed candidates from.

| Provider | Team total runs? | Evidence |
|---|---|---|
| SharpAPI | **Yes** | `market_type: "team_total"` (and `team_total_hits`), with an explicit `team_side: "home"/"away"` field — no name-matching needed at all. Real DK price: `{"selection":"DET Tigers Under","line":3.5,"odds_american":115}`. Unmetered tier, cheapest to poll. |
| Odds-API.io | **Yes** (not re-verified live this pass — hourly rate limit was exhausted from this session's testing; relying on the original Phase 0 finding) | BetMGM's board already showed `Team Total Home`/`Team Total Away`/`First Team To Score` (§2 above). |
| SportsGameOdds | **Yes** | `points-home-game-ou-over/under` / `points-away-game-ou-over/under`, `marketName: "Cleveland Guardians Runs Over/Under"` — a real, team-specific total. |
| OddsPapi | **Yes** | `Over Under Team 1 (incl. extra innings)` / `Over Under Team 2 (...)`, plus first-5-innings and 6th-9th-inning variants. Game-level only, matching the existing player-prop scope correction (§4). |

**Conclusion**: team-total-runs is well-covered — build it first and treat other
team markets (team hits, first-team-to-score) as later additions once this one
is proven out, rather than trying to cover everything a single provider happens
to expose in one pass.
