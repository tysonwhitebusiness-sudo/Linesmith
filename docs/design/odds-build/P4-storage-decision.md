# P4 · Storage decision (L0) ⚑

**Lane:** a measurement on the laptop, then **the operator's decision**.
**Deploys:** none. **Needs:** P3 (only matched rows can be counted), the
operator's green light.
**Goal:** measure what the bridge would write to Supabase under each
option, put the options in front of the operator with their cost, and
record the choice as a numbered decision that P5 and P6 enforce.
**Audit finding covered:** F2. **The laptop keeps every row whatever is
chosen (D14);** this decides only what the app can read.

---

## The numbers this starts from (measured 2026-09-24)

| | |
|---|---|
| Supabase database | 5.2 GB of 8 GB (65%) |
| `prop_odds_history` | 2.40 GB, 8.44M rows, **285 bytes/row** all-in (heap + indexes), 10-day window (`prune_corpus.KEEP_RECENT_DAYS`) |
| `game_odds_history` | 115 MB, 536k rows, **215 bytes/row**, never pruned (routed finding 4) |
| `prop_odds` (current state) | 403 MB, 598k rows, 674 bytes/row |
| Current history intake | ~0.6M prop rows/day (Sep 22–24: 635k, 763k, 632k) |
| Scraper output | ~7M offer changes/day (1.77M in 6 h), all sources, all sports, flaps and live included |

## Build

### 1. `python-odds-service/scraper_volume_measure.py` (new, read-only)

```
python scraper_volume_measure.py --days 2 [--out docs/design/odds-build/results/p4-volume-<date>.json]
```

It reads `scraper.db` read-only and `bridge.db` (P3's links), over the
last `--days` complete UTC days. For every **offer row** (the scraper writes
one row per change), it classifies the row on four independent axes:

1. **Price:** `bridgeable_book(book_key)` (P2). A non-price row (fair,
   consensus, opener line, unidentified code, no book) is counted as
   `non-price` and nothing else.
2. **Matched:**
   - a game offer counts if its event's `game_key` has a `game_links` row
     and `game_market(market)` parses;
   - a prop offer counts if its game is linked, its player has a
     `player_links` row, and `prop_market_key(source, stat, position)`
     returns a key.
   - Otherwise it is `unmatched`, split by reason: game, player, market,
     no-app-sport.
3. **Flap:** the row returns its key to the value it held before the
   previous change, within `FLAP_WINDOW_SECONDS` (600 s, the scraper's
   rule). Flaps are what the bridge filters (B3), and they are counted and
   excluded from "would write".
4. **Time:** pre-game if the snapshot's `fetched_at` < the app game's start
   (`game_links.app_start`), else in-game.

It also counts per **source class**:
- **first-hand:** pinnacle, kalshi, polymarket, draftkings, fanduel, betmgm,
  betrivers, sleeper, underdog, vsin;
- **relay-duplicate:** an aggregator row for a book that has a first-hand
  source, which is the same price arriving again (e.g. DraftKings via
  comparenbet);
- **relay-only:** an aggregator row for a book with no first-hand source,
  e.g. Fanatics, Caesars, Hard Rock or bet365 via Action Network,
  Offshore and International via comparenbet.

**Outputs:**
- rows/day per cell of (class × pre/in-game) for matched, de-flapped
  prices, split props vs game lines;
- **distinct current keys**, which drive `prop_odds` and game-line
  current-state size;
- per-sport totals;
- **a projection for each option below**:

  ```
  GB at 10 days = rows/day × 10 × bytes/row
  ```

  using 285 B for prop history, 215 B for game-line history (re-measured
  from `pg_total_relation_size / reltuples` at run time), and 674 B for
  current-state rows. It is added to today's 5.2 GB **minus** today's
  prop_odds_history (which the window already bounds). It also reports the
  days until 8 GB at that rate.

### 2. The options it projects

| option | what reaches Supabase | what the app loses |
|---|---|---|
| **A** All matched | every matched, de-flapped price change, all classes, pre + in-game | nothing |
| **B** One copy per book | first-hand + relay-only; **relay-duplicate rows stay on the laptop** | nothing a page shows: the duplicate is the same book's price arriving later and staler. T0 (P7) uses the laptop copy |
| **C** B + shorter relay window | as B, but relay-only history keeps 3 days in Supabase (first-hand keeps 10) | movement charts for relay-only books reach back 3 days, not 10 (the app cannot read the corpus) |
| **D** B, pre-game only | as B, with in-game changes on the laptop only | in-game movement for scraper books (in-game main lines still come from the paid feeds) |
| **E** B + in-game for sharp only | as B; in-game kept only for Pinnacle and the exchanges | in-game movement for soft scraper books |
| **Disk** Grow the database | any of the above, with Supabase disk growth past 8 GB | nothing: cost instead (the operator checks the plan's price for the GB the projection needs) |

The measurement prints each option's rows/day, 10-day GB, the resulting
database size and the headroom left.

### 3. Present and record ⚑

The builder writes the results into this file's **Result** section:
- the table;
- per-sport notes;
- the **builder's recommendation, with its reason**.

The operator chooses. The choice is recorded as **D24** in
`scraper-bridge-and-edge-gameplan-2026-09-23.md` §1, in this form:

> "Bridge storage policy: option X. What reaches Supabase: …; what stays on
> the laptop: …; hot windows: …"

P5 reads D24 for the retention rules, and P6's bridge enforces it (a policy
object, see P6).

**Rules the choice must respect** (from D14):
- nothing is deleted from the laptop;
- anything kept out of Supabase is named in D24;
- a hot window shorter than 10 days needs its rows moved to the corpus
  (the existing `prune_corpus` path), never deleted.

## Tests (these gate P5)

| test | kind | what it proves |
|---|---|---|
| `src/test_scraper_volume.py` (new, hermetic → CI step) | Python | on a synthetic offer list: a flap (A→B→A in 300 s) is excluded, A→B→A in 900 s is not; relay-duplicate vs relay-only classification from a fixture book set; pre/in-game split at the start time; the class counts add up to the total |
| reconciliation | laptop | the measure's per-source row totals equal `SELECT source, count(*) FROM offers` over the same snapshot range |
| **decision recorded** | docs | D24 is in the master plan and names the option, what stays on the laptop, and the windows |

**Exit criteria:** the tests above pass and D24 is written.

## Background checks

None. Actual growth is watched in P6's two-day soak against this
projection.

## Result

> **Superseded 2026-09-25 by `results/P4-storage-audit.md`.** The A–F
> options and the recommendation below each dropped data from the app
> (sources, relay copies, in-game changes or history days), which D14
> forbids. The audit lists only options that keep everything, with measured
> costs. The volume measurements below stand.

**Measured 2026-09-24 23:55 UTC. Waiting on the operator's D24.**
Raw output: `results/p4-volume-2026-09-24.json`.

**Window.** 2026-09-24 00:00–22:30 UTC: 18.94 collecting hours after the
17:38–20:54 freeze and the three restarts are excluded, normalised to 24 h.
- *Deviation from "the last 2 complete days":* 09-22 started at 06:37 with
  a few sources, and 09-23 predates R2–R5. Only 09-24 has all 29 sources,
  so earlier days would under-state the volume by a wide margin.
- **Reconciled:** the classes sum to 8,589,541 offer rows, equal per source
  to `SELECT source, count(*) FROM offers` over the same snapshots.
- It is one day: a Thursday carrying the NFL and CFB weekend boards and
  MLB's last week. Treat it as a typical in-season day, not a peak.
- *Matched:* rows of games P3 could link are `strict`. Rows of covered-league
  games outside the app's current horizon are `estimated`, at P3's measured
  link rates, and are about 8% of the matched rows.

**Live database:** 5.49 GB of 8 GB (it was 5.2 in the spec).
`prop_odds_history` is **345 B/row** (the spec assumed 285),
`game_odds_history` 211 B/row, `prop_odds` 690 B/row.

**What the scraper produces a day** (rows = price changes):

| | rows/day |
|---|---|
| all offer rows | 10.88M |
| flaps (excluded) | 1.32M |
| non-price (fair, consensus, openers, unidentified books) | 0.74M |
| leagues the app does not cover / no canonical game | 0.37M |
| unmatched player / market, plus estimated rows that would not link | 0.36M |
| **matched, de-flapped (option A)** | **8.10M** (3.16M props + 4.94M game lines) |

- **By sport (matched):** CFB 2.86M, NFL 2.51M, MLB 1.36M, MLS 1.19M,
  NHL 0.10M, NBA 0.03M, EPL/tennis < 0.02M each.
- **By class:** relay-duplicates (a first-hand book arriving again through
  an aggregator) are **4.5M/day, more than half**. First-hand is 0.94M.
  Relay-only books are 2.66M.
- 31 of the 80 relay-only books arrive through 2–6 relays. The largest:
  bet365 game lines 323k/day via 4 relays, Caesars 153k via 6, Hard Rock,
  Bovada, Novig, Fanatics, Fliff.

**The options: 10-day history window, added to today's 5.49 GB**

| option | rows/day | 10-day history | + current state | DB after | vs 8 GB |
|---|---|---|---|---|---|
| **A** all matched | 8.10M | 21.3 GB | 0.51 | 27.3 GB | **−19.3** (full in < 1 day) |
| **B** one copy per book (drop relay-duplicates) | 3.60M | 9.5 GB | 0.36 | 15.4 GB | −7.4 (full in 2.3 days) |
| **B1** B + only ONE relay per relay-only book *(measured variant)* | 3.01M | 8.1 GB | 0.36 | 14.0 GB | −6.0 |
| **C** B, relay-only history 3 days | 3.60M | 4.7 GB | 0.36 | 10.5 GB | −2.5 |
| **D** B, pre-game only | 3.37M | 8.9 GB | 0.36 | 14.8 GB | −6.8 |
| **E** B, in-game only for sharp | 3.41M | 9.1 GB | 0.36 | 14.9 GB | −6.9 |
| **F** first-hand only *(measured variant)* | 0.94M | 2.6 GB | 0.36 | 8.4 GB | −0.4 |

**What this means:** at a 10-day window, **no option fits in 8 GB**. Even
first-hand only is 0.4 GB over. In-game changes are small (D and E save
only 6%). The two levers that matter are how many copies of a relayed book
are stored, and how long relay history stays hot. The database also grows
by itself outside the bridge (about 1.2 GB/week per the 2026-09 notes), so
a plan that lands at 7.9 GB is not a fit either.

**Builder's recommendation: B1 + grow the disk, with relay history hot for
3 days.**
- **What reaches Supabase:**
  - every first-hand price change (Pinnacle, Circa and the Nevada books via
    VSiN, DraftKings, FanDuel, BetMGM, BetRivers, Kalshi, Polymarket,
    Sleeper, Underdog);
  - and, for each book we cannot read first-hand (bet365, Caesars,
    Fanatics, Hard Rock, the offshore and international books), **one**
    relay copy: the relay that carries most of that book.
- **What stays on the laptop:**
  - relay-duplicates of first-hand books;
  - the second to sixth relays of a relay-only book;
  - flaps, non-price rows, unmatched rows beyond the P6 unmatched table's
    budget.

  All of it is kept, never deleted (D14), and P7 uses it for timing.
- **Hot windows:** first-hand 10 days; relay 3 days. Older relay rows move
  to the corpus through `prune_corpus`, never deleted.
- **Size:** about 0.26 GB/day first-hand + 0.55 GB/day relay →
  2.6 + 1.7 + 0.36 ≈ **4.6 GB** → a **~10.1 GB** database. So the disk has
  to grow: set it to **16 GB**, which leaves room for the other ~1.2
  GB/week of growth until the old-table cleanups land.
- **Why this one:**
  - the books US bettors use most (bet365, Caesars, Fanatics, Hard Rock)
    only arrive relayed, so the pages need them;
  - one copy per book is all a page can show anyway (F6 picks one);
  - 3 days covers every default chart window (2 h–48 h). Only "Since
    open" on a relay book reaches back further, and there it loses detail.
- **Cost:** extra disk on the paid plan is billed per GB-month. The
  operator checks the price on the billing page for +8 GB. It is small next
  to the paid feeds. Disk growth is one-way on Supabase (it can grow, not
  shrink back).
- **If the disk may not grow:** first-hand only (F) with a **5-day** window
  (≈ 1.3 + 0.36 → 7.1 GB) is the only fit with headroom, and it drops every
  relay-only book from the app. Not recommended: bet365, Caesars, Fanatics
  and Hard Rock would vanish from the pages.
- **Worth doing either way (P6 follow-ups):**
  - `game_odds_history` is never pruned (routed finding 4). It is small
    today (0.12 GB) but gets the same window rule;
  - the paid-feed overlap check (about 2 weeks into P6) may show paid rows
    the scraper duplicates, which frees room.

**D24 is the operator's.** When chosen, it is written into
`scraper-bridge-and-edge-gameplan-2026-09-23.md` §1 in the form above, and
P5/P6 read it. Nothing downstream starts before it.

**Tests:**
- `src/test_scraper_volume.py` (a CI step): flaps at 300 s vs 900 s, the
  relay classes, the pre/in split, and the classes adding up on a fixture
  DB;
- reconciliation against `offers`: exact.
- A first version used a per-row correlated lookup and took over an hour;
  it was replaced by one indexed join (the day now measures in 5.5 min).
