"""PGA Tour shot-by-shot -> `golf_shot_events`. Operator-run, never scheduled.

Phase 6.13's last two role cells. Loads the `golfR` project's bundled
`data/pbp/` CSVs -- 40 tournaments, 2020-2023 -- which is what turned golf's
`usageMix` and `spatialGrid` from "needs ShotLink, which is commercial" into an
ingest task.

    cd python-odds-service
    ./.venv/Scripts/python.exe -u src/golf_shots.py load <path-to-golfR/data/pbp>

NOT IN JOB_REGISTRY, deliberately. golfR's scraper reads
`tourcastdata.pgatour.com`, a host that no longer resolves, so there is nothing
to schedule: this is a static historical seed, not a feed. A scheduled job
pointed at a dead host is worse than no job, because it reports healthy while
fetching nothing.

=========================== THE TRAPS IN THIS FILE ==========================

1. `lie` IS NOT THE LIE. The column named `lie` is the string "NA" on all
   10,222 rows of a real tournament. The vocabulary is in `from`/`to`: OTB
   (tee box), OFW (fairway), ORO (rough), OGR (green), OGS (greenside sand),
   OIR (intermediate rough), ONA (native area). Measured before writing this,
   because a loader trusting the obvious column would write nulls and look
   like it worked.

2. DISTANCES ARE PROSE. One column holds "311 yds", "108 yds" and "5 ft 3 in".
   Anything numeric-cast straight off it is either wrong or null. Parsed to
   yards here, following `golfR`'s own `pbp_clean.R`, which had to do the same.

3. "NA" IS A STRING, NOT A NULL, in every column. `float("NA")` raises and
   `if row["left"]` is True for it. Every read goes through the helpers below.
============================================================================
"""

import asyncio
import csv
import os
import pathlib
import re
import sys

import db

BATCH_ROWS = 2000

# "311 yds", "5 ft 3 in", "108 yds", "" -> yards. The source mixes units within
# one column and uses two-part measures near the hole.
_UNIT_YARDS = {"yds": 1.0, "yd": 1.0, "ft": 1.0 / 3.0, "in.": 1.0 / 36.0, "in": 1.0 / 36.0}
_DIST_PART = re.compile(r"(-?\d+(?:\.\d+)?)\s*(yds|yd|ft|in\.?)", re.I)


def parse_yards(raw: str | None) -> float | None:
    """`None` for anything unparseable, INCLUDING the literal string "NA".

    Never 0.0 as a fallback: a zero distance is a real shot that went nowhere,
    and confusing it with "not recorded" would pull every mean toward the hole.
    """
    if not raw:
        return None
    text = str(raw).strip()
    if text in ("", "NA", "NULL", "None"):
        return None
    total = 0.0
    found = False
    for value, unit in _DIST_PART.findall(text):
        factor = _UNIT_YARDS.get(unit.lower())
        if factor is None:
            continue
        total += float(value) * factor
        found = True
    return round(total, 3) if found else None


def na_str(raw: str | None) -> str | None:
    """"NA" is a string in these files, not an absent value."""
    if raw is None:
        return None
    text = str(raw).strip()
    return None if text in ("", "NA", "NULL", "None") else text


def na_int(raw: str | None) -> int | None:
    text = na_str(raw)
    if text is None:
        return None
    try:
        return int(float(text))
    except ValueError:
        return None


def parse_row(row: dict[str, str]) -> dict | None:
    """One CSV row -> one `golf_shot_events` row, or `None` if unusable."""
    player_id = na_str(row.get("playerId"))
    shot_number = na_int(row.get("shotNumber"))
    round_number = na_int(row.get("roundNumber"))
    hole_number = na_int(row.get("holeNumber"))
    tournament_id = na_str(row.get("tournamentNumber"))
    season = na_int(row.get("seasonYear"))

    # Every one of these is part of the uniqueness key. A row missing any of
    # them cannot be deduplicated on re-run, so it is dropped rather than
    # written with a placeholder that would collide with a real row later.
    if None in (player_id, shot_number, round_number, hole_number, tournament_id, season):
        return None

    first = na_str(row.get("firstName")) or ""
    last = na_str(row.get("lastName")) or ""
    return {
        "tournament_id": tournament_id,
        "season": season,
        "course_id": na_str(row.get("courseNumber")),
        "round_number": round_number,
        "hole_number": hole_number,
        "player_id": player_id,
        "player_name": (f"{first} {last}".strip() or None),
        "shot_number": shot_number,
        "distance_yds": parse_yards(row.get("distance")),
        "left_yds": parse_yards(row.get("left")),
        # See trap 1 in the module docstring: `from`, not `lie`.
        "from_lie": na_str(row.get("from")),
        "to_lie": na_str(row.get("to")),
        "is_putt": str(row.get("putt", "")).strip().upper() == "TRUE",
    }


async def load_directory(root: str) -> dict:
    """Every `pbp_*.csv` under `root`, recursively."""
    base = pathlib.Path(root)
    if not base.exists():
        return {"error": f"no such directory: {root}"}

    files = sorted(base.rglob("*.csv"))
    summary: dict = {"files": len(files), "rows_read": 0, "written": 0, "skipped": 0, "failed_files": []}

    for path in files:
        batch: list[dict] = []
        try:
            # utf-8-sig: several of these files carry a BOM, which otherwise
            # ends up inside the first header name and breaks every lookup.
            with open(path, encoding="utf-8-sig", newline="") as handle:
                for raw in csv.DictReader(handle):
                    summary["rows_read"] += 1
                    parsed = parse_row(raw)
                    if parsed is None:
                        summary["skipped"] += 1
                        continue
                    batch.append(parsed)
                    if len(batch) >= BATCH_ROWS:
                        summary["written"] += await db.write_golf_shot_events(batch)
                        batch = []
            if batch:
                summary["written"] += await db.write_golf_shot_events(batch)
        except Exception as exc:  # noqa: BLE001 — one bad file must not end the load
            summary["failed_files"].append(f"{path.name}: {type(exc).__name__}: {exc}")
            continue
        print(f"[golf_shots] {path.name} read={summary['rows_read']} written={summary['written']}", flush=True)

    return summary


if __name__ == "__main__":

    async def _main() -> None:
        if len(sys.argv) > 2 and sys.argv[1] == "load":
            print(await load_directory(sys.argv[2]))
        else:
            print("usage: golf_shots.py load <path-to-pbp-directory>")
            raise SystemExit(2)

    asyncio.run(_main())
