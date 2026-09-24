# Scraper lane: coverage, cadence and storage (runs beside P5–P13)

**Lane:** laptop (odds-scraper repo). **Deploys:** none; restart the
scraper with the P0 procedure after each change. **Needs:** P4 (every item
here adds volume, so it waits for the storage policy D24) and the operator's
green light **per item**. Each item ends with the same two checks:
- its source stays healthy on the scraper's Sources page;
- growth stays inside the D24 budget (P6's status file shows the bridged
  rows/day).

---

## S-G3 · Per-game prop cadence

- **Today** (`scraper/sources/_books.py:38`):
  `TIERS = ((6.0, 60.0), (24.0, 180.0), (72.0, 600.0), (168.0, 1800.0))`.
  Hours to start → seconds; nothing beyond 7 days; NCAAF 5× slower
  (`game_interval`).
- **Change** (the plan's recommendation):
  `TIERS = ((6.0, 60.0), (72.0, 300.0), (168.0, 900.0))`, i.e. 5 min to 3
  days out and 15 min to 7 days. NCAAF's factor stays 5.
- **Measure before and after:** requests/min per book (Sources page) and
  `pending_writes` at the evening peak.
- **Revert if** any book shows a refusal (403/429/challenge) or the writer's
  queue stays > 20 for 10 min.
- **Test:** `test_infra.py` group `r2` gains `tiers_s_g3`, checking
  `game_interval` at 5 h, 30 h, 100 h and 200 h for NFL and NCAAF.

## S-G7 · Coverage

Each sub-item is its own green light.

1. **DraftKings milestones + TD scorers.**
   - `sources/draftkings.py:108` keeps only subcategories whose name
     contains "O/U" (and not `_SKIP_SUB` / `_SKIP_CAT`).
   - Add the subcategories whose names match
     `(Milestones|To Record|TD Scorer|Anytime TD|First TD)` as a second
     list.
   - Parse them as **yes-only ladders**: each rung "N+" is stored as
     `side='over'`, `line=N-0.5`, `depth.yes_only=true` (the FanDuel R2
     rule).
   - **First** read one real payload of each new subcategory and record its
     shape in the scraper `HANDOFF.md`.
   - Test: fixtures in `samples/r2/` plus a `test_infra.py` case per new
     subcategory.
2. **Kalshi series.**
   - `sources/kalshi.py:49–59` hardcodes `SERIES`: game ml/sp/tot for 7
     leagues, 6 NFL prop series and 6 MLB prop series.
   - **Step 1 (read-only probe, one request):** check the public series
     listing (`GET {BASE}/series` with a sports category filter) and save
     the response to `samples/r1/kalshi_series.json`.
   - **Step 2:** if it lists series, generate `SERIES` from it (every sports
     game and player-prop series for the app's leagues). If not, add each
     prop series found on Kalshi's sports pages by hand, one at a time, each
     verified with a single request.
   - Mapping the new prop keys to app markets is P2's generator (add them
     there first).
3. **Polymarket.**
   - `sources/polymarket.py:48` `_HORIZON_DAYS = 7`, and `_TYPES` limits to
     moneyline, spreads and totals.
   - Widen `_HORIZON_DAYS` to **14**.
   - Probe (one request) whether the gamma events carry player-prop
     `sportsMarketType`s. Add those types only if they exist, with a sample
     saved.
4. **FanDuel NBA/NHL prop tabs** (when those seasons open in October).
   - Find the tab slugs from one real `event-page` response per league.
   - Add them to FanDuel's league config, the way MLB's `batter-props` /
     `pitcher-props` were added in R2.
5. **oddsrun data API.**
   - Its page became a client shell (R5).
   - Open it once in the operator's browser devtools (not automated) and
     note the XHR endpoint.
   - Only then map it as a normal JSON source. Until then it stays hourly
     (the operator's call).

## S-G5 · Raw pages past 48 h (S4)

- **Today:** `RAW_RETENTION_HOURS = 48` and hourly keyframes
  (`RAW_KEYFRAME_SECONDS = 3600`). `rawstore.prune()` keeps a keyframe while
  any delta that references it survives.
- **Change:** keep **keyframes** for `RAW_KEYFRAME_RETENTION_DAYS` (new
  config, **30**), and deltas for 48 h as today. So one full page per
  endpoint per hour survives 30 days.
- `prune()` gains the second cutoff for keyframe files (`*.k.json.zst`;
  confirm the naming in `rawstore.py` before coding).
- **Measure** the keyframe bytes/day first. The plan's rough figure was
  ~30 GB/yr. Record the real number in HANDOFF and include it in the S3
  backup only if the operator says so ⚑.
- **Test:** a `test_infra.py` case covering a 3-day-old keyframe kept, a
  3-day-old delta deleted, and a 31-day-old keyframe deleted.

## S-S5 · Less reliance on comparenbet

- Measured after P6 has run 2 weeks: the share of bridged rows per book
  whose **only** source is comparenbet.
- For each book above 20% of its rows, look for a first-hand or second
  relay source (probe read-only, never a bot-protection bypass). Record the
  findings.
- A new source is its own R-style step with its own green light.

## S-G4 · In-game props ⚑ (operator's call)

- If yes: per-game prop endpoints are **not** retired at the start
  (`retire_endpoints` keeps them). Instead they poll at 60 s until the
  game's `live` flag clears, then retire.
- **Measure** the extra requests/min per book on one NFL Sunday. D24's
  in-game policy decides whether those rows reach Supabase.

## S-G1 → G2 · Writer headroom, then every Sleeper pick-count change (declined for now)

When revisited at an evening peak:
1. `WRITE_BATCH` 8 → **16** (`config.py`). Measure `pending_writes` and
   `store_ms`.
2. Only if the queue stays below 10: set `PICK_STATS_SECONDS`
   (`sources/sleeper.py:42`) to 0, so every pick-count change is written.
   Measure the splits rows/hour.
