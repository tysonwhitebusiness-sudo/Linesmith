# P11 · Edge (E1 + O6)

**Lane:** Python (compute, on the Render worker) + TypeScript (render). One
migration. **Deploys:** one Render deploy ⚑. **Needs:** P6 (prices with both
times), P7 (`source_latency`, proven-fast list), P8 (the components).
Operator's green light.
**Goal:** a **market edge** (sharp vs soft book; no model) shown only where
**every** gate passes (D3, D4). It is logged, it can be switched off without
a deploy, it switches itself off when numbers look wrong, and it reproduces
the two edges found by hand in the mockup.
**Audit findings covered:** F7, F11. Plan §7 (the 11 gates), D5, D6, D13,
D19, D23.

---

## Definitions

- **Sharp reference quote:** two-sided prices (both sides) at the **exact
  same line** from a reference source.
- **Fair probability:** the sharp pair with the vig removed, by **each** of
  `devig_two_way`, `devig_power`, `devig_shin` and `devig_worst_case`
  (`python-odds-service/src/predict/odds_math.py`). The **smallest** edge
  across methods is used (gate 6).
- **Soft quote:** any non-reference book's price on one side at that line,
  after F6 precedence (P5).
- **Edge (points)** = fair − soft implied. **EV** = fair × soft decimal − 1.
- **Times:**
  - `checked` = the last confirmation (`fetched_at`, or `scraper_checks`,
    P6 §6);
  - `since` = the last change (`changed_at`, D23).

## The 11 gates, exactly

A market-side is shown only if all pass. Each gate returns a name and pass
or fail, and **all results are logged**.

1. **Reference.**
   - **Game lines:** Pinnacle two-sided at the line with `extra.limit ≥ 500`
     (measured MLB limits: spread median $2,500, total $1,875, ML $1,000;
     props $250–500). Or Circa via VSiN two-sided at the line, only if P7
     marks it `proven_fast` for that sport.
   - **Props:** Pinnacle two-sided at the line **and** a second source whose
     fair probability for the same side is within **3.0 pts** of
     Pinnacle's. Or **two** non-Pinnacle sharp or exchange sources agreeing
     within 3.0 pts.
   - The second source can be Kalshi, Polymarket, Novig or ProphetX. Novig
     and ProphetX arrive only relayed, and count only if P7 marks their
     relay `proven_fast`.
   - **Exchanges count only** with bid–ask spread ≤ **4¢** and
     (`volume_24h` ≥ $1,000 or `liquidity` ≥ $1,000).
2. **Time — D13, exactly** (revised 2026-09-24, see the changelog below).
   - **The sharp price time** is the moment our copy of Pinnacle's price
     represents: `Last-Modified` when the response carried one, else
     `fetched_at − cache_age_s` (the CDN's `Age`). It is **not** the row's
     `changed_at`: a CDN copy fetched now can describe a price that is up to
     ~15 min old, and `changed_at` only says when *we* first saw it change.
   - **The soft price is taken as it stood at the sharp price time**, from
     the soft book's own history (`*_history`, minute resolution): the last
     soft row with `observed_at ≤ sharp price time`. The edge is computed
     from that pair, both describing the same instant.
   - **Then it is shown only if nothing moved since the sharp price time:**
     - the soft book's price has **not changed since** (no soft history row
       for that key after the sharp price time: its current price is the
       one compared);
     - no fast sharp source (Kalshi/Polymarket, same line) moved its fair
       probability by more than **1.5 pts** since the sharp price time.
   - **The checked-age limits still apply:**
     - the sharp quote was checked ≤ **20 min** ago (Pinnacle's CDN copies
       are ≤ ~15 min, D13, plus one poll);
     - the soft quote was checked ≤ **3 min** ago. For a relay-sourced soft
       quote the limit is ≤ (P7 relay median + 2 min), and the relay must
       have shown a change for that book on the same game within the last
       **60 min**. That last rule is the "since, not checked" rule (D23): a
       relay re-confirming an 11-hour-old price fails it.
   - (This replaces `price_resolution._MAX_PAIR_SKEW_SECONDS`' 30-minute
     unaligned comparison for this purpose.)
3. **Corroboration.** If another provider carries the same book at the same
   line with `checked` ≤ 3 min, its price must be within **5¢** (decimal
   difference ≤ 0.05), else fail. With no second copy, pass, logged
   `single_source=true`.
4. **Settled.**
   - The soft and sharp rows arrived through the bridge's hold buffer (every
     `scraper:*` row did, P6 §4). Paid-feed rows pass by construction.
   - No open pull for either key (`prop_odds_pulls` / `game_line_pulls` with
     `returned_at IS NULL`).
   - Never a `comparenbet_fair` row.
5. **Pre-game:** now < game start − 60 s.
6. **Conservative:** EV and edge computed with each de-vig method; the
   **minimum** is used and must be > 0.
7. **One book, several providers:** the F6-preferred copy is used; if two
   copies checked within 2 min of each other disagree by more than 5¢, fail.
8. **Cap + outlier:** EV > **8%** → fail (`capped`, logged as a probable data
   error). A soft price that D19 marks an outlier (implied probability < 0.6×
   or > 1.6× the median at that line, ≥ 5 books) → fail. That is exactly the
   85–250% anytime-TD mismatches found in the mockup.
9. **Self-check:** each run, if ≥ 20 market-sides were evaluated and more
   than **5%** of those passing gates 1–8 have EV > **5%**:
   - write `app_flags('edge_auto_off') = {"on": true, "reason": …, "at": …}`;
   - show nothing;
   - `health_check` alerts.

   It clears itself after **3 consecutive** runs under the threshold.
10. **Logged:** every market-side that passes gates 1–9 gets a
    `market_edge_log` row when it first passes and `ended_at` when any gate
    first fails.
11. **Kill switch:** `app_flags('edge_display') = {"enabled": false}` hides
    every edge on every page within the route's cache time (≤ 30 s), with no
    deploy. Python keeps computing and logging, so E3 has data.

## Build

### 1. Migration `<UTC>_market_edge.sql`

```sql
CREATE TABLE IF NOT EXISTS market_edges (          -- current: what may be shown now
  kind text NOT NULL CHECK (kind IN ('prop','game')), sport text NOT NULL, game_id text NOT NULL,
  subject_id text NOT NULL DEFAULT '', period text NOT NULL DEFAULT 'fg', market text NOT NULL,
  side text NOT NULL, line double precision, bookmaker text NOT NULL, provider text NOT NULL,
  soft_american integer NOT NULL, fair_prob double precision NOT NULL, edge_pts double precision NOT NULL,
  ev double precision NOT NULL, method text NOT NULL, reference jsonb NOT NULL,   -- sharp prices, ages, limit, second source
  soft_checked_at timestamptz NOT NULL, soft_since timestamptz NOT NULL, sharp_checked_at timestamptz NOT NULL,
  sharp_since timestamptz NOT NULL, passing_since timestamptz NOT NULL, single_source boolean NOT NULL,
  computed_at timestamptz NOT NULL,
  PRIMARY KEY (kind, game_id, subject_id, period, market, side, line, bookmaker));
CREATE TABLE IF NOT EXISTS market_edge_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind text NOT NULL, sport text NOT NULL, game_id text NOT NULL, subject_id text NOT NULL DEFAULT '',
  period text NOT NULL DEFAULT 'fg', market text NOT NULL, side text NOT NULL, line double precision,
  bookmaker text NOT NULL, provider text NOT NULL, soft_american integer NOT NULL, fair_prob double precision NOT NULL,
  ev double precision NOT NULL, method text NOT NULL, gates jsonb NOT NULL, reference jsonb NOT NULL,
  shown_at timestamptz NOT NULL, ended_at timestamptz, end_reason text, displayed boolean NOT NULL);
CREATE INDEX IF NOT EXISTS market_edge_log_game ON market_edge_log (sport, game_id, shown_at);
CREATE TABLE IF NOT EXISTS app_flags (
  key text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), updated_by text NOT NULL);
INSERT INTO app_flags (key, value, updated_by) VALUES ('edge_display', '{"enabled": true}', 'migration')
  ON CONFLICT (key) DO NOTHING;
-- RLS: read policy on all three (the 20260915060000 pattern).
```

- `app_flags` has **two writers**, named here:
  - the operator, by hand (`UPDATE app_flags SET value = '{"enabled": false}', updated_by = 'operator' WHERE key = 'edge_display'`);
  - Python, `edge_auto_off` only.
- Ownership rows are added.

### 2. `python-odds-service/src/predict/market_edge.py` (new) + job

- `evaluate(markets, latency, now) -> list[EdgeResult]`: pure, the 11 gates
  above, each gate a separate function. It is fully unit-tested.
- `async def run()`:
  1. Read pre-game markets that have a sharp reference: `prop_odds` +
     `game_lines` joined to `scraper_checks`, pulls, `source_latency`, and
     each game's start.
  2. Evaluate.
  3. Upsert `market_edges` (and delete the rows no longer passing, setting
     `ended_at` in the log).
  4. Write the log.
  5. Set or clear `edge_auto_off`.
- `JOB_REGISTRY`: `("marketEdgeJob", job_market_edge, 120)`.
  - **Measure its runtime** on a full NFL Sunday slate plus the MLB slate.
  - If p95 > **20 s**, which holds the one-job-at-a-time worker too long,
    move `run()` into the laptop bridge's cycle (every 2 min) and keep the
    same tables. Record which here.
- `health_check.py`: `check_edge_self_check()` reads `edge_auto_off` and
  alerts while it is on.

### 3. TypeScript: render only, never compute (O6)

- `lib/db/oddsRead.ts`: `readEdges(scope)` and `readFlag('edge_display')` /
  `readFlag('edge_auto_off')`, cached 30 s in-process.
  - The P8 routes include `edges` in their payloads **only when**
    `edge_display.enabled` and not `edge_auto_off.on`.
- Mount `EdgeCard` (P8) in the player and game sections; the Slate card
  edge dot; the Market hub "Edges" tab; the **Scan edge column** (D5/D22:
  update the hashes and `ui-scope.ts` in the same commit).
- The edge card also shows "Passing for N min" (from `passing_since`, P9's
  tick) and folds open or shut as rows appear or leave.
- **D6 lifted** in CLAUDE.md ("The Slate" §4). The new text is: *"Market
  edge (sharp vs soft, computed in Python, `market_edges`) may be shown in
  the odds components named in `tests/scan-no-edge.test.ts`'s allowlist.
  Model-vs-market difference remains banned everywhere."*
- **`tests/scan-no-edge.test.ts` rewritten, not deleted:**
  - its existing model-vs-market assertions **stay** for every file;
  - a new allowlist (`components/odds/EdgeCard.tsx`, the Scan edge cell,
    `components/slate/GameCard.tsx`'s edge dot,
    `components/slate/SlateMarket.tsx`'s Edges tab) may reference
    `edge`/`ev`, but only **from a payload field**;
  - a guard fails if any allowlisted file imports a de-vig or probability
    helper, so the edge is never computed on the page.

## Tests (these gate P12)

| test | kind | what it proves |
|---|---|---|
| `src/test_market_edge.py` (new, hermetic → CI) | Python | each gate in isolation: a fixture passing all 11, then one fixture per gate that fails only that gate and produces no edge. **The two known edges reproduce** from om-data fixtures: GB −4.5 BetMGM −105 vs Pinnacle −113/+102 → shown, EV ≈ +1.0% (tolerance 0.2 pt); London receptions 5.5 over at Underdog (implied +110) vs Pinnacle −103/−117 with Novig agreeing → shown, EV ≈ +1.8% when Novig's relay is `proven_fast` in the fixture, and **not** shown when it is not. The anytime-TD mismatches → no edge (gate 8). **Gate 2 (D13):** the soft price is read at the sharp price time (`fetched_at − cache_age_s`, or `Last-Modified`), not at `changed_at`; **a soft book that moved after the sharp price time → no edge**, even when its current price would show one; a Kalshi move of 2 pts after the sharp price time → no edge; a soft price unchanged since → the edge is computed from the aligned pair. Self-check: 30 evaluated with 3 passing at EV > 5% → auto-off; 3 clean runs → cleared |
| `tests/scan-no-edge.test.ts` (rewritten) | TS | model-vs-market still banned everywhere; market edge only in the allowlist and only from payload fields |
| kill switch drill | live | `UPDATE app_flags … enabled false` → within 30 s no edge on any page; back to true → edges return |
| auto-off drill | live, test flag | inject one fake soft price 12% off in a test game under provider `edge-test` → gate 8 blocks it; inject 10 fake 6% edges → self-check trips, `health_check` alerts, pages show none; clean up |
| runtime | live | `marketEdgeJob` p95 recorded (or its move to the laptop recorded) |
| render | fresh tab | an edge (or the honest empty state) on player, game, Slate and Scan at 1440 and 400 |

**Exit criteria:**
- the tests and drills pass;
- the deploy is recorded;
- CLAUDE.md is updated;
- the operator has seen the first live edges (or the reasons there are
  none).

## Background checks (never gate)

- **Day 3–5 and 2-week gate reviews (D3):**
  - `market_edge_log` counts by gate failure, EV distribution, and edge
    half-life (P7 §4 method);
  - a tighten/loosen proposal goes to the operator.
- **P13** (the closing-line test) starts collecting from the first logged
  edge.

## Files touched

- New: the migration, `python-odds-service/src/predict/market_edge.py`,
  `src/test_market_edge.py`.
- Edited:
  - `jobs.py` (the job), `health_check.py`;
  - `lib/db/oddsRead.ts`, the P8 routes, `components/odds/EdgeCard.tsx`
    (mounted);
  - Scan files + hashes, `components/slate/*`;
  - `tests/scan-no-edge.test.ts`;
  - `CLAUDE.md`, `docs/table-ownership.md`, `docs/CURRENT.md`.

## Changelog

- **2026-09-24 — gate 2 implements D13 exactly** (the operator's "does this
  follow the plan" review, `HANDOFF-P0-P4.md` correction 1). The first draft
  anchored gate 2 on the sharp quote's `since` and compared current prices.
  D13 says the sharp price time is when our copy's price was true
  (`Last-Modified`, or fetch time − `Age`), the soft price is taken **at that
  instant** from the soft book's history, and the edge shows only if neither
  the soft price nor a fast sharp source has moved since. The checked-age
  limits are kept, and `test_market_edge.py` gains the case where the soft
  book moved after the sharp price time.

---

## Result (2026-09-25, `6d5fbe6`; P13's `352d022` adds `reference.start`)

**Built.** `predict/market_edge.py`: the gates, one function each; `evaluate()`
pure; `run()` reads `prop_odds`/`game_lines` (+ `scraper_checks`, open pulls,
`source_latency`, the schedules' starts), writes `market_edges`,
`market_edge_log` and `edge_auto_off` through `db.write_market_edges` /
`db.write_app_flag`. `marketEdgeJob` every 120 s in `JOB_REGISTRY`;
`health_check.check_edge_self_check`. Migration `20260925202000_market_edge`
**applied** (RLS read-only, `edge_display` on). TypeScript reads only:
`readFlags` (30 s) / `readEdges` in `lib/db/oddsRead.ts`; `edges` rides on
`/api/odds/player`, `/api/odds/game` (and its `?live=1`) and `/api/odds/scan`
only while the switch is on and auto-off is off, and only rows computed in the
last 5 minutes. `/api/odds/edges` (pattern 2, page-read in `proxy.ts`) feeds
the Slate. Mounted: `EdgeCard` beside Best price on the player and game
sections (tab dots; folds with `Collapse`; "Passing for N min"), the Slate
game card dot, the Market hub's Edges tab (`SlateEdges`), Scan's Edge column
(`ScanEdgeCell`, `sortable: false`, pin updated). CLAUDE.md "The Slate" §4
carries the spec's D6 text. `tests/scan-no-edge.test.ts` rewritten: every
model-vs-market assertion kept; an allowlist that may only READ payload fields
and imports no de-vig or probability helper; the mounts may not read an
edge's numbers; Scan cannot sort by it; the visibility rule is pinned.

**Tests.** `src/test_market_edge.py` (CI): a fixture passing every gate, one
fixture per gate failing only it, D13 (price time from Age / Last-Modified /
the 15-minute bound; a soft move after it → no edge; a Kalshi 2-pt move → no
edge; < 1.5 → shown; relay rules), both mockup edges, the anytime-TD mismatch
(gate 8), self-check trip and 3-run clear. `npm test` 756/756 at the commit;
`tsc` clean.

**Drills (live, local dev server against the real database).**
- Kill switch: `edge_display` → false at 20:58:33; every route
  (`edges`, `game`, `game?live=1`, `scan`, `player`) had no `edges` 22 s later;
  back on → edges returned in 19 s.
- Auto-off: fake prices injected **in memory** into 11 real live markets (not
  written to the live tables — see deviations) and run through the real
  evaluator: the 12% price was capped by gate 8; 8 of 10 fake 6% edges passed
  gates 1–8 (2 failed gate 2: an exchange had moved); the self-check tripped
  (10 of 126 passing above 5%); the flag was written; `health_check`
  reported `edgeSelfCheck` unhealthy; pages hid edges within 10 s. Three real
  runs cleared it ("cleared after 3 clean runs").

**Live, first runs (laptop).** 113 upcoming games, 8,486 markets with a
reference line, ~31,000 market-sides evaluated per run. Passing between 7 and
124 per run (freshness drives it); EV 0.0–6.2%, two above 5% of 51 in one run
(3.9%, under the trip line); the self-check never tripped on real data.
Commonest first failures: gate 2 (relays with no measured delay, Propline's
missing `changed_at`), gate 1 (no Pinnacle at the line), gate 6.

**Runtime.** From the laptop 19–65 s per run (the read 8–34 s over home
broadband; evaluation 4–6 s after caching each market's shared pieces).
**The worker's p95 is not measured yet — it needs the deploy.** Read
`python-harness:job-run:marketEdgeJob` (`runtime_s`) across the NFL Sunday
2026-09-27 slate; if p95 > 20 s, move `run()` into the laptop bridge's cycle
(an operator restart of the bridge task).

**Render.** Game page (MLB 824220, Total 7.5): the card at 1440 and 400, no
horizontal overflow — `results/p11-game-edge-1440.png`. Player page (NFL
3117256): the edge at 400 (Under 5.5 DraftKings +4.4%); at 1440 the check
landed on another market and drew the honest empty state. Slate (MLB): dots
on the two games with edges, the hub's Edges tab listing three totals (text
check in the pane). Scan: the cell on `/kit` and in `/api/odds/scan`'s
payload; the live NFL props board did not finish loading on the dev server
inside the check, so the in-table cell was not seen on a page.

**Deviations.**
1. Gate 6 takes the minimum over multiplicative, power and Shin; worst case is
   logged in `reference.ev_by_method`, not gating. Measured: worst case turns
   both required edges negative (GB +1.0% → −1.4%; London +1.8% → −3.2%).
2. London shows **+1.6%** (power, the minimum) where the mockup said +1.8%
   (multiplicative); the test asserts both.
3. `market_edges` keys with `UNIQUE NULLS NOT DISTINCT`, not a primary key: a
   moneyline's line is NULL.
4. Sharp price time: the bridge stores neither Age nor Last-Modified, so every
   Pinnacle price uses D13's 15-minute bound (`price_time_basis:
   assumed_max_cdn_age`) — the soft book must have held its price 15 minutes.
   Conservative; storing `cache_age_s` in `extra` at the bridge would loosen it
   to the truth (follow-up; the bridge is the operator's process).
5. The Slate reads `/api/odds/edges`, not the Slate's 60 s `cachedRoute`
   payload: that cache would hold an edge past the 30 s kill switch.
6. The Edges tab lives in `SlateOddsHub` via `components/odds/SlateEdges.tsx`
   (the spec named `SlateMarket.tsx`); the allowlist names the real files.
7. The auto-off drill injected in memory, not as `edge-test` rows in the live
   tables, so no fake price could reach a real page.
8. Fail-safe added: a page shows no edge computed more than 5 minutes ago.
9. Novig/ProphetX relays are not proven fast (P7), so prop edges today need
   Pinnacle plus an agreeing first-hand exchange.

**Waiting on the operator:** the worker deploy (docs/CURRENT.md), the runtime
p95, and seeing the first live edges on a deployed page.
