# Card audit — build plan

**Status: APPROVED 2026-09-13. All five decisions taken as recommended (below).
Phase 0 DONE 2026-09-13 — baseline in `before/README.md`, which adds three
findings to 1b and one to 5b.**

**ON HOLD 2026-09-13 at operator instruction** pending a full design audit
(`design-audit-plan.md`), whose findings merge into this plan before building
resumes. See that plan's Decision 2 for which Phase 1 items may proceed.

Turns `phase-d-remediation.md` into build phases. Every Phase D idea is in here;
the order and sizes differ where re-reading the code on 2026-09-13 changed them.
Those changes are listed first so they are not buried.

**Rule for every phase:** build, type-check, render the affected pages before
and after, commit only the phase's own files, update this doc's status line,
**stop for sign-off**. No Render deploy without asking. Never `git add docs/`.

---

## What re-checking the code changed

| Phase D said | the code says | effect on the plan |
|---|---|---|
| **B1b** — CFB odds job "never goes hot on a live **Saturday** slate" | 2026-09-13 was a **Sunday**. The Python loader asks ESPN for a date *range*, so "146 games today" is really the week. No CFB kickoff within 6h on a Sunday evening means **cold is the correct answer**. | B1b may not be a bug. Re-check on **Saturday 2026-09-19** before touching `gameday.py`. |
| **C4** — live tabs are "small ×5" | The player-page live card (`PlayerDetail.tsx:1602+`) is built from MLB's shape: count, bases, batter, pitcher. The five other live tabs are **game** views, not player views. NBA, NHL and football feeds carry per-player box stats; **soccer and tennis feeds do not.** | Medium, with one design step. Its own phase. |
| **B6** — `seasonStatus` is "populated and unread" | `TeamDetail.tsx:353` does read it, but only in the empty-state message, never the header. The header bug has **a second cause**: `TeamDetail.tsx:314` appends ` in division` to a phrase each adapter already words its own way. NBA produces `"0th seed, Eastern Conference in division"`, soccer `"3rd, 45 pts in division"`, NHL `"Eastern in division"`. | Still small, but it touches all six team adapters plus the component. |
| **C10** — "NFL" British spelling | The strings live in **three** adapters: `nfl/…/playerDetailAdapter.ts:427`, `cfb/…:201-202`, `nba/…:242`. | Trivial; fix all three. |
| **C9** — NFL "biggest edge" | The card is `MatchupExplorerCard.tsx:298`, **shared by every sport**. The argmax has no floor anywhere. | One fix covers all sports, and so does its threshold decision. |
| **C8** — soccer default market | PlayerDetail opens on `candidates[0]` (`PlayerDetail.tsx:950`). Soccer's market table lists `anytime-goalscorer` first, for every position. | Fix is candidate order in the soccer adapter, not the component. |
| **B5** — NFL dead link | `/api/nfl/game/[gameId]` looks the id up in `fetchScoreboard('football','nfl')`'s default date window. The strip keeps games that window has dropped. | Small. Tennis's detail fetcher already uses a wider window. |
| **Group 1** — "one read module" | `game_result` is keyed by **raw team names** (`home_team_raw`); `home_team_id` is **nullable**; the unique key includes `source`, so one game can exist once per source. Only a `(sport, game_date)` index exists. | Team-id coverage and cross-source duplicates must be measured before any design. |

### Findings Phase D did not carry forward

These came out of Phases A and B but have no Phase D group. **Decision 5** asks
whether they join this plan:

- **Phase A Gap 1:** player pages read one season of `player_game_history`, and
  the table only holds 2–4 seasons. Group 1 covers team and game history only.
- **B3:** every non-MLB games strip is a 5-field stub, with start time named
  `firstPitch` in NFL, CFB, soccer and tennis.
- **B4:** NBA and NHL team payloads carry no team stats at all.
- **B8:** thin CFB game detail; NFL player id-mapping warnings still firing.

---

## Decisions — all taken as recommended, operator 2026-09-13

| # | decision | needed by | decided |
|---|---|---|---|
| 1 | Percentile below which the matchup card says "no clear edge" instead of naming one | Phase 5 | **70th.** Keeps real edges and suppresses anything near the league middle. |
| 2 | Default market for each soccer position | Phase 5 | GK → saves · DEF → tackles (else shots) · MID → shots on target · FWD → anytime goalscorer. Falls back to today's order if that market has no line. |
| 3 | Soccer and tennis live card on the player page: score and state only, or leave them out until their feeds carry player stats | Phase 4 | **Score and state only.** Honest, and the component already exists. |
| 4 | Sub-order of Phases 1–6 | now | As written below |
| 5 | Add Gap 1, B3, B4 and B8 to this plan, or record them as a follow-up | now | **B3 → Phase 6** (it is the literal "MLB grid" complaint). **Gap 1 → Phase 7's design.** B4 and B8 → follow-up list. |

---

## Phase 0 — Safekeeping and baseline ◆ tiny

The whole audit exists only as untracked files.

1. Commit `docs/card-audit-plan-2026-09-13.md` and `docs/audit-2026-09-13/*`
   by explicit path.
2. **Leave `docs/CURRENT.md` alone.** Its uncommitted change is the Phase 7 NBA
   session's handoff. This plan and `RESUME-PROMPT.md` are this thread's baton.
3. Confirm no model fit is holding pooler connections before any DB query.
4. Record "before" screenshots of every page this plan touches, to
   `docs/audit-2026-09-13/before/`: WTA and ATP slates, NBA/soccer/CFB team
   headers, NFL player matchup card, the soccer right-back page, the NFL games
   strip.

**Done when:** committed, screenshots saved.

## Phase 1 — Correctness quick wins ◆ small

Four located bugs with known causes and no design decisions.

**1a. WTA page shows men's matches (B2)**
- `lib/sports/multiSport/espnTennis.ts`: declare `grouping.slug` on the response
  type. In `fetchTennisMatches`, skip any grouping whose slug isn't
  `womens-singles` (WTA) or `mens-singles` (ATP). Mirror `schedule.ts:278-279`.
- Leave `fetchTennisMatchDetail` alone. It looks a match up by id, so mixed
  groups can't mislead it.
- Verify: `/api/tennis/wta` lists no men; `/api/tennis/atp` lists no women.
  Game `182770`'s four history arrays are no longer empty. Render both slates.

**1b. Team header wording (B6)**
- The adapter owns the whole phrase. `TeamDetail.tsx:314` stops appending
  ` in division`.
- Each of the six team adapters returns a correct phrase (`2nd in AL East`,
  `3rd seed · East`, `3rd · 45 pts`, …) and returns `''` when the rank is `0` or
  missing. That kills `0th seed`.
- When the season hasn't started, the header shows `seasonStatus.label` in
  place of `0-0`. Following the adapter rule, the label reaches the header
  through `TeamDetailData`, not by the component reading `snapshot`.
- **Added by the Phase 0 baseline** (`before/README.md`): MLB passes a bare
  `"4"` with no ordinal or division name. NHL shows **last season's** record
  with no label and passes the conference as a division. **Soccer's record
  drops draws** (`0-1 · 15th, 3 pts`), so soccer needs W-D-L, which means
  `record` gains an optional `draws`, rendered when present. NBA and NHL show
  different seasons during the same offseason; the header must say which one.
- Verify: render one team page per sport. NBA and NHL are offseason, which is
  exactly the state this fix is for.

**1c. Spelling (C10)** — `defence` → `defense` in the three user-facing
strings listed above. Comments stay as they are.

**1d. NFL dead link (B5)**
- **Confirmed in Phase 0:** `fetchScoreboard` defaults to `daysBack = 0`
  (`teamSportEspn.ts:85`), so every game dated before today UTC 404s. Give the
  NFL game route a real back-window. `fetchTennisMatchDetail` already uses 21
  days back. The strip no longer shows the original id, so verify against it
  directly.
- Check whether the CFB game route has the same shape; fix the same way if so.
- Verify: `/api/nfl/game/401872657` resolves, or the strip no longer lists it.

**Done when:** `tsc --noEmit` clean, before/after renders captured, committed.
**Stop.**

## Phase 2 — Unblock CFB ◆ small–medium, partly calendar-gated

CFB player pages are blank while the sport is playing.

**2a. Stale snapshot content (B1a) — investigate now, time-boxed**
- `app/api/cfb/route.ts` → `buildCfbSnapshot` (`lib/sports/cfb/adapter.ts:271`)
  → `loadGameContextsForSport('cfb')` (`lib/odds/props/multiSportGameContext.ts`).
- Find why a rebuild on Sep 13 lists Sep 3/4 games. Suspects, in order: a cache
  inside `loadGameContextsForSport` or the odds-context snapshot it writes; the
  ESPN date-range parameter; a stale `snapshot_cache` read of a different key.
- **Time box: one session.** If it hasn't been found by then, write down what
  was ruled out and stop.

**2b. Is the odds job's tier logic wrong? (B1b) — Saturday 2026-09-19**
- During a live Saturday window, read `refreshCfbJob`'s run log. Is the tier
  hot? Did requests fire? Do `prop_odds` rows exist for that day's game ids?
- Only if it is still cold with kickoffs inside 6h: fix `gameday.py` or the CFB
  loader. **Python change → asks before the Render deploy.**
- `provider_matrix.py` records that Propline is absent from CFB on purpose.
  The CFB provider-coverage item parked in `docs/CURRENT.md` stays parked. Not
  in scope.

**2c. Score CFB's cards (the Phase C verdicts CFB couldn't get)** — once pages
render, run CFB through the five verdicts and append a CFB section to
`phase-c-card-verdicts.md`.

**Done when:** CFB player pages render candidates on a live slate, and the CFB
verdicts are written. **Stop.**

## Phase 3 — Tennis court surface (C7) ◆ small–medium

- Carry the event onto the synthetic candidate. `buildSyntheticPlayerCandidates`
  (`lib/sports/tennis/adapter.ts:128`) takes `(subjectId, subjectName, tour)`.
  Give it the player's current or next event, and set `subjectMeta.surface`
  from it.
- Source today's surface from the schedule/draw path that already knows the
  event (`lib/sports/tennis/schedule.ts`). Check what ESPN exposes before
  reaching for the historical `game_result` column.
- Build the "conditions" role in `tennis/…/playerDetailAdapter.ts:167` from that
  field, and delete the NOT-BUILT comment in the same change.
- **Never** stand in the last match's surface for today's. The comment already
  explains why.
- Verify: a player in an active clay or hard event shows today's surface, and
  a player with no current event shows no conditions card at all.

**Done when:** rendered on ATP and WTA. **Stop.**

## Phase 4 — Live card on every in-season player page (C4) ◆ medium

**4a. Design (written in this doc, approved before code)**
- Replace MLB-only `LiveGameSlotData` with a sport-neutral slot, in two parts:
  - **game state:** score, period or inning, clock, final/in-progress. Every
    sport has this.
  - **your lines so far:** the subject's live stat for each tracked market.
    MLB already does this via `liveMarketValues`. NBA (`boxByTeam`), NHL
    (`skatersByTeam`/`goaliesByTeam`) and football (`FootballPlayerLine`) can do
    it; soccer and tennis cannot (Decision 3).
- Keep the MLB-specific panels (count, bases, batter, pitcher) as a named
  presence-checked field, the way §4 allows for a real difference.
- Per §5, the adapter exposes plain data. Any per-sport JSX closure is built in
  the component.
- Per §3, the five live hooks already accept `enabled`, so they run
  unconditionally at the top of `PlayerDetail`, enabled only for the matching
  sport with a game in progress. Confirm each candidate carries a game id
  (`subjectMeta.gamePk` in CFB; check the others).

**4b. Build** — NBA, NHL, NFL/CFB with "your lines so far"; soccer and tennis
per Decision 3. Fix the stale comment at `PlayerDetail.tsx:1601`.

**4c. Verify** — needs live games. NFL/CFB on a weekend; soccer on a matchday;
tennis during an event. **NBA and NHL cannot be render-verified until October.**
Ship them behind the same code path, mark them unverified here, and re-check in
October with the NBA/NHL re-score.

**Done when:** rendered live for every sport currently playing. **Stop.**

## Phase 5 — Cards that say less and mean it ◆ small

**5a. Matchup "biggest edge" floor (C9)** — `MatchupExplorerCard.tsx:298`.
Below Decision 1's threshold, render "No clear edge against this opponent"
rather than naming the argmax. Check what `pctOf` measures first: a high
percentile has to mean "allows more", or the floor points the wrong way. It is
shared, so render one page per sport.

**5b. Position-aware default market (C8)** — soccer's candidate order follows
Decision 2's map, using `subjectMeta.position`. The baseline showed the
right-back's default is a **real priced line** (Propline), so the ordering
applies to both the snapshot's priced candidates and the synthetic fallback. Verify on the right-back page
(`espn:soccer:122268`) plus one GK, one MID and one FWD.

**Done when:** rendered, committed. **Stop.**

## Phase 6 — Collapse port-artifact fields ◆ small–medium, mechanical

After Phases 3–5, so the field set has settled and nothing is renamed twice.

- **C1:** `hitterStats` + `nflSeasonStats` → one neutral `seasonStats`.
  44 references across 10 files (8 player adapters, `playerRoles.ts`,
  `PlayerDetail.tsx`).
- **C2:** make `liveMatchup`, `roundScores`, `seasonStatsCard`, `golfFormHoles`
  optional on `PlayerDetailData`. Delete the 28 explicit `null` lines.
- **C6:** MLB's game hero leaves `pregameLines` undefined, and `GameDetail.tsx:2276`
  treats undefined as "this sport doesn't show hero lines". **Check first**
  whether that's deliberate, since MLB's full `gameLine` board already renders
  elsewhere. Close it as *fits* if so.
- **B3 (if Decision 5 agrees):** `firstPitch` → `startTime` in the games strip
  wire shape, every sport, TS-only.
- **Docs, same commit:** replace `CLAUDE.md` §4's examples with C1 as the new
  worked example. Correct `seasonAggregates.ts`'s "2.75M rows" claim (~0.77M).
- Verify: `tsc --noEmit`, then render one player page per sport. A rename that
  type-checks can still drop a card if a spread hid the field.

**Done when:** committed. **Stop.**

## Phase 7 — Deep history on team and game pages (Group 1) ◆ large, design first

**7a. Measure (read-only DB, small result sets)**
- `home_team_id`/`away_team_id` fill rate per sport and per decade. Raw names
  from old sources ("St. Louis Rams") may not resolve to today's ids.
- Duplicate games across `source` values per sport.
- Rows per team per sport, to size egress per page view.
- What `team_elo_history` (already rendered via `/api/team-rating-history`)
  already gives pages, so the new path doesn't duplicate it.

**7b. Design doc → approval**
- Read module: one function per question the pages ask. All-time and
  last-N-seasons record; head-to-head history for a game's two teams; home/away
  and venue splits.
- Team identity: map `raw` names to page team ids through the existing entity
  resolution, not a new alias table.
- Index: team-scoped reads need `(sport, home_team_id)`/`(sport, away_team_id)`
  indexes. That's a migration on a Python-owned table, so record it in
  `docs/table-ownership.md`'s reasoning.
- Route: `cachedRoute()`, TTL of a day (results change once per game).
  **Grep `cacheKey` before choosing a key**, and namespace it (for example
  `history:team:route:${sport}:${teamId}`).
- Where it renders: TeamDetail's record/form sections and GameDetail's `h2h`,
  through the adapters, `null` where a sport has none.
- **Gap 1 (if Decision 5 agrees):** decide here whether player pages need
  multi-season `player_game_history` reads. It's the same shape of job on a
  different table.

**7c. Build** in the approved design's own sub-phases, stopping between them.

---

## Deferred — not part of this build

| item | unblocks when |
|---|---|
| Golf card audit | a live tournament |
| NBA/NHL re-score, plus Phase 4 live-card render check | October |
| C3 — fitted models for six sports | its own program (Phase 7 NBA is in progress elsewhere) |
| `docs/table-ownership.md` re-derivation (51 tables vs 36 documented) | its own task; grep both trees per its rule |
| B4 — NBA/NHL team stats; B8 — CFB game detail, NFL id mapping | follow-up list unless Decision 5 says otherwise |

## Measurement traps (from the audit — they apply to verification too)

- A snapshot payload's `fetchedAt` is not the cache write time.
  `snapshot_cache.fetched_at` is.
- A cache can rebuild mid-check. Re-fetch before writing a number down.
- A type-check doesn't prove a card renders. Render it.
- Check the calendar, **including the weekday**, before judging an empty card.
  B1b is this plan's own example.
