# CURRENT — pick up here

**Phase 5: COMPLETE, gate PASSED** (commit `f8e60b5`).
**Phase 4: all 13 tasks done. Gate IN PROGRESS — G7 FAILED and is being fixed.**

The Phase 4 gate is not passed. It found FIVE real defects that the phase's
own VERIFYs missed, three of which needed operator decisions (all answered
2026-08-29, recorded as Q37/Q38/Q39 below). Do not write a Phase 4 sign-off until
§3's remaining steps are done and the gate has been re-run **from G1**, which
is what the plan's Rule 5 requires after any failed item.

## The documents, in reading order

1. `CLAUDE.md` — conventions. Read the caching and table-ownership sections.
2. `docs/audit-remediation-plan.md` — the plan. §0 holds standing decisions
   Q1–Q39; §11 is the phase log and the only place a task counts as done.
3. This file — where the work actually is.

Trust `§11` and `git log` over this file if they disagree.

## 1. Where we are

Phase 5 is signed off. Phase 4's thirteen tasks are all implemented, committed,
pushed, and deployed (worker live on `8582a77`). What is **not** done is the
gate, and it has already failed once on G7.

### The five things the gate found

**(a) The activation gate did not work.** *(fixed, re-verification running)*
`scripts/gate/phase-4-weak-model-refused.py` ran the real
`fit_moneyline_weights` with every feature zeroed — a model that carries no
information by construction — and it **ACTIVATED**:

```
[fit moneyline] beats own baseline: True | market gate: INSUFFICIENT SAMPLE (n=12, need 100)
  holdout Brier      0.248824
  baseline holdout   0.260666
  ACTIVATED          True
FAIL — a weak model was ACTIVATED
```

0.2488 is exactly what a constant predictor at the base rate scores (p≈0.54 →
0.2484). The zeroed fit learns only an intercept. It "beat its own baseline"
because **this app's unfitted formula scores worse than knowing nothing does.**

Fixed by adding a third guardrail — beat a constant base-rate predictor, base
rate taken from the training rows so the holdout is not leaked — to **both**
markets, and by giving `total` the market gate that 4.2 wired into moneyline
only. `_base_rate_holdout_brier` in `predict/model_fit.py`.

**(b) MLB totals: the weights and their input disagree.** *(Q37, decided)*
4.11 switched serving to negative binomial. Every `model_weights` row was
fitted **2026-08-14 by TypeScript** using Poisson — Python's fit has never
written a row, because `fit_total_weights` **has no caller anywhere**: no job
in `JOB_REGISTRY`, no route, no CLI. So `odds_lines_cycle.py:498` feeds a
negative-binomial P(over) into weights trained on Poisson. Measured gap, up to
**11 points** at ordinary totals — far above the 3% edge threshold that decides
which picks surface:

```
mu    line   Poisson   NegBin    delta
 9.0   8.5   0.5443   0.4920   -0.0524
 9.5   8.5   0.6082   0.5341   -0.0740
10.5   8.5   0.7206   0.6106   -0.1100
```

**Q37 — operator decision 2026-08-29: re-fit in Python, activate only if it
passes.** Moneyline is unaffected (its feature vector has no Poisson term).

**(c) `shadow` does not gate what 4.4 said it gates.** *(Q38, decided, DONE)*
The migration claimed "compute, log and grade but never render". True of the
MLB **home-run** model only — `getRenderableModelWeights` is the single
enforcement point and exactly one caller uses it. The MLB **game** model
renders from `mlb_game_model_cache`, which no shadow check touches, and the
Python worker never branches on the column at all. All three models are flagged
`shadow=true` while two are on screen.

**Q38 — operator decision 2026-08-29: correct the claim, leave rendering
alone.** Honouring the flag would pull MLB moneyline and total out of the UI
entirely; that is a product decision, not a gate's. Done: migration
`20260829160000_shadow_scope_correction.sql` (applied, comment verified live)
and two corrected docstrings in `lib/db/client.ts`.

**(d) 4.3's calibrations were fitted and applied to nothing.** *(Q39, DONE)*
Its VERIFY was "model_calibration is no longer empty", which passed. But the
single serve-time consumer (`odds_lines_cycle.py:557`) asks for
`('mlb','moneyline')` and all seven fitted rows are PROP markets. No TypeScript
path reads the table at all. P3 H1 -- "probabilities are uncalibrated" -- was
still true of every number the MLB prop job produced.

**Q39 — operator decision: wire prop serving to apply them.** Done in
`_compute_mlb_prop_predictions_inner`, before BOTH writers (they share one
candidate list precisely so they cannot disagree). **This changes what a user
sees, deliberately**: Platt with a<1 compresses confidence — hit-in-game takes
a raw 0.700 to 0.606 and 0.300 to 0.406 — so fewer picks clear the 3% edge
threshold. Live on the worker (`b5110f3`).

**(e) One dead export.** *(DONE)* `poissonPushProbability` (TS) was added by
4.12 and called by nothing; `poissonOverProbability` already renormalises over
`1 - push` itself. Deleted. Found by sweeping **every** function Phase 4/5
added in both languages for a real caller — Python came back clean.

### Gate items already passed (before G7 failed)

G1 (every VERIFY re-run), G2 (tsc clean, build compiled, `npm test` 36/36, 17
CI Python tests 0 skipped), G3 (live walk — found the `goodBetsRecord` defect,
fixed in `8582a77`), G4 (findings stop reproducing), G5 (write paths landing,
44/46 health checks green, 2 pre-existing failures documented), G6 (orphans,
gathered — see §4). **All of these must be re-run from G1** once (a) and (b)
are closed, per Rule 5.

## 2. What is running right now

- `scripts/gate/phase-4-weak-model-refused.py`, re-run after the guardrail fix,
  writing `python-odds-service/weakgate2.log`. **Expected: `PASS — the gate
  refused it`.** Started 16:53 local. Budget HOURS, not minutes — the first run
  of this script took ~4.5h, because it builds the 2023/2024/2025 training set
  for real. If it still says ACTIVATED, the guardrail did not bind and (a) is
  not fixed. Fast hermetic proof already exists either way
  (`test_activation_guardrails.py`, fault-injected); this is the end-to-end
  confirmation, not the only evidence.
- Two `harvester_scrape.py` Windows scheduled tasks, ~20-min cycle. Normal.

Nothing else. No fit, no backfill.

## 3. Next actions, in order

1. **Wait for `weakgate2.log`.** Confirm it now REFUSES. A pass here is the
   whole point of (a) — do not accept the code change as its own evidence.
2. **Run the total re-fit** (Q37). Script is written and ready:
   ```bash
   cd python-odds-service && ./.venv/Scripts/python.exe -u ../scripts/gate/phase-4-refit-total.py
   ```
   **RESIZE THE SEASON RANGE FIRST.** It is currently set to train 2010–2023 /
   holdout 2024–2025, which is right statistically and wrong operationally: a
   training-set build costs roughly 1.5 hours PER SEASON (the weak gate's three
   seasons took ~4.5h), because `build_training_set` makes per-(team, season)
   statsapi calls and `compute_league_outcome_rates` walks a whole season. 16
   seasons is not a run you can finish. Measure one season first, then pick the
   widest range that fits — train 2021–2023 / holdout 2024–2025 is the
   fallback, and is still larger than the model TS v7 was fitted on.
   The in-process memo cache does NOT help across processes.
   **Do not run it concurrently with the weak gate** — shared 15-connection
   pooler, measured at 13 of 15 in use. Activation is not assumed: if
   it fails any of the three guardrails it is written unactivated and v8 stays
   live, which is a legitimate outcome, not a failure of the task.
3. **Re-run the whole gate from G1** (Rule 5). Not just the failed item.
4. **§11 sign-off** with G1–G7 raw outputs and an honest "known not done".

Steps 1 and 2 are the only ones left that need a long-running process. All the
code from (a) and (c)–(e) is committed, pushed and deployed:
`8582a77` (goodBetsRecord + 4.11's second call site), `c7885d4` (the guardrail,
the shadow correction, the /diagnostics filters), `b5110f3` (4.3 wired, live on
the worker), `7b1cd8e` (the dead export).

## 4. G6 — orphans, gathered

Nothing here is undocumented, but each needs its owner recorded in the sign-off:

- **Golf `player_game_history` importer — DECIDED, NOT BUILT** (§11 4.7).
  Evidence-backed: golf is not in the generic prop pipeline, every reader of
  that table serves the generic pipeline, the schema has no opponent/team/home
  concept, and golf's own four tables already hold the data. Re-opening it is a
  schema question ("what is a golf event"), not an ingestion one.
- **All 21 `model_weights` rows are `shadow=true`**, including the three
  `active=true` ones. Deliberate (Q33, default true). Graduation is a
  one-column operator act gated on Q6/Q24 — not owned by a later phase.
  **Scope caveat (c) above applies: the flag only binds the home-run model.**
- **`model_calibration`: 5 of 7 active.** `runs` and `total-bases` were refused
  because they lost to baseline holdout log loss (0.6705 vs 0.6702; 0.6085 vs
  0.6040). Correct refusals — and an independent instance of an activation gate
  rejecting a real model, unlike (a).
- **`fit_total_weights` / `fit_moneyline_weights` have no caller in Python.**
  Found by (b). Step 3.2 above adds one for totals; moneyline still has none,
  so `/api/props/fit-weights` (TypeScript) remains the only way to fit it.
  `model_weights` is a documented dual-writer (`docs/table-ownership.md` row
  26, hand-invoked admin category) — this is not a new violation of Q13, but it
  does mean "model math lives in Python" is still aspirational for *fitting*.

## 5. Things that will bite again

**THE LESSON THIS GATE PAID FOR, and the most transferable one yet:**
**a guardrail that has never rejected anything is not known to work — and
"beats its own baseline" is not a guardrail if the baseline is worse than a
constant.** The activation gate had been shipped, reviewed, and described in
three comments as a working protection. It took running it against a
deliberately worthless model to find that it approved one. The plan's own
instruction — "a gate that has never rejected anything is not known to work" —
was right, and it was right about a gate I had already written.

**The one before it: a dead consumer cannot report that its input vanished.**
5.3 renamed every bookmaker in `game_odds_history`; `clv_backtest.py`'s
reference book was hardcoded `"LowVig.ag"` and silently matched zero rows.
Nothing failed — the module had no caller. Surfaced only when 4.5 wired it to
the dashboard: 0 of 337 picks → 60. **After any migration that renames values,
grep the tree for the OLD value, including in code nothing currently calls.**
Note (b) above is the same shape a third time: `fit_total_weights` had no
caller, so nothing could report that its output had stopped matching serving.

- **Fault injection is easy to fake — four occurrences.**
  `scripts/gate/phase-5-constraints.mjs` first reported all 17 violations
  "rejected", every one by a `NOT NULL`, not by any CHECK. Caught only by
  inserting a known-good CONTROL row per table and asserting `e.constraint`.
  **Never accept "the operation failed" as evidence — assert WHY.**
- **`ps aux | grep` in Git Bash does not show command lines.** Cost a wrong
  "the process died" call this session; a first weak-gate run was alive the
  whole time and ended up racing its own replacement. Use
  `Get-CimInstance Win32_Process` and read `CommandLine`.
- **Backgrounding `cd X && cmd &` backgrounds the `cd` too** — following
  commands run in the old directory.
- **Reverting a fix and re-running its test can prove nothing.** Reverting
  `mlb_game_lines.py` produced an ImportError, not a failure.
- **A deploy does NOT mean every writer runs the new code.** Cost the Phase 5
  gate a full G1 failure. OddsHarvester runs as Windows scheduled tasks
  (~20-min cycle) and Python binds imports at process start. **Any migration
  normalising a column needs re-applying after those processes cycle**
  (`20260829110000_canonical_bookmaker_residue.sql` exists only for this).
- **The plan's own task text goes stale, repeatedly.** 5.6 was already fixed;
  5.1's alias table missed the actual cause; 5.4's `side IN ('over','under')`
  would have rejected 449 legitimate `'other'` rows; 4.1's premise is wrong.
  **Measure before implementing.**
- **`withJobLock` is a LEASE TABLE, not an advisory lock.**
- **Postgres UNIQUE treats NULLs as distinct.**
- **A long heredoc breaks this shell** (>~120 lines → "unexpected EOF").
- **`cd` persists between Bash calls.** Use absolute paths.
- **Git Bash `/tmp` is not Python's `/tmp`.**
- **Stale `.next/types` break `tsc` after deleting a route** — `rm -rf .next/types`.

## 6. Operational knowledge

- **DB access:** temp `.mjs` in the repo root, `node` it. `q*.mjs`, `g*.mjs`,
  `gate*.mjs`, `runmig.mjs` are gitignored for this. `:6543` is the transaction
  pooler; `.env.local` has no `DIRECT_URL`, so DDL also goes through `:6543`
  (it has worked for every migration so far, `COMMENT ON` included).
- **Tests:** `npm test` (**36**) and `./.venv/Scripts/python.exe -u src/test_x.py`
  from `python-odds-service/`. **17** hermetic Python tests, one CI step each.
  There is **no pytest** in the venv — they are standalone scripts.
- **Gate scripts:** `scripts/gate/phase-5-constraints.mjs`,
  `phase-5-budget-race.mjs`, `phase-4-shadow-roundtrip.mjs`,
  `phase-4-weak-model-refused.py`, `phase-4-refit-total.py`.
- **Render:** worker `srv-da36bm2bkg8c73fqrdeg`, `autoDeploy: no`. After any
  push touching `python-odds-service/`:
  `POST /v1/services/$SRV/deploys` with `RENDER_API_KEY` from `.env.local`,
  then confirm `"status":"live"` on your commit sha. ~90s.
- **Propline budget:** `propline` 1000/day (MLB), `propline_2` 1000/day
  (soccer), genuinely separate. **18 of ~20 authorised propline_2 probe calls
  spent** capturing `docs/propline-live-capture-20260829.json` — reuse it.
- **No `gh` CLI and no GitHub token.** CI via the public Actions API.
- **Don't `git add -A` blindly** — `docs/discord-community-prompt.md` is the
  operator's. Adding a gitignored path to a pathspec makes `git add` exit
  non-zero and silently skip the commit behind `&&`.

## 7. Backup tables outstanding

| Table | Rows | From |
|---|---|---|
| `prop_odds_dedup_backup_20260829` | 178,238 | Phase 3 |
| `game_odds_book_lines_bookmaker_backup_20260829` | 6,199 | 5.3 |
| `game_odds_book_lines_quarantine_20260829` | 114 | 5.4 (Q23) |
| `game_odds_history_bookmaker_backup_20260829` | 47,622 | 5.13 |
| `pick_history_game_model_backup_20260829` | 3,580 | 4.8 (Q25) |

## 8. Carried forward / known not done

- **The Phase 4 gate itself.** See §3. It has failed once and must be re-run
  from G1.
- **Soccer slate duplicate React key** — `soccer:espn:soccer:222396:anytime-goalscorer:yes`.
  834 soccer players legitimately have prices for two upcoming fixtures, and
  the key in `GolfScheduleView.tsx:1244` / `TennisScheduleView.tsx:529` omits
  `gamePk`, so they collide. **Confirmed pre-existing, not a Phase 4/5
  regression**: the key last changed 2026-08-27 (`2913d81`), `propline_2`
  predates the session by 12 days, no soccer file was touched today, and 5.1's
  aliases are all MLB `batter_`/`pitcher_` markets. One-line fix (add the game
  id to the key); unowned.
- **5.1's second VERIFY half is still unconfirmed.** `propline` was correctly
  gated at 1000/1000 for 2026-08-29. **After 00:00 UTC run:**
  ```sql
  SELECT market_key, count(*) FROM prop_odds
   WHERE provider_id='propline' AND fetched_at > '2026-08-30'
   GROUP BY market_key ORDER BY 2 DESC;
  ```
  Before the fix this returned exactly one MLB market (`pitcher-strikeouts`).
- **`/diagnostics`, `/bets` and the signed-in walk were never verified** — no
  credentials; creating an account or entering a password is out of bounds.
- **`refreshSportsGameOddsJob` has not run since 04:38Z**, having hit vendor
  HTTP 429s. Pre-existing, unowned.
- **`snapshotCacheSize` unhealthy** — 12.6 MB payload against a 10 MB bound.
- **Sharp coverage 9.08%**, under 5.2's own 10% threshold. Recommendation only
  — **nothing purchased**. Pinnacle covers one market of thirteen.
- **5.9 lowered the ParlayAPI gate by 20%.** Unset the env vars rather than
  reverting code if unwanted.
- **2,380 duplicate observation groups in `game_odds_history`**, revealed not
  created by 5.13. Owner: 6.1.
- **3.15's two GET-path writers** remain, carried from Phase 3.
- **No push alerting** (Q19) — Phase 8. **Rate limiting per-process** — Phase 8.
- **`SUPABASE_SERVICE_ROLE_KEY` cannot be rotated** — Phase 7.
