"""
Task 6.32 — map tennis-data's abbreviated player names onto ESPN athlete ids.

Writes into the same `athlete_crosswalk` table as `build_athlete_crosswalk.py`,
so gate 7's one-to-one and verified-date checks cover it with no change.

============ THIS IS ONE HOP, NOT TWO. THE OLD NOTE WAS WRONG. ============

`CURRENT.md` recorded that `player_game_history`'s tennis rows carried "4-digit
ids from a different provider" with "no name column anywhere to bridge them",
and scoped this as a two-hop problem through the `YYYY-atp-season.csv` files.

Verified 2026-09-01: **they are ESPN athlete ids.** Id 2375 resolves to
Alexander Zverev on
`sports.core.api.espn.com/v2/sports/tennis/leagues/atp/athletes/2375`, and
`game_context.py:422` settles it by construction — tennis subjects are minted
as `espn:tennis:{athleteId}`. Being 4 digits made them look foreign; they were
not.

So this is the same shape as 6.28's MLB/NHL crosswalk: fetch ESPN's name for
each id we already store, and match it to the source's spelling.

============ WHAT MAKES TENNIS HARDER THAN MLB OR NHL ============

MLB and NHL matched on a full name AND a birth date, and a birth date is what
turns a name agreement into an identification. Neither is available here:

  - tennis-data publishes `"Zverev A."` — surname plus a first initial. There
    is no full first name to compare.
  - It publishes no date of birth at all, so the corroborating field that made
    the MLB match trustworthy simply does not exist on this side.

An initial is far weaker evidence than a first name: two players sharing a
surname and an initial are a real possibility, not a curiosity. So the
GAME-DATE CHECK IS NOT A FORMALITY HERE, IT IS THE ONLY REAL EVIDENCE, and a
candidate that does not survive it is discarded rather than kept with a caveat.

Fortunately the evidence available is strong: `player_game_history` covers
2016-01-03 → 2026-08-29 for both tours against tennis-data's 2015 → 2026, so
ten of eleven years overlap and most players have dozens of checkable matches.

============ HOW THE NAMES ARE COMPARED ============

Both sides reduce to `(first initial, surname with separators removed)`:

    "Carreno-Busta P."      -> ("p", "carrenobusta")
    "Pablo Carreno Busta"   -> ("p", "carrenobusta")
    "De Minaur A."          -> ("a", "deminaur")
    "Alex de Minaur"        -> ("a", "deminaur")

Accents are stripped, since the two sources disagree about them constantly.
Where that key is ambiguous on either side the pair is refused outright — the
same rule as the MLB/NHL builder, and it matters more here because the key
carries less information.

============ VERIFICATION ============

Identical in shape to gate 7.5: score the real mapping and a deliberately
shuffled one through the same join, and compare. A candidate is kept only if
the ESPN athlete it points at has a `player_game_history` row on a date
tennis-data says that player actually played.

The day offset is DERIVED, not assumed — ESPN and tennis-data disagree about
which calendar day a match belongs to often enough to matter, the same way NHL
needed −1.

Usage (from python-odds-service/):
    ./.venv/Scripts/python.exe -u build_tennis_crosswalk.py [--report]
"""

import argparse
import asyncio
import json
import sys
import unicodedata
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from pathlib import Path

import httpx

sys.path.insert(0, "src")
sys.path.insert(0, ".")
import db  # noqa: E402
from build_athlete_crosswalk import UPSERT, as_date  # noqa: E402

CACHE = Path(__file__).parent / ".crosswalk_cache"
TOURS = {"tennis_atp": "atp", "tennis_wta": "wta"}
MIN_GAMES = 3          # below this an id is a qualifier we will never see
OFFSETS = (-2, -1, 0, 1, 2)

# A surname particle is part of the surname, not a given name. tennis-data
# capitalises them ("De Minaur A.") and ESPN usually does not ("Alex de
# Minaur"), so casing cannot be used to tell them apart.
PARTICLES = {"de", "del", "della", "di", "da", "dos", "van", "von", "der",
             "den", "ten", "le", "la", "el", "al", "bin", "ibn", "mc", "mac"}


def strip_accents(s):
    return "".join(c for c in unicodedata.normalize("NFD", str(s))
                   if unicodedata.category(c) != "Mn")


def _clean(tok):
    return "".join(ch for ch in strip_accents(tok).lower() if ch.isalpha())


def key_from_source(name):
    """tennis-data: surname tokens then a first initial. `"Carreno-Busta P."`
    and `"Del Potro J.M."` both end in the initial block."""
    toks = [t for t in str(name).replace("-", " ").replace(".", ". ").split() if t.strip()]
    if len(toks) < 2:
        return None
    initial = _clean(toks[-1])[:1]
    surname = "".join(_clean(t) for t in toks[:-1])
    return (initial, surname) if initial and surname else None


def key_from_espn(full):
    """ESPN: given name first, then the surname — including any particles,
    which belong to the surname and must not be mistaken for a middle name."""
    toks = [t for t in str(full).replace("-", " ").split() if t.strip()]
    if len(toks) < 2:
        return None
    initial = _clean(toks[0])[:1]
    rest = toks[1:]
    # Drop extra given names, but never a particle: "Juan Martin del Potro"
    # keeps "del potro", while "Juan Martin" is not part of the surname.
    while len(rest) > 1 and _clean(rest[0]) not in PARTICLES:
        rest = rest[1:]
    surname = "".join(_clean(t) for t in rest)
    return (initial, surname) if initial and surname else None


def fetch_espn_names(sport, ids):
    league = TOURS[sport]
    path = CACHE / f"espn_{sport}_names.json"
    out = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    todo = [i for i in ids if str(i) not in out]
    if todo:
        print(f"  fetching {len(todo)} ESPN names ({len(out)} cached)", flush=True)

        def one(c, aid):
            url = (f"https://sports.core.api.espn.com/v2/sports/tennis/"
                   f"leagues/{league}/athletes/{aid}")
            try:
                r = c.get(url)
                if r.status_code != 200:
                    return str(aid), None
                j = r.json()
                return str(aid), (j.get("fullName") or j.get("displayName"))
            except Exception:
                return str(aid), None

        with httpx.Client(timeout=30, follow_redirects=True) as c, \
                ThreadPoolExecutor(max_workers=8) as pool:
            for i, (aid, nm) in enumerate(pool.map(lambda a: one(c, a), todo)):
                out[aid] = nm
                if (i + 1) % 500 == 0:
                    print(f"    {i+1}/{len(todo)}", flush=True)
        path.write_text(json.dumps(out), encoding="utf-8")
    return {k: v for k, v in out.items() if v}


def match(espn_names, source_names):
    """(initial, surname) both ways. Ambiguity on EITHER side is refused —
    with no birth date to break a tie, a guess here is exactly the failure this
    project has already paid for twice."""
    by_key = defaultdict(list)
    for aid, full in espn_names.items():
        k = key_from_espn(full)
        if k:
            by_key[k].append(aid)
    src_key_counts = Counter(k for k in (key_from_source(n) for n in source_names) if k)

    mapping, stats = {}, Counter()
    for name in source_names:
        k = key_from_source(name)
        if not k:
            stats["unparseable"] += 1
            continue
        if src_key_counts[k] > 1:
            stats["ambiguous_source"] += 1
            continue
        hits = by_key.get(k, [])
        if not hits:
            stats["no_espn_match"] += 1
        elif len(hits) > 1:
            stats["ambiguous_espn"] += 1
        else:
            mapping[name] = hits[0]
            stats["matched"] += 1
    return mapping, stats


async def source_games(pool, sport):
    """{tennis-data name: [(date, ...)]} — every match the source says this
    player played, from the rows already loaded into odds_archive."""
    async with pool.acquire() as c:
        rows = await c.fetch("""
            SELECT home_team_raw nm, game_date FROM odds_archive
              WHERE sport=$1 AND source='tennis_data' GROUP BY 1,2
            UNION
            SELECT away_team_raw nm, game_date FROM odds_archive
              WHERE sport=$1 AND source='tennis_data' GROUP BY 1,2
        """, sport)
    out = defaultdict(set)
    for r in rows:
        out[r["nm"]].add(r["game_date"])
    return out


async def played(pool, sport, ids):
    async with pool.acquire() as c:
        rows = await c.fetch(
            "SELECT athlete_id, game_date FROM player_game_history "
            "WHERE sport=$1 AND athlete_id = ANY($2::text[])", sport, list(ids))
    out = defaultdict(set)
    for r in rows:
        out[r["athlete_id"]].add(r["game_date"])
    return out


def score(mapping, want, have, offset):
    out = {}
    for name, aid in mapping.items():
        dates = want.get(name) or set()
        seen = have.get(aid) or set()
        if not dates:
            continue
        hits = [d for d in dates if (d + timedelta(days=offset)) in seen]
        out[name] = (min(hits) if hits else None, len(hits), len(dates))
    return out


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--report", action="store_true")
    args = ap.parse_args()
    pool = await db.get_pool()
    to_write = []

    for sport in TOURS:
        print(f"\n=== {sport}")
        async with pool.acquire() as c:
            ids = [r["athlete_id"] for r in await c.fetch(
                "SELECT athlete_id FROM player_game_history WHERE sport=$1 "
                "GROUP BY 1 HAVING count(*) >= $2", sport, MIN_GAMES)]
        print(f"  {len(ids)} ESPN ids with >= {MIN_GAMES} games")
        espn = fetch_espn_names(sport, ids)
        want = await source_games(pool, sport)
        print(f"  espn names {len(espn)}; tennis-data names {len(want)}")

        mapping, stats = match(espn, list(want))
        print(f"  matched {len(mapping)}  {dict(stats)}")

        # Reverse collision: two source names on one ESPN athlete. Dropped on
        # both sides rather than resolved by preference — same rule as 6.28.
        rev = defaultdict(list)
        for n, a in mapping.items():
            rev[a].append(n)
        for a, names in rev.items():
            if len(names) > 1:
                for n in names:
                    mapping.pop(n, None)
                print(f"  dropped reverse collision on {a}: {names}")

        have = await played(pool, sport, set(mapping.values()))
        by_off = {}
        for off in OFFSETS:
            by_off[off] = sum(v[1] for v in score(mapping, want, have, off).values())
        best = max(by_off, key=by_off.get)
        print(f"  day offset derived: {best} "
              f"({', '.join(f'{k}:{v}' for k, v in sorted(by_off.items()))})")

        ver = score(mapping, want, have, best)
        proven = sum(1 for v in ver.values() if v[0])
        rates = [v[1] / v[2] for v in ver.values() if v[2]]
        print(f"  TRUE MAPPING      {proven}/{len(ver)} proven on a real match date, "
              f"mean agreement {sum(rates)/len(rates):.1%}" if rates else "  no data")

        # THE CONTROL. Same join, every player deliberately mis-mapped.
        keys = sorted(mapping)
        wrong = {k: mapping[keys[(i + 7) % len(keys)]] for i, k in enumerate(keys)}
        cver = score(wrong, want, have, best)
        cproven = sum(1 for v in cver.values() if v[0])
        crates = [v[1] / v[2] for v in cver.values() if v[2]]
        print(f"  SHUFFLED CONTROL  {cproven}/{len(cver)} proven, "
              f"mean agreement {sum(crates)/len(crates):.1%}" if crates else "")

        # An initial plus a surname is weak evidence on its own. Unlike
        # name_and_dob in 6.28, NOTHING here survives without a real game.
        dropped = 0
        for name, aid in mapping.items():
            v = ver.get(name, (None, 0, 0))
            if not v[0]:
                dropped += 1
                continue
            to_write.append((sport, aid, aid, name, None, "name_and_game_date", v[0]))
        print(f"  dropped {dropped} unconfirmed; keeping {len(to_write)} so far")

    if args.report:
        print(f"\n--report: {len(to_write)} rows built, nothing written")
        return

    rows = [(s, e, o, n, as_date(b), m, as_date(v)) for s, e, o, n, b, m, v in to_write]
    async with pool.acquire() as c:
        for i in range(0, len(rows), 500):
            await c.executemany(UPSERT, rows[i:i + 500])
    print(f"\nWROTE {len(rows)} tennis crosswalk rows")
    async with pool.acquire() as c:
        for r in await c.fetch("""
            SELECT sport, match_method, count(*)::int n, count(verified_game_date)::int v
            FROM athlete_crosswalk WHERE sport LIKE 'tennis%' GROUP BY 1,2 ORDER BY 1,2"""):
            print(f"  {r['sport']:<12} {r['match_method']:<20} {r['n']:>5}  verified {r['v']:>5}")


if __name__ == "__main__":
    if sys.platform.startswith("win"):
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(main())
