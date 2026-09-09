# CURRENT — pick up here

**Phases 1, 2 and 3 of `docs/master-plan-2026-09-06.md` are COMPLETE.**
**Phase 4 (NFL) is COMPLETE except for 4.2 and 4.5, which the season blocks.**

Phase 3's full narrative now lives in the master plan (§3.0–§3.5) rather than
here — it is closed, and this file is the baton, not the archive.

---

## THE ONE THING BLOCKING PROGRESS: a Render deploy only the operator can do

**I cannot deploy.** There is no Render CLI or deploy script in this repo and
`render.yaml` sets `autoDeploy: false`. This has to be a manual deploy from the
Render dashboard.

Two separate things are waiting on it, and the first is time-critical:

1. **The Phase 3.5 pregame-price fix (`9a5e862`, 2026-09-08 20:14) is NOT on
   the deployed worker.** The last deploy landed ~2026-09-08 02:16, eighteen
   hours earlier. Until it deploys, `generic_price_attach` can still record an
   **in-play** price as a pick's permanent entry price. This is exactly the bug
   that made Phase 3.5's first CLV measurement report severe negative edge that
   did not exist — 85.4% of MLB moneyline rows in `game_odds_book_lines` are
   post-commence.

   **NFL Week 1 is 2026-09-09.** Sunday's 4:25pm and 8:20pm windows are when
   games overlap most and in-play rows are densest. Every pick written before
   this deploys risks a contaminated entry price, and an entry price is
   permanent — it is not recoverable by a later re-fit. The 3.5 measurement had
   to be rebuilt from `game_odds_history` to work around exactly this.

2. **`nflProjectionsJob` does not exist on the deployed worker.** It was added
   to `JOB_REGISTRY` in `341358f` and runs hourly. Until deploy, the NFL board
   serves whatever the last manual run wrote and then goes stale.

Deploying also picks up 3.0's calibration gating and all of Phase 4's fits.

---

## Where Phase 4 stands

| step | state |
|---|---|
| 4.0 audit | DONE — `python audit_nfl_phase4.py` re-derives every number, exits non-zero if a classification stops matching the data |
| 4.1 Elo | DONE — **the market beats the model**, t=+2.55. A baseline, not an edge; must not be displayed as one |
| 4.2 CLV game gate | **BLOCKED ON THE SEASON** — 17 NFL picks exist |
| 4.3 prop projections | DONE — beat a flat baseline on all four markets |
| 4.4 longest reception | DONE — Weibull; the exponential guess was wrong |
| 4.4b anytime TD | DONE — clears a home-runs gate and beats home runs |
| 4.5 probability gate | **BLOCKED ON THE SEASON** — see below |
| 4.6 Scan | DONE (`341358f`), verified live |

**4.5 cannot be run, and this is not a scheduling excuse.** NFL's entire prop
archive is one season, dense only Sept–Nov 2025. At MLB's cutoff its largest
market has **42 held-out rows**. There is no held-out set to gate a probability
on until the 2026 season produces one. Every NFL calibration is therefore
persisted `probability_ok = false`, and `nfl_prop_serving.to_cache_rows`
**asserts** `model_prob is None` on every row before writing.

**4.6's gate contradicted itself, and the resolution matters.** It asked for
NFL rows "ranked against MLB rows" AND "no probability on any market that has
not cleared 4.5". Both cannot hold — the cross-market rank *is*
`P(over) − baseline`, so a row with no probability has nothing to rank on. The
no-probability half wins, because it is the half carrying the evidence claim.
Under Phase 2's own rule an unranked row is a first-class state: it appears,
shows its projection, ranks WITHIN its market, and takes no global position.
Measured live on `/nfl`: **0 rank chips**, which is correct, not degraded.

---

## What 4.6 shipped, and how it was verified

Five pieces: `predict/nfl_markets.py`, `predict/nfl_prop_serving.py`,
`nflProjectionsJob` in `JOB_REGISTRY`, `readNflProjections()` +
`app/api/nfl/projections/route.ts`, and
`lib/sports/nfl/adapters/statsBoardAdapter.ts`.

Verified on a **production build against real data**, not a unit test:
`/api/nfl/projections` returns 5 markets / 1,931 rows with
`hasProbability=false` on all five; on the live `/nfl` board 7 of 7 Receptions
candidates join and render a projection with its sample size ("Some history —
30 games behind this projection"), and the 2 Passing Yards rows correctly carry
none, that market being unfitted. `tsc` clean, 359/359 TS tests, 38/38 job
registry contract.

**Two things here will bite anyone who assumes rather than measures.**

- **The subject-id prefix is not what the code says it is.**
  `lib/sports/nfl/adapter.ts` documents `espn:nfl:{id}`; `teamSportEspn.ts`
  actually builds `espn:${espnSport}:${id}`, and NFL's `espnSport` is
  **football**. Live value: `espn:football:4678006`. Stripping the literal
  `espn:nfl:` leaves every id untouched and matches **zero** history rows —
  silently, because a miss is a skipped player, not an error. `_bare_id` splits
  on the last `:` instead. Same failure class that cost 4.3 an hour.
- **`athlete_crosswalk` holds zero NFL rows with a name**, so
  `readNflProjections` does no name join at all — joining would have dropped
  177 of 1,931 rows and still rendered the rest nameless. Scan takes the name
  from the candidate.

Also shipped (`c229399`): Scan's row footer is now **always** rendered when
there are rows — "Showing 150 of 1,604" plus "Show 50 more" / "Show all".
Verified on MLB: 150 → 200 on one click. An absent footer was ambiguous between
"everything is on screen already" and "the button is broken".

---

## Next actions, in order

1. **Operator deploys to Render.** Nothing below is worth doing first, and item
   1 above degrades with every hour of live NFL.
2. **Phase 5 — college football.** Already underway as a season, so it is next
   by the same ordering rule that moved NFL ahead of NBA. Ridge/least-squares
   rating on margin; residual against the closing spread is the signal. Spreads
   back to 2013 (13,569 games) vs moneylines only from 2021 (4,017) — model the
   spread. CFBD spread rows carry lines but **zero prices**, so CLV is
   measurable only on the 2025–26 ESPN rows. **Props are out of scope**: zero of
   45,000 rows are two-sided.
3. **The database optimisation the operator has planned is now on the critical
   path** — see the headroom number below. It is no longer something that
   happens after the phases.
4. **4.2 and 4.5 reopen once the 2026 NFL season produces rows.** Nothing to do
   until then; do not re-run them hoping for a different answer.

---

## Open, deliberately not closed

- **`served_probability_spread` is computed and persisted but NOT gated.** A
  positive slope only says the ordering is not reversed. `pitcher-strikeouts`
  shipped monotone at +0.971 and useless: projections spanning 0.56–7.35
  strikeouts mapped into a 35.3%–51.7% band, 16.4pt where `hits` got 46.9pt.
  The honest threshold is not known; inventing one would be a guess dressed as
  a criterion.
- **The ranking metric favours low-baseline rare-event markets.** On the
  2026-09-07 board, 8 of the top 12 were `stolen-bases` (P ≈ 23% against a 7.0%
  baseline). That is `P − baseline` behaving exactly as specified, but it is a
  ranking-quality question worth the operator's eye.
- **`hits` has a board line but no `StatMarketDef`**, so `mlb_prop_grading`
  cannot grade it. Latent, not live: grading only handles
  `category in ("over","under")` and the board writes `category="projection"`.
- **`logSurfaced` (`lib/db/client.ts:1021`) has zero callers** — an
  unreferenced writer still inserting `prop_score`/`score_grade`/`trust_tier`
  into `pick_history`. Residue from Phase 1.
- **The PA simulation (3.3) is built, validated, and wired to nothing.** 3.4 was
  a dead heat, and a tie means no change. Do not wire it without a new
  measurement.

## Known gaps, carried forward

- **`prop_model_cache` is the only table holding prop model output.**
  `pick_history` receives only MLB game-moneyline rows; its historical prop rows
  came from the deleted model — treat that track record accordingly.
- **THE DATABASE IS THE NEAREST HARD LIMIT: 81.3% (6,659 MB of 8,192)**,
  measured 2026-09-06, up 200 MB in the week prior. At ~1.2 GB/week ambient
  growth that is roughly **nine days** of headroom from that date, and the clock
  runs on the harvester, not on work done here. Largest tables:
  `player_game_history` 1,754 MB, `odds_archive` 1,144 MB, `prop_odds_history`
  979 MB, `prop_odds_archive` 767 MB.
- **`odds_unresolved` is 22,838 rows.** Phase 8.
- **Park factors still are not wired and cannot be** — no path from a
  player-game to a venue. The engine's multiplier hook is tested inert at 1.0.
- **A calibration backup exists** at
  `python-odds-service/mlb_calibration_backup_20260906.json` (untracked): the 13
  active MLB rows as they stood before 3.0. `write_calibration` is versioned and
  deactivates prior rows, so a revert is a version flip or a re-fit.

## Standing constraints

- **Do not deploy to Render without asking** — but note the deploy is now the
  top item above, so ask.
- **Never `git add -A` or `git add docs/`** — `docs/discord-community-prompt.md`
  is the operator's.
- **A numeric id matching the expected shape is not evidence it is the right
  id.** 399 MLB ids once matched by shape and **0.00%** landed on the right game
  date. The `espn:football:` finding above is the same lesson from a third
  direction.
- **The operator must read `app/privacy/page.tsx` before it is public.** Blocks
  any public exposure, per the plan's §2.4.
- **A dev server started before your changes can serve a deleted route from a
  stale compiled build.** Verify page removal on a freshly started server. A
  stale server on port 3000 404'd `/api/nfl/projections` during 4.6 for exactly
  this reason.
- **Scan empties once a slate finishes** — it drops candidates whose game is
  `done`, so a board carrying 844 rows in the afternoon legitimately falls to 33
  at midnight. Verify earlier in the day, or rebuild in memory against
  `mlb_prop_serving.build()`, which needs no dev server and writes nothing.
- **A long-lived dev server degrades**: `/api/props/lines` returns ~94k rows and
  `slateProps.loading` eventually stops settling. Restart fixes it.
- **The shared Postgres pooler caps at 15 connections.** Check for running fits
  before starting anything DB-touching. A full `fit_mlb_props.py` run is ~40
  minutes for 14 markets.
- **The Python tests are standalone scripts, not pytest** — `pytest` is not
  installed. Run each with `.venv/Scripts/python.exe <file>`; two of them
  (`test_mlb_mlp.py`, `test_mlb_tree_models.py`) do live model fits and take
  ~10 minutes each. `test_harvester_scrape.py` cannot run locally at all — it
  imports `oddsharvester`, which is not installed here. The TS suite is
  `npm test` (`node --test`), not vitest.

## The standing heuristic Phase 3 produced, and Phase 4 kept using

**Four of Phase 3's five sub-phases turned on a measurement being wrong rather
than a model being wrong**, and each produced a confident, publishable-looking
number first: `pitcher-outs` had the *best* ECE in the book while its
calibration was inverted; xwOBA lost at t=−4.06; the simulation lost at t=+6.12;
CLV read t=−5.83. Phase 4 hit it twice more — the Elo's first t=+7.82 was a
cross-book de-vig that stripped the vig entirely, and `fit_nfl_props.py`
silently joined zero rows by reusing MLB's crosswalk.

**The tell is the same every time**: a result that is too clean, or several
things failing in the same direction at once. Check the measurement before
believing the model — in both directions, including when the number flatters.
