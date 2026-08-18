# Line-Buddy Data Flow Audit

**Purpose:** A neutral, descriptive account of how data currently moves through this application — request triggers, sync/async behavior, external API usage, database access patterns, background jobs, and measured timing. No fixes, no recommendations. All claims are cited to file paths and line numbers as read on 2026-08-17. Line numbers may drift by a few lines on future edits but the described behavior is verbatim as read.

**Stack facts used throughout:** Next.js 15.5.4 (App Router), React 19.1.1, `better-sqlite3` 13.0.3 (`package.json:11-17`). Every page under `app/` in scope is either a thin Server Component that mounts a Client Component (no server-side data fetch) or is itself a Client Component — none of them perform a blocking server-side `await` for sport/odds data.

---

## 1. Request-time data flow

### 1.1 Shared foundation: `useSnapshot` (`components/useSnapshot.ts`)

Every sport page (`/mlb`, `/nfl`, `/golf`, and all of their sub-pages) is built on `components/AppShell.tsx`, which for the Scan tab, or directly for team/player/game detail pages, calls `useSnapshot(sport, date?)` (`components/useSnapshot.ts:63-138`).

- **Trigger:** `useEffect` on mount (`useSnapshot.ts:99-116`), which calls `load()` (`useSnapshot.ts:75-97`).
- **Sync/async:** Fully client-side and asynchronous. The page/shell renders immediately with `snapshot === null`; `load()` does `fetch(`/api/${sport}` [+ `?date=`], { cache: 'no-store' })` (`useSnapshot.ts:83-84`) and data streams in after mount. `loading` is only set `true` on the very first load (`hasData.current` gate, line 81) — subsequent refreshes keep the old snapshot visible (stale-while-revalidate on the client).
- **Polling:** `setInterval(() => void load(), REFRESH_MS)` where `REFRESH_MS = 3 * 60 * 1000` (3 min) — `useSnapshot.ts:40, 111`.
- **Focus refetch:** a `visibilitychange`/`focus` listener refetches immediately if the tab was hidden longer than `STALE_ON_FOCUS_MS = 90 * 1000` (90s) — `useSnapshot.ts:42, 118-135`.
- MLB responses additionally pass through `hydrateMlbSnapshot()` (`useSnapshot.ts:17-37`), which re-expands a server-side deduped history blob back into each candidate's `history` array.

### 1.2 `GET /api/mlb` (`app/api/mlb/route.ts:26-86`)

- `ensureSchedulerStarted()` (`lib/scheduler.ts`) is invoked as a **module-level side effect**, not inside `GET` (`app/api/mlb/route.ts:17`) — it runs once when this route module first loads (at boot under `next start`, on first request under `next dev`).
- `readSnapshotCache(cacheKey)` (`lib/db/client.ts`, SQLite read) — line 36.
- **Cache fresh** (`age < ttl`, `ttl` = `CACHE_TTL_MS` today / `FUTURE_DATE_CACHE_TTL_MS` for a previewed date, both from `lib/sports/mlb/snapshotRebuild.ts`) → returns cached payload immediately via `jsonPassthrough` (line 40).
- **Cache stale but present** → returns the stale payload immediately (line 49) **and** calls `triggerBackgroundRebuild(cacheKey, () => rebuildMlbSnapshot(...))` (`lib/staleCache.ts`) to refresh it off the request path (lines 43-49).
- **No cache at all** → `awaitRebuild(cacheKey, () => rebuildMlbSnapshot(...))` (line 62) — this is the one path that blocks the HTTP response on a full rebuild.
- `rebuildMlbSnapshot()` (`lib/sports/mlb/snapshotRebuild.ts:33+`) calls `getMlbSnapshot()` (`lib/sports/mlb/adapter.ts:1723`), which performs the external MLB Stats API/Statcast/weather calls described in §2, then writes the result to `snapshot_cache` via `writeSnapshotCache`.
- Call chain: `AppShell.tsx:133 useSnapshot('mlb')` → `useSnapshot.ts:83 fetch('/api/mlb')` → `app/api/mlb/route.ts:26 GET` → `lib/db/client.ts readSnapshotCache` → (miss/stale) `lib/sports/mlb/snapshotRebuild.ts:33 rebuildMlbSnapshot` → `lib/sports/mlb/adapter.ts:1723 getMlbSnapshot` → external calls (§2) → `writeSnapshotCache` → JSON response → `useSnapshot.ts:87 setSnapshot`.

### 1.3 `GET /api/nfl` (`app/api/nfl/route.ts:22-49`)

Same stale-while-revalidate shape as MLB: `readSnapshotCache('nfl:snapshot')` (line 24), TTL `4 * 60_000` (4 min, line 14), fresh → `jsonPassthrough` (line 28), stale → serve stale + `triggerBackgroundRebuild` (lines 31-32), cold → `awaitRebuild` (blocking). `rebuild()` (line 17) calls `buildNflSnapshot()` (`lib/sports/nfl/adapter.ts:157`).

### 1.4 `GET /api/golf` (`app/api/golf/route.ts:12-39`)

Different shape from MLB/NFL: `readSnapshotCache('golf:snapshot')` (line 14), TTL `CACHE_TTL_MS = 5 * 60 * 1000` (5 min, line 10). If fresh → cached payload (line 20). **If stale or missing, there is no `triggerBackgroundRebuild`/`awaitRebuild` wrapper** — the handler calls `getGolfSnapshot()` synchronously in the request (line 24, `lib/sports/golf/adapter.ts:491`) and the HTTP response blocks on the full rebuild before writing the new payload via `writeSnapshotCache` (line 25). Measured: see §5.

### 1.5 Per-sport page call chains

**MLB Scan (`app/mlb/page.tsx`)** — Server Component wraps `<AppShell sport="mlb">` in `<Suspense>` (`app/mlb/page.tsx:4-10`) with zero server-side data fetching. Inside `AppShell.tsx`, mount-triggered client hooks (each an independent `useEffect`, none blocking the others):
- `useSnapshot('mlb', scanDate)` — `AppShell.tsx:133` (§1.2).
- `useGameLines('mlb', snapshot?.fetchedAt)` — `AppShell.tsx:138`, `components/useGameLines.ts:29-58`. No timer of its own — re-fires only when `snapshot.fetchedAt` changes, riding the snapshot's 3-min cycle (comment, `useGameLines.ts:17-19`). Fetches `GET /api/odds/lines?sport=mlb`.
- `useSlatePropOdds(snapshot?.fetchedAt, hasPropsPipeline)` — `AppShell.tsx:141`, `components/usePropOdds.ts:154-189`. Fetches `GET /api/props/lines` (whole slate) plus a one-time `GET /api/props/diagnostics` for the user's sportsbook (lines 180-186).
- `useMarketCalibration()` — `AppShell.tsx:154`, `components/useMarketCalibration.ts:56-96`. Mount-only, no polling. Fetches `GET /api/props/calibration`.
- `useGamePickHistory('mlb')` — `AppShell.tsx:155`, `components/useGamePickRecord.ts:69-108`. Mount `useEffect` + `setInterval(load, 5 * 60 * 1000)` (5 min, line 99). Fetches `GET /api/picks/game-history?sport=mlb`.

All tab switches (`scanView`, `scanScope`) and filter changes (`useFilters.ts`) are pure in-memory re-filters of the already-fetched `snapshot.candidates` — **no new fetch is triggered by any filter/tab interaction on the Scan page.**

**MLB Team pages (`app/mlb/teams/page.tsx`, `app/mlb/team/[teamId]/page.tsx`)** → `TeamDetailPanel` → `useAllTeams()` (`components/useAllTeams.ts:28-62`, mount-only, `fetch('/api/mlb/teams')`) for the team list, and `TeamDetail.tsx:90-730` for the selected team, which fires **5 independent hooks whose `useEffect` deps are `[teamId]`** — clicking a different team in the sidebar re-triggers all five simultaneously:
1. `useTeamRoster(teamId)` → `GET /api/mlb/team/${teamId}` → `app/api/mlb/team/[teamId]/route.ts:36-90`: `getTeamInfo`, `getActiveRoster`, `getStandings` in parallel (lines 46-50), then `getPeopleSeasonStats` for pitchers and hitters in parallel (lines 59-62) — all external MLB Stats API calls, no DB caching in this route.
2. `useTeamForm(teamId)` → `GET /api/mlb/team-form?teamId=${teamId}` → `app/api/mlb/team-form/route.ts:20-40`: `getScheduleRange(season-03-01, today)` (external).
3. `useTeamStatcast(teamId)` → `GET /api/mlb/team-statcast?teamId=${teamId}` → `app/api/mlb/team-statcast/route.ts:17-41`: `getTeamStatcastRollup(season)`.
4. `useTeamBatterRanks(teamId)` → `GET /api/mlb/team-batter-ranks?teamId=${teamId}` → `app/api/mlb/team-batter-ranks/route.ts:22-53`: `getBatterRankings(season)`.
5. `useBullpen(awayTeamId, homeTeamId)` (only once today's game is known from the already-loaded snapshot) → `GET /api/mlb/bullpen?teamA=...&teamB=...` → `app/api/mlb/bullpen/route.ts:31-56`: `getPitcherRoleRankings(season)` — this one **is** DB-cached with a TTL (`readSnapshotCache` check, `lib/sports/mlb/pitcherRankings.ts:141-150`).

**MLB Player page (`app/mlb/player/[playerId]/page.tsx`)** → `PlayerDetail.tsx`. Page-level: `useSnapshot('mlb')`, `useSlip('mlb')`, `useGameLines('mlb', ...)` (lines 32-34); the player's own candidates are filtered in-memory from the already-loaded snapshot (`mine = snapshot.candidates.filter(c => c.subjectId === playerId)`, no separate fetch). `PlayerDetail` itself adds:
- `useLiveGame(gamePk, gameIsInProgress, 15_000, subjectId)` — only fetches while the game is live; polls every 15s (`components/useLiveGame.ts:61-62`, explicit `15_000` passed at `PlayerDetail.tsx:1031`). Fetches `GET /api/mlb/game/${gamePk}/live?subjectId=...` → `app/api/mlb/game/[gameId]/live/route.ts:18-47` → `getLiveFeed(gamePk)` (`lib/sports/mlb/statsapi.ts:225`, explicitly uncached per its own contract).
- `usePropOdds(gamePk, snapshot?.fetchedAt)` — `PlayerDetail.tsx:1132`, fetches `GET /api/props/lines?gameId=${gameId}` (DB reads only, no external call on this path) plus a one-time `GET /api/props/diagnostics`.
- `useMarketCalibration()` — a **second, independent instance** of the same hook `AppShell` already mounted; each mounted `PlayerDetail` fires its own `GET /api/props/calibration` on mount.
- "Show all games" is **user-click-triggered**: fetches `GET /api/mlb/player-gamelog?subjectId=...&dimension=...` once per subject/dimension, client-cached afterward so repeat clicks don't refetch (`PlayerDetail.tsx:978-992`).
- "More Books" (click) → `POST /api/props/more-books { gameId }` → `app/api/props/more-books/route.ts:19-60`: guarded by config-enabled check, game-not-final check, monthly budget (DB-backed), and a 5-minute per-game cooldown (DB-backed `lastPropFetch` read) before calling `runProviderFetch('sportsgameodds', game)` (external call).
- "Scan" (click) → `POST /api/props/scan-player { gameId }` → `app/api/props/scan-player/route.ts:22-29`: `refreshTier1(gameId)` (external Tier-1 provider calls) then re-reads `readPropOddsForGame(gameId)` from DB.

**MLB Game Detail page (`app/mlb/game/[gameId]/page.tsx`)** → `GameDetail.tsx`. Page-level adds `useGameContext(awayTeamId, homeTeamId)` (`components/useGameContext.ts:24-67`), which fires **two calls in parallel** via `Promise.all` (lines 39-47): `GET /api/mlb/injuries?teamIds=away,home` and `GET /api/mlb/recent?teamA=away&teamB=home&days=45`; and a second independent `useBullpen(awayTeamId, homeTeamId)` call (distinct instance from Team Detail's). Selecting a candidate row does `router.replace` to set `?player=&market=` — pure client navigation, no fetch, since `GameDetail` derives the selection from already-loaded `candidates`. If a player is selected, `GameDetail` mounts a **second, nested `PlayerDetail` instance inline** (`GameDetail.tsx:1692`), which independently re-fires `usePropOdds`, `useMarketCalibration`, `useLiveGame`, `useTeamStatcast` scoped to that game — i.e., viewing a player from inside Game Detail runs `usePropOdds` and `useMarketCalibration` **twice** (once from `GameDetail` itself at line 1645/1661, once from the nested `PlayerDetail`).

**NFL pages** mirror the MLB shape through the same `AppShell`/`useSnapshot` foundation:
- `/nfl` → `AppShell sport="nfl"` (`app/nfl/page.tsx:1-10`), identical hook set to MLB Scan (`useSnapshot('nfl')`, `useGameLines('nfl', ...)`, `useSlatePropOdds(...)`, `useMarketCalibration()`; `useGamePickHistory` is mounted the same way).
- `/nfl/teams`, `/nfl/team/[teamId]` → `NflTeamDetailPanel` (`components/NflTeamDetailPanel.tsx:19`) → `useAllNflTeams()` (`components/useAllNflTeams.ts:13-38`, mount-only) → `GET /api/nfl/teams` → `app/api/nfl/teams/route.ts:9-32`: `getStandings()` (`lib/sports/nfl/espn.ts`) directly, no snapshot-cache involvement.
- `/nfl/team/[teamId]` detail data: `components/NflTeamDetail.tsx:136-150`, `useEffect` keyed `[teamId]` → `GET /api/nfl/team/${teamId}` → `app/api/nfl/team/[teamId]/route.ts:27-108`: `getStandings()` (line 31) then `Promise.all` of 8 functions (lines 37-46: `fetchTeamRoster`, `getTeamRecentResults`, `getNflverseTeamStatsWithRank`, `getNflverseSchedule`, `getPlayerSeasonStatsByGsis`, `getEspnToGsisMap`, `getAllTeamGrades`, `getNflPlayerRankings`).
- `/nfl/game/[gameId]` → `NflGameDetail.tsx:199-222`: first `GET /api/nfl/game/${gameId}` (`app/api/nfl/game/[gameId]/route.ts:21-56`: `fetchScoreboard` then `Promise.all` of `getLeagueInjuries()`, `getNflLiveGameState(gameId)`, `getSportsGameOddsGameLine(...)`, lines 25-40), **then, only after that resolves**, `Promise.all` of two more calls to `GET /api/nfl/team/${homeTeamId}` and `GET /api/nfl/team/${awayTeamId}` (`NflGameDetail.tsx:210-214`) — an explicit two-stage waterfall documented in the route's own comment (`app/api/nfl/game/[gameId]/route.ts:9-20`): "`NflGameDetail` calls this first to resolve team ids, then calls the existing team route twice rather than duplicating its logic here."

**Golf pages:**
- `/golf` → `AppShell sport="golf"` (`app/golf/page.tsx:1-10`). `useSnapshot('golf')` (§1.4) plus `useGolfLines(snapshot?.fetchedAt, sport==='golf')` (`AppShell.tsx:139`) → `GET /api/golf/lines` → `app/api/golf/lines/route.ts:29-44`: reads subjects via a locally-defined `readGolfSubjects()` helper that reads `snapshot_cache['golf:snapshot']` directly (lines 18-27 — a separate cache read from the live `/api/golf` response the page already has), then `getGolfTournamentLines(subjects, force)`. `hasPropsPipeline` is `false` for golf (`AppShell.tsx:132`), so `useSlatePropOdds` never fires for this sport.
- `/golf/schedule` → four independent hooks in parallel: `useSnapshot('golf')`, `useGolfSchedule()` (`components/useGolfSchedule.ts:19-41` → `GET /api/golf/schedule` → `app/api/golf/schedule/route.ts:6-21`: `getSeasonSchedule(year)`, no server cache visible in this route), `useGolfLines(...)`, and `useGolfFieldStats(snapshot?.fetchedAt)` (`components/useGolfFieldStats.ts:23-44`, gated to wait for the snapshot's first `fetchedAt` before firing → `GET /api/golf/field-stats` → `app/api/golf/field-stats/route.ts:29-45`: reads subjects via the same `readGolfSubjects()` pattern, then `getSeasonStrokesGained(subjects)`).
- `/golf/player/[playerId]` → `useSnapshot('golf')` + `useGolfPlayerStats(playerId)` (`components/useGolfPlayerStats.ts:26-52`, `useEffect` keyed `[espnId]`) → `GET /api/golf/player/${playerId}` → `app/api/golf/player/[playerId]/route.ts:28-50`: reads subjects via a third copy of the same `readGolfSubjects()` helper, then `Promise.all` of `getGolferStrokesGained`, `getPlayerSeasonLog`, `getGolferAdvancedStats` (lines 33-37).
- `app/api/golf/predictions/route.ts` exists (a fourth near-identical copy of the subjects-reading helper, `readGolfSnapshot()`, lines 27-35) but a repo-wide search found **no caller** in any page or hook — it is unreferenced dead code from the client's perspective.

**Diagnostics (`app/diagnostics/page.tsx`, 2756 lines):** on mount, 11 fetches fire in parallel from a single `useEffect` (lines 1350-1374): `GET /api/diagnostics`, `GET /api/props/diagnostics`, `GET /api/props/calibration` (three times, with different `scope`/`dimension` query params), `GET /api/props/model-versions?sport=mlb`, `GET /api/props/drift-check?sport=mlb`, `GET /api/props/elo-sanity`, `GET /api/props/system-health`, `GET /api/picks/game-history?sport=mlb`. Pitcher/Batter-rank panels (`GET /api/diagnostics/pitcher-ranks`, `GET /api/diagnostics/batter-ranks`) are **click-triggered only** — not in the mount effect (lines 1219-1265, wired to `onClick` at lines 1522/1581). A "Rescan now" button re-runs the same 11 mount fetches (`handleForceRefresh`, lines 1376-1389). Several POST actions exist purely as manual buttons, never auto-run: `POST /api/props/evaluate-total-baselines` (comment at lines 1201-1203 explicitly warns this is "~90s, ~480 external bullpen-ERA calls" and "must never end up on the mount effect or the force-refresh handler"), `POST /api/props/backfill`, `POST /api/props/game-backfill`, `POST /api/props/game-total-backfill`.

**Bets (`app/bets/page.tsx`) and Bet Detail (`app/bet/[betId]/page.tsx`):**
- `/bets`: mount `useEffect` (line 135) + `setInterval(load, 30_000)` (30s poll, line 137) → `GET /api/bets?sport=mlb` → `app/api/bets/route.ts` `GET` (lines 8-12): `await gradeOpenBets()` (`lib/odds/props/betGrading.ts:110-147`, see §3) **runs on every single load/poll**, then `listBets(sport)` (DB read). Each visible open bet row independently mounts `useLiveGame` (`components/LiveProgress`, `app/bets/page.tsx:83-117`), polling `GET /api/mlb/game/${gamePk}/live` every 15s **per row**.
- `/bet/[betId]`: mount + `setInterval(load, 20_000)` (20s poll) → `GET /api/bets/${betId}` → same `gradeOpenBets()` + `getBet(id)` pattern; plus its own `useLiveGame` (15s, disabled once settled).

**Picks/Slip (`components/useSlip.ts`):** loads `GET /api/picks?sport=` and `GET /api/watchlist?sport=` once on mount (lines 44-57), **no polling** — refreshed only after a write. Writes are all user-click-triggered and synchronously awaited: Add (`POST /api/picks`), Remove (`DELETE /api/picks?id=`), Clear (`DELETE /api/picks?all=1&sport=`), Set odds (`PATCH /api/picks`), Toggle watchlist (`POST`/`DELETE /api/watchlist`), Submit to Live Bets (`POST /api/bets { ids }` → `submitPicksAsBets()`, a DB transaction that inserts into `bets` and deletes from `picks` atomically, `lib/db/client.ts:384-412`) — submit closes the slip modal and does `router.push('/bets')`.

---

## 2. External API calls

| Provider | Base endpoint | File | Called during a live request? | Parallel/sequential | Cache in front | Retry |
|---|---|---|---|---|---|---|
| MLB Stats API | `statsapi.mlb.com/api` | `lib/sports/mlb/statsapi.ts:9` | Both — directly from several narrow routes (`team-form`, `teams`, `injuries`, `bullpen`, `recent`, `player-gamelog`, `team/[teamId]`) **and** via `getMlbSnapshot` on a cold/stale `/api/mlb` cache; also `lib/scheduler.ts` every 4 min | Hybrid: `getMlbSnapshot` runs sequential stages, each internally parallel — `Promise.all([rangeGames, recentLineupGames])` (adapter.ts:1742), `Promise.all([teamHitting, teamPitching, standings, leaguePitcherStats])` (1774), `Promise.all(liveGames.map(getLiveFeed))` (1909), `Promise.all(...weather per game...)` (1918-1933), `Promise.all([batters, pitchers])` (1968) | In-process stale-while-revalidate `Map` (statsapi.ts:16-20, 91-103); TTLs per endpoint: slate 60s, scheduleRange 30min, recentLineups 15min, gamelogs 10min, team season stats 1h, league pitcher/batter rows 1h, bullpen ERA 1h, standings 30min, injuries/roster 1h, all-teams 12h, team-info 12h, active-roster 1h, people-season-stats 1h, handedness 6h. `getLiveFeed` deliberately uncached (lines 226-227) | Retries once on null (`retries=1`, no backoff, lines 64-77); 30s timeout on `getJson` (line 42) |
| Baseball Savant | `baseballsavant.mlb.com/statcast_search/csv` | `lib/sports/mlb/savant.ts:20` | Only from `app/api/diagnostics/pitcher-ranks/route.ts:20` and `.../batter-ranks/route.ts:20` (diagnostics-only). The live snapshot path uses `getCachedStatcastPitcherRates`, explicitly cache-only, never triggers a network fetch (adapter.ts:72-75) | Bounded concurrency: `mapLimit(chunks, 5, ...)` (savant.ts:227, 293-295) | SQLite-backed (`mlb:statcast-agg:{season}:v2`), incremental via a last-ingested-date cursor, no fixed TTL | None; 60s timeout per chunk |
| ESPN (NFL) | `site.api.espn.com/apis/site/v2/sports/football/nfl` (+ a separate `/apis/v2/...` path for standings, and `site.web.api.espn.com` for injuries) | `lib/sports/nfl/espn.ts:16,88,128` | Directly, via `app/api/nfl/game/[gameId]/route.ts:32` (`Promise.all`) and via `buildNflSnapshot` on cold/stale `/api/nfl` | One leg of a 3-way `Promise.all` at the game-detail call site | SQLite-backed `cachedJson`, 30-min TTL for both standings and injuries | None; 10s timeout, falls back to stale cache or null |
| nflverse (GitHub Releases CSVs) | `github.com/nflverse/nflverse-data/releases/download` | `lib/sports/nfl/nflverse.ts:27` | Via `buildNflSnapshot` (`/api/nfl`) and directly from `app/api/nfl/team/[teamId]/route.ts` | `Promise.all([fetchNflverseCsv, getPointsPerGame])` for team stats (lines 493-496) | SQLite-backed per dataset: schedule 6h, player crosswalk 24h + in-process `Map`, weekly stats 24h + `Map`, player season stats 24h + `Map`, team stats 24h, team-week/defense 24h | None; 15s timeout — comment (lines 94-98) notes this exists because a hung GitHub Releases connection previously blocked every concurrent NFL request via the dedup guard |
| Golf ESPN | `site.api.espn.com/.../golf/leaderboard`, `/golf/pga/scoreboard`, `site.web.api.espn.com/.../golf/athletes/{id}/stats` | `lib/sports/golf/espn.ts:16-19` | Via `getGolfSnapshot()` on a stale/cold `/api/golf` request — **request-blocking, no background-refresh wrapper** (see §1.4) | `Promise.all([leaderboard, scoreboard])` internally (lines 175-178), but the outer adapter chain (ESPN → weather → PGA Tour stats) is sequential, not parallel with itself | None in this file — every call is live (`cache: 'no-store'`) | None; 12s timeout, returns null on failure |
| PGA Tour Stats (unofficial HTML scrape) | `pgatour.com/stats/detail/{statId}` | `lib/sports/golf/pgatourStats.ts:70` | Via the golf adapter chain, and directly from `app/api/golf/player/[playerId]/route.ts:34`, `.../field-stats/route.ts:32`, `.../predictions/route.ts:48` | `getGolferAdvancedStats` parallelizes ~19 stat-page fetches via `Promise.all` (lines 322-349); `getSeasonStrokesGained` is one sequential fetch | Disk-backed, 24h TTL per stat page; serves stale on a failed live fetch if present | None, and **no fetch timeout at all** on this call (lines 70-73) — the only provider in the codebase without one |
| Open-Meteo (weather) | `geocoding-api.open-meteo.com/v1/search`, `api.open-meteo.com/v1/forecast` | `lib/weather/openMeteo.ts:11-12` | Golf: inside the same request-blocking `/api/golf` chain. MLB: per-venue inside `Promise.all` at `adapter.ts:1918-1933`, part of the snapshot build | MLB fetches weather for every slate game concurrently; golf fetches it as one sequential `await` after course-coord resolution, not parallel with the ESPN/PGA calls around it | In-process `Map` only, **not persisted to disk** — resets on every server restart. Geocode 24h TTL, forecast 20-min TTL, keyed by coordinates rounded to 2 decimals | None; 8s timeout, returns null on failure |
| SharpAPI | `api.sharpapi.io/api/v1` | `lib/odds/props/providers/sharpapi.ts:24` | Tier 1 (scan-player click, and `tier1RefreshScheduler` every 2.5 min); game-lines variant directly from `app/api/odds/lines/route.ts:384` for `?sport=nfl` | `Promise.all([getSharpApiGameLines('nfl'), getRundownGameLines('nfl', today)])` at the NFL game-lines call site (`nflGameLines.ts:59-62`); sequential per-game inside the Tier 1 refresh loop | `propsBoardCache`/`gameLinesBoardCache` Maps, 90s TTL each; `nflGameLines.ts` additionally caches its merged result for 60s | None; `FETCH_TIMEOUT_MS = 8_000` via `AbortSignal.timeout`; serves stale cache past TTL on timeout rather than retrying |
| Odds-API.io | `api.odds-api.io/v3` | `lib/odds/props/providers/oddsApiIo.ts:20` | Tier 1 (same paths as SharpAPI) | Tier 1 loop is always sequential — `for (const game of games) { for (const provider of providers) { await runProviderFetch(...) } }` (`tier1Refresh.ts:62-97`), never `Promise.all` | In-memory `eventsCache`, 5-min TTL; the odds call itself is never cached | None |
| SportsGameOdds | `api.sportsgameodds.com/v2` | `lib/odds/props/providers/sportsGameOdds.ts:22` | `fetchGameProps` via "More Books" click (5-min per-game cooldown) and a 90-min scheduled job; `getSportsGameOddsGameLine` directly from `app/api/nfl/game/[gameId]/route.ts:34` (`Promise.all`) | Parallel at the NFL game-detail call site; sequential per-game in the scheduled refresh | **None** — every call is live (`cache: 'no-store'`); budget/cooldown gating substitutes for a TTL cache | None |
| ParlayAPI | `parlay-api.com/v1` | `lib/odds/props/providers/parlayApi.ts:27` | MLB key via Tier 1 paths; general key via `refreshNfl()`/`refreshCfb()` (3h scheduled) and `POST /api/props/multi-sport-refresh` (manual) | Sequential per game (`multiSportRefresh.ts:52-58`) | `boardCache` Map, 90s TTL, one whole-sport board per call regardless of games touched | None |
| Propline | `api.prop-line.com/v1` | `lib/odds/props/providers/propline.ts:28` | MLB key via Tier 1 paths; second key via `refreshSoccerEpl()` (45-min scheduled) and manual multi-sport-refresh | Sequential per event: events (cached) → markets discovery → odds fetch, all `await`ed in order | `eventsCache` Map, 5-min TTL; markets-discovery and odds calls uncached (2 live requests per event per refresh) | None |
| OddsPapi | `api.oddspapi.io` | `lib/odds/props/providers/oddsPapi.ts:43` | `fetchSharpPrice`/`fetchLineHistory` directly from `app/api/props/sharp-price/route.ts:53` and `.../line-history/route.ts:45` (user-click), gated by a 15-min per-game cooldown + monthly budget. `fetchGameProps` is a hardcoded no-op | Sequential: cached fixture lookup → `await` odds fetch → `await` markets catalog | `fixturesCache` 10-min TTL; `marketsCache` no TTL (loaded once); odds/historical-odds fetches uncached | None |
| The Odds API (game lines) | `api.the-odds-api.com/v4` | `lib/odds/oddsApi.ts:20` | Directly from `app/api/odds/lines/route.ts:399` for `?sport=mlb` (default) | Parallel with a local file read (`Promise.all`, lines 398-402) | SQLite-backed (`odds_cache` table), TTL = `ODDS_API_TTL_MINUTES` env or 360 min (6h) default; `DEFAULT_RESERVE = 25` credits stops auto-refresh once remaining credits are low | None; serves stale cache on failure |
| The Odds API (props adapter) | n/a | `lib/odds/props/providers/theOddsApi.ts:35-45` | Registered but `fetchGameProps` is a permanent no-op — never makes a network call | n/a | n/a | n/a |
| TheRundown | `therundown.io/api/v2` | `lib/odds/rundown.ts:17` | Directly from `app/api/odds/lines/route.ts:384` (NFL game lines), parallel with SharpAPI | Parallel with SharpAPI at the call site | None directly in this file (the 60s wrapper in `nflGameLines.ts` covers the merged result); a module-level rate limiter enforces `MIN_INTERVAL_MS = 1100` ms between calls (`throttledFetch`, lines 34-49) — can add up to ~1.1s of in-request wait | None; 8s timeout, returns empty with a warning on failure |
| OddsHarvester (local file, not a network call) | n/a — reads `data/{sport}_{mode}.json` | `lib/odds/oddsHarvester.ts:16,149` | Read synchronously inside `app/api/odds/lines/route.ts:401`, in parallel with the Odds API call | n/a | n/a (it's a file read) | n/a |

**Shared infrastructure:**
- `lib/staleCache.ts:22` — a single in-process `Map<string, Promise<unknown>>` (`inFlight`) backs both `triggerBackgroundRebuild()` and `awaitRebuild()`, ensuring only one rebuild per cache key runs at a time within the same Node process. Used by MLB, NFL, and the calibration job. **Golf's route does not use this module** (§1.4).
- `lib/odds/props/budget.ts` — `dailyStatus`/`recordDailySpend` and `monthlyStatus`/`recordMonthlySpend`, persisted in the `provider_usage` SQLite table (lines 53-75); `withinPerMinuteRate` is an in-process, non-persisted token bucket (lines 78-90).
- `lib/odds/props/registry.ts:61-104` — `runProviderFetch`, the single choke point every props-pipeline provider call goes through; wraps each in try/catch so one provider throwing doesn't abort the others in a sequential loop, but its own latency still accrues before failing.
- The Tier 1 refresh loop (SharpAPI, Odds-API.io, and tier1-registered ParlayAPI/Propline instances) is **always sequential**, per game then per provider (`lib/odds/props/tier1Refresh.ts:62-99`), never `Promise.all`. `triggerFreshen()` (`lib/odds/props/tier1RefreshScheduler.ts:20-41`) makes this non-blocking for every caller after the first in a process's lifetime.

---

## 3. Database reads

### 3.1 Driver, connection, location

- `lib/db/client.ts:8-9` — `better-sqlite3`, a synchronous native Node binding, local-file-only (no network/remote mode).
- `lib/db/client.ts:12-13` — `DB_PATH = process.env.LINESMITH_DB ?? path.join(process.cwd(), 'data', 'linebuddy.db')`.
- `lib/db/client.ts:15-18, 156-159` — a singleton connection cached on `global.__linesmithDb` across hot reloads.
- `lib/db/client.ts:131-143` — on every `connect()`: `db.pragma('journal_mode = WAL')` and `db.pragma('busy_timeout = 5000')`. The comment directly above (lines 134-141) states this was added after observed `SQLITE_BUSY` "database is locked" errors from concurrent background jobs and foreground routes hitting the same file; WAL lets readers proceed while a writer is active, and the busy-timeout makes a genuine collision retry for up to 5s instead of failing instantly.
- On disk (measured 2026-08-17): `data/linebuddy.db` = 709,455,872 bytes (≈709 MB); `data/linebuddy.db-wal` = 992,067,192 bytes (≈992 MB, currently larger than the main DB file); `data/linebuddy.db-shm` = 131,072 bytes.
- `lib/db/jsonPassthrough.ts:1-18` — returns an already-serialized JSON string from `snapshot_cache` directly as the response body without `JSON.parse`/re-`JSON.stringify`, because the comment states this round-trip "costs seconds of CPU per request" on large payloads.

### 3.2 Schema (verbatim, `lib/db/schema.ts`)

PRAGMAs at load: `journal_mode = WAL`, `foreign_keys = ON` (schema.ts:8-9).

| Table | Key columns | Unique constraint | Indexes |
|---|---|---|---|
| `picks` (13-54) | sport, subject_id, subject_name, dimension, category, line, game_id, team_id, team, opponent_id, opponent, american_odds, odds_source, bookmaker, event_context, sample_size, created_at | (sport, subject_id, dimension, category) | `idx_picks_sport (sport)` |
| `bets` (66-90) | same lead columns as `picks` + submitted_at, status, actual_value, settled_at | — | `idx_bets_sport (sport, submitted_at DESC)`; `idx_bets_open_by_game (game_id) WHERE status IN ('pending','live')` (partial) |
| `watchlist` (95-102) | sport, subject_id, subject_name, created_at | (sport, subject_id) | `idx_watchlist_sport (sport)` |
| `pick_history` (111-151) | sport, subject_id, dimension, category, market_key, line, game_id, sample_size, distance, event_context, surfaced_at, model_prob, market_prob, edge, price fields, outcome, actual_value, graded_at, prop_score, score_grade, trust_tier, model_version | (sport, subject_id, dimension, category, game_id) | `idx_pick_history_subject (sport, subject_id)`; `idx_pick_history_ungraded (game_id) WHERE outcome IS NULL` (partial) |
| `odds_cache` (158-164) | cache_key (PK), payload, fetched_at, requests_remaining, requests_used | PK only | none |
| `snapshot_cache` (168-172) | cache_key (PK), payload, fetched_at | PK only | none |
| `watch_links` (175-180) | id, label, url, created_at | — | none |
| `prop_odds` (192-208) | provider_id, game_id, subject_id, subject_name, market_key, line, side, bookmaker, american_odds, decimal_odds, fetched_at, is_delayed, delay_seconds | (provider_id, game_id, subject_id, market_key, line, side, bookmaker) | `idx_prop_odds_game (game_id)`; `idx_prop_odds_subject (game_id, subject_id, market_key)`; `idx_prop_odds_provider_game (provider_id, game_id)` |
| `prop_odds_history` (221-235) | same shape minus subject_name, plus observed_at | none (append-only) | `idx_prop_odds_history_lookup (game_id, subject_id, market_key, line, side, bookmaker, observed_at)` |
| `game_odds_history` (244-253) | event_id, market, side, bookmaker, american_odds, point, observed_at | — | `idx_game_odds_history_lookup (event_id, market, side, bookmaker, observed_at)` |
| `provider_usage` (262-270) | provider_id, period_kind, period_key, request_count, object_count, updated_at | PK (provider_id, period_kind, period_key) | — |
| `odds_unresolved` (276-283) | provider_id, kind, raw_value, context, seen_at | — | `idx_odds_unresolved_provider (provider_id)` |
| `game_picks` (300-372) | sport, game_id, home/away team fields, ml_initial_*/ml_final_*/total_initial_*/total_final_* pairs, final scores, ml_outcome, total_outcome, graded_at, feature-json blobs | (sport, game_id) | `idx_game_picks_sport (sport, commence_time)`; `idx_game_picks_ungraded (sport) WHERE graded_at IS NULL` (partial) |
| `park_factors` (381-389) | venue_id, season, venue_name, factor, games, computed_at | PK (venue_id, season) | — |
| `team_hr_rate_allowed` (399-407) | team_id, season, games_faced, games_with_hr_allowed, league_hr_rate, computed_at | PK (team_id, season) | — |
| `game_sim_cache` (418-427) | sport, game_id, home_win_prob, expected_total, n, lineup_source, computed_at | PK (sport, game_id) | — |
| `team_elo_history` (435-448) | team_id, season, game_pk, game_date, elo, games_played, opponent_team_id, was_home | (team_id, season, game_pk) | `idx_team_elo_lookup (team_id, season, game_date)` |
| `pitcher_game_score_history` (455-464) | pitcher_id, team_id, season, game_pk, game_date, game_score | (pitcher_id, game_pk) | `idx_pitcher_game_score_lookup (pitcher_id, game_date)`; `idx_pitcher_game_score_team (team_id, season, game_date)` |
| `model_weights` (476-507) | sport, market, version, feature_names, weights_json, intercept, train/holdout stats, active, fitted_at | (sport, market, version) | `idx_model_weights_lookup (sport, market, active)` |
| `historical_odds` (520-546) | season, game_date, home/away team ids, scores, consensus/open ML and total probabilities, source, book_count | (season, game_date, home_team_id, away_team_id) | `idx_historical_odds_lookup (season, game_date, home_team_id, away_team_id)` |
| `system_events` (555-562) | level, source, message, detail, occurred_at | — | `idx_system_events_recent (occurred_at DESC)` |
| `golf_tournaments` (582-591) | event_id (PK), name, course_name, season, start_date, holes_json, field_size, updated_at | PK only | — |
| `golf_hole_scores` (597-609) | event_id, espn_id, round, hole, par, strokes, relative_to_par, category, ingested_at | (event_id, espn_id, round, hole) | `idx_golf_hole_scores_lookup (espn_id, hole, event_id)`; `idx_golf_hole_scores_event (event_id, round, hole)` |
| `golf_round_scores` (616-629) | event_id, espn_id, round, total_strokes, relative_to_par, tee_wave, wind_mph, temp_f, precip_prob, ingested_at | (event_id, espn_id, round) | `idx_golf_round_scores_lookup (espn_id, event_id)` |
| `golf_tournament_results` (637-645) | event_id, espn_id, position, made_cut, total_score, finished_at | PK (event_id, espn_id) | — |
| `golf_model_predictions` (657-672) | event_id, espn_id, dimension, round, category, predicted_prob, league_rate, predicted_at, graded_at, actual_category, hit, brier_component | (event_id, espn_id, dimension, round) | `idx_golf_model_predictions_ungraded (event_id) WHERE graded_at IS NULL` (partial) |
| `golf_tournament_predictions` (679-698) | event_id, espn_id, prob_win, prob_top5, prob_top10, prob_made_cut, predicted_at, graded_at, actual_* fields, brier_* fields | (event_id, espn_id) | — |

`pick_history` (per `lib/db/client.ts:67-71` comment, holds 300k+ real graded rows) has no index covering `(sport, outcome, model_prob)` or `(sport, dimension)`; calibration read functions (`calibrationCounts`, `calibrationBuckets`, `calibrationByMarket`, `liveMarketSkill`, `scoreRecord`, `leagueBaseRates`, `overallBrierScore`, `goodBetsRecord` — `lib/db/client.ts:1078-1364`) filter on `sport` plus `model_prob IS NOT NULL AND outcome IS NOT NULL` and other predicates; only the existing `idx_pick_history_subject (sport, subject_id)` index's `sport` prefix column is usable by these queries against the 300k+-row table.

### 3.3 DB read + external API in the same request handler

- `app/api/bets/route.ts:8-12` (`GET`): `await gradeOpenBets()` (`lib/odds/props/betGrading.ts:110-147`) — `listOpenBetGameIds()` DB read, then per open game inside a `for` loop: `await getLiveFeed(gamePk)` (external MLB fetch) → `markBetsLive`/`listOpenBetsForGame` DB read/write → `writeBetGrades` DB write — then `listBets(sport)` DB read for the response. Same pattern in `app/api/bets/[betId]/route.ts:13-14`.
- `app/api/odds/lines/route.ts:374-474` (`GET`): `getMlbGameLines(force)` (external, the-odds-api.com) parallel with a local file read (lines 398-402); then, in the same handler: `logGameOddsHistory` (DB write), `logTotalPredictionsFromLines` (DB read + write), `runTotalLockFromLines` (DB reads/writes plus, per-line inside its loop, `await Promise.all([getTeamBullpenEra(home), getTeamBullpenEra(away)])` — external fetches), `runMoneylineLockFromSnapshot` (DB reads), `attachPricesFromLines` (DB reads/writes) — roughly a dozen distinct DB call sites plus N external bullpen-ERA fetches in one request.
- `app/api/mlb/route.ts` cold-start/background-rebuild path: `rebuildMlbSnapshot` → `getMlbSnapshot` (external calls) → `gradeFinishedGames()` (`lib/odds/props/grading.ts:166-200`): `listUngradedGameIds()` DB read, then per game inside a loop, `await getLiveFeed(gamePk)` (external) + `listUngradedForGame` DB read + per-row `readPropOddsHistoryForKey` DB read + `writeGrades` DB write.
- `app/api/props/more-books/route.ts:19-60` (`POST`): `lastPropFetch` DB read → `loadGameContext` DB read (via `readSnapshotCache`) → `runProviderFetch('sportsgameodds', game)` external fetch → `readPropOddsForGame` DB read.
- `app/api/props/sharp-price/route.ts` and `app/api/props/line-history/route.ts`: both do `loadGameContext` DB read → external fetch (`fetchSharpPrice`/`fetchLineHistory`) in the same handler.
- `app/api/props/scan-player/route.ts:22-29` (`POST`): `refreshTier1(gameId)` (external fetch chain) then `readPropOddsForGame(gameId)` DB read.

### 3.4 N+1 query / fetch patterns (a loop issuing one query or fetch per iteration instead of a single batched call)

- **`lib/sports/mlb/adapter.ts:2254-2298`**, inside `games.map(...)`: for each game, `getCurrentElo(homeTeamId, season)` and `getCurrentElo(awayTeamId, season)` (each 1-2 `db.prepare().get()` calls against `team_elo_history`), then `restAndTravelFor(...)` for both teams (which redundantly re-calls `getCurrentElo` a second time internally, `lib/sports/mlb/eloModel.ts:445-451`), then `pitcherAdjustment(...)` for both starters (2 more queries each against `pitcher_game_score_history`, `eloModel.ts:195-203`). Net roughly 4 `getCurrentElo`-class calls plus 2 `pitcherAdjustment` calls (≈8-12 SQL statements) per game, per snapshot build, rather than one batched pre-load before the loop.
- **`app/api/props/lines/route.ts:43-44`**: `const games = loadAllGameContexts(); const rows = games.flatMap((g) => readPropOddsForGame(g.gameId));` — one `SELECT ... WHERE game_id = ?` query per game on every call to this route without a `gameId`/`subjectId` filter.
- **`lib/odds/props/pickHistoryLog.ts:117-118`**: `[...gameIds].flatMap((gameId) => readPropOddsForGame(gameId))` — same one-query-per-game pattern, invoked on every MLB snapshot rebuild via `logSnapshotCandidates` (`lib/sports/mlb/snapshotRebuild.ts:68`).
- **`app/api/odds/lines/route.ts`**, several loops: `runTotalLockFromLines` (`for (const line of lines)`, line 130) calls `getEarliestObservedTotalPoint(line.eventId)` (DB, line 161) and, when a fitted model is active, `await Promise.all([getTeamBullpenEra(home), getTeamBullpenEra(away)])` (external, lines 165-168) plus `loadGameSim(game.gamePk)` (DB, line 175) — all per line, inside the loop. `runMoneylineLockFromSnapshot` (`for (const g of games)`, line 254) calls `loadGameSim(g.gamePk)` per game (line 300). `attachPricesFromLines` (`for (const line of lines)`, line 353) calls `getGamePick('mlb', gameId)` per line (line 359) followed by up to 4 DB writes per line. Additionally, four separate functions in this same file (`logTotalPredictionsFromLines:66`, `runTotalLockFromLines:103`, `runMoneylineLockFromSnapshot:215`, `attachPricesFromLines:342`) each independently call `readSnapshotCache('mlb:snapshot')` and `JSON.parse` the payload — the same cached snapshot blob is read from SQLite and parsed 4 separate times within one request to `/api/odds/lines`.

---

## 4. Background jobs / scheduled updates

### 4.1 Trigger mechanism

A repo-wide search (excluding `node_modules`, `.next`) for `setInterval`, `cron`, `node-cron`, `Vercel Cron`, `vercel.json` found exactly one mechanism: **`lib/scheduler.ts`**, which registers 7 `setInterval` calls (lines 143-149). No `vercel.json`/`netlify.toml`/`Procfile`/`railway.json`/`fly.toml` exists anywhere in the repo. `node-cron` is not a `package.json` dependency.

- `ensureSchedulerStarted()` (`lib/scheduler.ts:129-150`) is called as a **module-level side effect** in two route files — `app/api/mlb/route.ts:17` and `app/api/nfl/route.ts:11` — not inside any request handler. A module-level `started` boolean (line 60) makes it idempotent; only the first call (from whichever route module loads first) actually registers the intervals.
- On start, every job fires once immediately (lines 136-142), then is re-registered on its own `setInterval` (lines 143-149) — genuine long-running-process timers, not per-request or per-deploy triggers. Under `next start`, Next loads every route module before serving the first request, so this starts at boot (comment, lines 16-19); under `next dev`, it starts on whichever request happens to load the route module first.

### 4.2 Jobs, cadence, and writes

| Job | Interval | Function | Writes to |
|---|---|---|---|
| `refreshMlb` | 4 min (`MLB_INTERVAL_MS`, line 35) | `rebuildMlbSnapshot()` via `awaitRebuild(TODAY_CACHE_KEY, ...)` | `snapshot_cache` (key `mlb:snapshot`); when `isToday`, also `pick_history`, `game_picks`, `team_elo_history`, `pitcher_game_score_history` via inline grading/Elo/pitcher-game-score side effects in `rebuildMlbSnapshot` |
| `refreshTier1` | 2.5 min (`TIER1_INTERVAL_MS`, line 36) | `triggerFreshen()` → SharpAPI + Odds-API.io | `prop_odds`, `prop_odds_history`, `provider_usage` |
| `refreshSportsGameOddsJob` | 90 min (`SPORTSGAMEODDS_INTERVAL_MS`, line 43) | `refreshSportsGameOdds()` | `prop_odds`, `prop_odds_history`, `provider_usage` |
| `refreshNflJob` | 3 hr (`MULTI_SPORT_TEAM_INTERVAL_MS`, line 53) | `refreshNfl()` → ParlayAPI + SportsGameOdds in parallel | same tables |
| `refreshCfbJob` | 3 hr (same constant) | `refreshCfb()` | same tables |
| `refreshSoccerEplJob` | 45 min (`SOCCER_EPL_INTERVAL_MS`, line 56) | `refreshSoccerEpl()` → Propline (second key) | same tables |
| `refreshCalibration` | 2 min (`CALIBRATION_INTERVAL_MS`, line 37) | `computeCalibrationPayload()` for scopes `['all','player','game']` | `snapshot_cache`, keys from `calibrationCacheKey(scope, null)` |

Tennis is explicitly not scheduled here (`multiSportRefresh.ts:125` comment: SharpAPI is already the proven primary for it).

A manual/on-demand trigger also exists, separate from the scheduler: `POST /api/props/multi-sport-refresh { sport }` (`app/api/props/multi-sport-refresh/route.ts:20-33`) calls `refreshNfl()`/`refreshCfb()`/`refreshSoccerEpl()` directly. Nothing in the repo calls this route automatically.

`app/api/mlb/refresh-hr-matchup/route.ts` is a `POST` route not called from any page or hook found in this codebase; its own doc comment (lines 7-9) states it's "meant to be run periodically (e.g. once a day)" — implying an external trigger (cron, manual) outside anything configured in this repo.

`lib/sports/mlb/gameSimCache.ts` is **not** independently scheduled — its header comment (lines 1-19) states scheduling "deliberately piggybacks on `getMlbSnapshot`'s own ~5-minute rebuild cadence rather than a new clock-based schedule," and it writes to `game_sim_cache` sequentially, not in parallel, "since the simulation itself is CPU-bound synchronous work" (lines 63-67).

`lib/sports/mlb/historyTrim.ts` is not a scheduled job — it is a pure in-memory transform (`dedupeHistoryForList()`, lines 64-86) called during `rebuildMlbSnapshot` (`snapshotRebuild.ts:53`), with no I/O and no timer of its own.

`lib/odds/gameOddsLog.ts` is not scheduled by `lib/scheduler.ts` either — its header comment (lines 1-6) states it is "called from `/api/odds/lines` on every request," writing to `game_odds_history` via `writeGameOddsHistory()` on every live request to that route, not on a timer.

### 4.3 Concurrency between background jobs and live requests

- **In-process dedup guard** (`lib/staleCache.ts:22`, described in §2) prevents two rebuilds for the *same cache key string* from running concurrently within the same Node process. It does nothing across different cache keys, or across two different processes.
- **SQLite-level:** `journal_mode = WAL` and `busy_timeout = 5000` (`lib/db/client.ts:142-143`), added — per the code comment directly above (lines 134-141) — specifically in response to observed `SQLITE_BUSY` "database is locked" errors from "proactive background refresh jobs now running across five sports plus every foreground API route reading/writing the same file."
- **Transactions:** Several multi-row writes use `db.transaction()` (better-sqlite3's built-in wrapper) — e.g. `writePropOdds` (`lib/db/client.ts:638-684`), `writeGameOddsHistory` (696-719), `submitPicksAsBets` (384-412), `writeBetGrades` (452-465), `replaceUnresolvedForProvider` (825-838), `logSurfaced` (883-923), `writeBackfill` (1026-1045). These are standard atomic SQLite transactions, not an application-level mutex.
- **No table-level or row-level application lock exists** anywhere in `lib/db/client.ts`, `lib/scheduler.ts`, or `lib/staleCache.ts` — concurrency between a scheduler tick and a live request touching the same key is handled only by the two mechanisms above.
- `lib/odds/props/tier2Cooldown.ts:13` is a purely in-process `Map<string, number>`, not persisted — its own comment (lines 8-11) states "a dev-server restart resetting a 15-minute cooldown early is a minor inconvenience, not a budget risk."

---

## 5. Timing data (measured, 2026-08-17, local dev server via `npm run dev`, `next dev -H 0.0.0.0 -p 3000`)

Timing was captured with `performance.now()` around `fetch()` calls issued directly from the browser console against the running local server (`http://localhost:3000`), covering representative endpoints across all three sports plus the props/diagnostics pipeline (no single page had been reported as uniquely "timing out" — the full endpoint set was profiled rather than any preselected subset). Each figure is a single measured wall-clock round trip, not an average or an estimate. `x-cache`/`x-elapsed-ms` response headers are reported where the route sets them.

| Endpoint | Elapsed (ms) | Response size | Cache state (from `x-cache` header, where present) | Note |
|---|---:|---:|---|---|
| `GET /api/mlb` | 2,090 | 17,407,392 bytes (~17.4 MB) | `hit` | |
| `GET /api/nfl` | 2,089 | 6,874,602 bytes (~6.9 MB) | `stale` (served immediately, background rebuild triggered per §1.3) | |
| `GET /api/golf` | 14,332 | 3,714,385 bytes (~3.7 MB) | `miss` — blocking rebuild per §1.4 | This request blocked on the full `getGolfSnapshot()` chain (ESPN leaderboard/scoreboard, weather, PGA Tour stats) |
| `GET /api/golf/schedule` | 12,964 | 7,234 bytes | n/a | `getSeasonSchedule(year)`, no server cache visible in the route |
| `GET /api/golf/lines` | 1,268 | 29,199 bytes | n/a | |
| `GET /api/golf/field-stats` | 2,168 | 14,705 bytes | n/a | |
| `GET /api/golf/player/10140` | 4,696 | 7,107 bytes | n/a | `Promise.all` of 3 PGA Tour/ESPN calls |
| `GET /api/odds/lines?sport=mlb` | 8,626 | 4,497 bytes | n/a | Small payload; time dominated by the external Odds API call plus the in-handler DB read/write side effects described in §3.3 |
| `GET /api/props/lines` (whole slate, no filter) | 1,706 | 9,474,688 bytes (~9.5 MB) | n/a | DB reads only, no external call on this path |
| `GET /api/props/diagnostics` | 871 | 9,323 bytes | n/a | |
| `GET /api/props/calibration?scope=player` | 857 | 3,092 bytes | `hit` | |
| `GET /api/picks/game-history?sport=mlb` | 952 | 65,361 bytes | n/a | |
| `GET /api/mlb/teams` | 1,255 | 9,380 bytes | n/a | |
| `GET /api/diagnostics` | 1,172 | 5,599 bytes | n/a | |
| `GET /api/props/system-health` | 2,758 | 0 bytes | n/a | **500 error** — see below |
| `GET /api/mlb/team/113` | 16,216 | 10,837 bytes | n/a | 5 sequential-stage external MLB Stats API calls (§1.5) |
| `GET /api/mlb/team-form?teamId=113` | 10,523 | 17,285 bytes | n/a | External `getScheduleRange` call |
| `GET /api/mlb/team-statcast?teamId=113` | 13,317 | 940 bytes | n/a | Small payload; time dominated by `getTeamStatcastRollup` computation/fetch |
| `GET /api/mlb/team-batter-ranks?teamId=113` | 537 | 2,699 bytes | n/a | |
| `GET /api/mlb/bullpen?teamA=138&teamB=113` | 703 | 6,201 bytes | n/a | DB-cached path |
| `GET /api/mlb/injuries?teamIds=138,113` | 1,031 | 1,165 bytes | n/a | |
| `GET /api/mlb/recent?teamA=138&teamB=113&days=45` | 759 | 3,750 bytes | n/a | |
| `GET /api/mlb/game/824514/live` | 2,868 | 3,737 bytes | n/a | `getLiveFeed`, deliberately uncached |
| `GET /api/nfl/teams` | 1,009 | 8,457 bytes | n/a | |
| `GET /api/nfl/team/24` | 2,886 | 74,212 bytes | n/a | 8-call `Promise.all` (§1.5) |

**Composite implication for MLB Team Detail:** `useTeamRoster`, `useTeamForm`, `useTeamStatcast`, `useTeamBatterRanks`, and `useBullpen` all fire on mount as independent `useEffect`s with the same `teamId` dependency (§1.5), so the browser issues all five requests concurrently. Given the measured per-endpoint times above (16,216 / 10,523 / 13,317 / 537 / 703 ms respectively), the slowest of the five (`/api/mlb/team/113` at 16,216 ms) determines when the page's last piece of team data arrives, assuming the dev server and upstream MLB Stats API process the five concurrent requests without additional queuing delay beyond what was measured for each in isolation.

**`GET /api/props/system-health` — observed failure:** returned HTTP 500 after 2,758 ms. Server log:
```
SqliteError: no such column: ingested_at
    at isoFormatTable (lib\db\client.ts:2334:23)
    at dataAccumulationSnapshot (lib\db\client.ts:2351:5)
    at GET (app\api\props\system-health\route.ts:27:47)
```
This is the same endpoint the Diagnostics page fetches automatically on every mount (`app/diagnostics/page.tsx:1179-1188`, part of the 11 parallel mount-fetches described in §1.5).

**Comments already present in the codebase describing typical rebuild duration** (not independently re-verified against a true cold cache in this session, since forcing one would require deleting rows from `snapshot_cache`): `lib/staleCache.ts:1-7` states "30-40s for the MLB snapshot, 9-15s for the others" for `/api/mlb`, `/api/props/lines`, and `/api/props/calibration` prior to the stale-while-revalidate wrapper being added to those routes. `app/diagnostics/page.tsx:1201-1203` states `POST /api/props/evaluate-total-baselines` takes "~90s, ~480 external bullpen-ERA calls."

---

## 6. Deployment/hosting context

### 6.1 Hosting platform

- `package.json:5-9` scripts: `"dev": "next dev -H 0.0.0.0 -p 3000"`, `"build": "next build"`, `"start": "next start -H 0.0.0.0 -p 3000"`, `"typecheck": "tsc --noEmit"`. No `@vercel/*` packages, no `pm2` or other process-manager dependency, no `postinstall`/deploy script.
- No `vercel.json`, `netlify.toml`, `Procfile`, `railway.json`, or `fly.toml` exists anywhere in the repo (confirmed via glob).
- `next.config.mjs:8-9` — `outputFileTracingRoot: projectRoot`, comment: "A stray lockfile further up the tree otherwise gets picked as the root" (a local-filesystem concern).
- `next.config.mjs:20` — `serverExternalPackages: ['better-sqlite3', 'node:sqlite', 'xlsx']`, explicitly excluding the native SQLite binding from the server bundle (comment, lines 15-19: bundling native modules breaks).
- `README.md:1-9` — "A personal, local-first pick-finder ... It does not place bets, does not connect to any sportsbook." `README.md:11-19` ("Running it") documents only `npm install` / `npm run dev`, then "open `http://localhost:3000`. The dev server binds `0.0.0.0`, so from a phone on the same network use `http://<your-machine-ip>:3000`." No production/deploy instructions appear anywhere in `README.md`.
- `lib/scheduler.ts:17-19` names the deployment model directly in a code comment: "In `next start` (this app's real deployment — one persistent process, not serverless) ..."

Combined, these are the only signals in the repo about hosting: a single always-on Node.js process (`next start`), run locally or on a persistent host reachable over the local network, with no specific hosting platform (Vercel, a named VPS provider, Railway, Fly.io, Netlify, Docker Compose for the main app) configured or documented anywhere.

### 6.2 Filesystem persistence / DB path

- `lib/db/client.ts:12-13`: `DB_DIR = path.join(process.cwd(), 'data')`; `DB_PATH = process.env.LINESMITH_DB ?? path.join(DB_DIR, 'linebuddy.db')`.
- `lib/db/client.ts:131-133`: `connect()` does `fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })` then `new Database(DB_PATH)` — a direct on-disk file open.
- `.gitignore:6-9` (as reported by the researching agent): `data/*.db`, `data/*.db-journal`, `data/*.db-wal`, `data/*.db-shm`, `data/*.json` are all git-ignored — the database file(s) are not committed to source control.
- Measured file sizes as of this audit: `data/linebuddy.db` ≈709 MB, `data/linebuddy.db-wal` ≈992 MB, `data/linebuddy.db-shm` = 131,072 bytes.

### 6.3 Database location

- `lib/db/client.ts:8`: `import Database from 'better-sqlite3'` — a synchronous, local-file-only SQLite binding with no network/remote-connection mode.
- No host/port/connection-string, no network DB client, and no remote-database driver appears anywhere in `lib/db/client.ts` or in `package.json`'s dependency list. The database lives on the same filesystem as the application process.

### 6.4 OddsHarvester sidecar (separate from the main app's hosting)

- `docker/oddsharvester/Dockerfile:1-23` builds a Python/Playwright image (`FROM mcr.microsoft.com/playwright/python:v1.57.0-noble`) that clones `github.com/jordantete/OddsHarvester` and runs it as a CLI (`ENTRYPOINT ["python3", "-m", "oddsharvester"]`). The header comment documents manual invocation: `docker build -t oddsharvester -f docker/oddsharvester/Dockerfile .` and `docker run --rm -v ./data:/out oddsharvester live -s baseball -l usa-mlb ...`.
- `scripts/run-oddsharvester.ps1` and `scripts/run-oddsharvester.sh` are thin manual wrappers around that same `docker run` command, parameterized by sport/mode/date, writing output JSON to the mounted `./data` directory. Neither script is referenced from `package.json`, neither runs on a timer, and neither is invoked automatically anywhere in the app code.
- `lib/odds/oddsHarvester.ts:1-16` confirms the main app only reads JSON files this sidecar writes to `data/` — "Nothing here calls Python or starts a subprocess — the scraping and the reading are deliberately decoupled by the filesystem" (lines 8-9). Its own comment (line 4) describes OddsHarvester as "a Python CLI that writes JSON to disk when run via cron or Docker," describing a hypothetical/external cron setup rather than anything configured inside this repo.
- This sidecar and its Docker build are entirely separate from, and have no bearing on, how the main Next.js app (`package.json`'s `start`/`build`/`dev`) is itself hosted.
