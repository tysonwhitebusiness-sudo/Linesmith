# Source probe results — DeepSeek (2026-09-23)

Scope: **sections A and B only** (US sportsbooks + DFS/pick'em). Sections C, D
and E were dropped by the operator mid-run; they are not covered here.

Method: read-only HTTP (`curl_cffi`, `impersonate="chrome"`, US home IP) plus
headless-browser network capture where a site's odds API is JS-loaded. No bets,
no logins, no captcha solving, no proxies. All requests ≤ ~10 per target and
≥ 2 s apart.

---

## Summary

| # | target | status | endpoint | props? | timestamps | cache age | notes |
|---|---|---|---|---|---|---|---|
| A1 | BetMGM | **works** | `cds-api/bettingoffer/fixtures` + `/cds-api/bettingoffer/fixture-view` | yes (172 player-prop markets/game) | none per price | `max-age=15` (grid), `max-age=12` (fixture-view), swr | `x-bwin-accessid` is a stable base64 UUID in the site JS; works from curl with no cookies |
| A2 | Fanatics | **not found** | none (own odds app-only) | — | — | — | `betfanatics.com/sportsbook/` = marketing page + Oddschecker B2B widget; no Fanatics-native odds API. App-only |
| A3 | Caesars | **blocked** | `api.americanwagering.com/…/sb/v3/sports/americanfootball/events/schedule` | — | — | — | AWS WAF captcha (`x-aws-waf-token`) + CloudFront 403 "Request blocked" |
| A4 | Hard Rock Bet | **blocked** | none | — | — | — | Cloudflare JS challenge (`__CF$cv$params`, challenge-platform) |
| A5 | bet365 | **partly** | `defaultapi/sports-configuration`, `manifestapi/getmanifest`, `Api/1/Blob` (config, not odds) | — | — | — | `www.bet365.com` → `/usa` state selector (no block); state subdomain shows game rows with `0` odds placeholders, live prices behind protected API |
| A6 | theScore Bet / ESPN BET | **blocked / not found** | — | — | — | — | theScore: Cloudflare "Just a moment…". ESPN BET: `espnbet.com` has no valid TLS cert for the hostname |
| A7 | BetRivers props | **works** | Kambi `betoffer/event/{id}.json` | yes (~532 prop offers, 164 criterion labels) | **`changedDate` per outcome** | fresh (CloudFront Miss, no cache-control) | brand code is `rsiusnj` |
| A8 | DraftKings / FanDuel | **works** | DK `sportscontent/dkusnj/v1/leagues/{id}` + `/categories/{catId}`; FD `sbapi.nj…/content-managed-page` + `/event-page?eventId=&tab=` | yes (all sports) | DK none; FD none (only `previousWinRunnerOdds`) | DK `max-age=1`; FD `max-age=15`, `Age: 34` | **prices identical NJ vs PA** for both books |
| B1 | PrizePicks | **blocked** | `api.prizepicks.com/projections` | — | — | — | DataDome 403 ("Please enable JS and disable any ad blocker") |
| B2 | Underdog | **works** | `api.underdogfantasy.com/v1/over_under_lines` | yes (8667 lines incl. player props) | **`updated_at` per line** | `max-age=10`, `Age: 0` | old `/beta/v6` → 426; needs `client-type: web` + `client-device-id` headers |
| B3 | Sleeper | **works** | `api.sleeper.app/lines/available` | yes (2248 lines, 1436 with pick_stats) | **`updated_at` per line** | `s-maxage=30` + 30 s stale | `pick_stats` counts change slowly over the day (see below) |

---

## A1 — BetMGM (works)

- **Reachable?** Yes. The HTML page (`sports.nj.betmgm.com/…/nfl-35`) loads, but the odds API returns an **empty 200 body to non-browser clients** (curl and `curl_cffi` both got `200` with 0 bytes for `/ClientDist/…js` and `/sports-api/…`). The odds are fetched by the SPA from `cds-api`, which **does** respond to plain `curl_cffi` once the `x-bwin-accessid` is supplied.
- **Data endpoints:**
  - Game lines (grid): `https://www.nj.betmgm.com/cds-api/bettingoffer/fixtures?x-bwin-accessid={AID}&lang=en-us&country=US&userCountry=US&subdivision=US-NewJersey&fixtureTypes=Standard&state=Latest&offerMapping=Filtered&offerCategories=Gridable&fixtureCategories=Gridable,NonGridable,Other&sportIds=11&skip=0&take=50&sortBy=Tags` → 50 NFL fixtures, 137 optionMarkets each (ML / spread / totals + halves/quarters). ~12.6 MB.
  - Per-game + **player props**: `https://www.nj.betmgm.com/cds-api/bettingoffer/fixture-view?x-bwin-accessid={AID}&lang=en-us&country=US&userCountry=US&subdivision=US-NewJersey&offerMapping=All&scoreboardMode=Full&fixtureIds=6:43436&state=Latest&firstMarketGroupOnly=false` → 533 optionMarkets, of which **172 player-prop markets** (e.g. "Bijan Robinson - Reception Yards", "Christian Watson to record 100+ receiving yards").
- **Accessid source:** `x-bwin-accessid=ZTllNjllODUtOWQwNS00YmU4LWE4NTEtZGZjOTkzMGM5OWU4` (base64 of the UUID `9e9e85-9d05-4be8-a851-dfc9930c99e8`). It is a **constant** embedded in the site's JavaScript bundles (not the initial HTML; the HTML only references the `x-bwin-{product}-api` header convention). It is **not session-scoped** — the same value works from a fresh curl with no cookies.
- **Contents:** game lines (ML/spread/totals, full + 1st/2nd half + quarters), player props (rushing/receiving/passing yards, receptions, TD scorer, alt lines), team totals. `fixtureIds` uses the format `{sportKey}:{fixtureId}` (the fixtures response returns ids already prefixed, e.g. `6:43436`).
- **Timestamps:** **none** per price. Price objects carry only `id`, `numerator`, `denominator`, `odds` (decimal), `americanOdds`. Fixtures carry game `startDate`/`cutOffDate` (not price times).
- **Cache headers:** fixtures `cache-control: max-age=15, public, stale-while-revalidate=60` + `last-modified` (Cloudflare). fixture-view `max-age=12, public, stale-while-revalidate=20`. Both `cf-cache-status: MISS` on first read.
- **Sample (one price):**
  ```json
  {"optionMarkets":[{"id":3669596,"name":{"value":"1st quarter moneyline"},"status":"Visible",
    "options":[{"id":5827943,"status":"Visible","name":{"value":"Atlanta Falcons"},
      "price":{"id":19075719,"numerator":13,"denominator":10,"odds":2.3,"americanOdds":130},
      "parameters":{"optionTypes":["Max"],"fixtureParticipant":729688}}]}]}
  ```

## A2 — Fanatics Sportsbook (not found — own odds app-only)

- `https://sportsbook.fanatics.com/` returns a 555 KB **Fanatics Sports & Casino promo/landing page** ("Bet $20 Get $350 in FanCash"), which then redirects to `https://betfanatics.com/`. It contains no odds — the only "moneyline/odds" text is blog links to betting-guide articles.
- `https://sportsbook.fanatics.com/leagues/football/nfl` → 404 (as the prior assistant found).
- `https://betfanatics.com/sportsbook/` (the page the operator pointed to) is a 1.4 MB Next.js page titled "Online Sports Betting and Trading | Fanatics Sports & Casino", but the rendered body is still marketing ("BET $20 GET $350 FANCASH", "FULL GAME PROTECTION…") — the only odds content on it comes from a third-party **Oddschecker B2B widget** (`widgets.oddschecker.com/v2/widget?json`, `b2b-static.oddschecker.com/oc-widgets/oc-matches-coupon-widget/index.js`). No Fanatics-native odds API is exposed (`api/auth/session` is the only first-party API call observed).
- **Conclusion:** no public Fanatics-native web odds. Real betting is app-only; the web `/sportsbook/` page is marketing plus an Oddschecker comparison widget (paid feeds remain the only source of Fanatics lines).

## A3 — Caesars (blocked — AWS WAF)

- `https://api.americanwagering.com/regions/us/locations/nj/brands/czr/sb/v3/sports/americanfootball/events/schedule` → **403** with a CloudFront "Request blocked" HTML page — from curl **and** from an in-page `fetch()` in a real browser.
- The SPA (`sportsbook.caesars.com/us/nj/bet/`) loads AWS WAF's captcha SDK (`b470c5d1aeb4.edge.captcha-sdk.awswaf.com/jsapi.js`). Its own API calls succeed only with:
  - `x-aws-waf-token: <captcha-issued token>` (long base64 — the gate),
  - `x-unique-device-id: <uuid>`,
  - `x-platform: cordova-desktop`.
- In-browser, menu/home/features/quick-picks return 200 (they carry the WAF token); the odds `events/schedule` path stays behind the WAF gate. Programmatic/curl access is 403.
- **Conclusion:** blocked. Getting odds would require the AWS WAF captcha token, which we must not solve.

## A4 — Hard Rock Bet (blocked — Cloudflare)

- `https://app.hardrock.bet/` returns an HTML shell whose body injects `window.__CF$cv$params` and loads `/cdn-cgi/challenge-platform/scripts/jsd/main.js` — a **Cloudflare JS challenge**. Title "Sports Betting Odds & Lines | Hard Rock Bet Sportsbook" but no odds content is served to non-browser clients.
- **Conclusion:** blocked (Cloudflare challenge). No odds endpoint reachable.

## A5 — bet365 (partly reachable; odds still protected)

- **Correction from the operator:** removing the state subdomain, `https://www.bet365.com/` does load (no challenge). It 302s to a **state selector**: `https://www.bet365.com/usa?isoCode=US&gcsid=MO` — "Where do you want to play? New Jersey · Colorado · Ohio · …" (gcsid geo-detected as Missouri).
- The state selector calls bet365's routing/config endpoints (all 200):
  - `https://www.bet365.com/websiteroutingdatacontentapi/routingdata?v=70121509`
  - `https://www.bet365.com/defaultapi/sports-configuration?_h=…`
  - `https://www.bet365.com/manifestapi/getmanifest?s=www-sports&v=16505&cl=US&a=0`
  - `https://www.bet365.com/Api/1/Blob?…` (their client-library blob loader)
- These are **configuration/manifest**, not odds. The actual state product (`nj.bet365.com` etc., reached after picking a state) renders game rows but **every odds cell is a `0` placeholder** (e.g. "ARI Diamondbacks 0 COL Rockies 0 8:40 PM") — real prices are filled in client-side from bet365's proprietary internal API.
- **Conclusion:** the root domain is reachable (state picker + config APIs), but live odds remain behind bet365's proprietary/protected client API (device fingerprinting, geo checks). No public JSON odds endpoint was observable.

## A6 — theScore Bet / ESPN BET (blocked / not found)

- **theScore Bet:** `https://www.thescore.bet/` and `https://thescore.bet/` both → **403** Cloudflare "Just a moment…" challenge page. Blocked.
- **ESPN BET:** `espnbet.com` and `www.espnbet.com` both fail TLS with `ERR_CERT_COMMON_NAME_INVALID` (curl `SEC_E_WRONG_PRINCIPAL`; Python ssl reports the server presents no valid cert for this hostname). The domain resolves to AWS IPs but serves no matching cert — likely geo/state-gated at the edge or the web product was retired in favor of the app. **No public odds page or endpoint found.**

## A7 — BetRivers player props via Kambi (works)

- **Game lines:** `https://eu-offering-api.kambicdn.com/offering/v2018/rsiusnj/listView/american_football/nfl/all/all/matches.json?lang=en_US&market=US` → 32 NFL events; each listView event carries 1 preview betOffer; every outcome already has `changedDate` (e.g. `2026-09-23T20:20:51Z`).
- **Per-event + props:** `https://eu-offering-api.kambicdn.com/offering/v2018/rsiusnj/betoffer/event/{eventId}.json?lang=en_US&market=US` → **681 bet offers, 164 distinct criterion labels, ~532 player-prop offers** (TD scorer, receptions, receiving/rushing yards, pass attempts, interceptions, etc.).
- **Timestamps:** **`changedDate` on every outcome** (ISO 8601, UTC) — real per-price time. Also `closed` (market close time).
- **Cache headers:** `x-cache: Miss from cloudfront`, no `cache-control`/`Age` → served fresh.
- **Sample (one outcome):**
  ```json
  {"id":4345116628,"label":"GB Packers","englishLabel":"Green Bay Packers",
   "odds":1900,"line":-5000,"participant":"GB Packers","type":"OT_ONE",
   "betOfferId":2694632797,"changedDate":"2026-09-23T20:20:51Z",
   "participantId":1000055908,"oddsFractional":"9/10","oddsAmerican":"-112"}
  ```

## A8 — DraftKings / FanDuel (works — state swap double-check)

**DraftKings**
- `https://sportsbook-nash.draftkings.com/api/sportscontent/dkusnj/v1/leagues/{id}` works for **NFL `88808`, MLB `84240`, NBA `42648`, NHL `42133`**. The response includes `categories[]` with prop category ids: NFL 25 categories (e.g. 492 Game Lines, 1003 TD Scorers, 1000 Passing Props); MLB (Live Batter/Pitcher Props, Plate Appearance…), NBA (Player Specials, Player Averages…), NHL (Goalscorer, Goalie Props…). Props per category come from `/categories/{catId}`.
- Each selection carries `displayOdds` (american/decimal/fractional/percentage) and `trueOdds`.
- **State swap:** `dkuspa` vs `dkusnj` for NFL — 32 events each, **192 selections, 0 differing `displayOdds`** → prices identical across states (at least NJ vs PA).
- Cache: `max-age=1`. **Timestamps: none** per price.

**FanDuel**
- Game lines + events: `https://sbapi.nj.sportsbook.fanduel.com/api/content-managed-page?_ak=FhMFpcPWXMeyZxOx&page=CUSTOM&customPageId={nfl|mlb|nba|nhl}` → 35 NFL events (32 games), 14 MLB games, 33 NBA, 6 NHL.
- Props per game: `https://sbapi.nj.sportsbook.fanduel.com/api/event-page?_ak=FhMFpcPWXMeyZxOx&eventId={id}&tab=receiving-props` → **70 markets** of NFL player props (Receiving Yds, Receptions, Longest Reception, alt lines…). Each runner: `winRunnerOdds` (current) + `previousWinRunnerOdds` (array of prior prices, **no timestamp**) + `isPlayerSelection`.
- MLB event-page returns game markets (Run Line, Total Runs, Moneyline, innings) on the default tab; the MLB player-prop tabs are `Popular` (id 32) and `Hits & Runs` (id 123) — the exact `tab=` slug for MLB hitter/pitcher props was **not pinned** (see "could not determine").
- **State swap:** same game (`eventId 36076208`) via `sbapi.pa…` vs `sbapi.nj…` — **70/70 markets in common, 347 common runner-prices, 0 differing** → prices identical across states.
- Cache headers (event-page): `cache-control: public, max-age=15, stale-while-revalidate=60`, `age: 34`, `x-cache: Hit from cloudfront`.
- **Sample (one runner):**
  ```json
  {"runnerName":"Jahan Dotson Over",
   "winRunnerOdds":{"americanDisplayOdds":{"americanOdds":-125},
     "trueOdds":{"decimalOdds":{"decimalOdds":1.8}}},
   "previousWinRunnerOdds":[{"americanDisplayOdds":{"americanOdds":-106}}],
   "isPlayerSelection":true}
  ```

## B1 — PrizePicks (blocked — DataDome)

- `https://api.prizepicks.com/projections?league_id=9&per_page=250&single_stat=true` → **403**.
- `https://app.prizepicks.com/` → **403** (same).
- The 403 body is: `Please enable JS and disable any ad blocker` with `<script data-cfasync="false">var dd={'rt':'i','cid':'AHrlqAA…` — that is **DataDome** bot protection.
- **Conclusion:** blocked. No endpoint details retrievable without passing the DataDome challenge.

## B2 — Underdog (works — new API version)

- The old `/beta/v6/over_under_lines` → **HTTP 426** `{"error":{"api_code":"upgrade_required","detail":"A new version is required…"}}` (v6 deprecated).
- The current web app (`underdogfantasy.com/pick-em` → `app.underdogsports.com`) calls **`https://api.underdogfantasy.com/v1/over_under_lines`** and it **succeeds (200)** with just two headers:
  - `client-type: web`
  - `client-device-id: <any uuid>` (also sends `client-request-id`, `user-geo-comply-license-key`, `user-location-token` in the real app, but the probe worked without them).
- **Contents:** `over_under_lines` (8,667 lines), `games` (93), `players` (1,676), `appearances` (1,696), `solo_games` (89). Player props (`category: "player_prop"`), e.g. "Bijan Robinson Rush + Rec TDs O/U" with `stat_value`, `options[]` (american/decimal price + odds with fantasy/live multipliers).
- **Timestamps:** **`updated_at` on every line** (e.g. `2026-09-23T23:50:16.994Z`). `provider_id: swish`.
- **Cache headers:** `cache-control: max-age=10, public, stale-while-revalidate=10, stale-if-error=600, s-maxage=10, no-store`, `age: 0`, `cf-cache-status: HIT`, `etag`.
- **Sample (one line, trimmed):**
  ```json
  {"id":"bf8adad9-1cf4-41db-86d0-fac54e0d5d31","line_type":"balanced",
   "updated_at":"2026-09-23T23:50:16.994Z","stat_value":0.5,
   "over_under":{"category":"player_prop","stat":"rush_rec_tds",
     "title":"Bijan Robinson Rush + Rec TDs O/U"},
   "provider_id":"swish",
   "options":[{"american_price":"-136","choice":"higher","decimal_price":"1.74"}]}
  ```

## B3 — Sleeper pick'em (works)

- `https://api.sleeper.app/lines/available?dynamic=true&include_preseason=true&eg=15.control` → 2,248 lines (CFB/NFL/MLB/tennis/golf/MLS/MMA). 1,436 lines carry `pick_stats`.
- **`pick_stats.counts`** = raw counts of Sleeper users' picks on that line: `{over, under, total}` (total = over + under in the samples seen; e.g. MLB `games_played`: over 4 / under 10 / total 14).
- **`pick_stats.popularity`** = a separate 0–1 normalized score. It is **not** `total / max(total)` and **not** strictly monotonic in `total` (a line with total=8 had popularity 0.5432 while total=14 had 0.5185; total=4,340 → 0.9996). It appears to be a recency/velocity-weighted popularity metric; exact formula not exposed by the API.
- **Do they change over the day?** Yes, but slowly. Two reads ~10 min apart (2,248 → 2,294 lines): most `counts` were unchanged, a minority ticked up by a few picks (e.g. `over` 1607 → 1611 on one MLB line; `over` 11 → 12 on another). `popularity` floats update more granularly. So the signal is real but low-frequency — useful as a slow-moving split, not a minute-level feed.
- **Timestamps:** **`updated_at` per line** (epoch ms, e.g. `1790195221085`).
- **Cache headers:** `cache-control: public, s-maxage=30, stale-while-revalidate=30, stale-if-error=60`, `cf-cache-status: EXPIRED`, `etag`.

---

## Could not determine (and why)

1. **BetMGM accessid's exact JS location** — confirmed present in the browser's network calls and stable across all of them, but the JS bundle that literally contains it is served as an empty-200 to non-browser clients, so I could not cite the file/line. (Does not matter practically: the value is constant and works from curl.)
2. **FanDuel MLB/NBA/NHL player-prop `tab=` slug** — NFL `tab=receiving-props` works (70 markets). MLB default tab shows only game markets; the layout lists `Popular` (32) and `Hits & Runs` (123) as the prop-bearing tabs, but `tab=hitter-props` / `tab=hits-runs` returned game-level markets, not player props, so the exact per-sport prop-tab slug is unpinned.
3. **PrizePicks / Hard Rock / theScore / bet365 / Caesars endpoints** — all behind active bot protection (DataDome, Cloudflare challenge, bet365's internal anti-bot, AWS WAF captcha). No endpoint details retrievable without solving a challenge, which is out of scope.
4. **ESPN BET** — `espnbet.com` serves no certificate valid for its own hostname; could not reach any public page or API. Unclear whether it is geo/state-gated or the web product was retired.
5. **Fanatics** — no public web odds exist to characterize; app-only.
6. **Sleeper `popularity` formula** — non-obvious (not total/max, not per-game share, not monotonic in total); the API exposes no definition.
7. **Underdog header requirement** — the probe succeeded with only `client-type: web` + `client-device-id`; whether those two are strictly required (vs. just the version path) was not isolated with a header-omission control run.
