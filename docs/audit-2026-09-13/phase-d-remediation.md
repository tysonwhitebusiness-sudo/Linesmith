# Phase D — Remediation plan

**Status: PROPOSED 2026-09-13. Requires operator approval before any code changes.**
Phases A–C were log-only and remain so. Nothing in this document has been done.

Grouped **by fix-shape, not by sport** — because several findings that look like
eight per-sport bugs are one job, and sizing them per sport would overcount the
work by roughly that factor.

---

## First: B1's root cause, traced during this phase

Phase B left "CFB player pages are blank" untraced and flagged it as the one
item that could be anywhere between one line and a pipeline. It is **neither a
pipeline nor the provider outage it first looked like.** Traced:

1. **Not the frontend snapshot cache being stale.** `cfb:snapshot` was written
   **today at 18:24**, 513 KB. Every sport's snapshot is fresh.
2. **But its contents are ten days old.** The payload lists **games dated
   2026-09-03/04** and carries an internal `fetchedAt` of **2026-08-31**. So the
   snapshot is being **rebuilt on schedule and the rebuild is producing stale
   content.**
3. **No prop rows exist for any of today's CFB games** — a direct query over 60
   of today's game ids returns zero rows from all five providers. Consistent
   with (2): the snapshot is asking about games that finished ten days ago.
4. **The Python job is separately, and correctly, reporting itself unhealthy.**
   `refreshCfbJob`, run today at 18:45: `healthy=false`, `games: 146`,
   `requests: 0`, `fetched: false`, warning:

   > *skipped paid providers — cold tier, no game within the hot/warm window*

   The job sees **146 real games today** (so ESPN is fine) and declines to spend
   because `gameday.py`'s tier logic finds nothing within `HOT_BEFORE_HOURS = 6`.
   On a Saturday CFB slate at 18:45Z that is itself suspect and needs checking.

**So there are two independent faults**, and both must be fixed or CFB stays
blank: a **stale-content snapshot build** (frontend) and a **tier window that
never goes hot for CFB** (Python). Neither is large. Sizing below reflects the
trace, not the original guess.

**A methodological note worth keeping:** `fetchedAt` inside a snapshot payload
is **not** the cache write time. MLB's payload reads 2026-09-11 while
`snapshot_cache.fetched_at` for `mlb:snapshot` reads today 18:47, and the MLB
page renders live in-progress games. Judging freshness by the in-payload stamp
would have produced a false "every snapshot is stale" finding across six sports.

---

## Group 1 — One shared read path to `game_result` ◆ LARGEST PRIZE ◆ LARGE

**Findings:** Phase A Gap 2.

`game_result` holds **184,108 rows — NFL from 1999, NBA/NHL from 2007, MLB from
2010, MLS 2012, CFB 2013, EPL and tennis 2015** — and
`grep -rn "game_result" lib/ app/ components/` returns **nothing**. It is
Python-only. Every team and game page in the app is blind to 16–27 years of real
results.

**Why this is one job, not eight:** the table is already sport-generic
(`sport, game_date, home/away ids, scores, venue, surface, court`). One read
module plus one `cachedRoute` gives every sport deep history at once, and Phase
B7 proved the shared components already render deep multi-season history
correctly without modification — soccer renders 259 games through them today.

**Precondition — read `CLAUDE.md` before choosing a cache key.** The
`snapshot_cache` table is one flat namespace and the golf collision it documents
is exactly the failure mode here.

**Sizing:** large, and the only item here that needs design before code. Should
be scoped as its own piece of work rather than bundled with the rest.

## Group 2 — Connect parts that already exist ◆ BEST RATIO ◆ SMALL

Three findings, one shape: **the component exists, the data exists, the slot
exists, the wire does not.**

| # | what | sizing |
|---|---|---|
| **C4** | `NbaLiveTab`, `NhlLiveTab`, `FootballLiveTab`, `SoccerLiveTab`, `TennisLiveTab` are all built and wired into `GameDetail` only. `PlayerDetailData.liveGame` is MLB-only. Live routes exist per sport. | small ×5 |
| **C7** | Tennis surface. `game_result` holds it for **56,386 matches** (Hard 33k / Clay 16k / Grass 6.7k). The adapter documents precisely what is missing: `buildSyntheticPlayerCandidates` never sees the event, so nothing carries the tournament onto `subjectMeta`. | small |
| **B6** | `seasonStatus.label` is populated and unread. NBA's offseason header renders `0-0 · 0th seed, Eastern Conference in division` while the snapshot already carries *"The 2026-27 NBA season hasn't tipped off"*. Also fixes the `0th seed` formatting bug. | small |

**Recommend doing this group first.** Highest visible improvement per hour, no
design decisions, and each item is independently shippable.

On C7, note the existing comment refuses to stub `meta.surface` because it
*"would compile, render nothing forever, and look finished."* Any fix must plumb
the event through, not satisfy the type.

## Group 3 — Collapse the duplicate sport-named fields ◆ MECHANICAL ◆ SMALL-MEDIUM

| # | what |
|---|---|
| **C1** | `hitterStats` (MLB only) and `nflSeasonStats` (**nfl, cfb, nba, nhl, soccer**) render the same season-stats card. `nflSeasonStats` is the generic one wearing NFL's name. Collapse to one neutral field. |
| **C6** | MLB alone lacks `pregameLines`, using `gameLine`. |
| **C2** | Four golf-only fields (`liveMatchup`, `roundScores`, `seasonStatsCard`, `golfFormHoles`) explicitly `null`-ed by all seven non-golf adapters — 28 dead lines. Fix by making them optional, not by deleting the cards. |

Mechanical, `tsc --noEmit`-verifiable, touches many files shallowly. **Do it
after Group 2, not before** — Group 2 adds fields, and doing the rename first
just means renaming them twice.

`CLAUDE.md` §4 should be updated in the same change: C1 is a fresh worked
example of the exact pattern that section teaches, and two of its three original
examples have already gone stale.

## Group 4 — Correctness bugs with located causes ◆ SMALL

| # | what | cause |
|---|---|---|
| **B2** | The WTA page shows men's matches (Khachanov, Zverev, Shelton beside Gauff and Sabalenka). Also empties the WTA game page's four history arrays. | `espnTennis.ts:53` iterates every ESPN grouping with no slug filter. The correct filter already exists in `schedule.ts:279` reading the same endpoint. Mirror it. |
| **B1a** | CFB snapshot rebuilds with ten-day-old content. | Traced above; not yet root-caused to a line. Budget investigation, not just a fix. |
| **B1b** | `refreshCfbJob` never goes hot on a live Saturday slate. | `gameday.py` tier window vs CFB kickoff times. |
| **B5** | NFL games strip links to a completed game the detail route has dropped (`401872657`, SF@LAR) → dead link. | Strip retention vs route window. |

**B2 is the highest-severity item in the whole audit relative to its size** — it
is a visible correctness failure (wrong athletes on a gendered tour) whose fix
already exists in the codebase, in a sibling file, reading the same API.

## Group 5 — Cards that contradict their own numbers ◆ SMALL

| # | what |
|---|---|
| **C9** | NFL matchup card: *"Biggest edge: … 48th percentile"*. An argmax with no floor always names something. Needs a threshold below which the card says "no clear edge". |
| **C8** | Soccer opens a **right-back's** page on **Anytime Goalscorer** — 1.9% season rate, 5 hits in 259 games. Default market is not position-aware. |
| **C10** | NFL card reads `OPPOSING DEFENCE` / `NYG defence` — British spelling. |

These are judgment changes, not wiring. C9 and C8 both make the app *say less*,
which is the correct direction: a card that announces a non-existent edge costs
more credibility than a card that stays quiet.

## Group 6 — Blocked or deferred

| # | what | unblocks when |
|---|---|---|
| **Golf audit** | Held at operator instruction. Unassessed for three phases. `golf_hole_scores` spans only 2026-08-16 → 08-30. | a live tournament |
| **NBA / NHL re-score** | Offseason; Phase C verdicts are provisional and calendar-bound. | October |
| **CFB card verdicts** | No cards render, so nothing can be judged. | Group 4 / B1 |
| **C3 — model coverage** | `model` is MLB-only on both player and game pages; six sports have no fitted model. | its own program — not an audit fix |
| **Table-ownership map** | `docs/table-ownership.md` self-declares stale (51 real tables vs 36 documented). | a re-derivation, per its own rule |
| **Doc correction** | `seasonAggregates.ts` claims `player_game_history` holds 2.75M rows; it holds ~0.77M. | next touch of that file |

---

## Recommended sequence

1. **Group 4 / B2** — worst user-visible correctness bug, smallest fix, cause located.
2. **Group 2** — best ratio in the audit; unblocks visible richness across six sports.
3. **Group 4 / B1** — unblocks CFB entirely, which unblocks CFB's Phase C verdicts.
4. **Group 5** — cheap credibility fixes.
5. **Group 3** — mechanical cleanup, after Group 2 has settled the field set.
6. **Group 1** — the large one; scope separately, design the cache key first.

Groups 1 and 6 are the only items that need design or waiting. Everything in
groups 2–5 is bounded, located, and independently shippable.

## What this plan does not claim

- **No effort estimates in hours.** Sizes are relative (small / medium / large).
- **B1a is not root-caused to a line** — only localized to "the CFB snapshot
  build produces Sep-3 content on a Sep-13 rebuild". It is the one item here
  that could still surprise.
- **Group 5's thresholds are judgment calls** the operator may want to set
  personally — what percentile counts as an edge is a product decision, not a
  bug fix.
