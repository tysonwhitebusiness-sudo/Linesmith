"""P2 (odds build, 2026-09-24): scraper_markets maps every scraper label the way
the generator decided. Hermetic (no DB, no network): the fixtures are the
generator's CSVs in docs/design/odds-build/data/, and the module's
dictionaries are compared with the generator's own so the two cannot drift.

    python -u src/test_scraper_markets.py
"""
import csv
import importlib.util
import os

import scraper_markets as sm

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.normpath(os.path.join(HERE, "..", "..", "docs", "design", "odds-build", "data"))
_failures = 0


def check(label, actual, expected):
    global _failures
    if actual != expected:
        _failures += 1
        print(f"  FAIL  {label}: got {actual!r}, expected {expected!r}")


def rows(name):
    with open(os.path.join(DATA, name), encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def main():
    props = rows("scraper_prop_labels.csv")
    counts = {}
    for r in props:
        src, label, key, status = r["source"], r["label"], r["key"], r["status"]
        counts[status] = counts.get(status, 0) + 1
        check(f"status {src}/{label}", sm.prop_label_status(src, label), status)
        if status == "mapped":
            check(f"mapped {src}/{label}", sm.prop_market_key(src, label), key)
        elif status == "position":
            pitcher, other = key.split("|")
            check(f"position SP {src}/{label}", sm.prop_market_key(src, label, "SP"), pitcher)
            check(f"position CF {src}/{label}", sm.prop_market_key(src, label, "CF"), other)
            check(f"position TWP {src}/{label}", sm.prop_market_key(src, label, "TWP"), None)
            check(f"position None {src}/{label}", sm.prop_market_key(src, label, None), None)
        else:  # no-app-sport, skip, verify, not-a-player-prop, unmapped
            check(f"{status} {src}/{label}", sm.prop_market_key(src, label, "SP"), None)
    print(f"  prop labels checked: {len(props)} {counts}")

    games = rows("scraper_game_markets.csv")
    n_mapped = 0
    for r in games:
        got = sm.game_market(r["market"])
        if r["status"] == "mapped":
            n_mapped += 1
            check(f"game {r['market']}", got, (r["period"], r["type"]))
        else:
            check(f"game {r['market']} ({r['status']})", got, None)
    print(f"  game markets checked: {len(games)} ({n_mapped} mapped)")

    for b in list(sm.NON_PRICE_BOOKS) + list(sm.UNIDENTIFIED_BOOKS) + [None, ""]:
        check(f"bridgeable_book({b!r})", sm.bridgeable_book(b), False)
    for b in ("draftkings", "pinnacle", "kalshi", "circa"):
        check(f"bridgeable_book({b!r})", sm.bridgeable_book(b), True)

    # The module is a verbatim port of the generator: the decisions must match.
    spec = importlib.util.spec_from_file_location("gen", os.path.join(DATA, "gen_scraper_market_map.py"))
    gen = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(gen)
    for name in ("NEW_KEYS", "MANUAL", "SKIP", "SOURCE_MANUAL", "POSITION_DEPENDENT", "VERIFY", "NOT_PLAYER_PROP",
                 "NO_APP_SPORT_PATTERNS", "GAME_PERIOD", "GAME_TYPE"):
        check(f"drift {name}", getattr(sm, name), getattr(gen, name))
    check("drift PERIOD_PREFIX", [(p.pattern, k) for p, k in sm.PERIOD_PREFIX], [(p.pattern, k) for p, k in gen.PERIOD_PREFIX])
    check("verify list fully decided", sm.VERIFY, {})

    print(f"\n{'ALL PASS' if _failures == 0 else f'{_failures} FAILURE(S)'}")
    if _failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
