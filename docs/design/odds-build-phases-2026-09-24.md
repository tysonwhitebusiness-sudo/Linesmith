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

The order follows three rules: keep the data flowing first, never write to
Supabase before the storage decision, and build UI that has something to
render. **Two lanes run in parallel** after P1: the data lane (P2–P7, P10,
P11) and the UI lane (P8). Where a phase needs the other lane, it says so.

| phase | what | where | needs | done when |
|---|---|---|---|---|
| **P0 Stabilise collection** | (1) Restart the scraper (**operator**, see below). (2) Find why the collector hung with 28 writes pending; fix it. (3) Watchdog checks `last_poll_at` freshness, not just the port — a stall restarts it within minutes. (4) **S3**: back up the laptop Parquet history to Supabase Storage (the only full copy). | laptop | — | a stall is restarted automatically; backup verified by a restore of one day |
| **P1 Fix what is broken now** | O0 (player page "No game line yet", raw market keys, book names, best price without a book) + **F5** (game-line history logs a point change too). | TS + Python (deploy ⚑) | — | each bug reproduced before, gone after, on each sport |
| **P2 Names (B0)** | Label map seeded from `STAT_MAP`, every sport's markets; book registry (key, display name, group D18, order, logo domain); both alias maps + `config-drift`. Pages read display names from the registry. | Python + TS | — | both-mapped ≥ ~90% of scraper rows; no raw key or duplicate name on any page |
| **P3 Matching (B1, B2)** | Scraper games → game ids; players → ESPN athlete ids. Match-rate report per sport, hand-checked sample. | laptop | P2 | match rates per sport accepted by the operator |
| **P4 Storage decision (L0)** ⚑ | Measure matched, de-flapped, pre-game changes per day, split first-hand vs relayed vs duplicate-of-first-hand; project Supabase size at 10 days. Bring the options with their cost (examples: bridge first-hand sources plus relays only for books with no first-hand source; a shorter hot window for relays; disk growth on the Supabase plan). The laptop keeps everything whatever is chosen (D14). | laptop + DB | P3 | the operator picks the policy; written into the plan |
| **P5 Schema + writers** | Additive migrations, applied by hand before deploy: `prop_odds` + history get per-row observed time and **changed_at** (since, D23); game lines gain **period** and **point in the key** (alternates) and team totals; **pull** rows in history (G8); **openers** table; **splits / volume / depth** tables (V1–V2); RLS + ownership rows (F9). Writers accept source times. Reader rule **F6**: first-hand over relay per book, then freshest *since*. | Python + TS + DB (deploy ⚑) | P4 | existing writers unchanged in behaviour; a test row with source times round-trips |
| **P6 Bridge (B4)** | Laptop job: forwards de-flapped matched changes under the P4 policy, sharp sources first, both times, opener sanity check (D21), unmatched kept, heartbeat via the `check_harvester_scrapes` pattern (F10), 1–2 connections (F13), starts at boot, restarts on crash. | laptop | P5 | two days unattended, heartbeat green, growth inside the P4 projection |
| **P7 Timing (T0)** | Keep real timestamps; measure each source's lag behind Pinnacle; the proven-fast list; the latency-badge table; edge half-life. Can start on scraper data alone once P3 is done. | laptop / Python | P3 (runs beside P5–P6) | lag per source per sport, published as a table |
| **P8 Odds sections (UI lane)** | **O1** kit components + live pieces on `/kit`, then **O2** player, **O3** game (periods and ladder fill once P5 lands), **O4** Slate + Scan columns (D22; decide F12). They render today's data and fill as P6 lands. | TS | O1 after P1; O3's periods after P5 | each surface matches the approved mockup at 1440 and 400, on every sport, in a fresh tab |
| **P9 Live** | **O5**: direct-read odds endpoint (F8), 30–60 s refresh, the live layer on (dots, flashes, trails, pulls, heartbeat, "since you opened"), noise rules. | TS | P6, P8 | a real price change shows within a minute, flashes once, no flap noise |
| **P10 Money** | **O7**: where the money is, game lines and props, from the P5 tables. | TS | P5 tables filled by P6 | every row labelled by source |
| **P11 Edge** | **E1**: gates in Python on "since", outlier rule, edge log table, **flags table + kill switch** (F7), self-check, gate-1 coverage report (F11); must reproduce the two hand-found edges. **O6**: edge card + Scan edge column; lift D6 in CLAUDE.md and `scan-no-edge.test.ts`. | Python + TS (deploy ⚑) | P6, P7, P8 | the two known edges reproduce; the self-check trips on an injected bad price |
| **P12 Alerts, slip, flags** | **O8**: Your-lines alerts (read-time, from history against `tracked_lines`, which stays TypeScript-owned), bet slip best book + "open at book" (B5 links), odds research flags as `slate_rankings` rows. | TS + Python | P8, P9 | each alert fires on a replayed real event |
| **P13 Closing-line test (E3)** | ~2 weeks after P11: do soft books move to our fair price by the start; edge half-life; retune the gates. | Python | P11 + 2 weeks | measured numbers replace the confidence estimates |

**The scraper lane runs beside this, any time after P4** (each adds volume,
so it waits for the storage policy): G3 cadence, G7 coverage (Polymarket and
Kalshi wider, DK milestones and scorers, FanDuel NBA/NHL tabs when those
seasons open), G5/S4 raw pages, S5 less comparenbet, G4 in-game props ⚑, G1
then G2 revisited at an evening peak.

**Later, outside this build:** L5 dropping-odds lists, L6 and V4 model
inputs, the paid-feed overlap evaluation (~2 weeks after P6), and the routed
findings (soccer injuries, `pick_history` bugs, `game_odds_history` corpus
copy, SGO keys).

## 3. The order that makes the most sense to start with

1. **P0 now.** Every later phase assumes the scraper is collecting, and
   right now it is not, while its only full history has no backup.
2. **P1 and P2 together.** Both are independent, both make today's pages
   better, and P2 is the first dependency of everything in the data lane.
3. **P3, then P4.** P4 is a decision the operator makes from measured
   numbers, and it is the one that decides what the bridge is allowed to
   write.
4. **O1 starts as soon as P1 is done**, beside P3–P6, so the UI is ready
   when the bridge lands.
