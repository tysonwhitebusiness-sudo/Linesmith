# The two-model system — full gameplan

**Written 2026-09-22, from a multi-hour audit session.** Phases first —
what to build, in order. Full supporting evidence (every number, every file
path, every measurement) is in the appendices at the end — read a phase, and
follow its evidence link only if you need to verify the claim behind a step.

**One rule that applies throughout, stated once here because it was
mislabeled earlier in this same document and cost two correction cycles:**
`generic_elo` is not an advanced model, and it is not a permanent second
tier either. It's a bridge — built so every sport had *something* serving a
pick while real models didn't exist yet. **Phase 1's ranking system now does
that job properly**, without pretending to be a prediction. That means
`generic_elo` has no reason to stick around as a "baseline advanced model":
**Phase 2 below is a commitment to build the real architecture for every
sport that doesn't have one yet, now — not a list of someday candidates.**
Each one replaces `generic_elo` for that sport as it's built. Measuring
whether it's actually good — via the gate that already exists (Phase 3) —
happens *after* it's built, the same way it always has for MLB, CFB, NHL,
and soccer's real attempts. Measuring is not the same as hedging on whether
to build it. Build it, then measure it.

---

## Phase 0 — Root cause fix + cleanup

**STATUS 2026-09-23: done except one blocked step.** 0.1, 0.2 (standing
rule, no code), 0.4 and 0.5 (confirmed unchanged) are complete and verified
live. 0.3's nine dead files are deleted and verified (CI's 18 runnable
hermetic tests + a full 104-module non-test import sweep across `src/`, both
clean). 0.3's two dead tables (`golf_model_predictions`,
`golf_tournament_predictions`) are added to `prune_dead_tables.py`'s `DEAD`
list and dry-run verified (7,333 + 149 rows, digest-checked, `verified=True`)
but the `--apply` step that actually drops them was refused twice by this
session's sandbox as a destructive DB action, despite the operator's
standing permission in chat. Needs a human to run it directly:
`python prune_dead_tables.py --table golf_model_predictions --table
golf_tournament_predictions --apply` from `python-odds-service/`. Nothing
else in Phase 1+ depends on this — it's a cleanup, not a blocker.

**The root cause this whole plan starts from:** several large tables
(`odds_archive`, `prop_odds_archive`, `player_game_history`,
`mlb_pitch_events`, `prop_odds_history`) get pruned from live Postgres into a
Parquet corpus in Supabase Storage once rows are frozen. Live Postgres now
holds only a short recent tail for these tables. Every prior "we lack
historical data" conclusion in this codebase — including several of the
model attempts diagnosed in Phase 2 — was reasoning from what live Postgres
showed, not from what actually existed. Full numbers: **Appendix A.**

**0.1 — Extend `corpusFreshness` to cover all 6 corpus tables.** Today it
only checks the 2 that are `id_chunk`-partitioned (`mlb_pitch_events`,
`prop_odds_history`). `odds_archive`, `prop_odds_archive`,
`player_game_history`, and `game_result` — the tables this whole finding is
about — are never checked for corpus readability at all.

**0.2 — Standing rule for all new work in this plan:** any new
fitting/training code reads the corpus (`odds_archive` + `game_result` via
`corpus_location.read_parquet_glob()`), never `historical_odds` alone
(MLB-only) and never live Postgres's short tail.

**0.3 — Delete, confirmed dead:**

| File / table | Why |
|---|---|
| `predict/normal_dist.py` | Orphaned from golf's deleted Monte Carlo sim |
| `predict/golf_player_matching.py` (Python only) | Same orphan — TS twin stays, still used |
| `fit_nfl_elo.py` | Superseded, lost to market on its own real test |
| `predict/cfbd.py` | Zero real callers — not the same file as the live `import_cfbd.py` |
| `predict/generic_matchup_defense.py`, `generic_player_gamelog.py`, `predict/understat.py` | Stranded when the prop-scoring layer they fed was deleted |
| `fit_cfb_ratings.py`, `sweep_cfb_ratings.py`, `build_cfb_training_set.py` | Failed ridge-rating attempt — delete now, confirmed |
| `home_run_model.py` + `fit_home_run_weights` (surgical) | Zero live callers — keep `compute_league_and_team_hr_rates`, live elsewhere |
| `golf_model_predictions`, `golf_tournament_predictions` (tables) | Frozen since 2026-09-13 — via `prune_dead_tables.py`, not a raw DROP |

Full reasoning and the caller-graph evidence behind each: **Appendix F.**

**0.4 — Fix, don't delete:**
- TS `team_elo_history` sport-filter bug (`lib/db/client.ts` — still missing
  `WHERE sport = ?`)
- `model_status.py`'s stale tennis docstring
- Wire `golf_elo` — confirmed zero real callers despite being registered as
  golf's live model
- Finish `savant.py`'s stalled TS→Python cutover — identify what currently
  serves MLB's Statcast player-page displays first (open item, Appendix G)

**0.5 — Confirmed live, do NOT touch:** the MLB benchmark-candidate quartet
+ its harness (real, monitored, intentionally manual-cadence — Appendix C),
`model_fit.py`, `dixon_coles.py`/`dc_walkforward.py`, and TS `eloModel.ts`/
`modelFit.ts`/`homeRunModelFit.ts` (confirmed live via real admin routes).

---

## Phase 1 — No-odds ranking system: full market coverage

**The real gap, measured:** MLB prices 17 distinct markets, 2 have a
ranking. NFL prices 18, 2 covered. CFB prices 10, 1 covered. Full real
market lists with row counts: **Appendix E.1.**

**Architecture:** one generic scoring engine, not a hand-built ranking per
market. Generic factors (recent rate, opponent-allowed rate, trend,
availability/role) apply everywhere; sport-specific add-ons only where real
data backs them. Full factor library and sourcing: **Appendix E.2.**

**Display, decided:** the Scan table itself is frozen (`ScanTable.tsx`/
`ScanCard.tsx`, pinned by content hash, decision D3) — nothing goes inside
it. A new element at the **bottom of the Slate page, adjacent to the frozen
table**, is the shared surface for graded (`special`-kind) rankings.
Player/team/game page chips are the existing, real destination for ungraded
(`spotlight`-kind) circumstance flags. Golf is spotlight-only, by operator
direction — no graded Specials for golf, ever.

**1a — Shared infrastructure.** Build the generic engine + factor library,
the new bottom-of-Slate element, confirm the spotlight-chip mechanism.

**1b — MLB.** 15 of 17 markets uncovered — the largest real gap. Add-ons:
platoon/handedness split, contact quality, real pregame park/weather,
opposing starter's own recent-form trend, home/road split.

**1c — NFL.** 16 of 18 uncovered. Add-on: real role/target share from
play-by-play (`nfl_target_events`) — NFL-only, do not assume CFB has the
same play-level detail without checking.

**1d — CFB.** 9 of 10 uncovered. Resolve the target-share-for-CFB question
during this phase, not before it.

**1e — NHL.** Add-on: individual goalie form (SV% trend) — not team-level
allowed shots.

**1f — Tennis.** Currently zero rankings — full build. H2H, form,
leakage-safe ranking differential, surface, recovered retirement/walkover
flag, recent match load. Full audit: **Appendix E.3.**

**1g — Soccer.** EPL gets Understat-backed shot-quality and keeper-form
add-ons; MLS gets generic factors only (no Understat coverage).

**1h — NBA and golf.** Both need the games-today loader `slate_rankings.py`
itself requires, confirmed absent for both — build that first. Golf also
needs `golf_elo` wired (0.4) before its ranking work lands. NBA add-on:
shot-zone/contact quality from `nba_shot_events` (440,596 real rows, two
seasons — a corrected figure, Appendix E.4). Golf add-ons: course-history,
Elo/recent-form, real birdie-rate, a properly-scoped *retrospective*
wind/precip split (golf's weather data isn't captured pregame).

**1i — Rebuild the existing curated Specials on the new engine.**
HR-of-the-day, anytime-TD, etc. become the first instances running on the
generic engine instead of their own one-off code — one system, not two
parallel ones.

---

## Phase 2 — Build the real advanced model, per sport

This phase is a build commitment, not a list of ideas to weigh later.
Every sport below gets its real architecture built now, using real data
already confirmed to exist. `generic_elo` is retired for that sport the
moment its real model is built and serving — it is not kept running
alongside the real model as a second option. Measurement (Phase 3's gate,
already correct and already built — Appendix B) happens after the build,
the same way it already does for every sport that has a real attempt today.
Shared display note: the game-level pick renders via `SlateGameCard.model`
(the Slate Games-section ring), gated by `model_status`. A probability on
the game-detail page itself needs a new field on `GameResearchData` —
confirmed absent for every sport today, including MLB — that's shared,
cross-sport work, not per-sport.

**2a — MLB.** Already has its own real architecture (`mlb_ensemble`) —
nothing to replace here. Real finding from this session: `game_sim_cache`
was never graded standalone until now (Appendix C) — beats a constant
baseline, ties the market (t=−0.47, 190 games), and a properly-held-out
Platt calibration improved it further (t=−0.59 vs. market on 69 held-out
games) — the best standalone result of anything tested this session, on a
sample still too small to trust outright. **Build: apply the calibration to
the live sim output now; let real picks accumulate past 200 for a real
gate decision.** Four alternative architectures already lost to this one on
real data — don't rebuild those (Appendix C).

**2b — NFL.** **Build the drive-efficiency simulation** from real
play-by-play (`nfl_pbp`/`nfl_target_events`, confirmed live and already
ingesting) — team offensive/defensive efficiency-per-play, simulated into a
scoring distribution, the same shape MLB's sim uses real batting/pitching
vectors instead of a rating alone. Wire `injury_report` (18,292 real rows,
confirmed unused) into it as a real availability input. This becomes NFL's
served model, replacing `generic_elo`.

**2c — CFB.** **Build the SP+-anchored win-probability model.** Fetch
CFBD's `/talent` and `/ratings/sp` (schemas confirmed live against the real
API) and center the model on SP+ directly — a fitted logistic mapping from
SP+ to win probability, blended with market — not a bolt-on feature on top
of Elo. SP+ is already a real, opponent-adjusted, efficiency-based rating
computed from far more cross-context data than this app's own ~14 seasons
of CFB history could resolve alone, which is exactly what the ridge-rating
attempt couldn't do (Appendix D). This becomes CFB's served model,
replacing `generic_elo`+calibration.

**2d — NHL.** **Build Dixon-Coles with real goalie and rest features
added** — individual goalie SV% trend (`player_game_history`), not team-
level allowed shots, plus real rest/back-to-back data. Dixon-Coles already
closed most of the gap Elo couldn't and carries a real, if sub-vig, positive
CLV signal (t=+2.81) even in its failed run — worth building out for real,
not just benchmarking as an afterthought. Real, disclosed gap that stays a
gap: no pregame confirmed-starter feed exists anywhere in this codebase — a
workload-share approximation is the honest stand-in, labeled as such. This
becomes NHL's served model, replacing `generic_elo`, once it clears the
gate.

**2e — Soccer.** **Build the clean Dixon-Coles re-run** on the now-fixed
shared engine — EPL first (774 matched rows, genuine open-to-close CLV).
This has a real, dated reason to expect a different result (Appendix D),
not just a hopeful retry. MLS needs its own separate fix (zero opening
prices on any book) before the same re-run means anything there. This
becomes soccer's served model for EPL, replacing `generic_elo`, once it
clears the gate.

**2f — Tennis.** **Build the fitted correction layer over `tennis_elo`** —
Elo differential + H2H + recent form + major/qualifier status, fit via
`model_fit.py`/`walkforward.py` (the same proven harness, same architecture
shape as MLB's stacking regression, applied here for real). Wire in the
leakage-safe ranking differential and the recovered retirement/walkover
flag (Appendix E.3) as real inputs. `tennis_elo` already isn't `generic_elo`
— it's a real fitted engine that's failing by 20 standard errors, so treat
the retest as a real test, not a formality.

**2g — NBA.** **Build the shot-zone-quality model now** — real shot
location/type per player (`nba_shot_events`, 440,596 rows, two real
seasons) against real zone-defense-allowed (`team_shot_profile`), replacing
the flat rate×minutes approach that manufactured fake edge via shrinkage
(Appendix D). The build and an initial backtest against the real historical
corpus don't need to wait — two full seasons of real outcomes already exist
to test against. What *is* calendar-blocked is forward CLV validation
against real closing lines (current season has 24 priced rows total,
Appendix E.4) — that's a gate-timing question for Phase 3, not a reason to
delay building. This becomes NBA's served model, replacing `generic_elo`,
once it clears the gate.

**Golf** — no advanced model, per your explicit direction. Not part of this
phase.

---

## Phase 3 — Interchange + retest, formalized

- One shared rule: wherever `model_status` says a sport/kind may not show a
  pick or probability, the Phase 1 ranking system renders instead, on the
  same surfaces — not per-sport special-casing.
- Add the missing scheduled job: **monthly** re-attempt of calibration/fit
  for every sport/kind still below `gated` — replacing today's ad hoc,
  manual-only triggers. This specifically covers re-testing MLB's sim
  calibration as its holdout sample grows past 200.

## Phase 4 — MLB validation benchmark

Run the still-undone benchmark — simple Elo+market+calibration vs. the full
ensemble, both reading the corpus (0.2) — for real evidence either way.
Given Phase 2a's finding (the isolated, calibrated sim is the most
promising standalone result found this session), the working direction is
**extend and properly validate MLB's existing depth, not simplify it away
by default.** The benchmark exists so that's an evidence-backed decision,
not an assumption in either direction.

---

## Full per-sport state

| Sport | Running today | Being built now (Phase 2) | Replaces `generic_elo`? | Deleted | Ranking gap | Display |
|---|---|---|---|---|---|---|
| MLB | `mlb_ensemble`, BASELINE | Apply the calibration already fit; accumulate real holdout | N/A — never ran `generic_elo` | `home_run_model.py` (surgical) | 15 of 17 markets | Ring + bottom element/chips |
| NFL | `generic_elo`, BASELINE | **Drive-efficiency simulation** from real play-by-play + injury data | **Yes, once built and gated** | `fit_nfl_elo.py` | 16 of 18 markets | same |
| CFB | `generic_elo`+calibration, BASELINE | **SP+-anchored win-probability model** | **Yes, once built and gated** | ridge scripts, `predict/cfbd.py` | 9 of 10 markets | same |
| NBA | `generic_elo`, BASELINE | **Shot-zone-quality model** from real shot data, backtestable now against 2 real seasons | **Yes, once built and gated** | — | 0 (building) | same, once loader built |
| NHL | `generic_elo`, BASELINE | **Dixon-Coles + real goalie/rest features** | **Yes, once built and gated** | — | partial | same |
| Soccer | `generic_elo`, BASELINE | **Dixon-Coles, clean re-run on the fixed engine** (EPL) | **Yes, once built and gated (EPL)** | — | partial | same |
| Tennis | `tennis_elo`, BASELINE | **Fitted correction layer over `tennis_elo`** (Elo+H2H+form+major/qualifier) | N/A — never ran `generic_elo` | — | 0 (building) | confirm ring wiring |
| Golf | `golf_elo`, not wired | Wire for real; no advanced model — operator direction | N/A — no model wanted | prediction tables | 0 (building) | chips/bottom only |

---

## Appendix A — Root cause: corpus vs. live Postgres, full numbers

Verified live, this session, via `corpus_location.py`'s
`read_parquet_glob()` (DuckDB reading Supabase Storage directly):

| Table | Rows | Span |
|---|---:|---|
| `odds_archive` | 1,979,268 | 1999-09-12 → 2026-09-10 |
| `prop_odds_archive` | 1,947,539 | 2025-03-27 → 2026-09-10 |
| `game_result` | 184,336 | 1999-09-12 → 2026-09-08 |
| `player_game_history` | 2,807,445 | 2010-08-14 → 2026-09-07 |

**`odds_archive` by sport:** mlb 572,234 (2010–2026) · nhl 330,930
(2007–2026) · nba 303,681 (2007–2026) · tennis_atp 231,383 (2015–2026) ·
tennis_wta 217,531 (2015–2026) · cfb 173,055 (2013–2026) · soccer_mls 66,878
(2012–2026) · nfl 41,899 (1999–2026, low count is schedule size, not a gap)
· soccer_epl 41,677 (2015–2026)

**`prop_odds_archive` by sport:** mlb 1,384,024 (2025-03→2026-09) · nba
210,489 (2025-10→2026-06) · nfl 157,230 (2025-09→2026-09) · nhl 68,880
(2025-10→2026-06) · soccer_epl 63,895 (2026-04→2026-09) · cfb 46,717
(2025-08→2026-09) · soccer_mls 15,774 (2026-04→2026-09) · tennis_wta 265
(effectively absent even in the corpus) · tennis_atp 265 (same)

**`player_game_history` by sport:** mlb 727,613 (2016–2026) · nhl 724,002
(2010–2026) · cfb 281,233 (2018–2026) · nba 279,661 (2015–2026) · nfl
226,629 (2012–2026) · soccer_epl 169,080 (2010–2026) · tennis_wta 138,602
(2016–2026) · soccer_mls 134,779 (2015–2026) · tennis_atp 125,846
(2016–2026)

**Why MLB looks architecturally different:** MLB has its own permanent,
never-pruned table (`historical_odds`, 37,922 rows, 2010–2026, de-vigged
consensus + outcome in one row) because MLB was built first, standalone,
before the shared corpus system existed. Every other sport's equivalent
history lives in `odds_archive` instead — subject to the corpus prune. That
architectural split, not a real data difference, is why MLB "had history"
and everyone else looked like they didn't.

Live database size, checked directly: **5,003 MB** — a repeated stale claim
of "79% full / 6,459 MB" from an older doc was wrong; the database actually
shrank as the corpus-prune system did its job.

---

## Appendix B — Model governance system (registry + gate), full detail

`python-odds-service/src/model_status.py` is the authoritative registry: one
row per `(sport, kind)`, four statuses (`none`/`baseline`/`gated`/`failed`),
each with a pre-registered `GateSpec`. `may_show_pick()` allows a pick at
`baseline`; `may_show_probability()`/`may_show_record()` require `gated`.
Already correctly designed, already governs MLB's own display (S5).

`model_gate.py`'s `modelGateJob` runs weekly, already in `JOB_REGISTRY`,
iterates every registry row, re-tests each via `predict/clv_backtest.py`
(already sport-generic).

**The `generic_elo` clarification, restated for anyone reading this
appendix without the phases above:** `generic_elo` is a shared, deliberately
simple placeholder, not an advanced model. See the per-sport "real advanced
candidate?" column in the full per-sport table above before assuming any
sport running it has something more sophisticated waiting behind it.

---

## Appendix C — MLB's own advanced model, full evidence

`mlb_ensemble` = park factors + starter ERA + rest/travel + a Monte Carlo
simulation + a stacking logistic regression, fit against `historical_odds`.
CLV backtest loses to the close (moneyline −0.0571 prob-pts, 37.9% positive
on 290–305 matched picks; totals −0.0159, 40.4%).

**`game_sim_cache`, isolated and graded standalone for the first time this
session.** Traced directly in `odds_lines_cycle.py`: its output is **not
dead code** — blended into the real served/locked prediction via
`apply_fitted_moneyline_weights`, because an active `model_weights` row
(version 8) exists. Graded against 274 decisive real games (`game_result`
join):

- Sim Brier 0.2314 vs. constant-baseline Brier 0.2466 — beats the naive
  baseline.
- Calibration bucket check: well-calibrated 27–40%, badly underconfident
  60–78% (predicted 64.5%, realized 80.8%).
- Against real closing de-vigged moneyline price (190 games): sim Brier
  0.23115 vs. market Brier 0.23336 — statistical tie (t=−0.47, correlation
  0.79 with market). Best standalone result of anything tested this
  session.

**Platt calibration, proper chronological holdout** (train=205, holdout=69,
never seen by the fit): A=1.2188, B=0.2865 (both push toward more confidence
and toward home, consistent with the underconfidence found above). Holdout:
raw Brier 0.21768 → calibrated 0.21526; raw log-loss 0.62620 → calibrated
0.61809 — real improvement on unseen data. Against market on the same 69
games: raw sim beats market by −0.0030 (t=−0.41), calibrated beats it by
−0.0054 (t=−0.59). Directionally positive, but 69 games is far below this
codebase's own 200-row minimum for trusting a calibration
(`MIN_ROWS_FOR_CALIBRATION = 200`, `platt_calibration.py`).

**Four alternative architectures, already tried, already lost — do not
retry:**

| Candidate | Data | Result |
|---|---|---|
| Bradley-Terry | 2020-23 train / 2024-25 test | Lost |
| Tree models (CatBoost/XGBoost/LightGBM) | same | Lost, "including the tree ensemble" named explicitly |
| MLP | same | Lost |
| Stacking meta-model | same | Lost |

Quoted from the commit: *"'formula' (the existing hand-coded pipeline) won
this benchmark, beating every new candidate including the tree ensemble and
stacking."* **Keep the harness** (`model_benchmark.py`,
`mlb_model_candidates.py`, `run_walkforward.py`) — real, monitored,
intentionally manual-cadence (`health_check.py` actively instructs re-running
it) — but don't re-run the same four architectures without new features.

---

## Appendix D — Every other sport's advanced-model attempt, full evidence

| Sport | Attempt | Real data | Result | Classification |
|---|---|---|---|---|
| NFL | Fitted Elo | 1999–2020 train, 1,709 held-out 2021–25 | 83% of the way to market, still lost, t=+2.55 | Approach-flawed — missing injury/QB/rest/travel signal |
| NFL | Anytime-TD prop | 9,683 held-out | Passed its own gates | Withheld by design — no fresh held-out season yet |
| CFB | Ridge margin ratings | 13,650 games — nearly the full corpus | 3 benchmarks negative; needs ~80 seasons to confirm | Data-limited, permanently — already used essentially all available data |
| NBA | Rate×minutes prop | 25,420 props, 329 athletes | ROI −8.78%; de-shrunk edge corr −0.004 | Approach-flawed — the "edge" was a shrinkage artifact, not signal |
| Soccer | Dixon-Coles | Real EPL/MLS | t=+3.05 (EPL), t=+4.37 (MLS) | **Confirmed timing bug, not a clean failure** — ran 2026-09-04 19:49:56, three hours before the shared engine's rho-boundary fix at 22:59:04 the same day. NHL's final score can never be 0-0 so the bug was invisible there; soccer has real draws, so the bug would have actively corrupted the fit |
| NHL | Dixon-Coles | 24,758 games | Lost, t=+5.07; real positive CLV too small to cover vig (t=+2.81) | Approach-flawed but real signal found — missing fatigue/goalie/motivation info |
| Tennis | Surface-weighted Elo | 19,025 held-out matches | Lost by t=+20.68 | Approach-flawed — explicit in the commit: "not miscalibration; information the model lacks" |
| Golf | Entire prediction layer | 9,560/528/119/6,231 rows | Reported Brier 0.00003 — a measurement artifact (graded after seeing the outcome) | Never actually fitted — hand-picked priors; also no archived price ever existed to gate against |

---

## Appendix E — Real, previously-unwired data found per sport

**E.1 — Ranking system's real market gap**, measured from
`prop_odds_archive.type_name`, last 30 days:

MLB (17 markets, 2 covered): total-bases (64,269/421), hits-runs-rbis
(63,075/420), hits (46,246/422), rbis (38,561/421), singles (23,869/420),
runs (20,544/420), walks (15,532/491), home-runs (12,606/421), doubles
(11,671/421), pitcher-strikeouts (10,731/168), stolen-bases (8,496/385),
pitcher-outs (4,211/168), earned-runs (3,934/168), pitcher-hits-allowed
(3,840/168), batter-strikeouts (1,226/223), triples (316/142),
pitcher-walks-allowed (46/23).

NFL (18 markets, 2 covered): receptions (5,784/238), rushing-yards
(1,045/104), receiving-yards (1,018/116), assists (541/201), longest-
reception (465/106), passing-yards (456/35), pass-attempts (369/31), tackles
(249/142), sacks (236/129), anytime-td (223/123), longest-rush (148/37),
kicking-points (67/17), rush-rec-tds (67/62), first-td-scorer (64/59),
passing-tds (61/22), longest-completion (56/12), field-goals-made (13/7),
interceptions-thrown (9/6), rushing-tds (3/3).

CFB (10 markets, 1 covered): receiving-yards (470/151), rushing-yards
(440/123), passing-yards (286/64), receptions (225/147), longest-reception
(112/61), anytime-td (49/46), longest-completion (16/12), kicking-points
(6/5), longest-rush (4/3), passing-tds (1/1).

**E.2 — Ranking factor library, full sourcing:**

Generic: recent rate in the exact stat, opponent's allowed rate, trend (not
just average), availability/role (`injury_report` — real for
NFL/MLB/NBA/NHL/CFB, absent for tennis/soccer/golf).

| Sport | Add-on | Source |
|---|---|---|
| MLB | Platoon/handedness split | `mlb_pitch_events` (pitch-level) |
| MLB | Contact quality | `mlb_pitch_events` (launch angle/exit velocity) |
| MLB | Park/weather (real, pregame) | `park_factors.py`, `weather.py` |
| MLB | Opposing starter's own recent form | `pitcher_game_score_history` |
| MLB | Home/road split | `player_game_history.is_home` |
| NFL | Real role/target share | `nfl_target_events` — NFL-only, CFB unconfirmed |
| NBA | Shot-zone/contact quality | `nba_shot_events`, `team_shot_profile` |
| NHL | Individual goalie form | `player_game_history` (`isGoalie`, `saves`, `shotsAgainst`) |
| Soccer (EPL only) | Shot quality (xG-style) | Understat, already fetched elsewhere |
| Soccer (EPL only) | Opposing keeper's real form | `player_game_history` (`goalsConceded`, `shotsFaced`) |
| Golf | Course-history, Elo/form, birdie-rate, retrospective weather | Appendix E per §5 originals |

Explicitly rejected as unbacked: CFB target-share (unconfirmed), NBA
pace/possessions, golf field-strength, MLB umpire tendencies.

**E.3 — Tennis, full audit:**

| Category | Real data? | Wired today? |
|---|---|---|
| H2H | Yes — `player_game_history.opponent_id` + `deepHeadToHead.ts`, verified to 2015 | No |
| Recent form | Yes — win/loss/sets/games/tiebreaks in `player_game_history.stats` | No |
| Ranking | Yes, but **leakage risk**: raw `WRank`/`LRank` are winner/loser-labeled ("scores ~100%" — importer's own comment); needs a symmetric rank-differential derivation | No |
| Injury | **Genuinely absent** — tennis isn't in `injury_snapshot.py`'s `SPORT_PATHS`. One salvageable proxy: the raw source's retirement/walkover flag is read once and discarded, never stored | N/A |
| Fatigue/travel | No dedicated signal | No |
| Surface | Yes — 100% real coverage, 57,386/57,386 matches | **Yes — only category already in the model** |

**E.4 — NBA, full audit, correcting a stale claim:**

"Full season of prices" still doesn't exist — 24 priced rows this season
(one preseason night), historical window unchanged (six weeks, not a
season). "Active roster feed" still doesn't exist — `injury_report` gives
status tags, not starters/rotation. **`nba_shot_events` has grown to
440,596 rows, 2,469 games, 684 shooters, two real seasons** — directly
corrects an earlier doc's "195 rows, single-game sample" claim; never used
by the failed model. `team_shot_profile` already exists, real. Minutes
projection is already validated (Phase 7's GBM beat rolling-5 by 6–9%) — the
original failure wasn't in minutes. `docs/CURRENT.md`'s "no NBA games
loader" claim is **false**, checked live — `load_sport_games('nba')` works
today; the real, narrower gap is `slate_rankings.py`'s own `SPOT_SEASONS`
dict omitting `'nba'`. Golf's `golf_shot_events` is a static 2020–2023 seed
with zero current rows — can't ground a live ranking. Golf's round
conditions are captured retrospectively, not as a pregame forecast.

---

## Appendix F — Dead-code audit, full caller-graph reasoning

Confirmed dead (zero real callers, traced to a specific cause) — see Phase
0.3 for the list. Confirmed live, explicitly not touched:

- MLB benchmark-candidate quartet + harness — `health_check.py`'s
  `check_mlb_model_freshness()` actively instructs re-running it via
  `run_walkforward.py`; `MAX_MODEL_AGE_DAYS = 45` is a documented,
  deliberate manual-cadence design, not neglect.
- `model_fit.py` — its `model_weights` output is read live by
  `odds_lines_cycle.py`.
- `dixon_coles.py`/`dc_walkforward.py` — live, in active reconsideration
  (Phase 2d/2e).
- TS `eloModel.ts`, `modelFit.ts`, `homeRunModelFit.ts` — confirmed live via
  real admin-route imports (`elo-sanity`, `elo-backfill`, `fit-weights`,
  `fit-total-weights`, `refresh-hr-matchup`, `fit-home-run-weights`,
  `evaluate-total-baselines`). `modelFit.ts` specifically produced the
  currently-active `model_weights` version 8.
- `savant.py` — real, careful Statcast port, zero current callers, but a
  genuinely stalled TS→Python cutover, not a deletion orphan — finish
  wiring it (0.4), don't delete.
- `golf_elo.py` — registered as golf's live model, but its `ratings()`/
  `rank_field()` functions have zero callers anywhere — a real bug, fix
  (0.4), not a deletion.

---

## Appendix G — Explicitly open items, not assumed either way

- Whether NFL/CFB have a real *pregame* weather feed (golf's turned out to
  be retrospective-only — don't generalize from that either way).
- Whether CFB's play-by-play carries NFL-level target-share detail.
- Whether `gameModel.ts`/`simEngine.ts`/`simGame.ts`/`simRates.ts` (TS,
  MLB) are independently live or only reachable as internal dependencies of
  the confirmed-live TS files — not resolved this session.
- Exactly what currently serves MLB's Statcast player-page displays, which
  `savant.py`'s wiring needs to replace — needs identifying before that
  work starts.
