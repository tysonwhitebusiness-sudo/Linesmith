# Resume prompt — research pages build (2026-09-19: R10, R11, R12 BUILT — awaiting sign-off)

Paste everything below the line into a fresh session on any account.

---

I'm resuming the research-pages build in this repo. Read these first, **before doing anything**:
1. `CLAUDE.md` — the sport-adapter section was rewritten in R11a (the game page
   is `GameResearchPage`; `GameDetail` is deleted) and rule 2 in R11b.
2. `docs/CURRENT.md` — three tracks: model, research pages, and the UI overhaul
   (U0–U8, `docs/design/ui-system-master-prompt.md`, nothing built yet).
3. `docs/audit-2026-09-13/research-pages-master-plan.md` — the R10 and R11
   sections (R11 has its own "DONE" record and findings R11b-F1/F2, R11-F3).
4. `docs/audit-2026-09-13/r12-deep-history-design.md` — R12's measurements, the
   operator's answers, and the records of R12a–R12e at the end.

## Where the work is

**Every research-page phase through R12 is built. All of R10, R11 and R12 are
awaiting the operator's sign-off.** Don't start new work in this track until
they sign off or ask for something; the next track is the UI overhaul, which
runs by its own sequencing rules (its §10).

- **R10 (compare control)** — built 2026-09-17/18: player vs team (`?vs=`),
  player vs peer (`?peer=`), team vs team, sport compare cards, golf against
  the field, Table/Bars/Lines views, collapsible sections, the Players tab
  without a slate. `MatchupExplorerCard` deleted.
- **R11 (port-artifact cleanup)** — `GameDetail` and ~60 files only it used
  deleted, 17 API routes, then 138 unused exports incl. TypeScript writers with
  no callers (five tables are Python-only now; `docs/table-ownership.md`
  preface). C1 `nflSeasonStats`→`seasonStats` then the rail card dropped
  (operator), CFB/NFL kickers got a spec; C2 explicit nulls out.
- **R12 (deep history)** — a: the read (`lib/history/deepHistory.ts`:
  lineage, game type from generated season windows with per-team openers,
  exhibitions, conflict rules, MLB authority) and the MLB StatsAPI backfill
  (37,960 rows, run on the operator's go-ahead); b: the team page's History
  section; c: deep head to head on the game page and in team Compare; d:
  "couldn't load" vs "not found" on every game page (route included); e:
  tennis head to head before 2024 by name, verified by dates.
- Last commits: `443484c` (R12e + R12d route fix), `62b886f` (R12d),
  `caf381f` (R12c), `0e89ecf` (R12b), `a7edd93`/`faccb64` (R12a). Pushed.
- tsc clean, **506/506** tests, `npm run build` passes. Prod runs locally via
  the `linesmith-prod` preview (port 3000); rebuild after changes.

## Waiting on the operator

1. **Sign-off** on R10, R11, R12.
2. **Worker redeploy (they said they'd do it by hand).** Then do **B3 step 2**:
   rename the TS snapshot field `firstPitch` → `startTime` (every sport's
   adapter, `SlateGame` in `lib/odds/matching.ts`, `GamesStrip`,
   `DateGameStrip`, `PlayerDetail`, `PlayerDetailPanel`). Python already reads
   `startTime` first (`python-odds-service/src/game_context.py`); renaming TS
   before the deploy would blank MLB game dates in the worker. The deploy also
   ships `db.upsert_game_results` (same behaviour).
3. **R12e-F1 (model track, routed):** `import_tennis.py` drops retirements with
   the sets level because `game_result` can't store a winner for a level score
   (e.g. Djokovic v Medvedev, Astana 2022 SF). A winner column would fix it;
   it touches a Python-owned table and every `home_score > away_score` reader.

## Still owed — renders no slate allowed yet

- Football and soccer live states on the game page (R8.2 / R8.3a), and each
  group's sign-off.
- NBA and NHL live (game page and player page) — October.
- Golf's prop block and live view — next tournament (a Round 2 live matchup
  rendered on 2026-09-18, so it may be closer).

## What R12 built (read before touching history)

| piece | file |
|---|---|
| the one read of `game_result` (R2 merge + R12a rules) | `lib/history/gameResults.ts` (`readGameResults`, `dedupeGameResults`) |
| lineage, game type, exhibitions, conflicts, MLB authority (pure, tested) | `lib/history/deepHistory.ts`, `tests/deep-history.test.ts` |
| season windows, GENERATED — re-run each new season | `scripts/build-season-windows.ts` → `lib/history/seasonWindows.ts` |
| season-by-season record, head to head (pure) | `lib/history/teamHistoryShapes.ts` |
| team page History section | `lib/history/teamHistorySection.ts`, `components/useTeamHistory.ts` |
| deep head to head cards | `lib/history/headToHeadCards.ts`, `components/useHeadToHead.ts` |
| the route | `/api/history/results` — `view=history`, `vs=` (keys `history:team:route:v2:`, `history:h2h:route:v2:`) |
| tennis before 2024 | `lib/sports/tennis/deepHeadToHead.ts` (in the game-research payload; key `game-research:route:v10:`) |
| strict upstream reads | `fetchEspnSummaryStrict` (`lib/sports/espn/summary.ts`); the game-research route asks the reader when the state lookup is empty |
| MLB backfill (Python) | `python-odds-service/backfill_mlb_statsapi_results.py` (dry run by default) |
| verification | `scripts/measure-deep-history.ts` (games per team per season), `scripts/verify-deep-history.ts` (Eagles v nflverse: 0 mismatches) |

## Lessons from R10–R12

- **Verify renders in a FRESH browser-pane tab** (`tabs_create`). Worn tabs stop
  running effects; a "nothing loads" finding (R10-F4) was that, not the app.
  Close tabs as you go: the pane caps the tab count.
- **The browser pane can't screenshot while hidden** — measure layout with
  `javascript_tool` (widths, overflow at 400 px via `resize_window`) instead.
- **Diff against the source of truth, not against our own rows.** R12's
  "conflicts" were mostly real doubleheaders and UTC-dated neighbours; the real
  MLB problem (missing games, spring training) only showed by comparing each
  season with StatsAPI.
- **A fix can expose the fault it was hiding.** R12d's route change surfaced
  MLB's placeholder feed for an unknown game (pk 0 with a `teams` object).
  Test the whole request path, not only the function you changed.
- **Bump a route's cache key version when its payload's shape or rules change**
  (history v2, game-research v10) — a day-TTL cache otherwise serves the old
  answer.
- **`npm run build` type-checks tests too**; run it, not just `tsc` filtered.
- **Section ids change with game state** (`matchup` → `pre-matchup` after the
  start): find a card by its own key, not by its section.
- Python heredocs mangle backslashes and turn CRLF files into LF; for regexes
  in TS, use the Edit tool. (Git normalises the line endings on commit.)

## How every phase runs (plan §2)

1. Re-check every cited file and line first; measure before building.
2. Build. 3. `tsc --noEmit`, `npm test`, `npm run build`.
4. Render each affected sport on prod (fresh tabs); referee numbers against an
   independent source.
5. Delete what the phase replaces, in the same phase.
6. Commit by explicit path. 7. Update the plan/design record and this file.
8. **Stop for sign-off.**

## Decisions already made — don't reopen

- **Pages are research pages.** Odds are one section, **except the prop analysis
  block** (market tabs, line stepper with price, chips, hit-rate tiles, bars vs
  line) — presentation fixes only.
- **R12 (2026-09-19):** relocations count toward the franchise that moved
  (Thrashers→Jets, SuperSonics→Thunder; Utah HC→Utah; Arizona stays Arizona);
  last 10 seasons by default, the rest one switch away; merge sources with a
  conflict rule; tennis deep head to head built.
- **No dormant fallbacks:** delete old code outright once replaced.
- Real data only; show a status where data is missing; say a source's limits on
  the page (NHL records don't mark overtime; tennis archive is tour-level only).

## Standing constraints

- **Database:** the pooler caps at 15 connections. Check for running fits,
  harvester cycles and other sessions before DB-heavy scripts; load pages one
  batch at a time.
- **Writes to production data or deploys need the operator's go-ahead**
  (the MLB backfill was asked for and approved). Reads and measurement are fine.
- **Git:** never `git add -A` or `git add docs/` (`docs/discord-community-prompt.md`
  is the operator's); add explicit paths. Commit and push at hand-off.
- **Another session may be working the UI overhaul** — check `git log` and
  `git status` first; keep other sessions' uncommitted edits.
- **Bugs found mid-phase:** fix app-breaking ones on the spot (own commit);
  route the rest into the receiving phase plus a findings row.
- At ~92% context, stop and hand off: rewrite this file and the research track
  in `docs/CURRENT.md` (leave the other tracks' sections alone), commit, push.
