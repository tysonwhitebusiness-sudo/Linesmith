"""OddsHarvester runner — scrapes OddsPortal.com (via the vendored
`oddsharvester/` CLI, a Playwright browser automation tool) and writes the
result into the same Postgres tables `python-odds-service`'s own the-odds-api
port writes (see predict/odds_lines_cycle.py's `_game_odds_book_line_rows`),
tagged `source='oddsharvester'`.

Deliberately NOT part of the SequentialQueue/JOB_REGISTRY this package's own
main.py runs (see job_queue.py) — a live Chromium process is 300-500MB+ on
its own, well past what that worker's hard 512MB budget has room for, and a
Playwright scrape has no natural cooperative-yield point the way NFL's
rate-limit sleeps do, so it would stall every other job for its full runtime
if it ran there. This module is invoked instead by a GitHub Actions scheduled
workflow (.github/workflows/oddsharvester-scrape.yml) running on GitHub's own
runners — entirely separate compute, same shared Postgres DB, communicating
with the rest of this app the same way every other cross-app boundary here
already does: shared tables, byte-for-byte agreed schema, no HTTP/RPC layer.

Run directly: `python src/harvester_scrape.py [sport ...]` (defaults to every
sport in SCRAPE_CONFIG). Requires DATABASE_URL (same Postgres both apps use)
and the `oddsharvester` package installed with its Playwright browser.
"""
import asyncio
import json
import os
import re
import sys
import tempfile
from dataclasses import dataclass, field
from datetime import datetime, timezone

import db
from game_context import Game, load_mlb_games
from predict.mlb_game_lines import BookmakerOdds, GameLine
from predict.odds_lines_cycle import _game_odds_book_line_rows, _game_odds_history_rows
from predict.statsapi import eastern_date

HEALTH_CHECK_NAME = "oddsharvester_scrape"

# Absolute, not built from a bare relative __file__ — a relative computation
# here would resolve differently depending on which directory the script
# happens to be invoked FROM (repo root vs. python-odds-service/ vs. src/,
# all real invocation shapes across the GitHub Actions workflow and local
# manual runs), not just where the file itself lives on disk.
_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_ODDSHARVESTER_DIR = os.path.join(_REPO_ROOT, "oddsharvester")

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
        # README) — moneyline + a representative band of real MLB run-line
        # totals is the complete real market set for this sport, not a
        # partial list.
        markets=["home_away", "over_under_7_5", "over_under_8_0", "over_under_8_5", "over_under_9_0", "over_under_9_5"],
        load_games=load_mlb_games,
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


def _norm(name: str) -> str:
    return re.sub(r"[^a-z]", "", name.lower())


def _match_game(games: list[Game], home_team: str, away_team: str) -> Game | None:
    home_n, away_n = _norm(home_team), _norm(away_team)
    for g in games:
        if _norm(g.home_team_name) == home_n and _norm(g.away_team_name) == away_n:
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

            if market_token == "home_away":
                home = _parse_decimal_odds(row.get("1"))
                away = _parse_decimal_odds(row.get("2"))
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

SCRAPE_TIMEOUT_SECONDS = 180


async def _run_harvester_cli(target: ScrapeTarget) -> list[dict]:
    """Launches the vendored oddsharvester CLI as a real OS subprocess (a
    genuine child process, not something this script's own event loop
    blocks on inline), one call covering every configured league for this
    sport (the CLI natively takes a comma-separated -l list), full
    per-bookmaker detail (deliberately NOT --preview-only, which returns
    best-price-only with no bookmaker breakdown — the whole point of this
    integration is the per-book grid).

    Uses `upcoming` mode scoped to today's US Eastern date, NOT `live` mode
    — a real, disclosed bug from this session's first end-to-end run: `live`
    mode only returns matches CURRENTLY in play, which for MLB is empty
    something like 20 of 24 hours a day (games mostly run evening ET). A
    grid meant to show "today's current odds" needs pre-match coverage,
    which is what `upcoming` actually returns; `live` mode is the wrong
    entry point for this table's purpose even though it's what the old,
    dead TS integration also happened to use. Same output schema either
    way (verified: both modes route through the same market-extraction
    code) — this only changes which matches get discovered, not how a
    discovered match's odds are parsed.
    """
    with tempfile.TemporaryDirectory() as tmp:
        out_path = os.path.join(tmp, "out.json")
        args = [
            sys.executable,
            "-m",
            "oddsharvester",
            "upcoming",
            "-s",
            target.harvester_sport,
            "-l",
            ",".join(target.leagues),
            "-d",
            eastern_date().replace("-", ""),
            "-m",
            ",".join(target.markets),
            "--headless",
            "-o",
            out_path,
        ]
        proc = await asyncio.create_subprocess_exec(
            *args,
            cwd=_ODDSHARVESTER_DIR,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        try:
            stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=SCRAPE_TIMEOUT_SECONDS)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            raise RuntimeError(f"oddsharvester scrape for {target.sport} exceeded {SCRAPE_TIMEOUT_SECONDS}s")

        if proc.returncode != 0:
            raise RuntimeError(
                f"oddsharvester scrape for {target.sport} exited {proc.returncode}: {stdout.decode(errors='replace')[-2000:]}"
            )

        # README documents this behavior for `live` mode specifically (zero
        # live matches -> exit 0, no file written); kept as a defensive
        # fallback here too in case `upcoming` behaves the same way on a
        # genuinely empty date, but for `upcoming` scoped to a date our own
        # snapshot already confirmed has real scheduled games, this should
        # not normally happen — see run_target's healthy check below, which
        # treats it as a real signal worth flagging, not a shrug.
        if not os.path.exists(out_path):
            return []

        with open(out_path, encoding="utf-8") as f:
            return json.load(f)


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
        game = _match_game(games, record.get("home_team") or "", record.get("away_team") or "")
        if game is None:
            unmatched += 1
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
