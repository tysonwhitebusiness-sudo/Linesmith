"""R5a verify: the rollups reproduce the G2 mockup datasets field by field.

    python verify_statcast_rollups_g2.py

Runs the rollup functions in G2 MODE — the local corpus FILES THAT EXISTED when
the datasets were built (before 05:40 UTC on 2026-09-14; one partition was
exported later), no date cut and every game type (G2 had neither), no dedupe by
pitch (G2 had none; see R5-F2), and `player_game_history` cut at 2026-08-28
(where it stood then; see R5-F1) — and diffs against:

  player-mlb-witt.json     hitter block and 2026 percentiles (pool of 150+ BIP)
  player-mlb-skubal.json   pitcher block
  team-mlb-royals.json     team contact and pitch quality, both sides
  game-mlb-kc-bos.json     pregame starters (Lugo and his opponent)

Reads one connection's worth of Postgres. Writes nothing.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
import glob
from datetime import date, datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "src"))

import asyncpg  # noqa: E402
import duckdb  # noqa: E402

import statcast_rollups as sr  # noqa: E402
from config import DATABASE_URL  # noqa: E402

G2 = os.path.join(HERE, "..", "docs", "design", "phase-g2", "data")
THROUGH = date(2026, 12, 31)
G2_BUILT = datetime(2026, 9, 14, 5, 40, tzinfo=timezone.utc)
PGH_CUT = date(2026, 8, 28)
FAILS: list[str] = []
CHECKED = 0


def g2(name):
    return json.load(open(os.path.join(G2, name), encoding="utf-8"))


def same(label, mine, theirs, tol=0.051):
    """Numbers within rounding (G2 rounded the same values to one decimal, but
    summed float32s in a different order); everything else exactly."""
    global CHECKED
    CHECKED += 1
    if isinstance(theirs, float) and isinstance(mine, (int, float)) and mine is not None:
        ok = abs(mine - theirs) <= tol
    elif isinstance(theirs, dict) and isinstance(mine, dict):
        for k in theirs:
            same(f"{label}.{k}", mine.get(k), theirs[k], tol)
        return
    elif isinstance(theirs, list) and isinstance(mine, list):
        if len(mine) != len(theirs):
            FAILS.append(f"{label}: length {len(mine)} vs G2 {len(theirs)}")
            return
        for i, (a, b) in enumerate(zip(mine, theirs)):
            same(f"{label}[{i}]", a, b, tol)
        return
    else:
        ok = mine == theirs
    if not ok:
        FAILS.append(f"{label}: {mine!r} vs G2 {theirs!r}")


async def main():
    conn = await asyncpg.connect(DATABASE_URL, statement_cache_size=0)
    con = duckdb.connect()
    files = [f for f in sorted(glob.glob(os.path.join(HERE, "corpus", "mlb_pitch_events", "*.parquet")))
             if datetime.fromtimestamp(os.path.getmtime(f), timezone.utc) < G2_BUILT]
    con.execute(f"CREATE VIEW pitches AS SELECT * FROM read_parquet({files!r})")

    # ---- Witt (hitter) and Skubal (pitcher), 2026 --------------------------
    n = sr.register_pitch_scope(con, 2026, THROUGH, None)
    print(f"2026 scope, {len(files)} corpus files as of the G2 build: {n:,} pitches")
    blocks = sr.player_blocks(con, with_hr_distance=False)
    pool = sr.hitter_percentiles(con, blocks, min_bip=150)
    for slug, key in (("player-mlb-witt.json", ("bat", 677951)), ("player-mlb-skubal.json", ("pit", 669373))):
        doc = g2(slug)["statcast"]
        mine, theirs = blocks[key], doc["seasons"]["2026"]
        for field in ("pitches", "bip", "pitchTypes", "zones", "splitsByHand", "trend", "evHist", "maxEV", "avgEV", "p90EV", "hardHit"):
            same(f"{slug} {field}", mine[field], theirs[field])
        if key[0] == "bat":
            # G2 listed only home runs with an exit velocity; the rollup lists all.
            with_ev = [h for h in mine["hrList"] if h["ev"] is not None]
            # G2 kept corpus file order; the rollup sorts by date.
            key_of = lambda h: (h["date"], h["pitch"], round(h["ev"], 1))  # noqa: E731
            same(f"{slug} hrList (with EV)", sorted(key_of(h) for h in with_ev), sorted(key_of(h) for h in theirs["hrList"]))
            same(f"{slug} percentiles", {k: v for k, v in mine["percentiles"].items() if k in doc["percentiles2026"]}, doc["percentiles2026"])
            print(f"  Witt: {mine['bip']} BIP, {len(mine['hrList'])} HR; pool {pool}")
        else:
            theirs_loc = [[t, round(x, 2), round(z, 2)] for t, x, z in theirs["locations"]][-sr.LOCATION_CAP:]
            same(f"{slug} locations (last {sr.LOCATION_CAP})", mine.get("locations"), theirs_loc, tol=0.006)
            print(f"  Skubal: {mine['pitches']} pitches, {len(mine['pitchTypes'])} pitch types")

    # ---- Royals, both sides ------------------------------------------------
    rows = await conn.fetch("""SELECT event_id, athlete_id, team_id FROM player_game_history
                                WHERE sport='mlb' AND season=2026 AND game_date <= $1""", PGH_CUT)
    con.execute("CREATE OR REPLACE TABLE team_of (game_pk BIGINT, player_id BIGINT, team_id VARCHAR)")
    con.executemany("INSERT INTO team_of VALUES (?, ?, ?)", [(int(r["event_id"]), int(r["athlete_id"]), r["team_id"]) for r in rows])
    tblocks, joined, total = sr.team_blocks(con)
    royals = g2("team-mlb-royals.json")["statcast"]
    same("royals pitchesJoined", joined, royals["pitchesJoined"])
    same("royals pitchesTotal", total, royals["pitchesTotal"])
    for side in ("bat", "pit"):
        same(f"royals {side} team", tblocks[(side, "118")]["metrics"], royals[side]["team"], tol=1e-6)
        same(f"royals {side} league", {k: v for k, v in tblocks[(side, "118")]["league"].items()}, royals[side]["league"], tol=1e-6)
        same(f"royals {side} teams", tblocks[(side, "118")]["teams"], royals[side]["teams"])
    print(f"  Royals: {joined:,} of {total:,} pitches joined")

    # ---- KC @ BOS starters -------------------------------------------------
    game = g2("game-mlb-kc-bos.json")
    starters = game["pregame"]["starters"]
    day = date(2026, 9, 11)
    for side in ("away", "home"):
        st = starters[side]
        lineup = [h["id"] for h in st["vsLineup"]]
        block = sr.starter_block(con, st["id"], lineup, 2026, day, None)
        same(f"{side} starter hand", block["hand"], st["hand"])
        same(f"{side} starter pitches", block["pitches"], st["pitches"])
        same(f"{side} starter mix", block["mix"], st["mix"])
        for h in st["vsLineup"]:
            mine_h = block["hitters"][str(h["id"])]
            same(f"{side} vs {h['name']} bats", mine_h["bats"], h["bats"])
            same(f"{side} vs {h['name']} vsHand", mine_h["vsHand"], h["vsHand"])
            same(f"{side} vs {h['name']} vsPitcher", mine_h["vsPitcher"], h["vsPitcher"])
            hist = await conn.fetch("""SELECT stats FROM player_game_history WHERE sport='mlb' AND athlete_id=$1
                                        AND season=2026 AND game_date < $2 AND game_date <= $3""", str(h["id"]), day, PGH_CUT)
            same(f"{side} vs {h['name']} season", sr.hitter_season_line(hist), h["season"], tol=1e-9)
        hist = await conn.fetch("""SELECT game_date, opponent_id, stats FROM player_game_history WHERE sport='mlb'
                                    AND athlete_id=$1 AND season=2026 AND game_date < $2 AND game_date <= $3
                                    ORDER BY game_date""", str(st["id"]), day, PGH_CUT)
        line = sr.pitcher_season_line(hist)
        same(f"{side} starter season", line["season"], st["season"], tol=1e-9)
        same(f"{side} starter log", line["log"], st["log"], tol=1e-9)
        print(f"  {st['name']}: {block['pitches']} pitches, {len(lineup)} hitters")

    await conn.close()
    print(f"\n{CHECKED} comparisons")
    if FAILS:
        print(f"FAILED ({len(FAILS)}):")
        for f in FAILS[:400]:
            print("  -", f)
        sys.exit(1)
    print("every rollup field matches G2")


asyncio.run(main())
