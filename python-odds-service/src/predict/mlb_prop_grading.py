"""Grades MLB `pick_history` rows against what actually happened.

Direct port of lib/odds/props/grading.ts — not a reimplementation. Task
2.7b of docs/audit-remediation-plan.md, standing decision Q13.

Until now this ran inside TypeScript's snapshot rebuild
(lib/sports/mlb/snapshotRebuild.ts), on that file's own 4-minute
per-process `setInterval`. Grading is model bookkeeping, not rendering, so
under Q2 it belongs here; and being per-process it ran N times on N app
instances, which is the same class of problem task 2.7c fixed for the
timers themselves.

One `get_live_feed` call per game supplies both the final box score and the
1st-inning linescore, so every table-driven market plus `hit-in-game` and
`first-inning` grades from a single fetch — no new data source.

`vs-LHP`/`vs-RHP` are still not graded. Grading them needs the specific
opposing starter's handedness for that past game, which the live feed
doesn't surface as directly as the other three. Carried over from the TS
original deliberately: a real gap, left visible rather than guessed at.

Generic (non-MLB) prop grading is a separate module,
predict/generic_prop_grading.py, and stays separate — it grades against
ESPN gamelogs for six sports, where this grades against the MLB Stats API
live feed. Merging them would mean one function with two unrelated halves.
"""
from dataclasses import dataclass

import httpx

import db
from entity_resolution import candidate_category_to_side
from predict.odds_math import american_to_decimal, devig_two_way
from predict.prop_candidates import PITCHER_MARKET_DIMENSIONS, STAT_MARKET_BY_DIMENSION
from predict.statsapi import MlbLiveFeed, get_live_feed


@dataclass
class GradingSummary:
    games_checked: int = 0
    games_final: int = 0
    rows_graded: int = 0
    rows_skipped: int = 0


def _num(value, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _ts(iso: str) -> float | None:
    """ISO -> epoch seconds, or None. Used only for "closest in time"
    comparisons, so an unparseable timestamp must drop the point rather
    than sort as 0 and win every comparison."""
    from datetime import datetime

    if not iso:
        return None
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp()
    except (TypeError, ValueError):
        return None


def find_closest_price_pair(
    points: list[db.PropOddsHistoryPoint], surfaced_at: str
) -> tuple[db.PropOddsHistoryPoint, db.PropOddsHistoryPoint] | None:
    """The (over, under) pair observed closest in time to when the candidate
    was surfaced, from a SINGLE (provider, bookmaker).

    Grouping by book before picking is the whole point, and is easy to get
    wrong by simplifying: taking the closest over and the closest under
    independently can pull the two sides from different books, and the
    devig of a cross-book pair misrepresents the vig — which is exactly the
    number this join exists to remove."""
    target = _ts(surfaced_at)
    if target is None:
        return None

    by_book: dict[str, list[db.PropOddsHistoryPoint]] = {}
    for p in points:
        by_book.setdefault(f"{p.provider_id}:{p.bookmaker}", []).append(p)

    best: tuple[db.PropOddsHistoryPoint, db.PropOddsHistoryPoint, float] | None = None
    for pts in by_book.values():
        overs = [(p, _ts(p.observed_at)) for p in pts if p.side == "over"]
        unders = [(p, _ts(p.observed_at)) for p in pts if p.side == "under"]
        overs = [(p, t) for p, t in overs if t is not None]
        unders = [(p, t) for p, t in unders if t is not None]
        if not overs or not unders:
            continue
        over, over_t = min(overs, key=lambda pt: abs(pt[1] - target))
        under, under_t = min(unders, key=lambda pt: abs(pt[1] - target))
        diff = abs(over_t - target) + abs(under_t - target)
        if best is None or diff < best[2]:
            best = (over, under, diff)
    return (best[0], best[1]) if best else None


async def join_market_side(row: db.UngradedRow, game_id: str) -> dict:
    """Market probability + edge, when the row has a model prediction and a
    genuine two-sided price exists to join against. Returns {} when it
    doesn't — grading still records the outcome."""
    if not row.market_key or row.model_prob is None:
        return {}
    points = await db.read_prop_odds_history_for_key(game_id, row.subject_id, row.market_key, row.line)
    if not points:
        return {}
    pair = find_closest_price_pair(points, row.surfaced_at)
    if pair is None:
        return {}
    over, under = pair

    devigged = devig_two_way(american_to_decimal(over.american_odds), american_to_decimal(under.american_odds))
    if devigged is None:
        return {}
    over_prob, under_prob = devigged

    # devig_two_way returns (a, b) as (over, under) — over is passed first.
    # Using the over side unconditionally, as the TS original did before
    # Phase 1.1, graded an UNDER candidate against the OVER's market
    # probability and wrote the exact negation of the real edge into
    # pick_history (finding P3 C3). row.model_prob is side-correct at the
    # source; this picks the market side to match it.
    market_prob = under_prob if candidate_category_to_side(row.category) == "under" else over_prob

    return {
        "market_prob": market_prob,
        "edge": row.model_prob - market_prob,
        "price_source": over.provider_id,
        "bookmaker": over.bookmaker,
        "price_captured_at": over.observed_at,
    }


def _find_player(boxscore: dict, subject_id: str) -> tuple[dict, bool] | None:
    teams = boxscore.get("teams") or {}
    home = ((teams.get("home") or {}).get("players") or {}).get(f"ID{subject_id}")
    if home:
        return home.get("stats") or {}, True
    away = ((teams.get("away") or {}).get("players") or {}).get(f"ID{subject_id}")
    if away:
        return away.get("stats") or {}, False
    return None


def grade_moneyline_row(row: db.UngradedRow, feed: MlbLiveFeed) -> db.PickHistoryGrade | None:
    """Grades straight from the final score — no box score needed. A tie
    returns None: it is not a loss, and the MLB feed can briefly report
    equal runs on a game that is not really over."""
    teams = (feed.game_data.get("teams") or {})
    home_id = (teams.get("home") or {}).get("id")
    away_id = (teams.get("away") or {}).get("id")
    ls_teams = feed.linescore.get("teams") or {}
    home_runs = (ls_teams.get("home") or {}).get("runs")
    away_runs = (ls_teams.get("away") or {}).get("runs")
    if home_id is None or away_id is None or home_runs is None or away_runs is None or home_runs == away_runs:
        return None
    winner_id = home_id if home_runs > away_runs else away_id
    won = row.subject_id == f"team-{winner_id}"
    return db.PickHistoryGrade(id=row.id, outcome="win" if won else "loss", actual_value=1.0 if won else 0.0)


def grade_total_row(row: db.UngradedRow, feed: MlbLiveFeed) -> db.PickHistoryGrade | None:
    ls_teams = feed.linescore.get("teams") or {}
    home_runs = (ls_teams.get("home") or {}).get("runs")
    away_runs = (ls_teams.get("away") or {}).get("runs")
    if home_runs is None or away_runs is None or row.line is None:
        return None
    total = _num(home_runs) + _num(away_runs)
    over = total > row.line
    # category is always 'over' for a logged total prediction — see
    # db.log_game_total_predictions.
    won = over if row.category == "over" else not over
    return db.PickHistoryGrade(id=row.id, outcome="win" if won else "loss", actual_value=total)


def grade_row(row: db.UngradedRow, boxscore: dict, innings: list) -> db.PickHistoryGrade | None:
    if row.dimension in ("moneyline", "total"):
        return None  # handled separately — no box score involved

    found = _find_player(boxscore, row.subject_id)
    if found is None:
        return None  # didn't appear in this game's box score (scratched, etc.)
    stats, is_home = found

    if row.dimension == "hit-in-game":
        hits = _num((stats.get("batting") or {}).get("hits"))
        if row.category not in ("hit", "no-hit"):
            return None
        won = hits > 0 if row.category == "hit" else hits == 0
        return db.PickHistoryGrade(id=row.id, outcome="win" if won else "loss", actual_value=hits)

    if row.dimension == "first-inning":
        first = next((i for i in innings if i.get("num") == 1), None)
        if first is None:
            return None
        # The home team pitches the top of the 1st (retiring the away side);
        # the away team pitches the bottom — same convention the candidate
        # side uses.
        side = first.get("away") if is_home else first.get("home")
        runs_allowed = _num((side or {}).get("runs"))
        if row.category not in ("run", "no-run"):
            return None
        won = runs_allowed > 0 if row.category == "run" else runs_allowed == 0
        return db.PickHistoryGrade(id=row.id, outcome="win" if won else "loss", actual_value=runs_allowed)

    definition = STAT_MARKET_BY_DIMENSION.get(row.dimension)
    if definition is None:
        return None  # vs-LHP/vs-RHP or an unrecognised dimension — see module docstring

    stat_group = (stats.get("pitching") if row.dimension in PITCHER_MARKET_DIMENSIONS else stats.get("batting")) or {}
    value = definition.value_of(stat_group)
    line = row.line if row.line is not None else definition.line
    over = value > line
    if row.category not in ("over", "under"):
        return None
    won = over if row.category == "over" else not over
    return db.PickHistoryGrade(id=row.id, outcome="win" if won else "loss", actual_value=value)


async def grade_finished_games(client: httpx.AsyncClient) -> dict:
    """Cheap when there's nothing to grade, which is the common case."""
    game_ids = await db.list_ungraded_game_ids("mlb")
    summary = GradingSummary(games_checked=len(game_ids))

    for game_id in game_ids:
        try:
            game_pk = int(game_id)
        except (TypeError, ValueError):
            continue  # generic-sport game ids are not MLB gamePks

        feed = await get_live_feed(client, game_pk)
        state = ((feed.game_data.get("status") or {}).get("abstractGameState")) if feed else None
        if feed is None or state != "Final":
            continue  # not final yet — try again next run
        summary.games_final += 1

        innings = feed.linescore.get("innings") or []
        rows = await db.list_ungraded_for_game(game_id, "mlb")
        results: list[db.PickHistoryGrade] = []
        for row in rows:
            if row.dimension == "moneyline":
                graded = grade_moneyline_row(row, feed)
            elif row.dimension == "total":
                graded = grade_total_row(row, feed)
            else:
                graded = grade_row(row, feed.boxscore, innings)
            if graded is None:
                summary.rows_skipped += 1
                continue
            market = await join_market_side(row, game_id)
            for key, value in market.items():
                setattr(graded, key, value)
            results.append(graded)

        summary.rows_graded += await db.write_pick_history_grades(results)

    return {
        "games_checked": summary.games_checked,
        "games_final": summary.games_final,
        "rows_graded": summary.rows_graded,
        "rows_skipped": summary.rows_skipped,
    }
