"""
Load every sourced odds file into `odds_import_staging`, resolved.

NOTHING UNRESOLVED IS EVER PROMOTED. Rows that cannot be tied to a team pair
stay here with a `resolution_note` saying why.

============ THE ENTITY PROBLEM, MEASURED ============

There is no shared game id anywhere, and worse, two id systems OVERLAP
NUMERICALLY. Verified 2026-09-01:

  NBA, NFL, CFB, EPL, MLS   ESPN's team id IS our team id. Confirmed exactly
                            (32/32 NFL, 147/147 CFB, 23/23 EPL) because those
                            sports are loaded through ESPN in game_context.py.
  MLB                       0 of 31 ESPN ids join. MLB uses StatsAPI ids
                            (108-158). Resolved via the abbreviation map that
                            already exists in lib/sports/mlb/teamAliases.ts.
  NHL                       30 of 39 ESPN ids "matched" -- AND THAT WAS A LIE.
                            NHL uses NHL-API ids. In the NHL API Toronto is 10;
                            in ESPN, MONTREAL is 10. A numeric join files
                            Montreal's odds under Toronto. Tested on real dates:
                            0 of 25 (date, espn_id) pairs existed in
                            player_game_history. Resolved via triCode instead.

That is CURRENT.md's own warning made concrete: a numeric id matching the
expected SHAPE is not evidence it is the right id.

SBR carries no ids at all, only nicknames (LALakers, GoldenState, TampaBay), so
it resolves by name against a map built from ESPN's own (abbr, id, name) triples
-- ESPN is the Rosetta stone here because it publishes both.

Dates get a +-1 day tolerance: SBR dates carry no year AND no timezone, so a
7pm ET game is the next day in UTC.
"""

import argparse
import asyncio
import csv
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import httpx

sys.path.insert(0, "src")
import db  # noqa: E402

DL = Path("C:/Users/occy3/Downloads")

# Sports whose team ids in player_game_history ARE ESPN's (see header).
ESPN_ID_SPORTS = {"nba", "nfl", "cfb", "soccer_epl", "soccer_mls"}

# All-Star / exhibition / international entries that are not real clubs.
# NBA's are six digits among one- and two-digit real ids; MLB's is the National
# League All-Star side; NHL's are the 4 Nations teams.
PHANTOM_IDS = {"111353", "111386", "112151", "111387", "112152", "129030", "129029", "47842", "47838", "47836"}
PHANTOM_ABBR = {"NL", "AL", "MCD", "MAT", "SWE", "FIN", "CAN", "USA"}

MLB_ABBR_TO_ID = {
    "LAA": 108, "ANA": 108, "ARI": 109, "AZ": 109, "BAL": 110, "BOS": 111, "BRS": 111,
    "CHC": 112, "CUB": 112, "CIN": 113, "CLE": 114, "COL": 115, "DET": 116, "HOU": 117,
    "KC": 118, "KCR": 118, "KAN": 118, "LAD": 119, "LOS": 119, "WSH": 120, "WSN": 120,
    "WAS": 120, "NYM": 121, "OAK": 133, "ATH": 133, "PIT": 134, "SD": 135, "SDP": 135,
    "SDG": 135, "SEA": 136, "SF": 137, "SFG": 137, "SFO": 137, "STL": 138, "TB": 139,
    "TBD": 139, "TBR": 139, "TAM": 139, "TEX": 140, "TOR": 141, "MIN": 142, "PHI": 143,
    "ATL": 144, "CWS": 145, "CHW": 145, "FLA": 146, "MIA": 146, "NYY": 147, "MIL": 158,
}

# Fetched from api.nhle.com/stats/rest/en/team on 2026-09-01. ESPN triCodes match
# these; ESPN's numeric ids do not.
NHL_ABBR_TO_ID = {
    "NJD": 1, "NYI": 2, "NYR": 3, "PHI": 4, "PIT": 5, "BOS": 6, "BUF": 7, "MTL": 8,
    "OTT": 9, "TOR": 10, "ATL": 11, "CAR": 12, "FLA": 13, "TBL": 14, "WSH": 15,
    "CHI": 16, "DET": 17, "NSH": 18, "STL": 19, "CGY": 20, "COL": 21, "EDM": 22,
    "VAN": 23, "ANA": 24, "DAL": 25, "LAK": 26, "PHX": 27, "SJS": 28, "CBJ": 29,
    "MIN": 30, "WPG": 52, "ARI": 53, "VGK": 54, "SEA": 55, "UTA": 59,
    # ESPN uses a few different triCodes than the NHL API does.
    "TB": 14, "LA": 26, "SJ": 28, "NJ": 1, "WSH ": 15, "MON": 8, "CLS": 29, "VGS": 54,
}


def norm(s):
    return re.sub(r"[^a-z]", "", (s or "").lower())


def rows_of(path, **kw):
    if not path.exists():
        return []
    with open(path, newline="", encoding="utf-8-sig") as fh:
        return list(csv.DictReader(fh, **kw))


def num(v):
    if v in (None, "", "NA", "nan"):
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def integer(v):
    n = num(v)
    return None if n is None else int(round(n))


class Resolver:
    """abbr/name -> our team id, per sport. ESPN is the Rosetta stone: it is the
    only source publishing (abbreviation, id, display name) together."""

    def __init__(self):
        self.by_abbr = {}   # (sport, ABBR) -> id
        self.by_name = {}   # (sport, normname) -> id
        self.by_last = {}   # (sport, last word of name) -> id, for SBR nicknames

    def learn_espn(self, sport, abbr, team_id, name):
        if not abbr:
            return
        a = abbr.strip().upper()
        if a in PHANTOM_ABBR or (team_id or "") in PHANTOM_IDS:
            return
        ours = self.map_espn_id(sport, a, team_id)
        if ours is None:
            return
        self.by_abbr[(sport, a)] = ours
        if name:
            self.by_name[(sport, norm(name))] = ours
            last = norm(name.split()[-1]) if name.split() else ""
            if last and len(last) > 3:
                self.by_last.setdefault((sport, last), ours)

    @staticmethod
    def map_espn_id(sport, abbr, espn_id):
        if sport == "mlb":
            return MLB_ABBR_TO_ID.get(abbr)
        if sport == "nhl":
            return NHL_ABBR_TO_ID.get(abbr)
        if sport in ESPN_ID_SPORTS:
            return None if (espn_id or "") in PHANTOM_IDS else (espn_id or None)
        return None

    # Franchises SBR names by a city the club has since left. Mapping them to
    # the current franchise is right for a historical archive -- it is the same
    # team -- but it must be explicit, never inferred.
    RELOCATED = {
        ("nba", "newjersey"): "brooklyn",       # Nets, moved 2012
        ("nba", "seattle"): None,               # SuperSonics -> OKC in 2008; SBR
                                                # also uses OklahomaCity, so leave
                                                # this one unresolved rather than
                                                # silently merging two eras.
        ("nhl", "arizonas"): "arizona",         # typo in the SBR source
        ("nhl", "phoenix"): "arizona",
    }

    def resolve(self, sport, abbr=None, name=None):
        if abbr:
            a = abbr.strip().upper()
            if a in PHANTOM_ABBR:
                return None, "phantom_abbr"
            if (sport, a) in self.by_abbr:
                return self.by_abbr[(sport, a)], None
            direct = self.map_espn_id(sport, a, None)
            if direct is not None:
                return direct, None
        if name:
            n = norm(name)
            if (sport, n) in self.RELOCATED:
                mapped = self.RELOCATED[(sport, n)]
                if mapped is None:
                    return None, "defunct_or_relocated_franchise"
                n = mapped
            if (sport, n) in self.by_name:
                return self.by_name[(sport, n)], None

            # SBR names the CITY, ESPN names "City Nickname": Boston ->
            # Boston Celtics, GoldenState -> Golden State Warriors, TampaBay ->
            # Tampa Bay Lightning. So the SBR name is a PREFIX of the ESPN one.
            # Only accept a unique hit -- "losangeles" prefixes both Lakers and
            # Clippers, and guessing there would mis-file half a franchise.
            pref = {tid for (sp, full), tid in self.by_name.items()
                    if sp == sport and full.startswith(n)}
            if len(pref) == 1:
                return pref.pop(), None

            # Where the city is ambiguous SBR usually disambiguates with the
            # nickname instead (LALakers, NYRangers), so try the tail.
            nick = {tid for (sp, last), tid in self.by_last.items()
                    if sp == sport and last and last in n}
            if len(nick) == 1:
                return nick.pop(), None
            if len(pref) > 1 or len(nick) > 1:
                return None, "ambiguous_team_name"
        return None, "unresolved_team"


def impossible_price(market, price):
    """No American price can sit strictly between -100 and +100. Two SBR NBA
    moneylines carry -8 and +8.

    They used to be DELETED BY HAND from odds_archive after promotion, with
    gate 5 carrying a `DELETED_CORRUPT = 2` constant to account for them. That
    is not a fix: the next `--truncate` re-import promoted both straight back
    and the gate failed on a pipeline that had behaved correctly. Caught here
    instead, where the file's own rule already applies -- nothing unresolved is
    ever promoted, and it stays in staging with a note saying why.

    market='spread' is exempt: for a spread row this column holds
    close_home_spread, which is a handicap, not a price.
    """
    return (market == "moneyline" and price is not None
            and -100 < price < 100)


def espn_long_rows(r, resolver):
    """Explode one wide ESPN row into long (market, side) rows."""
    sport = r.get("sport")
    if not sport:
        return []
    hid, hnote = resolver.resolve(sport, r.get("home_abbr"), r.get("home_team"))
    aid, anote = resolver.resolve(sport, r.get("away_abbr"), r.get("away_team"))
    note = hnote or anote
    d = (r.get("event_date") or "")[:10]
    if not d:
        return []
    base = dict(
        sport=sport, event_ref=r.get("event_id"), game_date=d,
        home_team_raw=r.get("home_team"), away_team_raw=r.get("away_team"),
        home_team_id=str(hid) if hid else None, away_team_id=str(aid) if aid else None,
        bookmaker=r.get("provider"), provider=r.get("provider"),
        source="espn_core", source_priority=90,
        booksum=num(r.get("ml_booksum")), ml_flag=r.get("ml_flag"),
        resolution_status="resolved" if (hid and aid) else "unresolved",
        resolution_note=None if (hid and aid) else (note or "unresolved_team"),
    )
    out = []
    zero_is_null = lambda v: (None if (v is not None and v == 0) else v)
    ml_h = zero_is_null(integer(r.get("close_home_ml"))) or zero_is_null(integer(r.get("cur_home_ml")))
    ml_a = zero_is_null(integer(r.get("close_away_ml"))) or zero_is_null(integer(r.get("cur_away_ml")))
    tot = zero_is_null(num(r.get("close_total"))) or zero_is_null(num(r.get("cur_total")))
    otot = zero_is_null(num(r.get("open_total")))
    for market, side, line, price, oline, oprice in (
        ("moneyline", "home", None, ml_h, None, zero_is_null(integer(r.get("open_home_ml")))),
        ("moneyline", "away", None, ml_a, None, zero_is_null(integer(r.get("open_away_ml")))),
        ("moneyline", "draw", None, integer(r.get("draw_ml")), None, integer(r.get("open_draw_ml"))),
        ("total", "over", tot, integer(r.get("close_over_odds")), otot, integer(r.get("open_over_odds"))),
        ("total", "under", tot, integer(r.get("close_under_odds")), otot, integer(r.get("open_under_odds"))),
        ("spread", "home", num(r.get("cur_spread")), integer(r.get("close_home_spread")), None, None),
    ):
        if price is None and line is None:
            continue
        row = {**base, "market": market, "side": side, "line": line,
               "price": price, "open_line": oline, "open_price": oprice}
        if impossible_price(market, price):
            row["resolution_status"] = "unresolved"
            row["resolution_note"] = "impossible_american_price"
        out.append(row)
    return out


def sbr_long_rows(r, sport, resolver):
    d = (r.get("date") or "")[:10]
    if not d:
        return []
    hid, hnote = resolver.resolve(sport, None, r.get("home_team"))
    aid, anote = resolver.resolve(sport, None, r.get("away_team"))
    base = dict(
        sport=sport, event_ref=None, game_date=d,
        home_team_raw=r.get("home_team"), away_team_raw=r.get("away_team"),
        home_team_id=str(hid) if hid else None, away_team_id=str(aid) if aid else None,
        bookmaker="sbr_consensus", provider="sbr", source="sbr", source_priority=100,
        booksum=None, ml_flag=None,
        resolution_status="resolved" if (hid and aid) else "unresolved",
        resolution_note=None if (hid and aid) else (hnote or anote or "unresolved_team"),
    )
    tot = num(r.get("close_total"))
    otot = num(r.get("open_total"))
    out = []
    for market, side, line, price, oline in (
        ("moneyline", "home", None, integer(r.get("home_ml")), None),
        ("moneyline", "away", None, integer(r.get("away_ml")), None),
        ("total", "over", tot, None, otot),
        ("total", "under", tot, None, otot),
        ("spread", "home", num(r.get("close_home_spread")), None, num(r.get("open_home_spread"))),
    ):
        if price is None and line is None:
            continue
        row = {**base, "market": market, "side": side, "line": line,
               "price": price, "open_line": oline, "open_price": None}
        if impossible_price(market, price):
            row["resolution_status"] = "unresolved"
            row["resolution_note"] = "impossible_american_price"
        out.append(row)
    return out


# ---------------------------------------------------------------------------
# game_result -- final scores, from the same files, resolved the same way.
#
# Every source above already carries home_score/away_score; they were parsed for
# gate 1's sanity checks and then thrown away. game_result keeps them, and it is
# the ONLY place NHL 2020-21 scores can live: SBR skips that season entirely and
# player_game_history has no NHL row for it either. ESPN core starts 2021-01-13,
# which is that season's opening night.
#
# Scores are per GAME, not per book line, so ESPN rows are collapsed by
# event_id -- 12,016 and 7,178 real events behind 102,632 odds rows.
# ---------------------------------------------------------------------------

# ZERO IS A PLACEHOLDER AGAIN, AND THIS TIME IT DEPENDS ON THE SPORT.
# ESPN writes 0-0 for a game that was postponed, cancelled or has not happened.
# In soccer 0-0 is also a perfectly ordinary final score, so it cannot simply be
# dropped everywhere. Measured over every past-dated event in both files:
#
#   soccer_epl 6.75%   soccer_mls 5.74%    <- real draw rates, keep
#   mlb 1.08%   nhl 0.42%   nba 0.19%      <- impossible finals, drop
#   nfl 0.00%   cfb 0.00%
#
# A baseball game cannot end 0-0 and neither can a hockey or basketball one, so
# every 0-0 in those columns is a game that was not played. This is the same
# lesson as ESPN's close_total == 0, one table over: a zero that the sport
# cannot produce is missing data wearing a number.
CAN_END_NIL_NIL = {"soccer_epl", "soccer_mls"}


def game_result_row(sport, event_ref, game_date, home_raw, away_raw, hid, aid,
                    hs, as_, venue, source, today):
    if hs is None or as_ is None or not game_date:
        return None
    # A future-dated row has no result to record no matter what it says.
    if game_date > today:
        return None
    if hs == 0 and as_ == 0 and sport not in CAN_END_NIL_NIL:
        return None
    return dict(sport=sport, event_ref=event_ref, game_date=game_date,
                home_team_raw=home_raw, away_team_raw=away_raw,
                home_team_id=str(hid) if hid else None,
                away_team_id=str(aid) if aid else None,
                home_score=hs, away_score=as_, venue=venue, source=source)


GR_COLS = ["sport", "event_ref", "game_date", "home_team_raw", "away_team_raw",
           "home_team_id", "away_team_id", "home_score", "away_score", "venue", "source"]


async def insert_results(pool, rows, batch=1000):
    """ON CONFLICT DO NOTHING against a natural key that now includes
    event_ref. Without it, 520 keys covering 1,044 events -- 511 of them MLB
    doubleheaders -- would collapse and lose 524 real games silently. See
    migration 20260901170000."""
    if not rows:
        return 0
    ph = ",".join(f"${i+1}" for i in range(len(GR_COLS)))
    sql = (f"INSERT INTO game_result ({','.join(GR_COLS)}) VALUES ({ph}) "
           f"ON CONFLICT DO NOTHING")
    n = 0
    async with pool.acquire() as conn:
        for i in range(0, len(rows), batch):
            chunk = rows[i:i + batch]
            await conn.executemany(sql, [tuple(r[c] for c in GR_COLS) for r in chunk])
            n += len(chunk)
    return n


COLS = ["sport", "event_ref", "game_date", "home_team_raw", "away_team_raw", "home_team_id",
        "away_team_id", "market", "side", "line", "price", "open_line", "open_price",
        "bookmaker", "provider", "source", "source_priority", "booksum", "ml_flag",
        "resolution_status", "resolution_note"]


async def insert(pool, rows, batch=1000):
    if not rows:
        return 0
    ph = ",".join(f"${i+1}" for i in range(len(COLS)))
    sql = f"INSERT INTO odds_import_staging ({','.join(COLS)}) VALUES ({ph})"
    n = 0
    async with pool.acquire() as conn:
        for i in range(0, len(rows), batch):
            chunk = rows[i:i + batch]
            await conn.executemany(sql, [
                tuple(
                    datetime.strptime(r[c], "%Y-%m-%d").date() if c == "game_date" and isinstance(r[c], str)
                    else r.get(c) for c in COLS
                ) for r in chunk
            ])
            n += len(chunk)
            if n % 20000 == 0:
                print(f"    inserted {n:,}", flush=True)
    return n


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--truncate", action="store_true")
    args = ap.parse_args()
    pool = await db.get_pool()
    if args.truncate:
        async with pool.acquire() as c:
            await c.execute("TRUNCATE odds_import_staging")
            await c.execute("TRUNCATE game_result")
        print("staging and game_result truncated")

    resolver = Resolver()
    espn = rows_of(DL / "espn_core_odds" / "espn_core_odds_all.csv") + \
        rows_of(DL / "espn_core_odds_v2" / "espn_core_odds_all.csv")
    print(f"espn rows: {len(espn):,}")
    for r in espn:
        resolver.learn_espn(r.get("sport"), r.get("home_abbr"), r.get("home_id"), r.get("home_team"))
        resolver.learn_espn(r.get("sport"), r.get("away_abbr"), r.get("away_id"), r.get("away_team"))
    print(f"resolver learned {len(resolver.by_abbr)} abbrs, {len(resolver.by_name)} names")

    today = datetime.now(timezone.utc).date()

    total = 0
    out, results, seen_events = [], [], set()
    for r in espn:
        out.extend(espn_long_rows(r, resolver))
        # One score row per EVENT, not per book line: the same game appears once
        # per provider in these files.
        eid = r.get("event_id")
        if eid and eid not in seen_events:
            seen_events.add(eid)
            sport = r.get("sport")
            d = (r.get("event_date") or "")[:10]
            hid, _ = resolver.resolve(sport, r.get("home_abbr"), r.get("home_team"))
            aid, _ = resolver.resolve(sport, r.get("away_abbr"), r.get("away_team"))
            gr = game_result_row(
                sport, eid, datetime.strptime(d, "%Y-%m-%d").date() if d else None,
                r.get("home_team"), r.get("away_team"), hid, aid,
                integer(r.get("home_score")), integer(r.get("away_score")),
                r.get("venue"), "espn_core", today)
            if gr:
                results.append(gr)
        if len(out) >= 40000:
            total += await insert(pool, out)
            out = []
    total += await insert(pool, out)
    print(f"espn staged: {total:,}")
    print(f"espn results: {await insert_results(pool, results):,} "
          f"of {len(seen_events):,} events")

    for sport, path in (("nba", DL / "nba_odds" / "nba_odds_all.csv"),
                        ("nhl", DL / "nhl_odds" / "nhl_odds_all.csv"),
                        ("nhl", DL / "nhl_odds_legacy" / "nhl_odds_all.csv")):
        src = rows_of(path)
        if not src:
            print(f"  {path.name}: missing")
            continue
        rows, n, res = [], 0, []
        for r in src:
            rows.extend(sbr_long_rows(r, sport, resolver))
            d = (r.get("date") or "")[:10]
            hid, _ = resolver.resolve(sport, None, r.get("home_team"))
            aid, _ = resolver.resolve(sport, None, r.get("away_team"))
            gr = game_result_row(
                sport, None, datetime.strptime(d, "%Y-%m-%d").date() if d else None,
                r.get("home_team"), r.get("away_team"), hid, aid,
                integer(r.get("home_score")), integer(r.get("away_score")),
                None, "sbr", today)
            if gr:
                res.append(gr)
            if len(rows) >= 40000:
                n += await insert(pool, rows)
                rows = []
        n += await insert(pool, rows)
        print(f"sbr {sport} {path.parent.name} staged: {n:,}, "
              f"results {await insert_results(pool, res):,}")
        total += n

    print(f"\nTOTAL STAGED: {total:,}")
    async with pool.acquire() as c:
        rs = await c.fetch("SELECT sport, resolution_status, count(*) n FROM odds_import_staging GROUP BY 1,2 ORDER BY 1,2")
        for r in rs:
            print(f"  {r['sport']:<12} {r['resolution_status']:<12} {r['n']:,}")


if __name__ == "__main__":
    if sys.platform.startswith("win"):
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(main())
