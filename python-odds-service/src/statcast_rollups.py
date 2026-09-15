"""R5a — Statcast rollups for the MLB research pages, from the pitch corpus.

`mlb_pitch_events` keeps five days in Postgres; whole seasons live only in the
Parquet corpus. The player, team and game pages need season views of it — power
profile, arsenal, zone map, splits, team contact quality, the starters card — and
a page cannot read the corpus. So this computes those views and stores them in
three small tables TypeScript reads directly:

  mlb_statcast_player_season   one row per (season, player, bat|pit)
  mlb_statcast_team_season     one row per (season, team, bat|pit)
  mlb_statcast_game_pregame    one row per game: both starters and the opposing
                               hitters, cut at the day before the game

WHERE THIS RUNS: THE OPERATOR'S MACHINE (operator decision, 2026-09-14), after
the corpus refresh — `build_statcast_rollups.py`, chained in
`run-corpus-refresh.bat`. The worker has no corpus credentials and a 512 MB
ceiling the corpus read already measured against.

THE FORMULAS ARE THE G2 TOOLS', ON PURPOSE. The mockup datasets
(`docs/design/phase-g2/tools/build_player_data.py`, `build_team_data.py`,
`pregame.py`) are the spec the pages are rebuilt to, and R5's verify step is
"rollup values match the G2 datasets". Each block below names its G2 source.
Three things differ, each a correction:

  - REGULAR SEASON ONLY. The corpus holds Savant's spring training (`S`, 173k
    pitches across 2025-26) and postseason rows, and G2 counted them. Game type
    comes from the StatsAPI schedule, since the corpus has no such column.
    `game_types=None` reproduces G2 exactly, for the parity check.
  - EVERY HOME RUN IN THE LIST, WITH DISTANCE. G2 listed only home runs with an
    exit velocity and had no distance (dropped at ingest). Distance comes from
    one Savant query per season filtered to home runs — 5,164 rows for 2026 —
    rather than a new corpus column, because the season HR list is the only
    card that needs it and today's game has it from the live feed (R4).
  - LOCATIONS CAPPED AT 500 per qualified pitcher (G2: 900 for anyone), to keep
    the table small. The zone map carries the full distribution.
"""
from __future__ import annotations

import bisect
import json
import math
from collections import defaultdict
from datetime import date

SW = ("swinging_strike", "swinging_strike_blocked", "foul", "foul_tip", "hit_into_play", "foul_bunt", "missed_bunt")
WH = ("swinging_strike", "swinging_strike_blocked", "missed_bunt")
HIT_BASES = {"single": 1, "double": 2, "triple": 3, "home_run": 4}
# Plate appearances that are not at-bats (G2 player splits).
NON_AB = ("walk", "hit_by_pitch", "sac_fly", "sac_bunt", "catcher_interf", "intent_walk", "sac_fly_double_play")
# At-bat outcomes (G2 pregame): hits plus outs and errors.
AB_OUT = ("single", "double", "triple", "home_run", "strikeout", "field_out", "grounded_into_double_play", "force_out",
          "fielders_choice", "double_play", "field_error", "strikeout_double_play", "fielders_choice_out", "triple_play")
# Plate-appearance endings (G2 team rollup).
PA_END = ("strikeout", "walk", "single", "double", "triple", "home_run", "field_out", "grounded_into_double_play",
          "force_out", "sac_fly", "hit_by_pitch", "fielders_choice", "double_play", "field_error",
          "strikeout_double_play", "fielders_choice_out", "sac_bunt", "intent_walk", "catcher_interf",
          "sac_fly_double_play", "triple_play")
STRIKEOUTS = ("strikeout", "strikeout_double_play")
WALKS = ("walk", "intent_walk")

LOCATION_CAP = 500
QUALIFIED_PITCHES = 500
# Team metrics and which way is good for the side that owns them.
TEAM_METRICS = ("avgEV", "hardHit", "sweetSpot", "barrelish", "kPct", "bbPct", "whiff", "chase", "hrPct", "ffVelo")
_BAT_HIGHER_IS_BETTER = {"avgEV": True, "hardHit": True, "sweetSpot": True, "barrelish": True, "kPct": False,
                         "bbPct": True, "whiff": False, "chase": False, "hrPct": True, "ffVelo": None}


def _sql_list(values) -> str:
    return "(" + ", ".join("'" + v.replace("'", "''") + "'" for v in values) + ")"


def _r(v, nd=1):
    return None if v is None else round(float(v), nd)


def _pct(num, den, nd=1):
    return round(100 * num / den, nd) if den else None


# ---------------------------------------------------------------------------
# sources
# ---------------------------------------------------------------------------

def register_pitch_scope(con, season: int, through: date, game_types: tuple[str, ...] | None) -> int:
    """`scope` = one season's pitches through a date, optionally one set of game
    types. Expects a `pitches` view (corpus UNION Postgres) and, when filtering,
    a `game_types(game_pk, game_type)` table. Returns the pitch count."""
    join = "JOIN game_types g ON g.game_pk = p.game_pk" if game_types else ""
    where = f"AND g.game_type IN {_sql_list(game_types)}" if game_types else ""
    con.execute(f"""
        CREATE OR REPLACE TEMP TABLE scope AS
        SELECT p.* FROM pitches p {join}
         WHERE p.season = {int(season)} AND p.game_date <= DATE '{through.isoformat()}' {where}
    """)
    return con.execute("SELECT count(*) FROM scope").fetchone()[0]


def schedule_rows(schedule_json: dict) -> list[tuple]:
    """(game_pk, game_type, official_date, home_id, away_id) from a StatsAPI schedule response."""
    out = []
    for d in schedule_json.get("dates") or []:
        for g in d.get("games") or []:
            out.append((int(g["gamePk"]), g.get("gameType"), g.get("officialDate") or d.get("date"),
                        (g.get("teams") or {}).get("home", {}).get("team", {}).get("id"),
                        (g.get("teams") or {}).get("away", {}).get("team", {}).get("id")))
    return out


def home_run_distance_rows(csv_text: str) -> list[tuple]:
    """(game_pk, at_bat_number, pitch_number, distance) from a Savant home-run CSV."""
    import csv
    import io

    out = []
    for row in csv.DictReader(io.StringIO(csv_text.lstrip("﻿"))):
        try:
            key = (int(row["game_pk"]), int(row["at_bat_number"]), int(row["pitch_number"]))
        except (KeyError, ValueError):
            continue
        raw = (row.get("hit_distance_sc") or "").strip()
        dist = float(raw) if raw and raw.lower() != "null" else None
        out.append((*key, dist))
    return out


# ---------------------------------------------------------------------------
# players (G2: build_player_data.mlb_extras)
# ---------------------------------------------------------------------------

_ROLE_CTE = """
    WITH r AS (
        SELECT 'bat' AS role, batter_id AS pid, p_throws AS opp_hand, * FROM scope
        UNION ALL
        SELECT 'pit' AS role, pitcher_id AS pid, stand AS opp_hand, * FROM scope
    )
"""


def player_blocks(con, with_hr_distance: bool = True) -> dict[tuple[str, int], dict]:
    """(role, player_id) -> the season block G2 calls `statcast.seasons[season]`."""
    sw, wh, nonab, hits = _sql_list(SW), _sql_list(WH), _sql_list(NON_AB), _sql_list(HIT_BASES)
    blocks: dict[tuple[str, int], dict] = {}

    for role, pid, pitches, evs in con.execute(_ROLE_CTE + """
        SELECT role, pid, count(*) AS pitches,
               list(launch_speed ORDER BY launch_speed) FILTER (WHERE description = 'hit_into_play' AND launch_speed IS NOT NULL)
          FROM r GROUP BY role, pid
    """).fetchall():
        evs = [float(v) for v in (evs or [])]
        blocks[(role, pid)] = {
            "pitches": pitches, "bip": len(evs),
            "maxEV": _r(max(evs)) if evs else None,
            "avgEV": _r(sum(evs) / len(evs)) if evs else None,
            "p90EV": _r(evs[int(0.9 * len(evs))]) if evs else None,
            "hardHit": _pct(sum(1 for v in evs if v >= 95), len(evs)),
            "evHist": [{"lo": lo, "n": sum(1 for v in evs if lo <= v < lo + 2)} for lo in range(40, 122, 2)] if evs else [],
            "sweetSpot": None, "barrelish": None,
            "pitchTypes": [], "zones": {}, "splitsByHand": {}, "trend": [], "hrList": [],
        }

    for role, pid, sweet, barrel in con.execute(_ROLE_CTE + """
        SELECT role, pid,
               count(*) FILTER (WHERE launch_angle BETWEEN 8 AND 32),
               count(*) FILTER (WHERE launch_speed >= 98 AND launch_angle BETWEEN 26 AND 30)
          FROM r WHERE description = 'hit_into_play' AND launch_speed IS NOT NULL GROUP BY role, pid
    """).fetchall():
        b = blocks[(role, pid)]
        b["sweetSpot"] = _pct(sweet, b["bip"])
        b["barrelish"] = _pct(barrel, b["bip"])

    for role, pid, ptype, n, velo, swings, whiffs, called, bip, xw, ev in con.execute(_ROLE_CTE + f"""
        SELECT role, pid, coalesce(pitch_type, '?'), count(*),
               avg(release_speed) FILTER (WHERE release_speed IS NOT NULL AND release_speed <> 0),
               count(*) FILTER (WHERE description IN {sw}), count(*) FILTER (WHERE description IN {wh}),
               count(*) FILTER (WHERE description = 'called_strike'),
               count(*) FILTER (WHERE description = 'hit_into_play'),
               avg(estimated_woba) FILTER (WHERE description = 'hit_into_play' AND estimated_woba IS NOT NULL),
               avg(launch_speed) FILTER (WHERE description = 'hit_into_play' AND launch_speed IS NOT NULL)
          FROM r GROUP BY ALL HAVING count(*) >= 25
    """).fetchall():
        b = blocks[(role, pid)]
        b["pitchTypes"].append({"type": ptype, "n": n, "usage": _pct(n, b["pitches"]), "velo": _r(velo),
                                "whiff": _pct(whiffs, swings), "csw": _pct(called + whiffs, n), "bip": bip,
                                "xwoba": _r(xw, 3), "ev": _r(ev)})

    for role, pid, zone, n, swings, whiffs, xw in con.execute(_ROLE_CTE + f"""
        SELECT role, pid, zone, count(*),
               count(*) FILTER (WHERE description IN {sw}), count(*) FILTER (WHERE description IN {wh}),
               avg(estimated_woba) FILTER (WHERE description = 'hit_into_play' AND estimated_woba IS NOT NULL)
          FROM r WHERE zone BETWEEN 1 AND 14 GROUP BY ALL
    """).fetchall():
        b = blocks[(role, pid)]
        b["zones"][str(zone)] = {"n": n, "share": _pct(n, b["pitches"]), "swing": _pct(swings, n),
                                 "whiff": _pct(whiffs, max(1, swings)), "xwoba": _r(xw, 3)}

    tb_case = "CASE events " + " ".join(f"WHEN '{k}' THEN {v}" for k, v in HIT_BASES.items()) + " ELSE 0 END"
    for role, pid, hand, pa, ab, h, tb, k, bb, hr, xw in con.execute(_ROLE_CTE + f"""
        SELECT role, pid, opp_hand, count(*),
               count(*) FILTER (WHERE events NOT IN {nonab}),
               count(*) FILTER (WHERE events NOT IN {nonab} AND events IN {hits}),
               sum({tb_case}) FILTER (WHERE events NOT IN {nonab}),
               count(*) FILTER (WHERE events IN {_sql_list(STRIKEOUTS)}),
               count(*) FILTER (WHERE events IN {_sql_list(WALKS)}),
               count(*) FILTER (WHERE events = 'home_run'),
               avg(estimated_woba) FILTER (WHERE estimated_woba IS NOT NULL AND description = 'hit_into_play')
          FROM r WHERE events IS NOT NULL AND opp_hand IN ('L', 'R') GROUP BY ALL
    """).fetchall():
        blocks[(role, pid)]["splitsByHand"][hand] = {
            "pa": pa, "avg": round(h / ab, 3) if ab else None, "slg": round((tb or 0) / ab, 3) if ab else None,
            "kPct": _pct(k, pa), "bbPct": _pct(bb, pa), "hr": hr, "xwobacon": _r(xw, 3)}

    # Hitter: exit velocity by date. Pitcher: four-seam and sinker velocity by date.
    for role, pid, d, avg, mx, n in con.execute(_ROLE_CTE + """
        SELECT role, pid, game_date,
               avg(CASE WHEN role = 'bat' THEN launch_speed ELSE release_speed END),
               max(CASE WHEN role = 'bat' THEN launch_speed ELSE release_speed END), count(*)
          FROM r
         WHERE (role = 'bat' AND description = 'hit_into_play' AND launch_speed IS NOT NULL)
            OR (role = 'pit' AND pitch_type IN ('FF', 'SI') AND release_speed IS NOT NULL AND release_speed <> 0)
         GROUP BY ALL ORDER BY role, pid, game_date
    """).fetchall():
        blocks[(role, pid)]["trend"].append({"date": str(d), "avg": _r(avg), "max": _r(mx), "n": n})

    dist_join = "LEFT JOIN hr_distance d USING (game_pk, at_bat_number, pitch_number)" if with_hr_distance else ""
    dist_col = "d.distance" if with_hr_distance else "NULL"
    for pid, d, ev, la, ptype, velo, dist in con.execute(f"""
        SELECT s.batter_id, s.game_date, s.launch_speed, s.launch_angle, s.pitch_type, s.release_speed, {dist_col}
          FROM scope s {dist_join}
         WHERE s.events = 'home_run'
         ORDER BY s.batter_id, s.game_date, s.game_pk, s.at_bat_number
    """).fetchall():
        b = blocks.get(("bat", pid))
        if b is not None:
            b["hrList"].append({"date": str(d), "ev": _r(ev), "la": _r(la), "pitch": ptype, "velo": _r(velo), "distance": _r(dist, 0)})

    for pid, locs in con.execute(f"""
        SELECT pitcher_id, list([pitch_type, round(plate_x, 2)::VARCHAR, round(plate_z, 2)::VARCHAR] ORDER BY id DESC)
          FROM scope WHERE plate_x IS NOT NULL AND plate_z IS NOT NULL
         GROUP BY pitcher_id HAVING count(*) >= {QUALIFIED_PITCHES}
    """).fetchall():
        b = blocks.get(("pit", pid))
        if b is not None:
            b["locations"] = [[t, float(x), float(z)] for t, x, z in reversed(locs[:LOCATION_CAP])]

    for b in blocks.values():
        b["pitchTypes"].sort(key=lambda x: -x["n"])
    return blocks


def attach_pitch_profiles(con, blocks: dict) -> None:
    """`profile`: the shape `lib/sports/mlb/pitchProfileShapes.PitchProfile` has
    always had, with the aggregates `pitchProfile.ts` used to run on Postgres.

    Why this is here: since Phase 5 prunes `mlb_pitch_events` to about five
    days, those aggregates described the last few days and labelled them the
    season (found in R5). Unlike the G2 blocks above, nothing is filtered to 25+
    pitches, so shares still sum to 100, and every xwOBA carries the count of
    rows behind it (`xwobaSample`)."""
    xw = "avg(estimated_woba) FILTER (WHERE description = 'hit_into_play')"
    xw_n = "count(estimated_woba) FILTER (WHERE description = 'hit_into_play')"
    bip = "count(*) FILTER (WHERE description = 'hit_into_play')"
    profiles: dict[tuple[str, int], dict] = defaultdict(lambda: {"zones": [], "pitchTypes": [], "platoon": []})
    for role, pid, zone, x, n, b, p in con.execute(_ROLE_CTE + f"""
        SELECT role, pid, zone, {xw}, {xw_n}, {bip}, count(*) FROM r WHERE zone IS NOT NULL GROUP BY ALL ORDER BY zone
    """).fetchall():
        profiles[(role, pid)]["zones"].append({"zone": zone, "xwoba": x, "xwobaSample": n, "ballsInPlay": b, "pitches": p})
    for role, pid, ptype, p, x, n, b, velo in con.execute(_ROLE_CTE + f"""
        SELECT role, pid, pitch_type, count(*), {xw}, {xw_n}, {bip}, avg(release_speed)
          FROM r WHERE pitch_type IS NOT NULL GROUP BY ALL ORDER BY count(*) DESC
    """).fetchall():
        profiles[(role, pid)]["pitchTypes"].append({"pitchType": ptype, "pitches": p, "xwoba": x, "xwobaSample": n,
                                                    "ballsInPlay": b, "avgVelocity": velo})
    for role, pid, hand, p, b, x, n in con.execute(_ROLE_CTE + f"""
        SELECT role, pid, opp_hand, count(*), {bip}, {xw}, {xw_n} FROM r WHERE opp_hand IS NOT NULL GROUP BY ALL ORDER BY opp_hand
    """).fetchall():
        profiles[(role, pid)]["platoon"].append({"hand": hand, "pitches": p, "ballsInPlay": b, "xwoba": x, "xwobaSample": n})
    for key, prof in profiles.items():
        total = sum(t["pitches"] for t in prof["pitchTypes"])
        for t in prof["pitchTypes"]:
            t["share"] = (100 * t["pitches"] / total) if total else 0
        prof["totalPitches"] = total
        if key in blocks:
            blocks[key]["profile"] = prof


def hitter_percentiles(con, blocks: dict, min_bip: int) -> int:
    """League percentiles among hitters with at least `min_bip` balls in play
    (G2: 150 on 2026-09-11). Written into each qualified hitter's block; the
    unqualified get none rather than a percentile of a tiny sample."""
    lists = {pid: [float(v) for v in evs] for pid, evs in con.execute("""
        SELECT batter_id, list(launch_speed) FROM scope
         WHERE description = 'hit_into_play' AND launch_speed IS NOT NULL GROUP BY batter_id
    """).fetchall()}
    pool = {pid: evs for pid, evs in lists.items() if len(evs) >= min_bip}
    if not pool:
        return 0
    metrics = {
        "maxEV": max,
        "avgEV": lambda v: sum(v) / len(v),
        "p90EV": lambda v: sorted(v)[int(0.9 * len(v))],
        "hardHit": lambda v: sum(1 for x in v if x >= 95) / len(v),
    }
    values = {m: {pid: f(evs) for pid, evs in pool.items()} for m, f in metrics.items()}
    ranked = {m: sorted(vals.values()) for m, vals in values.items()}
    for pid in pool:
        b = blocks.get(("bat", pid))
        if b is None:
            continue
        out = {"pool": len(pool), "minBip": min_bip}
        for m in metrics:
            out[m] = round(100 * bisect.bisect_right(ranked[m], values[m][pid]) / len(pool))
        for m in ("sweetSpot", "barrelish"):
            vals = sorted(blocks[("bat", q)].get(m) or 0 for q in pool if ("bat", q) in blocks)
            out[m] = round(100 * bisect.bisect_right(vals, b.get(m) or 0) / len(vals))
        b["percentiles"] = out
    return len(pool)


def qualified_bip(games_played_max: int) -> int:
    """One ball in play per team game, the league's most games played so far.
    G2 used a fixed 150 on 2026-09-11, when teams had played ~145."""
    return max(25, int(games_played_max))


# ---------------------------------------------------------------------------
# teams (G2: build_team_data.mlb_statcast), plus splits by hand
# ---------------------------------------------------------------------------

def team_blocks(con) -> tuple[dict[tuple[str, str], dict], int, int]:
    """(side, team_id) -> metrics, with league distributions and percentiles.

    Expects `team_of(game_pk BIGINT, player_id BIGINT, team_id VARCHAR)`.
    Returns (blocks, pitches joined, pitches total)."""
    sw, wh, pa_end = _sql_list(SW), _sql_list(WH), _sql_list(PA_END)
    base = """
        WITH t AS (
            SELECT s.*, bt.team_id AS bat_team, pt.team_id AS pit_team
              FROM scope s
              LEFT JOIN team_of bt ON bt.game_pk = s.game_pk AND bt.player_id = s.batter_id
              LEFT JOIN team_of pt ON pt.game_pk = s.game_pk AND pt.player_id = s.pitcher_id
        ), sides AS (
            SELECT 'bat' AS side, bat_team AS team, p_throws AS opp_hand, * FROM t WHERE bat_team IS NOT NULL
            UNION ALL
            SELECT 'pit' AS side, pit_team AS team, stand AS opp_hand, * FROM t WHERE pit_team IS NOT NULL
        )
    """
    joined, total = con.execute(base + "SELECT count(*) FILTER (WHERE bat_team IS NOT NULL OR pit_team IS NOT NULL), count(*) FROM t").fetchone()
    agg = f"""
        count(*) AS pitches,
        count(*) FILTER (WHERE description IN {sw}) AS swings,
        count(*) FILTER (WHERE description IN {wh}) AS whiffs,
        count(*) FILTER (WHERE zone > 9) AS outside,
        count(*) FILTER (WHERE zone > 9 AND description IN {sw}) AS chase,
        count(*) FILTER (WHERE events IN {pa_end}) AS pa,
        count(*) FILTER (WHERE events IN {_sql_list(STRIKEOUTS)}) AS k,
        count(*) FILTER (WHERE events IN {_sql_list(WALKS)}) AS bb,
        count(*) FILTER (WHERE events = 'home_run') AS hr,
        count(*) FILTER (WHERE events IN {pa_end} AND events IN {_sql_list(AB_OUT)}) AS ab,
        count(*) FILTER (WHERE events IN {_sql_list(HIT_BASES)}) AS hits,
        count(*) FILTER (WHERE launch_speed IS NOT NULL AND description = 'hit_into_play') AS bip,
        sum(launch_speed) FILTER (WHERE launch_speed IS NOT NULL AND description = 'hit_into_play') AS ev,
        count(*) FILTER (WHERE launch_speed >= 95 AND description = 'hit_into_play') AS hard,
        count(*) FILTER (WHERE launch_speed IS NOT NULL AND description = 'hit_into_play' AND launch_angle BETWEEN 8 AND 32) AS sweet,
        count(*) FILTER (WHERE launch_speed >= 98 AND description = 'hit_into_play' AND launch_angle BETWEEN 26 AND 30) AS barrel,
        avg(estimated_woba) FILTER (WHERE estimated_woba IS NOT NULL AND description = 'hit_into_play') AS xwobacon,
        count(*) FILTER (WHERE side = 'pit' AND pitch_type = 'FF' AND release_speed IS NOT NULL AND release_speed <> 0) AS ffn,
        sum(release_speed) FILTER (WHERE side = 'pit' AND pitch_type = 'FF' AND release_speed IS NOT NULL AND release_speed <> 0) AS ffv
    """

    def metrics(a: dict) -> dict:
        d = lambda x, y: (100 * x / y) if y else None  # noqa: E731
        return {"avgEV": a["ev"] / a["bip"] if a["bip"] else None, "hardHit": d(a["hard"], a["bip"]),
                "sweetSpot": d(a["sweet"], a["bip"]), "barrelish": d(a["barrel"], a["bip"]),
                "kPct": d(a["k"], a["pa"]), "bbPct": d(a["bb"], a["pa"]), "whiff": d(a["whiffs"], a["swings"]),
                "chase": d(a["chase"], a["outside"]), "hrPct": d(a["hr"], a["pa"]),
                "ffVelo": a["ffv"] / a["ffn"] if a["ffn"] else None, "pitches": float(a["pitches"])}

    cur = con.execute(base + f"SELECT side, team, {agg} FROM sides GROUP BY side, team")
    cols = [c[0] for c in cur.description]
    blocks: dict[tuple[str, str], dict] = {}
    for row in cur.fetchall():
        a = dict(zip(cols, row))
        blocks[(a["side"], str(a["team"]))] = {"metrics": metrics(a), "vsHand": {}}

    cur = con.execute(base + f"SELECT side, team, opp_hand, {agg} FROM sides WHERE opp_hand IN ('L', 'R') GROUP BY ALL")
    cols = [c[0] for c in cur.description]
    for row in cur.fetchall():
        a = dict(zip(cols, row))
        m = metrics(a)
        blocks[(a["side"], str(a["team"]))]["vsHand"][a["opp_hand"]] = {
            "pa": a["pa"], "avg": round(a["hits"] / a["ab"], 3) if a["ab"] else None,
            "kPct": _r(m["kPct"]), "bbPct": _r(m["bbPct"]), "hrPct": _r(m["hrPct"]),
            "xwobacon": _r(a["xwobacon"], 3), "avgEV": _r(m["avgEV"]), "hardHit": _r(m["hardHit"])}

    for side in ("bat", "pit"):
        league = {team: b["metrics"] for (s, team), b in blocks.items() if s == side}
        for team, m in league.items():
            b = blocks[(side, team)]
            b["league"] = {k: sorted(v[k] for v in league.values() if v[k] is not None) for k in m}
            b["teams"] = len(league)
            pct = {}
            for k in TEAM_METRICS:
                vals = b["league"].get(k) or []
                if m.get(k) is None or not vals:
                    continue
                better_high = _BAT_HIGHER_IS_BETTER[k]
                if better_high is None:
                    better_high = True  # fastball velocity: higher is better for the staff that throws it
                elif side == "pit":
                    better_high = not better_high  # a staff wants the opposite of a lineup
                below = sum(1 for v in vals if v < m[k])
                share = below / (len(vals) - 1) if len(vals) > 1 else 0.5
                pct[k] = round(100 * (share if better_high else 1 - share))
            b["percentiles"] = pct
    return blocks, joined, total


# ---------------------------------------------------------------------------
# starters before a game (G2: pregame.mlb_starters)
# ---------------------------------------------------------------------------

def starter_block(con, pitcher_id: int, hitter_ids: list[int], season: int, before: date,
                  game_types: tuple[str, ...] | None) -> dict:
    """Pitch mix and hand for one starter, and each opposing hitter against that
    hand and against this pitcher, from every pitch strictly before `before`.

    Mix and splits are this season; head-to-head is every season the corpus
    holds, as G2's was. `hitter_ids` is the opposing ROSTER, not a lineup: the
    lineup is not known when this runs, and the page orders these by the posted
    lineup when there is one."""
    types = f"AND g.game_type IN {_sql_list(game_types)}" if game_types else ""
    join = "JOIN game_types g ON g.game_pk = p.game_pk" if game_types else ""
    ids = ", ".join(str(int(i)) for i in hitter_ids) or "NULL"
    con.execute(f"""
        CREATE OR REPLACE TEMP TABLE before_game AS
        SELECT p.* FROM pitches p {join}
         WHERE p.game_date < DATE '{before.isoformat()}' {types}
           AND (p.pitcher_id = {int(pitcher_id)} OR p.batter_id IN ({ids}))
    """)
    sw, wh = _sql_list(SW), _sql_list(WH)
    hand = con.execute(f"SELECT p_throws FROM before_game WHERE pitcher_id = {int(pitcher_id)} AND season = {int(season)} LIMIT 1").fetchone()
    hand = hand[0] if hand else None
    total = con.execute(f"SELECT count(*) FROM before_game WHERE pitcher_id = {int(pitcher_id)} AND season = {int(season)}").fetchone()[0]
    mix = [{"type": t, "n": n, "share": _pct(n, total), "velo": _r(v), "whiff": _pct(w, s)}
           for t, n, v, s, w in con.execute(f"""
               SELECT coalesce(pitch_type, '?'), count(*),
                      avg(release_speed) FILTER (WHERE release_speed IS NOT NULL AND release_speed <> 0),
                      count(*) FILTER (WHERE description IN {sw}), count(*) FILTER (WHERE description IN {wh})
                 FROM before_game WHERE pitcher_id = {int(pitcher_id)} AND season = {int(season)}
                GROUP BY 1 ORDER BY 2 DESC""").fetchall()]

    hits, ab_out = _sql_list(HIT_BASES), _sql_list(AB_OUT)
    vs_hand = {}
    if hand:
        for bid, pa, ab, h, k, xw in con.execute(f"""
            SELECT batter_id, count(*) FILTER (WHERE events IS NOT NULL),
                   count(*) FILTER (WHERE events IN {ab_out}), count(*) FILTER (WHERE events IN {hits}),
                   count(*) FILTER (WHERE events IN {_sql_list(STRIKEOUTS)}),
                   avg(estimated_woba) FILTER (WHERE estimated_woba IS NOT NULL AND description = 'hit_into_play')
              FROM before_game WHERE batter_id IN ({ids}) AND p_throws = '{hand}' AND season = {int(season)}
             GROUP BY 1""").fetchall():
            vs_hand[bid] = {"pa": pa, "avg": round(h / ab, 3) if ab else None, "k": _pct(k, pa), "xwobacon": _r(xw, 3)}
    h2h = {}
    for bid, pa, h, hr, k, bb, ab in con.execute(f"""
        SELECT batter_id, count(*), count(*) FILTER (WHERE events IN {hits}),
               count(*) FILTER (WHERE events = 'home_run'), count(*) FILTER (WHERE events IN {_sql_list(STRIKEOUTS)}),
               count(*) FILTER (WHERE events IN {_sql_list(WALKS)}), count(*) FILTER (WHERE events IN {ab_out})
          FROM before_game WHERE batter_id IN ({ids}) AND pitcher_id = {int(pitcher_id)} AND events IS NOT NULL
         GROUP BY 1""").fetchall():
        h2h[bid] = {"pa": pa, "h": h, "hr": hr, "k": k, "bb": bb, "ab": ab}
    bats = dict(con.execute(f"""
        SELECT batter_id, mode(stand) FROM before_game WHERE batter_id IN ({ids}) GROUP BY 1""").fetchall())
    empty_h2h = {"pa": 0, "h": 0, "hr": 0, "k": 0, "bb": 0, "ab": 0}
    return {
        "id": int(pitcher_id), "hand": hand, "pitches": total, "mix": mix,
        "hitters": {str(b): {"bats": bats.get(b), "vsHand": vs_hand.get(b, {"pa": 0, "avg": None, "k": None, "xwobacon": None}),
                             "vsPitcher": h2h.get(b, empty_h2h)} for b in hitter_ids},
    }


def pitcher_season_line(history_rows: list[dict]) -> dict:
    """Season line and last starts from `player_game_history` rows before the
    game (G2: pregame.mlb_starters). Innings are summed as OUTS — MLB writes
    6.2 for six and two-thirds, which is not a decimal (R2)."""
    tot = defaultdict(float)
    log = []
    for r in history_rows:
        st = r["stats"] if isinstance(r["stats"], dict) else json.loads(r["stats"])
        ip = st.get("pit_inningsPitched")
        if ip is None:
            continue
        whole = math.floor(ip)
        tot["outs"] += whole * 3 + round((ip - whole) * 10)
        for k in ("pit_earnedRuns", "pit_strikeOuts", "pit_baseOnBalls", "pit_hits", "pit_homeRuns"):
            tot[k] += st.get(k) or 0
        tot["gs"] += st.get("pit_gamesStarted") or 0
        log.append([str(r["game_date"]), str(r["opponent_id"]), ip, st.get("pit_hits"), st.get("pit_earnedRuns"),
                    st.get("pit_baseOnBalls"), st.get("pit_strikeOuts")])
    outs = tot["outs"]
    return {
        "season": {"gs": tot["gs"], "ip": f"{int(outs // 3)}.{int(outs % 3)}",
                   "era": round(27 * tot["pit_earnedRuns"] / outs, 2) if outs else None,
                   "whip": round(3 * (tot["pit_hits"] + tot["pit_baseOnBalls"]) / outs, 2) if outs else None,
                   "k": tot["pit_strikeOuts"], "bb": tot["pit_baseOnBalls"], "hr": tot["pit_homeRuns"]},
        "log": log[-6:],
    }


def hitter_season_line(history_rows: list[dict]) -> dict:
    st = defaultdict(float)
    for r in history_rows:
        s = r["stats"] if isinstance(r["stats"], dict) else json.loads(r["stats"])
        for k in ("bat_atBats", "bat_hits", "bat_homeRuns", "bat_baseOnBalls", "bat_strikeOuts", "bat_totalBases",
                  "bat_plateAppearances", "bat_hitByPitch"):
            st[k] += s.get(k) or 0
    ab, pa = st["bat_atBats"], st["bat_plateAppearances"]
    return {"pa": pa, "avg": round(st["bat_hits"] / ab, 3) if ab else None,
            "obp": round((st["bat_hits"] + st["bat_baseOnBalls"] + st["bat_hitByPitch"]) / pa, 3) if pa else None,
            "slg": round(st["bat_totalBases"] / ab, 3) if ab else None, "hr": st["bat_homeRuns"]}
