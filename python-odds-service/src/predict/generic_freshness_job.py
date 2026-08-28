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

Registered in jobs.py as genericPlayerHistoryFreshnessJob. MLB/Golf/
Tennis are out of scope (same as the backfill and the whole daily-picks
build — MLB has its own real pipeline, Golf has no player-game-history
concept, Tennis needs its own design).
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

    params = {"dates": f"{start:%Y%m%d}-{end:%Y%m%d}", "limit": 1000}
    if cfg.espn_groups:
        params["groups"] = cfg.espn_groups
    url = f"{bph._ESPN_SITE}/{cfg.espn_sport}/{cfg.espn_league}/scoreboard"
    try:
        data = await bph.fetch_json(client, limiter, url, params=params)
    except bph.FetchError:
        data = {}
    for ev in data.get("events") or []:
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


async def run_freshness_pass(client: httpx.AsyncClient, rps: float = 3.0) -> dict:
    """One pass across every in-scope sport: discover recently-completed
    games, skip anything already in player_game_history (per-season done-
    set, same primitive the backfill uses), fetch+parse+write the rest.
    Sequential across sports and within a sport — real volume here is a
    handful of games per sport per day, not the backfill's tens of
    thousands, so there's no need for the backfill's producer/consumer
    concurrency to stay inside the job runner's per-job timeout."""
    limiter = bph.RateLimiter(rps=rps)
    today = datetime.now(timezone.utc).date()
    start = today - timedelta(days=LOOKBACK_DAYS)
    per_sport: dict[str, dict] = {}

    for cfg in bph.SCOPE:
        parser = bph.PARSERS[cfg.parser]
        discovered = await _discover_recent(client, limiter, cfg, start, today)
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

    return per_sport
