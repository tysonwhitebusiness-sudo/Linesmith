"""Ongoing freshness job for `player_game_history` — Phase 0 of
docs/daily-picks-full-model-build-2026-08-27.md.

backfill_player_game_history.py is a one-time, multi-hour historical pull.
Something has to keep the table current afterward, forever, for every new
day's completed games — same game-based (boxscore) approach the backfill
uses, not the live per-player ESPN gamelog endpoint (confirmed broken for
CFB/Soccer, and made structurally redundant now that every sport reads
player props from this table uniformly).

Reuses backfill_player_game_history.py's SCOPE/PARSERS/fetch_boxscore/
RateLimiter/FetchError wholesale rather than a second copy — those four
boxscore shapes (nba/football/soccer/nhl) were live-verified the same
session this table was built; re-deriving them here is exactly the
duplicated-and-drifting logic CLAUDE.md's job-runner-architecture section
warns against. Only real new code is `_discover_recent`: the backfill's
own discover_espn/discover_nhl sweep a whole *season*, filtered to that
season's ESPN season.year label; this job only needs a short trailing
window and must NOT drop games near a season boundary the way the
backfill's season-year filter would.

Registered in jobs.py as genericPlayerHistoryFreshnessJob. Golf is out of
scope (no player-game-history concept).

MLB AND TENNIS WERE OUT OF SCOPE TOO, AND NOTHING ELSE KEPT THEM CURRENT.
Task 4.7 backfilled both by hand on 2026-08-29 and no job wrote either again:
found 2026-09-14 (research pages R5 audit) with MLB's last row on 2026-08-28.
`mlbHistorySummaryJob` merges this table's hot window into the summary
`mlbProjectionsJob` reads, so the MLB board had been projecting without two
weeks of games. Both now have a branch here:

  mlb     StatsAPI boxscores of Final regular-season games, one request a game.
          NOT the backfill's player-season gameLog pull, which reads ~1,450
          players' whole seasons; that is fine by hand and wrong on a 512 MB
          worker every 30 minutes. Same rows: checked against 1,076 stored
          player-games from 37 games, with two differences the boxscore gets
          right (a bench player gameLog listed with zeros; one scoring change
          made after the backfill). See `mlb_rows_from_boxscore`.
  tennis  the backfill's own ESPN scoreboard sweep and `parse_tennis_match`,
          over the trailing window instead of a month.
"""
from datetime import date, datetime, timedelta, timezone

import httpx

import backfill_player_game_history as bph
import db

# A short trailing window, not just "yesterday": ESPN's scoreboard status
# can lag real completion by hours, and a missed job tick (worker restart,
# deploy) shouldn't lose that day's games. Skip-before-fetch
# (db.player_game_history_done_events) makes re-checking already-written
# games a cheap no-op, not wasted work, so a wider window costs almost
# nothing extra beyond a few more scoreboard calls.
LOOKBACK_DAYS = 3


class DiscoveryError(RuntimeError):
    """A day's scoreboard could not be read; see _discover_recent."""


async def _discover_recent(
    client: httpx.AsyncClient, limiter: "bph.RateLimiter", cfg: "bph.SportConfig", start: date, end: date
) -> list[tuple[str, str, int]]:
    """(event_id, game_date, season) for every real COMPLETED game in
    [start, end] for one sport. Same completed/regular-season/MLS-slug
    filters backfill_player_game_history.py's discover_espn/discover_nhl
    use, minus the season-label filter (a short window can span a real
    season boundary, e.g. late in one CFB season and preseason of the
    next within the same LOOKBACK_DAYS)."""
    found: dict[str, tuple[str, int]] = {}
    if cfg.discover == "nhl":
        cur = start
        while cur <= end:
            url = f"{bph._NHL_BASE}/schedule/{cur:%Y-%m-%d}"
            try:
                data = await bph.fetch_json(client, limiter, url)
            except bph.FetchError:
                cur += timedelta(days=1)
                continue
            for day in data.get("gameWeek") or []:
                ddate = day.get("date") or ""
                for g in day.get("games") or []:
                    if g.get("gameType") != 2 or g.get("gameState") not in ("OFF", "FINAL"):
                        continue
                    gid = str(g.get("id") or "")
                    raw_season = g.get("season")
                    if not gid or not raw_season:
                        continue
                    # backfill's own convention: stored season = the NHL
                    # season's START year, taken from the first 4 digits of
                    # the league's own "20242025"-style season int.
                    season = int(str(raw_season)[:4])
                    found[gid] = ((g.get("gameDate") or ddate or "")[:10], season)
            cur += timedelta(days=1)
        return [(eid, d, s) for eid, (d, s) in found.items()]

    # ONE DATE PER REQUEST: ESPN answers every team-sport `dates=A-B` range with
    # HTTP 400 since ~2026-09-15 (game_context.EspnScheduleError has the story).
    # A day that cannot be read raises DiscoveryError once every other day has
    # been tried: before, a failure read as "no completed games" and this job
    # quietly wrote nothing for NFL, CFB, EPL and MLS from 2026-09-15.
    url = f"{bph._ESPN_SITE}/{cfg.espn_sport}/{cfg.espn_league}/scoreboard"
    events: list[dict] = []
    failed_days: list[str] = []
    cur = start
    while cur <= end:
        params = {"dates": f"{cur:%Y%m%d}", "limit": 1000}
        if cfg.espn_groups:
            params["groups"] = cfg.espn_groups
        try:
            data = await bph.fetch_json(client, limiter, url, params=params)
            events.extend(data.get("events") or [])
        except bph.FetchError as e:
            failed_days.append(f"{cur:%Y%m%d} ({e})")
        cur += timedelta(days=1)
    if failed_days:
        raise DiscoveryError(f"{cfg.sport}: {len(failed_days)} day(s) unreadable: {', '.join(failed_days[:3])}")
    for ev in events:
        s = ev.get("season") or {}
        if cfg.espn_regular_only and s.get("type") != 2:
            continue
        if cfg.mls_regular_slug and not str(s.get("slug") or "").startswith("regular-season"):
            continue
        comp = (ev.get("competitions") or [{}])[0]
        status = (comp.get("status") or {}).get("type") or {}
        if not status.get("completed"):
            continue
        eid = str(ev.get("id") or "")
        season_year = s.get("year")
        if not eid or season_year is None:
            continue
        found[eid] = ((ev.get("date") or "")[:10], season_year)
    return [(eid, d, s) for eid, (d, s) in found.items()]


_MLB_STATSAPI = "https://statsapi.mlb.com/api/v1"

# The stat allow-list `predict/statsapi.GAME_LOG_FIELDS` requests, which is what
# the backfill stored. A boxscore carries ~40 more keys per group; storing them
# would make fresh rows a different shape from every row before them.
_MLB_FIELDS = ("hits", "atBats", "plateAppearances", "gamesStarted", "runs", "doubles", "triples",
               "homeRuns", "rbi", "baseOnBalls", "strikeOuts", "totalBases", "stolenBases",
               "hitByPitch", "earnedRuns", "inningsPitched")
_MLB_GROUPS = (("batting", "bat_"), ("pitching", "pit_"))


def mlb_rows_from_boxscore(box: dict, game_pk, game_date: str, season: int) -> list:
    """One Final game's boxscore -> one row per player who batted or pitched.

    Matches the backfill's gameLog rows key for key, with one group difference
    measured against stored rows: a pitching gameLog has `totalBases` and no
    `rbi`, where a pitching boxscore has `rbi` and no `totalBases`. So pitching
    drops `rbi` and derives total bases from the hit types.
    """
    teams = box.get("teams") or {}
    home = teams.get("home") or {}
    away = teams.get("away") or {}
    home_id = (home.get("team") or {}).get("id")
    away_id = (away.get("team") or {}).get("id")
    if home_id is None or away_id is None:
        return []
    rows = []
    for side, team_id, opp_id, is_home in ((home, home_id, away_id, True), (away, away_id, home_id, False)):
        for player in (side.get("players") or {}).values():
            pid = (player.get("person") or {}).get("id")
            if pid is None:
                continue
            stats: dict[str, float] = {}
            for group, prefix in _MLB_GROUPS:
                g = (player.get("stats") or {}).get(group) or {}
                if not g:
                    continue
                for k in _MLB_FIELDS:
                    if group == "pitching" and k == "rbi":
                        continue
                    v = bph._num(g.get(k))
                    if v is not None:
                        stats[prefix + k] = v
                if group == "pitching" and "pit_hits" in stats:
                    stats["pit_totalBases"] = (stats["pit_hits"] + stats.get("pit_doubles", 0.0)
                                               + 2 * stats.get("pit_triples", 0.0) + 3 * stats.get("pit_homeRuns", 0.0))
            if not stats:
                continue
            rows.append(db.PlayerGameHistoryInput(
                sport="mlb", athlete_id=str(pid), team_id=str(team_id), season=season,
                event_id=str(game_pk), game_date=game_date, opponent_id=str(opp_id),
                is_home=is_home, stats=stats,
            ))
    return rows


def mlb_game_is_final(game: dict) -> bool:
    """Final, and not a suspension. A suspended game's rows would be written with
    partial stats, and the writer's ON CONFLICT would keep them after it resumes."""
    status = game.get("status") or {}
    detailed = str(status.get("detailedState") or "")
    return status.get("abstractGameState") == "Final" and not detailed.startswith(("Suspended", "Postponed", "Cancelled"))


def _empty(failed: int = 0) -> dict:
    return {"discovered": 0, "already_done": 0, "fetched": 0, "failed": failed, "rows_written": 0}


async def _mlb_pass(client, limiter, start: date, end: date) -> dict:
    try:
        sched = await bph.fetch_json(client, limiter, f"{_MLB_STATSAPI}/schedule", params={
            "sportId": 1, "gameType": "R", "startDate": f"{start:%Y-%m-%d}", "endDate": f"{end:%Y-%m-%d}"})
    except bph.FetchError:
        return _empty(failed=1)
    games = [g for d in sched.get("dates") or [] for g in d.get("games") or [] if mlb_game_is_final(g)]
    season_of = lambda g: int(g.get("season") or g["officialDate"][:4])  # noqa: E731
    done: set[str] = set()
    for season in {season_of(g) for g in games}:
        done |= await db.player_game_history_done_events("mlb", season)
    todo = [g for g in games if str(g["gamePk"]) not in done]
    fetched = failed = rows_written = 0
    for g in todo:
        try:
            box = await bph.fetch_json(client, limiter, f"{_MLB_STATSAPI}/game/{g['gamePk']}/boxscore")
            rows = mlb_rows_from_boxscore(box, g["gamePk"], g["officialDate"], season_of(g))
        except Exception:  # one odd payload must not stop the pass
            failed += 1
            continue
        if rows:
            rows_written += await db.write_player_game_history(rows)
            fetched += 1
    return {"discovered": len(games), "already_done": len(games) - len(todo), "fetched": fetched,
            "failed": failed, "rows_written": rows_written}


async def _tennis_pass(client, limiter, cfg, start: date, end: date) -> dict:
    """The backfill's scoreboard sweep over [start, end]. ESPN returns whole
    tournaments for a date range, so a short window still yields complete
    draws; completed matches only, by `parse_tennis_match`'s own rules."""
    tour = bph._TENNIS_TOUR[cfg.sport]
    slug = bph._TENNIS_SINGLES_SLUG[cfg.sport]  # the tour's own singles draw (R8.3b-F1)
    url = f"{bph._ESPN_SITE}/tennis/{tour}/scoreboard"
    try:
        payload = await bph.fetch_json(client, limiter, url, params={"dates": f"{start:%Y%m%d}-{end:%Y%m%d}", "limit": 1000})
    except bph.FetchError:
        return _empty(failed=1)
    done: set[str] = set()
    for season in range(start.year - 1, end.year + 1):
        done |= await db.player_game_history_done_events(cfg.sport, season)
    seen: set[str] = set()
    rows = []
    for event in (payload or {}).get("events") or []:
        name = event.get("name") or ""
        for grouping in event.get("groupings") or []:
            if (grouping.get("grouping") or {}).get("slug") != slug:
                continue
            for comp in grouping.get("competitions") or []:
                mid = str(comp.get("id"))
                if mid in seen:
                    continue
                seen.add(mid)
                if mid in done:
                    continue
                # Season is the match's calendar year, as the backfill stores it.
                season = int((comp.get("date") or str(end.year))[:4])
                rows.extend(bph.parse_tennis_match(comp, cfg.sport, season, name))
    written = await db.write_player_game_history(rows) if rows else 0
    return {"discovered": len(seen), "already_done": len(seen & done), "fetched": len({r.event_id for r in rows}),
            "failed": 0, "rows_written": written}


async def run_freshness_pass(client: httpx.AsyncClient, rps: float = 3.0, start: date | None = None,
                             sports: set[str] | None = None) -> dict:
    """One pass across every in-scope sport: discover recently-completed
    games, skip anything already in player_game_history (per-season done-
    set, same primitive the backfill uses), fetch+parse+write the rest.
    Sequential across sports and within a sport — real volume here is a
    handful of games per sport per day, not the backfill's tens of
    thousands, so there's no need for the backfill's producer/consumer
    concurrency to stay inside the job runner's per-job timeout."""
    limiter = bph.RateLimiter(rps=rps)
    today = datetime.now(timezone.utc).date()
    # `start` widens the window for a catch-up run by hand; the job uses the default.
    start = start or today - timedelta(days=LOOKBACK_DAYS)
    per_sport: dict[str, dict] = {}

    # Only the sports whose shape this job actually handles — a per-game ESPN
    # or NHL boxscore fetch parsed by one of bph.PARSERS.
    #
    # This used to iterate bph.SCOPE directly, on the assumption that SCOPE
    # only ever contained those. Task 4.7 added MLB (parser="mlb", a batched
    # StatsAPI player-season fetch) and tennis (parser="tennis", a monthly
    # tournament sweep) to SCOPE, and this job crashed with KeyError: 'mlb' on
    # its very next run — caught by health_check.py, which is exactly what that
    # exists for. The module docstring already said MLB/Golf/Tennis are out of
    # scope here; it just had no way to enforce it. Filtering on PARSERS
    # membership means a future sport added with its own bespoke branch is
    # skipped automatically rather than crashing this.
    handled = [cfg for cfg in bph.SCOPE if cfg.parser in bph.PARSERS and (sports is None or cfg.sport in sports)]

    discovery_errors: list[str] = []
    for cfg in handled:
        parser = bph.PARSERS[cfg.parser]
        try:
            discovered = await _discover_recent(client, limiter, cfg, start, today)
        except DiscoveryError as e:
            # Every other sport still runs; the run is failed at the end.
            discovery_errors.append(str(e))
            per_sport[cfg.sport] = {**_empty(), "discovery_error": str(e)}
            continue
        seasons_needed = {season for _eid, _date, season in discovered}
        done: set[str] = set()
        for season in seasons_needed:
            done |= await db.player_game_history_done_events(cfg.sport, season)
        todo = [(eid, season) for eid, _date, season in discovered if eid not in done]

        fetched = failed = rows_written = 0
        for eid, season in todo:
            try:
                raw = await bph.fetch_boxscore(client, limiter, cfg, eid)
            except bph.FetchError:
                failed += 1
                continue
            try:
                rows = parser(raw, cfg.sport, eid, season)
            except Exception:
                failed += 1
                continue
            if not rows:
                continue
            rows_written += await db.write_player_game_history(rows)
            fetched += 1

        per_sport[cfg.sport] = {
            "discovered": len(discovered),
            "already_done": len(discovered) - len(todo),
            "fetched": fetched,
            "failed": failed,
            "rows_written": rows_written,
        }

    # The two sports with their own fetch shape (see the module docstring).
    if sports is None or "mlb" in sports:
        per_sport["mlb"] = await _mlb_pass(client, limiter, start, today)
    for cfg in bph.SCOPE:
        if cfg.discover == "tennis" and (sports is None or cfg.sport in sports):
            per_sport[cfg.sport] = await _tennis_pass(client, limiter, cfg, start, today)

    if discovery_errors:
        # Raised after every sport has had its pass, so one broken schedule
        # does not stop the others; the job's run log records a failure,
        # which health_check reports, instead of a quiet zero.
        raise DiscoveryError("; ".join(discovery_errors))
    return per_sport
