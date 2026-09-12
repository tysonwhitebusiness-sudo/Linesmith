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
from datetime import datetime, timedelta, timezone

import db
from entity_resolution import normalize_team_name
from game_context import (
    completed_espn_games,
    load_mlb_games,
    load_nhl_games,
    load_sport_games,
    load_tennis_games,
)
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
    # Phase 5.S.7 — READ THE DERIVED INDEX, NOT THE ARCHIVE.
    #
    # This used to scan `odds_archive` twice per sport -- 1,982,889 rows to
    # produce 874 pairs, of which 859 survive normalisation. That was merely
    # wasteful while the whole archive lived here. It became a correctness
    # problem when 5.S.7 pruned the archive to its unfrozen tail: 99.8% of those
    # rows are frozen, so the same query now yields a handful of pairs and every
    # name it cannot resolve is routed to `odds_unresolved`. Nothing would have
    # raised. The bridge would have kept running and quietly stopped resolving.
    #
    # `team_name_index` is seeded from the Parquet corpus and refreshed from the
    # live tail alone -- see `build_team_name_index.py` for why that split is
    # about Storage egress rather than tidiness.
    #
    # The names are stored ALREADY NORMALISED, by the same `normalize_team_name`
    # used on the lookup side, so the transform happens once and cannot drift
    # between writer and reader.
    pool = await db.get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT name_key, team_id FROM team_name_index WHERE sport = $1",
            sport,
        )
    idx = {r["name_key"]: r["team_id"] for r in rows}
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

        # SERVER-SIDE. This used to fetch the latest book line for every upcoming
        # game (~8.6-24.8M rows/day), rebuild each row as a dict in Python, and
        # write them straight back into the same database. The rows made a round
        # trip across the pooler to be reshaped and returned.
        #
        # Team-id resolution still happens HERE, deliberately. It needs the
        # in-memory Game objects and the name index, and a game whose ids do not
        # resolve must be EXCLUDED rather than archived against a guess -- a
        # wrong team id attaches a price to the wrong game, which is worse than
        # not archiving it. So the resolved metadata is sent IN as parallel
        # arrays (ingress, which is not what the bill counts) and the big table
        # never leaves the server.
        ids: list[str] = []
        gdates: list = []
        gstarts: list = []
        hids: list[str] = []
        aids: list[str] = []
        hraws: list[str] = []
        araws: list[str] = []
        for gid, (g, start) in upcoming.items():
            hid = idx.get(normalize_team_name(g.home_team_name))
            aid = idx.get(normalize_team_name(g.away_team_name))
            if not hid or not aid:
                unresolved.append(f"{sport}: {g.away_team_name} @ {g.home_team_name}")
                continue
            ids.append(gid)
            gdates.append(start.date())
            gstarts.append(start)
            hids.append(hid)
            aids.append(aid)
            hraws.append(g.home_team_name)
            araws.append(g.away_team_name)

        if ids:
            written += await db.archive_closing_lines_server_side(
                sport, ids, gdates, gstarts, hids, aids, hraws, araws)

    if unresolved:
        uniq = sorted(set(unresolved))
        warnings.append(
            f"{len(uniq)} game(s) had no resolvable team id and were not archived: "
            + "; ".join(uniq[:5]) + ("…" if len(uniq) > 5 else "")
        )
    return {
        "games": len(set(u.split(":")[0] for u in unresolved)) if unresolved else 0,
        # rows_matched was a count of rows FETCHED, which is precisely the
        # transfer this function no longer performs. Counting it again would
        # mean pulling the rows back to count them.
        "rows_matched": written,
        "rows_written": written,
        "unresolved": len(set(unresolved)),
        "requests": 0,   # reads live tables only — spends no provider budget
        "objects": 0,
        "warnings": warnings,
    }


# Sports whose completed games come from ESPN's scoreboard. MLB has its own
# StatsAPI path below; NHL is not covered yet — see archive_results.
_ESPN_RESULT_SPORTS = ("nfl", "cfb", "nba", "soccer_epl", "soccer_mls")


async def _mlb_finals(days_back: int) -> list[dict]:
    """Completed MLB games from StatsAPI, in the same dict shape ESPN returns.

    MLB does not come from ESPN's scoreboard here — game_context.load_mlb_games
    reads a snapshot that carries no scores — so this uses the StatsAPI schedule
    the rest of the MLB pipeline already depends on.
    """
    import httpx

    from predict import statsapi

    today = datetime.now(timezone.utc).date()
    start = (today - timedelta(days=days_back)).isoformat()
    async with httpx.AsyncClient() as client:
        games = await statsapi.get_schedule_range(client, start, today.isoformat())

    out = []
    for g in games:
        if (g.abstract_state or "").lower() != "final":
            continue
        home = (g.teams or {}).get("home") or {}
        away = (g.teams or {}).get("away") or {}
        hs, as_ = home.get("score"), away.get("score")
        if hs is None or as_ is None:
            continue
        out.append({
            "gameId": str(g.game_pk),
            "date": g.game_date,
            "homeTeamName": ((home.get("team") or {}).get("name")),
            "awayTeamName": ((away.get("team") or {}).get("name")),
            "homeScore": int(hs),
            "awayScore": int(as_),
            "venue": (g.venue or {}).get("name"),
        })
    return out


async def archive_results(days_back: int = 3) -> dict:
    """Settled scores into game_result.

    Team ids resolve through the SAME name index the closing-line path uses,
    not through each provider's own id. ESPN and MLB StatsAPI number teams
    differently, and the archive already contains whichever convention its own
    rows use — resolving by name returns ids that match by construction, instead
    of writing a second id namespace into one table.

    NHL IS NOT COVERED YET and is not silently skipped: it is the one sport
    whose schedule comes from neither ESPN nor StatsAPI, and it is out of season
    as this is written, so it has no completed games to lose in the meantime.
    """
    written = 0
    considered = 0
    unresolved: list[str] = []
    warnings: list[str] = []

    sources: list[tuple[str, list[dict]]] = []
    for sport in _ESPN_RESULT_SPORTS:
        try:
            sources.append((sport, await completed_espn_games(sport, days_back)))
        except Exception as e:
            warnings.append(f"{sport}: {type(e).__name__}: {e}")
    try:
        sources.append(("mlb", await _mlb_finals(days_back)))
    except Exception as e:
        warnings.append(f"mlb: {type(e).__name__}: {e}")

    for sport, finals in sources:
        if not finals:
            continue
        idx = await _team_ids(sport)
        rows = []
        for g in finals:
            considered += 1
            home_name, away_name = g.get("homeTeamName"), g.get("awayTeamName")
            if not home_name or not away_name:
                continue
            hid = idx.get(normalize_team_name(home_name))
            aid = idx.get(normalize_team_name(away_name))
            if not hid or not aid:
                unresolved.append(f"{sport}: {away_name} @ {home_name}")
                continue
            start = _parse_start(g.get("date"))
            if start is None:
                continue
            rows.append({
                "sport": sport, "event_ref": str(g["gameId"]),
                "game_date": start.date(), "event_start": start,
                "home_team_id": hid, "away_team_id": aid,
                "home_team_raw": home_name, "away_team_raw": away_name,
                "home_score": g["homeScore"], "away_score": g["awayScore"],
                "venue": g.get("venue"),
            })
        if rows:
            written += await db.upsert_live_results(rows)

    if unresolved:
        uniq = sorted(set(unresolved))
        warnings.append(f"{len(uniq)} completed game(s) had no resolvable team id: "
                        + "; ".join(uniq[:5]) + ("…" if len(uniq) > 5 else ""))
    return {
        "games": considered, "rows_matched": considered, "rows_written": written,
        "unresolved": len(set(unresolved)), "requests": 0, "objects": 0,
        "warnings": warnings,
    }


async def archive_props(sports: list[str] | None = None) -> dict:
    """Captured pre-game prop prices into prop_odds_archive.

    Mirrors archive_closing_lines — same not-yet-started filter, same freeze —
    with one real difference: prop_odds holds ONE ROW PER SIDE and the archive
    holds one row per prop with over_price and under_price together. So this
    pivots, and DROPS anything quoted on only one side.

    That drop is deliberate. A one-sided prop cannot be de-vigged, and the whole
    reason the model plan can measure prop CLV at all is that both ends exist —
    measured on the imported archive, 443,990 MLB props carry both. Storing a
    half-priced row would look like data and be unusable.
    """
    now = datetime.now(timezone.utc)
    written = 0
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
            if start is not None and start > now:
                upcoming[str(g.game_id)] = (g, start)
        if not upcoming:
            continue

        # SERVER-SIDE. This used to fetch every latest quote (13,542 rows per
        # call, ~2,000 calls/day), pivot over/under in Python, discard every
        # one-sided quote, and write the survivors back to the same database --
        # 27.3M rows/day making a round trip to be reshaped. The pivot, the
        # two-sided filter and the insert now all happen inside Postgres, so no
        # result set crosses the pooler at all.
        #
        # Proven identical to the Python path before replacing it:
        # test_prop_archive_equiv.py compared 36,361 rows across 7 sports with
        # zero mismatches, full row tuples under an exact key.
        ids = list(upcoming)
        written += await db.archive_props_server_side(
            ids, ids, [sport] * len(ids),
            [upcoming[i][1].date() for i in ids],
            [upcoming[i][1] for i in ids])

    # one_sided is no longer counted: counting it meant having the discarded
    # rows in memory, which is exactly the transfer this change removes. The
    # filter still happens -- server-side -- it is simply not tallied. Restoring
    # the tally would cost a second pass over the same CTE for one integer.
    return {
        "games": 0, "rows_matched": written, "rows_written": written,
        "unresolved": 0, "requests": 0, "objects": 0, "warnings": warnings,
    }
