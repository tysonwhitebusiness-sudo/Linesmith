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
2. **Time.**
   - The sharp quote was checked ≤ **20 min** ago (Pinnacle's CDN copies are
     ≤ ~15 min, D13, plus one poll).
   - The soft quote was checked ≤ **3 min** ago. For a relay-sourced soft
     quote, the limit is ≤ (P7 relay median + 2 min), and the relay must
     have shown a change for that book on the same game within the last
     **60 min**. The last rule is the "since, not checked" rule (D23): a
     relay re-confirming an 11-hour-old price fails it.
   - No fast sharp source (Kalshi/Polymarket at the same line) moved its
     fair probability by more than **1.5 pts** since the sharp quote's
     `since`.
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
| `src/test_market_edge.py` (new, hermetic → CI) | Python | each gate in isolation: a fixture passing all 11, then one fixture per gate that fails only that gate and produces no edge. **The two known edges reproduce** from om-data fixtures: GB −4.5 BetMGM −105 vs Pinnacle −113/+102 → shown, EV ≈ +1.0% (tolerance 0.2 pt); London receptions 5.5 over at Underdog (implied +110) vs Pinnacle −103/−117 with Novig agreeing → shown, EV ≈ +1.8% when Novig's relay is `proven_fast` in the fixture, and **not** shown when it is not. The anytime-TD mismatches → no edge (gate 8). Self-check: 30 evaluated with 3 passing at EV > 5% → auto-off; 3 clean runs → cleared |
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
