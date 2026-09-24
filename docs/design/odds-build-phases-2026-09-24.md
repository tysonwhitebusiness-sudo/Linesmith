# Odds workstream — re-audit and build phases (2026-09-24)

The end-to-end re-audit of `scraper-bridge-and-edge-gameplan-2026-09-23.md`
(the master plan) and `odds-section-rebuild-gameplan-2026-09-24.md` (Track O),
checked against the code, the live database and the scraper. It was done
after the Track O mockups were approved (D17) and it replaces the master
plan's §3 lane list as the build order. **Every phase still needs the
operator's go**; decisions are marked ⚑.

---

## 1. What the audit found

Each finding was measured today, not inferred. The phase that fixes it is in
brackets.

### Blocking: the plans assumed something the system does not do

| # | finding | evidence | fix |
|---|---|---|---|
| F1 | **The scraper has been stalled since 17:38 UTC.** The collector loop hung while the web server kept answering, so `/api/status` says `running: true`, `last_poll_at` 17:38, 28 writes pending and 39 fetches in flight; nothing is being collected. The watchdog restarts it only when :8000 stops listening, so it never fired. | status endpoint 19:16 UTC; no error in `server.err.log` | **P0** |
| F2 | **Storage cannot take the scraper as planned.** The scraper wrote **1.77M offer changes in 6 h (~7M/day)**: comparenbet 605k, Action Network 348k, Polymarket 125k, theoddsgap 122k, Kalshi 119k, … Supabase history takes **~0.6M rows/day** today (Sep 22–24) and the DB is **5.2 GB of 8 GB (65%)**; `prop_odds_history` is 2.29 GB for 8.4M rows (~270 bytes a row with indexes). At that size, 1M extra rows a day in a 10-day window is ~2.7 GB, which fills the database. So L0 is not a formality: it decides the bridge's design. | live `pg_database_size`, per-day counts, scraper `offers` by source | **P4** ⚑ |
| F3 | **The writers stamp write time, and hold one time per price.** `write_prop_odds` sets `observed_at = now()` for the whole batch, and `prop_odds` has one `fetched_at`. B4's "forward each change with the scraper's own time" and D23's two times (checked + since) both need a schema change and a writer change that no phase budgeted. | `db.py:561, 639`; `prop_odds` columns | **P5** |
| F4 | **Game-line storage is narrower than the approved design.** `game_odds_book_lines` is unique on (sport, game, market, side, book, source) — **no point** (one line per book) and **no period** — and `gobl_market_valid` allows only moneyline/total/spread. The game page's period tabs (1H, 1Q, F5), team totals and the alternate-line ladder have nowhere to live. | migration `20260825150000`, `20260829090000` | **P5** |
| F5 | **Live bug: game-line history misses line moves.** `write_game_odds_history` logs only when `american_odds` changes; the key has no point, so −4.5 −110 → −5.5 −110 is never recorded. Every game-line movement chart is missing pure line moves today (D14). | `db.py:1997` | **P1** |
| F6 | **Relayed copies can beat first-hand prices on the page.** `lastPreGameQuotes` (`mainLine.ts:124`) resolves one book from two providers as "the later `fetched_at` wins". Once the scraper writes DraftKings direct AND DraftKings-via-comparenbet (which re-confirms prices that are hours old), a stale relay can be shown as the price. Edge gate 7 covers the edge only; the display needs the same rule. | code read | **P5** (reader rule) |

### Gaps: a piece the approved design needs that no phase built

| # | finding | fix |
|---|---|---|
| F7 | **No kill switch or flag mechanism exists** (gate 11 says "off without a redeploy"). Needs a small flags table read cache-first by TypeScript and Python, with a declared owner. | **P11** |
| F8 | **The live refresh has no fresh endpoint.** The player pages' prices come through `candidates` routes cached for **6 h**. O5's 30–60 s refresh needs a direct-read route (CLAUDE.md pattern 2, like `/api/props/lines`), not `cachedRoute`. | **P9** |
| F9 | **New tables need RLS and a row in `docs/table-ownership.md`** each: splits, volume/depth, openers, pulls, edge log, flags, the widened game lines. The audit found RLS gaps before; recent migrations enable it, so follow them. | **P5 / P11** |
| F10 | **The bridge needs a heartbeat that `health_check` reads.** The template exists: `check_harvester_scrapes()` (`health_check.py:951`) already watches the laptop's OddsHarvester, and was written after that job hid a ten-day outage. Reuse it; do not invent a second pattern. | **P6** |
| F11 | **Edge coverage for props will be thin at first.** Gate 1 wants Pinnacle plus a second sharp source for props. Kalshi and Polymarket are first-hand; Novig and ProphetX arrive only relayed (4codds / comparenbet), so they count only on their "since" time. E1 must report how many markets reach gate 1, per sport, so thin coverage is visible, not silent. | **P11** |
| F12 | **Steam and first-mover detection run in TypeScript at read time** (`lib/slate/marketMoves.ts`). At minute resolution, with ~20 books, decide in O4 whether that stays a read-time computation or becomes a Python job writing a table (Python writes, TypeScript renders). | **P8 (O4)** ⚑ small |
| F13 | **Connection budget.** The pooler caps client connections at 15; 29 sessions were open at measurement, including internal ones. The bridge's pool must be small (1–2) and must not hold a transaction across a slow batch (the reason `write_game_odds_book_lines` was re-batched). | **P6** |
| F14 | **O0's bug is still live**: `PlayerDetail.tsx:1716` shows "No game line yet" when `todays.moneyline` is empty. | **P1** |

### Corrections to the plans (wrong paths, stale lines)

- `lib/odds/lineHistory.ts` → `lib/odds/props/lineHistory.ts`;
  `lib/odds/marketMoves.ts` → `lib/slate/marketMoves.ts`;
  `odds_math.py` → `python-odds-service/src/predict/odds_math.py`;
  `prune_corpus.py` → `python-odds-service/prune_corpus.py`.
- `_MAX_PAIR_SKEW_SECONDS` is in `predict/price_resolution.py:107` (30 min) —
  confirmed; E1 replaces it.
- Gate 6's "every de-vig method" = four that exist: `devig_two_way`
  (multiplicative), `devig_power`, `devig_shin`, `devig_worst_case`.
- DB headroom: the memory note's 79% is stale; measured 65% today.

### Confirmed as the plans say

- Readers do not filter by provider, so a third writer's books appear with
  no page change (subject to F6).
- `write_prop_odds` step 4 deletes a pulled rung from `prop_odds` and writes
  nothing to history (G8), exactly as described.
- `tests/scan-no-edge.test.ts`, `tests/slate-shell.test.ts`, `tests/ui-scope.ts`,
  `tests/config-drift.test.ts` and both alias maps exist where the plans say.

---

## 2. The build phases, in order

### The time rule (operator, 2026-09-24)

**No phase waits on elapsed time.** A test that needs time to pass (a two-day
soak, a two-week measurement, a gate review at day 3–5) is started at the end
of its phase and runs **in the background** while the next phase is built.
Its result is reviewed when it lands, and anything it finds is fixed in place.
The next phase starts as soon as the current phase's **build tests** pass.

Each phase below lists:
- **Build**: what gets built.
- **Tests (gate the next phase)**: automated tests plus live checks, all runnable
  the same day.
- **Background checks (never gate)**: the timed ones.

The order follows three rules: keep the data flowing first, write nothing new
to Supabase before the storage decision, and build UI that has something to
render. After P1 there are two lanes: data (P2–P7, P10, P11) and UI (P8).

**Standing checks on every phase that touches the app:**
- `npx tsc --noEmit`;
- the full test suite;
- `npm run build`;
- render at 1440 and 400 in a fresh tab on every sport it touches;
- the kit guards (`tests/ui-*`).

Every Python change runs its own tests. Every Render deploy needs the
operator's go and gets recorded in `docs/CURRENT.md`.

---

### P0 · Keep the data flowing *(laptop)*

**Build**
1. The operator restarts the stalled scraper (F1).
2. Find why the collector hung at 17:38 UTC with 28 writes pending, and fix
   the cause.
3. The watchdog checks **`last_poll_at` freshness**, not just whether :8000
   answers. It restarts a stalled collector and logs why.
4. **S3**: a daily backup of the laptop Parquet history to Supabase Storage.

**Tests (gate P1)**
- Watchdog unit test: port up + `last_poll_at` older than the limit → treated
  as stalled; port up + fresh → left alone; port down → restarted.
- Stall test: freeze the collector in a test run → the watchdog restarts it
  within the limit, and it is polling again afterwards.
- The hang is reproduced in a test (or its cause is shown in the logs), and
  it no longer happens with the fix.
- Backup: one day uploaded, downloaded back, then byte-compared and
  row-counted against the original.

**Background checks (never gate):** 48 h with no stall longer than the
watchdog limit; the daily backup lands each day.

---

### P1 · Fix what is broken *(TypeScript + Python, one Render deploy ⚑)*

**Build**
- O0: the player page's "No game line yet" when a line exists
  (`PlayerDetail.tsx:1716`); raw market keys; book names (`parx parx`,
  casing); a best price without a book.
- F5: game-line history logs a point change even when the price did not move.

**Tests (gate P2)**
- For each sport: a player whose game has lines shows them on the player page
  (a test of the data path, plus a render check).
- No raw market key reaches a rendered label (a guard over the label
  function).
- No duplicate book display names; every best price has a book.
- `write_game_odds_history` unit tests: point moves at the same price → logged;
  price moves → logged; both unchanged → not logged; the `id DESC` tie rule
  still holds.
- After the deploy, a live spread move appears in `game_odds_history`.

**Background checks:** none.

---

### P2 · Names: labels and book registry (B0) *(Python + TypeScript)*

**Build**
- The market label map, seeded from `STAT_MAP` and extended to every sport
  and market the scraper stores, in both alias maps.
- One book registry: key, display name, group (D18), order, logo domain.
- Pages read display names from the registry.

**Tests (gate P3)**
- `tests/config-drift.test.ts`: the two maps are identical.
- A coverage script over the scraper's live rows: ≥ ~90% map both market and
  book. The unmapped remainder is listed.
- Every registry book has a group, display name and order; two different
  books never share a display name.
- A render check: book names and market labels on the player, game and Slate
  pages come from the registry.

**Background checks:** none.

---

### P3 · Matching: games and players (B1, B2) *(laptop)*

**Build**
- Scraper games → Linesmith game ids, using comparenbet team ids and logos
  as extra keys.
- Scraper players → ESPN athlete ids through the roster index.

**Tests (gate P4)**
- A match-rate report per sport, for games and for players.
- A hand-checked sample of 50 per sport: **zero wrong matches** (a miss is
  acceptable, a wrong match is not).
- Unit tests for the known hard cases: doubleheaders, neutral sites, "Jr."
  and accents, two players with the same name, a team's abbreviation in
  different sources.
- The unmatched list is written out so it can be worked down.

**Background checks:** match rates re-run daily for a week, to catch sources
whose names drift.

---

### P4 · Storage decision (L0) ⚑ *(laptop + DB, a measurement and a decision)*

**Build**
- A script that counts matched real changes per day, split into:
  - first-hand;
  - relays of a book we read first-hand;
  - relays of books we can only get relayed;
  - pre-game vs in-game.
- A 10-day projection for each option (A all, B one copy per book, C a
  shorter relay window, D pre-game only, E a mix), using today's measured
  ~270 bytes per history row.

**Tests (gate P5)**
- The classes add up to the total.
- The bytes-per-row figure checks out against the live table.
- **The operator picks the policy.** It is written into the master plan as a
  numbered decision.

**Background checks:** none. Growth is watched in P6.

---

### P5 · Schema and writers *(DB migrations + Python + TypeScript, one Render deploy ⚑)*

**Build**
- Additive migrations, applied by hand before the deploy:
  - `prop_odds` and its history get a per-row observed time and **changed_at**
    (D23);
  - game lines get a **period** and the **point in the key** (alternates),
    plus team totals;
  - **pull** rows in history (G8);
  - an **openers** table;
  - **splits, volume and depth** tables;
  - RLS on every new table and a row for each in `docs/table-ownership.md`.
- Writers accept source times (and still default to now for existing callers).
- The reader rule F6: first-hand beats a relay for the same book, then the
  freshest *since* wins.

**Tests (gate P6)**
- Every existing Python writer test still passes, so existing callers behave
  the same.
- Round-trip tests:
  - a row with source times;
  - an alternate game line and a period line;
  - a pull written when a rung disappears;
  - an opener, and a failing opener marked "check".
- RLS: each new table rejects what its pattern says it rejects.
- F6 unit test: a relayed stale DraftKings price loses to a fresh direct one;
  of two first-hand copies, the fresher *since* wins.
- The table-ownership doc regenerates cleanly from the grep it describes.

**Background checks:** none.

---

### P6 · The bridge (B4) *(laptop)*

**Build**
- A laptop job that forwards matched, de-flapped changes under the P4
  policy:
  - sharp sources first;
  - both times on every row;
  - the opener sanity check (D21);
  - unmatched rows kept;
  - 1–2 database connections, no long transactions (F13).
- A heartbeat through the `check_harvester_scrapes` pattern (F10).
- Starts at boot, restarts on crash.

**Tests (gate P7–P9)**
- Unit tests: the flap filter, the P4 policy filter, the time mapping, the
  opener check.
- Replay test: one recorded hour of scraper data run through the bridge into a
  test target. Rows written = the rows expected under the policy, and the
  times are preserved.
- Stop the bridge → `health_check` flags it within its window; kill the
  process → it restarts.
- The connection count stays within budget under a full-speed replay.

**Background checks (never gate):**
- **Two days unattended** with the heartbeat green.
- Supabase growth inside the P4 projection.
- The paid-feed overlap check about 2 weeks in.

---

### P7 · Timing (T0) *(laptop / Python)*

**Build**
- Keep every real timestamp.
- Measure each source's lag behind Pinnacle, per sport, from the matched data
  already on the laptop (history since 09-22).
- The proven-fast list, the latency-badge table, and edge half-life tracking.

**Tests (gate P11's use of it)**
- The lag calculation is right on synthetic sequences with known answers:
  Pinnacle against itself is 0; a source delayed by a known amount reads
  that amount.
- The published table has a row for every source with enough data, and says
  "not enough data" for the rest.

**Background checks:** the lag estimates are re-computed daily as data
builds up. They refine the numbers; they never hold anything.

---

### P8 · The odds sections (UI lane) *(TypeScript, starts right after P1)*

**Build**
- **O1**: the kit components and live pieces (`LiveDot`, `FlashValue`,
  `DataTable` row states, chart live edge), every state on `/kit`.
- **O2**: the player page.
- **O3**: the game page. Its periods and ladder fill once P5 lands.
- **O4**: the Slate and Scan, with the new columns (D22) and the F12 choice.

Each renders today's data and fills in as P6 lands.

**Tests (gate P9)**
- Each surface matches the approved mockup at 1440 and 400, on every sport,
  in a fresh tab.
- A guard: no receipt pills in the odds components (Revision 4).
- Headshots and team logos are present wherever the mockup has them (no
  regression).
- Zero vertical scroll traps.
- The Scan hash and `ui-scope.ts` are updated deliberately in O4 (D22), and
  `tests/slate-shell.test.ts` passes with the new hash.

**Background checks:** none.

---

### P9 · Live *(TypeScript)*

**Build**
- A direct-read odds endpoint (CLAUDE.md pattern 2, F8).
- 30–60 s refresh.
- The live layer switched on, with the noise rules.

**Tests (gate P10)**
- The endpoint does no write on GET and uses no `cachedRoute`.
- A real price change reaches the page within a minute and flashes once. A
  flap does not flash.
- The flash cap holds when many prices change at once.
- Reduced motion shows static arrows only; a hidden tab pauses.
- Load: several open tabs polling stay inside the connection budget.

**Background checks:** none.

---

### P10 · Where the money is *(TypeScript)*

**Build**: O7, game lines and props, from the P5 tables.

**Tests (gate P11)**
- Every row names its source and its age.
- Props show "No data available" for money and bets %, with Sleeper pick
  counts and Kalshi volume where they exist.
- Nothing is labelled "the public" or presented as total handle (a text
  guard).

**Background checks:** none.

---

### P11 · Edge *(Python + TypeScript, one Render deploy ⚑)*

**Build**
- **E1**:
  - the 11 gates, on "since";
  - the outlier rule;
  - the edge log table;
  - a **flags table + kill switch** (F7);
  - the self-check;
  - the gate-1 coverage report (F11);
  - the **E3 closing-line harness**, built now so nothing waits later.
- **O6**:
  - the edge card and the Scan edge column;
  - D6 lifted in CLAUDE.md and `tests/scan-no-edge.test.ts`.

**Tests (gate P12)**
- One unit test per gate: each failing gate on its own blocks the edge.
- **The two hand-found edges reproduce** from recorded fixtures (GB −4.5 at
  BetMGM +1.0%; London receptions 5.5 over at Underdog +1.8%). The anytime-TD
  mismatches do **not** produce an edge.
- The self-check trips on injected bad prices and alerts through
  `health_check`.
- The kill switch hides the edge with no redeploy.
- Every shown edge has an edge-log row.
- The coverage report runs for every sport.

**Background checks (never gate):** the gate reviews at days 3–5 and at 2
weeks (D3); the E3 measurement (P13) starts collecting.

---

### P12 · Alerts, slip and flags *(TypeScript + Python)*

**Build**
- O8: Your-lines alerts (read-time, from history against `tracked_lines`,
  which stays TypeScript-owned).
- Bet slip best book + "open at book" (B5 links).
- Odds research flags as `slate_rankings` rows.

**Tests (the plan's last build gate)**
- Each alert fires on a replayed real event: moved, better price, pulled,
  steam.
- No alert fires twice for one event.
- No new writer on a user table.
- The flags render through the existing flags path.

**Background checks:** none.

---

### P13 · Closing-line test (E3) *(a background measurement, not a build)*

Its harness ships in P11. It collects from the day edge goes live and reports
at about 2 weeks:
- do soft books move toward our fair price by the start;
- edge half-life;
- the gate retune.

**It blocks nothing.** The build is complete at P12, and P13's result feeds
the gate tuning.

---

### Scraper lane *(any time after P4, since each item adds volume)*

G3 cadence, G7 coverage, G5/S4 raw pages, S5 less comparenbet, G4 in-game
props ⚑, and G1 then G2 revisited at an evening peak.

Each item has the same two tests:
- its source stays healthy on the Sources page, at its new cadence or
  coverage;
- growth stays inside the P4 budget.

**Later, outside this build:** L5 dropping-odds lists, L6 and V4 model
inputs, and the routed findings (soccer injuries, `pick_history` bugs,
`game_odds_history` corpus copy, SGO keys).

## 3. Where to start

1. **P0**, on the operator's green light. Nothing downstream works without
   data, and the laptop history is the only full copy.
2. **P1 and P2 together**, then **O1** beside P3.
3. **P3 → P4** (the operator's storage call) **→ P5 → P6**, then P7, the rest
   of P8, and P9–P12 in order. Soak tests and reviews run behind the build,
   never in front of it.
