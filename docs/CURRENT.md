# CURRENT — pick up here

**Phase 4 is complete and audited. Phase 5 is mid-flight: 5.1, 5.2, 5.3, 5.4 and
5.8's surface are built; the full MLB fit is the thing to check first.**

`tsc` clean, **347 tests, 0 fail**. Plan: `docs/model-build-plan-2026-09-02.md`.

## 1. FIRST THING: the MLB fit result

`python fit_mlb_props.py --persist` was running when this was written (14
markets x 315 combos). If `model_calibration` has `sport='mlb'` rows carrying
`shape_kind` in their params, it finished. If not, re-run it.

Then, in order:

```bash
python fit_nhl_props_all.py --persist   # NHL under the CORRECTED metric — will change verdicts
python verify_nhl_serving.py            # re-verify after that re-fit
```

**The NHL re-run is not optional.** The calibration metric was fixed in 5.4 and
NHL's persisted verdicts were produced under the buggy one.

## 2. What shipped

**5.1 — market map + one history loader** (`predict/mlb_props.py`). 17 markets,
14 modellable, 10 excluded with reasons in code.

**5.2 — crosswalk.** Slate coverage 83-86% -> **100%**, prop athletes 73.6% ->
**99.0%**.

**5.3/5.4 — the model and its walk-forward** (`predict/count_prop_engine.py`,
`fit_mlb_props.py`). Shared engine extracted from `nhl_props`; NHL deliberately
not migrated, with `test_count_prop_engine.py` asserting the two agree exactly.

**5.8 — MLB on the shared board** (adapter, route, page, panel, job). Needs the
fit to have persisted before it renders anything.

## 3. Six findings, each of which would have shipped something wrong

1. **The market names changed on 2026-09-03 and the old ones are gone.** Two
   disjoint naming schemes; a model fitted on "Total Hits" matches nothing live.
2. **Two id spaces in one column** — ESPN before the cutover, MLB StatsAPI after.
   Provably disjoint (0 collisions), so a COALESCE resolver is safe.
3. **`pit_inningsPitched` is outs notation, not a decimal.** "1.2" is FIVE outs.
   `ip * 3` would have corrupted every pitcher projection, plausibly.
4. **The shape grid only went one direction.** NB spans variance >= mean; hits
   are UNDER-dispersed (var/mean 0.854) because a batter cannot out-hit his
   plate appearances. Added a binomial shape.
5. **Temperature cannot fix a bias.** It rotates about 0.5 and corrects
   overconfidence (NHL's failure). MLB's is a uniform under-prediction, which
   only a shift term absorbs. Added two-parameter Platt.
6. **The calibration metric had two bugs** — it compared actual to the bucket
   MIDPOINT rather than the mean prediction, and its floor of n>=40 is noise for
   a proportion. On MLB hits, Platt improved ECE 0.0226 -> 0.0140 and improved
   every substantial bucket while the reported "worst gap" got WORSE on one
   45-row bin. Gate is now ECE <= 0.025 AND worst <= 0.05 at n >= 200.

## 4. Known gaps, deliberately left

- **Park factors are not wired and cannot be.** No path from a player-game to a
  venue: `player_game_history` has no venue column and its `event_id` matches
  `game_result.event_ref` on **0** of 4,456 distinct 2025+ MLB games. The
  multiplier hook exists in the engine and is tested inert at 1.0.
- **MLB prop prices exist in three eras and the middle has none** — 753k rows of
  lines with no odds (2026-03..08). Fine for the board, useless for the betting
  bar. The walk-forward splits on the season boundary because of it.
- **Three markets are unmodellable**: `triples`, `walks`, `batter-strikeouts`
  are live-scheme only, four days deep.
- **`Total Home Runs Hit` ends 2025-11-02**, ten months before the rest.

## 5. Remaining Phase 5 steps

- **5.5** Statcast prior. `mlb_pitch_events` has 2.16M pitches and **joins
  natively** — `player_game_history.event_id` IS the MLB gamePk, 6,885 games,
  **100.00% date agreement**. The one place MLB is easier than NHL.
- **5.6/5.7** pitcher markets and per-market gating — the fit already covers
  both; they need recording, not building.
- **5.9-5.11** the PA simulation, then whether it beats the direct model.
- **Port Shin/power de-vig into Python.** TS has them; `odds_math.py` carries
  only proportional, and 5.1 measured the consequence (longshot gaps to 4.8pt).

## 6. Standing constraints

- **Do not deploy to Render or start 6.29 without asking.**
- **Never `git add -A` or `git add docs/`** — `docs/discord-community-prompt.md`
  is the operator's.
- **A numeric id matching the expected shape is not evidence it is the right
  id.** Verified again in 5.2: 399 MLB ids matched by shape and **0.00%** landed
  on the right game date.
- **The operator must read `app/privacy/page.tsx` before it is public** — the
  hosting/retention terms and the governing jurisdiction are outside the repo.
