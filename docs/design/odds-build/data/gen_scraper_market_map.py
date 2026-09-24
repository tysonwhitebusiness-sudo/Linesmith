"""P2 seed: every scraper prop label and game-market string, mapped to line-buddy keys.

Reads a census of the scraper DB (read-only) and writes two CSVs beside this file:

    scraper_prop_labels.csv   source, label, rows_today, key, rule, status
    scraper_game_markets.csv  market, rows_2h, period, type, status

Run (line-buddy's venv, so entity_resolution imports):
    python-odds-service/.venv/Scripts/python.exe docs/design/odds-build/data/gen_scraper_market_map.py <vocab.json>

`vocab.json` is produced by the census query in P2-names.md §1. The decisions below
(MANUAL, PERIOD, POSITION_DEPENDENT, NO_APP_SPORT) ARE the spec: P2 ports them into
python-odds-service/src/scraper_markets.py and uses these CSVs as its coverage fixture.
"""
from __future__ import annotations

import collections
import csv
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "..", "..", "python-odds-service", "src"))
from entity_resolution import resolve_market_key  # noqa: E402


def norm(label: str) -> str:
    """lowercase, collapse whitespace/underscores/+ & punctuation to single spaces."""
    s = label.strip().lower().replace("&", "+")
    s = re.sub(r"[\s_]+", " ", s)
    return s.strip()


# ---------------------------------------------------------------------------
# NEW canonical keys P2 adds to BOTH alias maps (identity aliases) and to
# P1's MARKET_LABELS. Label in parentheses.
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

# Period prefixes for player props: the key is "<prefix>-<base key>".
PERIOD_PREFIX = [
    (re.compile(r"^(1h|1st half|first half)\s+"), "1h"),
    (re.compile(r"^(1q|1st quarter|first quarter)\s+"), "1q"),
    (re.compile(r"^(1st inn\.?|1st inning|first inning)\s+"), "1i"),
    (re.compile(r"^(1st set)\s+"), "1s"),
]

# (normalized label) -> key, for labels the app alias map does not resolve or
# resolves wrongly for the scraper's sources. Source-scoped overrides are in
# SOURCE_MANUAL. Values must be an existing canonical key or a NEW_KEYS key.
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
}

# (source, normalized label) -> key: where the source's meaning differs from the
# global one. Pinnacle/4codds list only pitcher strikeouts in MLB.
SOURCE_MANUAL = {
    ("pinnacle", "total strikeouts"): "pitcher-strikeouts",
    ("4codds", "total strikeouts"): "pitcher-strikeouts",
    ("draftkings", "strikeouts thrown"): "pitcher-strikeouts",
    ("betrivers", "strikeouts thrown"): "pitcher-strikeouts",
    ("4codds", "total hits allowed"): "pitcher-hits-allowed",
    ("4codds", "total earned runs"): "earned-runs",
}

# MLB labels whose meaning depends on whether the player pitches. Resolved at
# bridge time from the matched roster entry's position (P3): pitcher -> first,
# otherwise -> second; a two-way player (position TWP) stays UNRESOLVED.
POSITION_DEPENDENT = {
    "strikeouts": ("pitcher-strikeouts", "batter-strikeouts"),
    "strike outs": ("pitcher-strikeouts", "batter-strikeouts"),
    "strikeout": ("pitcher-strikeouts", "batter-strikeouts"),
    "total strikeouts": ("pitcher-strikeouts", "batter-strikeouts"),
    "walks": ("pitcher-walks-allowed", "walks"),
    "hits": ("pitcher-hits-allowed", "hits"),
}

# Labels needing a sample check before mapping (their meaning is not certain
# from the label alone). P2 step 2 resolves each by reading real offers.
VERIFY = {
    "base": "total-bases?", "touchdown to be": "anytime-td?", "combinedruns": "?",
    "1+ pass tds in each half": "?", "game high rush yards": "?", "game high pass yards": "?",
    "regular season goals": "(season-long, not a game prop)", "regular season points": "(season-long, not a game prop)",
    "wr.te fantasy points": "fantasy-points?", "qb fantasy points": "fantasy-points?", "rb fantasy points": "fantasy-points?",
    "1st inn. pitch count": "1i-pitcher-pitches-thrown?", "finishing position": "(golf finishing position)",
}

# Team markets that some sources file among player props: never a player prop.
NOT_PLAYER_PROP = {"team total runs"}

# Markets from sports the app does not cover: never mapped, never bridged.
NO_APP_SPORT_PATTERNS = [
    r"kills", r"headshots", r"round finish", r"^finishes$", r"^knockouts$", r"significant strikes",
    r"^submissions$", r"takedowns", r"fight time", r"total fight time", r"in games 1\+2",
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
    if n in VERIFY:
        return None, f"verify:{VERIFY[n]}", "verify"
    app = resolve_market_key(label)
    if app:
        return app, "app-alias", "mapped"
    return None, "none", "unmapped"


# ---------------------------------------------------------------------------
# Game markets: "<period>_<type>" grammar.
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


def main(vocab_path: str) -> None:
    v = json.load(open(vocab_path))
    rows = []
    for src, stat, n in v["prop_stats"]:
        key, rule, status = map_label(src, stat or "")
        rows.append((src, stat, n, key or "", rule, status))
    rows.sort(key=lambda r: -r[2])
    with open(os.path.join(HERE, "scraper_prop_labels.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["source", "label", "rows_today", "key", "rule", "status"])
        w.writerows(rows)
    tot = sum(r[2] for r in rows)
    by = collections.Counter()
    for r in rows:
        by[r[5]] += r[2]
    print("props:", {k: f"{v_ / tot:.1%}" for k, v_ in by.most_common()}, f"of {tot:,}")

    gm = collections.Counter()
    for _src, m, n in v["game_markets"]:
        gm[m] += n
    grows = []
    for m, n in gm.most_common():
        p, t, st = map_game_market(m)
        grows.append((m, n, p, t or "", st))
    with open(os.path.join(HERE, "scraper_game_markets.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["market", "rows_2h", "period", "type", "status"])
        w.writerows(grows)
    gt = sum(r[1] for r in grows)
    gb = collections.Counter()
    for r in grows:
        gb[r[4].split(" ")[0]] += r[1]
    print("game markets:", {k: f"{v_ / gt:.1%}" for k, v_ in gb.most_common()}, f"of {gt:,}")
    print("unmapped game markets:", [r[0] for r in grows if r[4] == "unmapped"])


if __name__ == "__main__":
    main(sys.argv[1])
