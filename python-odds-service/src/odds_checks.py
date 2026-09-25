"""Sanity checks on odds rows (P6 §7, D21). Pure; `test_odds_checks.py`.

`opener_sanity` decides whether a book's opener is believable against the
other books' openers for the same game, period and market. A flagged opener is
STORED with `check_flag=true` and its reason, and never used as "the opener"
(D21): a typo'd or stale opener is still a fact about that book.

The known case the thresholds were set against: BetMGM NV opened ATL -2 /
52.5 while its peers opened -6.5 / 45 (spread off by 4.5 > 3.0, total by 7.5 >
4.0). Every threshold compares with `>`: a difference exactly AT a threshold
passes.
"""
from __future__ import annotations

import statistics

MIN_PEERS = 3
PRICE_RANGE = (0.02, 0.98)

SPREAD_MAX = {"nfl": 3.0, "cfb": 3.0, "nba": 3.0, "mlb": 1.5, "nhl": 1.5, "soccer": 1.0}
TOTAL_MAX = {"nfl": 4.0, "cfb": 4.0, "nba": 8.0, "mlb": 1.5, "nhl": 1.0, "soccer": 1.0}
MONEYLINE_MAX = 0.15
PROP_FRACTION, PROP_MIN = 0.25, 1.0


def _generic(sport: str) -> str:
    return "soccer" if sport.startswith("soccer") else "tennis" if sport.startswith("tennis") else sport


def implied(american: float) -> float:
    return 100 / (american + 100) if american > 0 else -american / (-american + 100)


def _spread_home(side: str, point: float) -> float:
    """A spread opener as the home side's number, so peers quoting either side compare."""
    return point if side == "home" else -point


def opener_sanity(opener: dict, peers: list[dict]) -> tuple[bool, str | None]:
    """`opener` and each peer: {kind 'game'|'prop', sport, market, side, point,
    american_odds}. Peers are OTHER books' openers for the same game, period
    and market (and subject, for a prop). -> (flag, reason)."""
    odds = opener.get("american_odds")
    if odds is not None:
        p = implied(odds)
        if not PRICE_RANGE[0] <= p <= PRICE_RANGE[1]:
            return True, f"price {odds:+d} implies {p:.3f}, outside [{PRICE_RANGE[0]}, {PRICE_RANGE[1]}]"
    if len(peers) < MIN_PEERS:
        return False, None
    sport, market = _generic(opener["sport"]), opener["market"]

    if opener["kind"] == "prop":
        vals = [q["point"] for q in peers if q.get("point") is not None]
        if len(vals) < MIN_PEERS or opener.get("point") is None:
            return False, None
        med = statistics.median(vals)
        diff = abs(opener["point"] - med)
        if diff > PROP_FRACTION * abs(med) and diff >= PROP_MIN:
            return True, f"line {opener['point']} vs peers' median {med} (off {diff:g})"
        return False, None

    if market == "sp":
        if opener.get("point") is None:
            return False, None
        vals = [_spread_home(q["side"], q["point"]) for q in peers if q.get("point") is not None]
        if len(vals) < MIN_PEERS:
            return False, None
        mine, med = _spread_home(opener["side"], opener["point"]), statistics.median(vals)
        limit = SPREAD_MAX.get(sport)
        if mine * med < 0:
            return True, f"spread {mine:+g} (home) has the opposite sign to the peers' median {med:+g}"
        if limit is not None and abs(mine - med) > limit:
            return True, f"spread {mine:+g} (home) vs peers' median {med:+g} (off {abs(mine - med):g} > {limit:g})"
        return False, None

    if market == "tot":
        vals = [q["point"] for q in peers if q.get("point") is not None]
        if len(vals) < MIN_PEERS or opener.get("point") is None:
            return False, None
        med, limit = statistics.median(vals), TOTAL_MAX.get(sport)
        if limit is not None and abs(opener["point"] - med) > limit:
            return True, f"total {opener['point']:g} vs peers' median {med:g} (off {abs(opener['point'] - med):g} > {limit:g})"
        return False, None

    if market in ("ml", "ml3"):
        if odds is None:
            return False, None
        vals = [implied(q["american_odds"]) for q in peers
                if q.get("american_odds") is not None and q.get("side") == opener.get("side")]
        if len(vals) < MIN_PEERS:
            return False, None
        med = statistics.median(vals)
        if abs(implied(odds) - med) > MONEYLINE_MAX:
            return True, f"moneyline {odds:+d} implies {implied(odds):.3f} vs peers' median {med:.3f}"
        return False, None
    return False, None
