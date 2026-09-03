"""The archival bridge — promotes live odds into the training archive.

THE PROBLEM IT SOLVES. Measured 2026-09-02: 100% of odds_archive,
prop_odds_archive and game_result rows were written by a single import.
Nothing writes them on a schedule. Meanwhile the JOB_REGISTRY provider jobs run
fine and write prop_odds and game_odds_book_lines, which NO MODEL READS. The
training set is therefore frozen at 2026-09-01: every model trained on it decays
from its first day, no backtest can ever include a later game, and refitting on
identical data produces an identical model.

UPSERT CONTINUOUSLY; DO NOT CAPTURE AT A MOMENT. The obvious design fires a job
at each game's event_start and snapshots the price. It is wrong: games start at
arbitrary times, the queue is sequential, and one restart or slow tick loses that
game's closing line permanently — you cannot go back and ask what the price was
ten minutes before kickoff. Instead, keep upserting while the game has not
started. When it starts, updates stop, and whatever is in the row IS the close.
Nothing has to happen at the right instant.

THE FREEZE IS A WHERE CLAUSE, so Postgres enforces it rather than application
logic:

    ON CONFLICT (...) DO UPDATE SET ... WHERE odds_archive.event_start > now()

Properties this buys: a missed tick makes a close staler rather than absent, and
`captured_at` measures exactly how stale; it is idempotent by construction; and
an in-play price cannot contaminate the training set even if one is fetched,
because after kickoff the predicate is false. That last one matters — 48,489
in-play rows once entered this archive scoring Brier 0.032 against 0.22, and were
invisible in the aggregate.
"""
import time
from datetime import datetime, timezone

import db
from entity_resolution import normalize_team_name
from game_context import load_mlb_games, load_nhl_games, load_sport_games, load_tennis_games
from provider_matrix import MATRIX

SOURCE = "live_capture"
# Above espn_core (90) because this is a real captured close rather than a
# scraped snapshot, below sbr (100) which has been through its own gates.
SOURCE_PRIORITY = 95

# Team-name -> id, per sport, rebuilt hourly. Resolved from odds_archive's OWN
# history rather than by threading ids through game_context: the archive already
# holds millions of verified (name, id) pairs, and changing the shared game
# loader for every sport to carry ids is a far larger blast radius than a lookup.
# Measured coverage against live slates: MLB/NFL/EPL 100%, CFB 94% (the misses
# are small schools with no archive history, and they are counted, not guessed).
_TEAM_INDEX_TTL = 3600.0
_team_index: dict[str, tuple[dict[str, str], float]] = {}


async def _team_ids(sport: str) -> dict[str, str]:
    hit = _team_index.get(sport)
    if hit is not None and time.monotonic() < hit[1]:
        return hit[0]
    pool = await db.get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT home_team_raw AS raw, home_team_id AS id FROM odds_archive
                WHERE sport = $1 AND home_team_id IS NOT NULL AND home_team_raw IS NOT NULL
               UNION
               SELECT away_team_raw, away_team_id FROM odds_archive
                WHERE sport = $1 AND away_team_id IS NOT NULL AND away_team_raw IS NOT NULL""",
            sport,
        )
    idx = {normalize_team_name(r["raw"]): r["id"] for r in rows if r["raw"]}
    _team_index[sport] = (idx, time.monotonic() + _TEAM_INDEX_TTL)
    return idx


_LOADERS = {
    "mlb": load_mlb_games,
    "nhl": load_nhl_games,
    "tennis_atp": lambda: load_tennis_games("tennis_atp"),
    "tennis_wta": lambda: load_tennis_games("tennis_wta"),
}


async def _games_for(sport: str):
    loader = _LOADERS.get(sport)
    games = await (loader() if loader else load_sport_games(sport))
    return [g for g in games if not g.is_final]


def _parse_start(raw: str | None) -> datetime | None:
    if not raw:
        return None
    try:
        return datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except ValueError:
        return None


async def archive_closing_lines(sports: list[str] | None = None) -> dict:
    """One pass: every not-yet-started game's current book lines into
    odds_archive. Returns the standard job summary shape."""
    now = datetime.now(timezone.utc)
    written = 0
    considered = 0
    unresolved: list[str] = []
    warnings: list[str] = []

    for sport in (sports if sports is not None else sorted(MATRIX)):
        try:
            games = await _games_for(sport)
        except Exception as e:
            warnings.append(f"{sport}: game load failed — {type(e).__name__}: {e}")
            continue

        upcoming = {}
        for g in games:
            start = _parse_start(g.game_date)
            # Only games that have NOT started. A started game's row is already
            # frozen; re-reading it would spend work to change nothing.
            if start is not None and start > now:
                upcoming[str(g.game_id)] = (g, start)
        if not upcoming:
            continue

        idx = await _team_ids(sport)
        rows = await db.live_book_lines_for_games(sport, list(upcoming))
        considered += len(rows)

        payload = []
        for r in rows:
            g, start = upcoming[str(r["game_id"])]
            hid = idx.get(normalize_team_name(g.home_team_name))
            aid = idx.get(normalize_team_name(g.away_team_name))
            if not hid or not aid:
                # Counted, never guessed: a wrong team id attaches a price to the
                # wrong game, which is worse than not archiving it.
                unresolved.append(f"{sport}: {g.away_team_name} @ {g.home_team_name}")
                continue
            payload.append({
                "sport": sport,
                "event_ref": str(g.game_id),
                "game_date": start.date(),
                "event_start": start,
                "home_team_id": hid,
                "away_team_id": aid,
                "home_team_raw": g.home_team_name,
                "away_team_raw": g.away_team_name,
                "market": r["market"],
                "side": r["side"],
                "line": r["point"],
                "price": r["american_odds"],
                "bookmaker": r["bookmaker"],
                "provider": r["source"],
            })
        if payload:
            written += await db.upsert_live_capture(payload)

    if unresolved:
        uniq = sorted(set(unresolved))
        warnings.append(
            f"{len(uniq)} game(s) had no resolvable team id and were not archived: "
            + "; ".join(uniq[:5]) + ("…" if len(uniq) > 5 else "")
        )
    return {
        "games": len(set(u.split(":")[0] for u in unresolved)) if unresolved else 0,
        "rows_matched": considered,
        "rows_written": written,
        "unresolved": len(set(unresolved)),
        "requests": 0,   # reads live tables only — spends no provider budget
        "objects": 0,
        "warnings": warnings,
    }
