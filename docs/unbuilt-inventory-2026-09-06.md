# What is planned and not built — full inventory, 2026-09-06

Compiled by reading every plan doc and checking each claim against the database
and the tree, not against the docs' own checkboxes. Where a doc says a thing is
done and the code says otherwise, the code wins and it is noted.

---

## 0. What actually exists today

**Two sports have a validated model. Seven do not.**

```
model_calibration, active rows:   mlb 13    nhl 5    (nothing else)
model_weights:                    mlb 21
```

| sport | state |
|---|---|
| **MLB** | 11 markets rank, 9 carry a calibrated probability. Phase 5. |
| **NHL** | 5 markets rank, 4 carry a probability. Phase 4. |
| Tennis | **BUILT AND REJECTED.** Phase 2 closed; gate 3 failed at t=+20.68. |
| Soccer (EPL/MLS) | **BUILT AND FAILED** its gate at t=+3.05. |
| Golf | A legacy model layer exists. The audit lists it **for deletion**. |
| NBA | not started |
| CFB | not started |
| NFL | not started |

Neither MLB nor NHL has a **game** model that passed. Every game gate in the
project has failed: tennis t=+20.68, soccer t=+3.05, NHL games t=+5.07, NHL props
t=+3.03, MLB props not yet run against a price.

---

## 1. Model-build plan — remaining work

### Phase 5 (MLB) — 4 steps left of 11

- **5.5 Statcast prior.** `estimated_woba` to separate skill from luck. The join
  is already proven: `player_game_history.event_id` IS the MLB gamePk, 6,885
  games, **100.00% date agreement**. Cheapest remaining item in the phase.
- **5.9 Plate-appearance simulation.** log5 per-PA draw, base-out state, nine
  innings, ten thousand times. The largest single build in the plan.
- **5.10 Does the simulation beat the direct model at its own job?** The control
  now exists and is strong — 9 markets, 30,000-row samples. If the sim's props do
  not beat it, the direct model keeps the board.
- **5.11 Game ship gate.** CLV against the closing moneyline and total.

### Phase 6 — NBA · pace × efficiency

Not started. Blocked on nothing.

- `ingestNbaShotsJob` **has never run**.
- Game side: possessions × points-per-possession, both markets from two numbers
  per team. Possessions are not stored but are computable from FGA/FTA/TOV/OREB,
  all four already in the player rows.
- 24,705 priced games, dense 2008–2019 and 2021–2025, 100% result coverage.
- **Props are the thinnest of any viable sport** — 4,480 graded player-games, a
  sixteenth of MLB's. And minutes are the least predictable part, so an NBA prop
  model is mostly a minutes model wearing a costume.
- Spread is home-side only, so it is judged against the posted line, not a
  de-vigged probability. Moneyline and total are the primary gates.

### Phase 7 — College football · ratings on margin

Not started.

- Ridge/least-squares rating on margin; residual against the closing spread is
  the signal. Cap or shrink blowout margins.
- Moneylines exist only from 2021 (4,017 games); spreads go back to 2013
  (13,569). Model the spread — three times the data and what people actually bet.
- **CFBD spread rows carry lines but ZERO prices**, so CLV can only be measured
  on the 2025–26 ESPN rows. A real limit on the ship gate.
- **CFB props are out of scope** — zero of 45,000 rows are two-sided.

### Phase 8 — NFL · margin-adjusted Elo + targets-based props

Not started.

- `ingestNflPbpJob` **has never run**.
- 7,336 spread/total games back to 1999, 5,355 moneyline. Both spread sides are
  priced (nflverse), so NFL spread **can** be de-vigged — unlike NBA/EPL/CFB.
- **Props are NOT blocked on snap counts**, contrary to `model-rebuild-plan.md`
  §8. 58,152 rows carry `receiving.receivingTargets` and 29,878 carry
  `rushing.rushingAttempts`; for the markets that trade, a target is the
  opportunity and a snap spent blocking is not.
- **Longest reception needs different machinery** — it is the MAXIMUM of several
  draws, not a sum, so it needs an extreme-value treatment. Second-biggest NFL
  market by volume.
- **Milestone alt-lines are off by one**: a line of 2.0 means "≥2", i.e. over
  1.5, not over 2.5.

### Surfacing

Every sport phase is supposed to END with its board. NHL and MLB have one; NBA,
CFB and NFL will each need theirs — which, per the decision on 2026-09-06, means
**into Scan's existing columns, not a parallel page**.

---

## 2. Sports with no phase at all

- **Golf** has a live model layer (`golf_models.py`, `golf_tournament_predictions`,
  six tables) that the audit lists for deletion, and no replacement is scoped in
  the model-build plan. Separately noted as wanting: match winner, top 3/5/10,
  hole-score prop.
- **Tennis** is closed with a measured NO. Reopening needs new features, not a
  re-fit.
- **Soccer** failed its gate. The plan does not schedule a second attempt.

---

## 3. Audit remediation — 36 unchecked items

19 checked, 36 unchecked. Grouped by where they sit:

**Phase 1 verification (7)** — restore tested with row count logged; DB under its
ceiling; anonymous PostgREST POST returns 401/403; `git status` clean; no
`EMAXCONNSESSION` in an hour; open redirect closed and service key rotated; all
jobs healthy **with a test alert actually received**.

**Phase 2 verification (9)** — `P(over) + P(under) ≈ 1.0`; price age correct with
the worker stopped; **no model probability or edge outside `/diagnostics`**;
every displayed rate carries a sample size; `/api/props/fit-weights` returns 401
unauthenticated; `mlbGameLinesJob` healthy; calibration excludes backfill; under
5% "Source not recorded"; no internal detail in a 502 body.

**Track E — the model layer (10)** — `market_prob` on >50% of new rows;
activation gate refuses a market-losing model; `model_calibration` non-empty
(**now true for MLB and NHL**); `shadow` flag respected by the renderer; CLV on
`/diagnostics` with a documented closing reference; `player_game_history`
non-zero for MLB/NBA/golf/tennis; one MLB game model; `edge_source` non-null;
both sides surfaced for generic sports; every 4.12 item closed in writing.

**Track F — sourcing (9)** — Propline batter rows landing and `odds_unresolved`
near zero; sharp coverage re-measured with a buy/no-buy decision recorded; one
row per book in `DISTINCT bookmaker`; out-of-band total rejected by a CHECK
constraint; best price and its probability share a `point`; implausible price
excluded with a test; consensus excludes the compared book; config divergence
test fails when one side changes; concurrent job failure preserves siblings'
rows.

**6.29 is named in the plan as "the largest piece of work left in the phase"** —
it is the model rebuild, i.e. the whole of Phases 2–8 above.

---

## 4. Remediation Phases 7 and 8 — entirely unbuilt

### Phase 7 — Commercial readiness (2–3 weeks)

Goal: *you can legally and operationally take money.*

- **7.1** Account recovery and password policy
- **7.2** Entitlement layer
- **7.3** Billing
- **7.4** **Legal review by an actual lawyer** — affiliate rules are
  state-by-state and the operator carries the liability; jurisdiction differs
  materially across 38 states; several states regulate paid pick services
  ("tout" regulation); and **redistributing odds data is restricted under most
  provider terms**.
- **7.5** Support process and runbook

Gate: password reset end-to-end including expired tokens; an entitlement matrix
for every gated feature × {anonymous, free, paid, lapsed}; the full Stripe
lifecycle in test mode; legal review evidence attached **or the gate explicitly
records that it is not**.

### Phase 8 — Production infrastructure and launch (1–2 weeks)

- **8.1** Migrate to Supabase Pro — **appears already done**; the database is on
  Pro at 6,459 MB of 8,192.
- **8.2** Deploy the web app. **No hosted web app exists today.**
- **8.3** Staging · **8.4** Load test · **8.5** Uptime monitoring · **8.6** Alerts
  as a product feature
- **8.7** Move OddsHarvester off a laptop — verified by unplugging it and
  checking `game_odds_book_lines` still advances
- **8.9** Move the weekly backup off a laptop — verified by shutting it for a
  week and checking a dump still appears
- **8.8** Close the migration-verification question

---

## 5. UI design work — four briefs, none executed

`prompt-1-scan.md`, `prompt-2-player-detail.md`, `prompt-3-teams.md`,
`prompt-4-diagnostics.md`. Each asks for 2–3 labelled visual directions inside
the locked Game Detail token system. No checkboxes, no recorded outcome. Scan was
previously marked out of scope; the other three were the active front.

---

## 6. Cleanup — agreed 2026-09-06

Added because the app now has several things doing one job, and building beside
them rather than replacing them is what produced that.

1. **Delete the four modules the audit named** — `edge_model` (118 lines),
   `prop_score` (180), `good_bets` (139), `live_edge` (431). Fix whatever breaks
   by pointing it at the validated model. Task 4.12 already measured
   `prop_score`: hold `model_prob` fixed and its ordering collapses (D outranks
   C+, A indistinguishable from B), so its extra terms carry almost no signal.
2. **One prop engine.** `count_prop_engine` is the one with an identity test.
   Migrate `nhl_props` onto it and delete the duplicated maths — about 90 lines.
   Caveat: the two differ by 2.72e-6 at the Poisson limit, four orders below the
   gate tolerance but not zero.
3. **One pipe into Scan.** Not two boards, not two tables — `prop_model_cache`
   feeding the columns Scan already has.
4. **Delete `/mlb/projections` and `/nhl/projections`** and the `StatsBoard`
   component. Parallel surfaces built 2026-09-05/06 that nobody asked for. The
   serving pipe, `prop_model_cache`, the calibration store and the adapters all
   survive and are reused.

Net: roughly −2,000 lines, one model, one table, one surface.

---

## 7. The honest summary

**Built and validated:** the data layer, the crosswalks, the measurement harness,
and prop models for two sports out of nine.

**Not built:** models for five sports, every game model that passed a gate, the
plate-appearance simulation, 36 remediation items, all of commercial readiness,
almost all of production infrastructure, and four UI design passes.

**The largest single risk is not any of those.** It is that the plan has been
executed add-only: the audit prescribed deletions in Track E that were never
carried out, so each new correct thing was built beside an old wrong one. Item 6
above exists to stop that compounding before Phases 6–8 add three more sports to
it.
