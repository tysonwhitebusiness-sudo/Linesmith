# Historical player-gamelog pull — build the data-rich table for player props across all sports

**Mission**: populate `player_game_history` (already built, already live) with real per-player,
per-game stat lines across 6 sports and the year ranges below — the multi-season, multi-team depth
`predict/generic_prop_score.py`'s `compute_league_rate` currently lacks (it's running on one
team's current-season roster today, a real, disclosed thin-sample limitation). This is a genuinely
multi-hour, unattended run — most of this doc is about doing it *safely*: resumable after a crash,
checkable without babysitting it, and never re-paying for work already done.

Read this whole doc before writing code. Sections are ordered so each one only depends on what
came before it.

## 1. Real, decided scope — do not re-derive this

This table was already worked out and approved by the user. Use it as-is; don't re-litigate the
year ranges.

| Sport | Range | Teams | Games/szn | Players/game | Seasons | Est. rows | Est. size |
|---|---|---|---|---|---|---|---|
| NBA | 2015–26 | 30 | 82 | ~13 | 11 | ~298K | ~60MB |
| NHL | 2010–26 | ~31 | 82 | ~18 | 16 | ~732K | ~146MB |
| NFL | 2012–26 | 32 | ~16.5 | ~10 | 14 | ~74K | ~15MB |
| CFB | 2018–26 | ~130 | ~13 | ~10 | 8 | ~135K | ~27MB |
| EPL | 2010–26 | 20 | 38 | ~15 | 16 | ~182K | ~37MB |
| MLS | 2015–26 | ~26 | 34 | ~15 | 11 | ~146K | ~29MB |
| **Total** | | | | | | **~1.57M rows** | **~315MB** |

Total real distinct games across all six sports/ranges: **~55,264**. At a shared rate limit of
~3 req/s (see §5), that's **~5.1 hours** of real wall-clock time for the fetch alone (not counting
DB write time, which is cheap and overlaps with fetching). These two numbers were cross-checked
against each other while writing this doc (games × avg req/game ÷ 3 req/s ≈ 5.12h) — they agree,
so treat both as a real planning baseline, not a guess.

**Explicitly out of scope**: MLB (already has its own real data/models), Golf (same), Tennis
(individual-player structure, needs its own separate design — deferred multiple times already,
not an oversight if you leave it out here too).

## 2. Why game-based ingestion, not player-based — don't rebuild the wrong thing

A per-player ingestion approach (loop every roster, call
`predict/generic_player_gamelog.py`'s `fetch_player_gamelog` per athlete) was considered and
rejected earlier this session for a real, verified reason: **that ESPN endpoint was tested live
against real athlete IDs and confirmed broken for CFB and Soccer** — it works for NFL and NBA
(confirmed live) but not the other two. Game-based ingestion (fetch each real game's boxscore once,
extract every player who appeared) is the only approach confirmed to work across all six
sport/leagues, and incidentally costs about the same total call volume in aggregate. Don't
reconsider the player-based approach without re-testing that endpoint's real behavior for CFB/Soccer
first — it may still be broken.

## 3. What already exists — reuse it, don't rebuild it

- **`player_game_history` table** — `supabase/migrations/20260827060000_player_game_history.sql`,
  already applied live. Columns: `sport, athlete_id, team_id, season, event_id, game_date,
  opponent_id, is_home, stats (jsonb), fetched_at`. `UNIQUE(sport, athlete_id, event_id)` — writes
  are already idempotent at the row level.
- **`python-odds-service/src/db.py`**: `PlayerGameHistoryInput` dataclass and
  `write_player_game_history(rows: list[PlayerGameHistoryInput]) -> int` (append-only,
  `ON CONFLICT DO NOTHING`, returns real rows-written count) and
  `fetch_player_games_from_db(sport, athlete_id, season=None)` (the read side, not needed for this
  pull but confirms the target shape). Both live-tested already (write/read round-trip, idempotent
  re-write verified to write 0).
- **`predict/generic_player_gamelog.py`**'s `PlayerGameStat` dataclass is the target per-game shape
  everything should map into: `event_id, game_date (YYYY-MM-DD), opponent_id, is_home, stats: dict`.
- **`predict/generic_matchup_defense.py`** (built earlier the same session) already has **live-proven**
  boxscore fetchers for two of your four needed shapes:
  - `_fetch_nba_boxscore` — ESPN `site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event={id}`,
    parses `boxscore.players[].team.abbreviation` + `.statistics[].labels`/`.athletes[].stats`.
    Confirmed live against a real 2024-25 game (event 401704627).
  - `_fetch_nhl_boxscore` — NHL's own official API, `api-web.nhle.com/v1/gamecenter/{id}/boxscore`,
    parses `playerByGameStats.{homeTeam,awayTeam}.{forwards,defense,goalies}`. Confirmed live
    against a real 2024-25 game.
  These aren't directly reusable as-is (they only extract points, for the position-group leaderboard
  they were built for) — but the fetch/cache/parse *pattern* and confirmed-real URLs are exactly
  what to extend for full per-player stat capture. Don't re-derive these URLs from scratch.
- **`game_context.py`**'s `_fetch_espn_scoreboard(client, espn_sport, espn_league, days_ahead)` —
  generic, already-proven-live ESPN scoreboard fetcher (currently used for *upcoming* games; for
  this pull you need the same URL pattern with a *historical* date range instead — see §4).

## 4. Real gotcha: don't use a fixed "current teams" list for historical seasons

Team membership is **not stable** across these year ranges — a fixed current-team-list approach
(the pattern `generic_matchup_defense.py` uses for its current-season-only leaderboard) will
silently produce incomplete data for older seasons if reused here:

- **NHL**: Arizona Coyotes → Utah (2024 rename/relocation); Seattle Kraken joined 2021 (not present
  2010–2020). A 2015 season pull needs 2015's real team set, not today's.
- **NFL**: Oakland → Las Vegas Raiders, San Diego → LA Chargers, St. Louis → LA Rams — all inside
  the 2012–26 range.
- **CFB**: conference realignment is frequent; FBS membership genuinely differs year to year.
- **EPL**: promotion/relegation swaps ~3 teams every single season — a "current 20 teams" list
  would only ever see whichever 20 happen to be in the league *today*, missing every team that was
  in the league in a past season but has since been relegated.
- **MLS**: expansion adds new teams periodically (not present in earlier seasons).

**The fix**: don't discover teams at all. Discover **games** directly, per season, via a season-wide
scoreboard sweep (chunked date ranges across that season's real months) using the same
`_fetch_espn_scoreboard`-style endpoint already proven live — the response includes each real game's
two real teams inline, so you never need a separate team-list step, and it's correct by construction
for every past season's real membership. This is also fewer total requests than per-team schedule
fetching (no fetching 30+ team schedules and deduping overlapping games — one season sweep gets
every real game directly). For NHL, check whether `api-web.nhle.com` has a season-wide schedule
endpoint (test live rather than assume); if not, the per-team `club-schedule-season` endpoint
already proven in `generic_matchup_defense.py` works too, just accept the extra dedup step for NHL
specifically.

## 5. What needs to be built

1. **Two more boxscore parsers**, verified live before trusting (same discipline as NBA/NHL above —
   don't assume ESPN's shape, curl a real historical game first):
   - **Football (NFL + CFB shared shape)** — ESPN `summary?event={id}` for
     `football/nfl` and `football/college-football`. Verify against a real completed game from
     each sport before writing the parser. Passing/rushing/receiving/defense stat categories,
     likely the same `boxscore.players[].statistics[].labels`/`.athletes[].stats` shape family as
     NBA's, but confirm — don't assume identical structure just because it's the same ESPN product.
   - **Soccer (EPL + MLS shared shape)** — ESPN `summary?event={id}` for `soccer/eng.1` and
     `soccer/usa.1`. Goals/assists/shots-on-target are the likely core stats a prop model would
     want. Verify live against a real completed match from each league before trusting.
2. **Season-wide game discovery per sport** (§4) — one function per sport (or one generic function
   parameterized like `generic_matchup_defense.py`'s `_ESPN_SPORT_CONFIG` pattern in
   `game_context.py`), returning real, deduplicated `(event_id, season, date)` tuples for a given
   season.
3. **One orchestrator** that, for each `(sport, season)` in the scope table:
   - Discovers that season's real games (§4).
   - For each game: **check `player_game_history` for any existing row with this
     `(sport, event_id)` first — skip the fetch entirely if found** (see §6, this is the resumability
     mechanism, not just the write-level idempotency the UNIQUE constraint already gives you).
   - If not already present: fetch the boxscore, parse **every player from both teams** into
     `PlayerGameHistoryInput` rows, write them via `write_player_game_history` as one batch per game
     (so a crash mid-game never leaves that game half-written and marked done).
   - Logs progress periodically (§7).
4. **Rate limiting**: one shared limiter for the whole run, ~3 req/s to start (matches the estimate
   this doc is built on). This shares ESPN's outbound rate budget with the rest of the live app's
   real-time features (a real, disclosed risk flagged earlier this session) — watch for 429s or a
   sudden spike in failed fetches and back off if seen, don't just push through. Do **not** run
   sports in parallel via separate agents/processes hitting ESPN simultaneously — that concentrates
   the same total request volume into a more aggressive burst rather than making anything safer or
   faster (this was explicitly decided against earlier the same session). Sequential, one shared
   queue, is the model.

## 6. Resumability — required, not optional

The user explicitly asked for this: **if the process dies partway through (crash, network failure,
session interruption), resuming must not re-fetch or re-pay for work already done.**

- **Skip-before-fetch, not just skip-on-write**: before fetching a game's boxscore, query
  `player_game_history` for `WHERE sport = $1 AND event_id = $2 LIMIT 1`. If a row exists, the game
  was already fully processed (see next point for why that's a safe assumption) — skip the network
  call entirely. This is what actually saves time on resume; the table's `UNIQUE` constraint alone
  only avoids duplicate *rows*, it doesn't avoid re-*fetching*.
- **Process one game atomically**: fetch → parse → write *all* players from both teams for that game
  in one pass before moving to the next game. This makes the skip-before-fetch check above safe —
  a game only ever has rows in the table if it was fully processed, never partially.
- **The database is the real source of truth for progress**, not a separate log file that could get
  out of sync. `SELECT sport, season, COUNT(DISTINCT event_id) AS games_done FROM player_game_history
  GROUP BY sport, season ORDER BY sport, season` is the real, authoritative "where are we" query —
  run it any time to see genuine progress, including after an unplanned restart.

## 7. Don't waste 5 hours to a silent death — run it durably, check on it periodically

The user explicitly asked for this too: **periodic checks that it's still running, so a silent
failure doesn't burn hours before anyone notices.**

1. Start the orchestrator as a **background process** (Bash tool with `run_in_background: true`, or
   an equivalent detached/nohup'd process with output redirected to a real log file) — it must
   survive beyond a single chat turn.
2. Have it print a clear progress line periodically (e.g., every 50 games or every 2 minutes):
   sport, season, games done so far / real target from §1's table, rows written, elapsed time.
3. **Every ~15–20 minutes**, check on it: is the process still alive, is the log still advancing, is
   §6's DB query's row count still growing. Use `Monitor`/background-task-notification tooling if
   available in this environment, or just the `Read` tool on the log file plus a quick DB query — a
   real check, not an assumption that it's fine.
4. **If it died or stalled**: restart it. Because of §6's skip-before-fetch check, restarting is
   always safe and never wastes time re-fetching games already in the table — it picks up exactly
   where it left off.
5. Keep checking and restarting as needed until every `(sport, season)` combination's real row count
   is in the right ballpark versus §1's estimate table. Don't declare done on "the process exited
   with code 0" alone — that's necessary but not sufficient; check the actual numbers.

## 8. Final verification before calling this done

Mirror this session's own standing discipline: prove it live, per sport, don't assume the pattern
that worked for one sport generalizes silently to the others.

- Per sport, compare final `COUNT(DISTINCT event_id)` and total row count against §1's estimate
  table — flag (don't silently accept) any sport whose count is dramatically off from its estimate.
- Spot-check at least one real player's row against their real known stats for a specific real game
  (e.g., a well-known player's real box score line you can cross-check against ESPN's own page) —
  for each of the four parser shapes (NBA, NHL, football, soccer), not just one.
- Confirm no sport was silently skipped entirely (a config typo, a wrong ESPN league code) — six
  real, non-zero `(sport, season)` row groups should exist for every season in every sport's real
  range from §1.

## 9. Explicitly not this task's job

Wiring the resulting data into `generic_prop_score.py`'s X (matchup-favorability) signal or into
`compute_league_rate`'s base-rate calculation for CFB/NFL/Soccer is **separate, follow-on work** —
tracked in `docs/model-build-backlog-2026-08-27.md`. This task's job is only to get the real data
into `player_game_history`, correctly and completely, per §1's scope. Don't scope-creep into wiring
it up unless explicitly asked.
