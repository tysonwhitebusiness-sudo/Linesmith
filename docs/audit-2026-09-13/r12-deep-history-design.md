# R12 — Deep history on team and game pages: design for approval

**Status: DESIGN ONLY. Nothing is built.** The plan says R12 is "large, design
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
