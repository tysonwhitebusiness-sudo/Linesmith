"""Phase 4.6 — the PROJECTION pipe for NFL props: what Scan's NFL board reads.

Same shape as `mlb_prop_serving.py` and `nhl_prop_serving.py`, and deliberately
so: one pipe per sport, one table, one gate. Projections only, constants read
from `model_calibration` rather than transcribed, `model_prob` NULL where
calibration has not earned it.

THREE NFL-SPECIFIC THINGS.

1. **NO PROBABILITY IS SERVED AT ALL, AND THAT IS THE DESIGN.** Every NFL
   calibration is persisted with `probability_ok = False`, so
   `count_prop_engine.probability_is_servable` refuses each one and this pipe
   writes `model_prob = NULL` on every row. Phase 4.5 owns the probability
   gate, and it cannot run until the 2026 season produces held-out prop rows —
   NFL's entire prop archive is a single season, dense only Sept-Nov 2025, and
   at MLB's cutoff its largest market has 42 held-out rows.

   Under Phase 2's ranking rule a row with no probability still appears, still
   shows a projection, and ranks within its own market; it simply takes no
   global position. That is the correct state for a market that has not earned
   one, not a degraded one.

2. **NO BOARD LINE.** MLB serves every batter at one fixed line per market;
   NFL cannot. Phase 4.0c measured line concentration at 7.1-14.9% across every
   yardage market — all below the 16% at which MLB's `pitcher-outs` inverted —
   because a WR1's receiving line is 70.5 and a WR3's is 15.5. So `line` is
   NULL here and Scan pairs each projection with the candidate's OWN posted
   line, which is where the per-player line comes from for free.

3. **THE SLATE IS AN ESPN ROSTER, NOT A LINEUP.** NFL posts no pregame lineup,
   so subjects are every rostered player on a team with a scheduled game in the
   next fourteen days, via `game_context.load_sport_games('nfl')`. A rostered
   player who does not take a snap simply never matches a Scan candidate, which
   is the same harmless outcome as MLB projecting a batter who is later
   scratched.

   `RosterEntry.subject_id` is ESPN's namespaced id and `player_game_history`
   keys on the BARE one, so it is stripped here — see `_bare_id`, which
   documents why the obvious literal-prefix strip is wrong. The cache stays
   canonical like every other sport, and
   `lib/sports/nfl/adapters/statsBoardAdapter.ts` puts the prefix back for
   Scan.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date

from . import count_prop_engine as eng
from . import history_summary as hs
from .nfl_markets import MARKETS, BY_SLUG, NflMarket

MODEL_VERSION = 1
MIN_PRIOR_GAMES = 4        # NFL plays 17 games; MLB's 5 would be a third of a season

# Every parameter this pipe reads out of a calibration row. A row lacking any of
# them was produced by a different fitter and is skipped, not defaulted — the
# same rule `mlb_prop_serving.REQUIRED_PARAMS` enforces, and for the same
# reason: `model_calibration` outlives the code that wrote it.
REQUIRED_PARAMS = ("league_rate", "league_volume", "shrink_k", "volume_window")


def _bare_id(subject_id: str) -> str:
    """`espn:football:3916387` -> `3916387`. Idempotent on an already-bare id.

    THE PREFIX IS NOT WHAT THE CODE SAYS IT IS. `lib/sports/nfl/adapter.ts`
    documents the scheme as `espn:nfl:{athleteId}` and
    `lib/sports/multiSport/teamSportEspn.ts` builds it as
    `espn:${espnSport}:${a.id}` — where NFL's espnSport is **football**, not
    **nfl**. Measured live: `espn:football:4678006`.

    The TS adapter survives that by splitting on ':' and taking index 2 rather
    than matching the literal prefix. Stripping `espn:nfl:` here would have left
    every id untouched and matched ZERO history rows — silently, because a miss
    is a skipped player, not an error. Phase 4.3 lost an hour to the same class
    of failure by reusing MLB's crosswalk for NFL.

    Taking the segment after the last ':' handles `espn:football:`, `espn:nfl:`
    and a bare id without caring which is in use.
    """
    return subject_id.rsplit(":", 1)[-1]


@dataclass
class ServedProjection:
    athlete_id: str
    game_id: str
    dimension: str
    projection: float
    projected_volume: float
    games_of_history: int
    league_rate: float


def _stats(raw) -> dict:
    st = raw or {}
    if isinstance(st, str):
        st = json.loads(st or "{}")
    return st


def _sum_keys(st: dict, keys: tuple[str, ...]) -> float:
    total = 0.0
    for k in keys:
        v = st.get(k)
        if v is None:
            continue
        try:
            total += float(v)
        except (TypeError, ValueError):
            continue
    return total


async def _active_markets(conn) -> dict[str, dict]:
    rows = await conn.fetch(
        "SELECT market, params_json, version FROM model_calibration "
        "WHERE sport = 'nfl' AND active = true")
    out: dict[str, dict] = {}
    for r in rows:
        if r["market"] not in BY_SLUG:
            continue
        p = json.loads(r["params_json"])
        if any(k not in p for k in REQUIRED_PARAMS):
            continue
        out[r["market"]] = {**p, "version": r["version"]}
    return out


async def slate_subjects() -> tuple[dict[str, str], dict]:
    """Every rostered player on a team with a scheduled game, as
    {bare_athlete_id: game_id}.

    NFL has no pregame lineup to resolve, so this is a roster rather than a
    starting eleven. That is deliberate and reported: a rostered player who
    takes no snaps never matches a Scan candidate and costs nothing.
    """
    from game_context import load_sport_games

    games = await load_sport_games("nfl")
    subjects: dict[str, str] = {}
    scheduled = 0
    for g in games:
        if getattr(g, "is_final", False):
            continue
        scheduled += 1
        for entry in (getattr(g, "roster", None) or []):
            sid = getattr(entry, "subject_id", None)
            if sid:
                subjects[_bare_id(str(sid))] = str(g.game_id)
    return subjects, {"games": len(games), "scheduled": scheduled,
                      "rostered": len(subjects)}


async def build(conn, as_of: date, subjects: dict[str, str] | None = None,
                write_summary: bool = True) -> dict:
    """Projections for every rostered player on `as_of`'s upcoming slate."""
    cals = await _active_markets(conn)
    if not cals:
        return {"served": [], "markets": [], "note": "no active nfl calibration"}
    if subjects is None:
        subjects, _meta = await slate_subjects()
    if not subjects:
        return {"served": [], "markets": sorted(cals), "note": "no nfl slate"}

    # History, STRICTLY BEFORE as_of. The inequality is the whole leakage
    # control on this path and it is asserted rather than trusted.
    rows = await conn.fetch(
        "SELECT athlete_id, game_date, stats FROM player_game_history "
        " WHERE sport = 'nfl' AND game_date < $1 AND athlete_id = ANY($2::text[]) "
        " ORDER BY game_date", as_of, list(subjects))
    parsed: list[tuple[str, dict]] = []
    for r in rows:
        assert r["game_date"] < as_of, (
            f"leakage: history row dated {r['game_date']} is not before {as_of}")
        parsed.append((str(r["athlete_id"]), _stats(r["stats"])))

    out: list[ServedProjection] = []
    summary_rows: list[tuple] = []
    for slug, cal in sorted(cals.items()):
        m: NflMarket = BY_SLUG[slug]
        # PHASE 5.2: accumulate the summary in the SAME pass as the replay, so
        # the changeover is checkable rather than merely plausible. NFL passes
        # no line because it serves none until 4.5 clears, so `baseline_over`
        # and `baseline_total` stay zero here and `read` correctly reports no
        # baseline rather than a fabricated one.
        accs: dict[str, hs.Accumulator] = {}
        hists: dict[str, eng.PlayerHistory] = {}
        for aid, st in parsed:
            vol = _sum_keys(st, m.volume_keys)
            if vol <= 0:
                continue          # no opportunity carries no information
            ev = _sum_keys(st, m.stat_keys)
            hists.setdefault(aid, eng.PlayerHistory()).add(ev, vol)
            accs.setdefault(aid, hs.Accumulator()).add(ev, vol, line=None)
        summary_rows.extend(a.row("nfl", slug, aid, as_of, None)
                            for aid, a in accs.items())

        for aid, gid in subjects.items():
            h = hists.get(aid)
            if h is None or h.games < MIN_PRIOR_GAMES:
                continue
            pr = eng.project(h, cal["league_rate"], cal["league_volume"],
                             k=cal["shrink_k"],
                             volume_window=int(cal["volume_window"] or 0))
            out.append(ServedProjection(
                athlete_id=aid, game_id=gid, dimension=slug,
                projection=pr.expected, projected_volume=pr.projected_volume,
                games_of_history=pr.games_of_history,
                league_rate=cal["league_rate"]))

    if write_summary:
        await hs.upsert_rows(conn, summary_rows)
    return {"served": out, "markets": sorted(cals),
            "summary_rows": len(summary_rows) if write_summary else 0,
            "subjects": len(subjects), "history_rows": len(parsed)}


def to_cache_rows(served: list[ServedProjection]) -> list:
    """Convert to the shared cache shape. NO probability, NO line, asserted."""
    import db as _db

    rows = [
        _db.PropModelCacheRow(
            sport="nfl", game_id=s.game_id, subject_id=s.athlete_id,
            dimension=s.dimension, category="projection",
            # line and model_prob are NULL for every NFL row until 4.5 clears —
            # see this module's header. league_baseline is meaningless without a
            # line to be over, so it is NULL too rather than zero.
            line=None, model_prob=None, model_std_dev=None,
            model_sample_size=s.games_of_history, league_rate=s.league_rate,
            matchup_favorable=None, model_version=MODEL_VERSION,
            projection=s.projection, projected_toi=s.projected_volume,
            league_baseline=None)
        for s in served
    ]
    assert all(r.category == "projection" for r in rows)
    assert all(r.model_prob is None for r in rows), (
        "NFL must serve no probability until Phase 4.5 clears")
    return rows


async def run(as_of: date | None = None) -> dict:
    import db as _db

    as_of = as_of or date.today()
    subjects, slate_meta = await slate_subjects()
    pool = await _db.get_pool()
    async with pool.acquire(timeout=300.0) as conn:
        built = await build(conn, as_of, subjects=subjects)
    rows = to_cache_rows(built["served"])
    written = await _db.write_prop_model_cache(rows)
    return {k: v for k, v in built.items() if k != "served"} | slate_meta | {
        "projections": len(built["served"]), "written": written}
