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

### Gaps
None identified for schedule/roster/box-score/standings/season-stats. Player props (backend) not yet
audited — needs the same ProviderSpec-availability check CFB got (does Propline/ParlayAPI/SportsGameOdds
have real NBA coverage? Not checked this session, real open item for the actual build pass).

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
build time" caveat as CFB's 2026 data currency. Player props (backend) not yet audited, same open item as NBA.

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

### Not yet confirmed — real open items, not assumed-solved
- **Per-match stat detail via ESPN's summary endpoint** (aces/DFs/break points per match, the tennis
  equivalent of what soccer's `summary?event=X` gave for free) — **tested properly this session, both
  plausible id shapes, neither worked**: the scoreboard competition id (`184414`) and the tournament-level
  event id (`718-2026`) both returned `{code, message}` error shapes from `/summary`, not real match data.
  This is a real negative finding, not an inconclusive one — ESPN's tennis API does not expose per-match
  stats the same straightforward way soccer's does, at least not via the endpoint shape that works for team
  sports. A different tennis-specific endpoint may exist (not found this session) or may genuinely not exist
  on ESPN's side.
- **Live equivalent of the attached ATP/WTA season CSVs** (the rich Sofascore-shaped local files with
  odds/serve-stats) — Sofascore's own public API returned 403 when tested directly (likely needs specific
  headers/session handling their frontend uses, or is deliberately gated against non-browser clients).
  **Don't build against Sofascore without either (a) getting it working live first, or (b) accepting the
  attached CSVs as a periodic historical import rather than a live feed** — this is a real, unresolved
  decision point, not a solved gap.
- **TML-Database's live-ness** — its own README says the GitHub repo is now archival-only, live updates
  moved to a website with no confirmed public API. The attached CSVs are real and rich (real per-match
  aces/DFs/serve-return-% history back to 1968, current through early 2026) but are a **snapshot as of
  download (2026-08-16)**, not something this app can re-fetch live without more investigation into whether
  `stats.tennismylife.org` exposes anything fetchable.

### Gaps (real, still open after this session's research)
- **A live per-match history source for ongoing form/windows** is the one piece not confirmed solved for
  tennis, unlike the other three sports. The historical CSVs (TML/Sackmann) could seed a one-time backfill,
  but there's no confirmed way to keep it current without either (a) getting ESPN's per-match summary stats
  working (needs investigation), or (b) getting a live Sofascore-equivalent working (needs investigation), or
  (c) periodically re-downloading TML's historical file manually (not automatable without their site's real
  access pattern being confirmed).
- **Licensing note**: TML-Database is explicitly "Non-Commercial Share Alike," inherited from Sackmann's own
  CC license. Personal-use research tooling is very likely fine, but flagging since it's a real term, not
  nothing — worth your own read of the license before this becomes a production data dependency.

---

## 5. Cross-sport notes

- **None of CFB/NBA/NHL need anything like soccer's "no per-match history" problem.** All three have a real,
  live, confirmed per-player, per-game stat source (`sportsdataverse-data` for NBA/CFB, `api-web.nhle.com`
  for NHL) — the L5/L10/L15/H2H windows, gamelog, and distribution chart that soccer had to leave `null` are
  buildable from day one for all three.
- **Standings, live state, and game-level context are solved for all three** the same way — no repeat of
  soccer's "I only checked candidates and props, not the surrounding page" mistake.
- **Player props backend coverage for NBA and NHL — deliberately not live-tested this session.** I started
  to (checking SportsGameOdds' `/v2/leagues` catalog, the same check that resolved soccer's MLS coverage
  question), but that key hit "Rate limit exceeded" on the first call — it's a real, shared, budget-capped
  production key also used by the live MLB job, and burning more of it for a pure research question isn't a
  reasonable trade. This needs checking at actual build time, ideally via each provider's own dashboard/docs
  rather than live API probes, or with the budget headroom checked first the way `[[project_db_connection_pool_limit]]`-style
  caution already applies elsewhere in this codebase.
- Tennis remains the one sport of the four where "full parity, no data gaps" is **not yet a confirmed
  guarantee** — it has real infrastructure and real historical depth, but the live-current-history question
  is genuinely open, not resolved by wishful reuse of the attached files.

---

## 6. What "approved to build" would need before it's true

Per your instruction, nothing here is approved yet. Before any of these move to build status, at minimum:

1. **CFB**: you register for a free CollegeFootballData.com API key and hand it to me — the one real
   blocking dependency, everything else for CFB is already solved.
2. **NBA/NHL**: player-props backend coverage confirmed for each (real ProviderSpec check against
   SportsGameOdds/Propline/ParlayAPI's real catalogs — deliberately not done this session to avoid burning
   shared production budget on a research question, see §5).
3. **Tennis**: a real decision on per-match history, since ESPN's summary endpoint is now confirmed *not* to
   provide it (not just unconfirmed) — either (a) more investigation into a working ESPN tennis stats
   endpoint if one exists, (b) a live Sofascore-equivalent found and confirmed working, or (c) an explicit,
   conscious choice to ship tennis with one-time historical backfill from the attached TML/Sackmann files and
   no live-updating history — a real choice for you to make, not a gap to silently inherit.

Everything else audited this session (CFB schedule/roster/props-backend, NBA schedule/roster/standings/
box-scores/season-stats, NHL schedule/roster/standings/box-scores, tennis schedule/rankings) is real,
confirmed live, and ready to build against once the three items above are resolved.
