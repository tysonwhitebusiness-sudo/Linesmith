"""P11 (E1) — the market edge's gates, each in isolation.

A fixture that passes every gate, then one fixture per gate that fails ONLY
that gate and produces no edge. The two edges found by hand in the approved
mockup reproduce (GB -4.5 at BetMGM, Drake London receptions at Underdog), the
anytime-TD mismatches do not, and gate 2 follows D13 exactly: the soft price is
read at the sharp price time, not at `changed_at`.

Hermetic (no database). Run with:  python -u src/test_market_edge.py
"""
import sys
from dataclasses import replace
from datetime import datetime, timedelta, timezone

from predict.market_edge import (Latency, Market, Quote, apply_self_check, evaluate, price_time, self_check)

failures: list[str] = []
NOW = datetime(2026, 9, 27, 16, 0, tzinfo=timezone.utc)


def ok(name, cond, detail=""):
    print(f"  {'ok  ' if cond else 'FAIL'} {name}{'' if cond else '  -- ' + str(detail)}")
    if not cond:
        failures.append(name)


def ago(s):
    return NOW - timedelta(seconds=s)


def q(book, provider, side, american, checked=20, since=7200, **kw):
    return Quote(book=book, provider=provider, side=side, american=american,
                 checked_at=ago(checked), since=ago(since) if since is not None else None, **kw)


LAT = Latency(fast={("nfl", "pinnacle", "pinnacle"), ("nfl", "kalshi", "kalshi")},
              relay_median_s={("nfl", "comparenbet", "draftkings"): 100.0})


def gb(**over) -> Market:
    """ATL @ GB, GB -4.5: BetMGM -105 against Pinnacle -113/+102 (the mockup's game-line edge)."""
    quotes = over.pop("quotes", None) or [
        q("pinnacle", "scraper:pinnacle", "home", -113, checked=30, since=2400, extra={"limit": 2500, "cache_age_s": 60}),
        q("pinnacle", "scraper:pinnacle", "away", 102, checked=30, since=2400, extra={"limit": 2500, "cache_age_s": 60}),
        q("betmgm", "scraper:betmgm", "home", -105),
    ]
    return Market(kind="game", sport="nfl", game_id="401", market="sp", line=-4.5, sides=("home", "away"),
                  start=NOW + timedelta(hours=1), quotes=quotes, **over)


def result(m, lat=LAT, book="betmgm", side="home"):
    rs = [r for r in evaluate([m], lat, NOW) if r.side == side and (r.soft is None or r.soft.book == book)]
    return rs[0] if rs else None


def failing(r):
    return [g.name for g in r.gates if not g.ok]


def swap(m, book, side, **changes):
    """The market with one quote changed."""
    qs = [replace(x, **changes) if (x.book == book and x.side == side) else x for x in m.quotes]
    return replace(m, quotes=qs)


print("the fixture that passes every gate (GB -4.5 at BetMGM)")
base = gb()
r = result(base)
ok("passes gates 1-8", r.passed, failing(r))
ok("EV ~ +1.0% (tolerance 0.2 pt)", abs(r.ev * 100 - 1.0) <= 0.2, r.ev)
ok("fair ~ 51.7%", abs(r.fair - 0.517) < 0.002, r.fair)
ok("single source logged", r.single_source)
ok("worst case is logged, not gating", r.ev_by_method["worst_case"] < 0 < r.ev)
apply_self_check([r], {"on": False})
ok("passes gate 9 with the self-check off", r.passed)

print("gate 1 — reference")
r = result(swap(base, "pinnacle", "home", extra={"limit": 400, "cache_age_s": 60}))
ok("a limit under $500 fails only gate 1", r.soft is None and failing(r) == ["g1_reference"], failing(r))
r = result(replace(base, quotes=[x for x in base.quotes if not (x.book == "pinnacle" and x.side == "away")]))
ok("a one-sided Pinnacle fails gate 1", failing(r) == ["g1_reference"], failing(r))
relayed = replace(base, quotes=[replace(x, provider="propline") if x.book == "pinnacle" else x for x in base.quotes])
ok("Pinnacle through an unproven relay is no reference", failing(result(relayed)) == ["g1_reference"])

print("gate 2 — time (D13)")
pt, basis = price_time(base.quotes[0])
ok("sharp price time = checked - Age", pt == ago(90) and basis == "cache_age", (pt, basis))
r = result(swap(base, "betmgm", "home", since=ago(60)))
ok("a soft book that moved after the sharp price time -> no edge (current price would show one)",
   failing(r) == ["g2_time"] and r.ev > 0, (failing(r), r.ev))
r = result(swap(base, "betmgm", "home", since=ago(120)))
ok("a soft price unchanged since the sharp price time -> computed from the aligned pair", r.passed, failing(r))
hist = swap(base, "betmgm", "home", since=ago(120), history=[(ago(7200), -115), (ago(120), -105)])
ok("history: the soft price read AT the sharp price time", result(hist).passed)
hist_after = swap(base, "betmgm", "home", since=ago(120), history=[(ago(7200), -115), (ago(30), -105)])
ok("history row after the sharp price time -> no edge", failing(result(hist_after)) == ["g2_time"])
no_age = replace(base, quotes=[replace(x, extra={"limit": 2500}) if x.book == "pinnacle" else x for x in base.quotes])
ok("no Age recorded -> D13's 15-minute bound", price_time(no_age.quotes[0])[1] == "assumed_max_cdn_age")
r = result(swap(no_age, "betmgm", "home", since=ago(600)))
ok("... so a soft change 10 min ago fails (it is inside the bound)", failing(r) == ["g2_time"], failing(r))
lm = replace(base, quotes=[replace(x, extra={"limit": 2500, "last_modified": ago(300).isoformat()})
                           if x.book == "pinnacle" else x for x in base.quotes])
ok("Last-Modified wins over Age", price_time(lm.quotes[0]) == (ago(300), "last_modified"))
stale_sharp = replace(base, quotes=[replace(x, checked_at=ago(1300)) if x.book == "pinnacle" else x for x in base.quotes])
ok("sharp checked 21+ min ago fails gate 2", failing(result(stale_sharp)) == ["g2_time"])
ok("soft checked 4 min ago fails gate 2", failing(result(swap(base, "betmgm", "home", checked_at=ago(240)))) == ["g2_time"])
ok("unknown soft since fails gate 2", failing(result(swap(base, "betmgm", "home", since=None))) == ["g2_time"])

kalshi = [q("kalshi", "scraper:kalshi", "home", -110, checked=20, since=60, history=[(ago(3000), 105)],
            extra={"yes_bid": 0.51, "yes_ask": 0.53, "volume_24h": 5000}),
          q("kalshi", "scraper:kalshi", "away", -110, checked=20, since=3000,
            extra={"yes_bid": 0.47, "yes_ask": 0.49, "volume_24h": 5000})]
r = result(replace(base, quotes=base.quotes + kalshi))
ok("Kalshi moved ~2 pts after the sharp price time -> no edge", failing(r) == ["g2_time"], failing(r))
kalshi_small = [replace(kalshi[0], history=[(ago(3000), -108)]), kalshi[1]]
ok("Kalshi moved < 1.5 pts -> still shown", result(replace(base, quotes=base.quotes + kalshi_small)).passed)

relay = q("draftkings", "scraper:comparenbet", "home", -105, checked=150, since=7200)
lat_relay = replace(LAT, relay_last_change={("scraper:comparenbet", "draftkings", "401"): ago(1800)})
m_relay = replace(base, quotes=base.quotes + [relay])
ok("relay within median + 2 min, active in the last hour -> passes",
   result(m_relay, lat_relay, "draftkings").passed, failing(result(m_relay, lat_relay, "draftkings")))
ok("relay with no change on the game in 60 min (D23: since, not checked) -> fails",
   failing(result(m_relay, LAT, "draftkings")) == ["g2_time"])
slow = replace(relay, checked_at=ago(260))
ok("relay checked past median + 2 min -> fails",
   failing(result(replace(base, quotes=base.quotes + [slow]), lat_relay, "draftkings")) == ["g2_time"])

print("gate 3 — corroboration")
other = q("betmgm", "scraper:comparenbet", "home", -115, checked=60, since=7200)
r = result(replace(base, quotes=base.quotes + [other]))
ok("another copy 10c away, checked 1 min ago -> fails gate 3 (and 7)", "g3_corroboration" in failing(r), failing(r))
agree = replace(other, american=-106)
r = result(replace(base, quotes=base.quotes + [agree]))
ok("a copy within 5c -> passes, not single source", r.passed and not r.single_source, failing(r))

print("gate 4 — settled")
ok("an open pull on the soft book fails only gate 4", failing(result(swap(base, "betmgm", "home", pulled=True))) == ["g4_settled"])
ok("an open pull on the sharp price fails only gate 4", failing(result(swap(base, "pinnacle", "home", pulled=True))) == ["g4_settled"])

print("gate 5 — pre-game")
ok("30 s before the start fails only gate 5", failing(result(replace(base, start=NOW + timedelta(seconds=30)))) == ["g5_pregame"])
ok("an unknown start fails gate 5", failing(result(replace(base, start=None))) == ["g5_pregame"])

print("gate 6 — conservative")
ok("BetMGM -115 is no edge", failing(result(swap(base, "betmgm", "home", american=-115))) == ["g6_conservative"])

print("gate 7 — one book, several providers")
soft7 = swap(base, "betmgm", "home", checked_at=ago(170))
copy7 = q("betmgm", "scraper:comparenbet", "home", -120, checked=250, since=7200)
r = result(replace(soft7, quotes=soft7.quotes + [copy7]))
ok("two copies checked 80 s apart, 15c apart -> fails only gate 7", failing(r) == ["g7_copies"], failing(r))

print("gate 8 — cap + outlier")
r = result(swap(base, "betmgm", "home", american=110))
ok("EV > 8% is capped (probable data error)", failing(r) == ["g8_cap_outlier"] and "capped" in r.gates[-1].detail, failing(r))
td_quotes = [
    q("pinnacle", "scraper:pinnacle", "over", 150, checked=30, since=2400, extra={"limit": 500, "cache_age_s": 60}),
    q("pinnacle", "scraper:pinnacle", "under", -190, checked=30, since=2400, extra={"limit": 500, "cache_age_s": 60}),
    q("kalshi", "scraper:kalshi", "over", 155, checked=30, since=2400, extra={"yes_bid": 0.38, "yes_ask": 0.40, "volume_24h": 4000}),
    q("kalshi", "scraper:kalshi", "under", -175, checked=30, since=2400, extra={"yes_bid": 0.60, "yes_ask": 0.62, "volume_24h": 4000}),
    q("draftkings", "scraper:draftkings", "over", 160), q("fanduel", "scraper:fanduel", "over", 155),
    q("betmgm", "scraper:betmgm", "over", 150), q("betrivers", "scraper:betrivers", "over", 165),
    q("underdog", "scraper:underdog", "over", 550),   # an 85-250% mismatch: a different market under this name
]
td = Market(kind="prop", sport="nfl", game_id="401", subject_id="london", market="anytime_td", line=0.5,
            sides=("over", "under"), start=NOW + timedelta(hours=1), quotes=td_quotes)
r = result(td, book="underdog", side="over")
ok("the anytime-TD mismatch -> no edge (gate 8)", not r.passed and "g8_cap_outlier" in failing(r), failing(r))
fair_book = result(td, book="draftkings", side="over")
ok("... while the real books at that line are not outliers", "g8_cap_outlier" not in failing(fair_book), failing(fair_book))

print("the prop edge (Drake London receptions 5.5 over at Underdog)")
london_quotes = [
    q("pinnacle", "scraper:pinnacle", "over", -103, checked=40, since=2400, extra={"limit": 500, "cache_age_s": 60}),
    q("pinnacle", "scraper:pinnacle", "under", -117, checked=40, since=2400, extra={"limit": 500, "cache_age_s": 60}),
    q("novig", "scraper:4codds", "over", -104, checked=60, since=3000),
    q("novig", "scraper:4codds", "under", -114, checked=60, since=3000),
    q("underdog", "scraper:underdog", "over", 110, checked=30, since=10800, extra={"multiplier": 1.05}),
]
london = Market(kind="prop", sport="nfl", game_id="401", subject_id="london", market="receptions", line=5.5,
                sides=("over", "under"), start=NOW + timedelta(hours=1), quotes=london_quotes)
lat_novig = replace(LAT, fast=LAT.fast | {("nfl", "4codds", "novig")})
r = result(london, lat_novig, "underdog", "over")
ok("Novig's relay proven fast -> shown", r.passed, failing(r))
ok("multiplicative EV ~ +1.8% (the mockup's number; tolerance 0.2 pt)",
   abs(r.ev_by_method["multiplicative"] * 100 - 1.8) <= 0.2, r.ev_by_method)
ok("the EV shown is gate 6's minimum (power, ~ +1.6%)", r.method == "power" and abs(r.ev * 100 - 1.6) <= 0.1, (r.method, r.ev))
ok("the second source is recorded", (r.reference.second or {}).get("book") == "novig")
r = result(london, LAT, "underdog", "over")
ok("Novig's relay not proven fast -> not shown (gate 1)", failing(r) == ["g1_reference"], failing(r))

print("gate 9 — the self-check")
fake = []
for i in range(30):
    m = replace(base, game_id=f"g{i}")
    rs = evaluate([m], LAT, NOW)
    fake.extend(x for x in rs if x.soft and x.soft.book == "betmgm")
for x in fake[:3]:
    x.ev = 0.06
state = self_check(fake, {"on": False})
ok("30 evaluated, 3 passing at EV > 5% -> auto-off", state["on"] is True, state)
apply_self_check(fake, state)
ok("... and nothing passes", not any(x.passed for x in fake))
clean = [x for x in evaluate([replace(base, game_id=f"c{i}") for i in range(30)], LAT, NOW) if x.soft]
for n in range(1, 4):
    state = self_check(clean, state)
    ok(f"clean run {n}: {'cleared' if n == 3 else 'still on'}", state["on"] is (n < 3), state)
few = self_check(fake[:5], {"on": False})
ok("under 20 evaluated never trips", few["on"] is False)

print()
if failures:
    print(f"FAILED: {len(failures)}: {failures}")
    sys.exit(1)
print("all market-edge checks passed")
