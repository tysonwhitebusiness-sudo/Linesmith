# R12 — Deep history on team and game pages: design for approval

**Status: APPROVED 2026-09-19, with the operator's answers (below). R12a in
progress.** Original status line: DESIGN ONLY. Nothing is built. The plan says R12 is "large, design
first": measure, write this, get the operator's approval, then build in
sub-phases with a stop between each. Measured 2026-09-18 against the live
database (read-only queries). Every number below is from that run.

## What R12 is for

The rebuilt pages look back one season. The game page's head to head is
"since last season" (ESPN team schedules, R7-C1). The team page's results
cover the current season. `game_result` holds **185,327 games going back to
1999 (NFL), 2007 (NBA, NHL), 2010 (MLB), 2012 (MLS), 2013 (CFB) and 2015 (EPL,
tennis)**, and the pages read none of it older than 2023. R12 lets them.

G2 has no mockup for this: its head to head stops at "since 2023"
(`game-states.js:91`). So the shape below is a proposal, not a port.

## Measurements

### 1. Team identity is almost complete, and the gaps are franchise moves

Both team ids filled, per sport and decade:

| sport | 1990s | 2000s | 2010s | 2020s |
|---|---|---|---|---|
| NFL | 100% | 100% | 100% | 100% |
| MLB | — | — | 100% | 100% |
| NBA | — | 97.4% | 100% | 100% |
| NHL | — | 93.7% | 99.0% | 98.9% |
| CFB | — | — | 100% | 99.9% |
| EPL / MLS | — | — | 100% | 100% |
| tennis ATP / WTA | — | — | 0% | 1.4% / 3.2% |

The unresolved team-sport rows are not spelling problems:

- **Relocations and renames:** Atlanta (Thrashers, 328 NHL games), Seattle
  (SuperSonics, 82 NBA), Utah Hockey Club (85, the 2024-25 name of today's
  Utah Mammoth).
- **Exhibitions:** All-Star teams (Team LeBron, Team McDavid, ...) and
  4 Nations games (USA, Canada, Sweden, Finland) — correctly unresolved; they
  should never count.
- **One real gap:** South Alabama Jaguars (12 CFB games).

Tennis has no ids at all: it is keyed by player name (Sackmann's CSVs).

### 2. Every sport has cross-source duplicates, and R2's merge rule has a hole

`game_result` holds up to four sources per sport. Same game, same day, two
sources (exact date; R2 found more at ±1 day):

| sport | sources | pairs | same score |
|---|---|---|---|
| MLB | mlb_long_csv + sbr_mlb | 2,377 | 2,320 |
| MLB | espn_core + mlb_long_csv | 1,583 | 1,158 |
| CFB | cfbd + espn_core | 948 | 948 |
| MLS | espn_core + footballdata | 604 | 604 |
| EPL | espn_core + footballdata | 400 | 400 |
| NFL | espn_core + nflverse | 225 | 225 |
| NBA | espn_core + sbr | 142 | 138 |
| NHL | espn_core + sbr | 122 | 122 |

R2's `dedupeGameResults` merges two rows only when team ids AND both scores
match within a day. That is right for the window R2 reads (since 2023) but
**not for deep history**: where two sources disagree on the score, the game
survives twice. Measured, days with exactly two rows from two sources that
disagree: **MLB 217** (`mlb_long_csv 5-4` against `sbr_mlb 8-5`, 2021-04-21)
and **NBA 4** (`espn_core 106-108` against `sbr 102-82`, 2022-11-05 — two
different games, so one source has the wrong teams). A decade-long head to
head built on the merge rule would double-count those.

Doubleheaders are real and must survive: single-source same-day pairs with
different scores are MLB doubleheaders (sbr_mlb 329, espn_core 291).
`event_start` is only 26% filled in MLB, so a doubleheader cannot be told
apart by time.

### 3. Rows per team, and size

185,327 rows, 66 MB. A franchise's whole MLB history is ~2,600 games; a
full-history head to head between two MLB teams is ~250. Small enough to
read and de-duplicate per request behind a cache.

### 4. Indexes: none on the team columns

`game_result` is indexed on `(sport, game_date)`, `source`, a natural key on
raw names, and a tennis surface lookup. **Nothing on `home_team_id` /
`away_team_id`**, so "every game this team played since 2010" is a scan of
the sport.

### 5. `team_elo_history` is deep only for MLB

MLB: 78,974 rows, 2010-04-05 to today, 30 teams. Every other sport: one
season (2025-26). An Elo-over-time chart is therefore MLB-only, and says so
elsewhere.

### 6. Venue names are sparse; home/away is complete

Venue filled: NFL 99.8%, tennis 100% (the tournament), MLB 36.7%, NHL 26.9%,
NBA 21.2%, MLS 12.4%, EPL 8.7%, CFB 6.5%. Scores 100% everywhere. So
"venue splits" can only be **home and away** for most sports; a
stadium-level split (London, Mexico City, neutral bowls) is NFL-only.

## Proposed design

### D1. One source per sport-season, not a merge (the key decision)

For deep history, choose **one source per (sport, season)** — the most
complete one, by a fixed precedence — and read only its rows. That removes
cross-source conflicts by construction instead of trying to reconcile them,
and keeps doubleheaders (they are two rows in one source). R2's merge rule
stays for the recent window, where the pages already use it and it is
measured correct.

Proposed precedence (to confirm against per-season completeness in R12a):
MLB `mlb_long_csv` > `espn_core` > `sbr_mlb`; NFL `nflverse` > `espn_core`;
CFB `cfbd` > `espn_core`; NBA/NHL `espn_core` > `sbr`; EPL/MLS
`footballdata` > `espn_core`. The seam with the live pages: seasons the page
already reads from the league schedule (current and last) keep that source
(R7-C1); `game_result` supplies everything older. One season never comes
from both.

### D2. Franchise lineage, not raw names

Identity goes through the existing team ids plus a small, explicit lineage
table in code: Utah Hockey Club -> Utah (a rename, same franchise, certain);
Atlanta Thrashers -> Winnipeg Jets and Seattle SuperSonics -> Oklahoma City
Thunder (relocations — **operator decision**, see Q1). Exhibitions (All-Star,
4 Nations) are excluded by rule, not by accident.

### D3. What the pages get

- **Team page — "History" section** (new, below Results): record by season
  (W-L, and W-L-D for soccer; points for/against per game), all seasons held,
  newest first; all-time and last-10-seasons totals; home and away split.
  MLB adds an Elo-over-time line (the only sport with depth).
- **Game page — deep head to head**: the existing "Head to head" card keeps
  its recent rows and gains an all-time line ("PHI 31-24 against DAL since
  1999, 14-11 at home") plus a toggle to show every meeting. Home/away split
  of the meetings.
- **Compare (team vs team, R10.3)**: the same all-time head to head beside
  the strength comparison.
- **Not proposed:** stadium-level venue splits (NFL-only data), tennis deep
  head to head in this phase (see D5).

### D4. Read path

- Reuse `lib/history/gameResults.ts`, extended with the D1 source-per-season
  read and D2 lineage. `/api/history/results` (pattern 1, `cachedRoute`) has
  **no page caller today** — R11's route scan found it unreferenced — and
  becomes the history read, with a `vs` parameter for head to head and a
  day TTL (finished seasons never change; the current one is not read from
  here).
- **Migration** (Python-owned table, Python writes it via `db.py`):
  `(sport, home_team_id, game_date)` and `(sport, away_team_id, game_date)`
  indexes. An index adds no writer, so ownership is unchanged; the
  `table-ownership.md` note records it.

### D5. Tennis, deferred

Tennis `game_result` has no ids, and names are "Zverev A." style. A deep
tennis head to head needs name normalisation against `athlete_crosswalk`;
the player page already shows three seasons of meetings from TennisMyLife.
Proposed as a later, separate sub-phase if wanted (Q3).

## Sub-phases (stop between each)

- **R12a — read and index.** The migration, D1 source-per-season with the
  precedence measured per season, D2 lineage, `/api/history/results` gains
  `vs`. Verify: a franchise's all-time record against a published one
  (e.g. an NFL team since 1999 against Pro-Football-Reference), zero
  double-counted conflict days, doubleheaders kept.
- **R12b — team page History section.** Render per sport at 1440 and 400.
- **R12c — deep head to head** on the game page and in team compare.
- **R12d — "couldn't load" vs "not found" for every game reader** (R11-F3:
  fixed for NHL; NBA, football, soccer, tennis and MLB share it). Small,
  folded in here because R12c touches the same readers.
- **R12e (optional) — tennis deep head to head** (D5), only if Q3 says yes.

## Questions for the operator

1. **Relocated franchises:** does the Winnipeg Jets' history include the
   Atlanta Thrashers, and OKC's the Seattle SuperSonics? (Both leagues'
   official records say yes. The alternative is to start each at its move.)
2. **Depth shown by default:** all seasons held (back to 1999 for NFL), or
   the last 10, with the rest one click away?
3. **Tennis:** build R12e now, or leave tennis at the player page's three
   seasons?
4. **Precedence (D1):** approve "one source per sport-season" over merging,
   accepting that a season's record is exactly as good as its chosen source.

## Operator's answers (2026-09-19)

1. **Relocations count:** Thrashers -> Jets, SuperSonics -> Thunder.
2. **Depth:** last 10 seasons by default, the rest one click away.
3. **Tennis:** build R12e.
4. **Sources:** merge them, with a conflict rule (not one source per season).

## R12a Step 0 — measured 2026-09-19, and it changed the conflict rule

`scripts/measure-deep-history.ts` counts games per team per season through
R2's read; then each sport was diffed game by game against the league's own
schedule (MLB StatsAPI, ESPN team schedules, NHL api-web).

**Every sport but MLB is exact.** One team-season per sport per era, regular
season and playoffs: NBA (DEN 2012, 2019), NFL (21: 2005, 2018), CFB (ALA 2015,
2022), EPL (ARS 2016, 2021), MLS (LA 2014, 2019) and NHL (COL 2010, 2018) all
match game for game; one MLS score differs. R2's merge is right for them.

**The "conflicts" were mostly not conflicts.** Of four MLB same-day
disagreements checked against StatsAPI, three are real doubleheaders (2021's
seven-inning ones) where each source held one game; one is a wrong score
(`sbr_mlb` 5-3 for an official 6-3). The 2025 "conflicts" are ESPN's UTC dating
putting a West Coast night game on the next day beside that day's game — two
real games. The NBA ones are `sbr` errors (ESPN matches the official score in
both checked), yet R2 ranks `sbr` above `espn_core`.

**MLB's real problems are completeness and preseason:**

| season | official | held | missing (all regular season) | extra |
|---|---|---|---|---|
| 2010-2021 | ~2,465 | ~2,440 | 19-33 a season | 0-7 |
| 2022 | 2,470 | 2,369 | 101 | 0 |
| 2023 | 2,471 | 2,412 | 59 | 0 |
| 2024 | 2,472 | 2,413 | 59 | 0 |
| 2025 | 2,477 | 2,528 | 18 | 69 (67 spring training) |

The Yankees' 2025 has all 169 official games; the extras are five
spring-training games from `espn_core` (one a 3-3 tie).

**So the conflict rule is:**

- **Game type from league-season windows.** Preseason dropped; postseason
  marked. Windows are generated once into a checked-in file from ESPN's
  `seasons/{y}/types` (every league, back to 2007 measured) and MLB's own
  season dates (ESPN's 2025 window starts after the Tokyo Series). Finished
  seasons never change, so it costs nothing at request time.
- **MLB: an authoritative source per season.** A Python backfill writes
  StatsAPI's finals into `game_result` (`source = 'mlb_statsapi'`); where a
  season has them, they are the season, and the other sources' rows for it
  are dropped. This fixes the missing games and any wrong score at once.
  **The backfill writes to the production table and waits for the operator's
  go-ahead.**
- **Sports with no doubleheaders (NBA, NHL):** two sources disagreeing on the
  same pair on the same date is one game with a wrong score; keep ESPN's.
  (Same DATE, not ±1 day: the NBA plays two-game series on consecutive days.)
- **Everything else:** R2's merge, unchanged.

**Lineage, measured ids:** NHL raw "Atlanta" (164 home games, 2007-11) ->
Winnipeg 52; NBA raw "Seattle" (41, 2007-08) -> Oklahoma City 25; NHL "Utah
Hockey Club" (unresolved) and id 59 -> 68, the id the app uses for Utah
(`game_result` stores today's Mammoth as 59, so without this Utah's page finds
no history). Arizona (53) is NOT Utah: the NHL treats Utah as a new franchise
and the Coyotes' record stays Arizona's.

## R12a — DONE 2026-09-19, awaiting sign-off

Built: `lib/history/deepHistory.ts` (lineage, game type with per-team openers,
exhibitions, the NBA/NHL conflict rule, MLB authority), the generated
`lib/history/seasonWindows.ts`, `lib/history/teamHistoryShapes.ts`, the route's
`view=history` and `vs=` views, the team-id indexes (applied), and the MLB
StatsAPI backfill — **run on the operator's go-ahead: 37,960 rows.**

Two merge bugs surfaced by the backfill and fixed: `mlb_statsapi` must outrank
every source in R2's merge (ranked below `mlb_long_csv` it lost the merge and
the authority rule then dropped the survivor — whole seasons read as 3 games),
and two rows from ONE source are two games (the ±1-day window merged
back-to-back same-score games of a series: MLB 2010 read 2,442 of 2,462).

**Verified:**
- MLB, every season 2010-2025, reads exactly StatsAPI's official finals
  (2010: 2,462; 2025: 2,477); every team at 162 except real rainouts (161)
  and 2020's shortened schedule.
- NFL refereed against nflverse: Eagles 1999-2025, 28 seasons, regular season
  and playoffs, 0 mismatches; PHI v DAL 29-26-0 both ways
  (`scripts/verify-deep-history.ts`).
- EPL exactly 380 games, 38 a team, every season; NBA/NHL at 82 plus playoffs.
- Lineage: Winnipeg's history opens with the Thrashers (2007-08 34-48), OKC's
  with Seattle (2007-08 20-62), Utah's 2024-25 is the Hockey Club's 82 games,
  Arizona stays Arizona.

**Known limits, to say on the page (R12b):** NHL records are W-L — overtime
and shootout losses count as losses, because `game_result` does not mark
overtime (the Thrashers' 2007-08 reads 34-48, officially 34-40-8). One NHL
2020-21 team reads 55 of 56 games.

## R12b — DONE 2026-09-19, awaiting sign-off

**The team page's History section**, placed after Results & schedule, on
every team sport (MLB, NFL, CFB, NBA, NHL, EPL, MLS): a note with the all-time
and last-10 records and the postseason record; win % by season as a line
(points per game for soccer, which ranks on points); a season-by-season table
— W-L (W-D-L and points for soccer), home, away, scored/allowed/diff per game,
postseason — opening on the last 10 with an "All N" switch. Completed seasons
only: the current one is the page's own sections' job (R7-C1), and
`game_result` lags on it. It does not follow the page's season switch and says
so. The NHL note says overtime/shootout losses count as losses.

Built from the shared card renderer (table views, series) — no new UI and no
sport branch in the page: `lib/history/teamHistorySection.ts` (pure, tested),
`components/useTeamHistory.ts`, and three lines in `TeamResearchPage.tsx`.

**Found in the render and fixed:**
- MLS playoff games read as regular season (soccer had no windows). Added
  MLS windows from ESPN's usa.1 type 1 — with the start set to 1 January,
  because ESPN's 2024 regular season begins 03-04 while the season opened
  02-21 (the Galaxy read 32 of 34 games). Every MLS team now reads its full
  34 plus playoffs, every season.
- The EPL showed a Postseason column of dashes; the column now appears only
  where a season had postseason games. "Playoffs" became "Postseason" (CFB's
  are bowls).
- The route's cache keys went to `v2` so no summary built under the old rules
  is served for a day.

**Verified on prod** (fresh tabs; the pane was hidden, so layout was checked
by measurement, not screenshot): PHI 27 completed seasons 258-177-2, 2024-25
14-3 with 4-0 postseason, "All 27" switches to 27 rows back to 1999-00 (5-11),
no page overflow at 400 px, chart 342x220 at 400 px; NYY 2024 and 2025 94-68;
WPG opens with the Thrashers' 2007-08; OKC with Seattle's 2007-08; UTA two
seasons; ALA 146-16 with 12-8 in bowls; ARS W-D-L and points, no postseason
column; LA Galaxy 2024 19-7-8, 64 points, postseason 5-0 (the official
record). 493/493 tests.

## R12c — DONE 2026-09-19, awaiting sign-off

**Deep head to head, on the game page and in team Compare.**

- **Game page:** the matchup's "Head to head" card keeps its own list (this
  season and last, from the league schedule) and gains every earlier meeting
  from the archive behind an "All N meetings" switch, with the all-time
  record, the home split before last season, and the recent record in its
  line. **No game is counted twice:** the archive adds only meetings before
  the start of last season (the seam), so the two lists never overlap and the
  lagging current season is never read from the archive. Archive rows are not
  linked (no game page id) and a postseason meeting is marked.
- **Team Compare:** "Head to head, all time" below the comparison — the
  record from this team's side, home and away, postseason, last 10 meetings
  with an "All N" switch.
- Built as pure functions over the shared table card
  (`lib/history/headToHeadCards.ts`, tested), one hook (`useHeadToHead`), a
  few lines in each page; no sport branch.

**Found in the render and fixed:** once a game has started its matchup
section is re-keyed `pre-matchup` ("Matchup · at the start"); the first cut
matched the section id `matchup` and missed every final. The card is now
found by its own key, `h2h`, which only the shared matchup builder uses (tennis
has one too, but the hook never runs for tennis).

**Verified on prod, fresh tabs:** PHI at DAL 2025-11-23 — "PHI 29-25 against
DAL since 1999", 54 meetings; Compare PHI v DAL — 29-26 over 55, 16-11 home,
13-15 away, postseason 0-1 (the 55th is that game itself: consistent). COL v
CGY 39-37 over 76 since 2007; CIN v LAD 40-60 over 100 since 2010. 497/497
tests.

## R12d — DONE 2026-09-19 (R11-F3 closed)

Every game reader now tells "no such game" from "the source did not answer";
before, a slow or failed upstream read as "This game was not found".

- **NBA, NFL/CFB, EPL/MLS:** one shared `fetchEspnSummaryStrict` (the plain
  fetch keeps its null for every other caller): on a null it probes once;
  ESPN's own 404 is "not found" (measured: a bogus event is 404 on all
  three), an answer is used, anything else throws.
- **MLB:** StatsAPI answers 200 even for a game that does not exist, so a
  null feed is always a failed request and now throws; an answer with no game
  in it stays "not found".
- **Tennis:** the match search walks several days of scoreboards; if not one
  answered it throws and caches nothing (the route's state lookup still reads
  that as "state unknown", not an error).
- **NHL** was fixed in R11 (`4030e75`).

Tested with a mocked fetch (404, timeout then failed probe, failure then
recovery, MLB's empty 200). Checked on prod: real games for all seven game
sports return 200; bogus ids for NFL, NBA, EPL, MLB and NHL still return 404.
502/502 tests.

**R12d, amended the same day:** checking it end to end found the ROUTE still
answered a failed state lookup with 404 before the strict reader ran (the state
lookups use lenient fetches) — so an ESPN outage still read "not found". The
route now asks the strict reader when the state is empty: null is the source's
own 404, a throw is 502, a payload supplies its own state. That exposed a
second fault the old route had hidden: StatsAPI answers an unknown game with a
placeholder (pk 0, team ids 0, status "Unknown") that carries a `teams` object,
which the MLB reader accepted; the test is now the non-zero pk. A route-level
test calls the real handler with fetch mocked (outage 502, ESPN 404 stays 404).
On prod: real games 200 and bogus ids 404 for NFL, CFB, NBA, EPL, MLB, NHL;
tennis 200.

## R12e — DONE 2026-09-19, awaiting sign-off

**Tennis head to head before 2024, on the match page.** The page's own list
reads `player_game_history` by ESPN id from January 2024; `game_result`'s
`tennis_data` rows go back to 2015 by NAME only ("Zverev A.", "Lee C.Y.",
"Pliskova Kr." — the source's own disambiguation). `lib/sports/tennis/
deepHeadToHead.ts` matches a raw name to the player's full name (every
surname/given split, either order) and **trusts it only once the dates agree:
at least 80% of that name's rows since 2024 must fall within three days of the
player's own matches** — the crosswalk's "name and game date" test; an
unverified player gets no deep history and the caption says why. Only rows
before 2024-01-01 are read, so no meeting is counted twice. The card gains an
"All N meetings" switch; archive rows carry tournament and round, sets but not
games, and are not linked. Game-research cache key to v10 (the payload gained
the field).

**Refereed against TennisMyLife (independent, 2015-2023, tour-level):**
Zverev v Medvedev 7-10 over 17, Tsitsipas v Zverev 8-4 over 12, Sabalenka v
Swiatek 3-6 over 9 — all exact. Djokovic v Medvedev reads 7-5 over 12 against
8-5 over 13: the missing match is Astana 2022 SF, a retirement at one set all,
which `import_tennis.py` drops on purpose (a level score cannot say who won).

**Limits, stated in the card's caption:** tour-level only — `tennis_data` has
no Davis Cup or ATP/United Cup (Djokovic v Medvedev's 2017 Davis Cup and 2020
ATP Cup meetings); retirements with the sets level are not held.

**Finding R12e-F1 (model track, not fixed here):** `import_tennis.py` drops
retirements with the sets level (269 first-set retirements and others) because
`game_result` cannot store the winner of a level score. A winner column would
recover them; it touches the Python-owned table and every consumer's
`home_score > away_score` reading, so it is routed, not patched.

**Verified on prod, fresh tabs:** ATP 164479 (Zverev v Medvedev, Paris 2025) —
"Zverev 7-13 against Medvedev since 2016 · 0-3 since 2024", 20 meetings, the
seam between Jan 2024 (linked, games) and Nov 2023 (archive, tournament and
round); WTA 157236 (Swiatek v Sabalenka, Roland-Garros 2025) — "Swiatek 8-4
since 2021 · 2-1 since 2024", 12 meetings. 506/506 tests.

## R12 — ALL SUB-PHASES BUILT (a-e), awaiting the operator's sign-off
