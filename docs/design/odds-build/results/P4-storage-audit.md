# P4 storage audit — every option that keeps all of the scraper's data (2026-09-25)

Every number below is **measured**, and its source is named. Where
something is **not measured yet**, it says so.

**Rules applied to every option:**
- **Nothing useful is dropped.** No source, book, sport, in-game change or
  day of history is removed from what the app can show.
- **Real fixes only.** Each option works unchanged once the web app is
  hosted (it is not hosted today; audit plan phase 8.2 puts it on Vercel or
  Render).

---

## 1. The facts

### What Supabase charges (Supabase docs, read 2026-09-25)

| | Pro plan |
|---|---|
| Database disk | **8 GB included**, then **$0.125 per GB per month** (gp3). 8 GB is the *included* amount, not a hard limit. |
| Storage (files, e.g. Parquet) | **100 GB included**, then $0.021 per GB per month |

### What the database holds now (live, `pg_total_relation_size`)

**Total: 5.49 GB.** The largest tables:

| table | size | what it is | bounded? |
|---|---|---|---|
| `prop_odds_history` | **2.41 GB** (7.0M rows, **345 B/row**) | paid-feed prop price history | yes, 10 days (`prune_corpus`); 0.53–0.77M rows/day written 09-17…09-24 |
| `player_game_history` | 0.48 GB | player game logs since 2023 | grows with the seasons |
| `prop_odds` | 0.40 GB (0.28 GB of it index) | current prop prices | yes, 7 days |
| `prop_odds_archive` | 0.34 GB | archived prop odds | not checked yet |
| `golf_shot_events` | 0.24 GB | golf shots | seasonal |
| `snapshot_cache` | 0.20 GB | cached payloads | partly (MLB raw 3 days, injuries 2 days) |
| `player_history_summary` + `_prefix` | 0.37 GB | derived, rebuildable | rebuilt |
| `game_odds_history` | 0.12 GB (211 B/row) | game-line history | **never pruned**; ~25k rows/day |
| 30 smaller tables | ~0.93 GB | | |

Storage (the corpus bucket) holds **0.43 GB** of its 100 GB.

### What the scraper produces a day
Source: `p4-volume-2026-09-24.json`. It covers 09-24 00:00–22:30 UTC, all
29 sources, 18.94 collecting hours scaled to 24, and reconciles exactly with
the scraper's own `offers` table (8,589,541 rows).

| class | rows/day | what it is | information it carries |
|---|---|---|---|
| **First-hand prices** | 0.94M | Pinnacle, Circa/Nevada (VSiN), DraftKings, FanDuel, BetMGM, BetRivers, Kalshi, Polymarket, Sleeper, Underdog, read from the book itself | the price, when it changed |
| **Second-hand books, one copy** | 2.07M | books we can only get through an aggregator (bet365, Caesars, Fanatics, Hard Rock, offshore, international), from the aggregator carrying most of each | the only copy of those books' prices |
| **Extra copies of second-hand books** | 0.59M | the same bet365/Caesars/… price via a 2nd–6th aggregator | whether the aggregators agree, and how fast each one is |
| **Second-hand copies of first-hand books** | 4.50M | e.g. DraftKings' price arriving again via comparenbet | the same price again; how late the aggregator is (P7 timing) |
| **All matched rows above (option "everything")** | **8.10M** | | |
| Flaps (A→B→A inside 10 min) | 1.32M | a price bouncing and returning | already counted by the scraper; the returning row repeats a price we hold |
| Non-price rows | 0.74M | consensus, openers, fair lines, unidentified book codes | openers go to `market_openers` (P5); the rest is kept on the laptop |
| Unmatched rows | 0.73M | games/players/markets not linked yet | kept in `scraper_unmatched_prices` (P6) |

Of the 8.10M, props are 3.16M and game lines 4.94M. In-game changes are
0.23M/day of the one-copy-per-book set.

### What a row costs (measured)

| format | bytes per price change | source |
|---|---|---|
| today's `prop_odds_history` (text ids) | **345** | live table |
| **compact history table** (integer-coded ids, both times) | **117** (77 heap + 41 index) | 1M-row temporary table in Supabase, 2026-09-25, dropped after |
| Parquet (the scraper's archive; the corpus format) | **7.1** | 28,072,139 offer rows = 200.5 MB (scraper `archive_manifest`) |

"Everything" is 8.10M rows/day: **2.79 GB/day** in today's format, **0.95
GB/day** compact, **58 MB/day** as Parquet.

### Not measured yet (each is measured in P6 before it goes live)
- Supabase write throughput at 8.1M rows/day (94 rows/s on average; today's
  writers do about 8/s).
- Read speed of a line-movement chart served from Parquet in Storage.
- The size of a compact *current-state* table. Figures below use today's
  measured 0.51 GB current-state cost, which is an upper bound.

---

## 2. The options

Every option keeps every row somewhere:
- the scraper's own database on the laptop, plus its Parquet archive;
- the daily off-machine backup in Storage (P0).

The options differ only in **what the hosted app can read, and for how
long**.

### Option 1 — Everything in the database, compact rows, grow the disk
- **In simple terms:** all 8.10M matched changes a day go into Supabase in
  the compact format and stay readable for 10 days. After 10 days they move
  to the compressed corpus in Storage, as `prop_odds_history` does today.
- **What the app can show:** every price change from every source for 10
  days, every copy of every book, in-game included.
- **Thrown away:** nothing. **Hidden from the app:** changes older than
  10 days (they are in the corpus; the app cannot read the corpus today).
- **Size:** 5.49 + 9.49 (10 days) + 0.51 = **15.5 GB → 7.5 GB over the
  included 8 → about $0.94/month.**
- **Work:** compact history tables in P5; the bridge in P6.

### Option 1+ — Option 1, and move today's prop history to the compact format too
- **In simple terms:** the same as Option 1, and `prop_odds_history`
  (2.41 GB at 345 B/row) is rewritten compact (7.0M × 117 B = 0.82 GB).
- **Thrown away:** nothing.
- **Size:** **13.9 GB → 5.9 GB over → about $0.74/month.**
- **Work:** as Option 1, plus a migration of the existing table and its
  readers.

### Option 2 — Stay inside 8 GB, everything readable: recent in the database, all history in Storage
- **In simple terms:**
  - the database holds current prices plus the last 1–3 days of changes,
    compact;
  - **every** change is also written as Parquet to Storage (58 MB/day);
  - the app reads older history from Storage through a read route. That
    works on a hosted app, because Storage is in the cloud.
- **What the app can show:** everything, for as long as it is kept. Storage
  holds about 4.5 years of this before passing 100 GB.
- **Thrown away:** nothing.
- **Size in the database** (with Option 1+'s rewrite of `prop_odds_history`,
  base 3.90 GB):
  - 3 days hot → 3.90 + 2.85 + 0.51 = **7.3 GB**;
  - 2 days hot → **6.3 GB**.

  Without the rewrite (base 5.49 GB), 1 day hot → **7.0 GB**.
- **Cost:** $0 (inside both quotas).
- **Work:** Option 1's tables, plus an hourly Parquet writer and a
  history-read route. Chart reads from Storage are **not measured yet**.

### Option 3 — Option 2's Storage history, with the database hot window sized by cost instead
- **In simple terms:** the same as Option 2, but pay for as many hot days
  as you want (each extra day of everything costs about 0.95 GB, i.e.
  **about $0.12/month per day of window**).
- **Thrown away:** nothing.

### Rejected
- **The app reads the laptop directly:** it works only while the app runs
  on this machine, and breaks when it is hosted. A band-aid.
- **Dropping sources, books, in-game changes or relay copies (the first
  P4 draft's A–F):** each loses data from the app. Rejected under D14.

---

## 3. What decides between them
- **Is paying for disk acceptable?**
  - Options 1 and 1+ cost well under $1/month at today's volume.
  - Option 2 costs nothing and keeps everything, but needs a Parquet reader
    for history older than the hot window, and its chart speed is not
    measured yet.
- **The load, for either:** writing 8.1M rows/day is about 12× today's write
  rate. P6's replay test measures it against Supabase before the bridge
  goes live. If it is too much for the compute size, that is a compute
  decision, and no data is dropped.
