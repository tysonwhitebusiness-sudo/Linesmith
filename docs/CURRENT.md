# CURRENT — pick up here

**Phase 5: COMPLETE, gate PASSED** (`f8e60b5`).
**Phase 4: COMPLETE, gate PASSED** (2026-08-29, after failing G7 and re-running
in full from G1 per Rule 5).

**Phase 6 has started — design direction agreed, nothing built yet.** See §6.

## The documents, in reading order

1. `CLAUDE.md` — conventions. Read the caching and table-ownership sections.
2. `docs/audit-remediation-plan.md` — the plan. §0 holds standing decisions
   Q1–Q40; §11 is the phase log and the only place a task counts as done. The
   **Phase 4 GATE** entry at the end of §11 is the one to read before touching
   any model code.
3. This file — where the work actually is.

Trust §11 and `git log` over this file if they disagree.

## 1. What just happened

Phase 4's thirteen tasks were all implemented and marked done. The gate then
found **five real defects in that "done" work**, four of them in code that had
already passed its own VERIFY. Three needed operator decisions (Q38, Q39, Q40),
and Q40 **reversed** a decision the operator had already given, because the
number I gave them to decide on was wrong.

Final gate results: G1 8/8 · G2 tsc+build+48 TS tests+20 Python tests · G3 pass
(found the home-page defect) · G4 5/5 · G5 8/8 · G6 pass (one orphan deleted) ·
G7 pass after five fixes · G8 signed off with a ten-item "known not done".

### Read this before writing another VERIFY

**All five defects passed a VERIFY that measured the WRITE and never the READ.**

- 4.3 verified "model_calibration is no longer empty" — nothing applied the rows.
- 4.8 filtered three readers — six more still blended the deleted model in.
- 4.11 verified the module imports — a second call site raised NameError.
- 4.2 shipped an activation gate — it approved a model with every feature zeroed.

A VERIFY that ends at "the row exists" cannot see whether anything consumes it.
The tests added by this gate assert the **wiring**, not the function:
`test_prop_calibration_applied.py` reads the job's own source and asserts the
call lands ahead of both writers; `tests/model-source-filter.test.ts` fails if an
eleventh scoring reader is added without the filter; `test_name_resolution.py`
reads LOAD_GLOBAL opcodes from functions too expensive for CI to execute. All
three are fault-injected — each fails by name when its target is removed.

## 2. What is running

Nothing. No fit, no backfill, no gate script. Two `harvester_scrape.py` Windows
scheduled tasks on their usual ~20-minute cycle.

Worker live on the latest commit; the Q39 calibration is confirmed running in
production from the worker's own logs.

## 3. Next actions

1. **Phase 6, starting with the chart primitives library** — §6 has the whole
   direction, the open question, and the artifact to look at first.
2. **5.1's second VERIFY half**, after 00:00 UTC — the one carried item from
   Phase 5. `propline` was correctly gated at 1000/1000 for 2026-08-29:
   ```sql
   SELECT market_key, count(*) FROM prop_odds
    WHERE provider_id='propline' AND fetched_at > '2026-08-30'
    GROUP BY market_key ORDER BY 2 DESC;
   ```
   Before the fix this returned exactly one MLB market (`pitcher-strikeouts`).
3. **The duplicate-React-key bug** — §6 item 1. Pre-existing, one-line fix,
   unowned, and it can silently drop rows from the board.

## 4. Things that will bite again

**THE LESSON THIS GATE PAID FOR:** *a guardrail that has never rejected anything
is not known to work — and "beats its own baseline" is not a guardrail when the
baseline is worse than a constant.* The activation gate had shipped, been
reviewed, and been described in three comments as a working protection. Running
it against a deliberately worthless model showed it approved one:

```
[fit moneyline] beats own baseline: True   holdout Brier 0.248824
                baseline holdout 0.260666  ACTIVATED True
```

0.248824 is exactly what a constant at the base rate scores. The app's own
unfitted formula scores *worse than knowing nothing*, so anything cleared it.

**THE ONE BEFORE IT:** *a dead consumer cannot report that its input vanished.*
Four instances now — 5.3 renamed bookmakers under a `clv_backtest` nobody
called; 4.11 changed a distribution under weights nobody re-fitted; 4.8 filtered
three readers and missed six; 4.3 fitted calibrations for markets nobody
calibrates. **After any change that renames or re-derives a value, grep the tree
for consumers, including code nothing currently calls.**

**AND: quote the number the decision actually rests on.** I told the operator
the MLB total mismatch was "up to 11 points" — that was the shift on an *input*
to a regression, and they authorised a multi-hour re-fit on it. Propagated
through the real fitted weights the output shift is **1.03 points**. The re-fit
would also have made things worse. Found only because they asked "why do we even
need to re-fit at all". **Propagate the number to the thing a user sees before
putting it in front of someone.**

- **Measure before sizing work.** Training-set builds cost ~26 min/season and I
  had extrapolated that from one uncertain wall-clock reading.
  `scripts/gate/probe-training-set-cost.py` found the answer in 90 seconds: 55%
  of per-game time was ONE Postgres round trip per game. Now one query per
  season, ~2.2x. The HTTP calls plateau at 140 and were never the problem.
- **Fault injection is easy to fake — four occurrences.** Never accept "the
  operation failed" as evidence; assert WHY.
- **`ps aux | grep` in Git Bash does not show command lines.** Cost a wrong "the
  process died" call; a run was alive the whole time and raced its replacement.
  Use `Get-CimInstance Win32_Process` and read `CommandLine`.
- **Backgrounding `cd X && cmd &` backgrounds the `cd` too.**
- **Different tables, different vocabulary.** `pick_history.sport` is `'soccer'`;
  `player_game_history` uses `soccer_epl`/`soccer_mls`. `game_picks` has
  `ml_initial_market_prob`, not `market_prob`. The G1 script asserted the wrong
  one and failed loudly — which is why it is a script.
- **A deploy does NOT mean every writer runs the new code.** OddsHarvester runs
  as Windows scheduled tasks (~20-min cycle) and Python binds imports at process
  start. Any migration normalising a column needs re-applying after they cycle.
- **The plan's own task text goes stale, repeatedly.** Measure first.
- **`withJobLock` is a LEASE TABLE, not an advisory lock.**
- **Postgres UNIQUE treats NULLs as distinct.**
- **A long heredoc breaks this shell** (>~120 lines → "unexpected EOF").
- **`cd` persists between Bash calls.** Use absolute paths.
- **Stale `.next/types` break `tsc` after deleting a route** — `rm -rf .next/types`.

## 5. Operational knowledge

- **DB access:** temp `.mjs` in the repo root, `node` it. `q*.mjs`, `g*.mjs`,
  `gate*.mjs`, `runmig.mjs` are gitignored for this. `.env.local` has no
  `DIRECT_URL`, so DDL also goes through `:6543` — it has worked for every
  migration so far, `COMMENT ON` included.
- **Tests:** `npm test` (**48**) and `./.venv/Scripts/python.exe -u src/test_x.py`
  from `python-odds-service/`. **20** hermetic Python tests, one CI step each.
  There is **no pytest** in the venv — they are standalone scripts.
- **Gate scripts** (`scripts/gate/`): `phase-4-g1-verifies.mjs`,
  `phase-4-g4-g5.mjs`, `phase-4-weak-model-refused.py` (~35 min, real fit),
  `phase-4-shadow-roundtrip.mjs`, `probe-training-set-cost.py`,
  `phase-5-constraints.mjs`, `phase-5-budget-race.mjs`.
  `phase-4-refit-total.py` exists but **Q40 says do not run it** without also
  changing `odds_lines_cycle.py:491` — read Q40 first.
- **Render:** worker `srv-da36bm2bkg8c73fqrdeg`, `autoDeploy: no`. After any push
  touching `python-odds-service/`: `POST /v1/services/$SRV/deploys` with
  `RENDER_API_KEY` from `.env.local`, then confirm `"status":"live"` on your
  commit sha. ~90s. Worker logs via `GET /v1/logs?resource=$SRV&text=...` — the
  best end-to-end evidence available, and better than a deploy status.
- **Propline budget:** `propline` 1000/day (MLB), `propline_2` 1000/day
  (soccer), genuinely separate. **18 of ~20 authorised `propline_2` probe calls
  spent** capturing `docs/propline-live-capture-20260829.json` — reuse it.
- **No `gh` CLI and no GitHub token.** CI via the public Actions API.
- **Don't `git add -A` blindly** — `docs/discord-community-prompt.md` is the
  operator's.

## 6. Phase 6 design direction (2026-08-29)

**Agreed with the operator this session. No code written yet.** The operator's
framing: Phase 6's goal is *"extensive amounts of player and team data so users
can make educated guesses and see all the data in one place"*, with **premium
graphs and visualisation rather than raw numbers**, and a UI that "looks and
feels smooth and premium".

### The decision: a chart grammar, not more charts

Build `components/charts/` — a shared primitives library — **before** any Phase 6
feature chart. Two pieces first: a `ChartFrame` (axes, grid, empty state,
loading, tooltip) and `useChartCrosshair` (hover synced across every chart in a
panel). Then eleven primitives:

| # | Primitive | Job |
|---|---|---|
| 01 | `Sparkline` | trend at table-row scale, no axes |
| 02 | `SeriesChart` | the one real line chart (line movement); emphasis + grey context |
| 03 | `DistributionBars` | per-game results vs a line — **already exists** as `DistributionChart`, `PlayerDetail.tsx:129` |
| 04 | `DensityCurve` | where one value sits in a population |
| 05 | `PercentileRail` | ranked stats — the radar-chart replacement |
| 06 | `HeatGrid` | splits matrix; strike-zone grid is the same primitive at a different aspect |
| 07 | `RangeBar` | book dispersion |
| 08 | `ContributionBars` | signed model contributions — "why the model likes this" |
| 09 | `StatTable` | dense stat block, heat bar *behind* the number (bar-in-cell) |
| 10 | `StreakStrip` | run of binary outcomes, opacity ramping to the present |
| 11 | `SplitDumbbell` | A vs B on one shared scale (platoon, home/away) |

**Why, in this repo's own terms:** `package.json` has **no chart library** — only
`motion`, imported by exactly one file (`MatchupExplorerCard.tsx`). Hand-rolled
SVG is the right call for a premium look; a library would make it look like every
other tool in the category. But ten bespoke charts will drift exactly the way the
four hand-written provider-job bodies drifted before `run_provider_specs`, and
the way three duplicated page components drifted before the sport adapters. Both
precedents are already in `CLAUDE.md`. This is the same argument a third time.

**Second constraint:** `PlayerDetail.tsx` is 106KB and `GameDetail.tsx` is 105KB.
A dozen inline charts makes both unworkable. The library is the only way the
scope fits.

### The mockup

**Open `docs/design/chart-grammar.html`** — committed, self-contained, no build
step and no dependencies except a Google Fonts link that degrades to system
fonts offline. Double-click it, or serve it (`.claude/launch.json`'s
`design-preview` config serves `C:/Users/occy3/Downloads`, so copy it there).
**This file is the reference, not the artifact link below.**

There is also a published artifact at
https://claude.ai/code/artifact/845e36d0-037c-4859-af5b-185a6aba795c — but
**artifacts are private to the account that published them.** This project runs
across three rotating accounts; only the account that published it (the one used
on 2026-08-29) can open or update that URL. From any other account the link is
dead, and re-publishing the file creates a *separate* artifact owned by that
account, which is fine — just don't expect the old URL to update. The committed
HTML is the single source of truth; the artifact is a convenience.

All eleven primitives rendered in the app's real tokens, plus a **full-depth
Player Detail** — ~190 numbers on one page: nine ranked season stats, eleven
Statcast metrics with percentiles, a 10×5 splits grid, five platoon comparisons,
nine zone cells, five pitch types, a twelve-game log, seven opposing-pitcher
rates, career matchup, park and weather, six book prices, seven model
contributions. Data is representative, not live — the frame carries a visible
banner saying so.

The first composed screen was rejected by the operator as *"doesn't have any
stats / not nearly as in depth from a stats and visual standpoint"*. That
rejection is the useful part: **depth is the product**, and a page that only
demonstrates the primitives misses the point.

### THE OPEN QUESTION — resume here

The operator's words: *"concerned with how we will get an every other sport
equivalent."* The deep page above is **MLB only**, and MLB is the sport with the
richest public data. The unanswered question is what the equivalent depth is for
NFL, NBA, NHL, CFB, soccer, tennis and golf — and how it lands inside the
existing sport-adapter convention, where `PlayerDetailData` is **one shared
interface owned by the MLB adapter** (`lib/sports/mlb/adapters/playerDetailAdapter.ts`).

The tension is real and is not resolved: a genuinely deep MLB page implies a lot
of MLB-shaped slots (pitch mix, strike zone, platoon, park factors), and
`CLAUDE.md`'s rule §4 says a sport that has no equivalent sets the field `null`
and the component renders nothing. Do that naively across seven sports and the
other pages are *empty*, which is exactly the "every other sport equivalent"
worry. **Do not start building until this is answered** — see the handoff prompt
in `docs/design/phase6-handoff-prompt.md`.

### Two design-system findings, measured this session

1. **`lib/ui/heat.ts` — `FILL_STOPS` is a diverging ramp with a *hue* at its
   midpoint.** Ran the poles through a CVD validator: they **PASS** at deutan
   ΔE 8.4 against a floor of 8.0 — a genuinely well-chosen red/green pair, but
   clearing by only 0.4, so secondary encoding (sign, position, a visible
   number) is required wherever the ramp does real work. The actual defect is
   that **amber asserts "caution" where the data only says "average"**, and amber
   is the one stop failing contrast at 2.87:1. `COMPARE_STOPS` already gets this
   right (red → neutral grey → green) and its own comment reasons it out
   correctly — the reasoning was never carried back to the fill ramp. Lightness
   runs 54.9 → 68.0 → 51.3: correct arch for *diverging* use, wrong for the
   *sequential* `heatTile` splits-grid case, where a monotonic single-hue ramp is
   needed. **Caveat, so nobody re-litigates it:** running the neutral-midpoint
   version through the validator returns `[FAIL] Chroma floor` on the grey. That
   check is scoped to *categorical* palettes; a diverging midpoint is supposed to
   be achromatic. The FAIL is the tool applying the wrong rule.

2. **`card` (oklch 93%) is DARKER than `paper` (oklch 96%)** in
   `tailwind.config.ts`. Pre-reskin it was page `#f7f5f0` / card `#FFFFFF` —
   cards sat *above* the page, which is what a card is. The graphite reskin held
   paper and dropped card, inverting the elevation model that `shadow-card` and
   `.lb-card-hero` assume; `surface-subtle` (96%) is then *lighter* than the card
   it insets into. It reads fine as recessed panels — but confirm it was chosen
   rather than inherited from a find-and-replace.

## 7. Known not done — carried into Phase 6

1. **Duplicate React keys can silently omit prop rows.** Console shows many
   `Encountered two children with the same key` errors (`mlb:672515:total-bases:over`,
   `soccer:espn:soccer:222396:anytime-goalscorer:yes`). React's own message says
   children "may be duplicated and/or omitted" — correctness, not noise. The key
   at `GolfScheduleView.tsx:1244` and `TennisScheduleView.tsx:529` omits the game
   id, and a player legitimately has candidates for two games (834 soccer players
   measured; MLB doubleheaders too). **Pre-existing, not a Phase 4/5 regression**
   — the key last changed 2026-08-27 (`2913d81`). One-line fix; unowned.
2. **MLB total residual, ~1 point** — Q40, accepted deliberately.
3. **`fit_moneyline_weights` and `market_gate` are on no automatic path.**
   `/api/props/fit-weights` (TypeScript) is still the only way to fit moneyline.
4. **5.1's second VERIFY half** — §3 item 2.
5. **`/diagnostics`, `/bets` and the signed-in walk were never verified** — no
   credentials; creating an account or entering a password is out of bounds.
6. **`refreshSportsGameOddsJob` has not run since 04:38Z**, on vendor 429s.
   Pre-existing, unowned.
7. **`snapshotCacheSize` unhealthy** — 12.6 MB against a 10 MB bound.
8. **Sharp coverage 9.08%**, under 5.2's own 10% threshold. Recommendation only
   — **nothing purchased**.
9. **2,380 duplicate observation groups in `game_odds_history`** — revealed, not
   created, by 5.13. Owner: 6.1.
10. **3.15's two GET-path writers** — carried from Phase 3.
11. **No push alerting** (Q19) — Phase 8. **Rate limiting per-process** — Phase 8.
12. **`SUPABASE_SERVICE_ROLE_KEY` cannot be rotated** — Phase 7.

## 8. Backup tables outstanding

| Table | Rows | From |
|---|---|---|
| `prop_odds_dedup_backup_20260829` | 178,238 | Phase 3 |
| `game_odds_book_lines_bookmaker_backup_20260829` | 6,199 | 5.3 |
| `game_odds_book_lines_quarantine_20260829` | 114 | 5.4 (Q23) |
| `game_odds_history_bookmaker_backup_20260829` | 47,622 | 5.13 |
| `pick_history_game_model_backup_20260829` | 3,580 | 4.8 (Q25) |

All five are still on a Free-tier database.
