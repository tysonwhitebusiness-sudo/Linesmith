# CURRENT — pick up here

**Track F's sourcing block (6.30–6.32) is COMPLETE and audited.** Every gate
passes: 1, 2, 4, 5, 6, 7, 8 and the new **9 (model readiness)**. `tsc` clean,
**339 tests, 0 fail**. DB **5,291 MB** of 8,192.

**The plan is `docs/sourcing-completion-gameplan-2026-09-01.md`** (Track F) and
`docs/audit-remediation-plan.md` §Track F. **Read
`docs/betting-models-primer-2026-09-01.md` before any model work** — the
operator asked for grounding in what advantage betting actually requires before
building, and that document is the answer.

## 1. Where the data stands

| Table | Rows |
|---|---|
| `odds_archive` | **1,587,670** — 9 league keys, 8 sources, 1999→2026 |
| `prop_odds_archive` | 1,805,340 |
| `player_game_history` | 2,799,682 |
| `game_result` | 172,647 |
| `athlete_crosswalk` | 6,352 |

### Trainable games — one row per game, via the `model_game_odds` view

```
tennis 56,340   mlb 31,781   nba 24,705   nhl 24,336
mls     6,397   nfl  5,355   epl  4,200   cfb  4,017 (ML) / 14,514 (spread)
```

Before Track F: MLB 4,593, NHL 6,591, NFL 285, CFB 849, EPL 400, MLS 871.

**NHL prop grader: 0 → 10,020** trainable player-games (6.31's backfill).

## 2. READ THIS BEFORE WRITING A MODEL QUERY

**Use the `model_game_odds` view, not `odds_archive` directly.** It exists
because three separate hazards were found in the audit and all three are
invisible to a naive query:

- **48,489 IN-PLAY rows** sat in the archive as ordinary bookmakers. Brier
  **0.032** against 0.208–0.232 for real pre-game books. They were invisible in
  the aggregate because they were averaged with 19 other books — the finding
  only appears **per bookmaker**. The view filters `NOT is_live`.
- **Cross-source duplication**: CFB 20.2% of games priced by two sources, EPL
  9.5%, MLS 9.4%, NFL 4.1%. Both rows are real; pooling them over-weights
  exactly the recent seasons a model gets judged on. The view applies
  `source_priority`.
- **Future-dated odds** (1,846 rows). The view joins `game_result`, which holds
  no future rows.

**`(sport, athlete_id, game_date)` is NOT a key in `player_game_history`** —
MLB doubleheaders, NBA's UTC date collapsing back-to-backs, tennis players
playing twice. **`(sport, athlete_id, event_id)` is**, and now has a unique
index.

**NHL props join to player history at −1 day.** ESPN stamps UTC, the NHL API
reports local. Joining at 0 understates NHL's grader set by 35%. Gate 7.7.

## 3. NEXT ACTIONS

**Two documents, both written 2026-09-02:**

- `docs/model-build-plan-2026-09-02.md` — game + prop models phased by sport,
  seven phases, three engines.
  Artifact: `https://claude.ai/code/artifact/ab49524a-4b4d-4946-b481-47681d81fe88`
- `docs/model-infrastructure-2026-09-02.md` — **how this becomes a system that
  keeps working.** The measured state of all 53 monitored jobs, the archival
  bridge design, monitoring gaps, capacity, replay, and a 10-step rollout order.

**Needs operator sign-off before building:** the build order deviates from both
approved artifacts. Games said tennis -> soccer -> NBA; props said MLB -> NHL ->
NFL -> NBA. The plan merges them BY ENGINE (tennis, soccer, NHL, MLB, NBA, CFB,
NFL) so each engine is built once and MLB's game model precedes the props that
fall out of it. Flagged, not assumed.

### Blockers — 2 of 5 now FIXED

**FIXED 2026-09-02 — MLB 2022-2024 has raw prices.** The audit said those 8,153
games could only ever be a training signal because `historical_odds` holds them
de-vigged. Wrong: the de-vigging happens in `historicalOddsIngest.ts` on the way
IN, and the source CSV was on disk the whole time
(`data/historical-odds-import/mlb_games_odds_2021_2025_all_books_long.csv`,
205,475 rows, six books, zero nulls on any close price).
`python-odds-service/import_mlb_long_csv.py` loads it at source priority 85 —
2022 +2,384 games, 2023 +2,430, 2024 +2,428, plus a two-sided priced run line.
Verified: espn_core corr 0.9288 / MAD 0.0191, sbr_mlb 0.8113 / 0.0319, and the
new seasons calibrate against outcomes inside 1.5pp per bucket.

**FIXED 2026-09-02 — tennis has surface.** Migration `20260902120000` adds
`surface` and `court` to `game_result`; `import_tennis.py` populates them from
the workbooks already on disk, 100% of 57,386 matches. Verified by permutation
control (real gap 0.0767 vs shuffled 0.0516) and a 0.5262 split-half correlation
of each player's clay-vs-hard gap across 2015-2020 vs 2021-2026. Phase 1
unblocked.

**STILL OPEN:**

1. **No postseason game has EVER entered `player_game_history`.**
   `backfill_player_game_history.py:592` (`gameType != 2`) and `:559`
   (`espn_regular_only`, defaulting True at `:79`), mirrored by
   `predict/generic_freshness_job.py` — so it is the ONGOING path and drops
   every postseason again next season. 43,678 props can never be graded
   (NHL 17,092, NBA 25,662, NFL 924).
2. **The training archive is frozen.** 100% of `odds_archive`,
   `prop_odds_archive` and `game_result` rows came from one import; the live
   jobs write `prop_odds` / `game_odds_book_lines`, which no model reads.
   Design: infrastructure doc §4. Key decision there — the bridge **upserts
   continuously** rather than capturing at `event_start`, so a missed tick makes
   a close staler rather than permanently lost, and Postgres enforces the freeze
   via `WHERE odds_archive.event_start > now()`.
3. **Market canonicalisation** — 36/41/70/20 distinct `type_name` for
   MLB/NBA/NFL/NHL. The head is short: 11 markets cover 90% of NBA and NHL.
4. **SIX MODEL-INPUT FEEDERS HAVE NEVER RUN** — `ingestStatcastPitchesJob`,
   `ingestNhlShotsJob`, `ingestNbaShotsJob`, `ingestNflPbpJob`,
   `venueFactorsJob`, `injurySnapshotJob`. Phase 3 needs NHL shots for
   empty-net/OT detection; Phase 4's skill-vs-luck prior is Statcast.
   **`injurySnapshotJob` is urgent** — availability cannot be bought
   retroactively, so every day it does not run is permanently lost.

### Job health, measured 2026-09-02: 53 monitored, 35 healthy, 18 not

Beyond the six never-run: all six **OddsHarvester** scrapes return 0 records
(anti-bot; CFB's freshest book line is 34h old), `refreshTennisAtpJob` fails
every run on `prop_odds_side_valid`, `computeMlbGameModelJob` fails every run
(`DataError: expected str, got int` on $2), `refreshSportsGameOddsJob` last ran
849min ago against a 180min threshold, and `snapshotCacheSize` has an 11.4MB
payload over its 10MB limit.

**DB 5,641 MB of 8,192 (69%).** Largest: `player_game_history` 1,730MB,
`odds_archive` 1,116MB, `prop_odds_archive` 621MB, `mlb_pitch_events` 448MB,
`snapshot_cache` 334MB, `prop_odds_history` 323MB, `odds_import_staging` 270MB.

### Two traps this session hit — both cost a cycle

**A verifier can be the bug.** The MLB cross-source check first reported
mean-abs-diff 865.7 / corr 0.108, reading as a total parse failure. It was the
metric: American odds are discontinuous across +/-100, so -105 and +101 average
to -2. Converting to implied probability gives 0.8113; adding `NOT is_live`
takes espn_core to 0.9288.

**`ON CONFLICT DO NOTHING` hides a no-op.** The first tennis re-run with surface
wrote nothing and logged "56,386 offered" — the clear is behind `--truncate`,
old rows won every conflict, and the column stayed 100% NULL. Always verify the
VALUE landed, not the offered count.

### Still open, unscheduled

- **Deploy Render.** `venueFactorsJob` and `injurySnapshotJob` NEVER RUN.
- **`refreshTennisAtpJob` fails every run** on `prop_odds_side_valid` — it
  writes `side='home'` for an `aces` market, which is over/under. WTA is fine.
- **`refreshSportsGameOddsJob` stale**, 8 objects all month.
- **Odds-API pacing**: `propline` and `oddsapiio` burn their whole daily cap
  within 20–70 minutes of the 04:00 UTC reset, so both contribute **zero**
  prices during US game hours. The health check reports a fully cap-blocked job
  as *healthy* — `health_check.py:105` is `ok and not stale`.
- **Retention**: `prop_odds_history` wrote 265,771 rows in one day with **no
  retention rule**; `injury_report` ~11 MB/day. Deferred pending the
  data-sales decision.
- **Two Phase 6 gate violations** — `TeamDetail.tsx:770`, `GameDetail.tsx:2297`.
- **`docs/table-ownership.md` stale** — none of Track E/F's tables listed.

## 4. Blocked, and why — do not re-attempt without new data

**Tennis player ids — NOT blocked. That earlier claim was wrong.** This file
previously said `player_game_history`'s tennis rows carry "4-digit ids from a
different provider" with "no name column anywhere to bridge them", and scoped it
as a two-hop problem. **Verified 2026-09-01: they are ESPN athlete ids.** Id
2375 resolves to Alexander Zverev on
`sports.core.api.espn.com/v2/sports/tennis/leagues/atp/athletes/2375`, and
`game_context.py:422` confirms it by construction — tennis subjects are minted
as `espn:tennis:{athleteId}`.

So it is **one hop, the same shape as 6.28's crosswalk**, and it is scheduled as
**6.32**. The one real difference: tennis-data abbreviates (`"Zverev A."`), so
the matcher needs last-name-plus-initial logic, which raises collision risk and
makes the verification step matter more. Verification is available and strong —
pgh tennis spans 2016-01-03 → 2026-08-29 against tennis-data's 2015–2026, so ten
of eleven years overlap. Until 6.32 lands, `odds_archive`'s tennis rows carry
NULL entity ids and gate 8.5 asserts that, so nobody "fixes" it by inventing
something.

**Tennis surface, round and seed ranks are not loaded.** There is no column for
them in `odds_archive` or `game_result`, and a per-sport tennis table would
invert the convention `odds_archive`'s own migration argues for at length. They
are still in the files. Because the orientation is a **pure function of the
match key**, a later loader re-derives exactly the same p1/p2 and can add them.

**NHL `player_game_history` stops at 2025-04-17** — 16 months stale. This is
why NHL had no local date overlap to verify the crosswalk against, and why 95.1%
of NHL prop rows crosswalk but only 91.9% reach a player: players who debuted
after that date have a correct mapping and no history behind it.

**Tennis and golf have no ESPN core odds.** Tennis 400s; golf returns 0 items.
Tennis is now fully sourced from the tennis-data files instead.

**SBR is frozen after 2022-23.** NHL 2020-21 is missing from it entirely —
ESPN covers it, and `game_result` now holds it.

**No non-MLB game model exists.** Unchanged. Still blocks win probability,
simulation density and "why the model likes it" beyond MLB.

## 5. Things that will bite again

- **Always run the control.** See §2. This is the single biggest lesson of 6.28.
- **Verify an id system per sport by joining on a real date AND the right
  entity.** Date alone accepted 35% of deliberately wrong mappings.
- **Derive the day offset, never assume it.** ESPN stamps UTC; the NHL API and
  SBR both report LOCAL. NHL's offset is **−1** (measured −1:11,898 against
  0:7,882); SBR-vs-ESPN is **+1**. Asserting 0 would have thrown away a correct
  crosswalk as unverified.
- **A roster endpoint is a snapshot, not a season.** CBJ 2025-26 returns 20
  players; club-stats returns 30. Rosters alone left 69 real NHL players
  unmatched, Jonathan Toews among them.
- **A cache keyed all-or-nothing will "prove" new candidates unverifiable.**
  Widening the NHL reference added 64 players whose game logs were not in the
  cache, and all 64 were dropped as unconfirmed. The cache is incremental now.
- **Zero is a placeholder, not a value — and whether it is depends on the
  sport.** ESPN writes 0-0 for a postponed game. Soccer genuinely finishes 0-0
  (measured 6.75% EPL, 5.74% MLS — real draw rates) but MLB 1.08%, NHL 0.42%
  and NBA 0.19% are impossible finals. Also `close_total == 0` on all 4,046 MLB
  rows with a close block. A spread of 0 is still legitimate (pick'em).
- **A tie is not always "missing" — sometimes it is MISLABELLED.** 583 tennis
  matches are retirements before either player led by a set, so both score
  columns are equal and cannot say who won. Keeping them encodes `p1 lost` for
  matches p1 may have won. Dropped, and it moved the measured p1 rate from
  0.4959 to 0.5006 — which is how it was noticed.
- **A manual post-processing step is not idempotent.** Two corrupt SBR
  moneylines were deleted by hand after promotion with a `DELETED_CORRUPT = 2`
  constant in gate 5; the next `--truncate` re-import put both straight back and
  the gate failed on a pipeline that had done nothing wrong. Rejected at
  staging now.
- **A partial unique index protects nothing outside its predicate.**
  `odds_archive_natural_key` is `WHERE home_team_id IS NOT NULL AND
  away_team_id IS NOT NULL` — every tennis row falls outside it. Without
  migration `20260901180000` a second tennis run would have doubled the table
  in silence.
- **`event_ref` belongs in any game natural key.** `game_result` was created
  without it: 520 keys cover 1,044 real events, 511 MLB. 524 games would have
  been dropped silently.
- **A flag must be honest or it is worse than no flag.** `market_max` is the
  best price across books, so it sums below 1.0 on ~36% of tennis matches — a
  real arbitrage, not a broken market. Calling it `sub_one_not_two_way` to make
  gate 5.3 pass would have been a lie; it gets `best_of_market`.
- **Never average American odds.** Average implied probabilities.
- **A 50% over rate only holds when both sides are priced symmetrically.**
  Compare to the price-implied probability, not to 0.50.
- **SBR names the CITY; ESPN names "City Nickname".** Prefix matching with a
  unique-hit rule took NBA from 67.8% to 99.84%.
- **Doubleheaders are real.**
- **`pd.read_html` needs `header=0`** on SBR pages.
- **Column headers lie.** On SBR NHL pages `CloseOU` is the *opening* total.
  And in `odds_archive`, a `market='spread'` row's `price` column holds
  `close_home_spread` — a handicap, not a price. Anything scanning `price`
  across markets must exclude spreads.
- **A missing SBR season 301s to the homepage**, which still returns 200.
- **Do not hand-roll a CSV parser in JS.** Use pandas.
- **Long heredocs break in this shell** — `\n` inside one arrives as a REAL
  newline. It broke a gate script again this session. Use the Write/Edit tools
  for anything containing an escape sequence.
- **Backticks in `git commit -m` get shell-substituted** — use `-F`, message
  file in the scratchpad.
- **The DB pool caps at 15 connections.** Close every `.mjs` client.
- **Never `git add -A` or `git add docs/`** — `docs/discord-community-prompt.md`
  is the operator's.

## 6. Operational knowledge

- **Gates:** `python scripts/gate/gate1_game_lines.py`, `gate2_props.py`,
  `node scripts/gate/gate4_staging.mjs`, `gate5_archive.mjs`,
  `gate6_injury_job.mjs`, `gate7_athlete_crosswalk.mjs`, `gate8_tennis.mjs`.
  Promotion is `node scripts/gate/promote_odds.mjs`.
- **Re-import odds + game_result:** `python-odds-service/import_odds_staging.py
  --truncate`, then `promote_odds.mjs`. Idempotent.
- **Re-import tennis:** `python-odds-service/import_tennis.py [--truncate]`.
  Idempotent; verified by running it twice for the same 449,796 rows.
- **Rebuild the crosswalk:** `python-odds-service/build_athlete_crosswalk.py`
  (`--report` builds and prints without writing). Its fetched reference data
  caches in `python-odds-service/.crosswalk_cache/` (gitignored, ~2.5 MB,
  re-derivable); the NHL game-log cache is incremental.
- **Migrations:** `node runmig.mjs <path>`.
- **Python:** from `python-odds-service/`, `./.venv/Scripts/python.exe -u <script>`.
  `openpyxl` was added this session for the tennis `.xlsx` files.
- **Tests:** `npm test` (339).
- **Source files** live in `C:\Users\occy3\Downloads\` — `nba_odds/`,
  `nhl_odds/`, `nhl_odds_legacy/`, `espn_core_odds/`, `espn_core_odds_v2/`,
  `espn_props/`, `USA.csv` (MLS), the 24 tennis `.xlsx` (ATP is `YYYY.xlsx`,
  WTA is `YYYY (1).xlsx`), `archive.zip` (NHL Kaggle).
- **Render:** worker `srv-da36bm2bkg8c73fqrdeg`, `autoDeploy: no`. **Still
  undeployed.**
- **Supabase PRO**, 8 GB ceiling, currently 4,401 MB.

## 7. Source priority — higher wins on conflict

```
100  SBR              real closing lines, both sides, 2007-2023
 90  ESPN core API    many books, open+close, verified two-way
 80  nflverse / CFBD  free, authoritative for their sport
 70  football-data    closing 1X2, multi-book
 60  tennis-data      closing match odds — LOADED 2026-09-01
 50  ESPN site API    LOW — NHL moneyline is 3-way regulation (booksum 0.83)
 40  Kaggle NHL       favourite-only price, no team orientation at all
```

## 8. Known not done

1. **6.29, the model rebuild** — not started, needs the operator's go-ahead.
2. **Tennis player ids, surface, round and ranks** — §4.
3. **Render undeployed**; four ingest jobs report NEVER RUN.
4. **Two Phase 6 gate violations** remain.
5. **`docs/table-ownership.md` is stale** — §3 item 4.
6. **2,207 unresolved staging rows** kept with a `resolution_note` and never
   promoted: `unresolved_team`, `defunct_or_relocated_franchise`,
   `phantom_abbr`, and now 2 × `impossible_american_price`.
7. **12 MLB and 21 NHL prop athletes never reached a crosswalk row** — 810 and
   381 rows, **0.07%** and **0.55%**. Ten of the twelve MLB ones have no name
   from ESPN at all (prospects it publishes no metadata for); the NHL residue
   is 15 with no reference row plus 6 dropped as unverified provisional
   name-only matches.
8. **CFB/NBA/NHL/tennis pages never walked** — out of season.
9. `/diagnostics`, `/bets` and every signed-in surface unverified — no
   credentials.
