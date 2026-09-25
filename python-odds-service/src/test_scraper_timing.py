"""P7 (T0) — hermetic: scraper_timing's measures on synthetic series.
Run: python -u src/test_scraper_timing.py

Pinnacle against itself -> 0 s; a relay repeating a first-hand change 90 s
later -> 90 s; a relay that never repeats it -> a miss; a book moving the other
way after a Pinnacle move -> not following; the Pinnacle-move thresholds (a
9-cent move ignored, a 10-cent + 1.5-point move counted); the proven-fast rule
at its boundaries (120 s, 90%, n 30).
"""
import os
import sys
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)
os.environ.setdefault("DATABASE_URL", "postgresql://x:y@localhost:5432/z")

import scraper_timing as st  # noqa: E402

FAILS = []
T0 = datetime(2026, 9, 25, 18, 0, tzinfo=timezone.utc)


def check(name, cond, detail=""):
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}{(' — ' + str(detail)) if detail and not cond else ''}")
    if not cond:
        FAILS.append(name)


def at(s):
    return T0 + timedelta(seconds=s)


def main():
    print("relay delay (A)")
    fh = [(at(0), -110), (at(600), -120)]
    d, miss = st.relay_delays(fh, fh)
    check("Pinnacle against itself -> 0 s", d == [0.0, 0.0] and miss == 0, (d, miss))
    d, miss = st.relay_delays(fh, [(at(90), -110), (at(690), -120)])
    check("a relay 90 s later -> 90 s", d == [90.0, 90.0] and miss == 0, d)
    d, miss = st.relay_delays(fh, [(at(90), -110)])
    check("a relay that never repeats a change -> a miss", d == [90.0] and miss == 1, (d, miss))
    d, miss = st.relay_delays(fh, [(at(90), -110), (at(600 + 3601), -120)])
    check("a repeat after 60 min is a miss", miss == 1)
    d, miss = st.relay_delays([(at(100), -110)], [(at(50), -110)])
    check("a relay row BEFORE the change does not count", miss == 1)
    s = st.summarize([10, 20, 30, 40, 50])
    check("summary: median / p25 / p75", (s["n"], s["median_s"], s["p25_s"], s["p75_s"]) == (5, 30, 20, 40), s)

    print("cents and no-vig")
    check("-110 -> -120 is 10 cents", st.cents(-110, -120) == 10)
    check("+105 -> -105 is 10 cents", st.cents(105, -105) == 10)
    check("no-vig of -110/-110 is 0.5", abs(st.novig(-110, -110) - 0.5) < 1e-12)

    print("Pinnacle moves (B)")
    S = st.State
    base = S(at(0), -3.0, {"home": -110, "away": -110})
    moves = st.pinnacle_moves([base, S(at(60), -3.5, {"home": -110, "away": -110})], "sp")
    check("a main-line point move is a move (direction -1: home favoured more)", moves == [(at(60), -1, "point")], moves)
    moves = st.pinnacle_moves([base, S(at(60), -3.0, {"home": -119, "away": -101})], "sp")
    check("a 9-cent price move is ignored", moves == [], moves)
    moves = st.pinnacle_moves([base, S(at(60), -3.0, {"home": -120, "away": +100})], "sp")
    check("a 10-cent move with no-vig >= 1.5 pts is a move (+1)", moves == [(at(60), 1, "price")], moves)
    moves = st.pinnacle_moves([S(at(0), -3.0, {"home": -110, "away": -110}),
                               S(at(60), -3.0, {"home": -120, "away": -120})], "sp")
    check("10 cents but no-vig unmoved (both sides) is ignored", moves == [], moves)

    print("follow lag (B)")
    mv = (at(60), -1, "point")
    book = [S(at(0), -3.0, {}), S(at(300), -3.5, {})]
    check("a book following 240 s later -> 240 s", st.follow_lag(mv, book, "sp") == 240.0)
    book = [S(at(0), -3.0, {}), S(at(300), -2.5, {})]
    check("a book moving the OTHER way is not following", st.follow_lag(mv, book, "sp") is None)
    book = [S(at(0), -3.0, {}), S(at(120), -2.5, {}), S(at(400), -3.5, {})]
    check("the first change in the SAME direction counts", st.follow_lag(mv, book, "sp") == 340.0)
    book = [S(at(0), -3.0, {}), S(at(60 + 3601), -3.5, {})]
    check("after 60 min is not following", st.follow_lag(mv, book, "sp") is None)
    mvp = (at(60), 1, "price")
    book = [S(at(0), -3.0, {"home": -110}), S(at(200), -3.0, {"home": -125})]
    check("a price follow: the reference side gets dearer", st.follow_lag(mvp, book, "sp") == 140.0)

    print("proven fast (T0.3)")
    check("Pinnacle first-hand is proven", st.proven_fast("pinnacle", "pinnacle", None, None, 0))
    check("DraftKings first-hand is not a sharp reference", not st.proven_fast("draftkings", "draftkings", 0, 1, 99))
    check("relay at 120 s / 90% / n 30 is proven", st.proven_fast("4codds", "pinnacle", 120.0, 0.90, 30))
    check("121 s is not", not st.proven_fast("4codds", "pinnacle", 121.0, 0.90, 30))
    check("89% is not", not st.proven_fast("4codds", "pinnacle", 60.0, 0.89, 30))
    check("n 29 is not", not st.proven_fast("4codds", "pinnacle", 60.0, 0.95, 29))
    check("Circa via VSiN: <= 120 s behind and >= 50% of Pinnacle's rate", st.circa_proven(120.0, 0.5)
          and not st.circa_proven(121.0, 0.9) and not st.circa_proven(-30.0, 0.49))

    print(f"\n{'FAILED: ' + ', '.join(FAILS) if FAILS else 'all passed'}")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
