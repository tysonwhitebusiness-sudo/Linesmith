# P6 · The bridge (B4)

**Lane:** laptop (line-buddy's `python-odds-service`, run on the operator's
machine like OddsHarvester). **Deploys:** one Render deploy ⚑ (the new
health check). **Needs:** P5 applied and deployed, D24, the operator's green
light.
**Goal:** every matched, de-flapped price change the scraper sees reaches
the app's tables within about a minute, carrying its own times, under the
D24 policy, with a heartbeat the health check reads.
**Audit findings covered:** F10, F13, and the bridge half of B3.

---

## Amendments (2026-09-25) — these win where the text below differs

- **P6.0 — D25 comes first.** Before the bridge writes to Supabase for
  real, the cost audit (`results/P6-cost-audit.md`) and its meters, alerts
  and brakes are built:
  - `cost_prices.json`;
  - the bridge's own egress meter;
  - the cron's run-time log;
  - `costGuardJob` and `cost_guard_state`;
  - `health_check.check_cost_guard`;
  - the brake the bridge reads beside `disk_guard_state.bridge_paused`.

  The replay test (a bounded, cleaned-up write) may run before that; go-live
  may not.
- **D24 sets the policy (§5): everything.**
  - Every class is on, pre-game and in-game: first-hand, relay-only, and relay
    duplicates of first-hand books.
  - `unmatched_prices` is on.
  - The hot window is 10 days, and the disk guard owns it (P5 A2).
- **History goes to the compact tables (P5 A1).** The replay test's
  "`prop_odds_history.observed_at` equals the source times" check reads
  `prop_price_history` through `price_history`.
- **Two brakes, both read before every write cycle:**
  - `disk_guard_state.bridge_paused`;
  - `cost_guard_state.brake`.

  Either one holds the rows on the laptop. Nothing is dropped; the rows are
  sent when both clear.

---

## Facts this is built on (read 2026-09-24)

- **Scraper rows:**
  - `offers` holds one row per change (write-on-change).
  - `price` is **American, possibly fractional** (Kalshi 354.55, Sleeper
    −128.21, Polymarket 104.08).
  - `source_ts_ms` is the source's own per-price time where it exists
    (Kalshi, BetRivers `changedDate`, Underdog, Sleeper, Polymarket, Action
    Network `inserted`).
  - `depth` holds per-source detail: Pinnacle `limit`/`version`/`alt`,
    Kalshi `yes_bid`/`yes_ask`/sizes/`ticker`, Polymarket
    `bid`/`ask`/`volume_24h`/`liquidity`, Underdog `mult`/`one_sided`, DK
    `alt`.
  - `snapshots` holds one row per poll (`status` ok|unchanged|error,
    `fetched_at`, `cache_age_s`).
  - `offer_events` holds `pulled`/`returned` (B3, per endpoint).
  - `splits` and `reference_data` (`vsin_opener`, …) hold the rest.
- **The scraper prunes SQLite after `HOT_DAYS` = 3.** The bridge's cursor
  must never fall that far behind; it alerts at 6 h of lag.
- `db.get_pool()` is `max_size=3` per process, which is inside the
  15-connection pooler budget.
  - The bridge is one process.
  - It holds a connection only inside a write call.
  - Each call is one transaction on one batch (the batching lesson of
    `write_game_odds_book_lines`).
- Health: a laptop job reports through
  `db.write_health_check_results([{"name", "healthy", "status", "raw"}])`
  into `job_health_checks`, and `health_check.py` reads it with a dedicated
  check (`check_harvester_scrapes()` is the template).

---

## Build

### 1. Files

- `python-odds-service/src/scraper_bridge.py`: pure logic (mapping, hold
  buffer, policy). It is unit-tested.
- `python-odds-service/src/odds_checks.py`: `opener_sanity()` (below). It is
  pure.
- `python-odds-service/scraper_bridge_run.py`: the long-running process
  (the loop, cursors, writes, heartbeat).
- `python-odds-service/scraper_bridge_policy.json`: D24 as data (below).
- `python-odds-service/run-scraper-bridge.ps1`: the launcher and freshness
  watchdog. It follows the P0 watchdog pattern but checks
  `odds-scraper/data/bridge_status.json` → `last_cycle_at`.
- Scheduled task `LinesmithScraperBridge`: at logon plus every 5 min. The
  operator creates it ⚑, the same way as `OddsScraper`.

### 2. The loop (`scraper_bridge_run.py`)

Every **30 s** (one cycle):

1. **Read new scraper rows since the cursors**, read-only
   (`scraper.db?mode=ro`). The cursors are max ids for `offers`,
   `offer_events`, `snapshots`, `splits` and `reference_data`, stored in
   `bridge.db` table `cursors(name PK, last_id, updated_at)`.
   - At most 200k offers per cycle (a first start after downtime catches up
     over several cycles).
   - Sort by **source priority**: pinnacle, kalshi, polymarket, vsin
     (Circa), then draftkings, fanduel, betmgm, betrivers, sleeper,
     underdog, then the aggregators by `SOURCE_RANK`.
2. **Every 5 min, run P3's `run_matching`** for canonical games starting in
   the next 36 h (and those started < 6 h ago, for in-game rows under D24).
3. **Map each offer (§3) and apply the D24 policy (§5).** Unmatched or
   filtered rows are only **counted**. They remain on the laptop (D14).
4. **Hold for a second reading (§4) and forward the confirmed changes.**
   Writes go in this order, each an awaited `db.write_*` batch of ≤ 5,000
   rows:
   1. `write_prop_odds` (provider `scraper:<source>`);
   2. `write_game_lines` (source `scraper:<source>`);
   3. `write_exchange_books`;
   4. pulls: `write_prop_pulls` / `write_game_line_pulls` from
      `offer_events`;
   5. `write_splits`;
   6. `write_openers`.
5. **Checked times:** upsert `scraper_checks(source, game_id, last_ok_at)` in
   Supabase (§6) for every (source, game) whose endpoint had an `ok` or
   `unchanged` snapshot this cycle.
6. **Advance the cursors only after the writes commit.** A crash re-reads
   rows; that is safe, because the writers are log-on-change and upserts.
7. **Heartbeat:**
   - write `odds-scraper/data/bridge_status.json` with `last_cycle_at`,
     `lag_s` (now − newest snapshot bridged), the rows forwarded per table,
     the rows held, and the rows skipped by reason;
   - every 5 min, call `db.write_health_check_results` with
     `{"name": "scraper_bridge", "healthy": lag_s < 600 and cycle ok, "status": "...", "raw": {…counts…}}`;
   - once a day, write the top 200 unmatched (game, player, market, book)
     to `odds_unresolved` with `provider_id = 'scraper'` (the existing
     table and writer at `db.py:4045`), so the backlog is visible from the
     app.

### 3. Mapping one offer (`scraper_bridge.map_offer`)

| field | rule |
|---|---|
| game | `offers.event_external_id` → scraper `game_links` (source, external_id) → `game_key` → `bridge.db.game_links` → (`app_sport`, `app_game_id`, `reversed`). None → `unmatched-game`, kept in `scraper_unmatched_prices` (§6b) |
| book | `bridgeable_book(book_key)` (P2) → else skip `non-price` / `unidentified-book` |
| game market | `game_market(market)` → (period, type). None → skip `unmapped-game-market`. `reversed` → swap `home`/`away` sides; for `sp` negate `point`; swap `tt_home`/`tt_away` |
| prop | `prop_market_external_id` → scraper `prop_markets` (player, player_norm, stat, line) → `bridge.db.player_links (source, player_norm, app_game_id)` → subject. Key = `prop_market_key(source, stat, position)`, falling back to `prop_market_key(source, offers.market)`. None → `unmapped-market` / `unmatched-player`, kept in `scraper_unmatched_prices` (§6b) |
| side | game: as above. Prop: `over`/`under`, else passed through (the writer's `canonical_prop_side` makes it `other`) |
| price | `american = round(price)`; a value in (−100, 100) after rounding becomes −100 or +100 by sign (the schema's sanity check). `decimal = 1 + price/100` if price > 0 else `1 + 100/−price`, computed from the **unrounded** price |
| checked (`observed_at`) | the offer's snapshot `fetched_at` |
| since (`changed_at`) | `source_ts_ms` if present; else `fetched_at − cache_age_s` if the snapshot recorded an Age (Pinnacle's CDN copies, D13); else `fetched_at` |
| is_main (game lines) | `depth.alt == false` → main; `depth.alt == true` → alternate; no `alt` flag → main when it is the book's only line for that (period, type) in the batch; if several, the pair closest to even money (the BetMGM rule, R2) |
| extra | a whitelist copied from `depth`: `limit, version, yes_bid, yes_ask, no_bid, no_ask, yes_bid_size, yes_ask_size, bid, ask, bid_size, ask_size, volume_24h, open_interest, liquidity, mult, fantasy, one_sided, yes_only, ticker`; plus `price_alt` as `multiplier` for pick'em |
| exchange book | Kalshi/Polymarket rows whose `depth` carries a ladder (odds-scraper `5533251`) → `ExchangeBookInput` (contract = `ticker` / `token`) |

### 4. The hold buffer (B3 flap rule: "a new price counts once it holds two readings")

- `pending[key] = (value, change_snapshot_id, endpoint, row)`, where `key`
  is the app-side natural key.
- A pending change is **confirmed** when a later `ok`/`unchanged` snapshot of
  the same (source, endpoint) exists and no newer offer for the key arrived.
  It is then forwarded, with its **original** times.
- A newer offer for a pending key replaces it. If that newer value equals
  the **last forwarded** value within `FLAP_WINDOW_SECONDS` (600, the
  scraper's rule), both are dropped and counted as a flap.
- A pull event for a pending key drops the pending change.
- **Cost:** one poll interval of delay (≈ 60–75 s for direct books,
  45–90 s for aggregators). It is recorded in the status as `hold_s`
  (median).
- The buffer lives in memory and is rebuilt on restart by re-reading the
  last 10 min of offers.

### 5. Policy — `scraper_bridge_policy.json` (D24 as data)

```json
{ "decision": "D24",
  "classes": { "first_hand": {"pregame": true, "ingame": true},
               "relay_only": {"pregame": true, "ingame": false},
               "relay_duplicate": {"pregame": false, "ingame": false} },
  "first_hand_sources": ["pinnacle","kalshi","polymarket","vsin","draftkings","fanduel","betmgm","betrivers","sleeper","underdog"],
  "hot_windows_days": {"first_hand": 10, "relay_only": 10} }
```

The values above are **placeholders showing the shape**; P4's D24 sets them.
A book is `relay_duplicate` when its `book_key` has a first-hand source in
`first_hand_sources` (`draftkings` via comparenbet, …). Pre-game vs in-game
is decided against `game_links.app_start`.

### 6. Checked times in Supabase (`scraper_checks`)

A tiny table, added to P5's migration if P5 has not shipped yet, or as its
own additive migration:

```sql
CREATE TABLE IF NOT EXISTS scraper_checks (
  source text NOT NULL, game_id text NOT NULL, last_ok_at timestamptz NOT NULL,
  PRIMARY KEY (source, game_id));
ALTER TABLE scraper_checks ENABLE ROW LEVEL SECURITY;
CREATE POLICY scraper_checks_read ON scraper_checks FOR SELECT USING (true);
```

- **Why:** the scraper writes a row only on change, but it re-confirms
  every quoted price on each poll (B3 pull detection proves a key still
  present was confirmed). Bumping every row's `fetched_at` on every poll
  would be millions of updates a day. So a scraper row's **checked** time =
  `max(row.fetched_at, scraper_checks.last_ok_at)` for its source and game.
  The P8/P9 readers apply that (a documented join).
- The bridge keeps an endpoint → games map from the offers it has seen, to
  know which games an endpoint confirms.
- Retention: `RETENTION_RULES` `last_ok_at < now() - interval '3 days'`.

### 6b. Unmatched prices are kept, with their prices (plan B4)

A priced row the bridge cannot map is **not only counted**: it is kept, so
the price exists in the app's database the moment a game, player or label
rule catches up. It goes to a current-state table, one row per scraper key,
upserted each cycle (additive migration, beside P5's or its own):

```sql
CREATE TABLE IF NOT EXISTS scraper_unmatched_prices (
  source      text NOT NULL,
  scraper_key text NOT NULL,          -- the scraper's offer key (source|event|prop market|market|side|book|line)
  event       text,                   -- scraper event name "away @ home" and its start, for a human
  market      text NOT NULL,          -- scraper market / prop label, raw
  player      text,                   -- prop rows: the scraper's player name
  book        text NOT NULL,          -- book_key
  line        double precision,
  side        text,
  price       double precision NOT NULL,  -- as the scraper holds it (American)
  checked     timestamptz NOT NULL,   -- last confirmation (the snapshot's fetched_at)
  since       timestamptz NOT NULL,   -- last change (D23: source_ts_ms, fetched_at - Age, or fetched_at)
  reason      text NOT NULL,          -- unmatched-game | unmatched-player | unmapped-market | unmapped-game-market | no-app-sport
  PRIMARY KEY (source, scraper_key));
ALTER TABLE scraper_unmatched_prices ENABLE ROW LEVEL SECURITY;
CREATE POLICY scraper_unmatched_prices_read ON scraper_unmatched_prices FOR SELECT USING (true);
```

- **Who writes:** the bridge only (Python writes; a row in
  `docs/table-ownership.md`). Non-price rows (`bridgeable_book` false) never
  enter it: they are not prices.
- **Budget:** it is subject to **D24**. The policy object (§5) has an
  `unmatched_prices` entry (on/off, and which reasons). If D24 excludes
  it, D24 says so and why, and the rows stay on the laptop only.
- **Leaving it:** when a later cycle maps the key (a new link or label),
  the row is deleted in the same transaction that writes the mapped price.
  Retention: `RETENTION_RULES` removes rows whose `checked` is > 3 days old
  (a key the scraper stopped quoting).
- **The daily `odds_unresolved` summary (§2 step 7) stays:** it is the
  backlog view; this table is the prices.

### 7. Openers (D21)

- **first_seen:**
  - When the bridge first forwards a key's **main** line for a book, it
    writes `OpenerInput(opener_source='first_seen', opened_at=changed_at)`.
  - **Seed on first start:** for every linked game not yet started, query
    the scraper for the earliest `offers` row per (book, market, side) main
    line (history since 2026-09-22) and write those as `first_seen`. This
    is one query per game, then never again.
- **vsin_open:** `reference_data` rows `kind='vsin_opener'` → per Nevada
  book.
- **an_open:** Action Network `AN Open` rows (`book_key='anopen'`) →
  `bookmaker='anopen'`.
- **Sanity check** — `odds_checks.opener_sanity(opener, peers) -> (flag, reason)`:
  - It needs ≥ 3 peer books' openers for the same game, period and market.
    Fewer → not flagged.
  - Spread: the opener's point differs from the peers' median by more than
    **3.0** (NFL, CFB, NBA), **1.5** (MLB run line), **1.5** (NHL puck
    line), **1.0** (soccer); or its sign is opposite to the median's.
  - Total: it differs from the median by more than **4.0** (NFL, CFB),
    **8.0** (NBA), **1.5** (MLB), **1.0** (NHL, soccer).
  - Moneyline: its implied probability differs from the peers' median by
    more than **0.15**.
  - Props: the line differs from the median by more than 25% of the median
    (and ≥ 1.0).
  - Any price with implied probability outside [0.02, 0.98].
  - A flagged opener is stored with `check_flag=true` and the reason, and
    is never used as "the opener" (D21).
  - Known case (the fixture): BetMGM NV ATL −2 / 52.5 against peers
    −6.5 / 45 → flagged (spread diff 4.5 > 3.0; total diff 7.5 > 4.0).

### 8. Splits and exchange books

- **Splits:** each scraper `splits` row → its game via the event link →
  `SplitInput(market ∈ {ml, sp, tot} as stored, period 'fg', source, book,
  kind, pcts, counts, observed_at = at)`.
  - Sleeper pick counts are keyed to the player through `player_links`
    (`subject_id`) with the prop key from P2.
  - Covers stays `kind='picks'`, never money.
- **Exchange books:** see §3.

### 8b. Reference facts (amendment from P8)

Scraper `reference_data` rows with VSiN power ratings, the MLB umpire summary
and the NFL referee summary become `game_reference` rows via
`db.write_game_reference` (P5):
- power ratings are keyed by team name, matched to the linked games' teams
  with `entity_resolution.normalize_team_name`;
- umpires and referees are keyed by the game when the VSiN row names the
  matchup.

comparenbet's per-event book links (`reference_data`, the `cnb_event`
kind; R5 kept `_links` for 40+ books) become `kind='book_link'` rows, with
`subject` = the canonical bookmaker and `data` = `{"url": …}`. They feed
P12's "open at book".

They are written on change. The builder reads 3 real rows of each kind in
`scraper.db` before writing the mapping and records their shape in this
section.

### 9. Health check — `python-odds-service/src/health_check.py` (the deploy)

- `check_scraper_bridge()`, modelled on `check_harvester_scrapes()`:
  - reads `job_health_checks` row `scraper_bridge`;
  - **stale** if `checked_at` is older than 15 min;
  - **unhealthy** if `healthy=false` (lag ≥ 600 s or cycle errors).
- It is added to the results list beside `check_harvester_scrapes()`.
- Deploy the health-check cron ⚑.

---

## Tests (these gate P7–P9)

| test | kind | what it proves |
|---|---|---|
| `src/test_scraper_bridge.py` (new, hermetic → CI) | Python | **mapping:** reversed game swaps sides and negates spreads; tt_home↔tt_away; fractional price → int + exact decimal; ±99.5 → ±100; `changed_at` from `source_ts_ms` / from Age / from fetch time; is_main by `alt` flag, sole line, closest-to-even; extra whitelist; comparenbet_fair skipped. **Hold buffer:** A→B then a later reading of B → B forwarded with its own times; A→B→A within 600 s → nothing forwarded, 1 flap; A→B→C before a second reading → only C (once confirmed); a pull drops the pending change. **Policy:** a relay_duplicate row is skipped when the policy says so; in-game is decided at `app_start`. **Openers:** the BetMGM NV fixture is flagged; a peer set of 2 is not checked; a normal opener passes |
| unmatched kept (in `test_scraper_bridge.py`) | Python | an unmatched priced row is upserted to `scraper_unmatched_prices` with source, event, market, book, line, side, price, checked, since and its reason; the same key's next change updates the row; once the key maps, the row is deleted and the mapped price written in one transaction; a non-price row is never written there; the policy's `unmatched_prices: off` writes nothing |
| `src/test_odds_checks.py` (new, hermetic → CI) | Python | each threshold row of §7 at its boundary (just inside passes, just outside flags) |
| replay test | laptop, live DB | run the bridge against a **copy** of `scraper.db` limited to one recorded hour, writing to Supabase under provider `scraper-test:*` and fake-game-free real links. Rows written equal the replay's own expected count (a script counts it independently from the same hour). Times are preserved: `prop_odds_history.observed_at` equals the source times. Then delete every `scraper-test:*` row (a cleanup script, listed in the test) |
| heartbeat drill | laptop | stop the bridge → within 15 min `health_check` reports `scraper_bridge` STALE; start it → OK. Kill the process → the watchdog restarts it within 5 min |
| connections | live | under a full-speed catch-up, `select count(*) from pg_stat_activity where application_name like '%bridge%'` (set `server_settings={'application_name':'scraper_bridge'}` in the bridge's pool) never exceeds 3 |
| after start | live | within 5 min, `scraper:*` rows appear in `prop_odds` and `game_lines`; a DraftKings price on a live board changes in the app within ~2 min of changing on the site (one poll + one hold + one cycle) |

**Exit criteria:**
- the hermetic tests pass;
- the replay test matches and is cleaned up;
- the drills pass;
- the bridge has run for 1 h with a green heartbeat;
- the health check is deployed.

## Background checks (never gate)

- **Two days unattended:**
  - heartbeat green;
  - lag < 10 min;
  - no restart loops in the watchdog log;
  - Supabase growth inside P4's projection (`pg_database_size` morning and
    evening).
- **The paid-feed overlap check** (~2 weeks in): for each paid provider,
  the share of its prop prices matched by a `scraper:*` price for the same
  (game, player, market, line, book) within 10 min. The keep-or-cut call
  is the operator's.

## Files touched

- New: the files in §1, plus `src/test_scraper_bridge.py` and
  `src/test_odds_checks.py`.
- Edited: `python-odds-service/src/health_check.py`,
  `python-odds-service/src/db.py` (the `scraper_checks` and
  `scraper_unmatched_prices` upserts and their retention rules),
  `docs/table-ownership.md` (both tables), the migration (§6, §6b), `.github/workflows/ci.yml`, `docs/CURRENT.md`.
- odds-scraper: none (the bridge only reads `scraper.db`).

## Result

**P6.0 closed 2026-09-25 04:37 UTC; the bridge went live 06:41 UTC (restarted
06:52 with the openers fix).** Commits `3eb5e4b` (P6.0), `7398670`, `47e05dd`
and the close-out. Deploys: the worker at `3eb5e4b` by the operator's hand
(04:37 UTC; the permission classifier refused the Render API deploy); the
health-check cron auto-deploys on push and carries `check_scraper_bridge`.

**Hermetic tests (CI):** `test_scraper_bridge.py` (mapping, hold buffer,
policy, openers, splits, book links, ratings), `test_odds_checks.py` (every
threshold at its boundary, the BetMGM NV fixture), `test_scraper_match.py`.

**Replay test (`scraper_bridge_replay.py`): PASS.** One recorded hour
(2026-09-25 04:10–05:12 UTC: 8,976 snapshots, 250,822 offers, 228,140
offer events, 13,001 splits) against the live database under
`scraper-test:*`, counted independently cycle by cycle:
- `prop_odds` 16,842 current rows == 16,842 expected; `game_lines` 21,665 ==
  21,665; `scraper_unmatched_prices` 8,484 == 8,484;
- `prop_price_history` **27,666 rows == 27,666 expected, row for row,
  `observed_at` included** (the source's own time survives);
- the unmatched lifecycle, live: upserted with every field; the next change
  moves `since` (a re-reading moves only `checked`); a hook that raises rolls
  BOTH the delete and the mapped write back; the mapped write deletes the row
  in its own transaction;
- cleanup: zero `scraper-test` rows left in all 14 tables it touches.

**Laptop write latency — found by the replay, fixed at the shared writers.**
From the laptop every statement is a 60–130 ms round trip (the worker sits
beside the database and never saw this). The first full replay took 864 s for
an hour, 730 s of it in `game_lines`: a chunk the `game_odds_book_lines`
mirror refused (in-game totals outside the plausibility bands, 50–70 a
batch) was replayed ROW BY ROW. Now: `write_game_lines` halves a refused
chunk (`_write_isolating`, k·log n statements), and the mirror retries a
refused chunk in ONE server-side `DO` block that records the rows the
constraint refuses — still the only judge. The same hour: **223 s**.

**Live (from 06:52 UTC):**
- first cycles: 27,187 offers read, 12,105 changes confirmed; 1,098 openers
  seeded from history, 517 flagged by `opener_sanity`; writes ~25 s a cycle;
- heartbeat `job_health_checks.scraper_bridge` healthy;
  `health_check.check_scraper_bridge()` reads it; `usage_meters`
  `bridge.egress_bytes` (336 KB in the first 7 min) and `bridge.rows_written`
  recording;
- `scraper:*` rows in `prop_odds` and `game_lines` within minutes.
- **Found live, fixed:** VSiN re-posts its OPEN rows, so the start-up
  openers batch held one key twice and the upsert refused it
  ("cannot affect row a second time"). `write_openers` now keeps one row per
  key (VSiN's latest outranks `first_seen`; otherwise the earliest); the
  bridge also dedupes pulls per cycle.

**Drills:**
- kill: the bridge killed 07:00:55 UTC; the `LinesmithScraperBridge` task
  (registered from `LinesmithScraperBridge.task.xml`) restarted it 07:05:02 —
  inside 5 min. **PASS.**
- stale: task disabled and the bridge stopped 09:34:37 (last heartbeat
  09:33:30); `health_check.check_scraper_bridge()` read **STALE at 09:48:50**
  ("last heartbeat 15 min ago … bridge stopped or laptop off?"); task
  re-enabled and started 09:49:23 → **healthy again 10:02:01** (the first
  start stalled on the cold-cache prop lookup below, fixed and restarted
  10:00:52; its first cycle then caught up 102,515 offers in ~70 s). **PASS.**

**One hour green: PASS** — 07:49 → 09:34 UTC, 1 h 45 min continuous, lag
15–25 s, 403,237 offers read, 181,615 changes confirmed, 1,588 unmatched
prices resolved when their keys mapped, 20 matcher runs, no restarts, no
scraper stall. **Every P6 exit criterion is met.**

**Four live faults found and fixed after go-live (each would have stopped
the bridge silently):**
1. **The resolver's TEMP-table writes pinned the scraper connection to one
   snapshot.** Python's `sqlite3` opens an implicit transaction on DML; nobody
   committed it, so from 07:41 the bridge read no new offer while its cycles
   kept running (and an open read transaction holds back the scraper's WAL
   reset). Every `scraper.db` connection is now `isolation_level=None`.
2. **The matcher held `bridge.db`'s write lock across minutes of roster
   fetches** (it wrote a link, then awaited MLB/NHL rosters), so the bridge's
   own state writes failed "database is locked" every cycle 07:21–07:37. The
   matcher now loads every app game before its first write; the bridge
   tolerates a locked `bridge.db` (seeding waits, cursors retry).
3. **Start-up read the whole offers table** (`min(id) … WHERE snapshot_id > ?`
   walks 39M rows in id order) and the opener seed read up to 50k rows per
   event. Both now go through indexes, bounded. The scraper's writer stalled
   in `commit()` 06:53–06:59 while that scan ran (P0 watchdog restarted it; ~9
   min of snapshots missing); the stall's cause is not proven, the coincidence
   is recorded.
4. **A cold prop-market lookup took `max(id)` per id** — comparenbet keeps up
   to ~21k rows per id — so a restart after downtime spent 10+ minutes before
   its first cycle. Now one row per id by index (7,290 ids in 0.55 s).

5. **Standing prices never arrived.** The bridge forwards changes read after
   its cursor, so a price unchanged since before its game was linked — or
   before the bridge first ran — was never written: Pinnacle's MLB run line
   (unchanged since the day before) was missing from the game page while its
   alternates showed. Now each newly linked game (6 h ago … 36 h ahead) is
   **backfilled once** (bridge.db `backfilled`): each source event's latest
   offer per key over 48 h, minus keys pulled after it (compared on snapshot
   id), forwarded as established prices; time-boxed at 8 s a cycle, no
   openers (the seed owns those). The replay test runs with `--no-seed` so its
   independent count still models only the hold rule. This is a spec gap, not
   a regression: §7's "seed on first start" covered openers only.

A slow cycle (> 180 s) now dumps every thread's stack to
`odds-scraper/data/bridge_stacks.log`, which is how faults 2 and 4 were found.

**Scraper-lane note:** `scraper.db-wal` is 5.2 GB — a high-water mark (it is
not growing: 0 bytes in 2 minutes, checkpoints complete), most likely from the
hour fault 1 held a read open. Reclaiming it needs the scraper to run
`PRAGMA wal_checkpoint(TRUNCATE)` (e.g. at its next restart) and ideally set
`journal_size_limit`; the bridge is read-only on that file and does not.

**Connections:** Supavisor's transaction pooler does NOT pass
`application_name` through (every client shows `''` in `pg_stat_activity`),
so the spec's query cannot see the bridge. Measured instead on the laptop:
established TCP connections to the pooler per process — the bridge held 1
(pool max 2), the matcher runs with max 1 and the P7 timing run with max 1,
never beside the matcher. The budget of 3 holds by construction.

**Known issues, routed:**
- **comparenbet's `tot` mixes markets** (scraper lane): its NFL/CFB `tot`
  rows carry real totals (32.5–48) beside 0.5–14.5 and 146.5–449.5 lines
  (yardage / touchdown totals) under the same market and no label. They land
  in `game_lines` as alternates of `scraper:comparenbet`; the mirror's bands
  keep them off today's pages. The fix is comparenbet's parser in
  odds-scraper; P8 reads comparenbet game lines by `is_main`.
- The worker's cost guard lists `supabase.storage` as unmeasured: the worker
  has no `CORPUS_S3_*` settings (the cron has them). 0.445 GB of 100 GB, $0.

## Changelog

- **2026-09-24 — unmatched rows are kept with their prices** (plan B4;
  `HANDOFF-P0-P4.md` correction 2). The first draft only counted them and
  wrote a daily top-200 summary. New §6b adds `scraper_unmatched_prices`
  (current state, one row per scraper key), subject to D24's budget, plus its
  tests and ownership row.
- **2026-09-25 — amendments:** P6.0 (the D25 audit, meters and brakes first),
  D24's policy (everything), the compact history, and the two brakes.
- **2026-09-25 — build corrections (measured while building):**
  - **§3 "for `sp` negate `point`" was wrong.** scraper.db stores a spread's
    point PER SIDE (Pinnacle 1637020561: home −1.5 at +197, away +1.5 at
    −229, one snapshot). A reversed game swaps the side and KEEPS the point:
    the point belongs to the team. Swapping and negating would give each team
    the other's number. `test_scraper_bridge.py` pins the corrected rule.
  - **§8b umpires and referees:** every `mlb_umpire` / `nfl_referee` row read
    (107 / 17) is a season table (`Umpire`, `G`, `OV/UN/P`, `Runs`, …;
    `Referee`, `PTS`, `OU`, `$Home`, …). None names a matchup, so none can be
    keyed to a game and the bridge writes none. Power ratings: the pro
    leagues' rows carry full names ("Arizona Cardinals", "Wash Commanders");
    CFB's carry the school only ("Alabama", "Arizona ST", "Alabama A&M"), so
    CFB matches on the longest school prefix and refuses a prefix followed by
    a school modifier ("Texas" is not "Texas Southern Tigers").
    `vsin_opener`: `{book, period fg|1h, spread_away "-1.5 +145" | "PK -110" |
    "- -", ml_away, total}` — the away side only. `cnb_event`: `{links: {book:
    url}}`.
  - **§8 Action Network's `bet_count`** is per game, all markets, no side:
    stored as market `game`, side `all` (P10 reads it as "N tracked bets on
    this game").
  - **§6 `scraper_checks.source`** is the provider id the rows carry
    (`scraper:<source>`), so the reader's join is direct.
  - **§2 step 2:** `run_matching` took 151 s over 14 days in P3, so the bridge
    runs it as its OWN process every 5 minutes
    (`scraper_match_run.py --horizon-hours 36`, one pooled connection) and
    reloads the links when it finishes; a cycle never waits on it.
    Connections: bridge 2 + matcher 1 = 3, named `scraper_bridge*`.
  - **§3 is_main without an alt flag** is decided over the bridge's view of
    every line the book currently quotes for that (game, period, market), not
    only the batch; when the main moves, the earlier-forwarded rows whose flag
    flips are re-written.
  - **§7 prop first_seen** comes from a book's own line only: not an
    alternate rung, a yes-only ladder or an exchange contract.
  - **D25 egress meter:** counted at the TLS layer — every byte the bridge
    receives from a `*.supabase.com` host, as ciphertext — which is what
    Supabase bills. `usage_meters` `bridge.egress_bytes` / `bridge.rows_written`.
  - **P3's routed NHL item:** `load_app_games('nhl')` now merges each team's
    `api-web.nhle.com` roster (NHL API ids — the ids `player_game_history`
    already keys NHL by), cached 6 h.
