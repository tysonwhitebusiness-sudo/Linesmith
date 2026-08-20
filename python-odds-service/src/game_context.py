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

Roster parsing added to feed entity_resolution.resolve_player — ported
directly from lib/odds/props/gameContext.ts's buildContextForGame, not
reconstructed from memory: MLB's roster is built by filtering the
snapshot's top-level `subjects[]` down to whichever ones have
`meta.gamePk` equal to this game's gamePk (no role/batter-vs-pitcher
filtering — the TS reference doesn't filter on that either, so this
doesn't either), pulling `teamAbbr` from `meta.team` when it's a string.
NFL/CFB/Soccer are simpler: `roster` is already embedded per-game in the
Step 3 snapshot payload, built from the same RosterEntry shape at write
time (multiSportGameContext.ts), so it's parsed directly.
"""
import json
import re

from db import read_snapshot
from entity_resolution import RosterEntry


class Game:
    def __init__(
        self,
        sport: str,
        game_id: str,
        away_team_name: str,
        home_team_name: str,
        away_abbr: str,
        home_abbr: str,
        game_date: str,
        is_final: bool = False,
        roster: list[RosterEntry] | None = None,
    ):
        self.sport = sport
        self.game_id = game_id
        self.away_team_name = away_team_name
        self.home_team_name = home_team_name
        self.away_abbr = away_abbr
        self.home_abbr = home_abbr
        self.game_date = game_date
        self.is_final = is_final
        self.roster = roster or []


def _roster_for_mlb_game(subjects: list[dict], game_pk) -> list[RosterEntry]:
    """Mirrors gameContext.ts:37-45's buildContextForGame roster derivation
    exactly: filter snapshot.subjects by meta.gamePk === this game's gamePk
    (JS strict equality — both sides are the raw JSON number, no string
    coercion; game_pk here is passed through as whatever json.loads already
    decoded it to, for the same reason), map to {subjectId, subjectName,
    teamAbbr from meta.team if it's a string else None}."""
    roster: list[RosterEntry] = []
    for s in subjects:
        meta = s.get("meta") or {}
        if not isinstance(meta, dict):
            continue
        if meta.get("gamePk") != game_pk:
            continue
        team = meta.get("team")
        roster.append(
            RosterEntry(
                subject_id=s.get("subjectId"),
                subject_name=s.get("subjectName"),
                team_abbr=team if isinstance(team, str) else None,
            )
        )
    return roster


async def load_mlb_games() -> list[Game]:
    payload = await read_snapshot("mlb:snapshot")
    if not payload:
        return []
    data = json.loads(payload)
    raw_games = ((data.get("context") or {}).get("other") or {}).get("games") or []
    subjects = data.get("subjects") or []

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
        game_pk = g.get("gamePk")
        games.append(
            Game(
                sport="mlb",
                game_id=str(game_pk),
                away_team_name=away_name,
                home_team_name=home_name,
                away_abbr=away_abbr,
                home_abbr=home_abbr,
                game_date=g.get("firstPitch") or "",
                is_final=bool(re.search(r"final", state, re.IGNORECASE)),
                roster=_roster_for_mlb_game(subjects, game_pk),
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
        raw_roster = g.get("roster") or []
        roster = [
            RosterEntry(
                subject_id=r.get("subjectId"),
                subject_name=r.get("subjectName"),
                team_abbr=r.get("teamAbbr"),
                position=r.get("position"),
                headshot_url=r.get("headshotUrl"),
            )
            for r in raw_roster
        ]
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
                roster=roster,
            )
        )
    return games
