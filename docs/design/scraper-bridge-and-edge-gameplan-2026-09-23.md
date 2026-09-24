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
5. **B7** Pinnacle, Kalshi, Polymarket sources (own schedule) + **B8** VSiN (Circa, Vegas books, openers, splits)
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

| phase | what |
|---|---|
| V1 | Store VSiN splits snapshots (every 5–10 min, pre-game) with game matching |
| V2 | Store Kalshi/Polymarket volume, 24h volume, open interest and depth with every B7 price; split pre-game from in-game |
| V3 | "Where the money is" research card per game (and per player where Kalshi has prop volume): exchange money share per side, VSiN bets % vs money %, labelled by source — never presented as all-book handle |
| V4 | Model inputs and a day-by-day splits/volume dataset |

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
2. Fresh and simultaneous: both prices recent by MEASURED lag (T0), within a
   few minutes of each other (today's `_MAX_PAIR_SKEW_SECONDS` = 30 min is too
   loose).
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
