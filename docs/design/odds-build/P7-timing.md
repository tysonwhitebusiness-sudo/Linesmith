# P7 · Timing (T0)

**Lane:** laptop (Python, line-buddy's venv) + one small Supabase table.
**Deploys:** none. **Needs:** P3 (matching). It runs on the scraper's own
history, so it can proceed beside P5–P6. Operator's green light.
**Goal:** measure, never assume, how late each source is. The results feed
the latency badges (O-A, P8), the edge freshness gate (P11), and which
sources may serve as the sharp reference.

---

## What is real time and what is not (from the data, 2026-09-24)

| source | time we can trust | how |
|---|---|---|
| Kalshi, Polymarket, BetRivers (Kambi), Underdog, Sleeper, Action Network | **per price** | `offers.source_ts_ms` (Kalshi `updated_time`, Kambi `changedDate`, `updated_at`, CLOB timestamp, AN `inserted`) |
| DraftKings, FanDuel, BetMGM, VSiN | **per poll** | the snapshot's `fetched_at` (their CDNs serve 1–30 s old copies, `cache_age_s` recorded where sent) |
| Pinnacle | **per poll minus the CDN's age** | `fetched_at − cache_age_s` (copies up to ~15 min old, D13); `depth.version` changes with every price change |
| 4codds | per price, but "changed" and "confirmed" are ambiguous | its own field, used only after this phase measures it against first-hand prices |
| theoddsgap | feed-level only | measured 43 min old at fetch once |
| comparenbet | **not real** (relay time) | never used as a price time (plan §6) |

The P6 bridge already turns these into `changed_at` (since). P7 measures how
close to reality each one is.

## Build

### 1. `python-odds-service/scraper_timing.py` (new; laptop; read-only on `scraper.db`)

```
python scraper_timing.py --days 3 [--write]
```

It reads offers of **linked** games only (P3's `bridge.db`), over the last
`--days`. It uses each row's **price time**: the P6 rule
(`source_ts_ms` → `fetched_at − Age` → `fetched_at`).

**Measure A: relay delay (same book, same price change).**
- For each first-hand book (draftkings, fanduel, betmgm, betrivers,
  pinnacle, kalshi, polymarket) take every price change on a main line.
- For each **relay source** carrying the same book (comparenbet, 4codds,
  steezanomics, oddstrader, scoresandodds, actionnetwork, theoddsgap,
  betmonitor, mbodds), find the first time the relay shows **the same new
  price** on the same (game, period, market, side, line), within 60 min
  after the first-hand change.
- `delay = t_relay − t_firsthand`.
- A relay that never shows it within 60 min counts as a miss.
- **Output per (relay source, book, sport):** n, hit rate, median, p25, p75
  and p90 delay.

**Measure B: follow lag (who moves after Pinnacle).**
- A **Pinnacle move** is:
  - a main-line change (point moves); or
  - a price change of ≥ 10 cents on the same line where the no-vig
    probability moves ≥ 1.5 points.
- For each other book (at its best-timed source: first-hand if any, else
  the relay with the lowest Measure A median), take the first change in
  the **same direction** on the same market within 60 min.
- `lag = t_book − t_pinnacle`.
- **Output per (book, sport, market group: game lines / props):** n,
  median, p25, p75, and the share of Pinnacle moves followed within 60 min.
- This is what a latency badge reads ("follows Pinnacle by ~4 min on NFL
  props").

**Measure C: sharp self-consistency.**
- For Circa via VSiN against Circa via comparenbet on the same price
  change: which arrives first, and by how much.
- For 4codds' Novig and ProphetX against nothing (no first-hand exists):
  report their price-time age at fetch (`fetched_at −` their own time) as
  the only available bound.

**Proven fast (T0.3).** A source may serve as the **sharp reference** in
E1's gates only if one of these holds:
- it is first-hand (Pinnacle, Kalshi, Polymarket); or
- it is a relay whose Measure A median delay ≤ **120 s**, with hit rate
  ≥ **90%** and n ≥ **30** for that book and sport.

  Circa via VSiN qualifies only by Measure C: its median ≤ 120 s ahead of,
  or no worse than, the other Circa copy, and its update rate, measured as
  changes per hour against Pinnacle's on the same games, is ≥ 50% of
  Pinnacle's.

Everything else is **not** a sharp reference, and says so.

### 2. `source_latency` (Supabase, Python-written, read by P8 and P11)

```sql
CREATE TABLE IF NOT EXISTS source_latency (
  sport text NOT NULL, measure text NOT NULL CHECK (measure IN ('relay_delay','follow_lag','sharp_consistency')),
  source text NOT NULL, book text NOT NULL, market_group text NOT NULL DEFAULT 'all',
  n integer NOT NULL, hit_rate double precision, median_s double precision, p25_s double precision,
  p75_s double precision, p90_s double precision, proven_fast boolean NOT NULL DEFAULT false,
  window_start timestamptz NOT NULL, window_end timestamptz NOT NULL, computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sport, measure, source, book, market_group));
ALTER TABLE source_latency ENABLE ROW LEVEL SECURITY;
CREATE POLICY source_latency_read ON source_latency FOR SELECT USING (true);
```

- `--write` upserts it through a new `db.write_source_latency(rows)`.
- The migration is additive; name it with its UTC time.
- Add a row to `docs/table-ownership.md`.

### 3. Schedule

It runs daily at 05:00 local, as part of the P6 bridge's scheduled work or
its own task `LinesmithSourceTiming` ⚑. The first run uses the history
already on the laptop (since 2026-09-22), so nothing waits.

### 3b. The paid feeds' own timestamps (T0.4)

A read-only check of what each paid feed says about **when a book's price
was set**, so the app knows which paid rows carry a real per-book time and
which only carry our fetch time.

- **Feeds:** SharpAPI (`fetch_sharpapi`, `fetch_sharpapi_game_lines`),
  Odds-API.io (`fetch_oddsapiio`), SportsGameOdds (`fetch_sportsgameodds`),
  Propline (`fetch_propline`), ParlayAPI (`fetch_parlayapi`), and the-odds-api
  (game lines). All in `python-odds-service/src/providers.py`.
- **For each feed:** take one real response per sport it serves (a fetch
  inside its normal budget, or its most recent raw payload if one is kept).
  List every field that could be a per-book or per-price time (for example
  `last_update`, `lastUpdatedAt`, `updated_at`, `timestamp`), and at what
  level it sits: response, event, market, book or price. Compare it with the
  fetch time, then record for each one:
  - is it per book;
  - does it move when that book's price moves (two fetches a few minutes
    apart on a live market);
  - is it plausible (not in the future, and not simply equal to the fetch
    time on every row).
- **SportsGameOdds `lastUpdatedAt`:** recheck its real values **after the
  monthly key reset**. On 2026-09-24 the key was capped, so this could not
  be read. Record whether it is per book and whether it moves with the
  price.
- **Output:** a table in this file's Result: feed · field · level · per-book
  (y/n) · moves with price (y/n) · median (fetch − field). A feed with a real
  per-book time is a candidate for `changed_at` in P5's writer (D23), and
  that follow-up is named in the Result. A feed without one keeps
  `changed_at` = our fetch time, which the "since" rules already treat
  conservatively.
- No write, no deploy, and the provider caps are respected (a single fetch
  per feed, through the normal cap reservation).

### 4. Edge half-life (T0.5)

The method is defined here and filled by P11's edge log:
- the **half-life** of an edge is the median time from `shown_at` to the
  first moment any gate fails (`ended_at`);
- an edge that disappears within one poll interval of appearing is counted
  as a **timing artefact**.

P13 reports both.

## Tests (these gate P11's use of the results; P8 badges read whatever exists)

| test | kind | what it proves |
|---|---|---|
| `src/test_scraper_timing.py` (new, hermetic → CI) | Python | on synthetic series: Pinnacle against itself → 0 s; a relay that repeats the first-hand change 90 s later → 90 s; a relay that never repeats it → a miss (hit rate falls); a book moving the opposite way after a Pinnacle move → not counted as following; the "Pinnacle move" thresholds (a 9-cent move ignored, a 10-cent + 1.5-pt move counted); the proven-fast rule at its boundaries (120 s, 90%, n 30) |
| live run | laptop | `scraper_timing.py --days 3 --write`: `source_latency` has a row for every (relay, book, sport) with n ≥ 1; rows with n < 30 show `proven_fast = false`; the printed table is pasted into this file's Result section |
| sanity | laptop | Pinnacle's own relay rows (4codds' Pinnacle vs Pinnacle direct) exist and show a delay consistent with 4codds' measured mean age (Pinnacle 18 min in the 2026-09-23 audit, §9.4) within a factor of 2, or the gap is explained in the Result |

**Exit criteria:**
- the hermetic tests pass;
- `source_latency` is filled;
- the proven-fast list is written into the Result and read back by a query;
- the T0.4 table (the paid feeds' timestamps) is in the Result, with SGO's
  `lastUpdatedAt` either checked or marked "waits for the key reset on
  <date>".

## Background checks (never gate)

The measure is re-computed daily. The medians stabilise as data builds, and
the numbers refine without holding anything.

## Files touched

- New: `python-odds-service/scraper_timing.py`,
  `python-odds-service/src/test_scraper_timing.py`, and a migration.
- Edited: `python-odds-service/src/db.py` (`write_source_latency`),
  `docs/table-ownership.md`, `.github/workflows/ci.yml`.

## Result

*(the relay-delay and follow-lag tables, the proven-fast list, the T0.4 paid-feed timestamp table)*

## Changelog

- **2026-09-24 — gains T0.4** (`HANDOFF-P0-P4.md` correction 5; plan §T0
  lists it, the spec had dropped it): §3b checks each paid feed's payload
  for per-book timestamps, and rechecks SportsGameOdds' `lastUpdatedAt`
  after its monthly key reset. The results go in the Result.
