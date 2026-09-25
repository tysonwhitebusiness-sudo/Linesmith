"""P4 (odds build, 2026-09-24): scraper_volume_measure's classification.
Hermetic: a synthetic change list and a tiny fixture DB, no network.

    python -u src/test_scraper_volume.py
"""
import os
import sqlite3
import sys
import tempfile
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from bridge_state import open_state  # noqa: E402
from scraper_volume_measure import flap_flags, measure, phase, source_class  # noqa: E402

_failures = 0


def check(label, actual, expected):
    global _failures
    if actual == expected:
        print(f"  PASS  {label}")
    else:
        _failures += 1
        print(f"  FAIL  {label}: got {actual!r}, expected {expected!r}")


def main():
    # Flaps: A -> B -> A, the return within 600 s of B is a flap; 900 s is not.
    check("A->B->A in 300 s is a flap", flap_flags([(0, "A"), (100, "B"), (400, "A")]), [False, False, True])
    check("A->B->A in 900 s is not", flap_flags([(0, "A"), (100, "B"), (1000, "A")]), [False, False, False])
    check("A->B->C is not", flap_flags([(0, "A"), (100, "B"), (200, "C")]), [False, False, False])

    fh = frozenset({"draftkings", "pinnacle"})
    check("first-hand source", source_class("draftkings", "draftkings", fh), "first-hand")
    check("relay of a first-hand book = relay-duplicate", source_class("comparenbet", "draftkings", fh), "relay-duplicate")
    check("relay of a relay-only book", source_class("actionnetwork", "fanatics", fh), "relay-only")

    check("before the start = pre", phase("2026-09-27 19:59:59.000000", "2026-09-27 20:00:00.000000"), "pre")
    check("at/after the start = in", phase("2026-09-27 20:00:00.000000", "2026-09-27 20:00:00.000000"), "in")
    check("no start = pre", phase("2026-09-27 20:00:00.000000", None), "pre")

    check("classes add up to the total", adds_up(), True)
    print(f"\n{'ALL PASS' if _failures == 0 else f'{_failures} FAILURE(S)'}")
    if _failures:
        raise SystemExit(1)


def adds_up() -> bool:
    d = tempfile.mkdtemp(prefix="p4_vol_")
    sdb, bdb = os.path.join(d, "scraper.db"), os.path.join(d, "bridge.db")
    s = sqlite3.connect(sdb)
    s.executescript("""
      CREATE TABLE snapshots (id INTEGER PRIMARY KEY, source TEXT, fetched_at TEXT, flaps INTEGER);
      CREATE TABLE offers (id INTEGER PRIMARY KEY, snapshot_id INTEGER, source TEXT, event_external_id TEXT,
        prop_market_external_id TEXT, market TEXT, side TEXT, line REAL, book TEXT, book_key TEXT, price REAL);
      CREATE TABLE prop_markets (id INTEGER PRIMARY KEY, external_id TEXT, source TEXT, parent_external_id TEXT,
        player TEXT, stat TEXT, player_norm TEXT);
      CREATE TABLE game_links (source TEXT, external_id TEXT, game_key TEXT, method TEXT, reversed INTEGER, linked_at TEXT);
      CREATE TABLE canon_games (game_key TEXT PRIMARY KEY, sport TEXT, league_key TEXT, home_name TEXT, away_name TEXT,
        start_utc TEXT, women INTEGER, created_at TEXT);
      INSERT INTO canon_games VALUES ('gk','football','nfl','A','B','2026-09-27 20:00:00.000000',0,'');
      INSERT INTO canon_games VALUES ('gx','darts',NULL,'C','D','2026-09-27 20:00:00.000000',0,'');
      INSERT INTO game_links VALUES ('draftkings','dk1','gk','exact',0,''), ('comparenbet','cb1','gk','exact',0,''),
                                    ('comparenbet','cbx','gx','exact',0,'');
      INSERT INTO snapshots VALUES (1,'draftkings','2026-09-27 19:00:00.000000',1), (2,'comparenbet','2026-09-27 20:30:00.000000',0);
      INSERT INTO prop_markets VALUES (1,'pm1','draftkings','dk1','Jordan Love','Passing Yards','jordan love');
      INSERT INTO offers VALUES
        (1,1,'draftkings','dk1',NULL,'ml','home',NULL,'DraftKings','draftkings',-110),
        (2,1,'draftkings','dk1',NULL,'ml','away',NULL,'DraftKings','draftkings',100),
        (3,1,'draftkings','dk1','pm1','prop','over',250.5,'DraftKings','draftkings',-115),
        (4,2,'comparenbet','cb1',NULL,'ml','home',NULL,'DraftKings','draftkings',-112),
        (5,2,'comparenbet','cb1',NULL,'ml','home',NULL,'Fanatics','fanatics',-108),
        (6,2,'comparenbet','cb1',NULL,'ml','home',NULL,'fair','comparenbet_fair',-110),
        (7,2,'comparenbet','cbx',NULL,'ml','home',NULL,'Fanatics','fanatics',-150);
    """)
    s.commit()
    s.close()
    st = open_state(bdb)
    # Named columns: game_links has gained columns since (P6's backfill state), and a positional
    # insert broke on each one.
    st.execute("INSERT INTO game_links (game_key, app_sport, app_game_id, reversed, method, start_delta_min, "
               "app_start, linked_at) VALUES ('gk','nfl','401',0,'exact',0,'','x')")
    st.execute("INSERT INTO player_links VALUES ('draftkings','jordan love','401','nfl','p9','Jordan Love','GB','QB','exact','x')")
    st.commit()
    st.close()
    m = measure(sdb, bdb, datetime(2026, 9, 27, tzinfo=timezone.utc), datetime(2026, 9, 28, tzinfo=timezone.utc))
    t = m["totals"]
    matched = sum(v for (k, cls, ph, match, app, sharp), v in m["tally"].items() if match in ("strict", "estimated"))
    parts = t["flaps"] + t["non-price"] + t["no-app-sport"] + t["unmatched-market"] + t["unmatched-player"] \
        + t["unmatched-no-game"] + t["unmatched-weight"] + matched
    classes = {(cls, ph) for (k, cls, ph, match, app, sharp), v in m["tally"].items() if match == "strict"}
    ok = (abs(parts - t["rows"]) < 1e-9 and t["rows"] == 7 and m["per_source"] == m["reconcile"]
          and ("first-hand", "pre") in classes and ("relay-duplicate", "in") in classes and ("relay-only", "in") in classes
          and t["non-price"] == 1 and t["no-app-sport"] == 1)
    if not ok:
        print("   totals", dict(t), "matched", matched, "classes", classes)
    return ok


if __name__ == "__main__":
    main()
