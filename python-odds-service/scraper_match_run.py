"""Link the odds-scraper's games and prop players to the app's ids (P3, odds build).

    python scraper_match_run.py [--sports mlb,nfl,...] [--report] [--sample 50]

Opens the scraper's scraper.db read-only and the bridge's bridge.db read-write
(src/bridge_state.py), then runs src/scraper_match.run_matching over canonical
games starting in [now - 6 h, now + 14 d] and the prop players of linked games
first seen in the last 3 days. P6's bridge calls the same entry point.

--report prints one line per sport for games and one for players.
--sample N writes docs/design/odds-build/results/p3-sample-<date>.csv: N random
linked games and N random linked players per sport, side by side, for the
hand check (a wrong link fails P3; a miss does not).
"""
import argparse
import asyncio
import csv
import os
import random
import sqlite3
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src"))

from bridge_state import DEFAULT_PATH as STATE_DB  # noqa: E402
from scraper_match import SCRAPER_TO_APP_SPORT, load_app_games, run_matching  # noqa: E402

SCRAPER_DB = r"C:\Users\occy3\Documents\odds-scraper\data\scraper.db"
RESULTS = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "docs", "design", "odds-build", "results"))


def _pct(a, b):
    return f"{100 * a / b:.1f}%" if b else "—"


def report(summary) -> None:
    print("\nsport · canon games · linked · ambiguous · no-game-in-window · other")
    for sport, s in sorted(summary.games.items()):
        print(f"  {sport:11} · {s['canon']:5} · {s['linked']:5} ({_pct(s['linked'], s['canon'])}) · {s['ambiguous']:3} · "
              f"{s['no-game-in-window']:4} · {s['other']:4}")
    print(f"  (canonical games in leagues the app does not cover: {summary.no_app_sport})")
    print("\nsport · prop markets (rows) · players linked (% of rows) · not-on-roster · ambiguous · no-app-game")
    for sport, s in sorted(summary.players.items()):
        print(f"  {sport:11} · {s['markets']:8} · {s['linked_markets']:8} ({_pct(s['linked_markets'], s['markets'])}) · "
              f"{s.get('not-on-roster', 0):7} · {s.get('ambiguous', 0):5} · {s.get('no-app-game', 0):5}   "
              f"[players {s['linked_players']}/{s['players']}]")
    if summary.relink_conflicts:
        print(f"\nrelink conflicts (kept the old link): {summary.relink_conflicts}")


async def write_sample(n: int, sports: list[str] | None) -> str:
    os.makedirs(RESULTS, exist_ok=True)
    path = os.path.join(RESULTS, f"p3-sample-{datetime.now(timezone.utc):%Y-%m-%d}.csv")
    scraper = sqlite3.connect(f"file:{SCRAPER_DB}?mode=ro", uri=True, timeout=30)
    state = sqlite3.connect(STATE_DB, timeout=30)
    rng = random.Random(20260924)
    rows = []
    try:
        for sport in sorted(set(SCRAPER_TO_APP_SPORT.values())):
            if sports and sport not in sports:
                continue
            games = {str(g.game_id): g for g in await load_app_games(sport)}
            links = state.execute("SELECT game_key, app_game_id, reversed, method, start_delta_min FROM game_links "
                                  "WHERE app_sport = ?", (sport,)).fetchall()
            for key, gid, rev, method, delta in rng.sample(links, min(n, len(links))):
                c = scraper.execute("SELECT home_name, away_name, start_utc FROM canon_games WHERE game_key = ?", (key,)).fetchone()
                g = games.get(gid)
                rows.append(["game", sport, key, f"{c[0]} vs {c[1]}" if c else "?", c[2] if c else "",
                             f"{g.home_team_name} vs {g.away_team_name}" if g else f"(app game {gid} not loaded)",
                             g.game_date if g else "", method, f"reversed={rev} delta_min={delta}"])
            plinks = state.execute("SELECT source, player_norm, app_game_id, subject_id, subject_name, team_abbr, position, method "
                                   "FROM player_links WHERE app_sport = ?", (sport,)).fetchall()
            for src, pn, gid, sid, sname, team, pos, method in rng.sample(plinks, min(n, len(plinks))):
                raw = scraper.execute("SELECT player FROM prop_markets WHERE source = ? AND player_norm = ? ORDER BY id DESC LIMIT 1",
                                      (src, pn)).fetchone()
                g = games.get(gid)
                rows.append(["player", sport, f"{src}:{pn}", raw[0] if raw else pn, "",
                             f"{sname} ({team} {pos}) id={sid}", f"{g.away_abbr}@{g.home_abbr}" if g else gid, method, ""])
    finally:
        scraper.close()
        state.close()
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["kind", "sport", "scraper_key", "scraper_names", "scraper_start", "app_names", "app_start", "method", "detail"])
        w.writerows(rows)
    return path


async def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--sports", help="comma-separated app sports (default: all)")
    ap.add_argument("--report", action="store_true")
    ap.add_argument("--sample", type=int, default=0)
    ap.add_argument("--scraper-db", default=SCRAPER_DB)
    ap.add_argument("--state-db", default=STATE_DB)
    a = ap.parse_args()
    sports = [s.strip() for s in a.sports.split(",")] if a.sports else None
    t0 = datetime.now(timezone.utc)
    summary = await run_matching(a.scraper_db, a.state_db, sports)
    print(f"matched in {(datetime.now(timezone.utc) - t0).total_seconds():.1f}s")
    if a.report or not a.sample:
        report(summary)
    if a.sample:
        print("sample written:", await write_sample(a.sample, sports))


if __name__ == "__main__":
    asyncio.run(main())
