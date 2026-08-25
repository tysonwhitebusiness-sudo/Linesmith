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
import functools
import re
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone

import db
from game_context import Game, load_mlb_games, load_sport_games
from oddsharvester.core.scraper_app import run_scraper
from oddsharvester.utils.command_enum import CommandEnum
from predict.mlb_game_lines import BookmakerOdds, GameLine
from predict.odds_lines_cycle import _game_odds_book_line_rows, _game_odds_history_rows

HEALTH_CHECK_NAME = "oddsharvester_scrape"

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
    sport: str  # our own sport key, e.g. 'mlb' — matches Game.sport / game_id join
    harvester_sport: str  # OddsHarvester's sport key, e.g. 'baseball'
    leagues: list[str]  # OddsHarvester league keys, e.g. ['mlb']
    markets: list[str]  # OddsHarvester market tokens for this sport
    load_games: callable  # async () -> list[Game]


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
    # dropped. Starting moneyline-only, matching the same "prove minimal,
    # then measure the real cost of adding more" approach that worked for
    # MLB, rather than assuming totals/btts fit the same budget.
    "soccer_epl": ScrapeTarget(
        sport="soccer_epl",
        harvester_sport="football",
        leagues=["england-premier-league"],
        markets=["1x2"],
        load_games=functools.partial(load_sport_games, "soccer_epl"),
    ),
    "soccer_mls": ScrapeTarget(
        sport="soccer_mls",
        harvester_sport="football",
        leagues=["usa-mls"],
        markets=["1x2"],
        load_games=functools.partial(load_sport_games, "soccer_mls"),
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


# Word-boundary-guarded aliases (never a blind substring replace — "la"
# would otherwise corrupt "Dallas"/"Atlanta"/etc.), verified against real
# mismatches this session, not guessed: "utd" (EPL: "Manchester Utd" vs our
# own "Manchester United"), "lafc" and standalone "la" (MLS: ESPN's own
# acronyms "LAFC"/"LA Galaxy" vs OddsPortal's spelled-out "Los Angeles
# FC"/"Los Angeles Galaxy" — LAFC has no separate nickname, "Los Angeles FC"
# IS its full name, not a different club).
_NAME_ALIASES: list[tuple[str, str]] = [
    (r"\butd\b", "united"),
    (r"\blafc\b", "los angeles fc"),
    (r"\bla\b", "los angeles"),
]

# Below this many characters, substring containment risks a coincidental
# false match rather than a real shortened-name relationship — real bug
# caught before shipping: naive containment on "la" (2 chars) happened to
# match "LA Galaxy" against "Los Angeles Galaxy" here, but only because "la"
# coincidentally appears inside "gaLAxy" itself; the same check would just
# as readily mismatch "la" against "Atlanta" or "Dallas" in a league that
# had one. The alias table above is the real fix for known short forms;
# this guard is what makes the FALLBACK safe for names it doesn't cover.
_MIN_CONTAINMENT_LEN = 4


def _norm(name: str) -> str:
    name = name.lower()
    for pattern, replacement in _NAME_ALIASES:
        name = re.sub(pattern, replacement, name)
    return re.sub(r"[^a-z]", "", name)


def _norm_words(name: str) -> frozenset[str]:
    """Word-set form for the reordering fallback below — "Red Bull New
    York" vs "New York Red Bulls" (MLS, verified live) share every
    significant word, just not the same order, which no amount of prefix/
    substring matching on the joined string can bridge."""
    name = name.lower()
    for pattern, replacement in _NAME_ALIASES:
        name = re.sub(pattern, replacement, name)
    words = re.findall(r"[a-z]+", name)
    return frozenset(w.rstrip("s") for w in words if len(w) >= 3)  # rstrip("s"): Bull vs Bulls


def _match_game(games: list[Game], home_team: str, away_team: str) -> Game | None:
    """Three tiers, exact first: OddsPortal routinely shortens club names
    in ways plain equality can't survive. Real mismatches found live and
    fixed here, not guessed in advance — MLB's simple "City Nickname" names
    never exposed any of this:
      - substring containment (EPL: "Nottingham" for "Nottingham Forest",
        "Hull" for "Hull City", "Newcastle" for "Newcastle United", etc.)
      - word-set equality, order-independent (MLS: "Red Bull New York" vs
        "New York Red Bulls")
    Both fallbacks apply to home and away independently — a team on one
    side matching via containment doesn't require the other side to match
    the same way.
    """
    home_n, away_n = _norm(home_team), _norm(away_team)
    for g in games:
        game_home_n, game_away_n = _norm(g.home_team_name), _norm(g.away_team_name)
        if game_home_n == home_n and game_away_n == away_n:
            return g

    def side_matches(a: str, b: str) -> bool:
        if len(a) < _MIN_CONTAINMENT_LEN or len(b) < _MIN_CONTAINMENT_LEN:
            return a == b
        return a in b or b in a

    for g in games:
        game_home_n, game_away_n = _norm(g.home_team_name), _norm(g.away_team_name)
        if side_matches(home_n, game_home_n) and side_matches(away_n, game_away_n):
            return g

    home_w, away_w = _norm_words(home_team), _norm_words(away_team)
    for g in games:
        if _norm_words(g.home_team_name) == home_w and _norm_words(g.away_team_name) == away_w:
            return g

    return None


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


def _market_point(market_token: str) -> float | None:
    m = _OU_POINT_RE.match(market_token)
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

    for key, rows in record.items():
        if not key.endswith("_market") or not isinstance(rows, list):
            continue
        market_token = key[: -len("_market")]
        point = _market_point(market_token)

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
            # Handicap/spread markets aren't in the MLB pilot's SCRAPE_CONFIG
            # (baseball has no such market on OddsPortal) — a future sport
            # that needs them extends this branch once that sport's real
            # handicap row shape is confirmed against a live fixture, not
            # guessed.

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
# CLI invocation
# ---------------------------------------------------------------------------

# Real measured costs this session, 15 MLB matches, concurrency 1, no other
# load: home_away alone = 3m30s (210s); home_away + 2 total lines = 7m18s
# (438s) after fixing the whole-number-line click bug (each extra market
# needs its own real tab-click + page-load + parse cycle per match — ~110s
# added per line, not a bug, genuinely how much UI interaction costs). 550s
# leaves real margin above the observed 438s while staying under the
# scheduled task's own 10-minute execution limit (scripts/harvester-laptop-
# setup.ps1's -ExecutionTimeLimit) — re-measure before adding a 3rd total
# line or another sport's markets to this same run, don't assume it scales
# linearly forever.
SCRAPE_TIMEOUT_SECONDS = 550


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
    """
    try:
        result = await asyncio.wait_for(
            run_scraper(
                command=CommandEnum.UPCOMING_MATCHES,
                sport=target.harvester_sport,
                leagues=target.leagues,
                markets=target.markets,
                headless=True,
                concurrency_tasks=1,
                kickoff_within_hours=168.0,
            ),
            timeout=SCRAPE_TIMEOUT_SECONDS,
        )
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
        records = await _run_harvester_cli(target)
    except Exception as e:
        await _write_health(target.sport, healthy=False, status=f"scrape failed: {type(e).__name__}: {e}", matched=0, records=0)
        raise

    matched_lines: list[GameLine] = []
    unmatched = 0
    for record in records:
        home_raw, away_raw = record.get("home_team") or "", record.get("away_team") or ""
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

    # Anti-bot detection: OddsHarvester's own docs (gotchas §6) confirm a
    # blocked scrape returns 0 rows with NO exception — a "successful" run
    # that silently produced nothing looks identical to a genuinely quiet
    # night otherwise. Distinguishing them: games were on the slate (checked
    # above) but the scrape returned nothing at all.
    healthy = len(records) > 0 or len(games) == 0
    status = (
        f"{len(matched_lines)}/{len(records)} matched, {unmatched} unmatched"
        if records
        else f"0 records returned for {len(games)} scheduled game(s) — possible anti-bot block"
    )
    await _write_health(target.sport, healthy=healthy, status=status, matched=len(matched_lines), records=len(records))

    if matched_lines:
        await db.write_game_odds_book_lines(_game_odds_book_line_rows_for_source(matched_lines, target.sport, "oddsharvester"))
        await db.write_game_odds_history(_game_odds_history_rows_tagged(matched_lines, "oddsharvester"))

    return {"sport": target.sport, "ok": True, "records": len(records), "matched": len(matched_lines), "unmatched": unmatched}


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
