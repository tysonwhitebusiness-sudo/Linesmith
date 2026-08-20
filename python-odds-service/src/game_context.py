"""Reads real game context from Postgres — the same snapshot_cache table the
TS app writes to, not a live ESPN/MLB-API call of its own. MLB reads
'mlb:snapshot' (existing, proactively kept fresh by the TS refreshMlb job);
NFL/CFB/Soccer read 'odds-context:{sport}' (new in Phase 2 Step 3 —
lib/odds/props/multiSportGameContext.ts's write-through).

Rough parsing only. MLB's shape has zero schema enforcement today (documented
gap in docs/phase2-python-odds-migration-audit-2026-08-19.md) — this
replicates gameContext.ts's exact quirk (team abbreviations derived by
splitting `matchup` on '@', not read from a dedicated field) since that's
what the real payload actually contains.
"""
import json
import re
from dataclasses import dataclass, field

from db import read_snapshot


@dataclass
class Game:
    sport: str
    game_id: str
    away_team_name: str
    home_team_name: str
    away_abbr: str
    home_abbr: str
    game_date: str
    is_final: bool = False


async def load_mlb_games() -> list[Game]:
    payload = await read_snapshot("mlb:snapshot")
    if not payload:
        return []
    data = json.loads(payload)
    raw_games = ((data.get("context") or {}).get("other") or {}).get("games") or []

    games: list[Game] = []
    for g in raw_games:
        matchup = g.get("matchup") or ""
        parts = [p.strip() for p in matchup.split("@")]
        away_abbr = parts[0] if len(parts) == 2 else ""
        home_abbr = parts[1] if len(parts) == 2 else ""
        away_name = g.get("awayTeamName")
        home_name = g.get("homeTeamName")
        if not away_name or not home_name:
            continue  # gameContext.ts drops games missing either name — mirrored here
        state = (g.get("state") or "")
        games.append(
            Game(
                sport="mlb",
                game_id=str(g.get("gamePk")),
                away_team_name=away_name,
                home_team_name=home_name,
                away_abbr=away_abbr,
                home_abbr=home_abbr,
                game_date=g.get("firstPitch") or "",
                is_final=bool(re.search(r"final", state, re.IGNORECASE)),
            )
        )
    return games


async def load_sport_games(sport: str) -> list[Game]:
    """sport: 'nfl' | 'cfb' | 'soccer_epl' — reads the Phase 2 Step 3 snapshot."""
    payload = await read_snapshot(f"odds-context:{sport}")
    if not payload:
        return []
    data = json.loads(payload)
    raw_games = data.get("games") or []
    games: list[Game] = []
    for g in raw_games:
        games.append(
            Game(
                sport=sport,
                game_id=str(g.get("gameId")),
                away_team_name=g.get("awayTeamName") or "",
                home_team_name=g.get("homeTeamName") or "",
                away_abbr=g.get("awayAbbr") or "",
                home_abbr=g.get("homeAbbr") or "",
                game_date=g.get("gameDate") or "",
                is_final=False,  # not tracked in this snapshot shape yet
            )
        )
    return games
