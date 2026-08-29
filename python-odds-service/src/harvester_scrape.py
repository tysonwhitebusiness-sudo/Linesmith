"""OddsHarvester runner — scrapes OddsPortal.com (via the vendored
`oddsharvester/` package, called in-process — see `_run_harvester_cli`'s own
docstring for why it's an in-process library call and not a subprocess) and
writes the result into the same Postgres tables `python-odds-service`'s own
the-odds-api port writes (see predict/odds_lines_cycle.py's
`_game_odds_book_line_rows`), tagged `source='oddsharvester'`.

Deliberately NOT part of the SequentialQueue/JOB_REGISTRY this package's own
main.py runs (see job_queue.py) — a live Chromium process is 300-500MB+ on
its own, well past what that worker's hard 512MB budget has room for, and a
Playwright scrape has no natural cooperative-yield point the way NFL's
rate-limit sleeps do, so it would stall every other job for its full runtime
if it ran there. Runs instead on a dedicated always-on machine on a Windows
Scheduled Task (see scripts/harvester-laptop-setup.ps1) — GitHub Actions was
tried first and abandoned after confirming (real HTTP 429s, see that
script's own header) that OddsPortal blocks GitHub's shared runner IPs
wholesale; a residential/office IP doesn't share that problem. Communicates
with the rest of this app the same way every other cross-app boundary here
already does: shared Postgres tables, byte-for-byte agreed schema, no
HTTP/RPC layer.

Run directly: `python src/harvester_scrape.py [sport ...]` (defaults to every
sport in SCRAPE_CONFIG). Requires DATABASE_URL (same Postgres both apps use)
and the `oddsharvester` package installed with its Playwright browser.
"""
import asyncio
import dataclasses
import functools
import re
import sys
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime, timezone

import db
from game_context import Game, load_mlb_games, load_nhl_games, load_sport_games, load_tennis_games
from oddsharvester.core.market_extraction.line_tokens import line_name_to_token
from oddsharvester.core.scraper_app import run_scraper
from oddsharvester.utils.command_enum import CommandEnum
from predict.mlb_game_lines import BookmakerOdds, GameLine
from predict.odds_lines_cycle import _game_odds_book_line_rows, _game_odds_history_rows

HEALTH_CHECK_NAME = "oddsharvester_scrape"


async def _load_combined_tennis_games() -> list[Game]:
    """ATP + WTA together, each Game keeping its own real .sport
    ('tennis_atp'/'tennis_wta') — needed because OddsHarvester itself
    doesn't distinguish tours at the scrape level (no per-tour league key
    exists, see the "tennis" ScrapeTarget's own comment), so one scrape's
    results have to be matched against both tours' rosters at once."""
    atp, wta = await asyncio.gather(load_tennis_games("tennis_atp"), load_tennis_games("tennis_wta"))
    return atp + wta

# ---------------------------------------------------------------------------
# Per-sport scrape configuration. Phase 1 pilot: MLB only (verified against
# real fixture output this session). Extending to another sport (Phase 4 of
# the OddsHarvester gameplan) is adding one entry here — the CLI-invocation,
# parsing, and write path below are all sport-agnostic already, since they
# work off the CLI's real `{market}_market` output shape, not anything
# sport-specific.
# ---------------------------------------------------------------------------


@dataclass
class ScrapeTarget:
    sport: str  # our own sport key, e.g. 'mlb' — matches Game.sport / game_id join.
                # For a combined multi-tour target (tennis), this is a label
                # only; the real per-row sport comes from each MATCHED
                # Game's own .sport field, not this one — see run_target.
    harvester_sport: str  # OddsHarvester's sport key, e.g. 'baseball'
    # Exactly one of leagues/None is set. Most sports have a real umbrella
    # league key (MLB's "mlb", EPL's "england-premier-league"); tennis does
    # not — OddsPortal has 150+ per-tournament keys, no "all ATP" league —
    # so leagues=None falls back to a date-scoped, tournament-agnostic
    # scrape instead (verified live: returns real matches across every
    # active tournament for that date, ATP/WTA/challenger/ITF all mixed
    # together, same as the site's own /matches/tennis/<date>/ listing).
    leagues: list[str] | None
    markets: list[str]  # OddsHarvester market tokens for this sport
    load_games: callable  # async () -> list[Game]
    # False (default, MLB/tennis/soccer's real, proven shape): `markets` is
    # requested exactly as given, every cycle — correct for sports where a
    # small fixed set of lines (MLB's 8.5/9.0) or no totals/spread at all
    # covers real games well.
    # True (NFL/CFB, 2026-08-26): `markets` is the BASE set only
    # (typically just "home_away") — real totals/spread lines are instead
    # discovered per match via a cheap preview pass, matched against a real
    # reference total/spread already recovered from another provider
    # (Phase 1's SportsGameOdds/SharpAPI/Propline rows), and only the ONE
    # discovered line closest to that real reference gets the full
    # per-bookmaker extraction — "no alternate lines" per explicit
    # direction, after a live run discovered 41 real-but-irrelevant
    # alternate total lines for one NFL game. See run_dynamic_lines_target.
    dynamic_lines: bool = False


SCRAPE_CONFIG: dict[str, ScrapeTarget] = {
    "mlb": ScrapeTarget(
        sport="mlb",
        harvester_sport="baseball",
        leagues=["mlb"],
        # Baseball has no handicap/spread market on OddsPortal at all
        # (confirmed live this session, and in the vendored package's own
        # README). Earlier attempts to add totals coverage all exceeded
        # budget — root cause was a real upstream bug (fixed in
        # sport_market_registry.py, see _format_line_number): whole-number
        # lines like over_under_9_0 built click-text "+9.0" against a page
        # that actually renders "+9", so every whole-number line failed its
        # click on every match, each failure costing a real timeout for zero
        # benefit. Fixed and reverified live: 15/15 matches, 100% success,
        # 438s real (see SCRAPE_TIMEOUT_SECONDS above). Also surfaced a real,
        # useful finding: most books quote BOTH 8.5 and 9.0 simultaneously
        # (not "9.0 doesn't exist" as first assumed) — the conflict-warning
        # logic in _record_to_game_line currently keeps only the first and
        # logs the rest, since BookmakerOdds holds one line per book; capturing
        # both simultaneously would need a schema change (point in the key),
        # a real open decision, not something to make unilaterally here.
        markets=["home_away", "over_under_8_5", "over_under_9_0"],
        load_games=load_mlb_games,
    ),
    # Soccer's real moneyline market is "1x2" (three-way: home/draw/away),
    # not "home_away" (baseball's two-way convention) — draw_odds is a real
    # field on BookmakerOdds now (added alongside this), not silently
    # dropped. Totals/spread now dynamic_lines too (2026-08-26) — football's
    # own umbrella markets (FOOTBALL_UMBRELLA_MARKETS) already existed
    # before this session, just never requested here; reusing the same
    # reference-based, one-real-line-per-match mechanism NFL/CFB use rather
    # than blindly expanding every discovered line, since soccer's real
    # total/spread range hasn't been live-verified to be as tightly
    # clustered as MLB's — safer to not assume.
    "soccer_epl": ScrapeTarget(
        sport="soccer_epl",
        harvester_sport="football",
        leagues=["england-premier-league"],
        markets=["1x2"],
        load_games=functools.partial(load_sport_games, "soccer_epl"),
        dynamic_lines=True,
    ),
    "soccer_mls": ScrapeTarget(
        sport="soccer_mls",
        harvester_sport="football",
        leagues=["usa-mls"],
        markets=["1x2"],
        load_games=functools.partial(load_sport_games, "soccer_mls"),
        dynamic_lines=True,
    ),
    # NFL/CFB: home_away + real totals/spread coverage via dynamic-lines
    # discovery (2026-08-26, odds-architecture rebuild Phase 4) — see
    # ScrapeTarget.dynamic_lines and run_dynamic_lines_target's own
    # docstring for the full mechanism. `markets` here is intentionally
    # just the base moneyline; the real total/spread tokens are computed
    # per match at run time, not listed statically. A first live pass using
    # the vendored umbrella-expansion mechanism directly (expand every
    # discovered line, full-extract every one) found a real problem before
    # this landed: one NFL game alone discovered 41 alternate total lines
    # (14.5 through 54.5), each getting its own full per-bookmaker
    # extraction attempt for essentially no signal — that approach is not
    # used here.
    "nfl": ScrapeTarget(
        sport="nfl",
        harvester_sport="american-football",
        leagues=["nfl"],
        markets=["home_away"],
        load_games=functools.partial(load_sport_games, "nfl"),
        dynamic_lines=True,
    ),
    "cfb": ScrapeTarget(
        sport="cfb",
        harvester_sport="american-football",
        leagues=["ncaa"],
        markets=["home_away"],
        load_games=functools.partial(load_sport_games, "cfb"),
        dynamic_lines=True,
    ),
    # NBA/NHL: wired up ahead of their real seasons starting (both are
    # genuinely off-season right now - NBA preseason starts October, NHL
    # mid-September) so the config exists before the odds pipeline is
    # "locked in" and prediction-model work for these sports begins. The
    # matching logic (_match_game, _FULL_NAME_ALIASES, accent-stripping) was
    # verified against real data either way: NBA reuses load_sport_games's
    # existing ESPN loader (same as NFL/CFB), and NHL's real official
    # regular-season schedule (gameType 2, load_nhl_games) was fetched live
    # for October dates to confirm parsing - the season being months away
    # doesn't mean the schedule doesn't already exist.
    #
    # NBA: totals/spread now dynamic_lines too (2026-08-26), the same
    # reference-based mechanism as NFL/CFB — a real reference IS available:
    # SportsGameOdds already covers NBA (Phase 1's recovered game-lines).
    # Reuses BasketballOverUnderMarket/BasketballAsianHandicapMarket
    # (line_tokens.py's own per-sport handling for basketball's "_games"
    # prefix/suffix token quirk). Not yet live-verified (NBA preseason
    # starts October) — same "wired ahead of season start" precedent this
    # config already follows.
    "nba": ScrapeTarget(
        sport="nba",
        harvester_sport="basketball",
        leagues=["nba"],
        markets=["home_away"],
        load_games=functools.partial(load_sport_games, "nba"),
        dynamic_lines=True,
    ),
    # NHL: NOT dynamic_lines — deliberately different from NBA/NFL/CFB.
    # No provider recovers a real NHL reference total/spread anywhere in
    # this codebase (NHL is absent from _SGO_LEAGUE_IDS, _PROPLINE_SPORT_
    # KEYS, and every other provider's sport list in providers.py) — per
    # the odds-architecture plan, OddsHarvester IS NHL's sole game-lines
    # source, so run_dynamic_lines_target's own reference lookup would
    # always find nothing and permanently fall back to home_away-only,
    # silently never producing totals/spread. Same fixed-line approach as
    # MLB instead: real NHL totals cluster tightly (~5.5-6.5) and the real
    # puck line is almost always exactly +-1.5 (rarely +-2.5) — a small
    # static set covers nearly every real game without needing any
    # reference. Both signed handicap tokens are requested; whichever
    # side isn't the real favorite simply isn't found on that match's page
    # (the same safe "not found" handling every other market already has).
    "nhl": ScrapeTarget(
        sport="nhl",
        harvester_sport="ice-hockey",
        leagues=["nhl"],
        markets=["home_away", "over_under_5_5", "over_under_6_5", "asian_handicap_-1_5", "asian_handicap_+1_5"],
        load_games=load_nhl_games,
    ),
    # No per-tour league key exists (OddsPortal has 150+ individual
    # tournament keys, no umbrella "ATP"/"WTA") — leagues=None falls back to
    # a date-scoped, tour-agnostic scrape (see _run_harvester_cli), verified
    # live to return real matches across whatever tournaments are active.
    # `sport="tennis"` here is a label only; each row's REAL sport
    # (tennis_atp vs tennis_wta) comes from whichever tour's own roster the
    # match's players matched against, tracked per-game in run_target, since
    # ATP and WTA results are mixed together in one scrape's output with no
    # tour field of their own to read.
    "tennis": ScrapeTarget(
        sport="tennis",
        harvester_sport="tennis",
        leagues=None,
        markets=["match_winner"],
        load_games=_load_combined_tennis_games,
    ),
}


# ---------------------------------------------------------------------------
# Team-name matching — port of lib/odds/merge.ts's matchupKey/norm, the
# existing, proven approach for joining OddsHarvester's own team-name
# strings (which don't always match the official API's naming exactly)
# against this app's own game list. providers.py's _team_match (used for
# every other provider) is exact-string-only, which is fine for providers
# that already resolve against our own game list server-side; OddsHarvester
# supplies raw scraped names, the same situation merge.ts was written for.
# ---------------------------------------------------------------------------


# Team-name normalisation moved to entity_resolution.py in task 5.8 so
# providers.py's _team_match could share this exact implementation rather
# than keep a weaker second one. Imported under the original private names
# so every call site below is untouched.
from entity_resolution import (  # noqa: E402
    MIN_CONTAINMENT_LEN as _MIN_CONTAINMENT_LEN,
    normalize_team_name as _norm,
    team_name_words as _norm_words,
)


def _match_game(games: list[Game], home_team: str, away_team: str) -> Game | None:
    """Per-side matching (side_matches), tried exact first, then two safe
    fallbacks, then two whole-game fallbacks below that need both sides at
    once. OddsPortal routinely shortens club names in ways plain equality
    can't survive - real mismatches found live and fixed here, not guessed
    in advance (MLB's simple "City Nickname" names never exposed any of
    this):
      - abbreviation match (CFB: OddsPortal's bare "TCU"/"USC" against
        ESPN's own curated home_abbr/away_abbr field, e.g. ESPN's real name
        "TCU Horned Frogs" carries abbr "TCU" - safe and precise since
        ESPN's abbreviations are already unique, official per-team codes,
        unlike a raw 3-char substring check which would need the same
        _MIN_CONTAINMENT_LEN guard short acronyms fall below)
      - substring containment (EPL: "Nottingham" for "Nottingham Forest",
        "Hull" for "Hull City", "Newcastle" for "Newcastle United", etc.)
    Below that, two whole-game fallbacks that can't be decided per side:
      - word-set equality, order-independent (MLS: "Red Bull New York" vs
        "New York Red Bulls")
      - tennis's "Surname F." player-name parsing (see _player_name_matches)
    A team matching via one mechanism on one side never requires the other
    side to match the same way - each side picks whichever check succeeds
    first.
    """
    def side_matches(raw_norm: str, game_full_name: str, game_abbr: str) -> bool:
        game_n = _norm(game_full_name)
        if raw_norm == game_n:
            return True
        # Abbreviation match: safe and precise on its own, independent of
        # _MIN_CONTAINMENT_LEN, since ESPN's abbr codes are already unique,
        # official per-team identifiers (e.g. "TCU Horned Frogs" carries
        # abbr "TCU") - not a coincidental short substring the way a raw
        # 3-char containment check would risk.
        abbr_n = re.sub(r"[^a-z]", "", game_abbr.lower())
        if abbr_n and raw_norm == abbr_n:
            return True
        if len(raw_norm) < _MIN_CONTAINMENT_LEN or len(game_n) < _MIN_CONTAINMENT_LEN:
            return False
        return raw_norm in game_n or game_n in raw_norm

    home_n, away_n = _norm(home_team), _norm(away_team)
    for g in games:
        if side_matches(home_n, g.home_team_name, g.home_abbr) and side_matches(away_n, g.away_team_name, g.away_abbr):
            return g

    home_w, away_w = _norm_words(home_team), _norm_words(away_team)
    for g in games:
        if _norm_words(g.home_team_name) == home_w and _norm_words(g.away_team_name) == away_w:
            return g

    for g in games:
        if _player_name_matches(home_team, g.home_team_name) and _player_name_matches(away_team, g.away_team_name):
            return g

    return None


# OddsPortal renders tennis players as "Surname F." (verified against the
# vendored package's own real fixture: "Djokovic N.", "Sinner J.") — a
# structurally different problem from the team-name cases above, not just a
# shorter version of the same string. Our own ESPN-sourced Game names are
# "Firstname Lastname" (game_context.py's load_tennis_games reads ESPN's
# fullName field directly). Neither containment nor the word-set fallback
# can bridge this: a single-letter initial gets filtered out of
# _norm_words entirely (its len<3 guard), so "Djokovic N." reduces to just
# {"djokovic"} while "Novak Djokovic" reduces to {"novak", "djokovic"} —
# never equal. Needs its own real parse, not a looser generic heuristic.
_SURNAME_INITIAL_RE = re.compile(r"^(.+?)\s+([A-Za-z])\.?$")


def _player_name_matches(oddsportal_name: str, full_name: str) -> bool:
    m = _SURNAME_INITIAL_RE.match(oddsportal_name.strip())
    if not m:
        return _norm(oddsportal_name) == _norm(full_name)  # non-tennis or already full-form input
    surname, initial = m.group(1).lower(), m.group(2).lower()
    full_words = re.findall(r"[a-z]+", full_name.lower())
    if surname.replace(" ", "") not in "".join(full_words):
        return False
    return any(w.startswith(initial) and w != surname for w in full_words) or len(full_words) == 1


# ---------------------------------------------------------------------------
# Odds-value parsing — OddsHarvester's own docs (agentic-gotchas.md §3)
# document some UK bookmakers returning fractional odds ("4/5") even when
# decimal format is requested; their own parse_odds_value() adds 1 to the
# fraction's value. Guarding for it here too since this module consumes
# their raw JSON output directly, not through their own parser.
# ---------------------------------------------------------------------------

_FRACTION_RE = re.compile(r"^\s*(\d+)\s*/\s*(\d+)\s*$")


def _parse_decimal_odds(raw: str | float | None) -> float | None:
    if raw is None:
        return None
    if isinstance(raw, (int, float)):
        return float(raw) if raw > 1 else None
    text = str(raw).strip()
    frac = _FRACTION_RE.match(text)
    if frac:
        num, denom = int(frac.group(1)), int(frac.group(2))
        return (num / denom) + 1 if denom else None
    try:
        value = float(text)
    except ValueError:
        return None
    return value if value > 1 else None


# ---------------------------------------------------------------------------
# Record parsing — the CLI's real, current output shape (verified against
# the vendored package's own test fixtures this session, not guessed):
# a flat JSON array, one dict per match, with `match_link`, `home_team`,
# `away_team`, `live_period`/`live_score_home`/`live_score_away` (live mode
# only), and one `{market_token}_market` key per requested market — each an
# array of per-bookmaker rows. Two shapes observed:
#   - moneyline ("home_away"): {"1": "<home decimal>", "2": "<away decimal>",
#     "bookmaker_name": ..., "period": ...} — "1"/"2" is OddsPortal's
#     universal 1X2 convention (1=home, 2=away), not first-listed-team order.
#   - totals ("over_under_N"): {"odds_over": ..., "odds_under": ...,
#     "bookmaker_name": ..., "period": ...} — the line itself isn't a field,
#     it's encoded in the market token (over_under_8_5 -> point 8.5).
# ---------------------------------------------------------------------------

_OU_POINT_RE = re.compile(r"^over_under_(\d+)(?:_(\d+))?$")
# Asian Handicap tokens are SIGNED (asian_handicap_-3_5, asian_handicap_+2, asian_handicap_0)
# — see AmericanFootballAsianHandicapMarket's own values — unlike over/under tokens, which
# are always positive (a total line is never negative).
_HANDICAP_POINT_RE = re.compile(r"^asian_handicap_([+-]?\d+)(?:_(\d+))?$")


def _market_point(market_token: str) -> float | None:
    m = _OU_POINT_RE.match(market_token)
    if not m:
        return None
    whole, frac = m.group(1), m.group(2)
    return float(f"{whole}.{frac}") if frac else float(whole)


def _handicap_point(market_token: str) -> float | None:
    m = _HANDICAP_POINT_RE.match(market_token)
    if not m:
        return None
    whole, frac = m.group(1), m.group(2)
    return float(f"{whole}.{frac}") if frac else float(whole)


def _record_to_game_line(record: dict, game_id: str) -> GameLine:
    """One record -> one GameLine, bookmakers merged field-by-field across
    every market key in the record (a book quoting moneyline in one block
    and totals in another must end up as ONE BookmakerOdds row for that
    book, not two partial ones — same reasoning lib/odds/oddsHarvester.ts's
    mergeBookmaker already documents for the old schema)."""
    books: dict[str, BookmakerOdds] = {}

    def book_for(name: str) -> BookmakerOdds:
        if name not in books:
            books[name] = BookmakerOdds(bookmaker=name)
        return books[name]

    # BookmakerOdds (the shared the-odds-api-derived shape) has exactly one
    # point/over_price/under_price slot per book — it was designed for
    # the-odds-api, which only ever reports one CURRENT total line per book.
    # Requesting several explicit over_under_N tokens from OddsHarvester
    # (SCRAPE_CONFIG's real MLB market list) is how we catch whichever line
    # a given book is actually sitting at without knowing it in advance —
    # but if OddsPortal genuinely returns real data for the SAME bookmaker
    # at more than one of those requested lines in one record, only the
    # first one survives here (deterministic, not "whichever key iterated
    # last"), and the conflict is logged rather than silently dropped —
    # OddsHarvester's own docs call this discipline out by name ("skip
    # silently, log loudly") after a real bug where silent drops went
    # unnoticed for months.
    seen_total_point: dict[str, float] = {}

    # Same one-line-per-book limitation as seen_total_point below, mirrored for
    # spread/handicap: BookmakerOdds has exactly one spread_home/spread_away slot per
    # book, but the umbrella "asian_handicap" expansion (2026-08-26) can request
    # several real discovered handicap lines in one scrape. First real value wins,
    # conflicts logged rather than silently dropped — same discipline as totals.
    seen_handicap_point: dict[str, float] = {}

    for key, rows in record.items():
        if not key.endswith("_market") or not isinstance(rows, list):
            continue
        market_token = key[: -len("_market")]
        point = _market_point(market_token)
        handicap_point = _handicap_point(market_token)

        for row in rows:
            name = row.get("bookmaker_name")
            if not name:
                continue
            b = book_for(name)

            if market_token in ("home_away", "1x2"):
                # 1x2 (soccer's real three-way moneyline: home/draw/away) is
                # the same "1"/"2" home/away convention plus a real third
                # outcome, "X" — home_away (two-way sports: baseball, etc.)
                # simply never has an "X" key to read.
                home = _parse_decimal_odds(row.get("1"))
                away = _parse_decimal_odds(row.get("2"))
                draw = _parse_decimal_odds(row.get("X"))
                if home is not None:
                    b.home_odds = home
                if away is not None:
                    b.away_odds = away
                if draw is not None:
                    b.draw_odds = draw
            elif market_token == "match_winner":
                # Tennis's own moneyline keys — "player_1"/"player_2", not
                # "1"/"2" (verified against the vendored package's own real
                # fixture) — home/away here means the two players in the
                # SAME order match_link/home_team/away_team already use.
                home = _parse_decimal_odds(row.get("player_1"))
                away = _parse_decimal_odds(row.get("player_2"))
                if home is not None:
                    b.home_odds = home
                if away is not None:
                    b.away_odds = away
            elif point is not None:
                over = _parse_decimal_odds(row.get("odds_over"))
                under = _parse_decimal_odds(row.get("odds_under"))
                if over is None and under is None:
                    continue
                prior_point = seen_total_point.get(name)
                if prior_point is not None and prior_point != point:
                    print(
                        f"[harvester_scrape] {name} has real totals data at both {prior_point} and {point} "
                        f"for {record.get('away_team')} @ {record.get('home_team')} — keeping {prior_point}, "
                        f"discarding {point} (BookmakerOdds holds one line per book)",
                        flush=True,
                    )
                    continue
                seen_total_point[name] = point
                if over is not None:
                    b.over_price = over
                if under is not None:
                    b.under_price = under
                b.point = point
            elif handicap_point is not None:
                # register_american_football_markets registers Asian Handicap
                # rows with odds_labels=["1", "2"] (same convention as
                # home_away's own moneyline "1"/"2") — "1" is the home team's
                # price AT this handicap, "2" the away team's. A single
                # discovered token is one signed line (e.g. -3.5) applied to
                # home; away's own line is the standard Asian-Handicap mirror
                # (+3.5) by definition, not independently reported by OddsPortal.
                home_price = _parse_decimal_odds(row.get("1"))
                away_price = _parse_decimal_odds(row.get("2"))
                if home_price is None and away_price is None:
                    continue
                prior_point = seen_handicap_point.get(name)
                if prior_point is not None and prior_point != handicap_point:
                    print(
                        f"[harvester_scrape] {name} has real handicap data at both {prior_point} and "
                        f"{handicap_point} for {record.get('away_team')} @ {record.get('home_team')} — "
                        f"keeping {prior_point}, discarding {handicap_point} (BookmakerOdds holds one line per book)",
                        flush=True,
                    )
                    continue
                seen_handicap_point[name] = handicap_point
                if home_price is not None:
                    b.spread_home = handicap_point
                    b.spread_home_price = home_price
                if away_price is not None:
                    b.spread_away = -handicap_point
                    b.spread_away_price = away_price

    # Disclosed gap, not a silent drop: OddsHarvester's live mode also
    # returns live_score_home/live_score_away/live_period, but GameLine
    # (reused as-is from the-odds-api's own port, which never had live
    # scores to carry) has no field for them. Live-score capture is out of
    # scope for this pass — this pilot is the current-odds bookmaker grid,
    # not a live scoreboard — and would need a GameLine field added, not
    # something to bolt on quietly here.

    return GameLine(
        event_id=game_id,
        commence_time=record.get("match_date") or "",
        home_team=record.get("home_team") or "",
        away_team=record.get("away_team") or "",
        bookmakers=list(books.values()),
        book_count=len(books),
    )


# ---------------------------------------------------------------------------
# Dynamic-lines discovery (2026-08-26) — sports whose real total/spread
# range is too wide for a small fixed set of guessed lines (NFL, CFB — see
# their own ScrapeTarget.dynamic_lines comment). Real totals/spreads are
# discovered per match, then narrowed to just the ONE line closest to a
# real reference value already recovered from another provider (Phase 1's
# SportsGameOdds/SharpAPI/Propline rows) — "no alternate lines" per
# explicit direction, after a live run found OddsPortal renders dozens of
# real alternate lines under one Over/Under tab for American football,
# almost all of them thin/single-book and irrelevant to "the" game line.
# ---------------------------------------------------------------------------

_LINE_NUMBER_RE = re.compile(r"([+-]?\d+(?:\.\d+)?)")


def _parse_line_number(submarket_name: str) -> float | None:
    """"Over/Under +44.5" -> 44.5, "Asian Handicap -2.5" -> -2.5. None if no
    number is found (a genuinely malformed/unexpected label — skip rather
    than guess)."""
    m = _LINE_NUMBER_RE.search(submarket_name)
    return float(m.group(1)) if m else None


def _reference_points_by_game(rows: list) -> dict[tuple[str, str], float]:
    """(game_id, market) -> the real reference point, picking the freshest
    row from any source OTHER than oddsharvester itself (Phase 1's
    recovered SportsGameOdds/SharpAPI/Propline rows — this function exists
    specifically to give OddsHarvester's own discovery something real to
    target, so it must never consider OddsHarvester's own prior guesses as
    that reference). 'total' is side-independent (over/under share one
    point); 'spread' uses the home side's own signed point, matching
    handicap_point's own sign convention in _record_to_game_line above."""
    best: dict[tuple[str, str], tuple[float, str]] = {}
    for r in rows:
        if r.source == "oddsharvester" or r.point is None:
            continue
        if r.market == "total":
            key = (r.game_id, "total")
        elif r.market == "spread" and r.side == "home":
            key = (r.game_id, "spread")
        else:
            continue
        cur = best.get(key)
        if cur is None or r.fetched_at > cur[1]:
            best[key] = (r.point, r.fetched_at)
    return {k: v[0] for k, v in best.items()}


def _closest_line_token(discovered_rows: list, main_market: str, harvester_sport: str, reference: float) -> str | None:
    """Among a match's discovered lines for one main market (real rendered
    rows, from a cheap preview-mode pass — see run_dynamic_lines_target),
    finds the one numerically closest to `reference` and converts it to a
    real registered token via oddsharvester's own line_name_to_token (the
    same conversion the umbrella-expansion mechanism uses internally) —
    never a token that isn't already a real, registered, wide-enough enum
    value. None if no discovered row has a parseable number."""
    best_label: str | None = None
    best_distance: float | None = None
    for row in discovered_rows:
        label = row.get("submarket_name")
        if not label:
            continue
        value = _parse_line_number(label)
        if value is None:
            continue
        distance = abs(value - reference)
        if best_distance is None or distance < best_distance:
            best_label, best_distance = label, distance
    if best_label is None:
        return None
    return line_name_to_token(harvester_sport, main_market, best_label)


async def run_dynamic_lines_target(target: ScrapeTarget, games: list[Game]) -> list[dict]:
    """Real totals/spread for a dynamic_lines sport (NFL/CFB), narrowed to
    one real line per match instead of every alternate OddsPortal renders.

    Two passes, reusing existing, unmodified oddsharvester entry points —
    no per-match plumbing added to the vendored package itself:

    1. A cheap discovery pass (`preview_submarkets_only=True`, the same
       collapsed-odds read the "best price" preview feature already uses)
       across the whole league — one page read per match, no clicking,
       returns every real line OddsPortal is currently rendering plus its
       best/highest collapsed price, for both Over/Under and Asian
       Handicap.
    2. Each discovered match is matched (_match_game, the same fuzzy
       team-name matcher this module already uses) against a real
       reference total/spread already recovered from another provider
       (Phase 1). The ONE discovered line closest to that real reference,
       per market, becomes a concrete target token (e.g. "over_under_44_5").
       A game with no real reference yet gets no totals/spread this cycle —
       never a blind guess at which of many discovered lines is real.
    3. One targeted `scrape_matches` call (match_links=[...], markets=
       [*target.markets, <every match's own target tokens>]) — target.markets
       is the sport's real base moneyline token ("home_away" for NFL/CFB,
       "1x2" for soccer — never hardcoded here, since a hardcoded
       "home_away" would silently request the wrong market for soccer).
       Same shared-browser-session, semaphore-controlled per-match loop the
       base-market-only scrapes already use. A token computed for a
       DIFFERENT match simply isn't found on a given match's own page
       (existing, already-safe "not found" handling — a harmless extra
       click attempt, not an error).

    `games` is passed in rather than loaded here — run_target already loads
    it once for the later team-name matching pass, no reason to load twice.
    """
    reference_points = _reference_points_by_game(await db.read_game_odds_book_lines_for_sport(target.sport))
    if not reference_points:
        print(
            f"[harvester_scrape] {target.sport}: no reference totals/spreads recovered yet from any other "
            f"provider — scraping {target.markets} only this cycle",
            flush=True,
        )
        return await _run_harvester_cli(dataclasses.replace(target, dynamic_lines=False))

    discovery_kwargs: dict = dict(
        command=CommandEnum.UPCOMING_MATCHES,
        sport=target.harvester_sport,
        markets=["over_under", "asian_handicap"],
        preview_submarkets_only=True,
        headless=True,
        concurrency_tasks=1,
    )
    if target.leagues is not None:
        discovery_kwargs["leagues"] = target.leagues
        discovery_kwargs["kickoff_within_hours"] = 168.0
    else:
        discovery_kwargs["date"] = datetime.now(timezone.utc).strftime("%Y%m%d")

    try:
        discovery = await asyncio.wait_for(run_scraper(**discovery_kwargs), timeout=SCRAPE_TIMEOUT_SECONDS)
    except asyncio.TimeoutError:
        raise RuntimeError(f"oddsharvester discovery pass for {target.sport} exceeded {SCRAPE_TIMEOUT_SECONDS}s")
    if discovery is None:
        raise RuntimeError(f"oddsharvester discovery pass for {target.sport}: run_scraper returned None")

    match_targets: dict[str, set[str]] = {}
    for record in discovery.success:
        home_raw, away_raw = record.get("home_team") or "", record.get("away_team") or ""
        game = _match_game(games, home_raw, away_raw)
        match_link = record.get("match_link")
        if game is None or not match_link:
            continue
        tokens: set[str] = set()

        ref_total = reference_points.get((game.game_id, "total"))
        if ref_total is not None:
            token = _closest_line_token(record.get("over_under_market") or [], "Over/Under", target.harvester_sport, ref_total)
            if token:
                tokens.add(token)

        ref_spread = reference_points.get((game.game_id, "spread"))
        if ref_spread is not None:
            token = _closest_line_token(record.get("asian_handicap_market") or [], "Asian Handicap", target.harvester_sport, ref_spread)
            if token:
                tokens.add(token)

        if tokens:
            match_targets[match_link] = tokens

    if not match_targets:
        print(
            f"[harvester_scrape] {target.sport}: discovery found no lines close enough to any real "
            f"reference — {target.markets} only this cycle",
            flush=True,
        )
        return await _run_harvester_cli(dataclasses.replace(target, dynamic_lines=False))

    all_tokens = sorted({t for tokens in match_targets.values() for t in tokens})
    print(
        f"[harvester_scrape] {target.sport}: targeting {len(all_tokens)} real discovered line(s) across "
        f"{len(match_targets)} matched game(s): {all_tokens}",
        flush=True,
    )

    try:
        result = await asyncio.wait_for(
            run_scraper(
                command=CommandEnum.UPCOMING_MATCHES,
                match_links=list(match_targets.keys()),
                sport=target.harvester_sport,
                markets=[*target.markets, *all_tokens],
                headless=True,
                concurrency_tasks=1,
            ),
            timeout=SCRAPE_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        raise RuntimeError(f"oddsharvester targeted scrape for {target.sport} exceeded {SCRAPE_TIMEOUT_SECONDS}s")
    if result is None:
        raise RuntimeError(f"oddsharvester targeted scrape for {target.sport}: run_scraper returned None")
    if not result.success and result.failed:
        raise RuntimeError(
            f"oddsharvester targeted scrape for {target.sport}: all {len(result.failed)} match(es) failed "
            f"(first: {result.failed[0].error_message})"
        )
    return result.success


# ---------------------------------------------------------------------------
# CLI invocation
# ---------------------------------------------------------------------------

# Real measured costs, concurrency 1, no other load:
# MLB (15 matches): home_away alone = 3m30s (210s); home_away + 2 total
# lines = 7m18s (438s) after fixing the whole-number-line click bug (each
# extra market needs its own real tab-click + page-load + parse cycle per
# match — ~110s added per line, not a bug, genuinely how much UI interaction
# costs). Tennis, single market, but match COUNT varies a lot night to
# night since it isn't scoped to one tournament: 44 matches = 8m5s (485s);
# a genuinely busier night, 107 matches, = 20m47s (1247s) - confirmed live
# by removing the timeout entirely and letting it run to real completion,
# not guessed. 1247s alone already exceeded the scheduled task's OLD
# 15-minute -ExecutionTimeLimit (900s) - Windows would have force-killed a
# busy tennis night mid-scrape even with an unlimited Python-side timeout,
# so both this constant AND harvester-laptop-setup.ps1's own
# -ExecutionTimeLimit were widened together again, this time with real
# margin above the worst case actually observed (1247s) rather than the
# closest-so-far number. Re-measure before adding a 3rd total line, another
# market, or trusting this margin forever - tennis's own match count isn't
# bounded by anything in this codebase, so an even busier night is possible.
SCRAPE_TIMEOUT_SECONDS = 1800


async def _run_harvester_cli(target: ScrapeTarget) -> list[dict]:
    """Calls the vendored oddsharvester package's own scraper function
    IN-PROCESS — not a subprocess at all, deliberately.

    Real bug found and fixed this session, the actual root cause behind
    every earlier "hangs indefinitely" symptom (which earlier fixes this
    session — moving off asyncio.create_subprocess_exec, redirecting stdout
    to a file instead of a pipe — never actually resolved, despite each
    looking plausible at the time): launching the CLI as `python -m
    oddsharvester ...` from THIS already-running script adds an EXTRA
    process generation to the tree (this script -> CLI subprocess ->
    Chromium, a great-grandchild), on top of what the CLI already does
    itself (process -> Chromium, a grandchild) when run directly. Proven by
    a controlled A/B comparison run back-to-back on the same loaded
    machine: the bare CLI (shell -> python -> Chromium) reliably completed
    in ~210s both times; this script's subprocess-of-a-subprocess wrapper
    (shell -> python -> python -> Chromium) never completed even once,
    timing out at 180s, then 300s, then 450s, regardless of which
    subprocess-launching mechanism was used to create that middle process.
    The fix removes the extra generation entirely: oddsharvester's CLI
    command (cli/commands/upcoming.py) is a thin wrapper over
    oddsharvester.core.scraper_app.run_scraper — calling that directly
    means Chromium is this script's own grandchild again, matching the
    process-tree shape that was always proven to work.

    One real, disclosed side effect of calling the library function instead
    of the CLI: oddsharvester's own logging setup (invoked by its CLI entry
    point, not by run_scraper itself) is bypassed, so its internal INFO logs
    won't appear in this script's own output. Not a concern for Phase 1
    (the health-check row and this function's own return value are what
    matter operationally) but worth knowing if a future debugging session
    goes looking for that log stream and doesn't find it.

    Uses `upcoming` mode, NOT `live` mode — a separate, earlier bug from this
    session's first end-to-end run: `live` mode only returns matches
    CURRENTLY in play, which for MLB is empty something like 20 of 24 hours
    a day (games mostly run evening ET). A grid meant to show "today's
    current odds" needs pre-match coverage, which is what `upcoming`
    actually returns.

    Scoped by `kickoff_within_hours`, NOT `-d <today>` — a second real bug
    found live testing Soccer/EPL: `-d <today>` only returns matches on
    TODAY's exact calendar date, so any sport with a real gap between game
    days (EPL doesn't play daily — verified live: 0 matches today, 20 real
    upcoming matches sitting 3+ days out) reads as "0 records" on every
    off-day, which this function's own healthy-check would then wrongly
    flag as a possible anti-bot block. kickoff_within_hours scopes to
    "matches happening soon" regardless of which exact calendar date that
    falls on — correct for MLB's daily cadence too, not just a soccer-only
    fix. First tried 72h; verified live it still only caught 1 of a real
    20-match EPL slate (weekly-cadence leagues can sit right at that
    boundary depending which day of the week the scrape happens to run).
    168h (a full week) reliably catches an entire upcoming matchday
    regardless of scrape day, for any sport on a weekly or sub-weekly
    cadence — this only changes which of the ALREADY-listed upcoming
    matches get visited for full odds detail, not how many pages get
    fetched to build that list, so it doesn't meaningfully change scrape
    cost the way adding more requested markets does.

    Concurrency fixed at 1 (oddsharvester's own default is 3) — a real run
    this session crashed mid-scrape ("Page crashed"/"Target crashed") at
    the default, trading some wall-clock time for stability.

    When target.leagues is None (tennis — no umbrella league key exists),
    falls back to date=<today> instead of kickoff_within_hours: the CLI's
    own validation requires date, leagues, OR match-links, and the
    no-league listing page (`/matches/tennis/<date>/`) is scoped by date in
    the URL itself, not by a client-side kickoff_within_hours post-filter
    the way the league-page path is — confirmed live before relying on it,
    not assumed from the league-page behavior.
    """
    kwargs: dict = dict(
        command=CommandEnum.UPCOMING_MATCHES,
        sport=target.harvester_sport,
        markets=target.markets,
        headless=True,
        concurrency_tasks=1,
    )
    if target.leagues is not None:
        kwargs["leagues"] = target.leagues
        kwargs["kickoff_within_hours"] = 168.0
    else:
        kwargs["date"] = datetime.now(timezone.utc).strftime("%Y%m%d")

    try:
        result = await asyncio.wait_for(run_scraper(**kwargs), timeout=SCRAPE_TIMEOUT_SECONDS)
    except asyncio.TimeoutError:
        raise RuntimeError(f"oddsharvester scrape for {target.sport} exceeded {SCRAPE_TIMEOUT_SECONDS}s")

    if result is None:
        raise RuntimeError(f"oddsharvester scrape for {target.sport}: run_scraper returned None (fatal init error)")

    # README documents an all-matches-failed outcome as a genuinely normal
    # "zero live matches" case for `live` mode; for `upcoming` scoped to a
    # date our own snapshot already confirmed has real scheduled games,
    # zero successes with real failures recorded is a real signal worth
    # surfacing, not a shrug — same "log loudly" discipline as the totals-
    # merge conflict warning above.
    if not result.success and result.failed:
        raise RuntimeError(
            f"oddsharvester scrape for {target.sport}: all {len(result.failed)} match(es) failed "
            f"(first: {result.failed[0].error_message})"
        )

    return result.success


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------


async def run_target(target: ScrapeTarget) -> dict:
    games = await target.load_games()
    if not games:
        return {"sport": target.sport, "ok": False, "reason": "no games loaded from snapshot"}

    try:
        records = await run_dynamic_lines_target(target, games) if target.dynamic_lines else await _run_harvester_cli(target)
    except Exception as e:
        await _write_health(target.sport, healthy=False, status=f"scrape failed: {type(e).__name__}: {e}", matched=0, records=0)
        raise

    matched_lines: list[GameLine] = []
    # game_id -> that game's OWN real sport, not target.sport uniformly —
    # needed for tennis, where one scrape covers both tours at once (no
    # per-tour league key exists to scrape them separately) and target.sport
    # is a label for the whole target, not any single match's real tour.
    # Every other sport's games are already all the same sport as target.sport,
    # so this is a no-op for them, not tennis-specific plumbing bolted on.
    game_id_to_sport: dict[str, str] = {}
    unmatched = 0
    doubles_skipped = 0
    for record in records:
        home_raw, away_raw = record.get("home_team") or "", record.get("away_team") or ""
        # Tennis only: OddsPortal's date-scoped board (leagues=None) mixes in
        # doubles alongside singles, rendered as "Surname1 I./Surname2 C. M."
        # per side. load_tennis_games only ever builds singles Games (each
        # competition's competitors[] is a two-player list, one per side) —
        # there is no 4-player Game shape anywhere in this codebase for
        # doubles to match against, so these can never match and shouldn't be
        # counted/logged as a real matching failure. Verified live: this is
        # exactly what most of the "unmatched" tennis records turned out to
        # be (see harvester_scrape's tennis config comment).
        if target.sport == "tennis" and ("/" in home_raw or "/" in away_raw):
            doubles_skipped += 1
            continue
        game = _match_game(games, home_raw, away_raw)
        if game is None:
            unmatched += 1
            # Diagnostic only, not silent — team-name conventions vary more
            # across sports than MLB's simple "City Nickname" ever exposed
            # (soccer clubs especially: abbreviations, "FC"/"AFC" suffixes,
            # etc.), so a real mismatch needs to be SEEN to fix, not guessed.
            print(f"[harvester_scrape] unmatched: '{away_raw}' @ '{home_raw}' not found in our own {len(games)}-game list", flush=True)
            continue
        matched_lines.append(_record_to_game_line(record, game.game_id))
        game_id_to_sport[game.game_id] = game.sport

    # Anti-bot detection: OddsHarvester's own docs (gotchas §6) confirm a
    # blocked scrape returns 0 rows with NO exception — a "successful" run
    # that silently produced nothing looks identical to a genuinely quiet
    # night otherwise. Distinguishing them: games were on the slate (checked
    # above) but the scrape returned nothing at all.
    healthy = len(records) > 0 or len(games) == 0
    status = (
        f"{len(matched_lines)}/{len(records)} matched, {unmatched} unmatched"
        + (f", {doubles_skipped} doubles skipped" if doubles_skipped else "")
        if records
        else f"0 records returned for {len(games)} scheduled game(s) — possible anti-bot block"
    )
    await _write_health(target.sport, healthy=healthy, status=status, matched=len(matched_lines), records=len(records))

    if matched_lines:
        book_rows = _game_odds_book_line_rows_for_source(matched_lines, target.sport, "oddsharvester")
        for r in book_rows:
            r.sport = game_id_to_sport.get(r.game_id, r.sport)
        await db.write_game_odds_book_lines(book_rows)
        await db.write_game_odds_history(_game_odds_history_rows_tagged(matched_lines, "oddsharvester"))

    return {
        "sport": target.sport,
        "ok": True,
        "records": len(records),
        "matched": len(matched_lines),
        "unmatched": unmatched,
        "doubles_skipped": doubles_skipped,
    }


def _game_odds_book_line_rows_for_source(lines: list[GameLine], sport: str, source: str) -> list[db.GameOddsBookLineInput]:
    """Same row-building the-odds-api's own port already does
    (_game_odds_book_line_rows in odds_lines_cycle.py) is MLB-hardcoded and
    tagged 'the-odds-api' — this reuses its per-book field extraction logic
    by delegating to it, then relabels sport/source, rather than duplicating
    the moneyline/spread/total field-reading branches a second time."""
    rows = _game_odds_book_line_rows(lines)
    for r in rows:
        r.sport = sport
        r.source = source
    return rows


def _game_odds_history_rows_tagged(lines: list[GameLine], source: str) -> list[db.GameOddsHistoryInput]:
    rows = _game_odds_history_rows(lines)
    for r in rows:
        r.source = source
    return rows


async def _write_health(sport: str, *, healthy: bool, status: str, matched: int, records: int) -> None:
    await db.write_health_check_results(
        [
            {
                "name": f"{HEALTH_CHECK_NAME}_{sport}",
                "healthy": healthy,
                "status": status,
                "raw": {"records": records, "matched": matched, "checked_at": datetime.now(timezone.utc).isoformat()},
            }
        ]
    )


async def main(sports: list[str] | None = None) -> int:
    targets = [SCRAPE_CONFIG[s] for s in (sports or SCRAPE_CONFIG.keys()) if s in SCRAPE_CONFIG]
    if not targets:
        print(f"[harvester_scrape] no matching sports in {sports!r} (known: {list(SCRAPE_CONFIG)})", flush=True)
        return 1

    ok = True
    for target in targets:
        try:
            result = await run_target(target)
            print(f"[harvester_scrape] {result}", flush=True)
            ok = ok and result.get("ok", False)
        except Exception as e:
            print(f"[harvester_scrape] {target.sport} failed: {type(e).__name__}: {e}", flush=True)
            ok = False
    return 0 if ok else 1


if __name__ == "__main__":
    exit_code = asyncio.run(main(sys.argv[1:] or None))
    raise SystemExit(exit_code)
