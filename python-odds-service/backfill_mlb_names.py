"""Phase 5.2 — names for MLB players the crosswalk never considered.

`build_athlete_crosswalk.py` enumerates candidates from `prop_odds_archive`'s
ESPN ids, so a player who has never had a prop line posted is never a candidate
and never gets a row. That is the whole of the 14-17% slate gap: 618 of 1,777
players with 2025+ history have no name, and the board drops anyone it cannot
name.

THIS IS NOT A MATCHING PROBLEM AND MUST NOT BE SOLVED LIKE ONE. Those players'
ids came from MLB's own API and are already authoritative, so there is nothing
to match, disambiguate, or verify against a game — one lookup on MLB StatsAPI's
people endpoint returns the name for an id we already trust. Rows are written
with `espn_athlete_id = NULL` and `match_method = 'mlb_api_name_only'`, which
says exactly what is being claimed: identity, not an ESPN mapping. A NULL never
matches the prop-side join, so these rows cannot leak into it.

Contrast with the ESPN path, where a name agreement is only a CANDIDATE and has
to prove itself against a real (date, team) — because there the id is the thing
in question. Here it is not.

Usage (from python-odds-service/):
    python backfill_mlb_names.py --report   # show what would be written
    python backfill_mlb_names.py            # write
"""
import asyncio
import os
import sys

from datetime import date

import httpx

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src"))

import db  # noqa: E402

PEOPLE = "https://statsapi.mlb.com/api/v1/people"
BATCH = 100          # the endpoint takes a comma-separated personIds list
SINCE = date(2024, 1, 1)   # players with recent history; older ones cannot be ranked


async def uncovered(conn) -> list[str]:
    rows = await conn.fetch("""
        SELECT DISTINCT g.athlete_id
          FROM player_game_history g
         WHERE g.sport = 'mlb' AND g.game_date >= $1::date
           AND NOT EXISTS (SELECT 1 FROM athlete_crosswalk x
                            WHERE x.sport = 'mlb' AND x.athlete_id = g.athlete_id)
    """, SINCE)
    return [str(r["athlete_id"]) for r in rows]


async def fetch_names(client: httpx.AsyncClient, ids: list[str]) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for i in range(0, len(ids), BATCH):
        chunk = ids[i:i + BATCH]
        r = await client.get(PEOPLE, params={"personIds": ",".join(chunk)}, timeout=45.0)
        r.raise_for_status()
        for p in r.json().get("people", []):
            pid = str(p.get("id"))
            name = p.get("fullName")
            if pid and name:
                out[pid] = {"name": name, "birth_date": p.get("birthDate")}
        print(f"    fetched {min(i+BATCH, len(ids)):>5}/{len(ids)}  resolved {len(out)}")
    return out


async def main() -> int:
    report = "--report" in sys.argv
    pool = await db.get_pool()
    async with pool.acquire(timeout=180.0) as conn:
        ids = await uncovered(conn)
        print(f"Phase 5.2 name backfill — {len(ids):,} MLB players with {SINCE}+ "
              f"history and no crosswalk row\n")
        if not ids:
            print("  nothing to do")
            return 0

        async with httpx.AsyncClient() as client:
            found = await fetch_names(client, ids)

        missing = [i for i in ids if i not in found]
        print(f"\n  resolved {len(found):,}/{len(ids):,} "
              f"({len(found)/len(ids)*100:.1f}%)")
        if missing:
            print(f"  UNRESOLVED (no MLB StatsAPI record): {len(missing)} "
                  f"— e.g. {missing[:6]}")

        for pid in list(found)[:6]:
            print(f"    {pid} -> {found[pid]['name']}")

        if report:
            print("\n--report: nothing written")
            return 0

        # espn_athlete_id stays NULL: this row asserts a name, not a mapping.
        await conn.executemany("""
            INSERT INTO athlete_crosswalk
              (sport, espn_athlete_id, athlete_id, athlete_name, birth_date,
               match_method, built_at)
            VALUES ('mlb', NULL, $1, $2, $3, 'mlb_api_name_only', now())
        """, [(pid, v["name"],
                date.fromisoformat(v["birth_date"]) if v.get("birth_date") else None)
               for pid, v in found.items()])
        print(f"\n  wrote {len(found):,} name-only rows")
    return 0


if __name__ == "__main__":
    if sys.platform.startswith("win"):
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    sys.exit(asyncio.run(main()))
