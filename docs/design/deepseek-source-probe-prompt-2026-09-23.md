# Prompt for DeepSeek (VS Code) — probe odds sources Claude could not open

Copy everything below the line into DeepSeek.

---

You are helping research data sources for an odds scraper. This is
**research only: read-only HTTP requests and page inspection. Do not write or
change any code in either repo, do not commit, and do not build anything.**
Your only output is one results file (format at the end).

## Context

- Scraper project: `C:\Users\occy3\Documents\odds-scraper` — Python venv at
  `.venv\Scripts\python.exe`, HTTP client `curl_cffi` (`requests.get(url,
  impersonate="chrome")`), BeautifulSoup installed.
- Main app repo: `C:\Users\occy3\Documents\line-buddy`. The full plan is
  `docs/design/scraper-bridge-and-edge-gameplan-2026-09-23.md` (§5c lists
  every source already probed). Read §5c first.
- The machine is on a US home connection.
- Another assistant already probed these sources on 2026-09-23. Its browser
  tools refused sportsbook sites, so everything below is either unverified or
  failed for it. **Double-check its findings; do not assume they are right.**

## Rules (hard limits)

1. Read-only GETs (or the same POST a page itself makes to read odds). Never
   place a bet, add to a bet slip, log in, create an account, or enter any
   personal data.
2. **If a target shows a captcha, bot challenge, "access denied", or a
   location/geo block: record exactly what you saw and stop on that target.**
   Do not solve captchas, do not use VPNs or proxies, do not rotate IPs or
   fingerprints to get around a block.
3. At most ~10 requests per target, at least 2 seconds apart. No polling
   loops longer than 5 minutes (only where a step asks for a timed re-read).
4. You may open sites in a normal browser with DevTools → Network (filter
   Fetch/XHR) to find the JSON endpoints a page calls. Record the endpoint,
   method, query parameters and any request headers the page sends that look
   required (API keys embedded in the site's own JavaScript are fine to note).
5. Never paste cookies, session tokens, or anything tied to a logged-in
   account into the results.

## For every target, record

- Reachable? HTTP status, and whether real odds data came back.
- The data endpoint(s): URL pattern, method, required params/headers.
- What it contains: game lines? player props (which markets)? which sports?
  counts from one sample (events, markets, prices).
- **Timestamps:** any per-price / per-market / per-feed time or version field
  (name it and give one example value). Say "none" if none.
- **Cache headers on the data response:** `Age`, `Cache-Control`,
  `Last-Modified`, `X-Cache` / `CF-Cache-Status`. These decide how old a
  "live" price really is.
- Block type if blocked (captcha vendor, Cloudflare, Akamai 403, geo message,
  "upgrade required", etc.).
- One short sample of the raw JSON for a single price (trimmed).

## Targets

### A. US sportsbooks the other assistant could not open

1. **BetMGM** — `https://sports.nj.betmgm.com/en/sports/football-11/betting/usa-9/nfl-35`.
   Expected: odds come from a `cds-api` endpoint (e.g. `/cds-api/bettingoffer/fixtures`)
   with an `x-bwin-accessid` value from the site's JavaScript. Find the
   endpoint, the accessid source, and whether player props are available
   (a per-fixture endpoint). Check cache headers.
2. **Fanatics Sportsbook** — `https://sportsbook.fanatics.com/` redirected to a
   `betfanatics.com` promo page and `/leagues/football/nfl` returned 404.
   Find whether ANY web page shows odds, and what endpoint feeds it. If odds
   are app-only, say so.
3. **Caesars** — `https://api.americanwagering.com/regions/us/locations/nj/brands/czr/sb/v3/sports/americanfootball/events/schedule`
   returned 403 (Akamai-style HTML). Open `https://sportsbook.caesars.com/us/nj/bet/`
   and find the endpoint its pages call; record whether it works outside the
   page or is blocked.
4. **Hard Rock Bet** — `https://app.hardrock.bet/` returned a Cloudflare /
   location page. Record what a browser sees and any odds endpoint.
5. **bet365** — `https://www.nj.bet365.com/` returned a script-only shell.
   Record whether odds are visible in a browser and what feeds them (expected:
   heavily protected — record and stop if challenged).
6. **theScore Bet / ESPN BET** — not probed at all. Find their public odds
   pages and endpoints.
7. **BetRivers props** — game lines work via Kambi:
   `https://eu-offering-api.kambicdn.com/offering/v2018/rsiusnj/listView/american_football/nfl/all/all/matches.json?lang=en_US&market=US`
   (each outcome has `changedDate`). Find the per-event endpoint that returns
   player props (Kambi `betoffer/event/{id}.json` style) and confirm props +
   `changedDate`.
8. **DraftKings and FanDuel** (both work) — double-check only:
   DraftKings `https://sportsbook-nash.draftkings.com/api/sportscontent/dkusnj/v1/leagues/88808`
   plus `/categories/{catId}`; FanDuel
   `https://sbapi.nj.sportsbook.fanduel.com/api/event-page?_ak=FhMFpcPWXMeyZxOx&eventId={id}&tab=receiving-props`.
   Confirm props for MLB and NBA/NHL league ids too, and whether prices differ
   by state (swap `dkusnj`/`nj` for another state such as `dkuspa`/`pa`).

### B. DFS / pick'em

9. **PrizePicks** — `https://api.prizepicks.com/projections?league_id=9&per_page=250&single_stat=true`
   returned 403 with a captcha. Check what `https://app.prizepicks.com/` loads
   in a browser; record the endpoint and whether it is challenged.
10. **Underdog** — `https://api.underdogfantasy.com/beta/v6/over_under_lines`
    returned HTTP 426 "A new version is required". Find the endpoint and the
    version header/param the web app (`https://underdogfantasy.com/pick-em`)
    sends, and whether the request then succeeds.
11. **Sleeper** (works) — double-check `https://api.sleeper.app/lines/available?dynamic=true&include_preseason=true&eg=15.control`:
    what exactly `pick_stats.counts` (over/under/total) and `popularity`
    measure, and whether they change over the day (re-read twice, 10 min apart).

### C. Sharp / exchange sources — timing questions

12. **Pinnacle** — `https://guest.api.arcadia.pinnacle.com/0.1/leagues/{id}/markets/straight`
    (NFL 889, MLB 246, NCAAF 880). The NFL response carried
    `cache-control: max-age=905` and `Age: 765` (a 12.8-minute-old copy), while
    MLB markets changed within 2 minutes earlier. Measure `Age`/`max-age` per
    league and for games starting soon vs days away. Then, in a browser on
    `https://www.pinnacle.com/en/`, find the live push feed the site uses
    (expected: an MQTT-over-WebSocket connection) — record its URL and
    whether it needs any token. **Do not connect programmatically to it**; just
    record what the page does.
13. **Polymarket** — the `gamma-api` markets endpoint is cached 300 s. Confirm
    live prices from the CLOB API (`https://clob.polymarket.com/book?token_id=...`
    or `/prices`), its cache headers and timestamp fields, for one NFL and one
    MLB game market.
14. **Kalshi** — `https://api.elections.kalshi.com/trade-api/v2/markets` works
    (`max-age=15`). Find Kalshi's player-prop series for NFL/MLB and confirm
    per-prop `volume_fp`/`open_interest_fp`.

### D. Public betting % sources

15. **VSiN splits** — `https://data.vsin.com/nfl/betting-splits/` and
    `https://data.vsin.com/mlb/betting-splits/`. For Falcons @ Packers the page
    showed Packers ML 31% handle / 81% bets, while DraftKings' own page showed
    80% / 85%. **Which book are VSiN's splits from (Circa?)** — look for a book
    selector, labels, or query params (e.g. `?bookid=`). Also: does it show
    only games not yet started?
16. **DraftKings Network splits** — `https://dknetwork.draftkings.com/draftkings-sportsbook-betting-splits/`.
    Is the table server-rendered or fed by a JSON endpoint? Which sports and
    markets (props?) does it cover; does it show a last-updated time?
17. **Action Network** — `https://api.actionnetwork.com/web/v1/scoreboard/nfl?period=game&bookIds=15,30,76,75,123,69,68,972,71,247,79`
    has `*_public` / `*_money` fields that were empty for every book. Confirm
    whether any free endpoint fills them, and map the `book_id` numbers to
    book names. Each odds row has an `inserted` time — confirm what it means.
18. **ScoresAndOdds consensus** — `https://www.scoresandodds.com/nfl/consensus-picks`.
    Whose bets/money % is it (a named book or source)?
19. **VegasInsider consensus** — `https://www.vegasinsider.com/nfl/betting-trends/`
    404'd. Find the right consensus / betting-% page.
20. **Covers, SportsBettingDime** — confirm what their % numbers are
    (contest picks vs real bets/money) and their source.

### E. Relay-source questions

21. **4codds** (`https://4codds.com`, already scraped) — its `volume` field:
    Pinnacle's max was exactly 30,000, Polymarket's up to 421,720, and prop
    volume is identical for every player in a game. Find what `volume`/`vol`
    means (page labels, tooltips, JS field names).
22. **comparenbet** — its fair prices carry `fair_odds_available`; find what
    it means on `https://comparenbet.org` (when is it false?).

## Output

Write ONE file:
`C:\Users\occy3\Documents\line-buddy\docs\design\source-probe-results-deepseek-2026-09-23.md`

Start with a summary table — one row per target number above:

| # | target | status (works / partly / blocked / not found) | endpoint | props? | timestamps | cache age | notes |

Then one short section per target with the details listed under "For every
target, record". End with a list of anything you could not determine and why.
Do not modify any other file.
