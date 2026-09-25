"""M3 — the two rules that make a Specials receipt mean anything.

1. **A frozen ranking never moves.** If a row could still change after its
   sport's first game, tomorrow's "receipts" would be grading a ranking that had
   already seen the results. The freeze lives in the WRITE (`WHERE frozen_at IS
   NULL`), so it holds even if a caller asks twice.

2. **A missing factor is missing, not average.** A batter with no Statcast split
   against the starter's hand is scored on the factors he has. Filling the gap
   with a league average would rank him as if we knew something we do not.

Also checks the scoring itself: percentiles over the day's pool, equal weights,
direction respected.

Run with:  .venv/Scripts/python.exe src/test_slate_rankings.py
"""
import asyncio
import json
import sys
from datetime import date

import db
import slate_rankings as sr

failures: list[str] = []


def ok(name, cond, detail=""):
    if cond:
        print(f"  ok  {name}")
    else:
        failures.append(f"{name} {detail}")


def close(name, got, want, tol=1e-9):
    ok(name, abs(got - want) <= tol, f"— got {got}, want {want}")


print("scoring")
F = (sr.Factor("a", "A"), sr.Factor("b", "B"), sr.Factor("c", "C", higher_better=False))
cands = [
    sr.Candidate("1", "Best", "X", "Y", "g", {"a": 10.0, "b": 10.0, "c": 1.0}),
    sr.Candidate("2", "Middle", "X", "Y", "g", {"a": 5.0, "b": 5.0, "c": 5.0}),
    sr.Candidate("3", "Worst", "X", "Y", "g", {"a": 1.0, "b": 1.0, "c": 10.0}),
    sr.Candidate("4", "Partial", "X", "Y", "g", {"a": 10.0, "b": None, "c": None}),
]
sr.score(cands, F)
ok("the best on every factor scores highest", cands[0].values["_score"] > cands[1].values["_score"] > cands[2].values["_score"])
ok("a lower-is-better factor is inverted", cands[0].values["_pct"]["c"] > cands[2].values["_pct"]["c"])
ok("a missing factor is skipped, not imputed", set(cands[3].values["_pct"]) == {"a"},
   f"— percentiles present: {sorted(cands[3].values['_pct'])}")
ok("and the partial player is still scored on what he has", cands[3].values["_score"] is not None)
close("a factor everyone ties on gives everyone the same percentile",
      *(lambda c: (c[0].values["_pct"]["a"], c[1].values["_pct"]["a"]))(
          (lambda cs: (sr.score(cs, (sr.Factor("a", "A"),)), cs)[1])(
              [sr.Candidate("1", "", None, None, None, {"a": 3.0}), sr.Candidate("2", "", None, None, None, {"a": 3.0})])))

print("percentile direction")
ranks = sr.percentile_ranks([1.0, 2.0, 3.0], True)
ok("higher is better ascends", ranks[0] < ranks[1] < ranks[2])
ranks = sr.percentile_ranks([1.0, 2.0, 3.0], False)
ok("lower is better descends", ranks[0] > ranks[1] > ranks[2])
ok("None stays None", sr.percentile_ranks([1.0, None], True)[1] is None)

print("the registry")
ids = [r.id for r in sr.RANKINGS]
ok("every ranking id is unique", len(ids) == len(set(ids)))
ok("every ranking has factors", all(r.factors for r in sr.RANKINGS))
ok("every factor explains itself", all(f.info for r in sr.RANKINGS for f in r.factors),
   f"— missing: {[(r.id, f.key) for r in sr.RANKINGS for f in r.factors if not f.info]}")
ok("every special knows how it is graded",
   all(r.grade_stat in sr._GRADE_SQL or r.grade_stat in sr._GRADE_ELSEWHERE
       for r in sr.RANKINGS if r.kind == "special"))
ok("a spotlight is never graded",
   all(r.grade_stat == "" for r in sr.RANKINGS if r.kind == "spotlight"),
   f"— graded spotlights: {[(r.id, r.grade_stat) for r in sr.RANKINGS if r.kind == 'spotlight' and r.grade_stat]}")
ok("every ranking has a known hit rule and kind",
   all(r.hit_rule in sr.HIT_RULES and r.kind in sr.KINDS for r in sr.RANKINGS))
ok("the longest rankings grade against the slate's leader",
   {r.id for r in sr.RANKINGS if r.hit_rule == "slate_max"} == {"mlb-longest-hr", "nfl-longest-reception"})
ok("two goals needs two", next(r for r in sr.RANKINGS if r.id == "nhl-two-goals").hit_rule == "gte2")
ok("every factor has a read template",
   all(f.key in sr.READS for r in sr.RANKINGS for f in r.factors),
   f"— missing: {[f.key for r in sr.RANKINGS for f in r.factors if f.key not in sr.READS]}")
ok("every special prints a stat line",
   all(sr.detail_line(r.detail, {}) for r in sr.RANKINGS if r.kind == "special"),
   f"— empty: {[r.id for r in sr.RANKINGS if r.kind == 'special' and not sr.detail_line(r.detail, {})]}")

print("hit rules")
ok("any: one is a hit", sr.is_hit("any", 1.0) and not sr.is_hit("any", 0.0))
ok("gte2: one goal is a miss, two a hit", not sr.is_hit("gte2", 1.0) and sr.is_hit("gte2", 2.0))
ok("slate_max: the leader hits, a tie hits, the runner-up misses",
   sr.is_hit("slate_max", 468.0, 468.0) and not sr.is_hit("slate_max", 440.0, 468.0))
ok("slate_max: no value is never a hit", not sr.is_hit("slate_max", 0.0, 0.0))

print("stat lines")
ok("a TD line counts both kinds of touchdown",
   sr.detail_line("football_td", {"rushing.rushingAttempts": 22, "rushing.rushingYards": 118,
                                  "rushing.rushingTouchdowns": 1}) == "22 car · 118 yds · 1 TD")
ok("a receiver's TD line",
   sr.detail_line("football_td", {"receiving.receptions": 7, "receiving.receivingYards": 88}) == "7 rec · 88 yds · 0 TD")
ok("a longest-HR line carries the distance",
   sr.detail_line("mlb_hr_distance", {"bat_hits": 2, "bat_atBats": 4}, 452.0) == "HR 452 ft · 2-4")
ok("and says so when there was none", sr.detail_line("mlb_hr_distance", {"bat_hits": 1, "bat_atBats": 4}, 0.0) == "No HR · 1-4")
ok("NHL time on ice reads as minutes:seconds",
   sr.detail_line("nhl", {"goals": 2, "sog": 5, "toiMinutes": 18.6667}) == "2 G · 5 SOG · 18:40 TOI")
close("innings are thirds", sr._ip(6.1), 6 + 1 / 3)

print("the read")
BANNED = ("edge", "value", "best bet", "lock", "probability", "odds")
samples = {"_hand": "L"}
for r in sr.RANKINGS:
    for f in r.factors:
        for v in (0.02, 0.5, 1.2, 5.0, 12.0, 80.0, 430.0):
            p = sr.READS[f.key](v, samples)
            if p and any(w in p.lower() for w in BANNED):
                failures.append(f"banned word in {f.key}: {p}")
ok("no template uses a banned word", not [x for x in failures if x.startswith("banned")])
F2 = (sr.Factor("hr_per_pa", "HR/PA"), sr.Factor("wind_out", "Wind"), sr.Factor("temp_f", "Temp"))
vals = {"hr_per_pa": 6.1, "wind_out": 11.0, "temp_f": 60.0, "_pct": {"hr_per_pa": 90, "wind_out": 95, "temp_f": 99}}
ok("the read names the two strongest factors that support a sentence",
   sr.read_line(F2, vals) == "Has a 11 mph wind blowing out, and homers on 6.1% of plate appearances.",
   f"— got {sr.read_line(F2, vals)!r}")
ok("a wind blowing in is not a reason",
   "wind" not in sr.read_line(F2, {**vals, "wind_out": -8.0}).lower())
ok("nothing strong says so", sr.read_line(F2, {"hr_per_pa": 2.0, "_pct": {"hr_per_pa": 30}}) == sr.NO_STANDOUT)
ok("the read is the same every time", sr.read_line(F2, vals) == sr.read_line(F2, dict(vals)))

print("park orientation")
from predict import park_orientation as po
from predict.weather import DOME_VENUE_NAMES
ok("30 parks", len(po.PARKS) == 30)
ok("the roofed parks are the weather model's dome list",
   {p.name for p in po.PARKS.values() if p.roof != "open"} == DOME_VENUE_NAMES,
   f"— {sorted({p.name for p in po.PARKS.values() if p.roof != 'open'} ^ DOME_VENUE_NAMES)}")
ok("every row names its source", all(p.source for p in po.PARKS.values()))
ok("the spot-check parks exist", all(n in po.BY_NAME for n in po.SPOT_CHECK))
wrigley = po.BY_NAME["Wrigley Field"]
close("a wind from behind home plate blows straight out",
      po.wind_out_mph(wrigley, 10.0, (wrigley.cf_bearing + 180) % 360), 10.0, 0.05)
close("a wind from center blows straight in", po.wind_out_mph(wrigley, 10.0, wrigley.cf_bearing), -10.0, 0.05)
close("a crosswind is about zero", po.wind_out_mph(wrigley, 10.0, (wrigley.cf_bearing + 90) % 360), 0.0, 0.05)
ok("a roof has no wind factor", po.wind_out_mph(po.BY_NAME["Tropicana Field"], 10.0, 0.0) is None)
ok("the labels", po.wind_label(wrigley, 12.0, 11.0) == "Out 11" and po.wind_label(wrigley, 6.0, -6.0) == "In 6"
   and po.wind_label(wrigley, 4.0, 0.3) == "Cross 4"
   and po.wind_label(po.BY_NAME["Chase Field"], None, None) == "Roof — may close")


def venue_coverage() -> None:
    import httpx
    try:
        res = httpx.get("https://statsapi.mlb.com/api/v1/teams", params={"sportId": 1, "season": 2026, "hydrate": "venue"}, timeout=20)
        ids = {t["venue"]["id"] for t in res.json()["teams"]}
    except Exception as e:                                    # noqa: BLE001
        print(f"  skip venue coverage (network: {e})")
        return
    ok("every 2026 MLB home venue has a row", ids <= set(po.PARKS), f"— missing {sorted(ids - set(po.PARKS))}")


venue_coverage()


class _NoNames:
    async def fetch(self, *a, **k):
        return []


async def names_rule() -> None:
    print("names")
    cands = [sr.Candidate("4241372", "", "A", "B", "g", {}), sr.Candidate("99", "99", "A", "B", "g", {}),
             sr.Candidate("7", "Real Name", "A", "B", "g", {})]
    real = sr._source_name

    async def nobody(sport, athlete_id):
        return None
    sr._source_name = nobody      # the unit rule, without asking ESPN
    try:
        await sr._name_all(_NoNames(), "nfl", cands)
    finally:
        sr._source_name = real
    ok("a player with no name is never printed as an id",
       [c.subject_name for c in cands] == [sr.UNKNOWN_PLAYER, sr.UNKNOWN_PLAYER, "Real Name"])


asyncio.run(names_rule())


async def freeze_rules() -> None:
    print("the freeze (against the real table)")
    slate = date(2000, 1, 2)   # a date no slate will ever use
    row = {"sport": "test", "slate_date": slate, "ranking_id": "test-freeze", "subject_id": "s1",
           "rank": 1, "score": 50.0, "subject_name": "First", "team": "A", "opponent": "B",
           "game_id": "g1", "factors": json.dumps({"x": 1})}
    pool = await db.get_pool()
    try:
        await db.write_slate_rankings([row])
        await db.write_slate_rankings([{**row, "score": 60.0, "subject_name": "Second"}])
        got = await pool.fetchrow(
            "SELECT score, subject_name, frozen_at FROM slate_rankings WHERE sport='test' AND slate_date=$1", slate)
        ok("an unfrozen row still updates", float(got["score"]) == 60.0 and got["subject_name"] == "Second")

        n = await db.freeze_slate_rankings("test", slate, ["test-freeze"])
        ok("freezing stamps the row", n == 1)

        await db.write_slate_rankings([{**row, "score": 99.0, "subject_name": "Third"}])
        got = await pool.fetchrow(
            "SELECT score, subject_name, frozen_at FROM slate_rankings WHERE sport='test' AND slate_date=$1", slate)
        ok("a frozen row does NOT move", float(got["score"]) == 60.0 and got["subject_name"] == "Second",
           f"— it became {got['score']} / {got['subject_name']}")
        ok("and it carries its frozen stamp", got["frozen_at"] is not None)

        again = await db.freeze_slate_rankings("test", slate, ["test-freeze"])
        ok("freezing twice changes nothing", again == 0)
    finally:
        await pool.execute("DELETE FROM slate_rankings WHERE sport = 'test' AND slate_date = $1", slate)
        print("  cleanup: test rows removed")




async def builders_on_real_rows() -> None:
    """The two rankings with no live slate to test on today are run against
    real teams: NHL on 2025-26 (off-season until October), NFL on this season."""
    from types import SimpleNamespace as NS
    print("builders on real rows")
    pool = await db.get_pool()
    async with pool.acquire() as conn:
        g = await conn.fetchrow(
            """SELECT team_id, opponent_id FROM team_game_production
                WHERE sport = 'nhl' AND season = 2025 AND pos_group = 'all' AND game_date = '2026-01-15' LIMIT 1""")
        game = NS(home_team_id=g["team_id"], away_team_id=g["opponent_id"], home_abbr="HOME", away_abbr="AWAY",
                  game_id="test", roster=[])
        cands = await sr.build_nhl_two_goals(conn, date(2026, 1, 15), games=[game])
        ok("NHL two goals finds candidates from 2025-26", len(cands) >= 5, f"— {len(cands)}")
        ok("and every factor is measured for most of them",
           all(sum(1 for c in cands if c.values.get(f.key) is not None) >= len(cands) // 2
               for f in sr.NHL_TWO_GOAL_FACTORS))
        g = await conn.fetchrow(
            """SELECT team_id, opponent_id FROM team_game_production
                WHERE sport = 'nfl' AND season = 2026 AND pos_group = 'all' ORDER BY game_date DESC LIMIT 1""")
        game = NS(home_team_id=g["team_id"], away_team_id=g["opponent_id"], home_abbr="HOME", away_abbr="AWAY",
                  game_id="test", roster=[])
        cands = await sr.build_nfl_longest_reception(conn, date(2026, 9, 27), games=[game])
        ok("NFL longest reception finds receivers with air yards", len(cands) >= 4, f"— {len(cands)}")
        ok("and their air-yard factors are real",
           all(c.values.get("adot") is not None and c.values.get("air_share") is not None for c in cands))
        for c in sorted(cands, key=lambda c: -(c.values.get("adot") or 0))[:3]:
            print("   ", c.subject_id, c.team, {k: v for k, v in c.values.items() if not k.startswith("_")})


async def spotlight_builders_on_real_rows() -> None:
    """PY-B: the generic N builders run against real teams, with the games
    injected the way the NHL/NFL checks do (no live slate needed)."""
    from types import SimpleNamespace as NS
    print("spotlight builders on real rows")
    pool = await db.get_pool()
    async with pool.acquire() as conn:
        g = await conn.fetchrow(
            """SELECT team_id, opponent_id FROM team_game_production
                WHERE sport = 'nfl' AND season = 2026 AND pos_group = 'all' ORDER BY game_date DESC LIMIT 1""")
        game = NS(home_team_id=g["team_id"], away_team_id=g["opponent_id"], home_abbr="HOME", away_abbr="AWAY",
                  game_id="test", roster=[])
        real = sr._sport_games_today

        async def fake_games(sport, slate):
            return [game]
        sr._sport_games_today = fake_games
        try:
            m = await sr.build_milestones(conn, date(2026, 9, 27), "nfl")
            ok("NFL milestones builds without error", isinstance(m, list))
            rc = await sr.build_role_changes(conn, date(2026, 9, 27), "nfl")
            ok("NFL role changes builds without error", isinstance(rc, list))
            rv = await sr.build_revenge(conn, date(2026, 9, 27), "nfl")
            ok("NFL revenge builds without error", isinstance(rv, list))
        finally:
            sr._sport_games_today = real


print("odds flags (P12 §3)")
import odds_flags as of
from datetime import datetime as _dt, timedelta as _td, timezone as _tz

_T0 = _dt(2026, 9, 27, 12, 0, tzinfo=_tz.utc)


def _moves_to(book, at_min, frm=5.5, to=6.5):
    """A book two-sided at `frm`, then at `to` from minute `at_min` (its old line gone quiet)."""
    return [
        {"observed_at": _T0, "bookmaker": book, "side": "over", "line": frm, "american_odds": -110},
        {"observed_at": _T0, "bookmaker": book, "side": "under", "line": frm, "american_odds": -110},
        {"observed_at": _T0 + _td(minutes=at_min), "bookmaker": book, "side": "over", "line": to, "american_odds": -110},
        {"observed_at": _T0 + _td(minutes=at_min), "bookmaker": book, "side": "under", "line": to, "american_odds": -110},
        {"observed_at": _T0 + _td(minutes=at_min), "bookmaker": book, "side": "over", "line": frm, "american_odds": -190},
        {"observed_at": _T0 + _td(minutes=at_min), "bookmaker": book, "side": "under", "line": frm, "american_odds": 150},
    ]


def _runs(rows):
    return of.steam_runs(of.line_moves(of.main_line_series(rows)))


three = _moves_to("draftkings", 10) + _moves_to("fanduel", 20) + _moves_to("betmgm", 35)
ok("steam: 3 books within 30 minutes is steam", len(_runs(three)) == 1 and len(_runs(three)[0]) == 3, _runs(three))
ok("steam: 2 books is not", _runs(_moves_to("draftkings", 10) + _moves_to("fanduel", 20)) == [])
slow = _moves_to("draftkings", 10) + _moves_to("fanduel", 30) + _moves_to("betmgm", 45)
ok("steam: 3 books over 35 minutes is not", _runs(slow) == [])
_batch = [dict(r, provider_id="scraper:comparenbet", observed_at=_T0 + _td(minutes=10) if r["observed_at"] != _T0 else _T0)
          for b in ("draftkings", "fanduel", "betmgm") for r in _moves_to(b, 10)]
ok("steam: one relay snapshot moving 3 books at one instant is not", _runs(_batch) == [], _runs(_batch))
ok("steam: an exchange's ladder is no main line", _runs(_moves_to("kalshi", 10) + _moves_to("fanduel", 20) + _moves_to("betmgm", 25)) == [])
pin = _moves_to("pinnacle", 0) + _moves_to("draftkings", 12) + _moves_to("fanduel", 15) + _moves_to("betmgm", 20)
fm = of.first_mover_runs(of.line_moves(of.main_line_series(pin)))
ok("first mover: Pinnacle 12 minutes ahead, 3 books followed", len(fm) == 1 and len(fm[0][1]) == 3, fm)
quick = _moves_to("pinnacle", 0) + _moves_to("draftkings", 5) + _moves_to("fanduel", 8) + _moves_to("betmgm", 9)
ok("first mover: 5 minutes ahead is not a lead", of.first_mover_runs(of.line_moves(of.main_line_series(quick))) == [])
ok("the player id the pages use", of.bare_subject("espn:football:3117256") == "3117256" and of.bare_subject("650490") == "650490")


class _G:
    def __init__(self, gid):
        self.game_id, self.home_abbr, self.away_abbr, self.home_team_id, self.away_team_id = gid, "GB", "ATL", "9", "1"


_rows = [{"game_id": "g15", "market": "ml", "side": "home", "pct_money": 70.0, "pct_bets": 55.0},
         {"game_id": "g14", "market": "tot", "side": "over", "pct_money": 60.0, "pct_bets": 46.0}]
_ms = sr.money_split_candidates([_G("g15"), _G("g14")], _rows)
ok("money split: 15 points is flagged, 14 is not", [c.subject_id for c in _ms] == ["g15"], [c.subject_id for c in _ms])
ok("money split: the GAME is the subject (subjectKind game)", _ms[0].subject_id == _ms[0].game_id and _ms[0].subject_name == "ATL @ GB")

import re as _re
_PRONOUN = _re.compile(r"\b(he|she|him|his|her|hers|they|them|their|theirs|it|its)\b", _re.I)
_reads = [
    sr.read_line(sr.ODDS_STEAM_FACTORS, {"steam_books": 4.0, "steam_minutes": 12.0, "_market": "receptions", "_dir": "up",
                                          "_first": "FanDuel", "_pct": {"steam_books": 90, "steam_minutes": 80}}),
    sr.read_line(sr.ODDS_FIRST_MOVER_FACTORS, {"followers": 3.0, "lead_min": 12.0, "_market": "receptions",
                                                "_pct": {"followers": 90, "lead_min": 70}}),
    sr.read_line(sr.ODDS_PULLED_FACTORS, {"repost_move": 1.0, "_book": "DraftKings", "_market": "receptions",
                                           "_from": "5.5", "_to": "6.5", "_pct": {"repost_move": 90}}),
    sr.read_line(sr.ODDS_MONEY_SPLIT_FACTORS, {"money_gap": 15.0, "_side": "GB", "_market": "moneyline", "_money_more": True,
                                                "_pct": {"money_gap": 90}}),
]
ok("odds flag reads say something", all(r and r != sr.NO_STANDOUT for r in _reads), _reads)
ok("odds flag reads take no pronoun", not any(_PRONOUN.search(r) for r in _reads), _reads)
ok("the four odds flags are spotlights (never graded) that freeze",
   all(r.kind == "spotlight" and not r.grade_stat and r.freezes for r in sr.RANKINGS if r.id.startswith("odds-"))
   and len([r for r in sr.RANKINGS if r.id.startswith("odds-")]) == 4)
ok("odds-money-split covers nfl, cfb, mlb, nba, nhl only",
   next(r for r in sr.RANKINGS if r.id == "odds-money-split").sports == ("nfl", "cfb", "mlb", "nba", "nhl"))


async def odds_flags_on_real_rows() -> None:
    pool = await db.get_pool()
    async with pool.acquire() as conn:
        for build in (sr.build_odds_steam, sr.build_odds_pulled, sr.build_odds_money_split, sr.build_odds_first_mover):
            got = await build(conn, date.today(), "mlb")
            ok(f"{build.__name__} builds on real rows", isinstance(got, list), got)


async def db_checks() -> None:
    # One event loop: the pool is bound to the loop that created it.
    await freeze_rules()
    await builders_on_real_rows()
    await spotlight_builders_on_real_rows()
    await odds_flags_on_real_rows()


asyncio.run(db_checks())

print()
if failures:
    for f in failures:
        print("FAIL:", f)
    sys.exit(1)
print("all slate ranking checks passed")
