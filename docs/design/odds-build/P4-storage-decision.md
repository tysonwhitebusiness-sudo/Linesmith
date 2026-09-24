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

*(the measured table, the projections, the recommendation, D24)*
