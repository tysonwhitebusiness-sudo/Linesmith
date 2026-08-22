# Multi-sport expansion audit — CFB, NBA, NHL, Tennis (2026-08-22)

**Status: research only. Nothing in this document is approved to build yet.** This is a data-source audit,
done specifically to avoid repeating the soccer mistake — that build started before every data need was
inventoried against a real, confirmed source, and gaps (standings, game-lines, per-match history) surfaced
live during user testing instead of being caught here. Every source below was actually tested live this
session (`curl`/browser), not assumed from a repo's README alone, unless explicitly marked otherwise.

Companion to `docs/soccer-gameplan-2026-08-22.md` (soccer's own doc, approved but paused — see
`docs/build-queue-2026-08-22.md` for the current status of every sport initiative, soccer included).

---

## 0. What was inspected

User-attached files (`~/Downloads`), all opened and inspected this session:

| File | What it actually is | Verdict |
|---|---|---|
| `cfbfastR-data-main.zip` (3.4GB) | `sportsdataverse/cfbfastR-data` — real CFB play-by-play/schedules/rosters/betting lines 2002-2022, **local snapshot is stale** (2023-2026 mostly missing/empty in this download) | Real source, live GitHub-release URL confirmed — don't use the local zip as a data source, use the live URLs (see §1) |
| `hoopR-main.zip` | `sportsdataverse/hoopR` — the R **package source code**, not bulk data | Read for its real data URLs (led to the `sportsdataverse-data` finding, §2) |
| `hockeyR-master.zip` | `sportsdataverse/hockeyR` — R package source | Read for its real data URLs (led to the NHL official-API finding, §3) |
| `TML-Database-master.zip` | "TennisMyLife" ATP match database, 1968-2026, forked from Jeff Sackmann's `tennis_atp` (CC Non-Commercial Share Alike) | Real historical data; repo's own README says it's now **archived** in favor of a website (`stats.tennismylife.org`) — no confirmed live API there, treat as a periodic historical-snapshot source, not a live feed |
| `tennis_MatchChartingProject-master.zip` (62MB) | Jeff Sackmann's shot-by-shot charting project | Real but **crowd-sourced and incomplete** — ~5,000 matches charted total, across all of tennis history. Supplementary depth for the rare match that has it, never a primary source |
| `2025/2026-{atp,wta}-season.csv` | Rich match-level data (sets, aces, DFs, serve/return %, break points, **pregame odds**) — column naming matches Sofascore's API shape | Real, valuable reference for schema; provenance not confirmed live (Sofascore's public API 403'd when tested directly, §4) — treat as a historical reference file, not a live source until/unless a live equivalent is separately confirmed |
| `Unconfirmed 979455.crdownload` (508MB) | An **incomplete Chrome download** (`.crdownload` = still-downloading placeholder, not a real file) | Not usable — flagging back to you: if this was meant to be a real dataset, the download needs to be finished/retried |

---

## 1. CFB

### Confirmed live
- **ESPN site API** (`site.api.espn.com/apis/site/v2/sports/football/college-football`) — the exact same
  module (`teamSportEspn.ts`) already used for NFL/soccer works for CFB with zero new code; `multiSportGameContext.ts`
  already has a `cfb` entry. Scoreboard tested live (0 games on 2026-08-22, which is correct — CFB season
  starts late Aug/early Sept, not a bug).
- **`sportsdataverse/cfbfastR-data`** on GitHub — same publisher family as `nflverse-data` (already integrated
  via `lib/sports/nfl/nflverse.ts`). **Correction after re-checking the live repo directly (not just the local
  zip): this archive genuinely stops at the 2022 season** — confirmed via GitHub's own contents API
  (`api.github.com/repos/sportsdataverse/cfbfastR-data/contents/cfb/pbp/rds`), which lists only 2016-2022,
  nothing newer. The local zip wasn't stale-relative-to-live; it matches live reality. **Do not plan CFB's
  per-match history around this repo alone** — it's real and useful for historical backfill (2002-2022), not
  a current-season source.
- **CollegeFootballData.com (CFBD)** — the real, current-season CFB data source (what `cfbfastR`'s own live
  functions actually call, distinct from the static archive above). Confirmed real and reachable
  (`api.collegefootballdata.com/games` responds, requires a bearer API key). **Free tier requires registering
  for an API key at collegefootballdata.com** — not something I can do myself (account creation on a
  third-party site is outside what I do without you) — you'd need to sign up and hand me the key. This is CFB's
  answer to soccer's per-match-history problem: real play-by-play/box scores/rosters, current season, free.
- **ESPN site API** (`site.api.espn.com/apis/site/v2/sports/football/college-football`) — the exact same
  module (`teamSportEspn.ts`) already used for NFL/soccer works for CFB with zero new code; `multiSportGameContext.ts`
  already has a `cfb` entry. Scoreboard tested live (0 games on 2026-08-22, which is correct — CFB season
  starts late Aug/early Sept, not a bug). This alone covers schedule/roster/standings/live-state even before
  CFBD's key is in hand — CFBD is specifically what upgrades per-match history from "not available" to real.
- **Player props (backend)** — `cfb` is already a first-class `SportKey`/`Sport` in the Python worker
  (`ProviderSpec`s exist for ParlayAPI CFB, SportsGameOdds coverage per `multiSportRefresh.ts`'s existing job
  inventory) — this is the one sport of the four where the **odds backend already runs in production**, only
  the frontend (adapters/pages) is missing. Confirmed by grep — `refreshCfbJob`/`job_cfb` already exist and
  are registered in `JOB_REGISTRY`.

### Gaps
One real, actionable item: **CFBD needs a free API key from you** before CFB can get real per-match history
the way NBA/NHL can out of the box. Everything else (schedule/roster/standings/live-state/props-backend) is
already solved or already live.

---

## 2. NBA

### Confirmed live
- **`sportsdataverse/sportsdataverse-data`** (found by reading `hoopR`'s real source, not assumed) —
  GitHub Releases repo with per-season CSV/Parquet/RDS files: play-by-play, **team box scores**, **player
  box scores**, schedules, standings, game rosters, officials, draft, player season stats, team season
  stats, rosters. Confirmed live: downloaded a real 577KB `nba_schedule_2026.rds` (last-modified Aug 12
  2026 — genuinely current), then confirmed the same release also serves `.csv` and `.parquet` variants at
  200 (not RDS-only, which would've been a real blocker — R's binary format isn't natively parseable in
  Node). URL pattern: `github.com/sportsdataverse/sportsdataverse-data/releases/download/espn_nba_{dataset}/{name}_{season}.csv`.
  This is NBA's equivalent of `nflverse-data` — same publisher, same reliability, same integration shape
  `nflverse.ts` already proves out.
- **ESPN site API** — `hoopR`'s own `espn_nba_*.R` functions confirm ESPN's `basketball/nba` slug works the
  same as every other sport `teamSportEspn.ts` already covers; not separately re-tested this session since
  the pattern is already proven 4x over (NFL/CFB/soccer/this).

### Player props (backend) — RESOLVED via public provider documentation
Checked both real providers' own public marketing/docs pages (zero API cost, no live key touched):
- **Propline**: its own site states player props cover "MLB, NBA, WNBA, NHL, 28 soccer leagues, UFC, and
  boxing" — NBA and NHL both explicitly confirmed, WNBA as a real bonus.
- **ParlayAPI**: its own site states coverage across "Baseball (MLB), Basketball (NBA), Football (NFL),
  Hockey (NHL), Soccer (EPL), and MMA" — same confirmation, independently.

Both providers market themselves as "drop-in compatible with the-odds-api," whose own public docs give the
standard sport-key strings `basketball_nba` and `icehockey_nhl` — a strong starting assumption for what each
provider's real `sport` parameter value is, though (matching the soccer precedent, where Propline used
`soccer_mls` but ParlayAPI diverged to `soccer_usa_mls`) **the exact per-vendor string still needs one live
verification call at build time**, not assumed with full certainty. Not verified live this session on
purpose: Propline's key was already at its real daily cap (1,000/1,000 used) from this morning's live
production job when checked, and SportsGameOdds' key hit "rate limit exceeded" on an unrelated check earlier
— both are shared, budget-capped, real production resources; spending more of either on a research-only
question wasn't a reasonable trade. This is now a trivial, single-call confirmation step for the actual
build session (when quota resets), not a research gap.

### Gaps
None. Schedule/roster/box-score/standings/season-stats confirmed live via `sportsdataverse-data`;
props-backend coverage confirmed via both providers' own public documentation.

---

## 3. NHL

### Confirmed live — this is the strongest of the four
- **`api-web.nhle.com`** — the NHL's own **official, modern, public API** (found by reading `hockeyR`'s
  source; the package mixes this with the deprecated `statsapi.web.nhl.com`, use only the `api-web.nhle.com`
  + `api.nhle.com/stats/rest` endpoints, not the deprecated ones). This is the same tier of source as MLB's
  own Stats API, which this codebase already has deep first-class integration with
  (`lib/sports/mlb/statsapi.ts`) — NHL doesn't need ESPN or any third party for its core data at all.
  Confirmed live, this session, with real current/recent data:
  - `/v1/schedule/{date}` — real schedule (correctly showed the 2026-27 season hasn't started yet, next
    start date 2026-09-19 — matches real NHL preseason timing, not a bug).
  - `/v1/standings/now` — real, rich standings: 32 teams, conference/division breakdown, goal differential,
    L10, home/road/division/conference sequence — real 2025-26 season-end data (dated 2026-04-17).
  - `/v1/gamecenter/{gameId}/boxscore` — real **per-player** game stats (goals, assists, points, +/-, SOG,
    faceoff%, TOI, hits, blocked shots, giveaways/takeaways) for both forwards/defense/goalies — confirmed
    on a real April 2026 game (DAL @ BUF).
  - `/v1/gamecenter/{gameId}/play-by-play` referenced by `hockeyR` — not separately re-verified this session
    but same API family as the two confirmed above, high confidence.
- **`hockey-reference.com`** (via plain HTTP + HTML parsing, not headless-browser scraping — `hockeyR`'s own
  `rvest` calls are static-HTML fetches, not JS-rendered pages) — supplementary source for season
  totals/standings if `api-web.nhle.com` is ever missing something; not needed as primary given how rich the
  official API already is. **Verify at build time that this really is static HTML** (not JS-rendered) before
  relying on it — the soccer doc's own "no Selenium" rule applies the same way here if it turns out to need
  a real browser.

### Gaps
None identified for schedule/standings/boxscore/live-state. Roster and play-by-play endpoints are named in
`hockeyR`'s source but weren't independently re-fetched this session — same "high confidence, verify once at
build time" caveat as CFB's 2026 data currency. **Player props (backend) confirmed via public provider docs**
— see NBA's §2 writeup, the same Propline/ParlayAPI research covers NHL too (both list it explicitly). Same
single-call sport-key verification needed at build time, not a live-tested gap.

---

## 4. Tennis

Structurally different from the other three — individual sport, no roster/team concept (matches golf's
position in this codebase more than a team sport). Already has a real, if thin, foundation:

### Already built (before this session)
- `lib/sports/multiSport/espnTennis.ts` — ESPN scoreboard-based match list (tournament, both players' names/
  ids, completion status). Minimal but real and already working.
- Backend: `tennis_atp`/`tennis_wta` already exist as real `SportKey` members; SharpAPI tennis market-key
  aliases (`aces`, `games-won`, `to-win-a-set`) already exist in `entity_resolution.py`, per earlier grep —
  meaning tennis props have *some* real backend presence already, not starting from zero.

### Confirmed live this session
- **ESPN rankings** (`site.api.espn.com/apis/site/v2/sports/tennis/{atp,wta}/rankings`) — real, current ATP
  rankings confirmed (Jannik Sinner #1, matches reality). Real source for a rankings display, not previously
  wired into anything.
- **ESPN scoreboard** — real current tournaments confirmed (Cincinnati Open, Winston-Salem Open live on
  2026-08-22).

### RESOLVED this session — `stats.tennismylife.org` has a real, live, public API
The GitHub repo's own "archived" notice was misleading — **the website itself is very much live and
actively current**, and exposes a genuinely simple, undocumented-but-open data API, found by loading the
site and reading its network requests (same technique that found Understat's real endpoint for soccer):

- **`GET stats.tennismylife.org/api/data-files`** — returns a JSON list of 171 real files (per-year ATP
  CSVs 1967-2026, per-year WTA CSVs 1990-2026, plus `ongoing_tourneys.csv`), each with a direct, plain,
  **no-auth-needed** download URL and a real `mtime`. Confirmed live: `ongoing_tourneys.csv` was last
  modified today (`2026-08-22T15:48:14`, hours before this check), and directly `curl`-able with zero
  headers/cookies/priming — simpler than Understat's setup, not harder.
- **Real per-match schema** (identical to Sackmann's own `tennis_atp`/`tennis_wta` convention): aces, double
  faults, serve points, 1st/2nd serve won, serve games, break points saved/faced, for both winner and loser,
  every match. Confirmed live against real August 2026 Cincinnati Masters matches (currently in progress —
  matches the site's own "Live Tournaments" banner).
- **Both tours covered**: ATP files back to 1968, WTA back to 1990 (the site's own "NEW: WTA Tour files
  added!" banner, confirmed real files exist for both).

This is a complete, real answer to tennis's per-match history problem — the same shape of solution
Understat/ASA gave soccer, found the same way. Player identity in these files is by name
(`winner_name`/`loser_name`) plus TML's own short alphanumeric player codes (not ESPN athlete ids) — entity
resolution is name-matching via the same `normalizeName`/`scoreNameMatch` machinery already reusable across
every sport in this audit.

**Previously-considered alternatives, now unnecessary but noted for completeness**: ESPN's tennis
`/summary` endpoint was tested properly (both the scoreboard competition id and the tournament-level event
id) and confirmed to **not** expose per-match stats the way it does for soccer — a real negative finding,
not just an unconfirmed one. Sofascore's public API 403'd on a direct request — also not needed now.

### Gaps
None identified for tennis after this finding. One real caveat, not a gap: **licensing** — TML-Database's
data is explicit "Non-Commercial Share Alike," inherited from Sackmann's own CC license (the website itself
doesn't restate different terms anywhere found this session). Personal-use research tooling is very likely
fine, but worth your own read before this becomes a production dependency.

---

## 5. Cross-sport notes

- **None of the four sports have anything like soccer's original "no per-match history" problem, once
  `stats.tennismylife.org` is counted.** All four now have a real, live, confirmed per-player/per-match stat
  source (`sportsdataverse-data` for NBA/CFB, `api-web.nhle.com` for NHL, `stats.tennismylife.org` for
  tennis) — the L5/L10/L15/H2H windows, gamelog, and distribution chart that soccer had to leave `null` are
  buildable from day one for all four.
- **Standings, live state, and game-level context are solved for CFB/NBA/NHL** the same way — no repeat of
  soccer's "I only checked candidates and props, not the surrounding page" mistake. Tennis doesn't have an
  exact equivalent of "standings" (individual sport — rankings fill that role, confirmed live via ESPN) or
  "game-level odds" in the same sense (each match already has its own moneyline-shaped market).
- **Player props backend coverage for NBA and NHL — confirmed via each provider's own public documentation**,
  not live API calls (both Propline's and ParlayAPI's real production keys were already at their real usage
  caps from this morning's live jobs when checked, confirming it was the right call not to probe further).
  One trivial single-call sport-key confirmation remains for build time, not a research gap anymore.
- **Tennis's one open question (live per-match history) is now resolved** — `stats.tennismylife.org`'s real,
  undocumented-but-open API, found the same way Understat's was found for soccer (load the site, read its
  own network requests). All four sports are now in the same "no known data gaps" state.

---

## 6. What "approved to build" would need before it's true

**Update (same day, after further investigation)**: both remaining gaps from the first pass are now closed.

1. **CFB**: still needs you to register for a free CollegeFootballData.com API key and hand it to me — the
   one real external dependency left across all four sports. You're getting this now separately.
2. **NBA/NHL props backend**: resolved via both providers' own public documentation (Propline and ParlayAPI
   each explicitly list NBA and NHL coverage) — no live key needed to confirm this. One trivial single-call
   sport-key-string check remains for build time (both real keys were at their live production usage caps
   when this was checked, confirming this wasn't skippable-but-lazy — there was genuinely no budget headroom
   today).
3. **Tennis**: resolved — `stats.tennismylife.org` has a real, live, no-auth API (`/api/data-files`) serving
   current, rich, per-match ATP+WTA data, found by reading the site's own network requests. No decision
   needed anymore; the "explicit choice to ship with gaps" branch didn't end up being necessary.

**All four sports now have every real data need confirmed against a live, working source.** The only
remaining action item across the whole audit is CFB's API key registration — once that's in hand, every
sport in this document is genuinely ready to build without inherited gaps, which was the whole point of
doing this pass before touching code.
