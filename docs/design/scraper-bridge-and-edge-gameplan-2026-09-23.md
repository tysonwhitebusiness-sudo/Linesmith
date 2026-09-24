# Scraper bridge, line movement and market edge — gameplan

**Written 2026-09-23** from one long audit session; rewritten at its end so
every topic discussed is here. Operator decisions (§1) are settled — do not
re-ask them. **Nothing in §4 onward is built. Do not start a phase without the
operator's go** (standing instruction, 2026-09-23). Evidence for every number
is in §9.

The scraper is a separate project: `C:\Users\occy3\Documents\odds-scraper`
(FastAPI on 127.0.0.1:8000; SQLite `data/scraper.db` holds the recent days;
Parquet in `data/archive/` holds everything older; raw pages in `data/raw/`
kept 48 h). Its own resume notes: `HANDOFF.md`, `SOURCE_HANDOFF.md`.

---

## 1. Decisions (operator, 2026-09-23)

| # | decision |
|---|---|
| D1 | The scraper is a **third writer** into the live tables, beside the Python worker (paid APIs, Render) and OddsHarvester (laptop). It replaces neither. Its full history stays on the laptop; only current prices and price moves reach Supabase. |
| D2 | **Bridge first, then edge.** |
| D3 | **Edge ships without waiting** for the timing audit or the accuracy test, with the strictest gates; tighten/loosen from evidence at ~day 3–5 and ~2 weeks. Never launch loose and tighten later. |
| D4 | **Edge shows only where it can be accurate.** A market that fails a gate shows no edge, never a guess. The old system failed by pricing everyone. |
| D5 | **The Scan table is unfrozen for edge only** (update `tests/slate-shell.test.ts`'s content hash and `tests/ui-scope.ts` deliberately). |
| D6 | The Slate's "no edge, anywhere" rule was a thin-data call. Lift it in CLAUDE.md and `tests/scan-no-edge.test.ts`. Edge is MARKET edge (sharp vs soft book) — no model involved. It lives in odds sections, not as the frame of every card. |
| D7 | Edge is computed across **every** odds system (paid feeds, OddsHarvester, scraper), not one source. |
| D8 | **Pinnacle, Kalshi and Polymarket** are read first-hand as three separate **scraper** sources, pulled continuously. |
| D9 | **No second Render worker for the foreseeable future.** Do not propose one. Laptop-side work runs on the laptop. |
| D10 | Minute-level **line movement** is a headline goal in its own right (§5), not a by-product. |
| D11 | Done in-session: user CLV removed (`709d807`); `prop_odds_history` hot window 14 → 10 days (`2331a56`), sized for the game page's pre-game prop prices; older rows stay in the Parquet corpus. |
| D12 | Never mention licences, terms or resale for any source (standing preference). |
| D13 | **Pinnacle's CDN-cached prices (up to ~15 min old, `max-age=905`) are acceptable** — accounted for, not rejected. Price time = `Last-Modified` (or fetch time − `Age`). The edge compares Pinnacle with the soft book's price **at that same instant** (from the soft book's minute-level history), then shows it only if neither the soft price nor the fast sharp sources (Kalshi ~15 s, Novig/ProphetX) have moved since. The page shows the reference's age ("Pinnacle as of 13 min ago"). |
| D14 | **Never discard useful data; keep it as fresh as it is useful; track every useful movement for everything we can** (operator, 2026-09-24). Every price change, pull, return, split and timestamp is kept — the laptop Parquet history forever, Supabase in its hot window with older rows moved to the corpus (moved, never deleted). Nothing is thinned, sampled or dropped to save space or effort without the operator's say; where a cadence or storage limit is a trade-off, it is written down with its cost and the operator decides. Freshness problems (writer lag, slow tiers, cached copies) are measured and shown, not hidden. |
| D15 | **Master goal: as many player props and game props to analyze as possible** (operator, 2026-09-24) — every market, line and alternate any source prices, for every sport we cover, first-hand where we can read it. Coverage gaps are tracked as work (§4d), not accepted as limits. |

## 2. The three systems today

| system | where | writes | refresh |
|---|---|---|---|
| Python worker (paid APIs: Propline, ParlayAPI, SharpAPI, Odds-API.io, the-odds-api, SportsGameOdds) | Render, one job at a time (`job_queue.py`) | `prop_odds`, `prop_odds_history`, `game_odds_book_lines`, `game_odds_history` | MLB props 2.5 min; NFL/CFB/NBA/NHL/soccer/tennis 20 min; SGO 90 min — **SGO wrote 0 rows: every key at its monthly cap (2,000)** |
| OddsHarvester (OddsPortal) | laptop scheduled tasks | game lines only | ~20 min cycle |
| Scraper (14 sources) | laptop, one process | its own SQLite/Parquet — **nothing reaches the app yet** | ~30–50 s cycle; game lines median 52 s, props median 110 s (they wait for the next cycle) |

The app already takes the newest price per book across providers
(`lib/odds/props/mainLine.ts:111`), so a third writer needs no page changes to
show more books.

## 3. Build order

1. **B0** names → **B1** games → **B2** players (matching; nothing is comparable until done)
2. **L0** measure minute-level move volume (decides storage before the bridge writes)
3. **B3** flap filter + line-pull recording
4. **B4** bridge (forwards individual changes with their scrape time)
5. **B7** Pinnacle, Kalshi, Polymarket + **B8** VSiN (Circa, Vegas books, openers, splits) + **B9** DraftKings, FanDuel, BetRivers, Sleeper + **B10** BetMGM, Underdog + Track V splits sources — each on its own schedule
6. **S1–S3** scraper reliability + backups (in parallel with B4/B7)
7. **L1–L5** line movement on the pages; **V1–V3** splits + exchange volume
8. **B5/B6** page touches + expiring history grab (B6's grab is time-sensitive — can run any time)
9. **E1–E2** edge (strict), **T0** running beside it
10. **E3** closing-line test, ~2 weeks after E2

## 4. Track B — the bridge

| phase | what | done when |
|---|---|---|
| B0 | Add the 68 missing market labels + 11 missing books to BOTH alias maps (`entity_resolution.py`, `lib/odds/props/entityResolution.ts`; `tests/config-drift.test.ts` asserts they match) | both-mapped share ≥ ~90% (was 42%) |
| B1 | Match scraper games → Linesmith game ids. Use comparenbet's dropped team ids and ESPN logo URLs (`_homeTeamID`, `_awayTeamLogo`) as extra keys | match rate per sport, hand-checked sample |
| B2 | Match scraper players → ESPN athlete ids via the roster index (`resolve_player`) | match rate per sport, hand-checked sample |
| B3 | **Flap filter** (a new price counts once it holds two readings; judge pre-game and live separately). **Line-pull recording** in the scraper (it records nothing when a price disappears; its dedup hides a pull-and-return) and in Linesmith's writer (`db.write_prop_odds` step 4 deletes from `prop_odds` and writes nothing to history) | a pulled line visible in history; flap share below the paid feeds' |
| B4 | The bridge: a laptop job writing through `db.write_prop_odds` / `db.write_game_odds_book_lines` as `scraper:<source>`. **Forwards each (de-flapped) change with the scraper's own fetch time as `observed_at`** — not a periodic snapshot, which would erase sub-minute moves and stamp write time. Pushes the sharp sources first. Unmatched rows KEPT with their prices (today `odds_unresolved` keeps only the name). Heartbeat for `health_check`; starts at boot; restarts on crash | two days unattended, heartbeat green, history growth inside the L0 estimate |
| B5 | Pages: display names and order for the new books; "open at book" deep links from comparenbet's `_links` (40+ books) | rendered on each sport's player + game page |
| B6 | **Expiring history — grab now:** run `backfill_comparenbet_history.py` (`line_history` has 0 rows); pull theoddsgap's 45-day props export daily (each missed day is lost for good); stop discarding betmonitor's 24 h charts and oddstrader's openers | rows landing daily |
| B7 | **Pinnacle, Kalshi, Polymarket as scraper sources** (D8). Requirements: (1) their OWN schedule, not the shared cycle; (2) bridge carries fetch time and Pinnacle's `version`; (3) per-source heartbeat read by `health_check` and the edge self-check; (4) gates: exchanges on bid/ask spread + liquidity, Pinnacle on its stated limit. REST polling ~30–60 s first; push streams (Pinnacle MQTT, exchange WebSockets) later — auth needs unverified. Fallback if Pinnacle's guest API ever blocks: pinnodds.com ($99–229/mo; its docs say no per-event timestamp either) | all three landing on their own cadence, heartbeats green, matched |

| B8 | **VSiN as a scraper source** (operator, 2026-09-23; planned alongside Pinnacle). Circa has no public web odds — its apps are geo-locked (NV, CO, IL, IA, KY, MO) and its own "Betting Menu & Odds" page links out to VSiN. One source `vsin`, endpoints on their own schedules: **line tracker** (`data.vsin.com/vegas-odds-linetracker/?sportid=`, NFL/CFB/NBA/NHL/MLB/CBB) every 1–2 min — Circa + Westgate, South Point, Wynn, Stations, Boomers, Caesars, BetMGM; spread/ML/total; an OPEN row with each book's opener; per-game detail at `game_lines_detail.php?gamecode=` (opener + current only, no history); **betting splits** (`/{sport}/betting-splits/`) every 5–10 min (Track V); **MLB umpire summary** and **NFL referee summary**, **power ratings** daily. No timestamps anywhere; update rate unknown — Circa-via-VSiN is a sharp reference only after T0 (compare against Circa via comparenbet, ~919 game-line prices). No props. Player-props and projections pages carry no data without login/JS. Pages 340 KB–1 MB HTML (~14× smaller compressed). Not yet checked: `/nfl/games/`, team summaries (ATS) | line tracker + splits landing on schedule; Circa matched to Linesmith games |

| B9 | **US books direct, as four scraper sources** (operator, 2026-09-23 — all four that passed the probe, not two): **DraftKings** (`sportsbook-nash.draftkings.com/api/sportscontent/dkusnj/v1/leagues/{id}` for game lines + `/categories/{catId}` per prop category; NFL 88808; one Receiving Props call = 79 markets / 959 prices; display + true odds; `max-age=1`); **FanDuel** (`sbapi.nj.sportsbook.fanduel.com/api/content-managed-page` for lines + `/api/event-page?eventId=&tab=` per game for props; each runner carries `previousWinRunnerOdds`; CloudFront `max-age=30` + 60 s stale, record `Age`); **BetRivers** (Kambi `eu-offering-api.kambicdn.com/offering/v2018/rsiusnj/listView/...`; real `changedDate` per price; props via the per-event endpoint — to confirm); **Sleeper** pick'em (`api.sleeper.app/lines/available`; 2,393 lines across CFB/NFL/MLB/tennis/golf/MLS/MMA; `updated_at` per line; payout multipliers; `pick_stats` over/under counts feed Track V). Requirements: each on its OWN cadence, set per source from its cache rule (DK ~30–60 s, FanDuel ≥30 s, Kambi ~30–60 s, Sleeper ≥30 s); price time = fetch − `Age` (or `changedDate`/`updated_at` where given); one state per book to start (NJ) — whether prices differ by state is a DeepSeek check; props fetched per category/event, so request counts per cycle must be budgeted per league; heartbeats like B7. These replace the paid feeds' relayed ~20-min copies of the same books for freshness; the paid feeds stay (D1) | all four landing on their own cadence with props, heartbeats green, matched |

## 4d. D14/D15 shortfalls — data we still lose or never collect (listed 2026-09-24)

Measured against D14 (keep everything useful, freshest useful, every movement)
and D15 (as many props and game markets as possible). Each needs the
operator's call; the recommendation is the right-hand column.

| # | shortfall | cost of fixing | recommendation |
|---|---|---|---|
| G1 | **SQLite writer at capacity** — aggregators run 1.1–1.6x their schedule (oddstrader 71 s vs 45 s), the queue swings 0↔~30; evening peaks worse. Freshness lost. | ~30 min: bigger `WRITE_BATCH` (group commit); measure at the evening peak | Do first |
| G2 | **Sleeper pick counts written every 15 min** — changes in between are lost | ~4x the splits rows; needs G1 | Every change, after G1 |
| G3 | **Per-game prop pages tiered**: 10 min at 1–3 days out, 30 min at 3–7 days, none beyond 7 days, NCAAF 5x slower (board main lines stay at 60 s) | more requests to each book from the laptop IP | 5 min to 3 days, 15 min beyond; NCAAF stays slower |
| G4 | **In-game props not tracked** — the four US books' per-game pages stop at kick-off (in-game MAIN lines are still tracked) | many more requests during games | Operator's call (edge is pre-game only; live movement may still be worth keeping) |
| G5 | **Raw pages deleted at 48 h**, incl. fields the parsers skip | ~30 GB/yr for one page per endpoint per hour | Keep one per endpoint per hour (S4) |
| G6 | **Laptop Parquet history has no backup** — the only full copy | Supabase Storage (Pro includes 100 GB) | Do early (S3) |
| G7 | **Coverage limits**: Polymarket next 7 days, ml/spreads/totals only; Kalshi a chosen series list; FanDuel NBA/NHL prop tabs unverified; Sleeper/Underdog games with no schedule have no game row; DraftKings O/U subcategories only (no milestones/TD scorers); BetMGM/BetRivers yes-only ladders partly; oddsrun data API lost; betmonitor blocking | varies per source | Widen Polymarket and Kalshi to every game/prop market; add DK milestone + scorer subcategories; the rest as found |
| G8 | **line-buddy deletes a price when a book pulls it** and records nothing | already inside B3/B4 | Required, not optional |
| G9 | **L0 decides what reaches Supabase** ("all / pre-game only / live on laptop") | Supabase space (79% of 8 GB at 09-13, unmeasured since) | Default ALL changes; if space forbids, bring the numbers — never silently pre-game only |

## 4b. Source run first (operator, 2026-09-23)

**Build B7 + B8 + B9 into the scraper and let them run while the other phases
are built** — early data feeds T0, L0 and the splits history. Nothing in
Linesmith or Supabase changes during this run. Bundled prerequisites:

1. **Git for `odds-scraper`** (it has none — only a manual `backup_20260923/`).
   Commit the current code first.
2. **Scheduler rebuilt for priority** (operator): today `collector.py:228`
   gathers every due endpoint, runs them 6 at a time, waits for the SLOWEST
   before storing, then waits 15 s; cadence has only two classes by endpoint
   name (board 15 s, props 60 s). New design: each source runs on its OWN loop
   with its own interval, request budget, backoff and circuit breaker — a slow
   source delays only itself. Where they share resources (HTTP workers, the
   single SQLite writer) priority is: **(a) direct books and sites** —
   Pinnacle, DraftKings, FanDuel, BetMGM, BetRivers, Kalshi, Polymarket, Sleeper, Underdog, then
   VSiN; **(b) aggregators, most used first** by stored rows (24 h to
   2026-09-23): comparenbet 18.2M, steezanomics 411k, bestfightodds 328k,
   theoddsgap 314k, betexplorer 189k, 4codds 181k, oddstrader 156k, betmonitor
   116k (broken), scoresandodds 34k, oddsrun 15k, livesportsodds 10k,
   proboxingodds 4.7k, mbodds 3.5k, oddsmeter 1.5k. Within a source, per-event
   endpoints go soonest-start first; far-off games are polled less often.
3. **Record `Age` / `Last-Modified`** per fetch (`base.py:35` returns text only).
4. **Monitoring**: fix betmonitor and the drift check (S1); a source returning
   nothing shows as a problem on the Sources page (which lists registered
   sources automatically via `SOURCE_MANIFEST`).
5. **60-second polling** for the direct books (operator accepts the home-IP
   risk). Safety research 2026-09-23: no public limits and no rate-limit
   headers from DraftKings, FanDuel, Pinnacle, Kambi, Sleeper or Kalshi; a
   6-minute trial at 60 s (36 requests) returned 36/36 HTTP 200 with steady
   0.2–0.35 s latency. CDN ages seen: FanDuel 27–86 s, Sleeper 55–59 s,
   Pinnacle NFL 777 → 896 → 50 s (refreshes ~every 15 min). That trial was
   low volume; the full run is ~100–150 requests/min across ~10 domains
   (≤ ~60/min per book), so: ramp up (lines first, props a day later), jitter,
   honour `Retry-After`, and a per-source circuit breaker that stops a source
   for an hour on 403/429/captcha and flags it on the Sources page.
   **Revised by the operator (same day): no ramp-up; each source's next poll
   lands at a random point 60–75 s after its last; always honour
   `Retry-After`.** The breaker classifies before it acts: 429 or
   `Retry-After` → wait as told; 403/503 with a known challenge signature
   (Cloudflare `cf-mitigated` / "Just a moment", PerimeterX `px-captcha`,
   Akamai "Access Denied … Reference #") → bot protection, stop 1 h, red;
   bare 403 → blocked-unknown, stop 1 h, amber; 5xx/timeouts → normal
   backoff, no breaker; HTTP 200 with empty or far-below-normal rows →
   possible soft block or broken parser (betmonitor's failure looked exactly
   like this), flag, stop if it persists.
6. **B3 in this run** (operator): record line pulls in the scraper; flaps are
   FLAGGED, not deleted (raw changes kept; the bridge filters). The Linesmith
   writer half of B3 lands with the bridge.
7. S2 uptime (start at boot, restart on crash, no sleep on power) so the run
   has no gaps.
8. **Raw-page storage** (they are a self-deleting 48 h buffer, never sent to
   Supabase; the permanent record is the parsed Parquet archive, ~135 MB/day
   today). Measured on 30 min of real pages: gzip-6 12×, zstd-9 17×, **zstd
   storing each page as a delta against the previous copy 30×** (comparenbet
   16× → 44×, bestfightodds 27× → 125×); exact repeats were 54% of files / 23%
   of bytes (steezanomics 97%, ScoresAndOdds 92%). Switch raw writes to zstd
   delta with a full keyframe every hour. Today's 14 sources write ~6 GB/day
   gzipped (525 MB per 2 h) → ~2.4 GB/day; with the new sources ~4 GB/day →
   ~8 GB steady on disk at 48 h (24 h retention halves it). **Operator: keep
   48 h; ~8 GB steady is fine.** Raw never accumulates — the only growing
   store is the parsed Parquet archive (~50 GB/yr today + the new sources'
   share, measured in L0), which is also what S3 backs up.

### 4c. Source run — build order (the checklist)

**STATUS 2026-09-24 (UTC): the source run R0–R5 is DONE, live and CLOSED by
the operator** (R3–R5 ran in one unattended pass; the writer-headroom fixes —
bigger `WRITE_BATCH`, rarer Sleeper pick counts — were declined for now: the
lag lands on the lowest-ranked aggregators, 1.1–1.6x their schedule). Next: B0–B2 matching, then the B4
bridge — needs a go. Scraper commits (odds-scraper repo, local git): baseline
`75e8f2e`, R0 `dee6f4e` + `5e9db9f` `09d9c40`, R1 `5d55b38` + `4f48d87`, R2
`3779047`, comparenbet key/fair fix `eda615d`, R3 `898074c`, header fixes
`370dffd`, R4 `d5b3c2c`, R5 `6bc367b`. Runs as scheduled task `OddsScraper`
(logon + 5-min watchdog). 29 sources; the scraper's `HANDOFF.md` top section
is the operating guide.
Measured along the way:
- raw store (zstd delta vs keyframe as long-window prefix): 58x vs gzip's 9x
  on real pages; byte-exact.
- health now catches silent outages: betmonitor "0 rows; typically ~875",
  oddsrun empty since 02:11 UTC 09-24, 4codds props0 HTTP 404 (R5 items).
- strict priority starved low-rank aggregators on the first live run -> aging
  (1 rank per 10 s overdue; never-polled = overdue since start).
- writer was the bottleneck (comparenbet ~3.5-4 s per store): group commit
  (8 results/transaction), tuple dedup keys -> ~1.8-2 s; flaps now COUNTED on
  snapshots (one event per flap was ~15k rows/min from comparenbet — derivable
  from offers anyway); aggregator cadence set to what they achieve (board 45 s,
  props 90 s).
- R1 live fetch tests: Pinnacle 115 games / 9,191 prices / 173 props (14
  requests); Kalshi 12,155 game + 5,701 prop prices (34 requests; per-market
  `updated_time`); Polymarket 396 games / 10,300 prices (30 requests; CLOB
  books timestamped, 500 per call; scope ml/spreads/totals, next 7 days — the
  series carry 66,474 books in all).
- Kalshi `occurrence_datetime` = start + ~3 h (NFL/MLB); MLB tickers carry
  HHMM ET. Windows has no tz database: US Eastern DST applied explicitly.
- R1 verified live (`4f48d87`, steady state 04:35-04:42 UTC 09-24): polls/min vs
  schedule — Pinnacle 6.2/6.2, Kalshi 28.3/29.3, Polymarket 5.9/6.2; direct
  sources every 71 s median (p90 80 s); aggregators board 50 s, props 99 s.
  The first run missed schedule (103 s) because the per-source cap counted an
  endpoint until its result was WRITTEN; workers were never the limit (busy 3.1
  of 10). Fixed: cap counts running fetches; 12 workers as headroom; Polymarket
  discovery timeout 90 s. Pinnacle CDN copies averaged ~11 min old (D13).
- R2 shape: each book = one board per league (main lines + game discovery,
  60-75 s) + one endpoint PER GAME for props/ladders, tiered by start (60 s
  inside 6 h, 3 min inside 24 h, 10 min inside 72 h, 30 min inside 7 days, not
  beyond; NCAAF 5x slower — FanDuel lists 115 NCAAF games). One endpoint per
  game, not a rotating slice, because B3 pull detection is per endpoint.
  DraftKings needs none: a prop-subcategory page covers every game in the
  league. Started games' endpoints are retired (schedule/health dropped).
- R2 measured: FanDuel MLB batter props are yes-only "to record N+" ladders
  (no over/under at all) — stored as OVER N-0.5 with `depth.yes_only`; BetMGM's
  NFL board with lines is 5.7 MB/poll (every alternate line), so its board is
  discovery only and the 1.2 MB per-game view carries lines + props; BetMGM
  serves an older market format for MLB/NBA/NHL and flags no main line (the
  closest-to-even pair is taken); BetRivers (Kambi) stamps every price with
  `changedDate` — the only R2 book with a per-price time. No soccer at FanDuel
  or BetRivers NJ (404). FanDuel NBA/NHL prop tab slugs: not verifiable until
  those seasons open, so those leagues have boards only for now.
- R2 verified live (steady state 05:26-05:35 UTC 09-24): requests/min DK 21.7,
  FD 12.5, BetMGM 8.5, BetRivers 7.9 (plus ~1 per game per book per minute
  once MLB games are inside 6 h); boards every 70-72 s (BetMGM 128 s by
  design), DK prop pages 69 s, day-of games 189-192 s; no errors, all four
  healthy; R1 unchanged; writer caught up.
- comparenbet (2026-09-24): 71% of its written rows sat on keys that appeared
  2+ times in ONE response (team totals had lost the team; DraftKings carries
  a second price pair on 413 of 2,033 markets), so both prices were rewritten
  every poll; and its fair price is one market-wide number copied onto every
  book row (identical in 3,011/3,011 markets), so a fair-only move rewrote
  every book. Fixed with a key variant + a `comparenbet_fair` pseudo-book row;
  replay of 84 real responses: 0 prices lost, 0 fair values unrecoverable;
  live: comparenbet 741k -> 178k rows/hr, all sources 846k -> 263k.
- R3: Sleeper (ids only -> names/games embedded from its public players and
  schedule endpoints; pick counts -> new `splits` table every 15 min) and
  Underdog (28 MB, 304 when unchanged; its API needs the web app's build stamp
  as `Client-Version`, else 426 on 7 of 8 requests). Pinnacle's site sends an
  `x-api-key` from its public /config/app.json; without it 1–2% of polls got
  401.
- R4: VSiN publishes DraftKings AND Circa splits — only the root
  /betting-splits/?source=CIRCA page honours the book; the per-sport page
  silently shows DraftKings. Circa's numbers differ sharply (TNF: ATL spread
  72% of handle / 28% of bets at Circa, 39% / 36% at DK). VSiN's line tracker
  has one table body per period (full game + first half). DK Network's
  splits carry DraftKings' own event id. Action Network relays Fanatics,
  Hard Rock, Caesars and bet365 NJ (blocked first-hand) with per-book
  `inserted` times, plus an Open book. ScoresAndOdds' % are in bar widths.
  Covers is picks, never money. New `reference_data` table for umpire,
  referee, power-rating tables and openers.
- R5: betmonitor had rate-limited this IP since 09-23 04:13 with a 68-byte
  HTTP 200 "Are you a robot? Too many requests" page (read as empty pages for
  30 h) — now a 1-hour rate limit in net.py, and betmonitor polled ~15x less.
  comparenbet `fair_odds_available=false`: 0.27% of outcomes, 82% of them
  where fewer than 3 books quote the market. 4codds `volume` = Pinnacle's own
  bet limit (5/5 identical), not money traded. B6: comparenbet `/history`
  captured once per game after it starts (~57 books, ~50 KB a game);
  theoddsgap props export daily (free 7-day window; ~10.7k checkpoint rows a
  game day; the 45-day window needs an account and was not taken). oddsrun's
  page became a client shell (data API not found yet); oddstrader openers not
  found (covered by Action Network Open, VSiN openers, theoddsgap).
- R3–R5 verified live (steady state 09:36–09:52 UTC 09-24, 29 sources):
  offers 253k rows/hr + splits 11.6k/hr; every new source healthy
  (betmonitor correctly "rate_limited"). The single SQLite writer is ~75%
  busy (queue swings 0↔~20, drains in ~20 s) — the next capacity limit;
  watch it at evening peaks. A bare 403 now pauses 5 min doubling to 1 h
  (a single Pinnacle 403 had paused NCAAF for an hour). Commit `be36cae`.

Each step ends with its sources visible on the scraper's Sources page with
non-zero counts and a green heartbeat before the next starts. The open research
items (DeepSeek §C–E) are answered inside the step that needs them.

| step | what | open items answered here |
|---|---|---|
| **R0 Foundations** | git init + baseline commit; scheduler rebuild (per-source loops, priority order, 60–75 s jitter, `Retry-After`, classifying circuit breaker); record `Age` / `Last-Modified` / `ETag` (+ `If-None-Match`); zstd delta raw storage (hourly keyframe, 48 h); **B3** (pull recording, flap flags); monitoring (soft-block/empty detection, drift-check fix); S2 uptime (start at boot, restart on crash, no sleep on power) | — |
| **R1 Sharp** | Pinnacle (lines + props, 7 leagues), Kalshi (games + props, volume/open interest/depth), Polymarket (markets + live prices, volume) | Pinnacle cache TTL per league / time-to-start — read straight from the `Age` logging R0 adds; Kalshi prop series — list via its public series endpoint; Polymarket live prices — confirm the CLOB API, fall back to `gamma-api` (300 s cache) if not |
| **R2 US books** ✅ | DraftKings, FanDuel, BetMGM, BetRivers (lines + props) | FanDuel MLB slugs found (`batter-props`, `pitcher-props`); NBA/NHL still open until their seasons |
| **R3 Pick'em** ✅ | Underdog (ETag-gated, 24 MB), Sleeper (lines 60–75 s; `pick_stats` ~15 min) | — |
| **R4 Betting %** ✅ | DraftKings Network splits, VSiN (line tracker + splits + umpires/refs/power ratings), ScoresAndOdds consensus, Covers, SportsBettingDime, Action Network (timestamps for T0) | DK Network — how the table loads (it is server-rendered HTML; check for a JSON feed first); VSiN's splits book — look for a book selector/label, show as "VSiN splits (book unconfirmed)" until known; ScoresAndOdds' source — label as theirs until stated; Action Network book ids — from its books endpoint / page |
| **R5 Existing aggregators** ✅ | the 14 current sources re-slotted by usage; comparenbet parser keeps `fair_odds_available`, `_links`, team ids/logos, live state; fix betmonitor; **B6** expiring-history grab (comparenbet `/history` backfill, theoddsgap 45-day props export daily, betmonitor 24 h charts, oddstrader openers) | comparenbet `fair_odds_available` — measure when it is false (live? thin books?); 4codds `volume` — compare with Kalshi/Polymarket's own numbers, stored but unused until explained |

**Not in this run:** B0–B2 matching, B4 bridge, Tracks L/E and V3 cards
(built while the run collects); Pinnacle's live MQTT feed (later, once polling
data shows where the 15-min cache hurts); VegasInsider (its consensus page was
not found — dropped unless a URL turns up).

**Edge coverage reality check (measured, NFL, 2026-09-23):** of DraftKings' 262
over/under player props, Pinnacle prices the same player + stat for 152 (58%)
but at the SAME line for only 90 (34%): receptions 44/80, TD passes 15/28,
receiving yards 16/80, rushing yards 12/46, passing yards 3/28 — yardage lines
usually differ by 1–2 yards. DraftKings also has many markets Pinnacle does not
offer at all (yardage milestones 25+/50+…, TD scorers, longest reception,
1st-quarter props), and Pinnacle has no NCAAF or EPL props. Game lines match far
better (Pinnacle carries alternate spreads/totals). Ways to widen prop edge
later: other sharp sources at the book's own line (Novig, ProphetX, Kalshi), or
a line-shift method (a model step — its own, lower-confidence tier; operator's
call, not planned).

| B10 | **BetMGM + Underdog** (found by DeepSeek, re-verified by Claude 2026-09-23). **BetMGM**: `www.nj.betmgm.com/cds-api/bettingoffer/fixtures` (lines; NFL `sportIds=11`) and `/cds-api/bettingoffer/fixture-view?fixtureIds={id}` (per game: 533 option markets incl. player props — rushing/receiving yards, receptions, TD scorer, alt lines); needs the constant `x-bwin-accessid` from the site JS (`ZTllNjllODUtOWQwNS00YmU4LWE4NTEtZGZjOTkzMGM5OWU4`), no cookies; `max-age=15` (+60 s stale) / fixture-view `max-age=12`; no per-price timestamps; fixtures list is 3.6 MB for 10 games — take small pages. **Underdog** pick'em: `api.underdogfantasy.com/v1/over_under_lines` with headers `client-type: web` + `client-device-id: <uuid>` (old `/beta/v6` → 426); 8,845 player props, `updated_at` per line, `max-age=10`; **24 MB per response** — poll with `If-None-Match` (it sends an `ETag`) so unchanged payloads cost nothing | both landing on their own cadence, matched |

**DeepSeek probe, sections A–B (2026-09-23; results in
`docs/design/source-probe-results-deepseek-2026-09-23.md`):** DraftKings and
FanDuel prices are **identical NJ vs PA** (DK 192/192 selections, FD 347/347
runner prices) — one state is enough. FanDuel props per game via
`event-page?tab=` (NFL `receiving-props` = 70 markets); the MLB/NBA/NHL prop tab
slugs are not pinned yet. **Blocked or unavailable — stay on the paid feeds:**
Fanatics (app-only; its web page is marketing plus an Oddschecker widget),
Caesars (AWS WAF captcha), Hard Rock (Cloudflare challenge), bet365 (odds
filled by a protected client API; cells render as 0), theScore (Cloudflare),
ESPN BET (no valid TLS cert for its hostname), PrizePicks (DataDome). Sections
C–E (Pinnacle TTL + live feed, Polymarket CLOB, Kalshi props, VSiN's book,
DK Network splits structure, Action Network book ids, ScoresAndOdds' source,
VegasInsider, 4codds `volume`, comparenbet `fair_odds_available`) were not run
— still open.

## 5b. Track V — betting volume and splits (new data type)

**Question (operator):** total and per-book betting volume per game, team and
player, and who has been bet on more, as a %. **Measured 2026-09-23:**

- **No sportsbook publishes per-game handle.** Nothing in the three systems
  carries it: Linesmith's paid feeds have no volume/handle/split fields
  (`providers.py`), OddsHarvester none, and 12 of 14 scraper parsers set
  `volume` to None.
- **Bet % and money % (one book):** VSiN betting splits — per side, % of
  handle and % of bets for spread/total/moneyline, NFL/CFB/MLB/NBA/NHL/CBB/
  tennis/golf/UFC/UFL. E.g. Packers −250: 81% of moneyline bets, 31% of the
  money. Only games not yet started are shown, so history exists only if we
  snapshot through the day (lost per missed day). Source book unlabelled — its
  only book link is `bookid=dk`, so probably DraftKings; Circa splits
  unconfirmed. Game lines only.
- **Real traded volume (exchanges, first-hand):** Kalshi per market —
  `volume_fp`, `volume_24h_fp`, `open_interest_fp`, bid/ask sizes (an MLB
  "Boston wins" market: 1.52M contracts traded, 926k open interest; includes
  in-game trading). Polymarket per market and per event — `volume`,
  `volume24hr`, `liquidity` (NFL 2027 champion event: $59.3M). Per-team volume
  is per-market, so a game's two team markets give a % split of real money.
  Kalshi lists player props (Linesmith's feeds carry ~1,605 Kalshi
  player-markets); per-prop volume unverified.
- **4codds `volume`** (only scraper source storing one): meaning unclear —
  Pinnacle's max equals 30,000 (looks like a limit), Polymarket up to 421,720
  (looks like traded), and its prop volume is identical for every player in a
  game (a game-level figure). Verify against Kalshi/Polymarket before use.
- **Not checked:** state regulators' monthly handle by operator (aggregate,
  never per game); other public splits sites.

**Decided (operator, 2026-09-23): implement all three alternatives** — VSiN
splits (one book's bets % vs money %), Kalshi volume, Polymarket volume. Each
is shown labelled by its source; none is presented as all-book handle.

**Added (operator, 2026-09-23) — the public betting % sources, all in the
source run:**

| source | what | cadence / notes |
|---|---|---|
| **DraftKings Network splits** (`dknetwork.draftkings.com/draftkings-sportsbook-betting-splits/`) | DraftKings' own % handle and % bets per market; NFL, NCAA, MLB, NHL, EPL, UCL, MLS; up to 30 days ahead | every ~5–10 min; a game's split disappears at start, so the final pre-game split exists only if snapshotted |
| **Sleeper pick counts** (`pick_stats` in B9) | users' over/under pick counts per player prop + a `popularity` score (formula undisclosed; not total/max) | counts move slowly (a few picks per 10 min) — every ~15 min is enough |
| **ScoresAndOdds consensus** (`/nfl/consensus-picks`, same site as an existing source) | % bets and % money per side; source unstated | every ~15 min |
| **Covers consensus** | contest players' picks % — handicapper consensus, NOT money | hourly; label as picks, never as bets |
| **SportsBettingDime** | weekly public-betting report articles + small tables | daily; lowest priority |
| **Action Network** | % fields empty without paid access; per-book `inserted` times | for T0 timing only |

VSiN (B8) stays; which book its splits come from is still open.

| phase | what |
|---|---|
| V1 | Store VSiN splits snapshots (every 5–10 min, pre-game) with game matching |
| V2 | Store Kalshi/Polymarket volume, 24h volume, open interest and depth with every B7 price; split pre-game from in-game |
| V3 | "Where the money is" research card per game (and per player where Kalshi has prop volume): exchange money share per side, VSiN bets % vs money %, labelled by source — never presented as all-book handle |
| V4 | Model inputs and a day-by-day splits/volume dataset |

## 5c. Source targets — US books, DFS, public betting % (researched 2026-09-23)

Probed read-only from the laptop (curl_cffi, 1–3 requests each). **Nothing
built; research continues before choosing** (operator). Note: Linesmith's paid
feeds already carry most of these books (fresh `prop_odds` rows seen for
DraftKings, FanDuel, Fanatics, Hard Rock, BetMGM, Caesars, bet365, BetRivers,
PrizePicks, Underdog, Sleeper) — relayed, at ~20 min. Direct scraping buys
freshness and depth, not new books.

**Works now (verified):**

| target | endpoint | what | timestamps |
|---|---|---|---|
| DraftKings | `sportsbook-nash.draftkings.com/api/sportscontent/dkusnj/v1/leagues/{id}` + `/categories/{catId}` (NFL 88808) | game lines; props by category — one Receiving Props call = 79 markets, 959 prices; display + true odds | none |
| FanDuel | `sbapi.nj.sportsbook.fanduel.com/api/content-managed-page` + `/api/event-page?eventId=&tab=` | futures + main lines; props per game (28 receiving markets in one game); each runner carries `previousWinRunnerOdds` | none (previous price only) |
| BetRivers | Kambi `eu-offering-api.kambicdn.com/offering/v2018/rsiusnj/listView/...` | game lines (32 NFL events); props via event endpoint unverified | **`changedDate` per price** |
| Sleeper (pick'em) | `api.sleeper.app/lines/available` | 2,393 lines — CFB 993, NFL 680, MLB 481, tennis, golf, MLS, MMA; payout multipliers; **`pick_stats`: users' over/under pick counts per player prop** on 1,544 lines (e.g. MLB hits 0.5: 1,033 over / 18 under) | **`updated_at` per line** |

**Blocked or unresolved:** PrizePicks (403 captcha); Hard Rock (Cloudflare /
location); Caesars API (403); Underdog (HTTP 426 "a new version is required" —
needs an app-version header, likely solvable); BetMGM and Fanatics (odds API
not in page HTML — needs a browser network capture; the built-in browser
refuses sportsbook sites); bet365 (script-only shell); theScore/ESPN not
probed. Wrong Kambi brand code tried first (`ubusnj`) — BetRivers is `rsiusnj`.

**Claude in Chrome check (2026-09-23):** BetMGM refused by the extension
("not allowed due to safety restrictions") — same as the built-in browser;
verifying it needs the operator's own devtools. Fanatics: the sportsbook
domain redirects to a `betfanatics.com` promo page and the league path 404s —
no public web odds found; stays on the paid feeds.

**First-hand = self-timestamped, minus the CDN's age.** A book's OWN endpoint
returns its current price, so our fetch time is the price time — except where
a CDN serves a cached copy. Measured response headers:

| source | cache rule | age of the copy we got |
|---|---|---|
| DraftKings | `max-age=1` | ≤1 s |
| BetRivers/Kambi | none (CloudFront miss) | fresh |
| Kalshi | `max-age=15` | ≤15 s |
| Sleeper | `s-maxage=30`, +30 s stale | ≤~60 s |
| FanDuel | `max-age=30`, +60 s stale | 24 s (up to ~90 s) |
| Polymarket `gamma-api` | `max-age=300` | 239 s — use the CLOB API for prices instead |
| **Pinnacle** `/leagues/889/markets/straight` | **`max-age=905`** (Cloudflare) | **765 s** (last-modified 12.8 min earlier) |

Rules that follow: (1) record every response's `Age` / `Last-Modified` and set
price time = fetch time − Age (never fetch time alone); (2) Pinnacle's cached
league endpoint cannot be the live sharp reference as-is — measure its TTL by
league and time-to-start (the earlier MLB re-read saw 254 of 679 markets change
in 1.9 min, so TTL likely varies), and move to the live feed its own site uses
(the MQTT push pinnodds describes) for near-start games; (3) Polymarket prices
from `clob.polymarket.com`, not `gamma-api`. These feed T0.

**Public betting % targets:**

| target | what | status |
|---|---|---|
| **DraftKings Network splits** (`dknetwork.draftkings.com/draftkings-sportsbook-betting-splits/`) | DraftKings' OWN % handle and % bets per market; NFL, NCAA, MLB, NHL, EPL, UCL, MLS; Today / Tomorrow / 7 / 30 days (future games too); server-rendered | works — Packers ML 80% handle / 85% bets |
| **Sleeper `pick_stats`** | per-player-prop over/under pick counts + popularity | works (above) |
| VSiN splits (B8) | **not DraftKings** — same game: VSiN 31% handle / 81% bets vs DK 80% / 85%. Default book possibly Circa — confirm | works |
| ScoresAndOdds consensus (`/nfl/consensus-picks`) | % bets and % money per side; source unstated | works |
| Action Network API | `_public`/`_money` fields exist but EMPTY for every book without paid access; each book row has an `inserted` time (use for T0) | fields gated |
| Covers consensus | contest players' picks %, not money | works (different signal) |
| SportsBettingDime | weekly public-betting report, small tables | works (articles) |
| VegasInsider | URL tried 404'd | not found |

## 5. Track L — minute-level line movement

Why it matters: the app's movement is sparse because most sports refresh every
20 min and Propline records a move at a 60-min median; the chart's default 48 h
view uses 30-min buckets; pulled lines are invisible. The scraper sees prices
every ~50 s across ~45 books, and the first-hand sources (B7) change on a
version counter we can timestamp to the poll.

| phase | what |
|---|---|
| L0 | **Measure before writing.** Pre-game, de-flapped, matched moves per day per source — comparenbet alone showed ~64k distinct-price moves/hour including live games, well above the earlier snapshot-based estimate (0.49–0.59M history rows/day). Decide from the number: all changes to Supabase, pre-game only, or live moves kept on the laptop only. Re-check DB headroom (5.42 of 8 GB; ~6.7 GB was the snapshot-based estimate) |
| L1 | Chart resolution: shorter windows (e.g. 2 h / 6 h / 12 h) so minute and 5-min buckets are reachable (`BUCKET_LADDER_SECONDS` starts at 300 s, `MAX_BUCKETS` 160, `lineHistory.ts:106`); price age shown |
| L2 | Pulled lines drawn on the chart (needs B3; today "withdrawn" and "unchanged" both look like silence, `LineMovementCard.tsx:52`) |
| L3 | **True openers**: theoddsgap's sharp opener with `first_listed_at`, 4codds' openers, oddstrader's, and our own first-seen for Pinnacle — "opened X, now Y" on props and game lines |
| L4 | **Movers and steam** at minute resolution: steam = 3 books same direction within 30 min (`marketMoves.ts:99`) — barely detectable at 20-min polling, detectable and timestamped at ~1 min. Retune thresholds on real data |
| L5 | **Dropping odds** lists (livesportsodds, oddsrun: opening → current, % change across 70–100 books; mostly soccer) and betmonitor's 24 h per-outcome charts for late-watched games; pulled-line alerts |
| L6 | Model inputs: line-movement features from the dense history; props CLV for the models using Pinnacle/fair closing prices (today model CLV covers MLB moneyline + totals only, `jobs.py:1301`) |

Storage split: full minute history on the laptop forever (Parquet ~6 bytes/row);
Supabase keeps 10 days (`prune_corpus.KEEP_RECENT_DAYS`), older rows go to the
corpus. The TS app cannot read the corpus, so charts reach 10 days back.

## 6. Track T — timing (runs beside edge, tunes its gates)

Fetch time is not price time. Real timestamps by source (§9.4): 4codds per
price (real, ambiguous "changed" vs "confirmed"); theoddsgap feed-level only
(feed was 43 min old at fetch); comparenbet's are FAKE (relay time); fight
sites "N min ago"; all others none. Paid feeds: unchecked.

| step | what |
|---|---|
| T0.1 | Keep every real timestamp (4codds, theoddsgap feed stamp, fight-site ages, paid feeds' own stamps if present). Never use comparenbet's |
| T0.2 | After B1: measure each source's real lag — when Pinnacle's price for a game moves in one source, time how long each other source takes to show it |
| T0.3 | Only proven-fast sources may be the sharp reference; the freshness gate uses measured lag; every edge shows its prices' age |
| T0.4 | Check the paid feeds' APIs for per-book timestamps; recheck SGO's real `lastUpdatedAt` after its monthly key reset |
| T0.5 | Track edge half-life (edges that vanish within a reading or two are timing artefacts) |

## 7. Track E — market edge

**Calculation**: de-vig the sharp two-sided price to a fair probability;
compare with the soft book's implied probability. Pinnacle −115/−105 → fair
51.1%; DraftKings +105 (48.8%) → +2.3 pts, EV +4.7%. Stored as
`edge_sharp_vs_soft` (probability points); show EV too.

**Why the old edge failed** (measured): 18,808 of ~19,300 stored edges (97%)
were `model_vs_market` — the model disagreeing with the book, not a mispriced
book. Only ~500 used a sharp reference, and those carry the `pick_history` bug
(§8.2).

**Gates — edge renders only if ALL pass:**

1. Reference — game lines: Pinnacle or Circa two-sided at the exact line, with
   Pinnacle's limit above a floor. Props: Pinnacle two-sided AND (because its
   prop limits are $250–500) a second sharp/exchange source agreeing, or two
   sharp/exchange sources (Novig, ProphetX, Kalshi, Polymarket) agreeing.
   Exchanges count only with a tight bid/ask spread and real liquidity.
2. Time-aligned (D13): the soft price is taken AT the sharp price's own time
   (price time = `Last-Modified` or fetch − `Age`, or measured lag for relays),
   from minute-level history — not "now" against a stale reference. Then the
   edge stands only if the soft price and the fast sharp sources have not
   moved since. A cached Pinnacle copy up to ~15 min old is usable this way.
   (Today's `_MAX_PAIR_SKEW_SECONDS` = 30 min compares unaligned prices — replace it.)
3. Soft price corroborated by a second source where available (a soft price
   that already moved is the other main source of fake edges).
4. Settled: passed the flap filter; not pulled; comparenbet fair prices only
   where `fair_odds_available` is true.
5. Pre-game only.
6. Conservative: de-vig with every method in `odds_math.py`; show the SMALLEST.
7. One book via several providers: freshest wins; if two disagree beyond a
   small tolerance at nearly the same time, no edge.
8. Cap: a single edge above ~8–10% hidden as a probable data error.
9. Self-check: if more than a small share of gated markets show > ~5% at once,
   edge display turns itself off and `health_check` alerts.
10. Logged: every edge shown written (time, prices, reference, method, ages) to
    a NEW table — not `pick_history`.
11. Kill switch: edge display can be turned off without a redeploy.

Expect game-line edges RARE and SMALL (~1–3%) — soft books copy sharp main
lines within minutes; many large game-line edges means something is broken.
Props show edge more often, with more uncertainty.

| phase | what |
|---|---|
| E1 | Edge in Python with the gates; its own table + log (Python writes, TS renders) |
| E2 | Render in odds sections: player prop block, game page odds, Slate Books section, Scan table (D5). Lift the rule (D6). Price age on every edge |
| E3 | ~2 weeks after E2: closing-line test — do soft books move toward our fair price by start? By sport and market type; plus edge half-life. Retune gates |

Confidence (2026-09-23): timing 4/10 today. Edge as originally planned ~5/10
(game lines) and ~4/10 (props); after T0 + first-hand Pinnacle/exchanges,
~8/10 game lines, ~6/10 props. E3 replaces these with measured numbers.

## 7b. Track O — the odds section rebuild

The app's odds sections rebuilt for ~20 books, minute-level movement, pulls,
openers, splits and edge: `docs/design/odds-section-rebuild-gameplan-2026-09-24.md`
(today's state measured on a prod build, the shared components O-A…O-I, where
each goes on the player / game / team pages and the Slate, phases O0–O8). O0
(fix what is broken now) and O1–O3 can start before the bridge.

## 8. Other tracks and routed findings

**S — scraper reliability and storage**

| # | what |
|---|---|
| S1 | **betmonitor has returned empty pages since 04:13 UTC 2026-09-23** with status "ok" every poll. Fix it, and fix the drift check that missed it |
| S2 | Laptop uptime: start at boot, restart on crash, no sleep while plugged in, Windows-update restarts handled |
| S3 | **Back up the laptop's Parquet history** to Supabase Storage (100 GB included on Pro; history ~50 GB/yr) — today it is one disk with no backup |
| S4 | Raw pages deleted at 48 h: measure what parsers skip; option to keep one page per endpoint per hour (~30 GB/yr, rough) |
| S5 | Reduce reliance on comparenbet (most prop depth, one upstream: SportsGameOdds) with sources not derived from it |

**Routed findings (retention audit + session)** — the corpus holds everything
else; these are the gaps:

1. Soccer injuries: `injury_snapshot.py` lists EPL + MLS; `injury_report` has
   zero soccer rows. Unrecoverable per missed day.
2. `pick_history` grading/capture bug: 19 Pinnacle-referenced MLB HR overs at
   ~+1000 graded 17 wins (likely in-play prices stored as pre-game).
3. `pick_history` keeps only the FIRST prediction (`ON CONFLICT DO NOTHING`).
4. `game_odds_history` never pruned but has no corpus copy.
5. `db.prune_prop_model_cache` exists and is wired to nothing — leave it so.
6. SportsGameOdds keys all at their monthly cap — Linesmith's SGO job writes
   nothing; comparenbet carries the same upstream (without real timestamps).
7. `prop_odds_history` is ~half empty after the 10-day prune; DELETE does not
   shrink disk. Skip `VACUUM FULL`/`pg_repack` — the scraper will reuse the space.

**Later evaluations (not scheduled)**: after ~2 weeks of the bridge, measure
how much of each paid feed the scraper covers (same game/player/market/book
price); OddsHarvester the same. Keep or cut is the operator's call on those
numbers.

**Open operator questions**: whether a Supabase spend cap is on (at 95% full a
capped database goes read-only instead of growing); scraper's own pending item
— purging stale OddsTrader rows (see its `HANDOFF.md`).

## 9. Evidence (all measured 2026-09-23)

**9.1 Name matching** (144,193 current scraper prop prices): books map 94%
(missing `theScore Bet`, `prophetexchange`, `sugarhouse`, `Hard Rock Bet (FL)`,
`BUCKEYE`, `Courtside`, `bookmakereu`, `4CX`, `AMAPOLA`, `4C`, null); markets
46% (68 labels, e.g. `player_touchdowns`, `player_reception_yds`, `H+R+RBI`,
`Singles`, `player_rush_yds`, `player_1st_td`); both 42%.

**9.2 Flapping** (A→B→A as share of moves, one hour, MLB games live):
comparenbet 70% (382k of 546k; ~64k distinct-price moves), oddstrader 96%,
4codds 11%; paid feeds 3–24% (Propline 18%). Paid-feed movement: Propline
median gap between moves 60 min (p10 14, p90 261).

**9.3 Sharp coverage** (two-sided sharp at the same line): Linesmith props 21%
of 15,765 fresh lines (Pinnacle 317 player-markets); game lines 66/99 games;
OddsHarvester none; scraper steezanomics 53% of 3,527 props (90% with 5+
books), 4codds 59% props / 66% game lines, theoddsgap 76% of 5,293 game lines,
comparenbet 11% props (likely undercount) / 40% game lines.

**9.4 Timestamps**: 4codds 9,578 distinct in 20,357 — mean age Pinnacle 18 min,
Novig 15, ProphetX 4, Kalshi 3, DraftKings 2 h, bet365 5.8 h. theoddsgap feed
`last_updated` 43 min old at fetch. comparenbet 9 distinct values in 8,116 (0–3
s old): relay time. comparenbet is SportsGameOdds via a once-a-minute cache
(`_mode: CACHE_ONLY`); its parser drops `fair_odds_available`, `_links`, team
ids/logos, live state, `_note`.

**9.5 Pinnacle direct** (~20 read-only requests, no key, from the laptop):
`guest.api.arcadia.pinnacle.com/0.1` — leagues MLB 246, NFL 889, NCAAF 880,
NBA 487, NHL 1456, EPL 1980, MLS 2663; `/leagues/{id}/matchups` (games +
`special` props, `isLive`) and `/leagues/{id}/markets/straight` (prices,
`limits.maxRiskStake`, `cutoffAt`, `version`). Priced props: MLB 120, NFL 173;
NCAAF/EPL 0; NBA/NHL preseason (recheck October). Limits: MLB spread median
$2,500 (max $10k), total $1,875, moneyline $1,000, props $250–500. `version`
changed with every price change (254 of 679 MLB markets over 1.9 min). ~0.2 s
responses; sustained rate limit unknown.

**9.6 Kalshi / Polymarket**: public, no login. Kalshi `trade-api/v2/markets`
gives bid/ask/liquidity (a new MLB market: 0.44/0.68, zero liquidity).
Polymarket `gamma-api` markets carry `updatedAt`.

**9.7 Storage**: Supabase DB 5.42 GB of 8 GB; `prop_odds_history` 2.39 GB;
1.74M of 7.96M rows older than 10 days. Laptop 293 GB free; scraper SQLite
~10.7 GB, raw 6.9 GB (after 80.9 → 6.1 GB compression), Parquet ~135 MB/day.

**9.8 Retention audit**: no `pg_cron`; all deletes are Python
(`db.RETENTION_RULES`, `prune_corpus`). Corpus (export → upload → verified
prune, every 6 h via `LinesmithCorpusRefresh`) covers `prop_odds_history`,
`odds_archive`, `prop_odds_archive`, `game_result`, `player_game_history`,
`mlb_pitch_events`.
