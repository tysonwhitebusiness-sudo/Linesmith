# CURRENT — pick up here

> Handoff file for switching accounts mid-work. **Rewritten, not appended.**
> If it disagrees with anything else, trust `docs/audit-remediation-plan.md` §11
> and `git log` — those are the record; this is just the baton.

**Prompt to paste into a new account:**

```
Read docs/CURRENT.md and continue from there.
```

**THE RULE THAT KEEPS THIS FILE USEFUL: at ~92% context usage, stop.** Take on
no new work, finish or checkpoint what is open, and rewrite this file, then
commit and push.

## The documents, in reading order

1. **`docs/audit-remediation-plan.md`** — §0 (working rules, standing decisions
   **Q1–Q36**, the G1–G8 gate) and the phase you are working.
2. **§11** — the phase log. Phases 0, 1, 2, 3, **5** all have PASSED gate
   entries. Phase 4 is logged task-by-task and its gate has not run.
3. **`docs/table-ownership.md`** · 4. **`CLAUDE.md`** · 5. `docs/audit-phase-*.md`

**Last updated:** 2026-08-29 ~08:45Z, mid-Phase-4.
**Repo state:** clean, pushed. Worker live on `fccd9f0`.

---

## 1. Where we are

**Phases 0, 1, 2, 3, 5 COMPLETE — all gates PASSED.**
**Phase 4 IN PROGRESS.** 3 of 13 tasks done, one long job running.

Phase 5 finished this session: all 13 tasks, gate G1–G8 passed on the re-run
after G1 failed once (see §11 — the failure and its diagnosis are the most
useful thing in that entry).

### Phase 4 status

| Task | State |
|---|---|
| **Q28** market reference for `game_picks` | **DONE** — prerequisite for 4.2/4.3/4.5 |
| **4.1** `market_prob` coverage | **DONE** — real causes measured, staleness split fixed |
| **4.7 golf** | **DONE — decided NOT to build.** Reasoning in §11 |
| **4.7 NBA** | **RUNNING NOW** — see §2 |
| 4.7 MLB | not started — the highest-value half |
| 4.7 tennis | not started — the genuine new source |
| 4.2 activation gate | not started (Q28 unblocked it) |
| 4.3 Platt calibration | not started |
| 4.4 shadow flag | not started — `model_weights` has no `shadow` column |
| 4.5 CLV | not started |
| 4.6 fade signal | not started |
| 4.8 collapse two MLB game models | not started |
| 4.9 split `edge` definitions | not started |
| 4.10 both sides for generic sports | not started |
| 4.11 totals distribution | not started |
| 4.12 model hygiene (8 items) | not started |

## 2. RUNNING RIGHT NOW — do not kill blindly

**NBA `player_game_history` backfill.**

```
cd python-odds-service
python -u src/backfill_player_game_history.py nba    # already running
tail -f python-odds-service/nba_backfill.log
```

Progress at last check: season 2017, 900/1231 games, **45,603 NBA rows written
(was 0)**, 0 failed, ~160 games/min, ~7 min per season, 11 seasons total
(2016–2026). Expect ~60 more minutes.

**It is safe to kill and restart.** Resumability is by design: before fetching a
game it checks `player_game_history` for that `(sport, event_id)` and skips the
network call entirely. The database is the only progress state, so restarting
never re-pays for completed work.

**Verify when it finishes:**

```sql
SELECT sport, count(*), min(season), max(season)
  FROM player_game_history GROUP BY sport ORDER BY 2 DESC;
```

NBA should reach roughly 500k–600k rows across 11 seasons.

## 3. Next actions, in order

1. **Confirm the NBA backfill finished clean** (§2), then log it in §11.
2. **4.7 MLB** — the highest-value half, and 4.7's own note says MLB is where
   all the graded history lives. `predict/statsapi.py:383`'s
   `get_people_with_game_logs(ids, group, season)` already returns per-game
   logs, and its `GameLogSplit` maps almost 1:1 onto `PlayerGameHistoryInput`.
   Walk **historical** rosters per season (P3 L3) or it inherits the exact
   survivorship bias 4.7 exists to fix. Wants its own `discover`/`parser`
   branch, not another `SPORT_CONFIGS` row.
3. **4.7 tennis** — no per-match player-history module exists in Python at all.
   Largest of the four.
4. **4.2**, now unblocked by Q28 — but read §4 first, the sample is small.
5. The rest of Phase 4, then its gate.

## 4. What Phase 4 has actually learned so far — read before 4.2

**The plan's Phase 4 text is stale in two places, both measured:**

- **4.1's "resolve_candidate_edge has never run" is wrong.** It runs, from
  `prop_pick_history.py:43`, `generic_prop_score.py:188` and
  `generic_rare_markets.py:137`. It returns None almost always instead.
- **The two causes 4.1 names are not the dominant ones.** Measured: staleness
  is (5,877 same-book two-sided pairs exist; **2** are inside the 30-minute
  bound at any instant, because `refreshTier1` rewrites ~238 rows per cycle
  against a 49,000-row table). Fixed by splitting the display bound from the
  reference bound. Second cause is **under-side scarcity** — 43,620 overs
  against 5,113 unders, `propline_2` supplying **zero** unders — which no code
  fixes and which is exactly why **Q26** exists.

**4.2 will run on a small sample and that must be stated, not hidden.**
Q28 built the market reference and it works (MLB 91 values, real books,
pinnacle 22). But `game_odds_book_lines` is a current-state table, so only
recent games still have lines to reference: **graded MLB picks with both a
model and a market probability = 12, of 125 graded.** `game_odds_history`
covers only 41 of 176 MLB picks. Q24 says a model that loses to the market is
deactivated — at n=12 the gate cannot discriminate, so **run it, report the
number and its uncertainty, and do not deactivate on an underpowered sample.**
Record exactly that.

**A correction carried into this file** (it was wrong here before): bookmaker
canonicalisation being "part of why 4.1's resolution rate is 18%" is true for
game lines and **false for props** — `prop_odds` has 17 bookmakers and 17
lowercased bookmakers, so its casing was never split. 5.3 is load-bearing for
`game_odds_book_lines` and Q28's reference; it is not a 4.1 fix.

## 5. Things that will bite again

- **Fault injection is easy to fake — four occurrences now.** The newest:
  `scripts/gate/phase-5-constraints.mjs` first reported all 17 violations
  "rejected", and every one was rejected by a `NOT NULL` on
  `fetched_at`/`category`, not by any CHECK constraint. Nothing was being
  tested. Caught only because the script inserts a known-good CONTROL row per
  table and asserts `e.constraint` equals the specific constraint under test.
  **Never accept "the operation failed" as evidence — assert WHY.**
- **Reverting a fix and re-running its test can prove nothing.** Reverting
  `mlb_game_lines.py` produced an ImportError, not a failure. The real
  counterfactual came from extracting the pre-fix function out of git history
  and running the same fixture through it.
- **A deploy does NOT mean every writer runs the new code.** This cost the
  Phase 5 gate a full G1 failure. Render restarts the worker, but OddsHarvester
  runs as Windows scheduled tasks (`LinesmithOddsHarvester*`, ~20-min cycle) and
  Python binds imports at process start, so a run begun before your change keeps
  writing old behaviour for up to 20 minutes. **Any migration that normalises a
  column needs re-applying after those processes cycle**
  (`20260829110000_canonical_bookmaker_residue.sql` exists only for this).
- **The plan's own task text goes stale, repeatedly.** This session: 5.6 was
  already fixed; 5.1's alias table was real but incomplete and missed the actual
  cause; 5.4's `side IN ('over','under')` would have rejected 449 legitimate
  `'other'` rows; 4.1's premise is wrong. **Measure before implementing.**
- **`withJobLock` is a LEASE TABLE, not an advisory lock.**
- **Postgres UNIQUE treats NULLs as distinct.**
- **A long heredoc breaks this shell** (>~120 lines → "unexpected EOF"). Use the
  Write tool for long files.
- **`cd` persists between Bash calls.** Use absolute paths.
- **Git Bash `/tmp` is not Python's `/tmp`.** Bit me again this session.
- **Stale `.next/types` break `tsc` after deleting a route** — `rm -rf .next/types`.

## 6. Operational knowledge

- **DB access:** temp `.mjs` in the repo root, `node` it, delete after. `:6543`
  is the transaction pooler; use `:5432` for DDL.
- **Tests:** `npm test` (**36**) and `python -u src/test_x.py` from
  `python-odds-service/`. **13** hermetic Python tests, all now in
  `.github/workflows/ci.yml`, one step each.
- **Gate scripts:** `node scripts/gate/phase-5-constraints.mjs` (every CHECK
  tripped deliberately) and `node scripts/gate/phase-5-budget-race.mjs` (the
  5.12 race, both directions, with the counterfactual).
- **Render:** worker `srv-da36bm2bkg8c73fqrdeg`, `autoDeploy: no` — after any
  push touching `python-odds-service/`, POST a deploy and confirm the live
  commit. ~90s.
- **Propline budget:** `propline` 1000/day (MLB), `propline_2` 1000/day
  (soccer), now genuinely separate. **18 of ~20 authorised propline_2 probe
  calls spent** capturing `docs/propline-live-capture-20260829.json` — reuse
  that file rather than re-probing.
- **No `gh` CLI and no GitHub token.** CI via the public Actions API.
- **Don't `git add -A` blindly** — `docs/discord-community-prompt.md` is the
  operator's. Use `git add -A -- . ':!docs/discord-community-prompt.md'`.
  Note: adding a gitignored path to that pathspec makes `git add` exit non-zero
  and silently skip the commit behind `&&`.

## 7. Backup tables outstanding

| Table | Rows | From |
|---|---|---|
| `prop_odds_dedup_backup_20260829` | 178,238 | Phase 3 |
| `game_odds_book_lines_bookmaker_backup_20260829` | 6,199 | 5.3 |
| `game_odds_book_lines_quarantine_20260829` | 114 | 5.4 (Q23) |
| `game_odds_history_bookmaker_backup_20260829` | 47,622 | 5.13 |

## 8. Carried forward / known not done

- **5.1's second VERIFY half is still unconfirmed.** `prop_odds` has not yet
  gained Propline **batter** rows because `propline` is correctly gated at
  1000/1000 for 2026-08-29. All 24 live market keys resolve in
  `test_propline_alt_lines.py`. **After 00:00 UTC run:**
  ```sql
  SELECT market_key, count(*) FROM prop_odds
   WHERE provider_id='propline' AND fetched_at > '2026-08-30'
   GROUP BY market_key ORDER BY 2 DESC;
  ```
  Before the fix this returned exactly one MLB market (`pitcher-strikeouts`).
- **`/diagnostics`, `/bets` and the signed-in walk were never verified** — no
  credentials; creating an account or entering a password is out of bounds.
- **`refreshSportsGameOddsJob` has not run since 04:38Z**, having hit vendor
  HTTP 429s. Pre-existing (proven: the 07:00Z sweep recorded the same last-run),
  unowned.
- **`snapshotCacheSize` unhealthy** — 12.6 MB payload against a 10 MB bound.
- **Sharp coverage 9.08%**, under 5.2's own 10% threshold, so a Pinnacle-class
  feed is justified by the plan's rule. Recommendation only — **nothing
  purchased**. Pinnacle currently covers one market of thirteen.
- **5.9 lowered the ParlayAPI gate by 20%** — soft caps of 800 against a hard
  1000 were configured and ignored; now they bind. Unset the env vars rather
  than reverting code if unwanted.
- **2,380 duplicate observation groups in `game_odds_history`**, revealed not
  created by 5.13. Owner: 6.1.
- **3.15's two GET-path writers** remain, carried from Phase 3.
- **No push alerting** (Q19) — Phase 8. **Rate limiting per-process** — Phase 8.
- **`SUPABASE_SERVICE_ROLE_KEY` cannot be rotated** — Phase 7.
