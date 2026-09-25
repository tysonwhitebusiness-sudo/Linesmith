"""P6 — hermetic: the scraper bridge's pure logic. Run: python -u src/test_scraper_bridge.py

Mapping one offer (orientation, prices, times, main line, extra, non-price
books, unmatched rows), the hold buffer (B3's flap rule), the D24 policy,
openers, splits, book links and the power-rating team match. The database
half of "unmatched kept" (the delete in the mapped write's transaction) is
proved live by the replay test (`scraper_bridge_replay.py`).
"""
import json
import os
import sys
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
os.environ.setdefault("DATABASE_URL", "postgresql://x:y@localhost:5432/z")

import scraper_bridge as sb  # noqa: E402

FAILS = []
T0 = datetime(2026, 9, 25, 18, 0, tzinfo=timezone.utc)
POLICY = sb.Policy.load(os.path.join(os.path.dirname(HERE), "scraper_bridge_policy.json"))


def check(name, cond, detail=""):
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}{(' — ' + str(detail)) if detail and not cond else ''}")
    if not cond:
        FAILS.append(name)


def offer(**kw):
    base = dict(id=1, snapshot_id=10, source="pinnacle", endpoint="lg-nfl", event_external_id="pin-1",
                prop_market_external_id=None, market="sp", side="home", line=-1.5, book="Pinnacle",
                book_key="pinnacle", price=-110.0, price_alt=None, source_ts_ms=None, depth={"alt": False},
                fetched_at=T0, cache_age_s=None)
    base.update(kw)
    return sb.Offer(**base)


GAME = sb.GameRef("nfl", "401", False, T0 + timedelta(hours=3))
REV = sb.GameRef("nfl", "401", True, T0 + timedelta(hours=3))
PROP = sb.PropRef("Bijan Robinson", "bijan robinson", "rushing_yards", 74.5)
PLAYER = sb.PlayerRef("4430807", "Bijan Robinson", "RB")


def mp(o, game=GAME, prop=None, player=None, policy=POLICY, miss=None, label=None):
    return sb.map_offer(o, game=game, game_miss=miss, prop=prop, player=player, policy=policy, event_label=label)


def mapping():
    print("orientation")
    m = mp(offer(side="home", line=-1.5), game=REV)
    check("reversed game: home -> away", m.row.side == "away", m.row.side)
    check("reversed game: the spread point stays with its team (-1.5 kept, NOT negated)", m.row.point == -1.5, m.row.point)
    m = mp(offer(market="tt_home", side="over", line=20.5), game=REV)
    check("reversed game: tt_home -> tt_away, side over kept", (m.row.market, m.row.side) == ("tt_away", "over"),
          (m.row.market, m.row.side))
    m = mp(offer(market="1h_tt_away", side="under", line=10.5), game=REV)
    check("reversed game: a period team total swaps too", (m.row.period, m.row.market) == ("1h", "tt_home"))
    m = mp(offer(side="home", line=-1.5), game=GAME)
    check("not reversed: untouched", (m.row.side, m.row.point) == ("home", -1.5))

    print("prices")
    m = mp(offer(price=354.55))
    check("fractional +354.55 -> +355", m.row.american_odds == 355, m.row.american_odds)
    check("decimal from the unrounded price (4.5455)", abs(m.row.decimal_odds - 4.5455) < 1e-9, m.row.decimal_odds)
    m = mp(offer(price=-128.21))
    check("fractional -128.21 -> -128, decimal 1+100/128.21", m.row.american_odds == -128
          and abs(m.row.decimal_odds - (1 + 100 / 128.21)) < 1e-12)
    check("+99.5 -> +100", sb.to_american(99.5) == 100)
    check("-99.5 -> -100", sb.to_american(-99.5) == -100)
    check("+99.4 rounds to 99, not a price -> +100", sb.to_american(99.4) == 100)
    check("-150.5 rounds half away from zero -> -151", sb.to_american(-150.5) == -151)

    print("times")
    m = mp(offer(source_ts_ms=int((T0 - timedelta(minutes=5)).timestamp() * 1000)))
    check("changed_at from source_ts_ms", m.row.changed_at == T0 - timedelta(minutes=5), m.row.changed_at)
    check("observed_at (checked) is the snapshot's fetch", m.row.observed_at == T0)
    m = mp(offer(cache_age_s=42))
    check("changed_at from the fetch less Age", m.row.changed_at == T0 - timedelta(seconds=42))
    m = mp(offer())
    check("changed_at from the fetch when nothing else", m.row.changed_at == T0)
    m = mp(offer(source_ts_ms=int((T0 + timedelta(minutes=2)).timestamp() * 1000)))
    check("a source clock ahead of ours is capped at the fetch", m.row.changed_at == T0)

    print("main line")
    check("alt=false -> main, decided now", mp(offer(depth={"alt": False})).row.is_main is True
          and not mp(offer(depth={"alt": False})).needs_main)
    check("alt=true -> alternate", mp(offer(depth={"alt": True})).row.is_main is False)
    check("no alt flag -> decided later", mp(offer(depth=None)).needs_main)
    check("sole line -> main", sb.choose_main({("home", -1.5): -110, ("away", 1.5): -110}, "sp") == -1.5)
    lines = {("home", -1.5): 150, ("away", 1.5): -180, ("home", -0.5): -110, ("away", 0.5): -108,
             ("home", 1.5): -250, ("away", -1.5): 200}
    check("several -> the pair closest to even money", sb.choose_main(lines, "sp") == -0.5,
          sb.choose_main(lines, "sp"))
    check("totals pair on the point", sb.choose_main({("over", 44.5): -110, ("under", 44.5): -110,
                                                       ("over", 47.5): 160, ("under", 47.5): -200}, "tot") == 44.5)

    print("extra")
    m = mp(offer(depth={"alt": False, "limit": 2500.0, "version": 7, "cutoff": "x", "bids": [[0.5, 1]]}))
    check("extra keeps the whitelist only", m.row.extra == {"limit": 2500.0, "version": 7}, m.row.extra)
    m = mp(offer(source="underdog", book_key="underdog", depth={"mult": 1.0, "one_sided": False}, price_alt=1.9,
                 prop_market_external_id="ud-1", market="rushing_yards", side="over", line=74.5),
           prop=PROP, player=PLAYER)
    check("pick'em: price_alt kept as multiplier", m.row.extra == {"mult": 1.0, "one_sided": False, "multiplier": 1.9},
          m.row.extra)

    print("books, props and unmatched")
    check("comparenbet_fair is skipped (non-price)", mp(offer(book_key="comparenbet_fair")).kind == "skip")
    check("an unidentified book is skipped", mp(offer(book_key="sharpag")).kind == "skip")
    check("AN Open is not a price (it feeds openers)", mp(offer(book_key="anopen")).kind == "skip")
    m = mp(offer(source="draftkings", book_key="draftkings", prop_market_external_id="dk-9", market="Rushing Yards",
                 side="over", line=74.5), prop=sb.PropRef("Bijan Robinson", "bijan robinson", "Rushing Yards", 74.5),
           player=PLAYER)
    check("prop: key from the stat label, subject from the link", (m.kind, m.row.market_key, m.row.subject_id)
          == ("prop", "rushing-yards", "4430807"), (m.kind, getattr(m.row, "market_key", None)))
    check("prop: provider scraper:<source>, canonical book", (m.row.provider_id, m.row.bookmaker)
          == ("scraper:draftkings", "draftkings"))
    m = mp(offer(source="kalshi", book_key="kalshi", prop_market_external_id="kal-1", market="strikeouts", side="over",
                 line=5.5), prop=sb.PropRef("Robert Gasser", "robert gasser", "strikeouts", 5.5),
           player=sb.PlayerRef("1", "Robert Gasser", "SP"))
    check("position-dependent label: a pitcher gets pitcher-strikeouts", m.row.market_key == "pitcher-strikeouts",
          getattr(m.row, "market_key", m.reason))
    m = mp(offer(price=-120.0), game=None, miss="unmatched-game", label="A @ B")
    r = m.row
    check("unmatched game: kept with its price", m.kind == "unmatched" and (r.reason, r.price, r.event, r.book, r.side,
          r.line, r.checked, r.source) == ("unmatched-game", -120.0, "A @ B", "pinnacle", "home", -1.5, T0,
                                           "scraper:pinnacle"), r)
    check("unmatched key is the scraper's own identity", r.scraper_key == "pinnacle|pin-1||sp|home|Pinnacle|-1.5")
    check("variant is part of the identity", offer(depth={"variant": 2}).scraper_key().endswith("|v=2"))
    m = mp(offer(prop_market_external_id="pm-1", market="rushing_yards", side="over", line=74.5), prop=PROP,
           player=None)
    check("unmatched player: kept, reason unmatched-player", (m.kind, m.reason) == ("unmatched", "unmatched-player"))
    m = mp(offer(source="sleeper", book_key="sleeper", prop_market_external_id="s-1", market="kills_maps_1_2"),
           prop=sb.PropRef("x", "x", "kills_maps_1_2", 23.5), game=None, miss="no-app-sport")
    check("no app sport: kept as no-app-sport", (m.kind, m.reason) == ("unmatched", "no-app-sport"))
    m = mp(offer(market="weird_market"))
    check("unmapped game market: kept", (m.kind, m.reason) == ("unmatched", "unmapped-game-market"))
    m = mp(offer(book_key="comparenbet_fair"), game=None, miss="unmatched-game")
    check("a non-price row never becomes an unmatched row", m.kind == "skip")
    off = dict(POLICY.data, unmatched_prices={"on": False, "reasons": []})
    check("policy unmatched_prices off: nothing kept", mp(offer(), game=None, miss="unmatched-game",
                                                          policy=sb.Policy(off)).kind == "skip")

    print("exchange books")
    d = {"ticker": "KX-1", "yes_bid": 0.4, "yes_ask": 0.42, "yes_bid_size": 10.0, "yes_ask_size": 20.0,
         "volume_24h": 5.0, "open_interest": 9.0, "yes_bids": [[0.4, 10.0]] * 12, "no_bids": [[0.58, 20.0]]}
    m = mp(offer(source="kalshi", book_key="kalshi", depth=d, market="ml", side="home", line=None, price=150.0))
    ex = m.exchange
    check("kalshi row with a ladder -> ExchangeBookInput", ex is not None and (ex.contract_id, ex.best_bid, ex.best_ask)
          == ("KX-1", 0.4, 0.42))
    check("ladder capped at 10 levels", ex is not None and len(ex.ladder["yes_bids"]) == 10)


def hold():
    print("hold buffer")

    def g(price, snap, at_min):
        m = mp(offer(price=price, snapshot_id=snap, fetched_at=T0 + timedelta(minutes=at_min)))
        return m, snap, ("pinnacle", "lg-nfl"), T0 + timedelta(minutes=at_min)

    def ok(snap, at_min):
        return {("pinnacle", "lg-nfl"): (snap, T0 + timedelta(minutes=at_min))}

    h = sb.HoldBuffer()
    h.offer(*g(-110.0, 1, 0))
    out = h.confirm(ok(1, 0))
    check("a change is not forwarded by its own snapshot", out == [])
    out = h.confirm(ok(2, 1))
    check("A forwarded on the next reading", len(out) == 1 and out[0].value == -110)
    h.offer(*g(-120.0, 3, 2))
    out = h.confirm(ok(4, 3))
    check("A -> B then a later reading of B -> B forwarded with its own times",
          len(out) == 1 and out[0].value == -120 and out[0].row.observed_at == T0 + timedelta(minutes=2))
    check("hold time recorded", h.median_hold_s() is not None)

    h = sb.HoldBuffer()
    h.offer(*g(-110.0, 1, 0))
    h.confirm(ok(2, 1))
    h.offer(*g(-120.0, 3, 2))
    h.offer(*g(-110.0, 4, 3))
    out = h.confirm(ok(5, 4))
    check("A -> B -> A within 600 s: nothing forwarded, 1 flap", out == [] and h.flaps == 1, (out, h.flaps))

    h = sb.HoldBuffer()
    h.offer(*g(-110.0, 1, 0))
    h.confirm(ok(2, 1))
    h.offer(*g(-120.0, 3, 2))
    h.offer(*g(-130.0, 4, 3))
    out = h.confirm(ok(4, 3))
    check("A -> B -> C before a second reading: nothing yet", out == [])
    out = h.confirm(ok(5, 4))
    check("... then only C", [m.value for m in out] == [-130])

    h = sb.HoldBuffer()
    m, snap, ep, at = g(-110.0, 1, 0)
    h.offer(m, snap, ep, at)
    h.pull(m.key)
    check("a pull drops the pending change", h.confirm(ok(2, 1)) == [])

    h = sb.HoldBuffer()
    h.offer(*g(-110.0, 1, 0))
    h.confirm(ok(2, 1))
    h.offer(*g(-110.0, 3, 2))
    check("a re-reading of the forwarded value is not a change", not h.pending)
    h.offer(*g(-120.0, 3, 2))
    check("another endpoint's reading does not confirm", h.confirm({("pinnacle", "other"): (9, T0)}) == [])


def policy():
    print("policy (D24)")
    check("a first-hand source", POLICY.classify("draftkings", "draftkings") == "first_hand")
    check("DraftKings via comparenbet is a relay duplicate", POLICY.classify("comparenbet", "draftkings") == "relay_duplicate")
    check("Circa via Action Network is a relay duplicate", POLICY.classify("actionnetwork", "circa") == "relay_duplicate")
    check("bet365 via Action Network is relay-only", POLICY.classify("actionnetwork", "bet365") == "relay_only")
    strict = dict(POLICY.data, classes={"first_hand": {"pregame": True, "ingame": True},
                                        "relay_only": {"pregame": True, "ingame": False},
                                        "relay_duplicate": {"pregame": False, "ingame": False}})
    p = sb.Policy(strict)
    m = mp(offer(source="comparenbet", book_key="draftkings", depth=None), policy=p)
    check("a relay duplicate is skipped when the policy says so", (m.kind, m.reason) == ("skip", "policy"))
    pre = mp(offer(source="actionnetwork", book_key="bet365", fetched_at=T0), policy=p)
    live = mp(offer(source="actionnetwork", book_key="bet365", fetched_at=T0 + timedelta(hours=3)), policy=p)
    check("in-game is decided at app_start (before: forwarded)", pre.kind == "game")
    check("in-game is decided at app_start (at start: skipped)", live.kind == "skip")
    check("D24 as shipped forwards everything", mp(offer(source="comparenbet", book_key="draftkings")).kind == "game")


def openers_and_more():
    print("openers")
    m = mp(offer(depth={"alt": False}))
    op = sb.opener_from_row(m)
    check("a main game line seeds a first_seen opener", op is not None and (op.opener_source, op.market, op.side,
          op.point, op.opened_at) == ("first_seen", "sp", "home", -1.5, T0))
    check("an alternate does not", sb.opener_from_row(mp(offer(depth={"alt": True}))) is None)
    m = mp(offer(source="kalshi", book_key="kalshi", prop_market_external_id="k", market="rushing_yards", side="over",
                 line=74.5), prop=PROP, player=PLAYER)
    check("an exchange ladder rung does not", sb.opener_from_row(m) is None)
    o = sb.an_open_opener(offer(source="actionnetwork", book_key="anopen", market="sp", side="home", line=3.5,
                                price=-110.0), REV)
    check("AN Open -> an_open opener, oriented", o is not None and (o.opener_source, o.bookmaker, o.side, o.point)
          == ("an_open", "anopen", "away", 3.5))
    ops = sb.parse_vsin_opener({"book": "BetMGM NV", "period": "fg", "spread_away": "-1.5 +145", "ml_away": "-120",
                                "total": "6.5"}, GAME, T0)
    got = {(o.market, o.side, o.point, o.american_odds) for o in ops}
    check("VSiN OPEN parsed", got == {("sp", "away", -1.5, 145), ("sp", "home", 1.5, None), ("ml", "away", None, -120),
                                      ("tot", "over", 6.5, None), ("tot", "under", 6.5, None)}, got)
    check("VSiN book name -> key", {o.bookmaker for o in ops} == {"betmgmnv"})
    check("VSiN blanks write nothing", sb.parse_vsin_opener({"book": "Circa", "period": "fg", "spread_away": "- -",
                                                             "ml_away": "", "total": "-"}, GAME, T0) == [])
    ops = sb.parse_vsin_opener({"book": "South Point", "period": "fg", "spread_away": "PK -110", "ml_away": "-120",
                                "total": "50.5"}, GAME, T0)
    check("VSiN PK is a point of 0", ("sp", "away", 0.0) in {(o.market, o.side, o.point) for o in ops})

    print("splits")
    s = sb.map_split({"at": "2026-09-25 04:40:33", "source": "dknetwork", "kind": "bets_money", "book": "draftkings",
                      "prop_market_external_id": None, "market": "sp", "side": "home", "line": -3.5, "pct_bets": 44.0,
                      "pct_money": 51.0, "count": None, "count_total": None}, REV, None, None)
    check("a game split is oriented (home -> away) and keeps its source/book",
          (s.market, s.side, s.line, s.source, s.book, s.pct_money) == ("sp", "away", -3.5, "dknetwork", "draftkings", 51.0))
    s = sb.map_split({"at": "2026-09-25 04:40:33", "source": "actionnetwork", "kind": "bet_count", "book": None,
                      "prop_market_external_id": None, "market": None, "side": None, "line": None, "pct_bets": None,
                      "pct_money": None, "count": 13434, "count_total": None}, GAME, None, None)
    check("Action Network's per-game bet count -> market 'game', side 'all'",
          (s.market, s.side, s.count) == ("game", "all", 13434))
    s = sb.map_split({"at": "2026-09-25 04:27:53", "source": "sleeper", "kind": "pick_counts", "book": "sleeper",
                      "prop_market_external_id": "slp-1", "market": "rushing_yards", "side": "over", "line": 74.5,
                      "pct_bets": None, "pct_money": None, "count": 87, "count_total": 100}, GAME, PROP, PLAYER)
    check("a pick count names its player and prop key", (s.subject_id, s.market, s.kind) == ("4430807", "rushing-yards",
                                                                                              "pick_counts"))

    print("book links and ratings")
    rows = sb.book_links({"links": {"fanduel": "https://fd/1", "polymarket": "https://pm/1", "x": ""}}, GAME, T0)
    check("cnb links -> one book_link per canonical book", {(r.subject, r.data["url"]) for r in rows}
          == {("fanduel", "https://fd/1"), ("polymarket", "https://pm/1")})
    m = sb.match_ratings(["Alabama", "Alabama A&M", "Alabama ST", "Texas"],
                         ["Alabama Crimson Tide", "Alabama A&M Bulldogs", "Alabama State Hornets",
                          "Texas Southern Tigers", "Texas Longhorns"], "cfb")
    check("CFB: longest school prefix wins", m.get("Alabama A&M Bulldogs") == "Alabama A&M"
          and m.get("Alabama State Hornets") == "Alabama ST" and m.get("Alabama Crimson Tide") == "Alabama")
    check("CFB: a school never matches a different school sharing its prefix",
          "Texas Southern Tigers" not in m and m.get("Texas Longhorns") == "Texas", m)
    check("pro: 'Wash Commanders' is Washington", sb.match_ratings(["Wash Commanders"], ["Washington Commanders"],
                                                                    "nfl") == {"Washington Commanders": "Wash Commanders"})


def main():
    mapping()
    hold()
    policy()
    openers_and_more()
    print(f"\n{'FAILED: ' + ', '.join(FAILS) if FAILS else 'all passed'}")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
