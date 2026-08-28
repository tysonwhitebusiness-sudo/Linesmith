# player_game_history backfill — RESUME / HANDOVER

**Written:** 2026-08-27 ~15:55 UTC, mid-run, for a fresh agent on another account to take over.
**Original brief:** the task prompt in this session (see also `docs/historical-player-gamelog-pull-2026-08-27.md`,
`docs/all-sports-prop-score-gameplan-2026-08-27.md`).

---

## 1. One paragraph: what this is

A standalone, resumable background script is populating the `player_game_history` Postgres table
with real per-player, per-game stat lines across **6 sport/leagues** (NFL, CFB, MLS, EPL, NBA, NHL)
going back 8–16 seasons each — ~55k distinct games, ~1.5M+ rows. It fetches each real game's
boxscore once from ESPN (NHL: `api-web.nhle.com`), parses every player who appeared on both teams,
and writes them in one atomic batch per game. **It is running right now.** Your job: babysit it to
completion (restart on death — always safe), then run the final verification in §7.

**Not your job:** wiring this data into `generic_prop_score.py` / `compute_league_rate` — that is
separate follow-on work tracked in `docs/model-build-backlog-2026-08-27.md`. MLB / Golf / Tennis are
deliberately out of scope.

---

## 2. Environment / process facts

| | |
|---|---|
| Working dir | `C:\Users\occy3\Documents\line-buddy\python-odds-service` |
| Python | `.venv/Scripts/python.exe` — run scripts as `python src/<name>.py` from that dir (no `-m`) |
| Live log | `python-odds-service/backfill_run.log` (script `print`s are all `flush=True`) |
| DB | Supabase Postgres, via `src/config.py` reading `../.env.local` `DATABASE_URL`. Shared pooler caps ~15 conns; this script uses 1. |
| Launch style | detached: `nohup … & disown`, survives shell/turn exit |

**State at handover:** PID 3124 (changes on restart), running **NFL season 2024**, ~194k rows
written, **0 real failures**, started ~15:35 UTC. Sequence is `nfl → cfb → soccer_mls → soccer_epl
→ nba → nhl`. Full run ≈ 5–5.5 h wall clock ⇒ ETA ≈ 20:30–21:00 UTC 2026-08-27. NHL is the longest
single sport (16 seasons, ~20k games) and runs last.

---

## 3. How to check on it (do this every ~15–20 min)

```bash
cd /c/Users/occy3/Documents/line-buddy/python-odds-service

# a) is it alive?
ps -W 2>/dev/null | grep -i python
#   or, more precisely:
#   powershell "Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | ? { $_.CommandLine -like '*backfill_player_game_history*' } | select ProcessId,CommandLine"

# b) is the log advancing? any REAL failure?
tail -40 backfill_run.log
#   Real trouble = a line "... | N failed | ..." with N>0, a "Traceback", or "!!! season aborted".
#   NOTE: every progress line contains the text "0 failed" — `grep -c fail` is meaningless here.

# c) authoritative progress (DB truth, safe any time incl. after a crash):
.venv/Scripts/python.exe src/backfill_progress.py
```

`backfill_progress.py` prints distinct games + rows per `(sport, season)` and a % vs the brief's
estimate table. **Games should track the estimates closely. Rows will run 2–3× the brief's row
estimates for every sport — that is expected and correct** (the brief assumed ~10–18 players/game;
real boxscores yield ~25–60 players with a stat line). Judge completeness by **games**, not rows.

Rough per-sport game targets (regular season only): NFL ~256/szn (272 from 2021), CFB ~800–900/szn
(FBS), MLS 340–500/szn, EPL 380/szn (300 in the COVID-shortened 2019-20), NBA ~1230/szn (fewer in
2011-12 lockout, 2019-20, 2020-21), NHL ~1230/szn (fewer in 2012-13 lockout, 2019-20, 2020-21).

---

## 4. How to restart if it died or stalled

Skip-before-fetch makes a restart **always safe and cheap**: it re-runs season discovery
(~2k requests, ~10 min of scoreboard scans total) but re-fetches **zero** already-recorded games.
A game only ever has rows if it was fully processed, so there are never partial rows to clean up.

```bash
cd /c/Users/occy3/Documents/line-buddy/python-odds-service
mv backfill_run.log backfill_run.log.$(date +%s)     # keep the old log
nohup .venv/Scripts/python.exe -u src/backfill_player_game_history.py > backfill_run.log 2>&1 &
disown
```

Optional: scope the restart to skip re-discovering finished sports, e.g. once NFL+CFB+MLS+EPL are
done and it died in NBA:

```bash
nohup .venv/Scripts/python.exe -u src/backfill_player_game_history.py nba nhl > backfill_run.log 2>&1 &
```

Positional args = sport labels (`nfl cfb soccer_mls soccer_epl nba nhl`). Also `--from-season N` /
`--to-season N` (by the stored season label — see §6), `--rps FLOAT` (default 3.0 — **leave it**,
see §6), `--list` (print plan and exit).

**Do NOT** run two instances or parallelize sports across processes/agents — that concentrates ESPN
load into a burst. One process, one shared limiter, sequential. This is explicit in the brief.

If it **stalled** (process alive, log not advancing for >5 min, `backfill_progress.py` row count
flat): kill it and restart with the block above.

```bash
powershell "Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | ? { \$_.CommandLine -like '*backfill_player_game_history*' } | % { Stop-Process -Id \$_.ProcessId -Force }"
```

---

## 5. What "done" looks like

The log ends with:

```
=== RUN COMPLETE ===
elapsed NNN.N min | requests NNNNN
games: seen=... fetched=... empty=... failed=...
rows written: NNNNNN
<optional: list of failures — these are auto-retried on the next run>
```

**Do not trust "exit code 0" alone.** If `failed > 0`, just launch one more bare restart — the
failed games (usually transient ESPN 5xx/timeouts) get retried and the rest are skipped. Repeat
until `failed = 0` or the remaining failures are genuinely dead event ids (ESPN 404 — a handful is
normal, e.g. cancelled/relocated games).

---

## 6. Design facts — so you don't break it

- **`player_game_history`** columns: `sport, athlete_id, team_id, season, event_id, game_date,
  opponent_id, is_home, stats(jsonb), fetched_at`. `UNIQUE(sport, athlete_id, event_id)` — writes
  idempotent (`ON CONFLICT DO NOTHING`). Migration `supabase/migrations/20260827060000_...` already
  applied live.
- **Season label per sport** (stored in `season` INT, matches each sport's own upstream convention):
  - NBA → ESPN `season.year` = **END year** (2016 == the 2015-16 season). Scope: 2016..2026.
  - NHL → **START year** (2015 == 2015-16). Scope: 2010..2025.
  - NFL / CFB → ESPN `season.year` = **START year**. Scope: 2012..2025 / 2018..2025.
  - EPL → **START year** (2015 == 2015-16). Scope: 2010..2025.
  - MLS → **calendar year**. Scope: 2015..2025.
- **Regular season only.** ESPN sports filter `season.type == 2`; MLS additionally requires
  `season.slug` starts with `regular-season`; NHL filters `gameType == 2`. Playoffs excluded by
  design.
- **Discovery = game-based, never a fixed team list** (team membership isn't stable across these
  year ranges). ESPN: 14-day scoreboard windows (7-day for CFB), `groups=80` for CFB (FBS).
  NHL: weekly `schedule/{date}` walk via `nextStartDate`.
- **Per-season internals:** a bounded `asyncio.Queue` with one producer (rate-limited fetch+parse)
  and one consumer (one multi-row INSERT per game). Exactly one fetch + one write in flight. Each
  queue item is one game's full row set, so per-game atomicity (and resume safety) holds.
- **Rate limit:** one process-wide `RateLimiter`, 3 req/s, auto-slows on HTTP 429 (`slow_down()`,
  interval ×1.5 up to 2s) and eases back on success. Shares ESPN's outbound budget with the live
  app — do not raise `--rps`.
- **ESPN UA gotcha:** ESPN's edge 403s a browser-looking `User-Agent` that lacks the rest of a
  browser's headers. httpx's **default** UA works. The client sets no UA header on purpose — don't
  add one.
- **NHL is on a different API** (`api-web.nhle.com`), not ESPN. NHL `athlete_id` / `team_id` are
  nhle numeric ids as strings; the other 5 sports use ESPN ids. This is intentional and matches how
  the app already treats NHL.
- **Parsers** (`parse_nba`, `parse_football` [NFL+CFB], `parse_soccer` [EPL+MLS], `parse_nhl`) were
  each verified live against a real historical game on 2026-08-27 before being trusted. Football
  namespaces stats as `category.key` (e.g. `passing.passingYards`); NBA/NHL use flat machine keys;
  soccer uses ESPN's `stats[].name` (e.g. `totalGoals`, `goalAssists`, `shotsOnTarget`,
  `totalShots`, `saves`). Made/attempted combos ("26/35", "6-13") are split into their two named
  components.

---

## 7. Final verification (do this once the run is COMPLETE)

Per the brief's §8:

1. **`.venv/Scripts/python.exe src/backfill_progress.py`** — every `(sport, season)` present, distinct
   game counts in the ballpark of §3's per-sport targets. Flag any season dramatically low (would
   mean a discovery bug). Rows being ~2–3× the brief's row estimates is expected (see §3).
2. **Spot-check one real player per parser shape** against their real known stats for one real game:
   - one NBA game, one NHL game, one football game (NFL or CFB), one soccer match (EPL or MLS).
   - Query pattern:
     ```sql
     SELECT athlete_id, team_id, opponent_id, is_home, game_date, stats
     FROM player_game_history
     WHERE sport = $1 AND event_id = $2 AND athlete_id = $3;
     ```
   - Already spot-checked during the build (all passed): NFL Ryan Tannehill (id `14876`) event
     `400791725` → `passing.passingYards = 307`; NHL A. Cogliano (id `8471699`) event `2015020215`
     → `assists=1, points=1`; NBA Jared Dudley (id `3201`) event `400828480` → `points=3,
     rebounds=7, minutes=30`. Re-run one or two of these + one soccer example.
3. **No sport silently skipped** — confirm all 6 `sport` values present in the table
   (`SELECT sport, count(*) FROM player_game_history GROUP BY sport;`) and none is near-zero.

---

## 8. Files touched (all uncommitted — decide whether to commit)

| Path | Status | Notes |
|---|---|---|
| `python-odds-service/src/backfill_player_game_history.py` | **NEW** | the orchestrator + 4 parsers + discovery |
| `python-odds-service/src/backfill_progress.py` | **NEW** | read-only progress checker |
| `python-odds-service/src/db.py` | **MODIFIED** | added `player_game_history_done_events()`, `player_game_history_progress()`; rewrote `write_player_game_history()` from a per-row loop to one multi-row INSERT (the per-row version over the Supabase pooler was the real bottleneck — ~0.5 games/s, >24 h projected). **No other callers of that function exist.** |
| `supabase/migrations/20260827060000_player_game_history.sql` | pre-existing, already applied live | not created by this work |
| `python-odds-service/backfill_run.log*` | run logs | gitignore or delete; not source |

Suggested commit message if committing after verification:
`Backfill player_game_history: 6-sport historical game-based ingestion`

---

## 9. Known gotchas / history

- **Bottleneck fixed once already.** First launch ran at ~0.5 games/s because `write_player_game_history`
  did one `INSERT` round-trip per player row over the shared pooler. Rewrote it to a single
  multi-row `INSERT ... VALUES (...), (...) ON CONFLICT DO NOTHING RETURNING 1` (chunked well under
  the 65535 bind-param ceiling; `RETURNING 1` count = true inserted count). Also added the
  producer/consumer queue so a game's write overlaps the next game's rate-limit wait. Now ~2.7–3
  games/s (fetch-bound). If write latency creeps back, confirm that function is still the bulk
  version.
- **`grep -c fail` on the log lies** — every progress line has "0 failed". Look for "N failed" N>0.
- **Pool-create retry:** `db.get_pool()` retries 3× on a transient "pool full" from the shared
  pooler. If you see repeated pool-create failures, check nothing else heavy is hitting the DB
  (long model fits, the main worker under load).
- **A few ESPN 404s in CFB/soccer far back** are normal (relocated / abandoned fixtures). They log
  as failures, don't stop the run, and stay failed on retry — that's fine, not a bug.
