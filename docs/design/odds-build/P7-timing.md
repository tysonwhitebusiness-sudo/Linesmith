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

**Built 2026-09-25.** `scraper_timing.py` (+ `src/test_scraper_timing.py`,
hermetic, in CI), migration `20260925064500_source_latency.sql` (applied by
hand after a `BEGIN … ROLLBACK` dry run; RLS on, one read policy),
`db.write_source_latency`. The daily run is the P6 bridge's own scheduled
work: `scraper_bridge_run.py` starts `scraper_timing.py --days 3 --write`
once a day after 05:00 local, never beside the matcher (bridge 2 + one helper
1 = the 3-connection budget) — so no `LinesmithSourceTiming` task.

**First run: 2026-09-22 06:12 → 09-25 06:12 UTC, 313 linked games, 1,133 s,
417 rows written to `source_latency`.** The whole printed table is
`results/P7-source-latency-2026-09-25.txt`. Scope as built: GAME LINES.
Pinnacle quotes almost no props in scraper.db (22 prop rows of 744 in a
measured hour), so a props follow lag has nothing to follow.

**A — relay delay (the best row per relay, n ≥ 30):**

| relay | best case | n | hit rate | median |
|---|---|---|---|---|
| actionnetwork | MLB BetRivers | 2,209 | 27% | 49 s |
| 4codds | MLB BetRivers | 968 | 5% | 50 s |
| theoddsgap | soccer Pinnacle | 219 | 70% | 43 s |
| scoresandodds | MLB DraftKings | 2,982 | 24% | 175 s |
| comparenbet | CFB BetMGM | 1,028 | 39% | 301 s |
| comparenbet | MLB Pinnacle | 883 | 93% | 493 s |
| mbodds | MLB BetRivers | 445 | 1% | 809 s |

What it says: every relay is LATE (minutes, typically 2–30), and most MISS
most first-hand changes outright — a relay polls less often than a book
changes, so an intermediate price never appears. comparenbet is the most
reliable copy (≥ 90% for MLB Pinnacle) but ~8 min behind. Kalshi via
comparenbet/theoddsgap: ~0% — the relays quote different contracts than the
first-hand ladder rows.

**B — follow lag (Pinnacle moves; first-hand books):** MLB: DraftKings
follows 67% of Pinnacle's moves within 60 min, median 386 s; BetMGM 43%, 447 s;
BetRivers 30%, 738 s; FanDuel 19%, 503 s. CFB: DraftKings 28% / 662 s,
FanDuel 23% / 647 s, Polymarket 41% / 690 s. NFL: 7 Pinnacle moves in the
window (Thursday only) — too few to read. Kalshi almost never follows a
Pinnacle point move (its markets are fixed-line contracts).

**C — sharp self-consistency:** Circa via VSiN arrives **before** Circa via
comparenbet (median −207 s CFB, −262 s MLB, −237 s NFL: VSiN first by ~4 min),
but Circa's main line changes at only **5–9% of Pinnacle's rate** on the same
games (CFB 0.05, MLB 0.09, NFL 0.08) — far below the 50% the rule needs. 4codds'
Novig age at fetch: median 59 s MLB, 650 s NFL, 932 s CFB; ProphetX 41 s MLB,
656 s NFL, 3,356 s CFB.

**Proven fast (T0.3), read back from `source_latency` by query:** Pinnacle,
Kalshi and Polymarket, first-hand, in every sport they quote (CFB, MLB, NFL,
soccer; NHL Polymarket). **No relay qualifies** (none reaches 90% hit rate
with a median ≤ 120 s), and **Circa via VSiN does not** (rate ratio ≤ 0.09).
Every row with n < 30 is `proven_fast = false` (query: 0 exceptions).

**Sanity (4codds' Pinnacle vs Pinnacle direct):** median relay delay 347 s
MLB, 405 s NFL, 1,810 s CFB, 2,220 s soccer, against 4codds' measured mean age
of 18 min (1,080 s, 2026-09-23 audit). CFB and soccer sit inside a factor of 2;
MLB and NFL are faster than that. The gap is expected rather than a fault:
the audit measured a MEAN age of all 4codds rows, this measures the MEDIAN
delay of the changes 4codds actually repeated — and it repeated only 8% of
MLB/NFL Pinnacle changes, the ones it happened to catch soon after.

**T0.4 — the paid feeds' own timestamps** (`paid_feed_timestamps.py`; one
fetch per feed and sport through the normal throttle + cap reservation, the
price writers stubbed out; 2026-09-25 ~07:20 UTC):

| feed | field | level | per book | median (fetch − field) | reads as |
|---|---|---|---|---|---|
| Propline | `outcomes[].last_change_at` | price | yes (28–40 books) | MLB 7,795 s · NFL 19,834 s | **the price's change time** — a real "since" |
| Propline | `outcomes[].last_seen_at` | price | yes | MLB 34 s · NFL 227 s | "checked" |
| Propline | `outcomes[].book_updated_at` | price | yes (16–31 books) | MLB 1,069 s · NFL 4,932 s | the book's own update time, where given |
| Propline | `markets[].last_update`, `bookmakers[].last_update` | market / book | yes | ~35–225 s | refresh times |
| SharpAPI | `data[].timestamp` | row (per sportsbook) | yes | 16 s (min 5.6) | its collection time, not the book's change time |
| SharpAPI | `updated_at` | response | no | ≈ fetch | the response time |
| ParlayAPI | — | — | — | — | not read: "credit limit reached this billing period" (NFL); MLB throttled |
| Odds-API.io | — | — | — | — | not read: the throttle floor (the worker fetched it 36 min before) |
| SportsGameOdds | `lastUpdatedAt` | — | — | — | **waits for the key reset**: every pooled key at its monthly cap (2,000) |
| the-odds-api | `last_update` | — | — | — | not read: `odds_cache` keeps its payload PARSED (no time fields); a raw fetch is needed |

None of the fields sits in the future. "Moves with the price" is NOT yet
measured: the evidence is only that Propline's `last_change_at` and
`last_seen_at` are separate fields whose medians differ by hours. The
two-fetches-minutes-apart check the spec asks for is blocked by each
provider's throttle floor within one run.
**Follow-up (D23):** Propline's `last_change_at` → `PropOddsInput.changed_at`
and `last_seen_at` → `observed_at` in `fetch_propline` — a worker change for
the next deploy. Re-run this script after the SGO reset and when ParlayAPI's
credits renew.

**T0.5 edge half-life:** the method is as above; it is filled by P11's edge
log and reported by P13.

## Changelog

- **2026-09-24 — gains T0.4** (`HANDOFF-P0-P4.md` correction 5; plan §T0
  lists it, the spec had dropped it): §3b checks each paid feed's payload
  for per-book timestamps, and rechecks SportsGameOdds' `lastUpdatedAt`
  after its monthly key reset. The results go in the Result.
