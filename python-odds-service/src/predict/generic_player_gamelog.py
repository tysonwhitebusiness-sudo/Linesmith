"""Real per-player game log fetcher, generic across sports — ESPN's
common-API gamelog endpoint confirmed live for both NFL and NBA (real
curl checks against real players, both before writing this and before
writing predict/generic_prop_score.py which consumes it) before assuming
it exists. Feeds windowed_stat.py's HistoryEntry list, per
docs/all-sports-prop-score-gameplan-2026-08-27.md's own plan.
"""
from dataclasses import dataclass, field

import httpx

_ESPN_COMMON_BASE = "https://site.web.api.espn.com/apis/common/v3/sports"
_ESPN_SITE_BASE = "https://site.api.espn.com/apis/site/v2/sports"


@dataclass
class PlayerGameStat:
    event_id: str
    game_date: str  # ISO date, YYYY-MM-DD
    opponent_id: int | None
    is_home: bool
    stats: dict[str, float] = field(default_factory=dict)  # ESPN stat name -> real value


async def fetch_player_gamelog(client: httpx.AsyncClient, espn_sport: str, espn_league: str, athlete_id: str, season: int | None = None) -> list[PlayerGameStat]:
    """Regular season only, deliberately — a player's playoff sample is
    real but small and a structurally different level of competition; a
    prop-score baseline should be built on the same competitive context a
    real regular-season prop actually concerns. Some stat cells are
    made-attempted combo strings ("6-13"), not plain numbers — skipped
    per-field rather than dropping the whole game, since the simple
    counting stats (points, rebounds, assists, etc.) this module actually
    needs are real plain numbers in every sport checked so far."""
    # Real bug found live 2026-08-27: with no `season` param, this
    # endpoint's default only returned a partial, tail-end slice of a
    # player's real season (confirmed live: 16 games for a player whose
    # real full season, requested explicitly via ?season=, has 74) — not
    # obviously partial from the response shape alone, easy to silently
    # under-sample a real player's history without ever raising an error.
    # Always pass a real season explicitly rather than trust the default.
    url = f"{_ESPN_COMMON_BASE}/{espn_sport}/{espn_league}/athletes/{athlete_id}/gamelog"
    params = {"season": season} if season is not None else None
    res = await client.get(url, params=params, timeout=httpx.Timeout(15.0))
    if res.status_code != 200:
        return []
    data = res.json()
    names = data.get("names") or []
    events_meta = data.get("events") or {}

    out: list[PlayerGameStat] = []
    for season_type in data.get("seasonTypes") or []:
        if "postseason" in (season_type.get("displayName") or "").lower():
            continue
        for category in season_type.get("categories") or []:
            for ev in category.get("events") or []:
                event_id = ev.get("eventId")
                if not event_id or event_id not in events_meta:
                    continue
                meta = events_meta[event_id]
                stats: dict[str, float] = {}
                for i, name in enumerate(names):
                    values = ev.get("stats") or []
                    if i >= len(values):
                        continue
                    try:
                        stats[name] = float(values[i])
                    except (TypeError, ValueError):
                        continue
                team_id = (meta.get("team") or {}).get("id")
                home_id = meta.get("homeTeamId")
                opponent = meta.get("opponent") or {}
                out.append(
                    PlayerGameStat(
                        event_id=event_id,
                        game_date=(meta.get("gameDate") or "")[:10],
                        opponent_id=int(opponent["id"]) if opponent.get("id") else None,
                        is_home=bool(team_id and home_id and str(team_id) == str(home_id)),
                        stats=stats,
                    )
                )
    out.sort(key=lambda g: g.game_date)
    return out


async def fetch_roster_athlete_ids(client: httpx.AsyncClient, espn_sport: str, espn_league: str, team_id: str) -> list[tuple[str, str, str | None]]:
    """Real (athlete_id, full_name, position_abbr) triples for one real
    team's current roster — ESPN's site-API roster endpoint (a different,
    simpler endpoint than the gamelog's common-API one; both confirmed
    live separately). Used to build a real, if limited-sample, league
    base rate from real players' real games rather than a guessed prior.
    position_abbr (e.g. "F", "C", real ESPN field confirmed live 2026-08-27)
    is what Phase 4's production job maps into generic_matchup_defense.py's
    own _nba_position_group/_nhl_position_group buckets for the X signal —
    None when ESPN's own roster entry has no position (real for some
    inactive/two-way entries, not an error).

    Real, confirmed-live shape split: NBA and soccer return a flat
    `athletes` list of real athlete objects directly; NFL, CFB, and NHL
    group it one level deeper (`athletes: [{"position": "offense",
    "items": [athlete, ...]}, ...]` — "position" here is the coarse group
    label like "Centers", not a per-player abbreviation, that's still on
    each individual item). Assuming the flat shape for every sport was a
    real bug found live 2026-08-27: it silently returned an empty roster
    for NFL/CFB/NHL specifically, which would have made Phase 4's whole
    production job log zero real candidates for three of six sports with
    no error at all. Detected per-entry (`"items" in entry`), not per-
    sport, so this stays correct even if ESPN's shape choice isn't
    perfectly consistent within a sport."""
    url = f"{_ESPN_SITE_BASE}/{espn_sport}/{espn_league}/teams/{team_id}/roster"
    res = await client.get(url, timeout=httpx.Timeout(15.0))
    if res.status_code != 200:
        return []
    data = res.json()
    flat_athletes: list[dict] = []
    for entry in data.get("athletes") or []:
        if "items" in entry:
            flat_athletes.extend(entry.get("items") or [])
        else:
            flat_athletes.append(entry)
    return [
        (str(a["id"]), a.get("fullName") or "", (a.get("position") or {}).get("abbreviation"))
        for a in flat_athletes
        if a.get("id")
    ]
