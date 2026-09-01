# CURRENT — pick up here

**The overnight sourcing + import run is COMPLETE.** `odds_archive` holds
**635,191 game-line rows** and `prop_odds_archive` **1,805,340 prop rows**,
both across all seven leagues; `injury_report` is accruing daily. **Every gate
passes: 1, 2, 2.7, 3, 4, 5 and 6.**

Read `docs/overnight-sourcing-gameplan.md` for the plan this executed, and
`docs/phase6-completion-plan.md` for the page work that preceded it. Trust
`git log` over this file if they disagree.

## 1. What landed (2026-08-31 → 09-01)

| Phase | Result |
|---|---|
| 1 · Game lines | **11,577 rows / 7,183 games** added for MLB, NFL, CFB, EPL, MLS. Total 102,632 rows, 18 blocks, 7 sports. **GATE 1 PASSED** |
| 2 · Props | **3,681,061 scraped, 1,805,340 loaded**, 550,669 two-sided. **GATES 2 + 2.7 PASSED** |
| 3 · Schema | 5 new tables + the Elo id fix. **GATE 3 PASSED** |
| 4 · Import | **635,191 rows promoted** into `odds_archive`. **GATES 4 + 5 PASSED** |
| 5 · Injuries | `injurySnapshotJob` live, 1,265 rows first capture. **GATE 6 PASSED** |

`tsc` clean, **339 tests, 0 fail**, throughout. DB **3,141 → 3,533 MB**.

### `odds_archive` contents

```
cfb        espn_core     8,128   2025-08-23 -> 2026-08-30
mlb        espn_core    33,454   2025-03-20 -> 2026-09-02
nba        espn_core   205,905   2022-10-18 -> 2026-06-14
nba        sbr          97,778   2007-10-30 -> 2023-01-16
nfl        espn_core     2,199   2025-09-05 -> 2026-02-08
nhl        espn_core   240,458   2021-01-13 -> 2026-06-15
nhl        sbr          35,750   2007-09-29 -> 2022-11-27
soccer_epl espn_core     3,253   2025-08-15 -> 2026-08-31
soccer_mls espn_core     8,268   2025-02-22 -> 2026-08-30
```

## 2. THE SINGLE MOST IMPORTANT THING TO CARRY FORWARD

**A numeric id matching the expected SHAPE is not evidence it is the right id.**
This file has warned about that for weeks. It nearly cost the whole NHL import.

**30 of 39 ESPN NHL team ids "matched" `player_game_history` — and that was a
lie.** In the NHL API Toronto is 10; in ESPN, **Montreal is 10**. Tested against
real dates, **0 of 25 (date, espn_id) pairs actually existed**. A numeric join
would have filed Montreal's odds under Toronto silently, forever. Resolved by
triCode instead.

The general rule that came out of it: **verify an id system per sport, by
joining on a real date, not by counting overlaps.** The answer differs by
loader — NBA/NFL/CFB/EPL/MLS carry ESPN ids because `game_context.py` loads them
through ESPN; MLB carries StatsAPI ids (0 of 31 ESPN ids join); NHL carries
NHL-API ids.

**And validate against outcomes, never against row counts.** Six separate wrong
conclusions were caught that way in two days:

1. **OddsHarvester historic "returns 0 rows, broken."** It does not.
   `ScrapeResult` exposes `.success`/`.failed`/`.partial`/`.stats` and has no
   `.data`; the reader was checking a field that never existed. It works at
   100% success, 2.66s/game.
2. **ESPN NHL totals "validated"** off a one-season smoke test with a 0.504 over
   rate. Across three seasons it was a **constant 5.5, sd exactly 0.00**. The
   smoke season's real scoring happened to sit next to the constant.
3. **Props "absent for NBA/NHL/CFB."** They exist on 25–50% of games; the check
   tested whether the field existed instead of resolving the `$ref`.
4. **"Same favourite" at 81.7%** — caused by averaging **American odds**. One
   +5000 longshot drags the mean past every real price (mean gap came out at
   2,528). Average **implied probabilities**: 96.8%.
5. **4,022 "duplicate" keys** were **doubleheaders** — two real ESPN event ids,
   same teams, same day. `event_ref` belongs in the natural key.
6. **`injury_report` captured 1,265 rows with `athlete_id` 0.0%.** The athlete
   object on that endpoint has **no `id` field**; the id exists only inside a
   link href. Without parsing it the table cannot join to players at all.

**Scale changes answers. A one-season smoke test is not validation.**

## 3. NEXT ACTIONS, in order

1. **Build the MLB + NHL athlete crosswalk.** 1.3M loaded prop rows cannot
   reach a player without it (§4). The team-id equivalent is already solved in
   `import_odds_staging.py` — same shape, athlete instead of team.
2. **Re-run Gate 1.9.** It matched 0 rows and is still inert: SBR writes
   `LALakers`, ESPN writes `Los Angeles Lakers`. Entity resolution now exists in
   `import_odds_staging.py`, so 1.9 can finally do the cross-source check
   against resolved ids rather than raw names.
3. **Load tennis** — 57,386 matches sitting in `Downloads` and untouched. It is
   a PLAYER entity, not a team pair, so the team-shaped importer skips it.
   **The Winner/Loser de-randomisation is mandatory before it loads** (Gate 4.7).
4. **Populate `game_result`** — the table exists and is empty. It is what makes
   Gate 4.6 (score agreement) runnable, and it is the only place NHL 2020-21
   scores can live, since `player_game_history` has no NHL rows for that season.
5. **Deploy Render.** `794240d`, `venueFactorsJob` and now `injurySnapshotJob`
   are all undeployed. Four ingest jobs still report **NEVER RUN**.
6. **The two Phase 6 gate violations** — `TeamDetail`'s `teamHref` and
   `GameDetail`'s `renderLiveDetail`, both `sport === 'x'` in a render path.

## 4. Props: loaded, with one real gap

**3,681,061 rows scraped → 1,805,340 loaded** into `prop_odds_archive`.
Database **3,533 → 4,045 MB**, comfortably inside the 8 GB ceiling.

```
mlb        1,244,476  athletes 1172  types 36  two-sided 443,990
nba          210,489  athletes  355  types 41  two-sided  36,008
nfl          156,884  athletes 1030  types 70  two-sided  21,913
nhl           68,880  athletes  885  types 20  two-sided  48,758
soccer_epl    63,839  athletes  528  types 66  two-sided       0
cfb           45,000  athletes 1253  types 12  two-sided       0
soccer_mls    15,772  athletes   60  types 61  two-sided       0
```

**Both sides were there all along, and I read it wrong first.** The CSV shows
697,032 over-only rows, 563,009 under-only and ZERO with both, which I reported
as "ESPN publishes one side per prop". It publishes one side per **item** — the
two items share `(event, athlete, type, line)`. Merging on that key gives
**550,669 two-sided props** with booksums of 1.066–1.079. The unique index found
this, not inspection.

**819,262 rows (22.3%) were dropped** because they carry neither a line nor a
price. Verified at source: every `current` shape across six pages of a real MLB
game is either `{target}` or `{}`.

**THE REAL GAP: MLB and NHL athlete ids resolve at 0.0%.** Same id-system split
already found for teams — `player_game_history` carries StatsAPI and NHL-API
athlete ids while ESPN carries its own. NBA 100%, CFB 99.6%, NFL 99.0%,
EPL 88.4%, MLS 86.7%. **That leaves 1.3M MLB and NHL prop rows unable to join to
a player until an athlete crosswalk exists** — and MLB is the largest block, so
this is the highest-value next fix.

## 5. Blocked, and why — do not re-attempt without new data

**Tennis and golf have no ESPN core odds.** Tennis 400s (its events are
tournaments, not matches); golf returns 0 items. Tennis is fully sourced from
tennis-data files instead; golf has no game model planned.

**SBR is frozen after 2022-23**, and NHL 2020-21 is missing from it entirely —
which ESPN covers, so that hole is closed.

**MLS has no totals** in the football-data file (1X2 only) — but ESPN core
supplies them, so this is also closed.

**No non-MLB game model exists.** Unchanged, and it still blocks win
probability, simulation density and "why the model likes it" beyond MLB.

## 6. Things that will bite again

- **Verify an id system per sport by joining on a real date.** See §2.
- **Never average American odds.** They are not linear. Average implied
  probabilities.
- **Zero is a placeholder, not a value.** ESPN writes `close_total == 0` on all
  4,046 MLB rows carrying a close block and `close_home_ml == 0` on 1,233.
  Coalescing them as real put the MLB total mean at 3.71 against a true 8.47. A
  spread of 0 is still legitimate (pick'em).
- **A 50% over rate only holds when both sides are priced symmetrically.** NBA
  is −105/−102 but NHL is −69/−26 and MLS −52/−19. Compare the realised over
  rate to the **price-implied** probability, not to 0.50.
- **SBR names the CITY; ESPN names "City Nickname".** Matching only the nickname
  tail left NBA at 67.8% resolved; prefix matching with a unique-hit rule took
  it to 99.84%.
- **SBR dates are LOCAL with no timezone; ESPN's are UTC.** Matches cluster at
  **+1 day**, not 0. Always allow ±1 and derive the real offset.
- **Doubleheaders are real.** `event_ref` belongs in any game natural key.
- **`pd.read_html` needs `header=0`** on SBR pages — no `<thead>`, so columns
  come back as `0..12` and every `.get("VH")` returns None, parsing zero games
  silently.
- **Column headers lie.** On SBR's NHL pages `CloseOU` is the *opening* total
  and the closing total sits in `Unnamed: 14`. Identify columns by value
  distribution.
- **A missing SBR season 301s to the homepage**, which still returns 200, so
  `raise_for_status()` does not catch it. Check the final URL.
- **Do not hand-roll a CSV parser in JS.** Gate 1 OOM'd at 4 GB then 6 GB on
  102k rows before being rewritten in pandas, which reads it in seconds.
- **Long heredocs break in this shell** — and `\n` inside one arrives as a real
  newline, which silently broke two patch scripts today. Use the Write/Edit
  tools.
- **Backticks in `git commit -m` get shell-substituted** — use `-F`, and put the
  message file in the scratchpad, not `/tmp`.
- **`.gitignore`'s scratch patterns match at ANY depth.** `gate*.mjs` was hiding
  real scripts under `scripts/`; `!scripts/**` now un-ignores them.
- **The DB pool caps at 15 connections.** Close every `.mjs` client.
- **Never `git add -A` or `git add docs/`** — `docs/discord-community-prompt.md`
  is the operator's.

## 7. Operational knowledge

- **Gates:** `python scripts/gate/gate1_game_lines.py`,
  `gate2_props.py`, `node scripts/gate/gate4_staging.mjs`,
  `gate5_archive.mjs`, `gate6_injury_job.mjs`. Promotion is
  `node scripts/gate/promote_odds.mjs` (dedupes, then `ON CONFLICT DO NOTHING`).
- **Re-import:** `python-odds-service/import_odds_staging.py --truncate`.
  Idempotent; re-running is safe.
- **Migrations:** `node runmig.mjs <path>`.
- **Python:** from `python-odds-service/`, `./.venv/Scripts/python.exe -u <script>`.
- **Tests:** `npm test` (339).
- **Source files** live in `C:\Users\occy3\Downloads\` — `nba_odds/`,
  `nhl_odds/`, `nhl_odds_legacy/`, `espn_core_odds/`, `espn_core_odds_v2/`,
  `espn_props/`, `USA.csv` (MLS), 24 tennis `.xlsx`, `archive.zip` (NHL Kaggle).
- **Render:** worker `srv-da36bm2bkg8c73fqrdeg`, `autoDeploy: no`. Still undeployed.
- **Supabase PRO**, 8 GB ceiling, currently 3,533 MB.

## 8. Source priority — higher wins on conflict

```
100  SBR              real closing lines, both sides, 2007-2023
 90  ESPN core API    many books, open+close, verified two-way
 80  nflverse / CFBD  free, authoritative for their sport
 70  football-data    closing 1X2, multi-book
 60  tennis-data      closing match odds
 50  ESPN site API    LOW — NHL moneyline is 3-way regulation (booksum 0.83)
                      and its NHL total is a constant 5.5 placeholder
 40  Kaggle NHL       favourite-only price, no team orientation at all
```

## 9. Known not done

1. **MLB + NHL props cannot join to players** — 1.3M rows, athlete crosswalk missing.
2. **Tennis not loaded** — de-randomisation required first.
3. **`game_result` empty** — Gate 4.6 cannot run until it is populated.
4. **Gate 1.9 inert** — re-run now that entities resolve.
5. **2,206 unresolved staging rows** kept with a `resolution_note`:
   `unresolved_team` 1,570, `defunct_or_relocated_franchise` 410,
   `phantom_abbr` 226. Never promoted, never dropped.
6. **Render undeployed**; four ingest jobs report NEVER RUN.
7. **Two Phase 6 gate violations** remain.
8. **CFB/NBA/NHL/tennis pages never walked** — out of season.
9. `/diagnostics`, `/bets` and every signed-in surface unverified — no credentials.
