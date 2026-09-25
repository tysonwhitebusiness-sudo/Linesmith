"""P6 §7 — hermetic: odds_checks.opener_sanity. Run: python -u src/test_odds_checks.py

Every threshold row at its boundary: exactly at the threshold passes (the
rule is `>`), just past it flags. Plus the known BetMGM NV case, the peer
minimum and the price range.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from odds_checks import opener_sanity  # noqa: E402

FAILS = []


def check(name, cond, detail=""):
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}{(' — ' + str(detail)) if detail and not cond else ''}")
    if not cond:
        FAILS.append(name)


def row(market, side, point=None, odds=None, sport="nfl", kind="game"):
    return {"kind": kind, "sport": sport, "market": market, "side": side, "point": point, "american_odds": odds}


def flag(opener, peers):
    return opener_sanity(opener, peers)[0]


def boundary(name, sport, market, peer_point, inside, outside, side="home"):
    peers = [row(market, side, peer_point, -110, sport)] * 3
    check(f"{name}: at the threshold passes", not flag(row(market, side, inside, -110, sport), peers),
          opener_sanity(row(market, side, inside, -110, sport), peers))
    check(f"{name}: just past it flags", flag(row(market, side, outside, -110, sport), peers))


def main():
    print("spreads (home perspective; peers' median -6.5 / -2.5)")
    for sport in ("nfl", "cfb", "nba"):
        boundary(f"{sport} spread 3.0", sport, "sp", -6.5, -3.5, -3.4)
    boundary("mlb run line 1.5", "mlb", "sp", -2.5, -1.0, -0.9)
    boundary("nhl puck line 1.5", "nhl", "sp", -2.5, -1.0, -0.9)
    boundary("soccer 1.0", "soccer_epl", "sp", -2.5, -1.5, -1.4)
    check("spread: opposite sign to the median flags",
          flag(row("sp", "home", 1.0, -110), [row("sp", "home", -3.0, -110)] * 3))
    check("spread: an AWAY opener is read as the home number (away +6.5 == home -6.5)",
          not flag(row("sp", "away", 6.5, -110), [row("sp", "home", -6.5, -110)] * 3))

    print("totals (peers' median 45 / 8)")
    for sport in ("nfl", "cfb"):
        boundary(f"{sport} total 4.0", sport, "tot", 45.0, 49.0, 49.1, side="over")
    boundary("nba total 8.0", "nba", "tot", 220.0, 228.0, 228.1, side="over")
    boundary("mlb total 1.5", "mlb", "tot", 8.0, 9.5, 9.6, side="over")
    boundary("nhl total 1.0", "nhl", "tot", 6.0, 7.0, 7.1, side="over")
    boundary("soccer total 1.0", "soccer_mls", "tot", 2.5, 3.5, 3.6, side="over")

    print("moneyline (peers at +100 = 0.500; limit 0.15)")
    peers = [row("ml", "home", None, 100)] * 3
    check("ml -185 (0.649) passes", not flag(row("ml", "home", None, -185), peers))
    check("ml -186 (0.650) flags", flag(row("ml", "home", None, -186), peers))
    check("ml compares the SAME side only (away peers do not count)",
          not flag(row("ml", "home", None, -186), [row("ml", "away", None, 100)] * 3))

    print("props (25% of the median AND >= 1.0)")
    peers = [row("receiving-yards", "over", 10.0, -110, kind="prop")] * 3
    check("prop 12.5 vs 10 (off 2.5 = 25%) passes", not flag(row("receiving-yards", "over", 12.5, -110, kind="prop"), peers))
    check("prop 12.6 vs 10 flags", flag(row("receiving-yards", "over", 12.6, -110, kind="prop"), peers))
    peers = [row("receptions", "over", 2.5, -110, kind="prop")] * 3
    check("prop 3.4 vs 2.5 (off 0.9 < 1.0) passes", not flag(row("receptions", "over", 3.4, -110, kind="prop"), peers))
    check("prop 3.5 vs 2.5 (off 1.0) flags", flag(row("receptions", "over", 3.5, -110, kind="prop"), peers))

    print("price range [0.02, 0.98]")
    check("-4900 (0.980) passes", not flag(row("ml", "home", None, -4900), []))
    check("-5000 (0.980+) flags", flag(row("ml", "home", None, -5000), []))
    check("+4900 (0.020) passes", not flag(row("ml", "home", None, 4900), []))
    check("+5000 (0.0196) flags", flag(row("ml", "home", None, 5000), []))

    print("the known case and the peer minimum")
    peers_sp = [row("sp", "away", -6.5, -110)] * 3
    peers_tot = [row("tot", "over", 45.0, -110)] * 3
    f, reason = opener_sanity(row("sp", "away", -2.0, -110), peers_sp)
    check("BetMGM NV ATL -2 vs peers -6.5 flags (4.5 > 3.0)", f, reason)
    f, reason = opener_sanity(row("tot", "over", 52.5, -110), peers_tot)
    check("BetMGM NV total 52.5 vs peers 45 flags (7.5 > 4.0)", f, reason)
    check("a peer set of 2 is not checked", not flag(row("sp", "away", -2.0, -110), peers_sp[:2]))
    check("a normal opener passes", not flag(row("sp", "away", -6.0, -110), peers_sp))

    print(f"\n{'FAILED: ' + ', '.join(FAILS) if FAILS else 'all passed'}")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
