"""DJ-TEN — tennis serve and return numbers into `tennis_match_stats`.

SOURCE: TML-Database (github.com/Tennismylife/TML-Database), one CSV per year,
"offered in partnership with CanalTenis" and "based on Jeff Sackmann's work",
under Creative Commons BY-NC-SA. Licence checked by the operator 2026-09-22
before this was written (run doc A4).

============================ WHAT MEASURING CHANGED ============================

1. **JEFF SACKMANN'S REPOS ARE GONE.** `JeffSackmann/tennis_atp` and
   `tennis_wta` — the canonical open tennis datasets for a decade, and what the
   gameplan names — both 404, and his account now holds only
   `tennis_MatchChartingProject`. TML-Database exists because it continues that
   ATP work, which is why the plan's fallback source is the only source.

2. **SO WTA HAS NO SERVE DATA.** TML is ATP: the Tennismylife org has
   ATP-Rankings, ATP-Tennis-Record and this, and no WTA equivalent. Nothing
   here is ATP-specific — `TOURS` takes a WTA source the day one exists, and
   the rest of the file does not care. Until then WTA holds no serve line, and
   that is recorded rather than faked.

3. **SURFACE WAS ALREADY HELD, for both tours.** The gameplan's correction 6
   says surface is nowhere; `import_tennis.py` loaded tennis-data.co.uk's
   `Surface`/`Court` into `game_result` on 2026-09-02, after that was written
   (ATP 29,119 rows, WTA 27,267, back to 2015). A Surface record reads from
   there and needs nothing from here — for BOTH tours. Surface is copied onto
   these rows anyway because the source gives it free and a serve line split by
   surface is the point of holding both.

================================ IDENTITY ======================================

TML publishes full names ("Felix Auger-Aliassime") and this app keys tennis on
ESPN athlete ids, so the two are matched on ESPN'S OWN full names.

THE OBVIOUS BRIDGE WAS THE WRONG ONE, and building it first is how that was
found. `athlete_crosswalk` (task 6.32) already maps tennis-data.co.uk's
abbreviated spelling ("Munar J.") onto ESPN ids, so the first version folded
TML's full name into that shape and looked up the crosswalk. Measured: 279 of
598 recent ATP players resolved — 47%. The crosswalk holds 401 of the 715 ATP
players this app has history for, and Auger-Aliassime, Davidovich Fokina and
Mpetshi Perricard are simply not in it. The abbreviation was never the
problem; the intermediate table was.

Matching ESPN's full name directly removes that hop. Both sides are
"given-name surname", so both are keyed the same way: first initial plus the
surname, where a particle ("de", "van", "del") belongs to the surname and an
extra given name does not. That is `key_from_espn` in
`build_tennis_crosswalk.py`, and this is deliberately the same rule.

A NAME THAT DOES NOT RESOLVE IS SKIPPED, and so is an AMBIGUOUS one — two
athletes sharing a key are both dropped rather than one being picked. A serve
line filed under the wrong player is worse than one that is missing. The run
reports both counts.

    cd python-odds-service
    ./.venv/Scripts/python.exe -u src/tennis_stats.py ingest 2024 2026
    ./.venv/Scripts/python.exe -u src/tennis_stats.py status
"""
from __future__ import annotations

import asyncio
import csv
import io
import json
import sys
import unicodedata
from datetime import date, datetime

import httpx

import db

# One entry per tour. A tour with no source holds no serve line — see the
# module docstring on why WTA is absent rather than approximated.
TOURS: dict[str, str] = {
    "tennis_atp": "https://raw.githubusercontent.com/Tennismylife/TML-Database/master/{year}.csv",
}

SOURCE = "tml"


def _ascii(s: str) -> str:
    """tennis-data.co.uk writes ASCII; TML writes the real spelling. Compare
    on the fold, so "Munar" matches "Muñar" if either side ever changes."""
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


# A surname particle belongs to the surname. ESPN writes "Alex de Minaur" and
# TML writes "Alex De Minaur"; neither is a middle name. Same list as
# `build_tennis_crosswalk.py`, which solved this first.
PARTICLES = {"de", "del", "della", "di", "da", "dos", "van", "von", "der",
             "den", "ten", "le", "la", "el", "al", "bin", "ibn", "mc", "mac"}


def _clean(tok: str) -> str:
    return "".join(ch for ch in _ascii(tok).lower() if ch.isalpha())


def name_key(full_name: str) -> tuple[str, str] | None:
    """"Felix Auger-Aliassime" -> ("f", "augeraliassime").

    First initial plus the surname. Extra given names are dropped; a particle
    never is, so "Juan Martin del Potro" keys on "delpotro" and not "martin".
    Deliberately `key_from_espn`'s rule — both sides of this match are
    given-name-first, so one rule keys both.
    """
    toks = [t for t in str(full_name).replace("-", " ").split() if t.strip()]
    if len(toks) < 2:
        return None
    initial = _clean(toks[0])[:1]
    rest = toks[1:]
    while len(rest) > 1 and _clean(rest[0]) not in PARTICLES:
        rest = rest[1:]
    surname = "".join(_clean(t) for t in rest)
    return (initial, surname) if initial and surname else None


def _int(v) -> int | None:
    if v is None or v == "":
        return None
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


def _match_date(raw: str) -> date | None:
    """TML's `tourney_date` is YYYYMMDD — the tournament's start, which is the
    best date this source gives. Matches inside a fortnight-long event share
    it; nothing here reads it more precisely than a week."""
    raw = (raw or "").strip()
    if len(raw) != 8 or not raw.isdigit():
        return None
    try:
        return datetime.strptime(raw, "%Y%m%d").date()
    except ValueError:
        return None


# ESPN's own names, cached in `snapshot_cache` so the daily job is one read.
# A tennis athlete's name does not change; a month is generous.
_NAMES_KEY = "tennis:espn-names:{sport}"
_NAMES_TTL_MS = 30 * 24 * 60 * 60 * 1000
_ESPN_LEAGUE = {"tennis_atp": "atp", "tennis_wta": "wta"}


async def espn_names(client: httpx.AsyncClient, sport: str) -> dict[str, str]:
    """{ESPN athlete id -> full name} for every player this app holds history
    for. Cached; only ids the cache is missing are fetched."""
    cache_key = _NAMES_KEY.format(sport=sport)
    cached = await db.read_snapshot_with_age(cache_key)
    names: dict[str, str] = {}
    fresh = False
    if cached is not None:
        payload, age_seconds = cached
        names = json.loads(payload)
        fresh = age_seconds * 1000 < _NAMES_TTL_MS

    ids = await db.tennis_athlete_ids(sport)
    todo = [i for i in ids if i not in names]
    if fresh and not todo:
        return names

    league = _ESPN_LEAGUE.get(sport, "atp")
    for athlete_id in todo:
        url = (f"https://sports.core.api.espn.com/v2/sports/tennis/leagues/{league}"
               f"/athletes/{athlete_id}?lang=en&region=us")
        try:
            res = await client.get(url, timeout=httpx.Timeout(15.0))
            if res.status_code != 200:
                continue
            j = res.json()
        except (httpx.HTTPError, ValueError):
            continue
        full = j.get("fullName") or j.get("displayName")
        if full:
            names[str(athlete_id)] = str(full)

    await db.write_snapshot(cache_key, json.dumps(names))
    return names


def _name_index(names: dict[str, str]) -> dict[tuple[str, str], str]:
    """{name key -> ESPN id}, with every ambiguous key REMOVED.

    Two athletes sharing a first initial and a surname cannot be told apart by
    name, so neither is matched. Dropping both is the only answer that cannot
    be wrong."""
    index: dict[tuple[str, str], str] = {}
    ambiguous: set[tuple[str, str]] = set()
    for athlete_id, full in names.items():
        key = name_key(full)
        if key is None:
            continue
        if key in index and index[key] != athlete_id:
            ambiguous.add(key)
        index[key] = athlete_id
    for key in ambiguous:
        index.pop(key, None)
    return index


def _rows_for_match(sport: str, r: dict, ids: dict[tuple[str, str], str]) -> list[db.TennisMatchStatInput]:
    """Both sides of one match, or fewer if a player cannot be resolved."""
    w_key, l_key = name_key(r.get("winner_name") or ""), name_key(r.get("loser_name") or "")
    w_id = ids.get(w_key) if w_key else None
    l_id = ids.get(l_key) if l_key else None
    md = _match_date(r.get("tourney_date") or "")
    match_num = _int(r.get("match_num"))
    if md is None or match_num is None:
        return []

    common = {
        "sport": sport,
        "tourney_id": str(r.get("tourney_id") or ""),
        "match_num": match_num,
        "match_date": md,
        "season": md.year,
        "tourney_name": (r.get("tourney_name") or None),
        "surface": (r.get("surface") or None),
        # TML's `indoor` is 'I'/'O'. Anything else is unknown, not outdoor.
        "indoor": True if (r.get("indoor") or "").strip().upper() == "I" else (False if (r.get("indoor") or "").strip().upper() == "O" else None),
        "tourney_level": (r.get("tourney_level") or None),
        "round": (r.get("round") or None),
        "best_of": _int(r.get("best_of")),
        "minutes": _int(r.get("minutes")),
        "source": SOURCE,
    }
    serve = lambda p: {  # noqa: E731 — a column-name mapping, not logic
        "ace": _int(r.get(f"{p}_ace")),
        "df": _int(r.get(f"{p}_df")),
        "svpt": _int(r.get(f"{p}_svpt")),
        "first_in": _int(r.get(f"{p}_1stIn")),
        "first_won": _int(r.get(f"{p}_1stWon")),
        "second_won": _int(r.get(f"{p}_2ndWon")),
        "sv_gms": _int(r.get(f"{p}_SvGms")),
        "bp_saved": _int(r.get(f"{p}_bpSaved")),
        "bp_faced": _int(r.get(f"{p}_bpFaced")),
    }
    w, l = serve("w"), serve("l")

    out: list[db.TennisMatchStatInput] = []
    if w_id:
        out.append(db.TennisMatchStatInput(athlete_id=w_id, opponent_id=l_id, won=True, **common, **w,
                                           **{f"opp_{k}": v for k, v in l.items()}))
    if l_id:
        out.append(db.TennisMatchStatInput(athlete_id=l_id, opponent_id=w_id, won=False, **common, **l,
                                           **{f"opp_{k}": v for k, v in w.items()}))
    return out


async def ingest_year(client: httpx.AsyncClient, sport: str, year: int, ids: dict[str, str]) -> dict:
    url = TOURS[sport].format(year=year)
    try:
        res = await client.get(url, timeout=httpx.Timeout(60.0))
    except httpx.HTTPError as err:
        return {"year": year, "error": f"{type(err).__name__}: {err}"}
    if res.status_code != 200:
        return {"year": year, "error": f"HTTP {res.status_code}"}

    reader = csv.DictReader(io.StringIO(res.text))
    rows: list[db.TennisMatchStatInput] = []
    matches = 0
    unresolved: set[str] = set()
    for r in reader:
        matches += 1
        made = _rows_for_match(sport, r, ids)
        if len(made) < 2:
            for raw in (r.get("winner_name"), r.get("loser_name")):
                key = name_key(raw or "")
                if key is None or key not in ids:
                    unresolved.add(raw or "")
        rows.extend(made)

    written = await db.write_tennis_match_stats(rows)
    return {
        "year": year,
        "matches": matches,
        "rows": len(rows),
        "written": written,
        "unresolved_players": len(unresolved),
        "unresolved_sample": sorted(unresolved)[:5],
    }


async def ingest(client: httpx.AsyncClient, first_year: int, last_year: int, yield_fn=None) -> dict:
    out: dict = {"tours": {}}
    for sport in TOURS:
        names = await espn_names(client, sport)
        ids = _name_index(names)
        years = []
        for year in range(first_year, last_year + 1):
            if yield_fn is not None:
                await yield_fn()
            years.append(await ingest_year(client, sport, year, ids))
        held, players = await db.tennis_stats_coverage(sport)
        out["tours"][sport] = {"espn_names": len(names), "matchable": len(ids), "years": years,
                               "rows_held": held, "players_held": players}
    # Named so a reader of the job log is not left wondering where WTA went.
    out["no_source"] = [s for s in ("tennis_atp", "tennis_wta") if s not in TOURS]
    return out


async def _cli() -> None:
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    if cmd == "ingest":
        first = int(sys.argv[2]) if len(sys.argv) > 2 else date.today().year
        last = int(sys.argv[3]) if len(sys.argv) > 3 else first
        async with httpx.AsyncClient() as client:
            print(json.dumps(await ingest(client, first, last), indent=1, default=str))
    else:
        for sport in ("tennis_atp", "tennis_wta"):
            held, players = await db.tennis_stats_coverage(sport)
            print(json.dumps({"sport": sport, "rows": held, "players": players, "has_source": sport in TOURS}))


if __name__ == "__main__":
    asyncio.run(_cli())
