"""
Build `athlete_crosswalk` — ESPN athlete id -> the athlete id we actually store.

Task 6.28. The TEAM-id version of this problem is solved in
`import_odds_staging.py`; read its header first, because every trap it
documents reappears here one level down.

============ THE PROBLEM, MEASURED ============

`prop_odds_archive` carries ESPN athlete ids on all 1.8M rows, because every
prop in it was scraped from ESPN. `player_game_history` carries whichever id
system is authoritative for that sport, because `game_context.py` loads each
sport from a different API:

  nba, nfl, cfb, soccer_epl, soccer_mls   ESPN's id IS ours. 86.7-100% resolve.
  mlb                                     MLB StatsAPI ids, 6 digits. 0.0%.
  nhl                                     NHL API ids, 7 digits. 0.0%.

1,244,476 MLB and 68,880 NHL prop rows cannot reach a player until this exists.

============ WHY A NAME MATCH IS NOT THE ANSWER, ONLY THE CANDIDATE ============

Names collide, and a numeric id matching the expected SHAPE is not evidence it
is the right id — 30 of 39 ESPN NHL TEAM ids "matched" `player_game_history`
and every match was wrong. So a name agreement here produces a CANDIDATE, and
the candidate is then made to prove itself against real games.

Two independent checks, in order:

1. BIRTH DATE. ESPN, MLB StatsAPI and the NHL API all publish one. Two players
   sharing a normalized name and a date of birth are the same person; two
   players sharing only a name routinely are not.

2. A REAL GAME, ON A REAL DATE, WITH THE RIGHT TEAM. This is the check with
   teeth, and its power was measured rather than assumed. Every candidate set
   below was scored twice: once as matched, and once deliberately mis-mapped
   onto another real athlete of the same sport. The control is the whole point
   — "30 of 39 NHL team ids matched" was also a high number, and it was wrong.

       mean per-pair agreement      true      shuffled control
         MLB (vs player_game_history)   82.4%        2.0%
         NHL (vs the NHL API game log)  64.6%        2.4%

   The TEAM half is what does the work. On NBA, where the mapping is the
   identity and therefore known correct, the same comparison by date alone:

                             exact date   date AND team
         true mapping            75.9%          75.9%
         shuffled mapping        35.1%           4.0%

   **A date join alone accepts a third of deliberately wrong mappings**, and on
   NHL it is worse — 728 of 806 shuffled pairs found at least one date hit.
   Requiring the team as well takes that to 2%. Overlap is not evidence; the
   fix is to join on something a wrong answer cannot satisfy.

   (The ~20-35% the true mapping misses is not error: a player with a prop
   posted who then did not dress — scratched, rested, DNP — has no game that
   day. This is a floor on agreement, never a demand for 100%.)

   The team comes from `odds_archive`, joined on `event_ref` — 99.9% of prop
   events are present there, and its team ids were already resolved into OUR id
   space by `import_odds_staging.py`. So the check never trusts an ESPN team id
   either.

NHL gets check 2 from a different direction. `player_game_history` has no NHL
row after 2025-04-17 and no NHL prop is earlier than 2025-10-01, so there is
ZERO date overlap to join against — the local test is not merely weak for NHL,
it is impossible. The NHL API's own game log carries the same assertion
instead, sourced live rather than locally.

**And its day offset is DERIVED, not assumed.** ESPN stamps a UTC date; the NHL
API reports the LOCAL one, so an evening puck drop is the next day in ESPN's
column. Measured across the full mapped set, hits by offset:

    -2: 5,303    -1: 11,898    0: 7,882    +1: 7,903    +2: 6,849

-1 by a distance. Asserting 0 would have discarded a correct crosswalk as
unverified; asserting the whole ±2 window would have accepted more than there
is signal to accept.

============ WHAT IT BOUGHT ============

Prop rows that can reach a player, before -> after:

    mlb    0.0% -> 96.2%   (1,197,374 rows)
    nhl    0.0% -> 91.9%   (   63,309 rows)

NHL's 95.1% of rows crosswalk but 91.9% reach a player, and the gap is not a
crosswalk failure: `player_game_history` stops at 2025-04-17, so anyone who
debuted after that has a correct mapping and no history behind it yet.

============ WHAT GETS WRITTEN ============

All seven sports, including the five where the mapping is the identity, so a
consumer joins through one table with no `if sport ==` at the point of use —
the same reasoning the sport-adapter architecture applies in CLAUDE.md. An
identity row is an assertion that no mapping is needed, not a match.

Nothing unproven is written silently: every row carries the `match_method` that
produced it and the `verified_game_date` that confirmed it, and the summary at
the end prints how many of each. A row with no verified date is a hypothesis
and is reported as one.

Usage (from python-odds-service/):
    ./.venv/Scripts/python.exe -u build_athlete_crosswalk.py            # build
    ./.venv/Scripts/python.exe -u build_athlete_crosswalk.py --report   # no write

Idempotent: re-running rebuilds the same rows and upserts them.
"""

import argparse
import asyncio
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from pathlib import Path

import httpx

sys.path.insert(0, "src")
import db  # noqa: E402
from entity_resolution import normalize_name  # noqa: E402

CACHE = Path(__file__).parent / ".crosswalk_cache"
CACHE.mkdir(exist_ok=True)

ESPN_LEAGUE = {"mlb": "baseball/leagues/mlb", "nhl": "hockey/leagues/nhl"}

# Sports whose athlete ids in player_game_history ARE ESPN's. Same list as
# import_odds_staging.ESPN_ID_SPORTS, and true for the same reason: those
# sports are loaded through ESPN in game_context.py.
IDENTITY_SPORTS = ("nba", "nfl", "cfb", "soccer_epl", "soccer_mls")

# ESPN triCode -> NHL API triCode, where they disagree. Same disagreement the
# team crosswalk hit; kept separate because this one is about roster fetching.
NHL_TEAMS = [
    "ANA", "BOS", "BUF", "CGY", "CAR", "CHI", "COL", "CBJ", "DAL", "DET", "EDM",
    "FLA", "LAK", "MIN", "MTL", "NSH", "NJD", "NYI", "NYR", "OTT", "PHI", "PIT",
    "SJS", "SEA", "STL", "TBL", "TOR", "UTA", "VAN", "VGK", "WSH", "WPG",
    "ARI", "PHX", "ATL",  # defunct/relocated; 404 harmlessly on modern seasons
]
NHL_SEASONS = ["20232024", "20242025", "20252026"]
MLB_SEASONS = [2024, 2025, 2026]


def cached(name, build):
    """Every fetch goes through here. The reference rosters and 2,057 ESPN
    athlete lookups are slow and completely static; re-running the match logic
    against them must not mean re-fetching them."""
    path = CACHE / f"{name}.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    data = build()
    path.write_text(json.dumps(data), encoding="utf-8")
    return data


def fetch_espn_athletes(sport, ids):
    league = ESPN_LEAGUE[sport]

    def one(c, aid):
        url = f"https://sports.core.api.espn.com/v2/sports/{league}/athletes/{aid}"
        try:
            r = c.get(url)
            if r.status_code != 200:
                return None
            j = r.json()
            return str(aid), {
                "name": j.get("fullName") or j.get("displayName"),
                # "1992-12-10T08:00Z" -> "1992-12-10". ESPN stamps a
                # local-noon-ish time onto a date that has no time.
                "dob": (j.get("dateOfBirth") or "")[:10] or None,
            }
        except Exception:
            return None

    def build():
        out = {}
        with httpx.Client(timeout=30, follow_redirects=True) as c, \
                ThreadPoolExecutor(max_workers=8) as pool:
            for i, res in enumerate(pool.map(lambda a: one(c, a), ids)):
                if res:
                    out[res[0]] = res[1]
                if (i + 1) % 200 == 0:
                    print(f"    espn {sport}: {i+1}/{len(ids)}", flush=True)
        return out

    return cached(f"espn_{sport}", build)


def fetch_mlb_reference():
    """MLB StatsAPI publishes every player in a season with id, name and birth
    date. Three seasons covers everyone who could carry a 2025-26 prop."""

    def build():
        out = {}
        with httpx.Client(timeout=60) as c:
            for season in MLB_SEASONS:
                r = c.get(f"https://statsapi.mlb.com/api/v1/sports/1/players?season={season}")
                if r.status_code != 200:
                    print(f"    statsapi {season}: {r.status_code}")
                    continue
                for p in r.json().get("people", []):
                    out[str(p["id"])] = {"name": p.get("fullName"), "dob": p.get("birthDate")}
                print(f"    statsapi {season}: {len(out)} cumulative", flush=True)
        return out

    return cached("ref_mlb", build)


def fetch_nhl_reference():
    """Rosters, not a season stat dump, because the roster endpoint is the one
    that carries birthDate — and birth date is what turns a name agreement into
    an identification."""

    def name_of(p):
        first = (p.get("firstName") or {}).get("default", "")
        last = (p.get("lastName") or {}).get("default", "")
        return f"{first} {last}".strip()

    def build():
        out = {}
        with httpx.Client(timeout=60) as c:
            for season in NHL_SEASONS:
                for tri in NHL_TEAMS:
                    try:
                        r = c.get(f"https://api-web.nhle.com/v1/roster/{tri}/{season}")
                        if r.status_code != 200:
                            continue
                        j = r.json()
                    except Exception:
                        continue
                    for group in ("forwards", "defensemen", "goalies"):
                        for p in j.get(group, []):
                            out[str(p["id"])] = {"name": name_of(p), "dob": p.get("birthDate")}
                print(f"    nhl rosters {season}: {len(out)} cumulative", flush=True)

            # THE ROSTER ENDPOINT IS A SNAPSHOT, NOT A SEASON. Measured: CBJ's
            # 2025-26 roster returns 20 players while its club-stats returns
            # 30. Rosters alone left 69 ESPN athletes with no reference row at
            # all -- Jonathan Toews and Zack Bolduc among them -- so club-stats
            # is layered underneath for coverage. It publishes no birth date,
            # so anyone found only here can never reach `name_and_dob` and must
            # earn their row by verifying against a real game instead.
            for season in NHL_SEASONS:
                for tri in NHL_TEAMS:
                    try:
                        r = c.get(f"https://api-web.nhle.com/v1/club-stats/{tri}/{season}/2")
                        if r.status_code != 200:
                            continue
                        j = r.json()
                    except Exception:
                        continue
                    for group in ("skaters", "goalies"):
                        for p in j.get(group, []):
                            pid = str(p["playerId"])
                            if pid not in out:
                                out[pid] = {"name": name_of(p), "dob": None}
                print(f"    nhl club-stats {season}: {len(out)} cumulative", flush=True)
        return out

    return cached("ref_nhl_v2", build)


def match(espn, ref):
    """ESPN athletes -> our ids. Returns (mapping, stats), where a mapping
    value is (our_id, method, espn_name, dob).

    Never guesses. A name that is ambiguous on the reference side produces
    nothing at all — that is exactly where a "close enough" match files one
    player's props under another.

    TWO TIERS, and the difference is what happens if verification fails:

      name_and_dob  Name AND birth date agree across two independent
                    publishers. Independent evidence; kept even if no game in
                    the checkable window happens to confirm it.
      name_unique   The name is unique on both sides, but the birth dates
                    could not both be checked — one side published none, or
                    the two disagree. PROVISIONAL: main() drops it unless a
                    real (date, team) game confirms it.

    The disagreement case is real and is not a reason to refuse outright.
    Kirill Marchenko is 2000-07-21 to the NHL API and 2000-08-21 to ESPN;
    there is one Kirill Marchenko. Requiring the game check makes the weaker
    name evidence carry no weight of its own.
    """
    by_name_dob, by_name = {}, {}
    name_counts = {}
    for rid, r in ref.items():
        n = normalize_name(r.get("name") or "")
        if not n:
            continue
        name_counts[n] = name_counts.get(n, 0) + 1
        by_name.setdefault(n, rid)
        if r.get("dob"):
            by_name_dob[(n, r["dob"])] = rid

    mapping, stats = {}, {"name_and_dob": 0, "name_unique": 0, "unmatched": 0,
                          "ambiguous": 0, "dob_conflict": 0}
    for eid, e in espn.items():
        n = normalize_name(e.get("name") or "")
        if not n:
            stats["unmatched"] += 1
            continue
        dob = e.get("dob")
        hit = by_name_dob.get((n, dob)) if dob else None
        if hit:
            mapping[eid] = (hit, "name_and_dob", e.get("name"), dob)
            stats["name_and_dob"] += 1
            continue
        if name_counts.get(n, 0) > 1:
            stats["ambiguous"] += 1
            continue
        rid = by_name.get(n)
        if not rid:
            stats["unmatched"] += 1
            continue
        rdob = ref[rid].get("dob")
        if dob and rdob and dob != rdob:
            stats["dob_conflict"] += 1
        mapping[eid] = (rid, "name_unique", e.get("name"), rdob or dob)
        stats["name_unique"] += 1
    return mapping, stats


# ---------------------------------------------------------------------------
# Verification. See the header: date alone accepts 35% of wrong mappings.
# ---------------------------------------------------------------------------

VERIFY_SQL = """
WITH ev AS (
  SELECT DISTINCT event_ref, game_date, home_team_id, away_team_id
  FROM odds_archive WHERE sport = $1 AND event_ref IS NOT NULL
), pr AS (
  SELECT DISTINCT p.athlete_id espn_id, e.game_date, e.home_team_id, e.away_team_id
  FROM prop_odds_archive p JOIN ev e ON e.event_ref = p.event_ref
  WHERE p.sport = $1 AND p.athlete_id IS NOT NULL
), m AS (
  SELECT * FROM unnest($2::text[], $3::text[]) AS t(espn_id, ours)
)
SELECT m.espn_id, m.ours, min(h.game_date) verified_date, count(h.id)::int hits,
       count(*)::int chances
FROM pr JOIN m ON m.espn_id = pr.espn_id
LEFT JOIN player_game_history h
  ON h.sport = $1 AND h.athlete_id = m.ours AND h.game_date = pr.game_date
 AND h.team_id IN (pr.home_team_id, pr.away_team_id)
GROUP BY 1, 2
"""


async def verify_local(pool, sport, mapping):
    """MLB path: prove the pair against player_game_history on an exact game
    date AND the right team."""
    espn_ids = list(mapping)
    ours = [mapping[e][0] for e in espn_ids]
    async with pool.acquire() as c:
        rows = await c.fetch(VERIFY_SQL, sport, espn_ids, ours)
    return {r["espn_id"]: (r["verified_date"], r["hits"], r["chances"]) for r in rows}


def fetch_nhl_gamelogs(our_ids):
    """One game log per mapped NHL player: {our_id: {date: {team_id, ...}}}.
    Regular season AND playoffs (gameTypeId 2 and 3) — NHL props run to
    2026-06-15, which is well into a postseason that gameType 2 does not
    contain."""
    from import_odds_staging import NHL_ABBR_TO_ID

    def one(c, pid):
        played = {}
        for season in ("20252026", "20242025"):
            for gt in (2, 3):
                try:
                    r = c.get(f"https://api-web.nhle.com/v1/player/{pid}/game-log/{season}/{gt}")
                    if r.status_code != 200:
                        continue
                    for g in r.json().get("gameLog", []):
                        tid = NHL_ABBR_TO_ID.get((g.get("teamAbbrev") or "").upper())
                        if tid:
                            played.setdefault(g["gameDate"], []).append(str(tid))
                except Exception:
                    continue
        return str(pid), played

    # INCREMENTAL, not all-or-nothing. Widening the reference roster adds new
    # candidate ids on a later run; an all-or-nothing cache would hand those
    # candidates an empty game log and then "prove" every one of them
    # unverifiable. That happened once — 64 real NHL players were dropped as
    # unconfirmed when the only thing missing was their game log.
    path = CACHE / "nhl_gamelogs.json"
    out = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    todo = [p for p in our_ids if str(p) not in out]
    if todo:
        print(f"    nhl game logs: fetching {len(todo)} new "
              f"({len(out)} already cached)", flush=True)
        with httpx.Client(timeout=30) as c, ThreadPoolExecutor(max_workers=8) as pool:
            for i, (pid, played) in enumerate(pool.map(lambda p: one(c, p), todo)):
                out[pid] = played
                if (i + 1) % 200 == 0:
                    print(f"    nhl game logs: {i+1}/{len(todo)}", flush=True)
        path.write_text(json.dumps(out), encoding="utf-8")
    return out


async def nhl_prop_games(pool):
    """{espn_athlete_id: [(game_date, {our home id, our away id}), ...]}"""
    async with pool.acquire() as c:
        rows = await c.fetch("""
            WITH ev AS (SELECT DISTINCT event_ref, game_date, home_team_id, away_team_id
                        FROM odds_archive WHERE sport='nhl' AND event_ref IS NOT NULL)
            SELECT p.athlete_id espn_id, e.game_date, e.home_team_id, e.away_team_id
            FROM (SELECT DISTINCT athlete_id, event_ref FROM prop_odds_archive
                  WHERE sport='nhl' AND athlete_id IS NOT NULL) p
            JOIN ev e ON e.event_ref = p.event_ref
        """)
    want = {}
    for r in rows:
        want.setdefault(r["espn_id"], []).append(
            (r["game_date"], {str(r["home_team_id"]), str(r["away_team_id"])}))
    return want


def score_nhl(mapping, want, logs, offset):
    """{espn_id: (first verified date, hits, chances)} at a fixed day offset."""
    out = {}
    for eid, (ours, *_rest) in mapping.items():
        chances = want.get(eid)
        if not chances:
            continue
        played = logs.get(str(ours)) or {}
        hits, verified = 0, None
        for gd, teams in chances:
            key = (gd + timedelta(days=offset)).isoformat()
            if key in played and teams.intersection(played[key]):
                hits += 1
                verified = verified or gd
        out[eid] = (verified, hits, len(chances))
    return out


async def verify_nhl(pool, mapping):
    """NHL path. `player_game_history` has no NHL row after 2025-04-17 and no
    NHL prop is earlier than 2025-10-01, so there is no local date to join on
    at all — the local test is not weak for NHL, it is impossible. The NHL
    API's own game log carries the same assertion instead: this player played
    on this real date, for one of the two teams in this game.

    THE DAY OFFSET IS DERIVED, NOT ASSUMED, for the same reason gate 4.5
    derives the SBR-vs-ESPN one. ESPN stamps a UTC date; the NHL API reports
    the LOCAL date, so an evening puck drop is the next day in ESPN's column.
    Measured over 20 players and 917 prop games, agreement by offset came out:

        -2: 221   -1: 663   0: 320   +1: 450   +2: 318

    -1 by a distance, and asserting 0 would have thrown away a correct
    crosswalk as unverified. Asserting the whole +-2 window instead would have
    accepted 2,000 of 917 — the window is wider than the signal.
    """
    want = await nhl_prop_games(pool)
    logs = fetch_nhl_gamelogs(sorted({m[0] for m in mapping.values()}))
    by_off = {}
    for off in (-2, -1, 0, 1, 2):
        s = score_nhl(mapping, want, logs, off)
        by_off[off] = sum(v[1] for v in s.values())
    best = max(by_off, key=by_off.get)
    print(f"  nhl day offset derived: {best} "
          f"({', '.join(f'{k}:{v}' for k, v in sorted(by_off.items()))})")
    return score_nhl(mapping, want, logs, best)


async def identity_rows(pool, sport):
    """The five sports where ESPN's id IS ours. A row is written only where the
    id is present in BOTH prop_odds_archive and player_game_history — an
    identity claim about an athlete we hold no history for proves nothing and
    would inflate the counts."""
    async with pool.acquire() as c:
        return await c.fetch("""
            SELECT DISTINCT p.athlete_id FROM prop_odds_archive p
            WHERE p.sport = $1 AND p.athlete_id IS NOT NULL
              AND EXISTS (SELECT 1 FROM player_game_history h
                          WHERE h.sport = $1 AND h.athlete_id = p.athlete_id)
        """, sport)


UPSERT = """
INSERT INTO athlete_crosswalk
  (sport, espn_athlete_id, athlete_id, athlete_name, birth_date, match_method, verified_game_date)
VALUES ($1,$2,$3,$4,$5::date,$6,$7::date)
ON CONFLICT (sport, espn_athlete_id) DO UPDATE SET
  athlete_id = EXCLUDED.athlete_id, athlete_name = EXCLUDED.athlete_name,
  birth_date = EXCLUDED.birth_date, match_method = EXCLUDED.match_method,
  verified_game_date = EXCLUDED.verified_game_date, built_at = now()
"""


def as_date(v):
    """asyncpg binds a `date` column by type, not by the ::date in the SQL, so
    an ISO string arrives as a str and is rejected."""
    if isinstance(v, str):
        return date.fromisoformat(v[:10]) if v else None
    return v


async def write(pool, rows):
    if not rows:
        return 0
    rows = [(s, e, o, n, as_date(b), m, as_date(v)) for s, e, o, n, b, m, v in rows]
    async with pool.acquire() as c:
        for i in range(0, len(rows), 500):
            await c.executemany(UPSERT, rows[i:i + 500])
    return len(rows)


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--report", action="store_true", help="build and print, write nothing")
    args = ap.parse_args()
    pool = await db.get_pool()

    to_write = []
    for sport in ("mlb", "nhl"):
        async with pool.acquire() as c:
            ids = [r["athlete_id"] for r in await c.fetch(
                "SELECT DISTINCT athlete_id FROM prop_odds_archive "
                "WHERE sport=$1 AND athlete_id IS NOT NULL ORDER BY 1", sport)]
        print(f"\n=== {sport}: {len(ids)} distinct ESPN athlete ids in prop_odds_archive")
        espn = fetch_espn_athletes(sport, ids)
        print(f"  espn metadata: {len(espn)} resolved, "
              f"{sum(1 for v in espn.values() if v.get('dob'))} with a birth date")
        ref = fetch_mlb_reference() if sport == "mlb" else fetch_nhl_reference()
        print(f"  reference roster: {len(ref)}")
        mapping, stats = match(espn, ref)
        print(f"  matched {len(mapping)} / {len(ids)}  {stats}")

        # A reverse collision means two ESPN athletes landed on one of ours.
        # That is the Montreal-filed-as-Toronto failure in athlete form, so it
        # is dropped on both sides rather than resolved by preference.
        seen = {}
        for eid, (ours, *_rest) in mapping.items():
            seen.setdefault(ours, []).append(eid)
        collisions = {k: v for k, v in seen.items() if len(v) > 1}
        for eids in collisions.values():
            for eid in eids:
                mapping.pop(eid, None)
        if collisions:
            print(f"  DROPPED {len(collisions)} reverse collisions "
                  f"({sum(len(v) for v in collisions.values())} espn ids)")

        async def verify(m):
            return await (verify_local(pool, sport, m) if sport == "mlb"
                          else verify_nhl(pool, m))

        def summarise(ver, label):
            proven = sum(1 for v in ver.values() if v[0])
            rates = [v[1] / v[2] for v in ver.values() if v[2]]
            mean = f"{sum(rates)/len(rates):.1%}" if rates else "n/a"
            print(f"  {label:<20} {proven}/{len(ver)} pairs proven on a real "
                  f"(date, team), mean per-pair agreement {mean}")

        ver = await verify(mapping)
        summarise(ver, "TRUE MAPPING")

        # THE CONTROL. Deliberately mis-map every athlete onto another real
        # athlete of the same sport and re-run the identical check. Without
        # this the agreement rate above is a number with nothing to compare it
        # to — and "30 of 39 NHL team ids matched" was also a high number.
        keys = sorted(mapping)
        wrong = {k: (mapping[keys[(i + 7) % len(keys)]][0],) + tuple(mapping[k][1:])
                 for i, k in enumerate(keys)}
        summarise(await verify(wrong), "SHUFFLED CONTROL")

        # A provisional match (name only, no corroborating birth date) is a
        # hypothesis until a real game confirms it. Dropped here, not written
        # with a caveat nobody will read at the point of use.
        dropped = 0
        for eid, (ours, method, name, dob) in mapping.items():
            v = ver.get(eid, (None, 0, 0))
            if method == "name_unique" and not v[0]:
                dropped += 1
                continue
            to_write.append((sport, eid, ours, name, dob, method, v[0]))
        if dropped:
            print(f"  dropped {dropped} provisional name-only matches that no "
                  f"real game confirmed")

    for sport in IDENTITY_SPORTS:
        rows = await identity_rows(pool, sport)
        print(f"\n=== {sport}: {len(rows)} identity rows (espn id == our id, both tables)")
        for r in rows:
            to_write.append((sport, r["athlete_id"], r["athlete_id"], None, None, "identity", None))

    if args.report:
        print(f"\n--report: {len(to_write)} rows built, nothing written")
        return

    n = await write(pool, to_write)
    print(f"\nWROTE {n} crosswalk rows")
    async with pool.acquire() as c:
        for r in await c.fetch("""
            SELECT sport, match_method, count(*)::int n,
                   count(verified_game_date)::int verified
            FROM athlete_crosswalk GROUP BY 1,2 ORDER BY 1,2"""):
            print(f"  {r['sport']:<12} {r['match_method']:<14} {r['n']:>6}  "
                  f"verified {r['verified']:>6}")


if __name__ == "__main__":
    if sys.platform.startswith("win"):
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(main())
