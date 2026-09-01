# Overnight sourcing + import — full gameplan

**Paste this whole file as the opening prompt of a new session.** It is written
to be self-contained: assume the new session has read `CLAUDE.md` and
`docs/CURRENT.md` and nothing else about this work.

**Every decision below is already made. Do not stop to ask.** If something is
genuinely ambiguous, choose the option this document calls the default, write
down what you chose and why, and keep going.

---

## 0. What is already done — do NOT redo any of this

Sourcing completed 2026-08-31. Files are on disk **outside the repo**, in
`C:\Users\occy3\Downloads\`:

| Source | Location | Contents |
|---|---|---|
| SBR NBA | `nba_odds\nba_odds_all.csv` | 19,641 games, 16 seasons 2007-08 → 2022-23 |
| SBR NHL (modern) | `nhl_odds\nhl_odds_all.csv` | 9,491 games, 2014-15 → 2022-23 |
| SBR NHL (legacy) | `nhl_odds_legacy\nhl_odds_all.csv` | 8,713 games, 2007-08 → 2013-14 |
| ESPN core (NBA+NHL) | `espn_core_odds\espn_core_odds_all.csv` | **91,055 rows, 12,016 games**, 9 blocks |
| ESPN site (superseded) | `espn_odds\espn_odds_all.csv` | 6,412 rows — **NHL half is unusable, see §7** |
| MLS | `USA.csv` / `USA.xlsx` | 6,130 matches 2012–2026, closing 1X2, **no totals** |
| Tennis ATP | `2015.xlsx` … `2026.xlsx` (12 files) | 29,597 matches |
| Tennis WTA | `2015 (1).xlsx` … `2026 (1).xlsx` (12 files) | 27,789 matches |
| NHL Kaggle | `archive.zip` | 30,688 games, 131-column feature matrix |

Scripts already written and working, in `python-odds-service/`:
- `espn_core_odds_backfill.py` — the good one. Core API, 9 NBA/NHL blocks.
- `espn_odds_backfill.py` — site API, superseded. Keep for its docstring only.

Run Python from `python-odds-service/` as `./.venv/Scripts/python.exe -u <script>`.

---

## 1. Standing decisions — already approved, no questions

1. **Seasons:** last completed season for every sport, **plus** the current
   season where one is live. As of 2026-08-31 that resolves to:
   MLB 2025+2026 · CFB 2025+2026 · EPL 2025-26+2026-27 · MLS 2025+2026 ·
   NFL 2025 · NBA 2025-26 · NHL 2025-26.
2. **Props:** pull them, **all 7 leagues, both seasons, ONE provider per game**
   (the first item that has a `propBets` ref). Measured: props exist on roughly
   25–50% of games, averaging 235–1,018 per game, ~77k requests total, ~2 hrs.
3. **Run depth:** full import into live tables. Staging is still used as an
   intermediate step — see §4 — but you are authorised to promote.
3b. **Prop storage:** props keep every PARSED field but **drop `raw_json`**.
   Game lines keep theirs (100x fewer rows). ~1.85M prop rows with raw_json
   would add 1.5–2.5 GB to a 3,141 MB database against an 8 GB ceiling; without
   it, ~300–500 MB.
3c. **Gate-failure policy:** if a gate fails for one sport, **first attempt to
   diagnose and fix it**, then re-run the gate. If the fix is not obvious or the
   re-run still fails, **quarantine that sport** — leave its rows in staging,
   unpromoted, with the failure written up — and continue with the sports that
   pass. Never widen a threshold to make a gate pass.
3d. **Out of scope tonight:** no Render deploy, no Phase 6 gate-violation fixes.
   Sourcing and import only.
4. **Migrations:** full permission. New tables, the `team_elo_history.team_id`
   type fix, the injury logger, and entity cleanup are all approved.
5. **Tennis and golf are NOT in the ESPN core odds API** (tennis 400s, golf
   returns 0 items). Do not spend time on them. Tennis is already fully sourced.
6. **Commit and push** at the end of each phase that changes tracked files.
7. **NEVER `git add docs/` or `git add -A`** — `docs/discord-community-prompt.md`
   is the operator's and must never be staged. Stage explicit paths only.

---

## 2. PHASE 1 — ESPN core game lines, the five sports not yet pulled

NBA and NHL are done (§0). This phase adds **MLB, NFL, CFB, EPL, MLS**.

Extend `espn_core_odds_backfill.py` rather than writing a new script. Add blocks:

```
mlb_2025      baseball/mlb        baseball  mlb               2025-03-20 .. 2025-11-05
mlb_2026      baseball/mlb        baseball  mlb               2026-03-20 .. 2026-09-01
nfl_2025      football/nfl        football  nfl               2025-09-01 .. 2026-02-15
cfb_2025      football/college-football  football  college-football  2025-08-20 .. 2026-01-25
cfb_2026      football/college-football  football  college-football  2026-08-20 .. 2026-09-01
epl_2025-26   soccer/eng.1        soccer    eng.1             2025-08-01 .. 2026-05-31
epl_2026-27   soccer/eng.1        soccer    eng.1             2026-08-01 .. 2026-09-01
mls_2025      soccer/usa.1        soccer    usa.1             2025-02-20 .. 2025-12-15
mls_2026      soccer/usa.1        soccer    usa.1             2026-02-20 .. 2026-09-01
```

The `sport` label derives from the site path today (`"nba" if "basketball" in
path else "nhl"`) — **that is now wrong**. Make `sport` an explicit field on the
block tuple.

Soccer is a **three-way market**. Its booksum will legitimately exceed 1.05 and
its `ml_flag` logic must not treat a draw-bearing market as broken. Add a
`draw_ml` column, populate it for soccer from the odds payload, and treat
`home+draw+away` as the booksum for soccer only.

Output to `C:\Users\occy3\Downloads\espn_core_odds_v2\`.

### ▶ GATE 1 — blocking. Do not start Phase 2 until every line passes.

Write `scripts/gate/gate1_game_lines.mjs`. It must **assert**, not print:

| # | Assertion | Threshold | Why |
|---|---|---|---|
| 1.1 | Event coverage per block | ≥ 95% of scoreboard events have ≥1 odds row | Catches a silently-empty block |
| 1.2 | Two-way booksum, per sport (not soccer) | mean between **1.02 and 1.12** | ESPN's *site* API NHL moneyline summed to **0.83** — a three-way regulation market. Anything under 1.0 is not a two-way price |
| 1.3 | Soccer three-way booksum | mean between **1.02 and 1.15** with `draw_ml` non-null on ≥90% | Proves the draw was captured, not dropped |
| 1.4 | Implied vs realised | \|mean implied home − actual home win rate\| ≤ **0.04** | The vig is ~2–3pp; a bigger gap means a mis-parse |
| 1.5 | **Distinct total lines > 20 per sport-season** | strict | The site API's NHL total was a **constant 5.5, sd exactly 0.00 across 1,400+ games**. A single-season smoke test did *not* catch this — only comparing seasons did |
| 1.6 | Over rate | between **0.46 and 0.54** per sport | A correctly-parsed closing total must land near even |
| 1.7 | Spread predicts margin | `corr(-spread, home_margin)` ≥ **0.25** | NBA reference: 0.457 |
| 1.8 | Favourite/dog split | home favourite win rate − home dog win rate ≥ **0.15** | NBA reference: 0.707 vs 0.352. The Kaggle NHL file failed this at 0.497/0.497 — it had no team orientation at all |
| 1.9 | **Overlap agreement with SBR** | on games in both, closing total within **±1.5** on ≥90% of rows | The single most valuable check: two independent sources agreeing is real evidence |
| 1.10 | No all-null column | every declared column non-null on ≥1 row | Catches a field whose path changed |

**If a gate fails:** do not "adjust the threshold". Find the cause, fix the
extraction, re-run. Record the failure and the fix in the handoff.

---

## 3. PHASE 2 — player props, all 7 leagues

Write `python-odds-service/espn_props_backfill.py`.

- Iterate the same blocks as Phase 1 **plus** the NBA/NHL blocks from §0.
- For each event, fetch the odds items; take the **first item with a
  `propBets.$ref`**. One provider per game.
- Follow the ref and **page through all pages** (`pageCount`, 25 per page).
- Each item yields: `athlete_id` (parse from the `$ref` URL — do NOT fetch the
  athlete endpoint, that is one request per prop and will triple the run),
  `type.id`, `type.name`, `current.target.value` (the line),
  `current.over/under.american`, and the same under `open`.
- Write `event_id, sport, block, provider, athlete_id, type_id, type_name,
  line, over_price, under_price, open_line, open_over_price, open_under_price,
  last_updated, raw_json`.

Concurrency 6. Expect ~77k requests, ~2 hrs. Checkpoint the CSV every 5,000
rows so a crash does not lose the run.

### ▶ GATE 2 — blocking.

| # | Assertion | Threshold |
|---|---|---|
| 2.1 | Rows written | ≥ 150,000 across all sports |
| 2.2 | Sports represented | all 7 leagues have ≥ 1,000 prop rows |
| 2.3 | `athlete_id` populated | ≥ 99% |
| 2.4 | `line` populated | ≥ 95% |
| 2.5 | Two-sided prices | over and under both present on ≥ 60%; where both exist, **booksum between 1.02 and 1.20** |
| 2.6 | Distinct `type_name` per sport | ≥ 5 |
| 2.7 | **Athlete ids resolve** | ≥ 80% of distinct `athlete_id` values exist in `player_game_history.athlete_id` for that sport |
| 2.8 | Line sanity | for a known market (e.g. NFL passing yards) the median line is within a plausible band — assert `50 < median < 400` |

2.7 is the important one. If athlete ids do not join, the props are unusable
regardless of how many rows landed, and you need an id-mapping pass before
anything is imported.

---

## 4. PHASE 3 — schema

Create migrations in `supabase/migrations/`. Apply with `node runmig.mjs <path>`.

**All new tables are sport-keyed with a `sport` column. Do NOT create per-sport
tables** — it inverts the repo's core convention (see `CLAUDE.md`); one
`player_game_history` already carries 9 sport keys and 2.76M rows.

1. **`odds_archive`** — immutable historical game lines.
   `(sport, event_ref, game_date, home_team_raw, away_team_raw, home_team_id,
   away_team_id, market, side, line, price, open_line, open_price,
   bookmaker, provider, source, source_priority, booksum, ml_flag, raw_json,
   ingested_at)`. Natural-key unique index on
   `(sport, game_date, home_team_id, away_team_id, market, side, bookmaker, source)`.
2. **`prop_odds_archive`** — same idea for props, keyed by athlete + type + line.
3. **`game_result`** — natural-keyed final scores.
   Justified because the new sources cover games `player_game_history` does not:
   **NHL 2020-21 is entirely absent from the database** and ESPN has it.
4. **`injury_report`** — daily snapshot, `(sport, captured_at, team_id,
   athlete_id, athlete_name, status, detail, raw_json)`.
5. **Staging tables** — `odds_import_staging`, `prop_import_staging`, same
   columns plus `resolution_status` and `resolution_note`.
6. **`team_elo_history.team_id` integer → text.** It is the only id column in
   the database that is not text; every join out of Elo needs a cast today.
   Back the table up first, migrate, verify row count unchanged.

`source_priority` (higher wins on conflict):
```
100  SBR                 real closing lines, both sides, 2007-2023
 90  ESPN core API       many books, open+close, verified two-way
 80  nflverse / CFBD     free, authoritative for their sport
 70  football-data       closing 1X2, multi-book
 60  tennis-data         closing match odds
 50  ESPN site API       LOW - see §7
 40  Kaggle NHL          favourite-only ML, no orientation
```

### ▶ GATE 3 — blocking.
- Every migration applied, `\d` shows the expected columns.
- `team_elo_history` row count **exactly 88,802** after the type change.
- Every TS/Python read of `team_elo_history` still returns rows — run
  `npm test` and confirm **339 passing, 0 fail**.
- `npx tsc --noEmit` clean and `npm run build` clean.

---

## 5. PHASE 4 — load to staging, resolve, then promote

**Load every source into staging first, resolve, and only then promote.** You
have permission to promote; you do not have permission to promote unresolved rows.

### Resolution rules — these are not optional

1. **There is no shared game id anywhere.** Verified: Kaggle NHL ids are ESPN
   format (`401131020`); `player_game_history` NHL ids are NHL-API format
   (`2024020653`); they do **not** join. SBR has no id at all.
   → Resolve on the natural key `(sport, date, home_team, away_team)`.
2. **Date tolerance ±1 day.** SBR dates carry no year *and* no timezone; a 7pm
   ET game is the next day in UTC. Without the tolerance a large fraction
   silently fails to match.
3. **Canonicalise team names through the existing maps** —
   `lib/sports/shared/teamNameMatch.ts` and
   `python-odds-service/src/entity_resolution.py`. SBR writes `LALakers`,
   `GoldenState`, `TampaBay`; the MLS file writes `Atlanta Utd`.
   **`tests/config-drift.test.ts` asserts the two maps are identical — add to
   both or neither.**
4. **Filter the phantom NBA team ids** `111353`, `111386`, `112151` (six digits
   among one- and two-digit real ones; 63 rows, All-Star/exhibition teams).
5. **Filter Kaggle preseason** before comparing counts — its 2021-22 span
   starts 2021-09-25 vs SBR's 2021-10-12, which reads as a discrepancy but is not.
6. **Tennis odds are Winner/Loser oriented.** `AvgW` is by definition the price
   on the player who won. **De-randomise into player1/player2 in the loader**,
   before anything else touches it, or the target leaks into the column name and
   any model trained on it scores ~100% and is worthless.
7. **`ON CONFLICT (natural key) DO UPDATE` guarded by `source_priority`** so a
   re-run is idempotent and a better source supersedes a worse one.
8. Anything unresolved goes to the staging table with a `resolution_note`.
   **Never drop it and never force-insert it.**

### ▶ GATE 4 — blocking, run BEFORE promoting.

| # | Assertion | Threshold |
|---|---|---|
| 4.1 | Resolution rate | ≥ 90% of staged rows resolve to a team pair |
| 4.2 | Unresolved rows | all carry a non-null `resolution_note` |
| 4.3 | **No duplicate natural keys** in staging after resolution | strict |
| 4.4 | Date sanity | no `game_date` outside its block's declared range |
| 4.5 | Cross-source agreement | on games present in both SBR and ESPN core, closing total agrees within ±1.5 on ≥90%, and the moneyline favourite is the **same team** on ≥95% |
| 4.6 | Score agreement | where both sources carry final scores, they match on ≥99% |
| 4.7 | Tennis orientation | after de-randomisation, `player1` wins ≈ **50%** (0.45–0.55). If it is near 1.00 the leak is still there — **stop** |
| 4.8 | Team coverage | distinct resolved teams per sport-season equals the real league size (NBA 30, NHL 32, EPL 20, MLS 30, NFL 32) |

4.7 and 4.5 are the two that would let a silent disaster through. Do not skip them.

### ▶ GATE 5 — blocking, run AFTER promoting.

- `odds_archive` row count equals staged-resolved count.
- Re-run every Gate 1 assertion **against the live table** rather than the CSV.
- `SELECT sport, count(*), min(game_date), max(game_date) FROM odds_archive
  GROUP BY 1` — every sport present, spans plausible.
- No row in `odds_archive` has `ml_flag = 'sub_one_not_two_way'` for a
  two-way sport.
- DB size grew by a plausible amount (it was **3,141 MB** before; note
  `player_game_history` alone is 1,590 MB).

---

## 6. PHASE 5 — injury logger + cleanup

1. **Injury snapshot job.** ESPN injuries are *already fetched daily* and
   discarded — `snapshot_cache` currently holds `espn-nfl-injuries` (8.9 MB),
   `espnTeamSport:injuries:basketball:nba`, `:hockey:nhl`,
   `:college-football`, and 8 MLB keys. A retention rule deletes the MLB ones
   after 2 days. **This is not new ingestion — it is an append-only write beside
   a fetch that already happens.** Add `injurySnapshotJob` to `JOB_REGISTRY`,
   daily. Follow the job architecture in `CLAUDE.md`.
2. **Entity cleanup** — alias maps (both languages), phantom-id filter.
3. Leave alone: `pick_history`'s 374,558 rows (that is the audit record),
   `snapshot_cache` payload sizes, the 31 MB of backup tables (**not** a space
   win — the DB is 3,141 MB and `player_game_history` is half of it).

### ▶ GATE 6
- `injury_report` has ≥ 1 row per sport after one manual run.
- `npm test` still **339+ passing, 0 fail**; `tsc` and `build` clean.
- `python-odds-service/src/health_check.py` reports the new job.

---

## 7. Gotchas — every one of these cost real time this session

**Validate against outcomes, never against row counts.** Three conclusions were
wrong this session and every one was caught this way:
- OddsHarvester historic was declared "broken, 0 rows". It was not — the reader
  checked `.data` and `ScrapeResult` has **`.success` / `.failed` / `.partial` /
  `.stats`**. It actually works at 100% success.
- ESPN NHL totals were declared "validated" off a one-season smoke test with an
  over rate of 0.504. Across three seasons it was a **constant 5.5**, sd 0.00.
  The smoke season's real scoring simply happened to sit near the constant.
- Props were declared "absent for NBA/NHL/CFB". They exist on 25–50% of games —
  the check tested whether the field existed instead of resolving the ref.

**Scale changes answers. A one-season smoke test is not validation.**

Other traps, all real:
- **A missing SBR season 301s to the homepage**, which still returns HTTP 200,
  so `raise_for_status()` does not catch it. Check the final URL.
- **`pd.read_html` needs `header=0`** on SBR pages — no `<thead>`, so columns
  come back as `0..12` and every `.get("VH")` returns None, parsing **zero games
  silently**.
- **Column headers lie.** On SBR's NHL pages `CloseOU` is the *opening total*
  and the closing total sits in `Unnamed: 14`. Identify columns **by value
  distribution**, not by name.
- **Long heredocs break in this shell.** Use the Write tool. `CURRENT.md` failed
  this way twice.
- **Backticks in `git commit -m` get shell-substituted** — use `-F`.
- **Set `PYTHONUTF8=1`** for any Python touching non-ASCII.
- **The DB pool caps at 15 connections** — close every `.mjs` client.
- A **new server-only module** under `lib/sports/shared/` needs entries in
  **both** `SELF` and `DB_MODULES` in `tests/client-bundle-boundary.test.ts`.

---

## 8. Completion criteria

Done when all of the following are true:

1. Gates 1–6 all pass, with the actual numbers written into the handoff.
2. `odds_archive` carries game lines for **all 7 leagues**.
3. `prop_odds_archive` carries props for **all 7 leagues**, athlete ids joining
   at ≥80%.
4. `game_result` covers NHL 2020-21, which the database did not have at all.
5. `injury_report` is accruing daily.
6. `npm test` 339+ passing, `tsc` clean, `npm run build` clean.
7. `docs/CURRENT.md` rewritten (not appended) with what landed, what failed,
   and the next actions.
8. Everything committed and pushed. **Explicit paths only — never `git add -A`.**

**Do not stop for approval between phases.** Stop only if a gate fails in a way
you cannot diagnose, or if a migration would destroy data. In either case write
the state to `docs/CURRENT.md` before stopping.
