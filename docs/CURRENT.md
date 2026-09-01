# CURRENT — pick up here

**Task 6.28 (entity crosswalks) is COMPLETE.** All four parts landed
2026-09-01: the MLB + NHL athlete crosswalk, the tennis load, `game_result`,
and gate 1.9's deletion.

**TRACK F was then added, and it runs BEFORE 6.29.** Testing 6.28's own claim
found that "sourcing complete" was not true — six of eight sports had one season
of odds or less. Plan:
`docs/sourcing-completion-gameplan-2026-09-01.md`. Track F is 6.30–6.33 with a
**hard operator gate** between the sourcing and the UI work.

**Gates 1, 2, 2.7, 3, 4, 5, 6, 7 and 8 all pass.** `tsc` clean, **339 tests,
0 fail**. DB **4,401 MB** of an 8 GB ceiling.

**Why any of this exists: `docs/model-rebuild-plan.md`.** It holds the model
audit, the four-bar standard, the two-system decision (game model + prop
grader) and the rebuild sequencing. Read it before touching the model layer.
`docs/audit-remediation-plan.md` §Track E is the master plan; trust it and
`git log` over this file if they disagree.

### The headline from the model audit, so it is impossible to miss

- **The MLB game model loses to the market on real games** — Brier 0.2315 vs
  0.2090 on 153 graded picks. Positive-CLV rate **50.0%**, a coin flip.
- **The claimed edge has no predictive value.** The +7% bucket (n=645) finished
  **2.3pp below** the market's implied probability.
- **Cause: `marketProbCentered` carries a weight of 3.517** — the market's own
  price is the model's largest feature. It cannot beat a line it is built from.
- **Seven sports of eight have never had a coefficient fitted.**
- **Most model output is already switched off in the UI.** Rebuilding breaks
  almost nothing visible.
- **Decision: rebuild the model layer; keep the data layer and the measurement
  harness.**

## 1. What 6.28 landed

| Part | Result |
|---|---|
| Athlete crosswalk | `athlete_crosswalk`, **5,166 rows**, all seven sports. MLB prop rows reaching a player **0.0% → 96.2%**, NHL **0.0% → 91.9%**. **GATE 7 PASSED** |
| Tennis | **57,386 matches** → 449,796 price rows + 56,386 outcomes, de-randomised. **GATE 8 PASSED** |
| `game_result` | **113,323 rows**, 2007-09-29 → 2026-09-01. NHL 2020-21 closed. **GATE 4.6 now runs and passes** |
| Gate 1.9 | **Deleted**, superseded by 4.5 |

### Where the data now stands

```
odds_archive        1,084,987   9 league keys, 3 sources, 2007-09-29 -> 2026-09-02
prop_odds_archive   1,805,340   7 sports, 550,669 two-sided
game_result           113,323   9 league keys, 2 sources + tennis_data
athlete_crosswalk       5,166   7 sports
injury_report           1,265   accruing daily
```

## 2. THE SINGLE MOST IMPORTANT THING TO CARRY FORWARD

**A numeric id matching the expected SHAPE is not evidence it is the right id,
and neither is a high overlap.** 30 of 39 ESPN NHL team ids "matched"
`player_game_history` and every match was wrong — the NHL API calls Toronto 10,
ESPN calls Montreal 10.

**6.28 turned that warning into a measurement, and the measurement is worse
than the warning.** Every athlete mapping was scored twice through the same
join — once as matched, once deliberately mis-mapped onto another real athlete:

```
                                 true    shuffled control
  MLB   vs player_game_history   82.4%        2.0%
  NHL   vs the NHL API game log  64.6%        2.4%
```

And **a date join alone would not have caught the wrong answer.** On NBA, where
the mapping is the identity and therefore known correct:

```
                     exact date   date AND team
  true mapping          75.9%         75.9%
  shuffled mapping      35.1%          4.0%
```

**728 of 806 deliberately wrong NHL pairs found at least one matching date.**
Requiring the right TEAM on that date takes it to 2%.

**So: always run the control.** A number with nothing to compare it to is not
evidence. Gate 7.5 re-runs that comparison in SQL every time rather than
counting rows, because a crosswalk that rots shows up as the two scores
converging and no coverage number would reveal it.

## 3. NEXT ACTIONS, in order

**Track F is the plan: `docs/sourcing-completion-gameplan-2026-09-01.md`.**
It was written 2026-09-01 and it runs **before 6.29**, not after.

1. **6.30 — complete the game-odds sourcing.** Six sources, all in hand: NHL
   SBR column fix, nflverse, CFBD (key added and verified), EPL `E0*.csv`, MLS
   `USA.csv`, MLB raw xlsx. Every hazard in the six is a **silent** failure.
2. **6.31 — NHL `player_game_history` backfill.** The item that actually blocks
   6.29: NHL has **0** prop player-games with a stat line, and none of 6.30's
   loads change that because they are game-level.
3. **6.32 — tennis player-id crosswalk.** One hop, not two — pgh's tennis ids
   are ESPN athlete ids.
4. **TRACK F GATE — hard stop, operator review.** Nothing proceeds until
   approved.
5. **6.33 — the four market-history cards.** Blocked on the gate.
6. **6.29 — the model rebuild.** After Track F, with a per-sport gameplan
   written against the real trainable numbers.

### Why Track F exists, in one line

**This file claimed "the overnight sourcing run is COMPLETE" on 2026-09-01 and
it was not true.** Six of eight sports had one season of odds or less. Asked the
only question that matters — *how many games have both a price and a result?* —
the answer was ~94,000 across eight sports, against ~174,000 available. Do not
make that claim again without running that query per sport.

### Still open, unscheduled

- **Deploy Render.** `venueFactorsJob` and `injurySnapshotJob` report NEVER RUN.
- **`refreshTennisAtpJob` is failing every run** on `prop_odds_side_valid` —
  it writes `side='home'` for an `aces` market, which is over/under. WTA is
  fine, so it is ATP-path-specific.
- **`refreshSportsGameOddsJob` stale 12.6h**, 8 objects spent all month.
- **The odds-API pacing problem.** `propline` and `oddsapiio` burn their whole
  daily cap within 20–70 minutes of the 04:00 UTC reset, so both contribute
  **zero** prices during US game hours and everything they capture is 12–20
  hours pre-game. The archive is unaffected; anything running live is not.
  Note the health check reports a fully cap-blocked job as *healthy* —
  `health_check.py:105` is `ok and not stale`, which cannot see "did nothing".
- **Retention and the DB ceiling.** `prop_odds_history` wrote **265,771 rows on
  2026-09-01 alone** and has **no retention rule**; `injury_report` is ~11
  MB/day, also unbounded. Deferred by operator decision — the design depends on
  whether the archive becomes a sellable dataset.
- **The two Phase 6 gate violations** — `TeamDetail.tsx:770` `teamHref` and
  `GameDetail.tsx:2297` `renderLiveDetail`, both `sport === 'x'` in a render
  path. Verified still present 2026-09-01.
- **`docs/table-ownership.md` is stale** — lists 35 tables, none of Track E's.

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
