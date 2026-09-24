"""The scraper's vocabulary -> the app's market keys (P2 of the odds build, 2026-09-24).

A pure module (no DB, no network). Its dictionaries are ported VERBATIM from
docs/design/odds-build/data/gen_scraper_market_map.py, the generator whose
dictionaries are the decisions (P2-names.md), and whose CSVs
(scraper_prop_labels.csv, scraper_game_markets.csv) are this module's test
fixture (test_scraper_markets.py). Change a decision in the generator first,
re-run it, then port it here; the test fails if the two drift.

Only Python reads scraper labels: the bridge (P6) writes canonical keys, so
TypeScript never sees one. The new canonical keys (NEW_KEYS) are also identity
aliases in both MARKET_KEY_ALIASES maps, so labels and the drift test know them.

Some labels mean different things by source and by player: "Strikeouts" is
pitcher strikeouts at Pinnacle/DraftKings/4codds and batter strikeouts
elsewhere. So the map is source-scoped first (SOURCE_MANUAL), and the MLB
labels in POSITION_DEPENDENT resolve from the matched player's roster position
(P3): a pitcher gets the pitching key, anyone else the batting key, and a
two-way player stays unresolved, never guessed.
"""
from __future__ import annotations

import re

from entity_resolution import resolve_market_key

PITCHER_POSITIONS = frozenset({"P", "SP", "RP"})
TWO_WAY_POSITIONS = frozenset({"TWP"})

# Consensus/opener lines (never a sportsbook price; anopen feeds P5's openers,
# not prices) and book codes nobody has identified yet (kept on the laptop).
NON_PRICE_BOOKS = frozenset({"comparenbet_fair", "anconsensus", "anopen"})
UNIDENTIFIED_BOOKS = frozenset({"4c", "4cx", "apex", "3et", "sharpbookc", "sharpag", "sharpbet",
                                "amapola", "vertex", "buckeye", "predictfun", "playersfantasy", "pph", "hard"})


def norm(label: str) -> str:
    """lowercase, collapse whitespace/underscores/+ & punctuation to single spaces."""
    s = label.strip().lower().replace("&", "+")
    s = re.sub(r"[\s_]+", " ", s)
    return s.strip()



# ---------------------------------------------------------------------------
# Prop labels (verbatim from the generator)
# ---------------------------------------------------------------------------
NEW_KEYS = {
    "pass-rush-yards": "Pass + rush yards",
    "targets": "Targets",
    "tackles-assists": "Tackles + assists",
    "solo-tackles": "Solo tackles",
    "defensive-interceptions": "Interceptions (defense)",
    "fumbles-lost": "Fumbles lost",
    "extra-points-made": "Extra points made",
    "last-td-scorer": "Last TD scorer",
    "fantasy-points": "Fantasy points",
    "to-receive-card": "To be carded",
    "pitcher-pitches-thrown": "Pitches thrown",
    "pitcher-strikes-thrown": "Strikes thrown",
    "pitcher-batters-faced": "Batters faced",
    "pitcher-hits-walks-earned-runs": "Hits + walks + earned runs allowed",
    "pitcher-runs-allowed": "Runs allowed",
    "longest-pass": "Longest pass",
    "rush-yards-per-attempt": "Rush yards per attempt",
    "sets-won": "Sets won",
    "sets-played": "Sets played",
    "games-played": "Games played",
    "tiebreakers-played": "Tiebreakers played",
    "double-faults": "Double faults",
    "break-points-won": "Break points won",
    "points-won": "Points won",
    "strokes": "Strokes",
    "birdies-or-better": "Birdies or better",
    "bogeys-or-worse": "Bogeys or worse",
    "goalie-fantasy-points": "Goalie fantasy points",
}

PERIOD_PREFIX = [
    (re.compile(r"^(1h|1st half|first half)\s+"), "1h"),
    (re.compile(r"^(1q|1st quarter|first quarter)\s+"), "1q"),
    (re.compile(r"^(1st inn\.?|1st inning|first inning)\s+"), "1i"),
    (re.compile(r"^(1st set)\s+"), "1s"),
]

MANUAL = {
    # comparenbet (SportsGameOdds naming): player_<group>_<stat>
    "player touchdowns": "anytime-td", "player anytime td": "anytime-td",
    "player reception yds": "receiving-yards", "player rush yds": "rushing-yards",
    "player pass yds": "passing-yards", "player receiving longestreception": "longest-reception",
    "player shots on target": "shots-on-target", "player passing+rushing yards": "pass-rush-yards",
    "player pass tds": "passing-tds", "player rushing+receiving yards": "rush-rec-yards",
    "player pass completions": "passing-completions", "player rush attempts": "rushing-attempts",
    "player pass interceptions": "interceptions-thrown", "player rushing longestrush": "longest-rush",
    "player shots": "shots", "player passing longestcompletion": "longest-completion",
    "player pitching hits": "pitcher-hits-allowed", "player tackles assists": "tackles-assists",
    "player kicking totalpoints": "kicking-points", "player kicking points": "kicking-points",
    "player fieldgoals made": "field-goals-made", "player pitching basesonballs": "pitcher-walks-allowed",
    "player defense sacks": "sacks", "player defense assistedtackles": "assists",
    "player defense interceptions": "defensive-interceptions", "player defense solotackles": "solo-tackles",
    "player total saves": "saves", "player goals+assists": "goals-assists",
    "player batting runs+rbi": "runs-rbis", "player batting firsthomerun": "first-home-run",
    "player batting triples": "triples", "player last goal scorer": "last-goalscorer",
    "player first goal scorer": "first-goalscorer", "player last td": "last-td-scorer",
    "player reception tds": "receiving-tds", "player rush tds": "rushing-tds",
    "player pitching win": "pitcher-win", "player 1st td": "first-td-scorer",
    "player pitching pitchesthrown": "pitcher-pitches-thrown", "player pitching strikesthrown": "pitcher-strikes-thrown",
    "player receiving targets": "targets", "player rushing yardsperattempt": "rush-yards-per-attempt",
    "player tackles": "tackles", "player pitching battersfaced": "pitcher-batters-faced",
    "player fantasyscore": "fantasy-points", "player to receive card": "to-receive-card",
    "batter runs scored": "runs",
    # plain-English spellings (DK / FD / BetMGM / BetRivers / Pinnacle / Underdog / Sleeper / Kalshi)
    "total bases": "total-bases", "receiving yards": "receiving-yards", "anytime td": "anytime-td",
    "touchdown": "anytime-td", "anytime touchdowns": "anytime-td", "total touchdowns": "anytime-td",
    "total tds": "anytime-td", "player to score a touchdown": "anytime-td",
    "player to score first touchdown": "first-td-scorer", "last td scorer": "last-td-scorer",
    "hits, runs + rbis": "hits-runs-rbis", "h+r+rbi": "hits-runs-rbis", "singles": "singles",
    "player singles": "singles", "player doubles": "doubles", "player triples": "triples",
    "rbi": "rbis", "total home runs": "home-runs", "player to hit a home run": "home-runs",
    "receivingyards": "receiving-yards", "reception yards": "receiving-yards", "receiving yds": "receiving-yards",
    "total receiving yards": "receiving-yards", "rushingyards": "rushing-yards", "rushing yds": "rushing-yards",
    "total rushing yards": "rushing-yards", "passingyards": "passing-yards", "passing yds": "passing-yards",
    "total passing yards": "passing-yards", "total receptions": "receptions",
    "rush + rec yards": "rush-rec-yards", "rushing + receiving yards": "rush-rec-yards",
    "rushing + receiving yds": "rush-rec-yards", "rushing and reception yards": "rush-rec-yards",
    "rushingreceivingyards": "rush-rec-yards", "rushing and receiving yards": "rush-rec-yards",
    "pass + rush yards": "pass-rush-yards", "passing + rushing yards": "pass-rush-yards",
    "total passing + rushing yards": "pass-rush-yards", "passing and rushing yards": "pass-rush-yards",
    "rush attempts": "rushing-attempts", "rushing attempts": "rushing-attempts",
    "total rush attempts": "rushing-attempts", "pass attempts": "pass-attempts",
    "passing attempts": "pass-attempts", "total pass attempts": "pass-attempts",
    "pass completions": "passing-completions", "completions": "passing-completions",
    "passing completions": "passing-completions", "total pass completions": "passing-completions",
    "touchdown passes": "passing-tds", "touchdown passes thrown": "passing-tds",
    "touchdownpass": "passing-tds", "passing tds": "passing-tds", "total touchdown passes": "passing-tds",
    "interceptions thrown": "interceptions-thrown", "total interceptions": "interceptions-thrown",
    "interceptions": "interceptions-thrown", "longest reception": "longest-reception",
    "yards of longest reception": "longest-reception", "longest rush": "longest-rush",
    "yards of longest rush": "longest-rush", "longest passing completion": "longest-completion",
    "yards of longest completed pass": "longest-completion", "longest pass": "longest-pass",
    "fumbles lost": "fumbles-lost", "fantasy points": "fantasy-points", "solo tackles": "solo-tackles",
    "defensive ints": "defensive-interceptions", "tackles + assists": "tackles-assists",
    "tackles and assists": "tackles-assists", "defensive tackles (both solo + assists)": "tackles-assists",
    "xp made": "extra-points-made", "extra point made": "extra-points-made",
    "extra points made": "extra-points-made", "field goal made": "field-goals-made",
    "field goals made": "field-goals-made", "successful field goals": "field-goals-made",
    "total field goals": "field-goals-made", "kicking points": "kicking-points", "targets": "targets",
    "earned runs allowed": "earned-runs", "total earned runs": "earned-runs",
    "walks allowed": "pitcher-walks-allowed", "total hits allowed": "pitcher-hits-allowed",
    "hits allowed + walks allowed + earned runs allowed": "pitcher-hits-walks-earned-runs",
    "strikeouts thrown": "pitcher-strikeouts", "walks (batter)": "walks", "bat walks": "walks",
    "pts + rebs + asts": "points-rebounds-assists", "pts reb ast": "points-rebounds-assists", "pra": "points-rebounds-assists",
    "points + rebounds": "points-rebounds", "points + assists": "points-assists",
    "rebounds + assists": "rebounds-assists", "threes": "three-pointers-made",
    "3-pointers made": "three-pointers-made", "threes made": "three-pointers-made",
    "shots on target": "shots-on-target", "sets won": "sets-won", "sets played": "sets-played",
    "games played": "games-played", "tiebreakers played": "tiebreakers-played",
    "double faults": "double-faults", "breakpoints won": "break-points-won", "breakpts won": "break-points-won",
    "points won": "points-won", "strokes": "strokes", "atleast birdies": "birdies-or-better",
    "bogeys or worse": "bogeys-or-worse", "goalie fantasy points": "goalie-fantasy-points",
    "first inning runs": "1i-runs", "first half goals against": "1h-goals-against",
    "rec yards": "receiving-yards", "receiving tds": "receiving-tds", "batters faced": "pitcher-batters-faced",
    "pitch count": "pitcher-pitches-thrown", "runs allowed": "pitcher-runs-allowed",
    # --- P2 verify list, decided 2026-09-24 from 5+ real offers each ---
    # betrivers: lines 1.5/2.5 only, Over only, +3300..+18000 -> the 2+/3+ rungs of a
    # TD-count ladder; the line carries the count, as "total touchdowns" above does.
    "touchdown to be": "anytime-td",
    # betmgm: batters, lines 0.5 (145) and 1.5 (97), Over/Under pairs; betmgm lists
    # "Hits" separately, so "Base" is total bases.
    "base": "total-bases",
    # draftkings: WR/TE, QB, RB fantasy lines 7.0..20.75 at -110/-110 -> fantasy points.
    "wr.te fantasy points": "fantasy-points", "qb fantasy points": "fantasy-points",
    "rb fantasy points": "fantasy-points",
    # --- New spellings in the 2026-09-24 evening census (betmgm camel case, underdog) ---
    "longestpass": "longest-pass", "passingrushingyards": "pass-rush-yards",
    "passattempt": "pass-attempts", "passcompleted": "passing-completions",
    "rushingattempt": "rushing-attempts", "saves": "saves",
}

SKIP = {
    # betmgm: one market a day (A.J. Ewing, 0.5), a player "combined runs" that could be
    # runs or runs+RBIs; not certain from the label or the prices.
    "combinedruns": "ambiguous (1 market/day)",
    # underdog: Over-only yes/no at 0.5 (+102..+157, -139): a special, not a stat line.
    "1+ pass tds in each half": "yes/no special",
    # underdog: 0.5 Over-only at +806 / -103 / +201: "leads the game in", a special.
    "game high rush yards": "who-leads special", "game high pass yards": "who-leads special",
    # underdog: NHL season totals (Tkachuk 27.5 goals, Robertson 90.5 points): futures.
    "regular season goals": "season-long future", "regular season points": "season-long future",
    # underdog: Erik Jones / Logano / Chastain: NASCAR finishing position, not golf.
    "finishing position": "motorsport (no app sport)",
}

SOURCE_MANUAL = {
    ("pinnacle", "total strikeouts"): "pitcher-strikeouts",
    ("4codds", "total strikeouts"): "pitcher-strikeouts",
    ("draftkings", "strikeouts thrown"): "pitcher-strikeouts",
    ("betrivers", "strikeouts thrown"): "pitcher-strikeouts",
    ("4codds", "total hits allowed"): "pitcher-hits-allowed",
    ("4codds", "total earned runs"): "earned-runs",
}

POSITION_DEPENDENT = {
    "strikeouts": ("pitcher-strikeouts", "batter-strikeouts"),
    "strike outs": ("pitcher-strikeouts", "batter-strikeouts"),
    "strikeout": ("pitcher-strikeouts", "batter-strikeouts"),
    "total strikeouts": ("pitcher-strikeouts", "batter-strikeouts"),
    "walks": ("pitcher-walks-allowed", "walks"),
    "hits": ("pitcher-hits-allowed", "hits"),
}

VERIFY: dict[str, str] = {}  # every label on the P2 verify list was decided (MANUAL or SKIP)

# Team markets that some sources file among player props: never a player prop.
NOT_PLAYER_PROP = {"team total runs"}

# Markets from sports the app does not cover: never mapped, never bridged.
NO_APP_SPORT_PATTERNS = [
    r"kills", r"headshots", r"round finish", r"^finishes$", r"^knockouts$", r"significant strikes",
    r"^submissions$", r"takedowns", r"fight time", r"total fight time", r"in games 1\+2",
    r"on maps", r"qualifying position",  # esports maps; NASCAR qualifying (2026-09-24 census)
]

NOT_PLAYER_PROP = {"team total runs"}

# Markets from sports the app does not cover: never mapped, never bridged.
NO_APP_SPORT_PATTERNS = [
    r"kills", r"headshots", r"round finish", r"^finishes$", r"^knockouts$", r"significant strikes",
    r"^submissions$", r"takedowns", r"fight time", r"total fight time", r"in games 1\+2",
    r"on maps", r"qualifying position",  # esports maps; NASCAR qualifying (2026-09-24 census)
]

NO_APP_SPORT_PATTERNS = [
    r"kills", r"headshots", r"round finish", r"^finishes$", r"^knockouts$", r"significant strikes",
    r"^submissions$", r"takedowns", r"fight time", r"total fight time", r"in games 1\+2",
    r"on maps", r"qualifying position",  # esports maps; NASCAR qualifying (2026-09-24 census)
]

def map_label(source: str, label: str) -> tuple[str | None, str, str]:
    """-> (key, rule, status). status: mapped | position | verify | no-app-sport | unmapped."""
    n = norm(label)
    if (source, n) in SOURCE_MANUAL:
        return SOURCE_MANUAL[(source, n)], "source-manual", "mapped"
    for pat in NO_APP_SPORT_PATTERNS:
        if re.search(pat, n):
            return None, "no-app-sport", "no-app-sport"
    if n in POSITION_DEPENDENT:
        p, o = POSITION_DEPENDENT[n]
        return f"{p}|{o}", "position", "position"
    for rx, prefix in PERIOD_PREFIX:
        m = rx.match(n)
        if m:
            base_label = n[m.end():]
            base, rule, status = map_label(source, base_label)
            if base and status == "mapped":
                return f"{prefix}-{base}", f"period+{rule}", "mapped"
            if base and status == "position":
                p_, o_ = base.split("|")
                return f"{prefix}-{p_}|{prefix}-{o_}", f"period+{rule}", "position"
            return None, "period-unmapped", "unmapped"
    if n in MANUAL:
        return MANUAL[n], "manual", "mapped"
    if n in NOT_PLAYER_PROP:
        return None, "team-market", "not-a-player-prop"
    if n in SKIP:
        return None, f"skip:{SKIP[n]}", "skip"
    if n in VERIFY:
        return None, f"verify:{VERIFY[n]}", "verify"
    app = resolve_market_key(label)
    if app:
        return app, "app-alias", "mapped"
    return None, "none", "unmapped"



# ---------------------------------------------------------------------------
# Game markets: "<period>_<type>" (verbatim from the generator)
# ---------------------------------------------------------------------------
GAME_PERIOD = [
    (r"^(1h)_", "1h"), (r"^(2h)_", "2h"), (r"^(1q)_", "1q"), (r"^(2q)_", "2q"), (r"^(3q)_", "3q"), (r"^(4q)_", "4q"),
    (r"^(p1|1p)_", "p1"), (r"^(p2|2p)_", "p2"), (r"^(p3|3p)_", "p3"), (r"^(4p)_", "p4"),
    (r"^(f5|1ix5)_", "f5"), (r"^(1ix3)_", "f3"), (r"^(1ix7)_", "f7"),
    (r"^(1i)_", "i1"), (r"^(firstinning)_", "i1"), (r"^([2-9])i_", "i{n}"), (r"^(1s)_", "s1"), (r"^(1mx10)_", "m10"),
    (r"^(live)_", "live"),
]
GAME_TYPE = {
    "ml": "ml", "h2h": "ml", "sp": "sp", "spreads": "sp", "tot": "tot", "totals": "tot",
    "h2h_3way": "ml3", "1x2": "ml3", "tt_home": "tt_home", "tt_away": "tt_away", "team_points_ou": "tt",
    "total_points_odd_even": "odd_even", "total_points_eo": "odd_even", "points_eo": "odd_even", "even_odd": "odd_even",
    "team_points_eo": "team_odd_even", "bothteamsscored_yn": "btts", "points_yn": "score_yn",
    "points_yn_home": "score_yn_home", "points_yn_away": "score_yn_away", "first_to_score": "first_to_score",
    "firsttoscore_yn_away": "first_to_score_away", "overtime_yes_no": "overtime_yn",
    "touchdowns_ou": "tds_ou", "total_touchdowns_ou": "tds_ou", "team_touchdowns_ou": "team_tds_ou",
    "touchdowns_yn_home": "td_yn_home", "touchdowns_yn_away": "td_yn_away", "defensive_safeties": "safety_yn",
    "team_field_goals_ou": "team_fg_ou", "race_to_five_runs": "race_to_5", "race_to_seven_runs": "race_to_7",
    "team_w_highest_scoring_inning": "highest_scoring_inning", "team_to_win_more_innings": "more_innings",
    "batting_hits_yn": "hit_yn",
    "firsttoscore_yn_home": "first_to_score_home", "lasttoscore_yn_home": "last_to_score_home",
    "lasttoscore_yn_away": "last_to_score_away", "fieldgoals_made_yn": "fg_yn", "fieldgoals_made_yn_home": "fg_yn_home",
    "fieldgoals_made_yn_away": "fg_yn_away", "first_team_to_10_points": "race_to_10", "first_team_to_15_points": "race_to_15",
    "first_team_to_20_points": "race_to_20", "race_to_three_runs": "race_to_3", "batting_homeruns_yn_home": "hr_yn_home",
    "batting_homeruns_yn_away": "hr_yn_away", "total_field_goals_ou": "fg_ou", "touchdowns_yn": "td_yn",
    "receiving_touchdowns_yn_away": "rec_td_yn_away", "team_to_score_the_first_field_goal": "first_fg_team",
}


def map_game_market(m: str) -> tuple[str, str | None, str]:
    """-> (period, type, status)."""
    period, rest = "fg", m
    for pat, p in GAME_PERIOD:
        mm = re.match(pat, m)
        if mm:
            period = p.replace("{n}", mm.group(1)) if "{n}" in p else p
            rest = m[mm.end():]
            break
    if rest == "prop" or rest.startswith("player_"):
        return period, None, "not-a-game-market (player/special prop row)"
    t = GAME_TYPE.get(rest)
    return period, t, "mapped" if t else "unmapped"



# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------
def prop_market_key(source: str, label: str, position: str | None = None) -> str | None:
    """The app market key for a scraper prop label, or None (unmapped, verify, skip,
    no app sport, team market). `position` is the matched roster position (P3); a
    POSITION_DEPENDENT label with no position, or a two-way player, returns None."""
    key, _rule, status = map_label(source, label or "")
    if status == "mapped":
        return key
    if status == "position" and key:
        pos = (position or "").strip().upper()
        if not pos or pos in TWO_WAY_POSITIONS:
            return None
        pitcher_key, other_key = key.split("|")
        return pitcher_key if pos in PITCHER_POSITIONS else other_key
    return None


def prop_label_status(source: str, label: str) -> str:
    """mapped | position | verify | skip | no-app-sport | not-a-player-prop | unmapped:
    what the bridge reports for a row it did not write."""
    return map_label(source, label or "")[2]


def game_market(market: str) -> tuple[str, str] | None:
    """(period, type) for a scraper game-market string, or None. period: fg, 1h, 2h,
    1q..4q, p1..p4, f3, f5, f7, i1..i9, s1, m10, live. type: the GAME_TYPE values."""
    period, typ, status = map_game_market(market or "")
    return (period, typ) if status == "mapped" and typ else None


def bridgeable_book(book_key: str | None) -> bool:
    """False for None, a NON_PRICE_BOOKS row (a consensus or opener line, never a
    sportsbook price) and an UNIDENTIFIED_BOOKS code (kept on the laptop until identified)."""
    return bool(book_key) and book_key not in NON_PRICE_BOOKS and book_key not in UNIDENTIFIED_BOOKS
